# Melee weapons, and the mount rework they need

**Date:** 2026-09-18
**Status:** Approved in brainstorming; not implemented.
**Decisions:** ML1–ML52.

## 1. What this is

Four melee weapon shapes are wanted:

1. **A blade** that sweeps through an arc — length and arc configurable.
2. **A spring thrust** — a ball, bar, arrow or hook that punches forward and comes back.
3. **A pincer** — two arms that appear as a V and close it.
4. **A hook** — a thrust that pulls what it catches toward the car.

None of them fits the weapon config as it stands. This spec says what the config must gain, and
nothing else: it defines the mechanism, not a roster. Authoring actual `WEAPON_TABLE` rows and
deciding which chassis carry them is a separate balance pass (ML52).

It also carries one change that is not melee's alone. The muzzle system is reworked into **mounts**
for every weapon in the game, because melee needs arms hinged somewhere other than the nose and the
current system cannot say that — and because the current system places side muzzles wrong (ML5).

**Melee is not a new weapon kind.** `afterburner` is already a melee weapon in everything but name: a
220-unit attached cone welded to the nose and tail. Melee is a range and an attachment, not a
mechanism, so it is authored on the kinds that already exist.

## 2. Principles

**A. Put the new behaviour where the existing contract is closest.** Every question below resolved
the same way: the kind that already re-reads its owner every tick gets the exception, not the kind
built on never doing so.

**B. Say it rather than imply it.** A count that silently changes behaviour, a string prefix that
carries meaning, a field name that has stopped being true — this codebase has ruled against all
three before. The mount rename, the sweep's explicit `pattern` and the removal of the basic-attack
id rule (landed separately, `8b5aa8e`) are the same ruling applied again.

**C. One concept, several endings.** `pierce` means "how many cars this passes through before it
stops advancing" for every weapon in the game. What *stopping* means differs by kind, and that is
the only thing that differs.

**D. Melee is authored, not special-cased.** A melee weapon is an ordinary `WEAPON_TABLE` row. It may
sit in an ability slot or a basic-attack slot, it may be carried by nobody, and no code anywhere
asks "is this melee".

## 3. Mounts

**ML1. `WeaponBase.muzzles` becomes `WeaponBase.mounts`, a list of named positions on the hull.**

```ts
export type Mount = "front" | "rear" | "left" | "right" | "center";
mounts?: readonly Mount[];   // absent means ["front"]
```

**ML2. The five mounts.** Positions are derived from the hull, so a future hull resize moves them
with no edit.

| Mount | Position | Direction |
|---|---|---|
| `front` | `+carWidth/2` along the heading | heading |
| `rear` | `−carWidth/2` along the heading | heading + 180° |
| `left` | `−carHeight/2` laterally | heading − 90° |
| `right` | `+carHeight/2` laterally | heading + 90° |
| `center` | the car's centre, no offset | heading |

**ML3. Mounts apply to every weapon — abilities, basic attacks and melee alike.** There is no melee
mount system; there is one mount system that melee happens to need more of.

**ML4. `BeamWeaponDef.origin` is deleted.** `origin: "center"` and a `center` mount answer the same
question — where does this weapon emit from — and two fields answering one question can contradict
each other. An aura becomes `mounts: ["center"]` with a `disc` hitbox.

`center` keeps meaning exactly what `origin: "center"` means today: **no offset from the instance's
own spawn point.** For an attached beam that point is the car's centre; for `magmablast`'s
synthesized burst it is the impact point, which is why `buildBurstDefs` must emit `mounts: ["center"]`
where it emits `origin: "center"` today.

**ML5. This fixes a placement bug.** Every muzzle today sits `carWidth/2` = 30 u from the centre
whatever its direction, because that is the only offset `muzzleOffset()` knows. The hull is 60 × 40,
so `pepperbox`'s 90°/270° fans currently spawn **10 u off the car's flank**. Real mounts put them on
the hull.

This changes where two of `pepperbox`'s four fans begin. It is a behaviour change, small but real,
and it reaches the playtest probes (ML49).

**ML6. Both shipped multi-muzzle rows convert one-to-one.** `afterburner: [0, 180]` →
`["front", "rear"]`; `pepperbox: [0, 90, 180, 270]` → `["front", "right", "rear", "left"]`. No row
in the table authors an angle that is not one of the four faces, which is what makes a named-position
model sufficient rather than lossy.

