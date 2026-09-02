# Predator and Magma Blast: proximity homing and explosive shells

**Date:** 2026-09-02
**Status:** Design approved, ready for an implementation plan.

Two weapons get new behaviour, and the two chassis that carry them trade slot 1. Predator becomes a
straight shot that grabs the first enemy it flies near and chases it on a lifetime clock. Magma Blast
becomes an explosive shell that detonates on anything and leaves a corroding field behind. Predator
moves to Bullseye, Magma Blast to Mirage.

Neither weapon keeps its old identity: Predator's lock-frozen homing rocket and Magma Blast's plain
single-volley dart are both retired here.

## Decisions

Numbered for reference from the plan and from later specs, the same way `O1-O17` and `M1-M33` are
used elsewhere.

### Predator

- **P1.** Acquisition is by PROXIMITY, not by lock. The shot spawns with no target and scans each
  tick for one.
- **P2.** The trigger radius is **200 u**, authored explicitly on the weapon row. It is deliberately
  *not* derived from `aimRangeUnits`: coupling it to a stat that changes in this same pass is what
  made the requirement ambiguous in the first place.
- **P3.** The scan is a full 360-degree bubble around the shot's own position, not a forward cone.
- **P4.** It takes the **nearest** eligible car. Eligible means it passes `canDamage` (so teammates
  and the shooter are invisible to it) and `isTargetable` (so wrecks and phased cars are too) — the
  same two predicates the hit test already uses. No new notion of validity is introduced.
- **P5.** Once committed, it does **not** re-acquire. If that car dies, leaves, or phases, the shot
  flies straight from wherever it was pointing. This is exactly what lock-homing already does when
  its target vanishes, so it is one behaviour, not two.
- **P6.** Guidance runs for the shot's full lifetime, so "tracks until it hits something or its
  lifetime ends" is literal rather than approximate.
- **P7.** Aim assist stays ON and sets only the EXIT ANGLE. Nothing is frozen at spawn any more.
- **P8.** `aimRangeUnits` doubles, 400 -> 800.
- **P9.** `turnRateDegPerSec: 300`. Not specified in the request; chosen because turn radius is
  `speed / turnRate`, so the old 120 deg/s at the new 900 u/s would arc at 430 u — a shot that
  acquires at 200 u and sails past it. 300 deg/s arcs at 172 u, tight enough to convert a 200 u grab.
  This is the counterplay dial and is marked for playground tuning.
- **P10.** Stats: damage 50 -> 25, cooldown 2000 -> 300 ms, speed 600 -> 900 u/s, lifetime 2000 ms.
  `homing.durationMs` is 2000 as well — the same number, because P6 makes guidance and life the same
  window.
- **P11.** The `corroded` application is deleted — "Effect: none".
- **P12.** Walls still kill it. It is an ordinary projectile in every respect except guidance.

### Magma Blast

- **P13.** An instance whose weapon authors an `explosion` detonates whenever it is REMOVED, for any
  reason: enemy contact, wall or obstacle, arena bounds, or reaching max range. Because that is every
  way a projectile can die, there is no trigger taxonomy — one rule, one insertion point.
- **P13a.** Exactly one burst per shot, never two. The removal sites are evaluated in the loop's
  existing order — `instanceExpired`, then `hitsWorld`, then `alive === false` after hit resolution
  — and each already `continue`s, so a shot that both damages a car and crosses a wall on the same
  tick detonates once, at the first site that claims it. The implementation must preserve that
  early-exit structure rather than collecting reasons.
- **P14.** Detonation position is the post-step pose, **except** for a world kill, which detonates at
  the PRE-step pose. `hitsWorld` fires when the swept hull *crossed* a boundary, so the post-step
  point can be inside a wall or outside the arena; the shell blows up where it last legitimately was.
- **P15.** The burst spawns at FULL extent rather than growing from zero. This is what makes P16 true
  without a timing race.
- **P16.** A car hit directly is inside its own explosion: **50 contact + 15 splash = 65, and
  corroded.** The alternative — excluding the direct victim — would make a perfect shot the one way
  to not apply your own weapon's effect, which reads as a bug.
