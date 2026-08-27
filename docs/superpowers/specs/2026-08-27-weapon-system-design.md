# Motor Combat MOBA — Weapon System Design

**Designed:** 2026-08-27 · **Recorded in repo:** 2026-08-27
**Status:** Approved. Not yet implemented.
**Plan:** not yet written.

---

## Problem

The game has exactly one weapon. `WEAPON_CONFIG` is four numbers (`damage`, `fireRateHz`,
`projectileSpeed`, `lifetimeTicks`), every chassis fires the identical shot, `InputMessage.fire` is a
single boolean, `PlayerState.weaponCooldown` is a single counter, and a shot is a dimensionless
**point** tested against the target's car OBB.

The goal is a configurable weapon system: many weapons, of more than one type, assigned per chassis,
unlocked by an in-match level that does not exist yet. Every weapon damages by **hitbox collision** —
there is no hitscan anywhere in the design.

Two weapon types are in scope:

- **Projectile** — a hitbox that travels with a drawn object, frozen to its exit pose.
- **Beam** — a hitbox of a given shape that expands from the muzzle at a speed, out to a range, then
  lingers for a time.

## Constraints

1. The hard invariants in `CLAUDE.md` hold: `TICK_RATE_HZ` lives once in shared; no magic numbers in
   logic; clients send inputs, never authoritative state; `stepSim` is the lockstep; anything
   `stepSim` reads is a networked schema field; enum uint8 values are explicit and stable; max 6
   players.
2. Combat is **server-only** and stays so. The client predicts its own motion and nothing else.
3. v1 is LAN, but **online multiplayer is planned**. Nothing here may make competitive integrity
   structurally impossible to reach later.
4. The level system does not exist. Weapons must carry their unlock level anyway.
5. Ramming works, is well tested, and is not to be touched.
6. Balance numbers live in shared config tables, never in logic.

## Non-goals