**ML7. A mount carries no angle offset.** Nothing needs one: a pellet fan is `PelletDef`'s job and a
sweep's arc is the sweep's. Adding `{ mount, angleDeg }` later is a widening, not a rewrite.

**ML8. The rename reaches the instance and the helpers, and stays sim-only.**
`WeaponInstance.muzzleDir` → `mountDir`, still "radians off the owner's heading", still never
networked: `front` 0, `right` +90°, `rear` 180°, `left` −90°, `center` 0. `muzzleOf`/`muzzleOffset`
become `mountOf(owner, mount)`/`mountOffset(mount)`. Attached re-anchoring, prediction and rendering
are unaffected — an instance still re-anchors through its own frozen `mountDir`, so a rear flame
still stays welded to the tail.

Stale comments to clear while passing: `weapon-config.ts` still explains multi-muzzle rows in terms
of forcing aim assist off, and aim assist was deleted on 2026-09-17.

## 4. Melee is an attached beam

**ML9. Both melee motions are authored on `BeamWeaponDef`.** A beam already provides everything melee
needs that is not motion:

- `attached: true` — origin and angle re-derived from the owner every tick; dies with its owner
- `extent` — a length that changes over time, already networked, already wall-clipped every tick
- `damageFrequencyMs: 0` — each car hit once, ever, per instance
- one instance per mount, each with its own damage clock (this is what `afterburner` already relies on)

**ML10. Two new optional fields on `BeamWeaponDef`, mutually exclusive.**

```ts
sweep?: SweepDef;     // the blade and the pincer
thrust?: ThrustDef;   // the spring and the hook
```

A row authoring both is a config-test failure. A row authoring neither is an ordinary beam and
behaves exactly as beams behave today — that is the compatibility guarantee this spec rests on.

**ML11. No new wire value and no new schema field.** A swinging arm's live angle rides in the
instance's `angle` and a thrust head's reach in `extent`, both already sent every tick. `WeaponKind`
gains nothing; the client keeps receiving `BEAM`.

**ML12. Per-arm damage is per-instance damage.** `damage` is what **one** arm or **one** head deals,
exactly as `damage` is what one pellet deals. Two pincer arms that both connect deal it twice, because
they are two instances with two damage clocks. Statuses do not double — a status never stacks with
itself, so the second arm refreshes rather than adds. That asymmetry is inherited from the existing
model, not introduced here.

## 5. `pierce` moves to the base, and beams can be stopped by cars

**ML13. `pierce` moves from `ProjectileWeaponDef` to `WeaponBase`**, keeping one definition: *how many
additional cars this passes through before it stops advancing.*

| Kind | "Stops advancing" means |
|---|---|
| projectile | the shot dies (unchanged) |
| beam | the beam **clips** — it stops growing at the blocking car, as it already stops at a wall |
| thrust | the head **turns back** |
| maneuver | nothing; authoring `pierce` on a maneuver is a config-test failure |

**ML14. Absent means unlimited.** Every beam in the table today passes through every car, and must
keep doing so. Projectiles continue to require an explicit value, so no projectile row changes.

**ML15. Only beams with an axis can be blocked: `rect`, `cone` and `head`. `disc` is exempt.** This is
the wall rule, unchanged — a cone is already wall-clipped along its centre axis, and a disc is
already exempt because it has no direction to raycast along. A second, different answer for cars is
how the two would drift apart.

**ML16. Clipping is recomputed every tick.** `extent` is already `min(reach, extent + speed·dt)`, so a
blocked beam shortens, and grows again when the blocker dies or drives clear. A lance's reach
visibly breathes in a crowd; that is the intended read of cars occluding a beam.

**ML17. Hit resolution gains distance ordering.** The hit loop walks the pose snapshot in session-id
order today and knows nothing about which car is nearest. Clipping needs candidates sorted along the
beam's axis, tie-broken deterministically (**distance, then session id**) so the two halves of the
lockstep can never disagree. The blocking car still takes its hit.

**ML18. The stepping code learns about cars.** `stepInstance` derives reach from walls and never sees
a player. The clip needs car poses handed in by the caller — the same shape as the homing target's
pose, which is already passed in that way. The module still reads no player state of its own.

**`lance` authors `pierce: 6`, which changes nothing.** Six through, the seventh blocks it — and a
seventh opponent cannot exist: `MAX_PLAYERS` is 6, so an instance meets at most **five** opponents in
FFA and three in a 3v3, and teammates and the owner never consume pierce because `canDamage` skips
them before any pierce arithmetic. Any value of 5 or more is unlimited in practice; 6 is that with a
spare. So lance behaves exactly as it does today and this spec carries **no weapon balance change**.