- **P17.** The explosion passes through level geometry. This is not a new rule: a `disc` hitbox has
  no axis to raycast along and already skips the wall clip.
- **P18.** No self-damage and no change to friendly fire. `canDamage` already refuses the owner, so a
  point-blank detonation is safe for the shooter. That predicate is not touched.
- **P19.** `lingerMs: 150` (five ticks). Mostly for the eye, but not only: with
  `damageFrequencyMs: 0` the per-target clock is once-ever, so a car that drives into the field
  during those five ticks is caught. That is intended — it is a real field for its brief life.
- **P20.** The corrode lasts 2000 ms — what Predator was carrying, so the status keeps the weight it
  already had in the roster rather than acquiring a new one by accident.
- **P21.** Stats: damage 22 -> 50, cooldown 600 -> 1000 ms, speed 900 -> 600 u/s. `range: 900`,
  `aimRangeUnits: 400` and the 12 u circle hitbox are unchanged.

### Mechanism

- **P22.** The explosion is modelled as a real `WeaponInstance` — a detached, centre-origin, `disc`
  beam — spawned at the death point. This wakes the dormant aura path, which is live and unit-tested
  in both sim and client and was parked for exactly this.
- **P23.** It is NOT its own `WEAPON_TABLE` row. A roster row that no car can equip would need the
  HUD, the guide generator and four enumeration tests to each pretend it isn't there.
- **P24.** Instead: an `explosion` sub-def on the parent projectile row, resolved through a single
  new helper `instanceDefOf(instance)` which returns either `weaponDefOf(id)` or a synthesized
  `BeamWeaponDef` built from that sub-def. The discriminated union survives intact because the
  helper hands back a real def; downstream code never learns a new shape.
- **P25.** Synthesis happens ONCE per weapon at module load, not per call, so the returned def is
  referentially stable and free.
- **P25a.** **A burst must never spawn a burst.** The detonation check reads
  `instanceDefOf(instance).explosion`, NOT `weaponDefOf(instance.weaponId).explosion`. A burst
  carries its parent's `weaponId`, so the second spelling would see Magma Blast's `explosion` when
  the burst expires and spawn another one — every tick, forever. The synthesized def is a
  `BeamWeaponDef`, which has no `explosion` field at all, so routing through the helper makes the
  recursion unrepresentable rather than merely unlikely. A test asserts a burst's expiry spawns
  nothing.
- **P25b.** The synthesized def's `speed` is derived so that `WEAPON_TICKS`' `flight` count is
  exactly **1 tick** (`radius * TICK_RATE_HZ`). It is not a free number: a beam expires at
  `flight + lifetime` ticks after spawn, so a small speed would give a large `flight` and a burst
  that outlives the match. Growth itself is irrelevant because P15 spawns the instance with
  `extent` already at `radius`; the derived speed exists only to make the expiry clock read
  `1 + lingerMs` ticks.
- **P25c.** An `explosion`'s `applies` entries must target `opponents`. `self` would mean the
  shooter, whom `canDamage` refuses (P18), and `ownerInside` is a presence buff for a zone the owner
  stands in, which a 150 ms burst at a remote impact point is not. Guarded in
  `weapon-config.test.ts` rather than left to authoring discipline.
- **P26.** `WeaponTicks` grows a parallel `explosion` sub-record — `flight`, `lifetime`,
  `damageInterval` and `applyDurations` — so milliseconds become ticks exactly once at module load,
  the lockstep rule, unchanged.
- **P27.** `WeaponInstanceState` grows `@type("boolean") isExplosion = false`. The client resolves a
  def from `weaponId`, which says "projectile", so without this it would draw a 12 u dart where the
  blast belongs. Deriving it instead (an instance whose networked `kind` disagrees with its def's
  `kind` can only be an explosion) is true today and rots the first time another weapon spawns a
  child instance.
- **P28.** `lifetimeMs` is hoisted out of `BounceDef` onto `ProjectileWeaponDef`, and
  `bounce?: BounceDef` becomes `bounces?: boolean`. `tremor` — the only bouncing row, and
  unassigned — re-authors as `bounces: true, lifetimeMs: 2900` with no behaviour change.