- Hitscan weapons of any kind.
- Lag compensation / rewind hit testing (see [Future work](#future-work)).
- Ammunition and reloading (D13).
- Client-side prediction of firing, cooldowns, or damage.
- The in-match level/XP system itself — only the gate it will drive.
- Changing the drive model, the OBB car-hull model, collision-damage rules, or friendly fire.

---

## Decisions

### D1 — Explicit `kind`, discriminated union

A weapon declares `kind: "projectile" | "beam"`. Type-only stats live on their branch: `pierce` and
`volley` on projectiles, `attached` and `lifetimeMs` on beams.

Rejected alternatives:

- **Infer the type from the stats** ("it lingers, so it's a beam"). A config typo would silently
  change a weapon's category, and no branch could own its own fields.
- **Flat struct with an ignored-field convention.** Nothing stops a nonsense config, e.g. a beam
  declaring `pierce`.

A third type later (mine, aura, turret) is a new branch and nothing else changes.

### D2 — Slots: ordered list, fixed keys, bitmask input

`CAR_TABLE[car].weapons` is an ordered array of weapon ids; **index 0 is slot 1**. Order *is* the
slot mapping. `WEAPON_SLOT_CONFIG.maxWeaponSlots` (3) caps how many slots any chassis can present; a
car listing more logs one `console.warn` naming the car and its weapons, and the extras are
truncated. This is a warning, never a thrown error or a failed test.

Each slot has its own key. The client owns the binding (`config/slot-keys.ts`, at least
`maxWeaponSlots` entries, key code plus display glyph); the server never sees a key, only a slot
index. `InputMessage.fire: boolean` becomes `fireSlots: number`, a **uint8 bitmask** (bit 0 = slot
1). The server masks it to `maxWeaponSlots` bits and to the car's actual list length before the sim
sees it, so a hand-rolled client cannot fire a slot it does not own.

Multiple bits set on one tick resolve to the **lowest** slot.

Rejected: one fire key plus a weapon-switch key. It adds switch time as another stat and removes the
ability to answer instantly with a different weapon.

### D3 — One global fire state machine per car

The car is in exactly one of `idle → startUp → (fire) → recovery → idle`. Presses are **ignored** —
not queued, not buffered — as follows:

- While winding up or mid-volley (`pending !== null`), **every** press is ignored, including one for
  the weapon already firing.
- While recovering, a press for a **different** weapon is ignored. The weapon that just fired is
  gated only by its own stocks and `refireDelayMs`, per D4 — a weapon whose `cooldownMs` is shorter
  than its `recoveryMs` is refirable before other slots unlock.

- **Driving is never blocked**, and firing is never blocked by driving. `startUp` and `recovery`
  affect weapons only.
- An instance is born from the car's pose **at the tick it actually exits**, not at press time, so
  steering during a wind-up aims the shot.
- A wind-up **cannot be cancelled**. The press is a commitment, and the stock is spent at press.

Rejected: per-slot independent state machines (which would delete `recovery`'s meaning), and input
buffering (which fires weapons the player pressed a second ago and needs a buffer-window stat).

### D4 — Three clocks, each with exactly one meaning

| Stat | Question it answers |
|---|---|
| `cooldownMs` | when does this weapon get another **stock** |
| `stock.refireDelayMs` | how soon may **this** weapon fire again |
| `recoveryMs` | how soon may a **different** weapon fire |

`recoveryMs` is *not* a universal post-fire lockout: a weapon with `cooldownMs: 3000` and
`recoveryMs: 5000` is firable again by itself after 3 s while any other slot waits 5 s.

`refireDelayMs` exists only inside the optional `stock` block (D5), because for a single-stock weapon
the next shot is already gated by the recharge — the effective gate would be
`max(cooldownMs, refireDelayMs)`, so any value below the cooldown does nothing and any value above it
could have been expressed by raising the cooldown. The field is not merely inert there, it is
provably redundant, so it is unwritable there.

### D5 — Stocks (charges)

`stock?: { max: number; refireDelayMs: number }`. Absent means single-stock, which is exactly today's
behaviour, so no existing weapon opts out of anything.

- A weapon holds **1 stock** the moment it unlocks — a 3-stock weapon is *not* full at match start.
- A recharge timer of `cooldownMs` runs whenever `stocks < max`. On completion it adds a stock and
  restarts **only if still below max**.
- At max stocks the timer stops and is **cleared**; no progress is banked. Firing from max therefore
  starts a fresh, full `cooldownMs`, however long the weapon sat full.
- Firing at 1-of-3 with 2 s left on a running timer leaves that 2 s running untouched.
- Firing costs one stock. At 0 stocks the press does nothing.
- Consecutive stock shots are spaced by `refireDelayMs`, not by `cooldownMs`.

### D6 — Author in milliseconds, derive ticks once

Every duration is an integer millisecond field. `WEAPON_TICKS`, built and frozen at module load in
**shared**, converts each with `ceil(ms × TICK_RATE_HZ / 1000)` and also derives
`flightTicks = ceil(range / speed × TICK_RATE_HZ)` and the pre-converted hitbox polygons. The sim
reads only the derived table, never raw milliseconds.

Why not author in ticks: it hard-codes 30 Hz into every balance number, which fights invariant 1.
Fairness and determinism are unaffected by the choice — the conversion is deterministic, runs once,
and server and client consume the same built `dist`, so both compute identical tick counts or
neither does. The cost is rounding: at 30 Hz a tick is 33.3 ms, so `startUpMs: 250` becomes 8 ticks
(266 ms). That is documented, not hidden.

`fireRateHz` is retired in favour of `cooldownMs` so every duration in the table is one unit.

### D7 — One shape system, cross-section only for beams

Hitboxes are a nested tagged object on the weapon def, so a cone requires an angle and a circle
requires a radius and neither can carry the other's field.

| Type | Shapes | Config |
|---|---|---|
| Projectile | `circle`, `ellipse` | `radius` / `radiusAlong` + `radiusAcross` |
| Beam | `rect`, `cone` | `width` / `angleDeg` |

A beam configures **no length**: its axial extent is the current expansion, growing 0 → `range` at
`speed`, so `range` means one thing everywhere and can never contradict a length field. A cone's apex
is the muzzle, so it fans wider in absolute terms as it grows.

Implementation: circle-vs-OBB is exact; ellipse, rect and cone are converted to convex polygons at
table-build time and run through the same SAT the car hulls already use. One hit-test path.

### D8 — Swept ("smear") hit testing

Each tick a projectile is tested as the convex hull of its shape at its previous and current
positions. This is another convex polygon through the same SAT, so it is nearly free, and it removes
the standing authoring rule that every obstacle be at least 30 units thick. A fast shot can no longer
pass through a car.

It is slightly generous at high speed — the smear is solid, so a shot registers anywhere along that
tick's path — which is the correct bias for a shooter.

Rejected: sub-stepping fast instances (most accurate, most expensive, and it makes hit-test count
depend on weapon tuning).

### D9 — `pierce` is an integer, and counts cars only

`pierce` is how many **additional** opponents a projectile passes through after damaging one. `0`
destroys it on the first car it damages (today's behaviour); `2` damages up to three cars.

Teammates and wrecks are not contacts at all — the shot passes through them freely and they consume
no pierce, which falls out of the existing `canDamage` predicate. Walls, obstacles and the arena edge
always destroy a projectile regardless of pierce: pierce is about cars, never about cover.

### D10 — Repeat damage is a per-instance, per-target clock

Every live instance owns a map `targetSessionId → nextDamageTick`. `damageFrequencyMs: 0` writes
`Infinity` — that car may be damaged by that instance exactly once, ever. A positive value re-arms on
the interval.

This is server-only derived state, keyed by instance id, never networked, and dropped with the
instance. Beams are never destroyed by contact and may damage several cars at once; only projectiles
spend a pierce budget.

### D11 — Beam lifecycle

`grow → linger → die`. `lifetimeMs` counts from **full extension**, so total life is
`range ÷ speed + lifetimeMs`; tuning `range` never silently changes how long a beam holds. The beam
vanishes in one tick at the end — it does not retract.

- **Wall clipping.** Expansion is capped by a raycast down the beam's **centre axis** against
  obstacles and arena bounds, so cover works and a beam never damages through a wall. The
  simplification: only the centre ray is tested, so a wide beam may overhang a wall corner slightly.
- **Cars never block a beam** — there is no shadowing. That is what `pierce` is for on projectiles.
- **`attached: boolean`.** An attached beam's origin and angle follow the firing car every tick (a
  swept flamethrower or laser cutter) and its wall clip is re-evaluated as the car turns. A detached
  beam is stamped into the world at its fire-tick pose and never moves again.
- **Owner death.** An attached beam dies the tick its owner is wrecked — a wreck does not shoot.
  Projectiles already in flight and detached beams already stamped are unaffected and finish their
  lives, mirroring the ram rule where a car that dies still lands its damage.

### D12 — One volley block composes spread and burst

Every projectile weapon carries
`volley: { volleys, volleyIntervalMs, pelletsPerVolley, spreadAngleDeg }`.

| Weapon | volleys | intervalMs | pellets | spread |
|---|---|---|---|---|
| Plain gun | 1 | 0 | 1 | 0 |
| Shotgun | 1 | 0 | 6 | 25 |
| 3-round burst | 3 | 80 | 1 | 0 |
| Burst shotgun | 3 | 80 | 5 | 20 |

Pellets in a volley are fanned evenly and symmetrically around the car's heading and spawn on the
same tick, each its own instance with its own pierce budget. Sequential volleys exit on their own
ticks, each from the car's pose **at that tick** — so turning during a burst sprays the string across
an arc, and each shot is frozen the instant it exits.

The burst holds the global fire lock for its whole duration: no other slot may fire until the burst
finishes and `recovery` elapses. The slot's recharge starts at the **last** shot, so total downtime
is burst duration + cooldown and `cooldownMs` keeps meaning "time until another stock". Being wrecked
mid-burst cancels the remaining shots.

Volleys are projectile-only; beams are single-instance.

### D13 — Explicitly out: ammo, muzzle offsets, instance caps

- **No magazine or reload.** Volley plus cooldown plus stocks already carry the pacing, and weapon
  availability stays one set of clocks rather than two.
- **No per-weapon muzzle offset.** Every instance is born at the front face of the hull
  (`DRIVE_CONFIG.carWidth / 2`), as today.
- **No per-weapon cap on live instances.** The bound on instance count is `range ÷ speed`, and
  tuning must respect it (see [Online-play review](#online-play-review)).

All three are additive later and none is blocked by anything here.

### D14 — `unlocksAt` ships with a live gate, `level` pinned to 1

Weapons carry `unlocksAt` (validated ≥ 1; every shipped weapon is 1). `PlayerState.level` is added,
set to 1 at spawn, and never changes yet — but the fire path genuinely checks `unlocksAt <= level`,
with tests proving a level-2 weapon cannot be fired at level 1, and the HUD genuinely draws a locked
slot. When levelling is built, the only new work is making `level` move.

### D15 — One `weapons` array on the wire, everything derivable derived

`ArenaState.projectiles` becomes `ArenaState.weapons: ArraySchema<WeaponInstanceState>` carrying both
types, discriminated by a `kind` uint8 with explicit stable values (`PROJECTILE = 0`, `BEAM = 1`).

```ts
class WeaponInstanceState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("string") weaponId = "";
  @type("uint8")  kind = WeaponKind.PROJECTILE;
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") angle = 0;
  @type("number") extent = 0;      // beams: current reach; projectiles: 0
  @type("uint32") spawnTick = 0;
  @type("boolean") alive = true;
}

class WeaponSlotState extends Schema {
  @type("string") weaponId = "";
  @type("uint8")  stocks = 0;
  @type("uint32") rechargeEndsTick = 0;   // 0 = not recharging
  @type("uint32") refireLockUntilTick = 0;
}
```

`PlayerState` loses `weaponCooldown` and gains `weapons: ArraySchema<WeaponSlotState>`,
`switchLockUntilTick: uint32`, and `level: uint8`.

Rows stay small because the client looks up speed, range, shape, dimensions, name and icon from the
shared `WEAPON_TABLE` by `weaponId`. `speed` leaves the instance row entirely. The recharge sweep
needs no start field: `rechargeEndsTick` plus the table's `cooldownTicks` gives the fraction.

Rejected: parallel `projectiles` and `beams` arrays (two of everything, and a third type means a
third array), and fire-events-with-client-reconstruction (smallest bandwidth, but a missed event
draws a phantom with no server row to correct it).

### D16 — Loadout lives on `CAR_TABLE`

Each car row gains `weapons: readonly WeaponId[]`. Everything defining a chassis — speed, strength,
hp, guns — reads in one place, and TypeScript checks the ids against the weapon table. Two cars
sharing a loadout list the same ids; there is no restriction on sharing.

Rejected: a separate `CAR_LOADOUTS` table (splits a car's identity across two files) and named
loadout sets (an indirection layer three cars do not need).

### D17 — Display name lives on the weapon def

`WeaponDef.name`, exactly where `CarDef.name` already lives. It is never networked — the wire carries
`weaponId` — and `stepSim` never reads it, so invariant 8 does not apply, the same carve-out
`ArenaPalette` documents. Its consumers in this pass are the dev overlay and the validation warnings,
which read far better with names than ids. A client-side `WEAPON_STRINGS` table is the mechanical
change if names ever need translating.

### D18 — HUD: icon bar, radial sweep, four states

Camera-fixed (`setScrollFactor(0)`) horizontal bar, bottom-centre, drawing
`min(car.weapons.length, maxWeaponSlots)` slots — so the bar tells the player how many slots this
chassis has. Slot 1 leftmost. Each slot draws its icon, with the key glyph directly **beneath** it,
outside the frame — never over the icon. Names are not drawn; they clutter.

| State | Look |
|---|---|
| Ready | full brightness |
| Recharging | dim to ~40 %, dark wedge sweeping clockwise, numeric seconds only while > 1 s |
| Locked (`unlocksAt > level`) | static dim to ~25 %, no sweep, key glyph dimmed with it |
| Car-wide lockout | light overall dim — on **every** slot during a wind-up or volley, on the **other** slots during recovery, matching D3 |

The locked dim is heavier and static so it can never be confused with a cooldown dim. A weapon with a
`stock` block also draws a stock-count badge; its sweep shows the in-progress recharge and disappears
at max stocks.

Spectating: the bar follows the camera's subject — a watched car shows that car's slots, free roam
hides the bar. It is read-only; spectators send no input.

Rejected: key glyphs drawn over the icons (cluttered at 64 px), and an empty socket for a locked
slot — a darkened icon reads better and still tells the player what is coming.

### D19 — World instances stay procedural; icons get the pipeline

A live instance is drawn procedurally from its own hitbox shape and dimensions — circle/ellipse for
projectiles, a rect or cone sized by the row's `extent` for beams — so **what you see is the
hitbox**, a new weapon is playable with no art at all, and nothing has to stretch a texture over a
hitbox that grows every tick. Owner-coloured, as shots are today; a beam fades toward transparent
through its linger phase.

Icons resolve through the existing manifest chain with a new namespace:
`weaponIconKey(id) → "weapon-icon.<id>" → manifest → sprite`, falling back to a procedural glyph
derived from `kind`. Icons take their **own** defaults, not the car ones: `colorMode: "none"` (icons
are not player-tinted) and a fit to the square slot box rather than the 48×32 hull.

### D20 — Hit testing takes a pose snapshot (the lag-compensation seam)

`hits.ts` functions take the car poses as an **argument** — a snapshot of `sessionId → hull` for a
given tick — and must never reach into player state. This is the one structural concession to a
rewind hit-test arriving later: with the seam, adding lag compensation is "pass a different
snapshot"; without it, every hit path would need refactoring under rewind pressure. A test asserts
the hit functions are pure over their snapshot argument.

### D21 — `sim/weapons/` module set; `runCombat` stays the orchestrator

```
packages/shared/src/sim/weapons/
  shapes.ts      shape -> convex polygon, SAT wrappers, the swept smear hull
  fire.ts        the state machine: slots, three clocks, stocks, volley scheduling
  instances.ts   projectile travel; beam grow/linger/wall-clip; expiry
  hits.ts        pose-snapshot hit resolution, per-target damage clocks, pierce
```

`runCombat` keeps its job — order the phases, own ramming — and shrinks. Ramming is not touched.

Rejected: one large `sim/weapons.ts` (~600 lines doing five jobs), and refactoring ramming and
weapons into a generic effect pipeline (rewrites working, well-tested code to serve a generality
nothing has asked for).

### D22 — Content: migrate the existing weapon only

`WEAPON_TABLE` ships with one entry, `cannon`, carrying today's numbers exactly: `damage: 8`,
`cooldownMs: 500` (was `fireRateHz: 2`), `speed: 900`, `range: 900` (was `lifetimeTicks: 30`, i.e.
one second of flight at 900 u/s), `damageFrequencyMs: 0`, `startUpMs: 0`, `recoveryMs: 0`, no
`stock`, `unlocksAt: 1`, `pierce: 0`, `volley` 1/0/1/0, and a `circle` hitbox whose radius is the
smallest value that keeps today's point-hit feel. All three cars carry `["cannon"]`. Zero balance change, smallest diff to reason about. Beams, volleys and
stocks land with tests rather than shipped examples.

---

## Architecture

### Config

```ts
// packages/shared/src/config/weapon-types.ts
export type WeaponId = "cannon";

interface WeaponBase {
  id: WeaponId;
  name: string;
  unlocksAt: number;             // >= 1
  damage: number;
  damageFrequencyMs: number;     // 0 = each car damaged once per instance
  speed: number;                 // world units/sec: travel (projectile) or expansion (beam)
  range: number;                 // world units
  startUpMs: number;
  cooldownMs: number;            // recharge interval for one stock
  recoveryMs: number;            // lockout before a DIFFERENT weapon
  stock?: { max: number; refireDelayMs: number };
}

export interface ProjectileWeaponDef extends WeaponBase {
  kind: "projectile";
  hitbox: { shape: "circle"; radius: number }
        | { shape: "ellipse"; radiusAlong: number; radiusAcross: number };
  pierce: number;
  volley: { volleys: number; volleyIntervalMs: number;
            pelletsPerVolley: number; spreadAngleDeg: number };
}

export interface BeamWeaponDef extends WeaponBase {
  kind: "beam";
  hitbox: { shape: "rect"; width: number } | { shape: "cone"; angleDeg: number };
  attached: boolean;
  lifetimeMs: number;            // linger AFTER full extension
}

export type WeaponDef = ProjectileWeaponDef | BeamWeaponDef;
```

Tables: `WEAPON_TABLE: Record<WeaponId, WeaponDef>`; `WEAPON_SLOT_CONFIG = { maxWeaponSlots: 3 }`;
`CAR_TABLE[car].weapons`; and the derived, frozen `WEAPON_TICKS`. Client-side: `config/slot-keys.ts`.

Validation at module load: `unlocksAt >= 1`; positive `damage`, `speed`, `range`; `stock.max >= 2`
when present; volley counts ≥ 1; cone angle in (0, 180); loadout length ≤ `maxWeaponSlots` or one
warning and truncation.

### Per-car firing state

```
level                                  // pinned to 1
slots[]: { stocks, rechargeEndsTick, refireLockUntilTick }
switchLockUntilTick, lastFiredWeaponId
pending: { weaponId, slot, shotsLeft, nextShotTick } | null
```

Slots are populated from `CAR_TABLE[carId].weapons` when the chassis is revealed. A player with
`carId === ""` — pre-reveal, or anything unrecognised on the wire — has an **empty** slot array and
can fire nothing, which is the same gate today's `carId === ""` check applies.

### Tick order

`runCombat` runs, in order:

1. **Recharge** — for every slot below max with a running timer: on `tick >= rechargeEndsTick` add a
   stock, restart only if still below max, clear the timer at max.
2. **Step existing instances** — before new ones are born, so a fresh shot still draws at the muzzle
   rather than a tick beyond it (today's behaviour, preserved).
3. **Scheduled shots** — if `pending.nextShotTick === tick`, emit that volley's pellets. On the last
   shot: start the slot's recharge if not already running, set `refireLockUntilTick`, set
   `switchLockUntilTick = tick + recoveryTicks`, clear `pending`.
4. **New presses** — mask the bitmask to `maxWeaponSlots` and the car's list, take the lowest set
   bit, and require: `pending === null`; `unlocksAt <= level`; `stocks >= 1`; and either the same
   weapon as `lastFiredWeaponId` with `tick >= refireLockUntilTick`, or a different weapon with
   `tick >= switchLockUntilTick`. On success spend a stock immediately and set `pending` to fire at
   `tick + startUpTicks`.
5. **Hit resolution** — against the pose snapshot, in sorted `sessionId` order, gated by `canDamage`.
6. **Ramming** — unchanged.

Determinism: players sorted by `sessionId`, slots by index, instance ids from a monotonic sequence
carried in and out, exactly as `projectileSeq` is today.

### Server and client seams

`combat-bridge.ts` remains the only file that knows about Colyseus: it maps players, slots and
instances onto plain objects and writes the answer back. No rules move into it. Ending or setting up
a match clears `weapons` and the per-instance damage books alongside the existing ram-cooldown clear.

Client: `scenes/weapon-hud.ts` holds pure derivations (`sweepFraction`, `slotVisualState`,
`countdownSeconds`) with drawing in `ArenaScene`; `combat-visual.ts` grows from "draw shots" to "draw
instances". `extrapolateShot` is unchanged for projectiles (speed now read from the table); beams
extrapolate `extent` under the same one-patch cap, and an attached beam is drawn off its owner's
*rendered* pose so it does not visibly lag the car it is welded to.

---

## Art pipeline

`scripts/import-weapon-icon.mjs`, mirroring `import-art.mjs` with rules suited to a different job:
trim transparent margins, square the canvas, downscale to 128×128 (2× the ~64 px slot box, so the
deferred device-pixel-ratio work needs no re-import), **keep colour** — the car importer desaturates
because cars are tinted, and a desaturated icon is a grey blob — write
`packages/client/public/art/weapon-icons/<weaponId>.png`, and upsert the `weapon-icon.<id>` manifest
row with `colorMode: "none"` and `scale: "fit"`, preserving hand-tuned fields.

A `process-weapon-icon` skill mirrors `process-car-asset`: takes an image and a weapon id, runs the
importer, reports the manifest row, and covers "why is my icon blurry / missing / wrong".

### Image-generation prompt template

> Flat vector game icon of **\<weapon description\>**, centred single object, viewed straight on,
> filling most of a square frame with a small even margin. Bold simplified silhouette that stays
> readable when scaled down to 64×64 pixels. Limited palette of 3–4 saturated colours with strong
> value contrast against both light and dark backgrounds. Clean crisp edges, no gradients, no
> texture, no drop shadow, no outer glow, no perspective, no background scenery, no text, no
> lettering, no watermark. Consistent top-left light source. Transparent background. PNG.

Generate, then run the skill. Keep the lighting direction and palette constant across a set so the
bar reads as one family.

---

## Testing

Unit coverage per module:

- **shapes** — polygon conversion for each shape, SAT against car hulls, the smear hull.
- **fire** — the state machine; the 3-stock/3-second worked example transcribed literally; lowest
  slot wins; a locked weapon refuses; a wind-up cannot be cancelled; recovery gates a different
  weapon while `refireDelayMs` gates the same one.
- **instances** — beam grow → linger → die timing; wall clipping; an attached beam dying with its
  owner while a detached one and in-flight projectiles survive.
- **hits** — pierce budget; teammate and wreck transparency consuming no pierce;
  `damageFrequencyMs` clocks; purity over the pose snapshot (D20).
- **config** — every validation rule, including the over-slot warning.
- **HUD** — the pure derivations for all four visual states.

Plus **driven-through-the-real-sim** regressions in the manner of the existing ram tests: a real car
firing a real volley through `stepSim`, because hand-placed instances are exactly the trap that let
the ram bug through a green suite. Plus schema round-trip tests.

## Rollout

Ordered to respect the shared-`dist` gotcha: shared config and types → sim modules → schema → server
bridge → client → docs (`combat-model.md`, `schema-reference.md`, `config-reference.md`,
`asset-pipeline.md`). Build with root `npm run build`, never `npm run build --workspaces`.

---

## Online-play review

**What holds.** Every timing quantity is an integer tick count derived once in shared from
`TICK_RATE_HZ`; there is no wall-clock, frame-rate, or float-accumulation path into weapon timing.
Firing, stocks, clocks, instance stepping and damage are all server-authoritative — the client sends
a bitmask of intent and nothing else, and the fire gate reuses the existing "inputs the server
actually simulated" rule, so an input past `NET_CONFIG.maxInputsPerTick` cannot buy a shot.
Client-side combat prediction stays at zero, so there is no reconciliation surface to desync and a
phantom kill is structurally impossible. Iteration order is sorted, so identical inputs give
identical outcomes.

**The real gap, unchanged by this design: no lag compensation.** Hits are tested on the current tick
with no rewind, so a shooter on 80 ms leads by roughly their own latency and a higher-ping player is
disadvantaged. This design does change how much that hurts: `startUp` adds the wind-up to the lead a
player must carry, while beams — area, lingering — are far more forgiving of it than a fast
projectile. Weapon tuning therefore becomes part of the fairness story on a real internet game.

**Smoothness.** Instances arrive at 20 Hz and are extrapolated along their own exact integration,
capped at one patch interval — the technique already shipping for shots, extended to beam extent. The
HUD is the one place the round trip is felt: a pressed slot shows nothing until the patch confirms it
(~50 ms on LAN). That is deliberate; an optimistic local sweep would show a slot as ready when the
server says otherwise, which is worse than 50 ms of honest lag on an icon.

**To watch.** Volleys multiply wire rows — 6 players × 6 pellets ≈ 36 live instances against today's
~6, at roughly 40 bytes each. Comfortable on LAN at 20 Hz; the first thing to measure over the
internet. With no per-weapon instance cap (D13), `range ÷ speed` is the only bound on instance
lifetime and tuning must respect it.

## Future work

**Lag compensation (rewind hit testing).** Deferred, and deferring is cheap: the machinery is
server-only and additive — a ring buffer of per-player poses keyed by tick (~1–2 s deep), a
per-client latency estimate, a rewind window clamp, and hit tests run against the rewound snapshot.
None of it touches the weapon config, the state machine, the schema, the wire, or the client, and
D20's seam makes adopting it a call-site change. Two rules will need deciding then:

- **Lingering and attached beams.** Rewinding a two-second area effect per tick damages people where
  they *were* for as long as the beam lives. The conventional answer is to compensate instantaneous
  hits only and leave persistent area effects in server-present time.
- **Spawn-time catch-up.** Fast-forwarding a new projectile by the shooter's latency, so it starts
  where the shooter saw it, is confined to the emit step and is markedly less work than full per-tick
  rewind. With D8's smear already removing tunnelling, it may be sufficient alone.

The cost of deferring is **balance, not code**: lag compensation changes effective accuracy, so
weapons tuned under "everyone leads by their own ping" get re-tuned. With one migrated weapon (D22)
that is nearly free today and grows with the roster — so add rewind before authoring a large weapon
set, not necessarily before this system lands.

**Also deferred:** the in-match level system that drives `unlocksAt`; ammunition and reloading;
per-weapon muzzle offsets; per-weapon live-instance caps; world sprites for instances; weapon types
beyond projectile and beam.