**A consequence to state rather than leave implicit: for every shipped row, the clipping rule ships
dormant.** It is live, generically tested machinery with no weapon driving it — the same shape the
aura mechanism sat in between `shockwave` and `magmablast`. Making a beam genuinely blockable means
authoring 1 to 4, which is a balance decision for the roster pass (ML52), not for this spec.

## 6. The sweep — blade and pincer

**ML19. The definition.**

```ts
interface SweepDef {
  /** Total arc, degrees, centred on the mount's direction. 180 = right, across the nose, to left. */
  arcDeg: number;
  /** How many arms per mount. Each is its own instance with its own damage clock. */
  arms: number;
  pattern:
    | { type: "across"; direction: "cw" | "ccw" }
    | { type: "close" };
  /** How long the swing takes. */
  durationMs: number;
}
```

**ML20. The arc is centred on the mount's direction**, which is the authoring convention this spec was
asked for: `arcDeg: 180` sweeps from one side to the other; `arcDeg: 90` runs from 45° to 135°. No
start angle is authored, so a rear or side blade reads identically to a front one.

**ML21. `pattern` is explicit and the arm count is not overloaded.** `across` sends each arm over the
whole arc in the named direction; `close` starts arms at the arc's edges and travels them to its
centre — the V. Two arms closing is the pincer; one arm crossing is the blade. A twin blade (two arms,
both crossing) is authorable the day it is wanted, and `"open"` is the obvious later addition.

`arms` is required to be ≥ 1, and `pattern: "close"` requires an even count — a lone arm has nothing
to close against.

**ML22. Arm angle is a pure function of ticks since spawn**, so no extra state crosses the wire and
both halves of the lockstep derive the same angle. An arm's own starting offset is folded into its
`mountDir`; `close` arms carry opposite travel signs, which is sim-only state alongside `damageClock`.

**ML23. Existing beam fields keep their meanings.** `range` is the blade's length, `hitbox.width` its
thickness, `speed` how fast it reaches full length (author it high for a blade that is out instantly,
low for one that extends as it swings), and `lifetimeMs` how long it lingers at the end of the arc.

**ML24. A swing rides the car.** The arm's angle is relative to the mount and the beam is attached, so
turning mid-swing carries the blade around. A welded arm that ignored its car's heading would be a
bug, not a feature.

**ML25. A sweep needs no pierce rule of its own.** Absent, a blade scythes through everyone; `pierce: 0`
makes it bite into the first car and re-extend as it sweeps clear. Both fall out of ML13–ML16.

## 7. The thrust — spring and hook

**ML26. The problem this solves.** A projectile describes its whole shape; a beam describes only its
cross-section, because its length is `extent`. A thrust head is a fixed-size object — like a
projectile — sitting at a distance that changes — like a beam — welded to the car, and it comes home.
Each kind gets half of it right, so one of them takes an exception. It goes to the beam, whose
lifecycle already fits (attached, `extent`, wall clip), rather than to the projectile, whose defining
rule is that it flies a frozen heading and never reads its owner.

**ML27. `BeamHitbox` gains a head arm.**

```ts
| { shape: "head"; head: ProjectileHitbox }
```

For `rect` and `cone`, `extent` is how far the shape **stretches**. For `head`, `extent` is how far out
the head's **centre** sits, and the head's own size is fixed. `disc` is already a third reading of
`extent` (its radius), so this union has never been uniform; this is one more documented reading, not
a new precedent.

Placing it reuses what exists: walk `extent` along the beam's angle, hand the head to
`projectileShapeAt`. Ball, bar, arrow and hook are `circle`, `bar` and `capsule`.

**ML28. The definition.**

```ts
interface ThrustDef {
  /** Coming home, u/s. `WeaponBase.speed` is the speed going out. */
  returnSpeed: number;
}
```

One field, because `pierce` is already on the base (ML13) and already means the right thing here: how
many cars the head goes through before it stops advancing, where stopping is the turn-back. A thrust
authoring `pierce: 0` turns back on the first car; an absent `pierce` runs to max range through
everyone, which is the piercing hook.

**ML29. Three things turn the head around**, and all three already have code: reaching `range`, hitting
its (`pierce` + 1)th enemy, or reaching a wall. Walls stop melee the way they stop shots — the beam's
existing `wallClipDistance` is the cap.