- **P28a.** `WeaponInstance.expiresAtTick` is now populated from `lifetimeMs` for ANY row that
  authors one, bouncing or not. `instanceExpired` already prefers `expiresAtTick > 0` over the
  distance check, so Predator's "no range, just lifetime" needs no new branch there — only a wider
  source for the field.
- **P29.** The existing guard "a bounce lifetime under its own cooldown, so two instances never
  coexist" narrows to BOUNCING rows only. Predator deliberately wants concurrency: 2 s of life on a
  300 ms cooldown is up to seven shots in the air.
- **P30.** Predator's `range` is derived and authored as `900 x 2 s = 1800`. `range` is load-bearing
  — `WEAPON_TICKS.flight` is `range / speed`, the guide prints it as reach, and the validator
  requires `range >= aimRangeUnits` — so it cannot simply be dropped. At 1800 the `flight` count is
  exactly 60 ticks, identical to the lifetime, so the two clocks cannot disagree. 1800 u clears
  `arena-01`'s 1469 u diagonal (1280 x 720); it would not clear `arena-02`'s, which is why "no range"
  is a statement about the shipped arena and not about the engine.

### Loadouts

- **P31.** Mirage: `["magmablast", "thunderclap", "afterburner"]`. Bullseye:
  `["predator", "pepperbox", "lance"]`. Slot 1 both times, so slot bits and HUD ordering are
  untouched.
- **P32.** ~~Weapon colours are left as authored. `magmablast` keeps the navy `#22579E` it inherited
  from the retired `needler` even though its icon is fire orange/red, so `npm run check:weapons`
  keeps warning on that row. That is a deliberate deferral, not an oversight; warnings never fail the
  suite. Only the stale "Mirage's palette" / "Bullseye's palette" comments on the two rows are
  corrected.~~

  **SUPERSEDED on merge to `development/main`.** An independent icon pass on that branch repainted
  every `WEAPON_TABLE.color` from its own icon and retired the per-chassis palette theme outright.
  `magmablast` is `#FF6000` and `predator` is `#606060`; the deferral P32 recorded was closed by
  someone else before this branch landed, and `check:weapons` now reports every carried weapon `ok`.
  The merge took the repaint wholesale — it is a different concern from this spec's mechanics, and
  the two do not conflict on anything but the literal hex.

## Architecture

### Where each piece lives

| Concern | Module | Why there |
|---|---|---|
| Proximity ACQUISITION (which car) | `sim/combat.ts` | It needs the pose list. `instances.ts` must keep its rule that it never reads player state. |
| Proximity STEERING (bend toward it) | `sim/weapons/instances.ts` | The existing integrator already does this; it takes a resolved pose from the caller. |
| Detonation trigger | `sim/combat.ts` | It owns the instance loop and therefore owns every removal path. |
| Explosion stats | `config/weapon-config.ts` | Balance lives in the table and nowhere else. |
| Explosion def resolution | `config/weapon-config.ts` (`instanceDefOf`) | One seam, used by every site that resolves a def from a live instance. |
| Explosion rendering | `client/scenes/combat-visual.ts` | `drawsAsAura` already paints a disc beam as ring-and-wash, in the parent's colour. |

The split between acquisition and steering is the load-bearing one. `instances.ts` is a pure module
that never reads player state — that is what makes it testable and what keeps the lag-compensation
seam in `hits.ts` honest. Proximity acquisition needs to see every car, so it belongs on the other
side of that line, in the loop that already holds `byId` and the pose snapshot.

### Detonation flow

`runCombat`'s instance loop has three removal sites: `instanceExpired` (range or lifetime),
`hitsWorld` (geometry and bounds), and `alive === false` after `resolveInstanceHits` (damaged a car
with no pierce left). All three currently `continue` or drop the instance. Each gains one call to a
shared `detonate(instance, pose)` whose result is pushed into the same survivor list the loop is
already building, so the burst is live from the next tick with no special-casing downstream.

### Type changes

```ts
// weapon-types.ts
interface ExplosionDef {
  radius: number;
  damage: number;
  lingerMs: number;
  applies?: readonly StatusApplication[];
}

interface HomingDef {
  acquire: "lock" | "proximity";
  /** Required exactly when `acquire: "proximity"`. Test-enforced both ways. */
  acquireRadius?: number;
  turnRateDegPerSec: number;
  durationMs: number;
}

interface ProjectileWeaponDef extends WeaponBase {
  // ...
  lifetimeMs?: number;   // hoisted out of BounceDef
  bounces?: boolean;     // was: bounce?: BounceDef
  explosion?: ExplosionDef;
}
```

`WeaponInstance` grows `isExplosion: boolean`. `WeaponInstanceState` grows the matching networked
boolean.

A `WeaponDef` has required fields an explosion has no opinion about, so the synthesis fixes them
rather than leaving them to the author:

- `id` and `color` are the PARENT's. The burst is Magma Blast, visually and in every lookup keyed by
  weapon; only its shape and stats differ.
- `damageFrequencyMs: 0` — once per target, ever. A 150 ms field must not tick, and `ExplosionDef`
  deliberately has no knob for it: a repeating explosion is a different feature, and the moment one
  is wanted it should be argued for on its own terms.
- `usesAimAssist: false`, `attached: false`, `origin: "center"`, `hitbox: { shape: "disc" }`,
  `range: radius`, `lifetimeMs: lingerMs`, `volley: { volleys: 1, volleyIntervalMs: 0 }`.
- `startUpMs`, `cooldownMs`, `recoveryMs`, `unlocksAt` are inert — a burst is spawned, never fired,
  so nothing reads its fire control. They take the parent's values rather than zeroes, so that a
  future reader who does reach for one gets a coherent number instead of a trap.

## What is deliberately NOT changed

- `canDamage`, and therefore friendly fire and self-damage, in any form.
- The drive model, the OBB hitbox model, and collision-damage rules.
- `AIM_CONFIG`'s numbers. Bullseye's acquisition range changes only because `carAimRangeOf` returns
  the max over a car's assisted weapons and Predator now authors 800.
- Client prediction. `stepSim` predicts the local car's pose only; `runCombat` is server-side and
  instances arrive over the wire, so neither new mechanic can desync.
- The multi-volley `VolleyDef` machinery, which stays dormant.

## Consequences worth stating

**Bullseye's lock doubles in reach.** `carAimRangeOf` returns the max over a car's *assisted*
weapons; Pepperbox declines assist by the multi-muzzle guard and Lance by the attached-beam guard, so
Predator's 800 becomes Bullseye's acquisition range outright, padded to 860 for retention. What that
actually buys is narrower than it sounds: `AIM_CONFIG.lateralMax` is 120 and the cone stops binding
past roughly 330 u, so the new far half is a 240 u wide lane straight down the nose. Mirage is
unaffected — Magma Blast and Thunderclap both author 400, exactly what Predator was contributing.

**Stale prose in `aim-config.ts`.** Its comment argues the lock range from Magma Blast by name —
"327 units at magmablast's 900 unit range", and a lead-error calculation over "mirage's 576 top speed
against magmablast's 900" — and calls Magma Blast "the fastest aim-assisted weapon in the roster"
when justifying `lockTimeoutMs` against the 1.25 Hz cliff. Speed drops to 600, the weapon changes
chassis, and Predator at 3.33 Hz takes that title. No test can see any of it, so it is rewritten in
the same commit.

**Balance.** Predator at 25 damage on a 300 ms cooldown is 83 sustained DPS at
`COMBAT_CONFIG.attackBaseline`, about 87 from Bullseye's attack 55 — the highest sustained
single-weapon output in the roster, ahead of Pepperbox's 75, and it steers itself and stacks seven
instances. Magma Blast on Mirage's attack 63 is 57 contact + 17 splash = 74 on a direct hit at 1 Hz,
against the 23-at-1.67 Hz (38 DPS) the row it replaces was doing. Both are large increases. These are
the requested numbers and they ship as requested; `npm run ttk` is the cheap way to see what moved.

**Three playtest probes break.** `slotBitFor("bullseye", "magmablast")` appears six times across
`playtest/geometry.ts`, `playtest/weapons.ts` and `playtest/weapons2.ts`, and that pairing stops
existing. A probe that does not build measures nothing, so the compile breaks are fixed in this pass
and called out. Beyond that:

- `geometry.ts:287` exempts `magmablast` from its `<- THROUGH THE WALL` verdict with the comment
  `(disc — passes through by design)`, left over from when this row was the retired aura. That
  exemption becomes correct again for a completely different reason: the shell dies on the wall, but
  its 60 u burst is a disc and does pass through, so a car hugging the far side within 60 u takes
  splash. The verdict logic and comment need rewriting.
- `weapons2.ts:149` iterates `predator` among a set whose behaviour this pass changes.

Beyond the compile fixes, the probes are left alone. This pass changes weapon reach, damage output
and instance counts, which is most of what they measure, so a `npm run playtest` run is recommended —
but running it and deciding what moved is the user's call.

## Documentation and generated output

- New: this spec.
- `docs/combat-model.md` — the two weapons, and corrode's new source.
- `docs/config-reference.md` — `WEAPON_TABLE`'s new fields.
- `docs/schema-reference.md` — `isExplosion`.
- `CLAUDE.md` — its aura paragraph states "no row in the roster uses a `disc` hitbox any more" and
  calls the mechanism dormant. Both stop being true. Its weapon-status paragraph also names the
  chassis each weapon sits on.
- `docs/turn-tuning.md` — **not** affected; nothing here moves a drive stat.
- `npm run build:manual`, with `manual.html` committed. `balanceStamp` hashes `WEAPON_TABLE` and
  `CAR_TABLE` whole, so this is mandatory and `manual-page.test.mjs` fails until it is done.

## Testing

**Config guards** (`weapon-config.test.ts`), gating authoring rather than code:

- `lifetimeMs`, when present, is positive.
- The bounce-lifetime-under-cooldown guard narrows to bouncing rows, so Predator is legal and Tremor
  is still held to one instance at a time.
- `acquireRadius` present exactly when `acquire: "proximity"`, both directions — the same shape as
  the existing `usesAimAssist`/`aimRangeUnits` pairing, so a new homing row cannot silently inherit
  an acquisition rule nobody chose.
- An `explosion` requires a positive radius and must do *something* — damage or `applies` — mirroring
  the rule already applied to weapons themselves, and every one of its `applies` entries targets
  `opponents` (P25c).
- The aim-assist cliff guard still passes unchanged: Predator's 300 ms cooldown is 3.33 Hz against
  the derived 1.25 Hz cliff, 167% clear of it, and Magma Blast's 1000 ms is 1.0 Hz, 20% clear —
  above the guard's 15% floor, but the tightest margin in the table and worth knowing.

**Existing tests whose meaning changes:**

- "ships magmablast as a plain single-shot dart" — it is not one any more.
- "keeps Bullseye's straight-line reach further than anything Bastion carries" — the reach becomes
  Predator's 1800.
- "keeps every status in the table reachable from some weapon" — `corroded` becomes reachable ONLY
  from inside `magmablast.explosion.applies`. The test reads top-level `applies` today, so it would
  pass while corrode was in fact unreachable, or fail for the wrong reason. It must look inside
  explosions.

**New behaviour tests:**

- `instances.test.ts` — proximity steering geometry; expiry on the lifetime clock with `range` never
  consulted; a burst spawning at full extent on its first tick.
- `combat.test.ts` — each of the three death paths produces exactly one burst and never two; a world
  kill detonates at the pre-step pose; a direct hit is 65 and corroded; the owner takes nothing; the
  burst crosses a wall; proximity acquisition takes the nearest eligible car and ignores wrecks,
  teammates, phased cars and the shooter.
- `instanceDefOf` returns a real `BeamWeaponDef` for an explosion instance and the plain def
  otherwise.
- `weapon-ticks.test.ts` — the `explosion` sub-record derives correctly.
- `schema.test.ts` — `isExplosion` defaults false and round-trips.

**Verification** is root `npm test` (a per-workspace run skips the server suite) plus root
`npm run build` (so shared is built before the server inlines it), with `npm install` run first in
this worktree so the build does not reach up into the main checkout's shared `dist`.