**ML30. No new timing field.** `lifetimeMs` already means "linger after full extension", which is
exactly the pause at the far end of a thrust.

**ML31. Speeds, not durations.** The head can turn back anywhere along its path, so a fixed retract
*time* would make a short stop crawl home. `speed` out, `returnSpeed` back.

**ML32. One hit per press, out or back.** `damageFrequencyMs: 0` already means each car is hit once
ever per instance, so a car hit on the way out is not hit again on the way back. No new rule.

**ML33. Sim-only state, and a reused field.** Whether the head is outbound or returning is not
derivable from `extent` once an early turn-back exists; it is sim-only state, never networked, like
`damageClock`. The pass-through count rides in the instance's existing `pierceLeft`, which sits unused
at 0 for beams today.

**A thrust is the first beam whose reach is ended by something other than its own clock.** Every beam
without one keeps today's guarantee exactly: grows, clips on walls, passes through everyone, dies on
its clock.

## 8. The yank

**ML34. The hook's pull is an ordinary `ImpulseDef` with a negative `speed`.** That type already
documents a negative magnitude as a pull toward the source. The spring and the hook therefore differ
by exactly one authored field, which is the evidence this is the right seam.

**ML35. What is new is the application path.** Today the only thing that applies an impulse is
`wildcharge`'s slam, assembled in `ram-bridge.ts`. A **weapon hit** applying one is new wiring in the
combat bridge — the first, and built so any future weapon impulse (an explosion's shove, a
shotgun's punt) uses the same path.

**ML36. `direction: "radial"`, sourced at the mount.** `radial` already means "away from a source point
derived from the weapon's own geometry"; for a thrust that point is the mount, so a negative speed
drags the victim down the hook line toward the car. No new field.

**ML37. `defenceScaled: false` — every chassis is reeled identically.** Decided deliberately, and there
is a finding behind it:

`defenceFactorOf` returns `1 / ramDefence` — a raw division by a 0-100 rating. With `ramDefence: 90`
a 450 u/s pull would become 5 u/s, and authored numbers would stop being in u/s at all. Nothing has
caught this because **`true` has no production caller**: ram divides by defence itself and the slam
authors `false`, so the flag is reachable only from that file's own tests.

**Deferred, named:** if heavy chassis should ever resist pulls, the divisor needs normalising against
a baseline rating first, so `ramDefence: 50` reads as "unchanged". That is a change to the impulse
maths and belongs to the car-physics work, not to a melee spec — and it would benefit every impulse
in the game rather than one hook.

**ML38. `spin: 0`, and `uncontrolMs` is authored.** The victim is left `reeling`, the same channel a ram
uses; a yank that cost no control would read as a nudge. Spin stays 0 for v1: a head's position is a
genuine contact point and would give a real lever arm — unlike the slam, which passes the victim's own
centre and so can never spin anything — but spin scale is exactly what the car-physics rework's stage
5 is re-pitching, and a second spin source introduced mid-retune would confuse both. The lever arm is
available the day it is wanted.

**ML39. The yank does not join ram's falloff stack.** Per-victim diminishing returns exist so that
chain-ramming one car gets weaker. A hook on its own cooldown is not that, and staying out keeps this
work clear of `ram-bridge.ts`, which the car-physics session is editing.

## 9. Plumbing

**ML40. `WeaponTicks` gains `sweepDuration`**, converted from `SweepDef.durationMs` at module load like
every other duration, so the two halves of the lockstep can never round differently. `ThrustDef` adds
no tick field — both its numbers are speeds.

**ML41. The playground's tuning walker reaches the new fields** the way it reaches every other numeric
weapon field, so a melee row is tunable live in the sandbox.

**ML42. Config guards worth writing.**

- `sweep` and `thrust` are mutually exclusive
- a `head` hitbox only with a `thrust`, and a `thrust` only with a `head` — neither means anything alone
- `thrust` requires `attached: true` (it is bolted to the bumper) and `returnSpeed > 0`
- a `thrust` row authors `pierce` explicitly rather than leaving it absent — "runs to max range through
  everyone" is a real authoring choice and should be a stated one, not a default nobody picked
- `sweep` requires `arcDeg` in (0, 360], `arms >= 1`, `durationMs > 0`, and an even `arms` for `close`
- `pierce` is never authored on a maneuver row
- every `mounts` entry is a valid `Mount`; the list is non-empty when present

## 10. What the client draws

**ML43. Arms and heads are drawn as their hitboxes**, like everything else: a blade is its `rect` at its
current angle, a head is its shape at `extent`. Both follow from data the client already receives.

**ML44. The thrust's rod is drawn and does not hurt — a deliberate exception.** This game's rule is
that a shot is drawn *as* its hitbox: what you see is what can hurt you. A spring or chain between the
car and the head breaks that on purpose, because a head floating unattached would read worse. It must
look like a spring, a chain or a cable — never like a blade — so nothing about it suggests a hitbox.
This is the one place in the spec where a rule is knowingly bent, and it is recorded here rather than
discovered in a renderer.

**ML45. Melee weapons need `WEAPON_FX` entries** like every other weapon, authored when the rows are.

## 11. The bot

**ML46. The bot must understand melee before a melee weapon reaches a chassis it drives.** Its reach
model and hit-probability solution branch on weapon kind. An unaware bot either never presses a melee
weapon or presses it at range where it cannot connect — and from that point every balance number
measures a bot that cannot use the weapon. The harness already carries this scar: reports predating
2026-09-04 understate Bastion because the bot could not press `wildcharge`.

**ML47. The minimum is a reach model**: treat a melee weapon as a very short-range attached beam, so
the bot closes before pressing. Situation play does not change.

**ML48. `BOT_BRAIN_VERSION` is bumped** when that lands, so balance reports cannot be silently compared
across it.

## 12. Blast radius and obligations

**ML49. Playtest probes.** The mount fix moves where `pepperbox`'s side fans start — the one shipped
behaviour this spec changes — and that is measured by the weapon-reach probes. The rename also
breaks compilation in `playtest/geometry.ts` and `playtest/weapons.ts`, which import `muzzleOffset`.
A probe that does not compile measures nothing, so those are fixed on the spot; every threshold or
verdict the change invalidates is **reported, not silently retuned**, and a `npm run playtest` run is
recommended to the user rather than performed for them.

**ML50. Balance.** One shipped behaviour moves — where `pepperbox`'s two side fans begin — and the
`BOT_BRAIN_VERSION` bump in ML48 lands alongside it, so reports across this change are not
comparable. That is a smaller surface than it first looked: `lance: 6` is unlimited at
`MAX_PLAYERS` 6, so no weapon's damage output changes.

**ML51. The guide.** `balanceStamp` hashes `WEAPON_TABLE` whole, so renaming `muzzles` to `mounts` and
authoring `pierce: 6` move it. `npm run build:manual` is owed in the same commit, and
`docs/combat-model.md` and `docs/config-reference.md` both describe muzzles, `origin` and pierce today.

`docs/turn-tuning.md` is **not** affected: nothing here touches a drive knob, a status `turnRate`, or
`RAM_CONFIG.spinMaxRate`.

**ML52. No roster rows ship with this spec.** The mechanism lands first, with example rows exercised by
tests only. Authoring the blade, spring, pincer and hook as real weapons — their numbers, their
colours, their icons and which chassis carry them — is a balance pass that follows, and it is where
the `weapon-forger` skill applies.

## 13. Relationship to the car-physics rework

Deliberately small. Melee resolves in `runCombat`, after driving, in a different pass from
`contact.ts` and `ram-bridge.ts`. Mounts derive from the hull, so a hull change moves them for free.
The one shared seam is `applyImpulse`, which is explicitly built to be shared — ram derives its push
from the contest, a weapon reads fixed numbers off its row, and only *how a push lands* is common.

Two merge touchpoints: `WEAPON_TABLE.wildcharge.impulse.speed` (stage 5 re-pitches it; this spec adds
rows to the same file) and nothing in `ram-bridge.ts`, by the deliberate choice in ML39.

**Melee's balance numbers — reach, swing duration, yank strength — should be tuned after the drive
changes settle**, since how far a yanked car slides is a function of coasting and grip. The structure
does not depend on that work; the numbers do.

## 14. Non-goals

- **The tether drag.** A hook that positionally hauls its victim home, rather than yanking it with an
  impulse, overrides the victim's movement and needs a networked field so their own client can
  predict it. That is a drive-model change and requires its own decision. The `ImpulseDef` seam is
  shaped so it can be added later without breaking a hook row.
- **A grab or clamp.** Arms that hold a car in place were considered for the pincer and rejected for
  the same reason.
- **Normalising `defenceScaled`** (ML37) — named, deferred, and owned by the car-physics work.
- **Mount angle offsets** (ML7) — a widening, if something ever needs one.
