# Combat model

Everything that removes HP, and the rules that decide who it comes off. Balance numbers live in
`@motor-combat-moba/shared` config (`WEAPON_TABLE`, `COMBAT_CONFIG`, `CAR_TABLE`) — the tables below name
the knobs, not copies of them. See [`config-reference.md`](config-reference.md) for the values.

## Where combat runs

`runCombat` in `packages/shared/src/sim/combat.ts` is the whole step, pure and over plain objects.
The server calls it once per tick from `rooms/tick-pipeline.ts`'s `combatTick` (called by `runPipeline`,
shared by `ArenaRoom` and the dev-only `PlaygroundRoom`), **after** `serverTick` has driven and
resolved every car, so hit tests read the poses cars actually ended the tick at.
`packages/server/src/sim/combat-bridge.ts` is the only file that knows about the Colyseus schema; it
maps `ArenaState` onto the POJOs and writes the answer back. No rules live there.

Combat is **server-only**. The client draws `state.weapons` and never predicts a shot or an HP
change: a mispredicted bullet is a phantom kill, and there is no honest way to reconcile "you were
dead for 80 ms". Prediction covers the local car's motion and nothing else.

## Ramming

**A ram is a one-way rule, not a contest.** Ported from Unity's `RamRules.cs` by the 2026-09-18
physics port (spec §7), replacing two earlier models in turn: an equal-and-opposite reaction
(`reactionOf` negating and mass-scaling a copy of the victim's `Impulse` back onto the attacker,
superseded 2026-09-06) and, after that, a two-sided contest where each car computed its own push and
its own received impact independently (`pushOf`/`impactOn`, a graded 0-1 severity, a three-row face
bonus table, `mass` replaced by `ramAttack`/`ramDefence`). Neither survives. `mass` itself was
already gone from the game before this port (stage 3 of the 2026-09-06 rework) and stays gone; the
`ramAttack`/`ramDefence` pair it left behind is the one this section still reads.

Nose-first above `RAM_CONFIG.minRamSpeed`: the attacker **stops dead** and is locked (`ramLock`); the
victim is set to its pre-collision velocity **plus a shove**, spun, and left `reeling`. A head-on
stops and locks both cars and reels neither — see the classification rule below, `sim/ram.ts` for
where it classifies, and `packages/server/src/sim/ram-bridge.ts` for where it writes the result.
There is no `pushOf`, no `impactOn`, and no `reactionOf` anywhere in the codebase; the attacker's
outcome is a rule ("you stop"), not a computed push.

The current authority for the model below is
[`superpowers/plans/2026-09-18-unity-physics-port/EXECUTION.md`](superpowers/plans/2026-09-18-unity-physics-port/EXECUTION.md)
and the spec beside it,
[`superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`](superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md#7-the-ram-model).
The decision record at the end of this section
([`superpowers/specs/2026-08-29-ram-cc-and-knockback-design.md`](superpowers/specs/2026-08-29-ram-cc-and-knockback-design.md),
R1-R20) still carries the rulings from the two earlier models where they explain a number that
survived into this one — the `ramAttack`/`ramDefence` pair, and the side bonus that lets a flank or
rear ram pay more than a head-on.

Ram is a separate pass, not part of `combatTick`: `rooms/tick-pipeline.ts`'s `runPipeline` runs
`statusTick` → `serverTick` (drive + collision resolution) → `contactTick`
(`packages/server/src/sim/ram-bridge.ts`) → `combatTick`. `contactTick` maps `ArenaState` onto plain
`RamCar`s and calls `applyRams`, the pure step in `packages/shared/src/sim/ram.ts` — no schema, no
room. Running between the two means ram detection reads the poses driving actually produced this
tick, and the impulse it writes is what `stepDrive` reads on the next one. Ram is server-only, like
combat, and the client never computes an authoritative outcome — it does run its own local contact
check against remote hulls to fire a camera shake and impact spark immediately, but that is
render-only and feeds nothing back into `stepSim`, the schema, or the server.

**This tick order is not incidental.** `serverTick`'s own drive-and-collide pass (`resolveWorld`) runs
first every tick, including the tick a ram happens on — see "Wall and car deflection" below — so a
ram's classification and its shove are built from whatever that pass already resolved, not from a
raw pre-collision state. At `DRIVE_CONFIG.restitution: 0` that earlier pass never adds or removes
speed of its own (see below), so there is no second, bounced layer for a ram's own shove to land on
top of any more — the two-layer measurement `RAM_CONFIG.knockMaxSpeed`'s doc comment used to carry is
gone along with that knob (deleted, spec §7.4; the hull-derived `inertiaRadiusSquared()` is its
un-related successor for the spin term, not for this). `packages/server/src/sim/pipeline-order.test.ts`
still pins the composed tick order, since a ram's inputs (the pre-collision `approachVelocities`
cache) are still captured before `resolveWorld` can touch them.

**A ram deals zero hp.** `applyRams` never calls `applyDamage`. The whole feature is contact turned
into control loss and knockback — never damage between cars, and that stays true as of the
2026-09-11 arena-sprite-and-spike-hazard work: wall spikes are now a damage source (see
[Environmental hazards](#environmental-hazards-wall-spikes) below), but they are level geometry, not
a car, so "cars never damage each other by contact" is unweakened. Weapons remain the only source
that scales with the `attack` rating, so `attack` keeps meaning exactly what its name says: ramming
sets up the kill, weapons land it.

### Wall and car deflection, and `ramDefence`-weighted separation

Two collision behaviours, both inside `resolveWorld` (`packages/shared/src/sim/collide.ts`) — neither
is "ramming" in the control-loss sense below, but both change what a contact feels like before a ram
is ever classified:

- **Walls and other cars deflect instead of merely damping, and since the 2026-09-18 Unity physics
  port's stage 2, they no longer bounce at all.** `applyContact` reflects a car's WHOLE velocity
  vector off the surface it struck and scales the result by `DRIVE_CONFIG.restitution` — 0.35
  originally, cut to 0.15 by the 2026-09-06 car-physics rework's stage 2, and **0 since the Unity
  port**, matching Unity's own zero-friction, zero-bounce car material — rather than discarding the
  lateral component and rebuilding a purely-forward speed the old pre-rework model did. A car that
  glances a wall at an angle comes away travelling ALONG the wall with real lateral motion, not
  stopped facing into it; at 0 a dead-on hit does not rebound at all, because cars are not billiard
  balls, and the reflection formula is now idempotent — a relaxation pass than runs the same contact
  again removes what is left of the into-surface velocity and finds nothing more to bounce, so it can
  no longer compound a rebound the way a nonzero restitution could. See `collide.test.ts`'s "contact
  reflection preserves direction" block.
- **Car-vs-car separation splits by `ramDefence` instead of always giving the whole correction to the
  body being resolved, unchanged by the Unity port.** `StepContext.selfRamDefence` (`ramDefenceOf(carId)`) and
  `CarObstacle.ramDefence` (carried alongside every other car's hull in `StepContext.others`) let
  `resolveWorld` compute `shareOf(selfRamDefence, otherRamDefence) = otherRamDefence /
  (selfRamDefence + otherRamDefence)` per contact: the less solid car moves further out of an overlap
  than the more solid one, converging over several ticks of mutual resolution rather than in one.
  A wall or obstacle still takes the whole correction — solidity has no meaning for something that
  cannot move. This half is untouched by the Unity port: it is ordinary overlap resolution, not part
  of the ram rule below, and it still runs on every contact whether or not that contact ever
  qualifies as a ram.

Both apply to every contact, not only a ram — they run inside ordinary driving, before `contactTick`
ever asks whether the contact was hard enough to be a ram at all.

Contact is **edge-triggered**: a knock fires only on the tick a pair of car hulls *enters* contact.
A pair still touching on the following tick is skipped, and a pair no longer touching is dropped
from the tracked set. Holding the throttle into a victim therefore lands one knock, not a
stun-lock — to ram the same car again you must separate and re-approach.

### Classification

Ported from Unity's `RamRules.cs` (spec §7.1). For each car in a fresh contact:

- **Region** — which face the contact point lies nearest, in that car's OWN frame, with a corner band
  where a front or rear face meets a side: `front`, `frontCorner`, `side`, `rearCorner`, `rear`. Band
  width is `RAM_CONFIG.cornerBandUnits` (4 u).
- **Drive-in speed** — `max(0, dot(preCollisionVelocity, flatForward))`, from the same
  `approachVelocities` cache the old model used: still captured before `resolveWorld` can touch it,
  never defaulted.
- **May it attack** — not `ramBlocked` (a reeling victim or a car still inside its own attacker lock
  can never attack, see below).

A car **qualifies as an attacker** when it may attack, its own struck region is `front` or
`frontCorner`, and its drive-in speed is at least `RAM_CONFIG.minRamSpeed` (39 u/s) — nose-first, or
no ram at all. **This is a real change of rule, not a retune.** Every earlier model — both the
2026-09-06 rework's `pushOf`/`impactOn` contest and the equal-and-opposite reaction before it — made
the attacker whoever drove in harder, with ANY struck face; a flank-first slide into someone used to
be a real, gradeable ram. Under this rule it is a plain bump — no `RamResolution` at all.

The **type** follows from the victim's region and the angle between the two cars' headings
(`RAM_CONFIG.headOnAngleDeg`, 45°): a front hit within the angle is `headOn`, a rear hit within it is
`rear`, everything else is `flank`. When both cars qualify as attackers, any head-on classification
makes it a head-on for both; otherwise the faster car attacks; an exact tie is a head-on.

### What a ram writes

**Flank and rear:**

| Car | Effect |
|---|---|
| Attacker | Velocity set to **zero**. `ramLock` for `RAM_CONFIG.attackerLockMs` (500 ms). Spin unchanged |
| Victim | Velocity set to **pre-collision velocity + shove**. Spin set to **pre-collision spin + spinDelta**. `reeling` for `RAM_CONFIG.ramUncontrolMs` (1000 ms), falloff-scaled. Shove credit recorded for the spikes |

```
shove     = attackerFlatForward * attackerDriveIn * typeScale * globalScale
            * ramAttackOf(attacker) / (ramDefenceOf(victim) * victimDefenceMult)
spinDelta = spinScale * cross(contactPoint - victimCentre, shove) / inertiaRadiusSquared
inertiaRadiusSquared = (DRIVE_CONFIG.carWidth² + DRIVE_CONFIG.carHeight²) / 12
```

`victimDefenceMult` is the victim's `ramDefence` status multiplier (`Modifiers.ramDefence`, 1 for a
car in no status). `typeScale` is `RAM_CONFIG.headOnScale` (0.2) / `flankScale` (1.5) / `rearScale`
(1.2) — flank is the roster's hardest hit, rear next, head-on gentlest, so getting behind someone
still pays and ramming head-on is still deliberately the weak play. `globalScale` (0.6) is the single
calibration knob reconciling Unity's 1-vs-1 `strength`/`resistance` scale with this roster's
`ramAttack`/`ramDefence` (45-70 and 30-90). Spin is clamped to `RAM_CONFIG.spinMaxRate` (6.0 rad/s),
as it always was — Unity has no such clamp and does not need one at its own scale; here it stays a
playability guard.

**Head-on:** each car's velocity is set to the shove the OTHER car's heading, speed and `ramAttack`
produce against its OWN `ramDefence`, at `headOnScale`. Both are locked (`ramLock`). **Neither spins
and neither reels** — Unity applies no Reeling on a head-on, and that is kept: a head-on is a mutual
stop, not a mutual delete. Each car records the OTHER as its shover for the spike credit window,
since each was put where it ends up by the other.

**A ram deals no damage**, as it always has — see "A ram deals zero hp" above. Unity's own
`flankDamage`/`rearDamage` fields are 0 there and are not ported at all, so "cars never damage each
other by contact" needs no separate guard for this model.

`sim/ram.ts` classifies and computes; `packages/server/src/sim/ram-bridge.ts` writes the result —
there is no `pushOf`, `impactOn`, `RamHit.attackerImpulse` or `reactionOf` anywhere in the codebase
any more. **There is no reflection left to throw anyone backwards, and the rammer's stop is
authored**: the old contest's headline finding — an attacker landing a hard flank ended up thrown
backwards faster than its own top speed — cannot recur, because the attacker's outcome is no longer
computed from a reflected velocity at all. It is simply set to zero.

### Diminishing returns

Unchanged in mechanism from the earlier models: per victim, across attackers, a rolling
`RAM_CONFIG.drWindowMs` (2000 ms) window. `impulseScale` now multiplies the **shove magnitude and the
spin** (not a separate `Impulse.speed`, since a ram no longer builds one); `durationScale` scales the
reel, with the same floors (`durationDrFloorMs`/`impulseDrFloor`) as before. A head-on counts as a ram
against EACH car and scales each car's own shove by that car's OWN stack. Slams neither read nor
write the falloff stack, as before.

### What the ram path no longer does

`resolveRam`'s contest — `pushOf`, `impactOn`, the three-row face bonus table, `RAM_CONFIG
.defencePushScale`, `minApproachSpeed` — is deleted, as is `RamHit.attackerImpulse`: the attacker's
outcome is a rule ("you stop"), not a computed push. `Impulse` (`packages/shared/src/sim/impulse.ts`)
and `applyImpulse` survive, but **for slams only** — a ram now writes velocities directly in
`ram-bridge.ts`, where Unity's "set, don't add" semantics can be expressed honestly instead of forced
through a push-and-apply seam built for a contest. `RAM_CONFIG.inertiaCoefficient` and the inert
`knockMaxSpeed` are both gone, replaced by the hull-derived `inertiaRadiusSquared()` above, so the
inertia term cannot drift from the hull it describes.

The pair loop's return type changed with it: `applyRams` and `resolveContacts` stop returning
per-victim `Impulse` entries for a ram and return a `RamResolution` instead — `{ attackerId,
victimId, type, shove: Vec2, spin, headOn }` — which is what lets the bridge write "set to
pre-collision velocity plus shove" rather than accumulating a push onto an existing one.
`resolveContacts` keeps its dash and slam arms unchanged: a `ContactHit` for a dash, a `SlamEvent`
for a charge, both still carrying the OBB contact geometry the bridge cannot recompute (see
"Maneuvers and the contact pass" below) — a car in either maneuver therefore never reaches the ram
arm at all, which is why `ramLock` can never strand a dashing or charging car.

### Ram control-loss

**`reeling` is a total loss of control, not a steering debuff.** `STATUS_TABLE.reeling`:
`modifiers: { grip: 0.6 }`, `flags: ["immobilised", "steeringLocked", "spinFree", "ramBlocked"]`,
`reapply: "ignore"`. It used to be `turnRate: 0.4, accel: 0.4` — a car that handled badly. It is now a
car with no inputs at all: `immobilised` and `steeringLocked` kill throttle and steering outright,
`spinFree` lets the spin the ram injected keep running instead of being overwritten by steering every
tick, `ramBlocked` stops a reeling car from qualifying as a ram attacker, and `grip: 0.6` (0.6 of
`DRIVE_CONFIG.lateralGripRate`'s 3.0/s, so 1.8/s — a roughly 2.2-car-length ride) slows how fast the
shove it just took scrubs off, so it rides further than a driver would slide. You can still shoot,
which is what keeps a ram a setup rather than a delete. `reapply: "ignore"` is FORCED by the
flag-carrying rule (a flag-carrying debuff may never chain) and costs exactly one behaviour: **a
re-ram landing while a reel is still running no longer extends it** — falloff still scales the shove,
the spin, and the duration of a ram landing AFTER a reel has lapsed.

**`ramLock` sits beside it — the attacker's own cost for landing a ram.** `STATUS_TABLE.ramLock`:
`modifiers: {}`, `flags: ["immobilised", "steeringLocked", "ramBlocked"]`, `reapply: "ignore"`, for
`RAM_CONFIG.attackerLockMs` (500 ms, deliberately shorter than the victim's `reeling` — the attacker
chose to stop, the victim did not, and a lock as long as the victim's own reel would let a chain of
attackers each get away before their target recovers). Deliberately WITHOUT `spinFree` and with grip
untouched: a rammer stops, it does not slide — exact for a flank or rear attacker, whose own side
carries a zero shove. On a head-on both cars ARE given a small non-zero shove (each along the OTHER's
heading, at `headOnScale`), and they slide it off at full grip, because this row leaves that channel
alone. Both cars take `ramLock` on a head-on.

**A hard slam has its own control loss, untouched by any of the above.** `wildcharge`'s own
`applies` entry (`{ statusId: "reeling", durationMs: 1400 }`, longer than a full-strength ram's
1000 ms) becomes `reeling` on the slam's victim through `contactTick`'s `events.slams` loop,
unscaled — falloff is ram-only, so an ult is never quietly discounted by how many ordinary rams its
victim has just absorbed, and a slam is never counted into the stack a later ram reads.

See [`schema-reference.md`](schema-reference.md#playerstate) for the networked fields and
[`config-reference.md`](config-reference.md#ram_config) for the tuning. `RAM_CONFIG` used to carry
five knobs for a revived `authority` field and a knock-velocity decay (`authorityFloor`,
`authorityHalfLifeSeconds`, `authorityEpsilon`, `shoveHalfLifeSeconds`, `shoveEpsilon`) — deleted
outright in the 2026-09-06 car-physics rework's stage 3b, before this port, once `reeling` and the
flat-rate `DRIVE_CONFIG.impactGripDecel` took over their jobs. **`impactGripDecel` is gone too, as of
this Unity port:** there is one grip model for the whole car now — `DRIVE_CONFIG.lateralGripRate`
resolved to `ChassisDrive.gripPerTick` and scaled per car by the `grip` status channel — so an
imposed shove bleeds off through the same lateral grip an ordinary drift does, at whatever rate
`reeling`'s own `grip: 0.6` sets. `SLAM_CONFIG.victimAuthority`/`selfKeepFactor` were the slam side of
that same story and the 2026-09-06 rework's stage 4 deleted them too, along with `knockSpeed`, the
two wall-stun knobs, `reslamImmunityMs` and the whole `SLAM_TICKS` export — every slam number now
lives on `WEAPON_TABLE.wildcharge.impulse`, and the config that used to be `SLAM_CONFIG` (renamed
`IMPULSE_CONFIG` on 2026-09-19, since neither member turned out to be slam-specific) holds
`wallContactPad` and `spinScale`.

**Teammates are fully immune.** A ram never classifies between teammates — the same `canDamage`
predicate used below for shots gates it, so contact and weapons can never disagree about who is on
your side. Teammates still collide and shove each other through ordinary resolution; a friendly hit
simply produces no spin and no added velocity.

See [`superpowers/specs/2026-08-29-ram-cc-and-knockback-design.md`](superpowers/specs/2026-08-29-ram-cc-and-knockback-design.md)
for the earlier models' full decision record (R1–R20) and
[`superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`](superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md#7-the-ram-model)
for this one (U19–U39).

## Maneuvers and the contact pass

A `kind: "maneuver"` weapon (spec S3) moves the car itself instead of spawning an instance. It rides
the same fire state machine as any other weapon — stocks, cooldown, recovery — but `runCombat`
routes its order to `startManeuver` rather than `spawnInstances`, and the effect plays out through
four networked `PlayerState` fields (`maneuver`, `maneuverTicksLeft`, `maneuverAngle`,
`maneuverSpeed` — see [`schema-reference.md`](schema-reference.md#playerstate)) and `sim/maneuver.ts`'s
`ManeuverKind`, not through `state.weapons`. There are three kinds:

- **Dash** — a scripted translation at a locked angle and speed (the lock target's bearing with no
  lead, since the car itself arrives rather than a shot), face welded for its duration, handed back
  rolling at the chassis's speed cap so it doesn't read as a stall. Landing on an opponent it may
  damage is a `dashHit`, priced in `runCombat` exactly like a shot (attacker's `attack`/`damageDealt`,
  target's `damageTaken`, the weapon's own `applies`); landing on a wall instead ends the dash
  stopped, not at cap.
- **Hold** — speed pinned to zero, steering only, from the press until the attached
  `holdsDuringFire` beam it powers dies (O10) — committed the instant the beam's wind-up begins, the
  intended mechanism for `lance`-style weapons that root the car while they fire.
- **Charge** — drives normally and only counts down, ending early on its first slam (or its own
  `durationMs`). While charging, contact with an opponent it may damage is a **hard slam** instead of
  an ordinary ram: a fixed impulse authored on the charging weapon's own row
  (`WEAPON_TABLE.wildcharge.impulse` — same knock for every attacker and victim, no `ramDefence`
  divisor, no type scale, no spin), gated off if the victim is already `stunned` and the charger's
  weapon doesn't set `slamsStunned` (O3/O18), or if the victim is still inside that row's
  `retriggerImmunityMs` of a previous slam. A landed slam leaves its victim `reeling`, off the row's
  own `applies` list (`{ statusId: "reeling", durationMs: 1400 }` for `wildcharge`) — a 2026-09-19
  restructure of what used to be a bare `uncontrolMs: number` with the status id `"reeling"` supplied
  in code — unscaled by the ram falloff stack, since falloff is ram-only. It also ends the attacker's
  charge and expires the attacker's own self-applied statuses (`expireStatusesFromSource`) — a window
  that closed early cannot leave its buff running past it. The attacker takes **nothing** from its own
  slam: it is authored, not a rule with an "other side" to derive a cost from, so its post-slam
  velocity is entirely whatever
  `resolveWorld`'s restitution already reflected off it that same tick — which at `restitution: 0` is
  nothing at all — and there is no hand-restored fraction of pre-impact speed (`SLAM_CONFIG
  .selfKeepFactor`, deleted in stage 4). A victim shoved into a wall within the row's own
  `onWallImpact.windowMs` of the slam has that entry's `applies` land too (`wildcharge` stuns for
  `durationMs: 500`) (O2).

`sim/contact.ts`'s `resolveContacts` is where the classification lives: it extends `applyRams`'s pair
loop — checking each car for a dash, then a charge/slam, and only falling through to an ordinary ram
when neither side produced one — and runs in the same slot `ramTick` used to, between drive and
combat. **It builds no impulse for a dash or a slam**, only for the ram fallback; a slam emits a
`SlamEvent` carrying the OBB contact normal and contact point, which is the geometry only that pass
can compute. The server-side half is `packages/server/src/sim/ram-bridge.ts`'s `contactTick`, which
assembles the slam's `Impulse` from the weapon row and applies it beside the statuses that same slam
applies (spec P30), tracks each slam's wall-stun window and re-slam immunity in room memory, and
turns a landed wall-stun into a `StatusRequest`.

One consequence of taking the slam off the contact pass's per-victim impulse map is deliberate: a car
slammed by A **and** rammed by B on the same tick now takes **both** pushes. It used to take only
whichever won the single slot, on a magnitude ordering nothing enforced. Within a pair nothing
changed — a pair that resolves as a slam still produces no ram.

**Slam plus slam does not stack, though: a car takes at most ONE slam push per tick, and the last
slam of the tick is the one that lands.** Two chargers reaching the same victim on the same tick
punt it once, at the authored magnitude, and leave one `reeling`. That is a physics cap, not a damage
cap — both slams are still handed to combat to price, both attackers' charges still end, and the
wall-stun and re-slam clocks are still stamped by the later of the two. The cap used to fall out of
the per-victim impulse map for free; `contactTick` states it explicitly now that slams no longer ride
that map.

**A slam's push is applied before a dash ends, which is what lets a dash erase it.** A dashing car
that meets a charging one is both the dash's attacker and the slam's victim on that tick, and ending
a dash overwrites velocity outright — so the dasher exits at its dash speed and the slam's punt is
gone, while the `reeling` it applied stays. That has been true since the mechanic shipped; stage 4
preserved the ordering deliberately rather than change the thunderclap-vs-wildcharge clash inside a
refactor.

**Stun interruption (O8/O14).** A `stunned` status that lands fresh this tick — not one already
running — cancels the car's committed states at the end of that same tick: a pending wind-up (its
stock stays spent, O14), a running maneuver, and any attached instance the car owns; a detached shot
or a projectile already in flight persists, since a shot already committed to the world does not
un-commit because its owner got stunned. `WeaponDef.isUnInterruptable` exempts a weapon's wind-up or
maneuver from the sweep, row by row; no shipped row opts in yet.

**No longer dormant, as of the 2026-09-01 weapon-status overhaul (Plan 3).** Mirage's `thunderclap`
(dash) and Bastion's `wildcharge` (charge) are real `kind: "maneuver"` rows, so every path above is
now reachable from a shot fired from a real car in a real match, not only from synthetic
`ManeuverWeaponDef`s and hand-set fields in unit tests. `wildcharge` is also the roster's one
`isUnInterruptable: true` row — the exemption the previous paragraph describes.

## `sim/damage.ts` is the only place hp moves

```ts
applyDamage(hp, amount) // max(0, hp - amount); a non-positive amount changes nothing
```

Every damage source routes through it, so a later shield or damage cap is one edit. `hp === 0` sets
`alive = false`. **There is no wreck**: the car leaves the field on that tick — see Elimination below.

Two functions beside it complete the set, both added by the status system:

```ts
applyHeal(hp, amount, maxHp)   // min(maxHp, hp + amount); refuses to lift a wreck off 0
scaleDamage(amount, multiplier) // a hit seen through damageDealt or damageTaken, rounded
```

`applyDamage` is therefore no longer the *only* writer of hp — **this file is**, and these are the
whole set. That is a deliberate weakening of the original rule, and it keeps what the rule was
protecting: one file to read when asking what can move a car's hp. `scaleDamage` rounds to a whole
number exactly as `damageFor` does, so `applyDamage` still always subtracts an integer from a
`uint16`.

## Environmental hazards: wall spikes

`arena-01`'s fourteen `kind: "spike"` obstacles, added by the 2026-09-11 arena-sprite-and-spike-hazard
work, are the game's **first environmental damage source** — everything above this section, and
everything in Ramming above, still holds: a spike is level geometry, not a car, so cars still never
damage each other by contact.

**Three stages, split because the credited attacker cannot be known where the contact is detected:**

1. **`resolveContacts` (shared, `sim/contact.ts`) detects and reports, with no threshold and no
   memory.** For every car overlapping a spike obstacle it reports one `SpikeContact` — a corner of
   the octagon can overlap two strips at once, but that is still one report — carrying the surface's
   inward normal and the car's speed **into** it, sampled before that tick's bounce is resolved.
2. **`ram-bridge.ts` (server) turns raw contacts into `SpikeHit`s and attaches the source.** It is
   the only place holding the trigger lockout and the per-victim last-shover memory, both server-side
   only (see below), so it is the only place that can gate and attribute a hit.
3. **`runCombat` (shared, `sim/combat.ts`) prices and applies them**, alongside burn and repair pulses
   and ahead of weapon fire, through `recordDamage` — the same wrapper over the same hp writer every
   other source uses, so a car spikes kill this tick is already dead for its own weapons this tick
   too, and the hit emits the `damaged`/`killed` events with a `{ kind: "hazard", hazardId: "spike" }`
   `DamageSource`. That tag is why B4 ("every path into `dealDamageTo` has a tag") still holds with an
   environmental source in the game, and it is what lets a balance run count a spike kill at all. No
   weapon can be attributed to it, so it appears in the report's kill pace and per-car damage but in
   no per-weapon row.

**The trigger is a push, not contact.** Because the boundary stops a car at the notch face, "touching
spikes" is a state a car can hold forever — someone who drove in and stopped is still touching them.
Damage only fires when the car's speed into the surface exceeds `SPIKE_CONFIG.triggerSpeed`: a car
resting against spikes takes nothing, and driving into them, scraping along them or reversing into
them is what gets billed.

**A self-driven car pays once, on arrival; sustained payment is what being shoved and held
produces.** This is measured, not inferred: with `DRIVE_CONFIG.restitution` at 0.15, a car holding
throttle into a wall settles at a steady-state pre-collision inward speed of roughly 5 u/s, far below
`triggerSpeed`'s 25. Re-measured at `DRIVE_CONFIG.restitution` 0 (stage 2 of the Unity physics port,
2026-09-18) against `stepDrive`/`resolveWorld` from built shared: the steady-state pre-collision
inward speed is per-chassis rather than one round figure — mirage 7.92 u/s, bullseye 5.41 u/s,
bastion 3.97 u/s — and every one of them is still far below `triggerSpeed`, so the claim holds
unchanged. So the arrival hit lands and then nothing more does, however long the player
leans on the throttle. It takes an EXTERNAL push — a ram or a slam driving the car back into the
strip above the trigger speed, repeatedly — to collect a second hit and a third, which is also why the
attribution rule below credits the shover. Whether `triggerSpeed` should be lower so that grinding
along a wall costs a self-driven car something is an open tuning question, not a statement about
today's behaviour.

A `SPIKE_CONFIG.retriggerMs` lockout after
each hit stops a pinned car from being billed thirty times a second. Neither piece of that state is
schema — it rides alongside the ram-falloff `ContactMemory` in `packages/server/src/sim/`, the same
call that stack already made, and it is not an invariant-8 violation: `stepSim` never reads it, and
what crosses the wire is the already-applied HP.

**Attribution: the shover, or yourself.** A per-victim last-shover memory, fed by every ram and every
slam (`ram-bridge.ts`'s existing per-victim attacker tracking — any push counts, the mechanic is "you
put them there" rather than "you rammed them"), names the source if the shove landed within
`SPIKE_CONFIG.shoverCreditMs`. Past that window, or if nobody ever shoved this car, the source is the
**victim's own session id**. That is not a bug fix on top of an empty id — an empty source would
leave `lastDamagerSessionId` untouched, so a car shot once early in the match and killed by spikes
minutes later would wrongly still credit that early shooter. Naming the victim instead means the
existing kill-booking line (`if (killer && killer !== player)`, see
[Kill attribution](#kill-attribution) below) records the death without moving a kill counter, and the
banner reads it as self-inflicted, exactly as an environment death should.

**Two interactions, settled explicitly rather than left to fall out of other rules:**

- **Not amplified by `corroded` or any other multiplier.** A spike hit is recorded without going
  through `scaleDamage`, unlike every weapon hit above — environmental damage is flat and predictable
  on purpose.
- **A `phased` car takes none, and this needed its own check.** It does not fall out of the
  `isOnField`/`isSolid` split: `isSolid` only gates the car-car lists, while `stepSim` still runs a
  phased car through `ctx.obstacles` and `ctx.bounds` unconditionally — it has to, or spawn
  protection would let a respawned car drive out of the arena. Without an explicit `phased` skip in
  the hazard pass, the walls would hurt exactly the car `phased` exists to protect.

## Weapon

Every car carries an ordered list of weapons, `CAR_TABLE[car].weapons` — index 0 is slot 1, and
order *is* the slot mapping, so a chassis's whole identity (speed, attack, hp, guns) lives in one
table row. `WEAPON_SLOT_CONFIG.maxAbilitySlots` (3) caps how many slots any chassis may present; a
car listing more logs one `console.warn` naming the car and truncates the extras, never a thrown
error or a failed test. Today's roster ships three exclusive kits, one per chassis, redistributed on
2026-08-30 and then re-authored outright by the 2026-09-01 weapon-status overhaul so each kit serves
its chassis's **type**:

| Chassis | Type | Slot 1 | Slot 2 | Slot 3 |
|---|---|---|---|---|
| **Bullseye** | moderate damage, long range | `predator` | `pepperbox` | `lance` |
| **Mirage** | burst damage, high mobility | `magmablast` | `thunderclap` | `afterburner` |
| **Bastion** | crowd control, slow and tanky | `thumper` | `roadblock` | `wildcharge` |

`fireball`, `needler`, `skewer` and `bulwark` were retired outright by the 2026-09-01 overhaul; their
ids are gone from `WeaponId` and their comment history lives in git rather than here. `shockwave`
survived that overhaul as an id but not as the weapon it named — it lost its aura identity for a
plain single-volley dart on Bullseye's slot 1 (see [Auras](#auras) below) — before being renamed
again to `magmablast`, its current id, alongside its display name. The 2026-09-02 predator/magmablast
pass moved it a second time, swapping it onto **Mirage's** slot 1 in exchange for `predator` (which
moved to Bullseye's), and gave it an explosive-shell identity: it detonates on death into a real
`disc`-hitbox beam instance, reviving the aura mechanism the earlier rename had left dormant.
`predator` picked up a matching redesign on its way to Bullseye — it dropped its `applies` entry and
its lock-frozen homing for a proximity seeker that acquires blind.

No weapon id appears on two chassis (L1), and `weapon-slots.test.ts` enforces that — so moving a
weapon between chassis means swapping a pair, never copying one. See
[`config-reference.md`](config-reference.md) for the full table.

To add one, see [Authoring a weapon](#authoring-a-weapon) below; the sections between here and there
are the rules a weapon's stats are interpreted by.

**No shipped weapon carries a `stock` block today.** `needler`, the table's one multi-stock weapon,
was retired with the 2026-09-01 overhaul; the stock mechanic (`releaseShots` starting the recharge at
the first shot of a dump rather than the last) is dormant machinery, still real in `fire.ts` and
covered by `fire.test.ts`, waiting for the next weapon that authors one.

### Firing input

**One shot per press.** `fireSlots` is raw key state on the wire, so a held trigger sets the same
bit on every input. `serverTick` keeps a server-only `prevFireMasks` per player and counts only a
newly-set bit as a press (`clean & ~prev`), advancing `prev` per input in sequence order so a
release and re-press inside one tick's batch is two presses rather than one held key. Holding the
trigger therefore fires exactly once; the player must release and press again. The edge is detected
on the server, not the client, because a hand-rolled client could otherwise pulse the mask and buy
back auto-fire — and the weapon cooldown still bounds the rate on top of it.

`InputMessage.fireSlots` is a **uint8 bitmask** (bit 0 = slot 1), the successor to the old single
`fire: boolean`. The server masks it to `maxAbilitySlots` bits and to the car's actual slot count
before the sim ever sees it, so a hand-rolled client cannot fire a slot it does not own. Multiple
bits set on the same tick resolve to the **lowest** slot. Each slot's key binding is client-only
(`config/slot-keys.ts`) — the server never sees a key, only an index — so rebinding a key is a local
change with no protocol consequence.

Firing still rides the same gate as movement: `serverTick` reports which session ids asked to fire
on an input it actually **simulated**, so an input past `NET_CONFIG.maxInputsPerTick` cannot buy a
shot the sim never ran, and a lobby player spamming a fire key spawns nothing.

### Shot direction: the heading, always

Every shot leaves along the firing car's **heading**, measured from the muzzle rather than the car
centre. There is no targeting aid of any kind: no lock, no snap, no assist, no lead. Where the nose
points is where the shot goes, and carrying the lead against a moving target is entirely the
player's job.

A pellet fan spreads around that heading (`pellets.spreadAngleDeg`), and a multi-muzzle row fans its
muzzles off it (`muzzles`, `pepperbox`'s four). Both are offsets from the heading, not departures
from it.

**This replaced an ambient target lock, removed on 2026-09-17.** Four rows — `predator`,
`magmablast`, `thumper` and `thunderclap` — used to carry `usesAimAssist: true` and fire at a
per-car lock maintained every tick inside a cone-and-lateral-cap region, with retention pads, a
steal margin, a commit timer, a line-of-sight raycast and a HUD bracket. All of it is gone:
`AIM_CONFIG`, `sim/weapons/lock.ts`, `PlayerState.lockTargetSessionId`, `WeaponDef.usesAimAssist`
and `WeaponDef.aimRangeUnits` no longer exist, and `docs/superpowers/specs/2026-08-27-aim-assist-target-lock-design.md`
is a historical record of a system the game no longer has.

Two consequences worth knowing, because neither is obvious from the diff:

- **`thunderclap`, Mirage's dash, no longer steers.** It used the same lock to pick its direction;
  it now travels along the heading, and its distance comes from `range` (400, the value its
  `aimRangeUnits` also carried, so the dash is exactly as long as it was).
- **`predator` still finds you, by a different mechanism.** Its `homing.acquire` is `"proximity"`:
  the shot grabs the nearest eligible car within `acquireRadius` of **itself**, in flight. That was
  always true — it never homed on the lock — so it is the one row whose behaviour the removal barely
  touched. `"lock"` was a supported `acquire` mode no shipped row used, and it went with the rest.

### One fire state machine per car

A car is in exactly one state — `idle → startUp → (fire) → recovery → idle` — tracked **once per
car**, not once per slot, so a burst from one weapon has a single, unambiguous meaning for what else
may fire while it runs. Presses are **ignored**, never queued or buffered:

- Mid wind-up or mid-volley (`pending !== null`), **every** press is ignored, including one for the
  weapon already firing.
- Mid recovery, a press for a **different slot** is ignored; the slot that just fired is gated
  only by its own stocks and `refireDelayMs` (below) — a weapon whose `cooldownMs` is shorter than
  its `recoveryMs` is refirable before any other slot unlocks.
- Driving is never blocked by firing, and firing is never blocked by driving.

A wind-up **cannot be cancelled** — the press is a commitment, and its stock is spent at press time,
not at the moment a shot actually exits. An instance is born from the car's pose **at the tick it
exits**, so steering during a wind-up (or through a multi-shot burst) is what aims the shot, and a
sequential burst sprays across whatever arc the driver turns through.

Three clocks, each with exactly one meaning:

| Stat | Question it answers |
|---|---|
| `cooldownMs` | When does this weapon get another **stock**? |
| `stock.refireDelayMs` | How soon may **this slot** fire again? |
| `recoveryMs` | How soon may a **different slot** fire? |

**"Same" means the same slot, not the same weapon id.** `beginFire` compares `lastFiredSlot` to the
slot being pressed, so a car carrying one weapon id in two slots — `["lance", "lance"]` — gets
two independent refire clocks, and the switch lock applies *between* them exactly as it would for two
different weapons. Deciding this by weapon id instead would let the second slot fire the instant the
first did, skipping `recoveryMs` entirely, since that slot's own refire lock has never been set.

`recoveryMs` is not a universal post-fire lockout — it only gates *other* slots. A weapon whose own
`cooldownMs` is shorter than its `recoveryMs` would be refirable by itself before any other slot
unlocked; no shipped weapon has that shape today (every row's `cooldownMs` exceeds its own
`recoveryMs`), but nothing in the fire state machine assumes otherwise — `beginFire` and
`releaseShots` gate the two clocks independently regardless of which one is larger.
`refireDelayMs` lives only inside `stock` (below), because for a single-stock weapon the next shot
is already gated by the recharge — any value below `cooldownMs` would do nothing and any value above
it could have been a `cooldownMs` edit, so the field is not even writable outside `stock`.

### Basic attack

Every car carries a fourth weapon that is not in `weapons` at all: `CarDef.basicAttack`, a single
`WeaponId` field sitting **beside** the three-weapon kit rather than inside it
(`basicAttackOf(carId)` is its accessor). The field takes any `WeaponId`: the slot constrains
nothing about the weapon in it, and a chassis may point it at a row another chassis carries as an
ability. The nine rows the chassis carry there today are identical, all spread from one
`BASIC_ATTACK_BASE` — 20 damage, 800 ms cooldown, 900 u/s,
960-unit range, a 12-unit circle hitbox, `#101014`. It carries no `applies`, no `impulse` and no
`explosion`: a plain, unlimited-ammo poke, not a mechanic.

`fireSlotsOf(carId)` is the kit plus the basic attack, in that order — `[...slotsOf(carId),
basicAttackOf(carId)]` — so **the basic attack is always fire slot 3**, one past the three ability
indices `slotsOf` and `weapons` still mean on their own. Its binding is `H`, and nothing else: the
three abilities hold the whole mouse hand — `J`/LMB, `K`/RMB and `L`/SPACE. It briefly owned LMB
(with the abilities on RMB/SHIFT/SPACE) and gave it up when the toggle below was switched off, since
two slots may never claim one input. Re-enabling the mechanic means deciding a mouse binding for it
again, or shipping it keyboard-only as it stands.

It fires through the **same** fire state machine described above — spent, recharged, refire-locked
and switch-locked by exactly the code every other weapon runs — and authors `recoveryMs: 0`, so
firing it never locks an ability out. The one place it loses is a same-tick tie: `beginFire` takes
the lowest set bit the car can fire, and slot 3 is the highest index, so pressing an ability and the
basic attack on one input fires the ability and drops the basic-attack press, exactly like any other
press this game has ever refused. An ability's own `recoveryMs` briefly blocks it right back, for the
same reason — `switchLockUntilTick` does not care which slot is locking which.

**It never reaches the HUD's weapon panel, and that is a decision, not the three-slot truncation
you'd get from listing a fourth entry in `weapons`.** `slotsOf`/`weapons` cap a chassis's KIT at
`WEAPON_SLOT_CONFIG.maxAbilitySlots` (3) and would silently drop and warn about a fourth entry
listed there — but the basic attack was never *in* `weapons` to be dropped. It is a separate field
that only `fireSlotsOf`'s three named readers (the sim's fire state, the balance harness's per-weapon
seeding, and `npm run ttk`) ever read alongside the kit; the HUD, the players' guide, the playground's
loadout picker and everything else that draws or lists "this chassis's weapons" keeps calling
`slotsOf` and keeps seeing three. Its binding is taught only in the countdown action hint, which is
the one place the "a binding nobody printed breaks quietly" controls rule is knowingly bent.

#### The basic-attack toggle

`BASIC_ATTACK_CONFIG.enabled` (`config/weapon-config.ts`) can turn the whole mechanic off without
touching any of the above — the nine rows, `CarDef.basicAttack` and the schema's fourth slot all
stay exactly as described. It is a build-time flag: flip it, rebuild, `npm run build:manual`.
**It ships `false` as of 2026-09-20**, so everything above this heading describes a mechanic that is
authored and wired but not currently pressable. Four
things read it when it is `false`: `beginFire` refuses a press on fire slot 3, so the key does
nothing; the bot's `chooseSlot` never selects that slot either, so it does not waste a tick's press
on a weapon that cannot fire; the client's `hintSlotOrder` drops the slot from the countdown action
hint entirely, so the `H` pill disappears rather than sitting there doing nothing; and the guide
skips every chassis's "Basic attack" card, with the flag folded into `balanceStamp` so a stale
manual build fails the suite. `fireSlotsOf` and the balance/ttk/playtest tooling do not read it —
they sweep `WEAPON_TABLE` structurally and must always be able to find a carrier for each of the
nine rows. See the `basic-attack-toggle` skill for the full flip checklist.

### Stocks

A weapon with a `stock: { max, refireDelayMs }` block holds charges instead of firing on a flat
cooldown. It holds **one** stock the moment it unlocks — never full at spawn — and a recharge timer
of `cooldownMs` runs whenever `stocks < max`, adding one stock on completion and restarting only if
still below max. At max stocks the timer is **cleared**, not merely paused: no progress is banked,
so firing from a full stock always starts a fresh `cooldownMs`, however long the weapon sat full.
Firing below max leaves an in-flight recharge running untouched. Consecutive stock shots are spaced
by `refireDelayMs`, not `cooldownMs`; firing at zero stocks does nothing. A weapon with no `stock`
block is single-stock — exactly the pre-weapon-system behaviour, so no existing weapon opts out of
anything.

### Instances: two lifecycles

Every fired shot is a **hitbox**, never hitscan. Two kinds:

- **Projectile.** Travels in a straight line at `speed` from its frozen exit pose; dies at `range`,
  on an obstacle, or outside the arena. Burst and spread are **two blocks, not one**: `volley`
  (`volleys`, `volleyIntervalMs`) lives on `WeaponBase` because a beam can burst too, and `pellets`
  (`pelletsPerVolley`, `spreadAngleDeg`) lives on the projectile because a beam has no pellets to
  fan. `pelletsPerVolley` fans evenly and symmetrically about the car's heading and spawns on the
  same tick, each its own instance with its own pierce budget; sequential `volleys` exit on their own
  ticks, each from the car's pose *at that tick*. The burst holds the car's global fire lock for its
  whole duration — no other slot may fire until the last shot lands and `recovery` elapses — and the
  slot's own recharge starts at that **last** shot, so total downtime is burst duration +
  `cooldownMs`. Being wrecked mid-burst cancels the remaining shots. A plain single shot is a
  `volley` of 1/0 and `pellets` of 1/0.
- **Beam.** Grows from the muzzle at `speed` toward `range`, then **lingers** for `lifetimeMs`
  before vanishing in one tick — it never retracts — so total life is `range ÷ speed + lifetimeMs`;
  tuning `range` never silently changes how long a beam holds. Expansion is capped by a raycast down
  the beam's **centre axis** against obstacles and the arena edge, so cover works — the
  simplification is that only the centre ray is tested, so a wide beam may overhang a wall corner
  slightly. Cars never block a beam; there is no shadowing, which is what `pierce` is for on
  projectiles instead. `attached: true` means the origin and angle follow the firing car every tick
  (a swept flamethrower or laser cutter), re-clipped against walls as the car turns; `attached: false`
  stamps the beam into the world at its fire-tick pose and it never moves again. An **attached** beam
  dies the instant its owner is wrecked — a wreck does not shoot — but a detached beam already
  stamped, and a projectile already in flight, finish their lives regardless: a shot already
  committed does not un-commit because its owner didn't survive to see it land. **A beam is no longer
  single-instance in principle:** `VolleyDef` moved onto `WeaponBase` on 2026-08-30, so a press could
  schedule several beam instances in sequence — the old `shockwave` was three aura waves 500 ms
  apart, each with its own `spawnTick`, so each died 250 ms after its *own* birth rather than all
  three ending together. That row retired with the 2026-09-01 overhaul, and no beam shipped since
  authors more than one volley, so a multi-wave beam is dormant machinery today (see
  [Auras](#auras) below). What a beam still has no use for is `PelletDef`, which stayed on
  projectiles; that is the line the old four-field `VolleyDef` was split along.

Two chassis slots ship beams today (`afterburner`, attached; `lance`, attached and holding the car
still while it fires), one ships a multi-pellet fan (`pepperbox`, four muzzles), one ships `pierce`
(`roadblock`), one ships a wind-up (`lance`), and six of the nine rows carry `recoveryMs > 0`. The
2026-09-01 overhaul retired a second beam (`bulwark`) and the roster's one multi-wave press
(`shockwave`'s old three aura waves) along with the weapons that carried them. What the tests do and
do not reach, exactly:

- **Beam growth, clamping, attached re-anchoring/re-clipping, and expiry on `flight + lifetime`** are
  all real in play now — both shipped beams grow, clip against walls, and follow their owner the way
  `weapons/instances.test.ts` describes. That suite hand-builds a synthetic `kind: "beam"` instance
  over `magmablast`'s row (600 u/s across a 900-unit range as of the 2026-09-02 detonation pass, down
  from the 900 u/s `fireball` shipped and `magmablast` originally inherited) rather than driving a
  real beam id through it, and because that
  borrowed row's `lifetimeMs` is 0, the expiry test still asserts `flight` alone: **no test exercises
  a non-zero linger**, even though both shipped beams have one (1500–2000 ms).
- **Volleys.** No longer covered by a real row. `weapons/fire.test.ts`'s "volleys and wind-up" block
  used to drive the old `shockwave`'s real 3-wave press through `beginFire`/`releaseShots` tick by
  tick; since the 2026-09-01 overhaul no shipped row authors more than one volley, so `VolleyDef` and
  `beginFire`'s kind-agnostic read of it (a beam pulls its volley count from the table rather than a
  hardcoded 1) are exercised only generically, over synthetic defs, until a multi-wave row ships again.
- **Wind-up and the two clocks.** Still genuinely covered: `weapons/fire.test.ts`'s "the two lockouts"
  block drives `lance`'s real 700 ms `startUpMs` and 1000 ms `recoveryMs` through `beginFire` and
  `releaseShots`, including the same-weapon-in-two-slots case (`["lance", "lance"]`) that used to be
  illustrated only in prose.
- **The pellet fan.** Still only partially reached: `fanOffset` itself is tested directly and
  correctly, but `spawnInstances` — the function that actually turns `pelletsPerVolley` into multiple
  live instances — is still only ever driven with a synthetic def spread from `magmablast`'s numbers
  (carrying the retired `needler`'s numeric shape) in `weapons/instances.test.ts`. No test calls
  `spawnInstances` with `pepperbox` to prove the wiring from its `pelletsPerVolley: 3` and four
  muzzles through to twelve emitted pellets.
- **Pierce.** Also only partially reached: `hits.test.ts` tests the pierce-spending mechanism by
  hand-setting `pierceLeft` on a generic instance, and `instances.test.ts`'s only assertion that
  `spawnInstances` carries a weapon's `pierce` onto `pierceLeft` uses `magmablast` (`pierce: 0`). No
  test derives `pierceLeft` from `roadblock`'s real `pierce: 4` end to end.
- **`damageFrequencyMs > 0`, the re-arming per-target clock.** **Covered as of 2026-09-04**, and by
  two carried rows rather than one: `afterburner` (500 ms) and `lance`, which the same date moved off
  a single 170-damage stamp onto `afterburner`'s cadence exactly. `combat.test.ts`'s
  "pulses lance for its whole life" drives a real press end to end through `runCombat` and counts the
  hp spent, so the re-arm and the second, third and fourth hits on one target are now asserted from
  the sim rather than from the ms/tick values `weapon-config.test.ts` and `weapon-ticks.test.ts` pin.
  `hits.test.ts` still only exercises `damageFrequencyMs: 0`'s arm-at-infinity behaviour directly.
- **Stocks.** No longer covered by a real row. `needler`, the table's one multi-stock weapon, was
  retired with the 2026-09-01 overhaul, so `combat.test.ts` no longer drives a stock mechanic through
  `runCombat` from a real chassis's loadout; the mechanism (`releaseShots`' recharge-on-first-shot
  behaviour) keeps its hand-built coverage in `fire.test.ts` alone, while no shipped row banks stocks.
- **Drawing.** `instanceDrawShape`'s beam branch runs on every screen now — either shipped beam
  reaches it in a live match. The client-side unit test in `combat-visual.test.ts` exercises that
  branch through a synthetic "claiming beam" fixture built over `magmablast`'s numbers (a circular
  projectile flagged as a beam, so the test proves the branch reads the definition rather than a
  stale row byte) rather than a real beam weapon id, so it is covered by mechanism but not by a real
  def; `beamShapeAt`'s own rect and cone geometry is covered in `weapons/shapes.test.ts` regardless.
  The client's glow-band tests (`instanceGlowBands`) are `it.skip`ped outright: `WEAPON_GLOW_STYLES`
  is empty since the overhaul retired `fireball`, its one weapon with a flicker, and moved `pepperbox`
  to an ellipse hitbox a round-glow table cannot own — the mechanism is live code with no shipped
  weapon to exercise it against until one earns bands again.

### Shaped hitboxes and the smear

Hitboxes are a nested tagged object on the weapon def — a cone cannot carry a circle's `radius`, nor
a beam a projectile's `pierce` — with one hit-test path underneath: circle-vs-OBB is exact, and
`ellipse` / `capsule` / `rect` / `cone` are converted to convex polygons at table-build time and run through the
same SAT the car hulls already use.

| Type | Shapes | Config |
|---|---|---|
| Projectile | `circle`, `ellipse`, `capsule` | `radius` / `radiusAlong` + `radiusAcross` |

A `capsule` is a slug: a semicircular nose of `radiusAcross`, and a tail cut flat across. It exists
because a shot is drawn AS its hitbox (D19), so a weapon whose icon is a flat-backed capsule cannot
be given that silhouette by the renderer alone — the shape has to be real, or what you see stops
being what can hurt you. `radiusAlong` must be at least `radiusAcross`, or the nose cap reaches
behind the tail and the polygon stops being convex; SAT does not reject a concave polygon, it
silently answers the wrong question about it, so `weapon-config.test.ts` guards the ratio.
| Beam | `rect`, `cone` | `width` / `angleDeg` |

Each tick, a projectile is tested as the convex hull of its shape at its **previous and current**
position — the "smear" — rather than sampled once at its new position. This is another convex
polygon through the same SAT, so it is nearly free. **Cars, obstacles and the arena edge are all
tested against that one hull**, which is what actually removes the old authoring rule that every
obstacle be at least 30 units thick to survive a point sample: at 900 u/s a shot covers 30 units a
tick, and it can no longer pass clean through either a car or a thin wall between ticks. It is
slightly generous at high speed, since the smear is solid and registers anywhere along that tick's
path — which is the correct bias for a shooter. A beam is
tested at its current extent with no smear: it does not move fast enough tick to tick to need one,
and re-testing its full reach every tick already covers it.

### Pierce and per-target damage clocks

`pierce` is an integer, and counts **cars only**: `0` destroys a projectile on the first car it
damages (`magmablast`'s value today), `4` damages up to five cars before dying (`roadblock`'s value,
reaching every possible opponent in a full six-player match). Teammates and wrecks
are not contacts at all — a shot passes through them freely and they consume no pierce, which falls
out of `canDamage` below. Walls, obstacles and the arena edge destroy a projectile regardless of
pierce budget — pierce is about cars, never about cover — with two authored exceptions read in the
same place (`hitsWorld`): a `bounce` row (`thumper`) is reflected by `stepInstance` instead and dies
on its own flight clock, and a `piercesWalls` row (`roadblock`) flies straight through geometry and
bounds alike and dies only at `range`. `piercesWalls` exists because roadblock's bar reaches 60u to
each side of its travel axis: without it, firing within a wingtip of a wall killed the shot on its
own spawn tick — a press that spent the cooldown and put nothing on the wire. It doubles as the
row's identity: the wall stops for nothing, so cover is no cover from it, and its stun rides through
(nothing rendered outside the bounds is ever visible, so a shot crossing the outer wall reads as
absorbed by it). Beams never spend a pierce budget — they are never destroyed by contact and may hit
several cars on the same tick.

Repeat damage is a **per-instance, per-target clock**: every live instance owns a map from
`sessionId` to the next tick it may damage that car again. There are three modes. `damageFrequencyMs: 0`
(every projectile and maneuver row) arms that clock at `Infinity` — one hit per target, ever, for
that instance's whole life. A positive value re-arms on the interval, which is what lets a lingering
beam re-tick a car still standing in it. Both carried beams do that today — `afterburner` and, since
2026-09-04, `lance` — on the same 500 ms cadence.

The third mode is **per-entry**, authored on `ExplosionDef.damageMode` rather than as a frequency.
A car that drives into a `perEntry` field pays once; a car that parks there pays the same as one
crossing; a car that leaves and returns pays again. `resolveInstanceHits` inverts the usual guard
order for this mode — shape first, then clock — because the interval and once-ever paths check the
clock first and `continue`, which never reaches the test that could learn the car is outside.
Presence in the map is the flag (the value written is `Infinity`, not a re-arm tick). Absence from
the pose snapshot is not an exit: a car that dies or goes `phased` inside the field is dropped by
`isTargetable` without failing the overlap test, and its clock entry survives so a Deathmatch
respawn cannot re-arm the field by vanishing.

**The clock is armed on first contact, not at spawn, so a ticking beam's pulse count depends on when
it reaches you.** That is most visible on `lance`: it grows over 6 ticks, so a car at the muzzle eats
four pulses and one at its 1200-unit tip eats three, the fourth falling one tick past the beam's
expiry. Range-dependent damage on a ticking beam is a consequence of this rule rather than a per-row
decision, and any future row authoring a `damageFrequencyMs` inherits it. This bookkeeping is server-only, keyed by instance id, never networked,
and is dropped the moment its instance is.

### Who may damage whom

`canDamage(ownerId, ownerTeam, targetId, targetTeam, mode)` is the **single** friendly-fire
predicate, used by every weapon instance:

- **Never yourself.** A shot is born on the shooter's own hull; without this every shot would kill
  its own shooter on the tick it was fired.
- **FFA:** anyone else. Teams are only seating.
- **Team:** enemies only. A shot passes straight through a teammate and keeps going.

A dead car is not a target: shots pass through it rather than being spent on it. It is not an
obstacle either — see Elimination.

One consequence worth knowing rather than fixing: the pose snapshot is built **once per tick**,
before any instance resolves, so a car wrecked earlier in that same tick is still a contact for
every instance resolved after it — two shots landing on the same tick can both spend themselves on
one car and both deal their damage. That is the price of the lag-compensation seam (below): hit
testing is a pure function of an instance and a snapshot, and re-deriving the snapshot per instance
would make the order instances happen to iterate in a balance decision. Accepted, not a bug.

### Hit test

Still current-tick, with **no lag compensation**: hits are tested against the poses cars actually
hold this tick, with no rewind, so a shooter on 80 ms leads a moving target by roughly their own
latency. This design changes how much that costs, not whether it exists — `startUpMs` adds the
wind-up to the lead a player must carry, while a beam (area, lingering) is far more forgiving of it
than a fast projectile, so weapon tuning is now part of the fairness story on a real network. See
the design spec's Future work section
(`docs/superpowers/specs/2026-08-27-weapon-system-design.md#future-work`) for the rewind approach
being deferred and the two rules it will need deciding — lingering/attached beams, and spawn-time
catch-up.

## Authoring a weapon

Six steps, in this order. Only the first three are required for a playable weapon.

**1. Widen the id union.** `WeaponId` in
[`packages/shared/src/config/weapon-types.ts`](../packages/shared/src/config/weapon-types.ts) is a
string union; add your id to it. TypeScript then refuses to compile until the table has a matching
row, which is the point.

**2. Add the row** to `WEAPON_TABLE` in
[`packages/shared/src/config/weapon-config.ts`](../packages/shared/src/config/weapon-config.ts).
Copy `predator` or `roadblock` for a projectile, or `afterburner` or `lance` for a beam — every shape
in the current roster has at least one real row to start from. The union decides which fields you may
write: `pierce`, `pellets`, `piercesWalls` and `explosion` exist only on a projectile, `attached` only
on a beam, and writing the wrong one is a compile error rather than a silently ignored field.
**`lifetimeMs` is on both**, but means different things either side of the union: a beam's own linger
after full extension (`afterburner`, `lance`, `tremor`), or a projectile's independent expiry clock
instead of dying at `range` (`thumper`'s bounce, `predator`'s proximity seeker — see
[`config-reference.md`](config-reference.md#weapon_table) for `ProjectileWeaponDef.lifetimeMs`/
`.bounces`). **`volley` is on `WeaponBase` and so is required on both** — a beam or a projectile may
in principle be a wave sequence (the retired `shockwave` shipped three aura waves; no current row does
— see [Auras](#auras) above), and a single-shot row of either kind authors
`{ volleys: 1, volleyIntervalMs: 0 }`, which is every row today.

Every duration is **milliseconds**, converted once to ticks by `WEAPON_TICKS` — never write ticks.
The row also carries `color`, the `#RRGGBB` every instance of the weapon draws in; pick one that is
not another weapon's and not one of `COLOR_TABLE`'s six player colours, and dark enough to read
against a light arena floor.

The per-row test loop in `weapon-config.test.ts` enforces `unlocksAt >= 1`, positive
`damage`/`speed`/`range`, `stock.max >= 2` when a `stock` block is present, volley counts `>= 1`,
a cone `angleDeg` strictly inside 0–180 and the `color` rules above. A row that breaks one fails the
suite immediately rather than misbehaving at run time.

**3. Give it to a car.** Add the id to that chassis's `weapons` array in `CAR_TABLE` — array index
is the slot index, and `maxAbilitySlots` (3) is the cap. A weapon in the table that no car carries is
inert but legal — `tremor` is the shipped example, authored in full but assigned to nobody while its
loadout decision is pending. `weapon-slots.test.ts` names the deliberately-uncarried set, so an id
accidentally dropped from a kit still fails while a conscious "not yet" passes.

**4. Rebuild shared.** `npm run dev` does it for you. Otherwise
`npm run build -w @motor-combat-moba/shared`, or the server keeps running the previous table while
every test passes — see the stale-`dist` warning in the root `CLAUDE.md`.

**5. Give it an icon, optionally.** Run the `process-weapon-icon` skill with an image and the weapon
id. Skip it and the HUD slot draws a procedural glyph from the weapon's `kind`; that fallback is
permanent, not a placeholder, so a weapon is fully playable with no art. If the icon is being
generated rather than supplied, build it around the row's `color` — the slot is where a player
learns the weapon's colour, and the shot in the arena is where they have to recognise it — the
skill's own `generation-prompt.md` takes the hex. See [`asset-pipeline.md`](asset-pipeline.md).

**6. Rebuild the players' guide.** `npm run build:manual`, then commit
`packages/client/public/manual.html`. The guide page is generated from `WEAPON_TABLE` and
`CAR_TABLE` but committed to the repo, so a new weapon or a moved loadout does not reach it on its
own — players would read a roster your change already falsified. `scripts/manual-page.test.mjs`
fingerprints the tables and fails if the committed page predates them, so this step is enforced
rather than remembered. Art is the exception: the page links `public/art/`, so an icon added later
appears with no rebuild.

**What to expect the first time.** Beams, multi-pellet fans, multi-wave presses, wind-ups and
non-zero recovery are all reachable from a real match now, so none of them is a first shakedown any
more — but several are still *tested* through a borrowed row rather than the weapon that carries
them (see the coverage list above). Watch the HUD dim states and the instance count on the wire for
anything your row is the first to combine.

**If you are re-tuning a shipped weapon rather than adding one**, expect tests to fail on purpose.
Several read the real table at run time and hard-code numbers derived from it, so the suite is how
you find out which:

| File | Why it breaks |
|---|---|
| `config/weapon-config.test.ts` | Pins several rows' stats digit-for-digit, including the per-row shape and status-application checks near the top of the file |
| `config/weapon-ticks.test.ts` | Pins the tick counts derived from them (`cooldown`, `flight`) |
| `sim/weapons/fire.test.ts` | Simulates recharge tick-by-tick across a hard-coded window; `lance`'s real `startUpMs`/`recoveryMs` are driven end to end here |
| `sim/weapons/instances.test.ts` | Beam tests borrow `weaponId: "magmablast"` for its range rather than a real beam row — see the coverage list above |
| `sim/combat.test.ts` | The `50.5` offset is derived from `predator`'s capsule hitbox (`radiusAlong: 19`) — only if you change that hitbox. Both sites assert a HIT, so LENGTHENING the capsule leaves them passing and only their comments go stale; shortening it below 2.5 units of reach is what actually breaks them |

That last one is the subtle case: `50.5` places the two hulls 2.5 units apart, which must stay
inside the hitbox's reach so the shot lands. At `radiusAlong: 14` there is plenty of headroom above;
the fixture breaks if the reach is ever cut below 2.5, and the failure looks like `predator`'s damage
vanishing rather than an obviously wrong number. Update each assertion in the same commit as the
re-tune.

A re-tune needs step 6 as much as a new weapon does: the guide prints damage, recharge, reach and
derived DPS per weapon, so every one of those numbers moves with the row.

## Damage

Weapons and wall spikes (see [Environmental hazards](#environmental-hazards-wall-spikes) above) are
the only damage sources. Car-to-car collision costs nobody hp: cars shove each other through
ordinary resolution, and — between non-teammates on fresh contact, nose-first above
`RAM_CONFIG.minRamSpeed` — also ram each other under the Unity one-way rule: the attacker stops dead
and is locked (`ramLock`), the victim is shoved, spun and left `reeling` (see [Ramming](#ramming)
above). A head-on stops and locks both cars and reels neither. Falloff scales a ram victim's shove,
spin and reel duration; the attacker's own stop and lock are unscaled. Neither a ram nor a shove ever
costs hp.

One hit costs `damageFor(attack, weapon.damage)`:

    Math.round(weaponDamage * (1 + (attack - COMBAT_CONFIG.attackBaseline) * COMBAT_CONFIG.damagePerAttack))

`WeaponDef.damage` is what the weapon deals from a chassis at the baseline rating (50) — an *average*
car, not every car. `attack` moves it between 0.5x and 1.5x across the 0-100 rating range.

The number is resolved **once, at spawn**, and frozen onto the `WeaponInstance` as `instance.damage`.
`hits.ts` reads it there and never looks the owner up: it tests against a snapshot of living fighters
only, so an owner wrecked while their own shot is in flight would have vanished from any live lookup.
Same reasoning as `ownerTeam`.

Rounding happens inside `damageFor`, so `applyDamage` always subtracts an integer from a `uint16`
and a piercing shot deals the identical number to every car it passes through.

Statuses enter through `scaleDamage` at two points, and the asymmetry is deliberate. The shooter's
`damageDealt` is applied **at spawn**, frozen into `instance.damage` alongside `ownerTeam`: a shot's
cost is decided the moment it leaves the barrel, so a buff expiring mid-flight does not un-power it.
The target's `damageTaken` is applied **at impact**: how much a shot hurts is the target's business at
the moment it lands, so armour applied while a shot is in the air protects against it — which is the
whole point of applying armour under fire. See [Statuses](#statuses).

The roster is tuned so an average chassis (500 hull HP) kills another with the baseline weapon in
**5 seconds** at perfect accuracy, reckoned as `hullHP / DPS`.

## Statuses

The sim's **duration layer**. Ramming is the impulse layer — it lands in one tick and decays on its
own — and weapons are the damage layer. A status is neither: it is a window of altered rules that
opens on one car and closes by itself.

A status only ever scales a number the sim was already reading, pulses hp, or does one-shot work when
it lands. Everything it can do is enumerated by `StatusChannel`, `StatusFlag`, `StatusPulse` and
`StatusOnApply`. See [`config-reference.md`](config-reference.md#status_table) for the roster.

### One type reaches the sim

Driving, ramming and combat never look at a status list. Each reads a `Modifiers` — one set of
multiplier channels (nine now: the original eight plus `grip`, the 2026-09-18 Unity ram port's lateral
grip scale, spec §5) and eight flags (`immobilised`, `steeringLocked`, `disarmed`, `fullStop`,
`invulnerable`, `phased`, and the same port's `spinFree` and `ramBlocked`) — produced by
`modifiersOf`, and nothing else:

    PlayerState.statuses -> toActiveStatuses -> modifiersOf -> Modifiers -> stepDrive / resolveRam / runCombat

That is why adding a status never touches the sim, and adding a *channel* touches exactly one call
site. It is also why `NEUTRAL_MODIFIERS` reproduces the pre-status sim exactly: every channel is a
multiplier and neutral is 1.

### A status does not own its duration

`STATUS_TABLE` says what being spiked *does*; the weapon says how long it spikes you for. The same
status is therefore a flicker from a fast repeating source and a real window from a heavy one, and
the table does not grow a near-duplicate row per duration.

Two consequences worth knowing. `applyStatus` takes an explicit `durationTicks` and refuses a
non-positive one outright rather than clamping — a duration of zero means the applier is
misconfigured. And `startTick` is networked, because with the total no longer in the table it is the
only way a reader can know it: the HUD's drain bar is `(endsTick - tick) / (endsTick - startTick)`.

A third consequence carries the roster's whole CC design. **Per-chassis CC duration needs no new
mechanism** — the applier owns the duration and kits are exclusive, so "Mirage's CC is short,
Bastion's is long" falls out of authoring each weapon's `durationMs`, with no `statusDuration`
channel and no per-chassis resistance stat.

### Who applies what

Re-tabled by the 2026-09-01 weapon-status overhaul (Plan 3) against the current roster. Each row's
*effect* is `STATUS_TABLE`'s, above — see [`config-reference.md`](config-reference.md#status_table)
for the numbers.

Five of the nine rows here are reachable from a weapon; two — `overhauled` and `armored` — are
waiting on pickups; two — `reeling` and, since the 2026-09-18 Unity ram port, `ramLock` — are never
granted by a weapon's `applies` at all. The contact pass is `reeling`'s source for an ordinary ram
(victim only) and `ramLock`'s source for a landed one (attacker only); a hard slam adds a second
`reeling` source, reading its duration off the slam's own `applies` entry (same non-`applies`
treatment as `stunned`'s wall-impact source below, which reads its duration off `onWallImpact`'s
`applies` instead). Three
statuses now have more than one source (`stunned`'s third arriving outside `applies` entirely), and
`tremor`'s two rows are presence effects — short durations a live zone keeps topping back up, held
exactly while a car stands in it:

| Status | Applied by | Chassis | For |
|---|---|---|---|
| `overheated` | `afterburner` | Mirage | 1.5 s |
| `corroded` | `magmablast`'s explosion | Mirage | 2 s |
| `stunned` | `roadblock` | Bastion | 1 s |
| `stunned` | `thunderclap` | Mirage | 1 s |
| `stunned` | hard-slam wall impact (`wildcharge`'s contact-pass mechanic, not `applies`) | Bastion | 0.5 s |
| `spiked` | `thumper` | Bastion | 3 s |
| `spiked` | `tremor` | — (uncarried) | 0.6 s per damage tick — held while the target stands in the zone |
| `fortified` | `wildcharge`, **self** | Bastion | 10 s, ended early with the charge |
| `fortified` | `tremor`, **`ownerInside`** | — (uncarried) | 0.3 s per covered tick — held while the OWNER stands in their own zone |
| `reeling` | any landed flank or rear ram (`ram-bridge.ts`'s `contactTick`, not `applies`) | — (any chassis, victim only) | `RAM_CONFIG.ramUncontrolMs` (1 s), shorter on a re-ram — see [Ramming](#ramming) |
| `reeling` | a landed hard slam (`contactTick`'s slams loop, not `applies`) | Bastion | `wildcharge.impulse.applies[reeling].durationMs` (1.4 s), never shortened — falloff is ram-only |
| `ramLock` | landing a flank or rear ram, or either car in a head-on (`contactTick`, not `applies`) | — (any chassis, attacker — both cars on a head-on) | `RAM_CONFIG.attackerLockMs` (0.5 s), unscaled — falloff is victim-only |
| `overhauled` | nothing — the pickup row | — | — |
| `armored` | nothing — the pickup row beside `overhauled` | — | — |

**Bullseye applies nothing at all.** All three of its weapons — `predator`, `pepperbox`, `lance` —
carry no `applies` entry; the skirmisher's kit is pure damage, same as before the overhaul. `predator`
dropped its own `corroded` rider along with its lock-frozen homing when the 2026-09-02
predator/magmablast pass turned it into a proximity seeker — **`corroded`'s only source in the game
is now `magmablast`'s explosion**, nothing else authors it.

**Hard CC no longer belongs to one chassis.** Before the 2026-09-01 overhaul, `stunned` moved from
`shockwave` to `thumper` and Bastion owned it outright. The overhaul gave `thumper` `spiked` instead
(a slow, not a stop) and put `stunned` on three different sources: Bastion's `roadblock` (a straight
weapon application), Mirage's `thunderclap` (a dash lands its own stun on contact), and the 500 ms
wall-stun a Bastion `wildcharge` slam triggers through the contact pass rather than through
`WeaponDef.applies` at all (see [Maneuvers and the contact pass](#maneuvers-and-the-contact-pass)
above). Bastion still carries the CC-focused *type*, but Mirage's dash is a second real source of the
same status.

### `onWave` — a status that rides one wave of a press

`StatusApplication.onWave` is `"all" | "final"`, and **absent means `"all"`**, so every row written
before it existed behaves exactly as it did. The old `shockwave` was the one user — `corroded` landed
on the third of its three aura waves only, so `refresh` could not hand the full duration to whichever
wave connected first and make the other two free. That row retired with the 2026-09-01 overhaul, and
every current `applies` entry is a single-wave weapon, so `onWave` is **dormant machinery** today:
real code, no shipped applier setting anything but the implicit `"all"`.

The wave a shot belongs to is carried exactly the way `damage` and `ownerTeam` are — **frozen at
spawn, sim-only, never networked.** `ShotOrder` carries `weaponId`, `slot`, and `finalVolley`
(`releaseShots` already knows it: `finalVolley === (pending.shotsLeft === 1)`); there is no
`volleyIndex` field — it was considered and deliberately not added, since `onWave` is only
`"all" | "final"` and an index would have no consumer. `spawnInstances` freezes `finalVolley` onto
`WeaponInstance.finalWave`, and `applyOpponentStatuses` / `applySelfStatuses` skip `onWave: "final"`
entries when it is false. **No schema field was added and the client needed no change** — it already
draws instances by `weaponId` and hitbox. Invariant 8 holds because nothing new that `stepSim` reads
crosses the wire.

Cooldown and recovery still start from the **last** volley, so `cooldownMs` means "time until another
press" rather than partly serving its own wave sequence, and a car wrecked mid-sequence loses the
remaining waves (`cancelPending`).

### Per-tick order

    statusTick (expire, derive modifiers) -> serverTick (drive) -> contactTick -> combatTick

Expiry runs **first**, before anything reads a modifier, so no two phases can disagree about whether
a car is still slowed and no tick ever simulates a status whose last tick was the previous one.

Inside `runCombat`:

    read modifiers -> pulses -> room requests -> tickRecharge -> (step instances) ->
    update lock -> beginFire -> releaseShots -> hit resolution (which applies `applies` entries)

Pulses run before anything else can act, so a car killed by its own bleed does not also get to fire
this tick — the right answer to "who won" when the bleed was already on them.

New statuses are only ever **added**, and always take hold on the *following* tick. One rule for
every source, and it has to be one rule because an on-hit status cannot work any other way (hits
resolve last). It also means a crate and a shot arriving together cannot resolve differently
depending on which the room queued first.

### The clock is exclusive at the end

A status applied on tick T for D ticks carries `endsTick = T + D` and is active while
`tick < endsTick`. `expireStatuses` drops it on the tick that *equals* `endsTick`, and `modifiersOf`
independently refuses to read it there. Both matter: the server's sweep is authoritative, and the
independent filter is what stops a client reading a patch-stale list from predicting one or two ticks
of a status the server has already dropped.

### Pulses: burn and repair

`StatusPulse` is `{ intervalMs, damage?, heal? }` — an amount per pulse, not a rate per second, the
same way `damageFrequencyMs` is authored. Pulses are counted from the status's own `startTick`, so
two cars hit a tick apart bleed a tick apart, and no accumulator has to exist (an accumulator would
change every tick, so it would patch every tick, for every burning car). The first pulse lands one
interval *in* — the weapon that applied the status already dealt its impact damage.

`overheated` is the only pulsing row today: 8 hp every 400 ms is its entire effect (O4), a pure burn
with no modifiers at all. `spiked` carried that pulse before the 2026-09-01 overhaul and carries none
now — it is a pure `topSpeed` slow. No row pulses `heal` today; `fortified`'s heal left with the same
overhaul (O5), so `heal` sits in `StatusPulse` unused until a future row picks it up, the same way
`turnRate` sits in `StatusChannel` unused.

**Healing means `applyDamage` is no longer the only HP writer.** `sim/damage.ts` is: `applyDamage`
and `applyHeal` together are the whole set, side by side, so the property the original rule protected
survives — one file to read when asking what can move a car's hp. `applyHeal` clamps to the chassis's
`hpOf` and refuses to lift a wreck off 0, so a repair landing on the tick a bleed killed its target
cannot un-eliminate a player who is already spectating. Nothing calls it from a shipped row today —
`runCombat`'s pulse loop and the tests are its only callers — but it stays in this file because the
invariant it protects does not depend on whether a row currently uses it.

### Applying one

- **`WeaponDef.applies`** — `{ statusId, target, durationMs }` entries. `opponents` rides the damage
  list, inheriting friendly fire, the shooter's own immunity, wrecks, pierce and the per-target damage
  clock for free. `self` lands when a shot actually goes out. `ownerInside` (beams only) re-lands
  every tick the firing car's own hull stands inside the live beam — a dedicated owner-hull test in
  `runCombat`, because the damage list's `canDamage` refuses the owner by design; author a short
  duration and the row's `refresh` turns the per-tick flicker into a window held exactly while the
  owner keeps the zone (`tremor`'s fortified). There is deliberately no `teammates` —
  see [`config-reference.md`](config-reference.md#weapon-status-applications).
- **`CombatInput.statusRequests`** — `{ targetSessionId, statusId, durationTicks, sourceSessionId? }`,
  for anything that is not a weapon. This is the seam a pickup system uses. A request rather than a
  direct write because `runCombat` owns the status list for the duration of a tick, and it is the one
  combat input not backed by a table, so its id is validated even though it is typed.

### Cleanse repairs, it does not heal

`onApply.cleanse` strips every running status of a kind, before the cleansing status is added — so it
can never remove itself. It restores **no hp**: cleansing `overheated`'s burn stops the damage but
does not give back what has already burned. That is the whole difference between a repair and a heal
— and since the 2026-09-01 overhaul, no status in the game heals at all (`fortified`'s heal left with
it), so a cleanse is the closest thing to a repair a car has, and even it never touches hp.

### Why a car can always drive

`reapply` is per row (`ignore` / `refresh`). Beyond that, three rules bound how bad it gets:

1. **Multiplication.** Each further source buys strictly less than the last. Composition is
   order-independent, so no source has to know about any other.
2. **`STATUS_CONFIG.maxActive`** caps a car at 6 simultaneous statuses, and at the cap a *new* one is
   dropped rather than evicting a running one.
3. **`STATUS_LIMITS`** clamps every channel after aggregation.

`stunned` is the one row that takes the car away rather than degrading it, and it pays for that with
the shortest duration in the table plus `ignore`, so it cannot be chained. Its forward component IS
zeroed, every tick, for as long as the status runs (`fullStop`, O6) — the total-stop identity the row
carries since the 2026-09-01 overhaul, replacing the coast-down design this section used to describe.
As of the 2026-09-06 vector-drive rework the lateral component (`bleedLateral` in `sim/drive.ts`) and
injected ram spin (`angVel`) are untouched by `fullStop`, so a car stunned mid-slam still slides into
the wall; only the engine, steering and trigger go dead.

`disarmed` blocks a **new** press only; one already committed still finishes. `beginFire` spends the
stock at press time because a wind-up cannot be cancelled, so a stun landing mid-wind-up would
otherwise eat the stock and produce nothing — a debuff that is strictly worse the better your timing
was. **The interrupt exception:** since O8/O14, a `stunned` application that is new *this* tick no
longer just sits there — it actively cancels the pending press (and any running maneuver, and any
attached instance) at the end of the tick, rather than leaving it to fire once the wind-up completes.
The stock still stays spent either way; what changed is that the shot no longer goes out at all. See
[Maneuvers and the contact pass](#maneuvers-and-the-contact-pass) above.

### Auras

An aura is a beam with a `disc` hitbox anchored at `origin: "center"`. It is not a new concept: the
attached-beam machinery already re-anchors to the owner every tick, already grows 0→range, already
lingers, and already re-applies on the per-target damage clock. Three things are specific to it:

- **`extent` is a radius**, not a reach, because a disc is radially symmetric. `beamShapeAt` returns
  `WorldShape`'s existing circle arm, so the hit test needs no new geometry at all — `shapeHitsObb`
  routes it to `circleOverlapsObb`, which projectiles already used.
- **It passes through walls.** `wallClipDistance` raycasts along a single angle and a disc has none.
  Clipping a radial field would mean an occlusion test per target, which is a different feature.
- **It is drawn as a ring, not a solid.** Every other shot is drawn *as* its hitbox (D19), which works
  because a shot is small; a filled disc would hide the cars inside it. The ring sits exactly
  on the hitbox edge, so what you see is still what will hit you.

An aura aimed at opponents needs **no change to `canDamage`** — it already refuses the owner, so a car
never touches its own field.

**`magmablast` (as `shockwave`) was the shipped aura, went dormant, and now ships again as a
different kind of aura.** From 2026-08-30 it was Mirage's slot 2: a 140° forward cone widened to a
360° ring at 150-unit radius, reaching behind the car as well, and the table's only multi-wave row —
one press scheduled three separate aura instances 500 ms apart, 45 damage each, catching the same
car up to three times because `damageFrequencyMs: 0` arms per instance. The 2026-09-01 weapon-status
overhaul retired that identity outright: the row became a plain single-volley projectile dart, first
on Bullseye's slot 1, and for a while **no row in `WEAPON_TABLE` used a `disc` hitbox at all** — the
geometry, the wall-pass rule and the ring render stayed in place as real, unit-tested code with
nothing driving it.

**That is no longer true.** The 2026-09-02 predator/magmablast pass gave `magmablast` — now on
**Mirage's** slot 1 — an `ExplosionDef`: the shell detonates whenever its instance is removed for any
reason (enemy contact, wall, obstacle, arena bound, or its own `range`), and `instanceDefOf(id, true)`
synthesizes a detached, centre-origin `disc`-hitbox `BeamWeaponDef` from the block — a 60-unit-radius
field that lingers **2 s** and damages **once per entry**. Crossing it costs the burst's 15 (scaled
by the shooter's attack). Standing in it costs the same as one crossing: the clock does not re-tick
a parked car. Leaving and returning costs again. `corroded` refreshes on each of those hits because
statuses ride the damage list and the row is `reapply: "refresh"`. It is not the old aura's
identity back (attached, cone-widened, multi-wave, owner-carried); it is a lingering use of the
same dormant machinery, spawned once at full extent rather than grown, and driven from a `WeaponDef`
that never appears in `WEAPON_TABLE` itself — see [`config-reference.md`](config-reference.md#weapon_table)
for `ExplosionDef`. **`corroded`'s only source in the game is now this explosion.** The multi-wave
`VolleyDef` machinery that rode alongside the original aura is still genuinely dormant: no row,
including this one, authors more than one volley.

### What is networked, and why all of it

`PlayerState.statuses` carries the whole status — id, both ticks, and source — with no server-only
half. That is the opposite of every other combat system here (`FireState`'s `pending` machine, an
instance's `damageClock`, the lock's commit timers all stay off the wire), and the reason is
invariant 8: `stepSim` reads the modifiers derived from these rows, and the client predicts the local
car through the same `stepSim`.

The client's whole half is `localModifiers` in `net/step-context.ts`, which reads the rows off the
schema and hands them to the *same* shared `modifiersFromRows` the server reaches through.

Statuses are cleared outright, not expired, whenever a match ends or is set up: `clearInstances`
sweeps them alongside the lock, so a car never spawns into a countdown still carrying the slow that
killed it last round.

### What the player sees

A badge strip in the HUD gutter, above the weapon slots: one pill per status in its own colour, a
drain bar down its left edge, and its name and seconds remaining. Debuffs lead, then buffs; within
each group the one lapsing soonest is on top. The strip grows *upward*, so a badge does not move when
another lapses beneath it.

This is not decoration. A status a player cannot see is a bug they will report as the car feeling
wrong: a slow with no badge reads as netcode, a bleed with no badge reads as phantom damage, and
neither is something a player can learn from. Derivations live in `scenes/status-hud.ts`; `ArenaScene`
keeps only the Phaser calls.

The cars & weapons guide carries the other half — every weapon page lists what it inflicts or grants,
for how long, and what that status does, derived from `STATUS_TABLE` itself so it cannot go stale.

## Elimination and winning

- HP reaches 0 → `alive = false`, and the car **leaves the field on that tick**. `isOnField` reads
  `alive` as well as `status`, and gates being simulated (so the car freezes at the pose it died on)
  — the **mover** gate only, as of the FFA-game-modes work. Being solid (so it is intangible
  immediately) and being a ram participant are gated by `isSolid` instead (`isOnField && !phased`,
  below); the two agree everywhere except a `phased` car, which is the one case they are allowed to
  disagree. It stops firing and being shot as it always did.
- **There is no wreck.** Until 2026-08-30 a dead car stayed `IN_MATCH` and so stayed a collision
  hull — solid to driving but transparent to combat — parked on the field for the rest of the match.
  It now fades out on the client over `DEATH_FADE_MS` (1 s) from the networked `diedAtTick`, and is
  then not drawn at all. The fade is render-only; the car is already gone from the sim before the
  first frame of it. In `FFA_DEATHMATCH` the car comes back (see "The respawn lifecycle" below) —
  but it still leaves the field the instant it dies, and still fades out the same way in the
  meantime. There is still no wreck; there is now a return.
- `diedAtTick` is networked rather than derived from `alive` flipping, so a spectator or a late
  joiner — neither of whom saw the transition — fades it correctly instead of drawing a corpse
  forever.
- **Two win conditions now**, picked per-match by `GameMode` and read through `winRuleOf(mode)`:
  - `"last_standing"` (`FFA_LAST_STANDING` and `TEAM`) — after damage each tick, `livingSides(mode,
    roster)` counts the living sides. `sides <= 1` ends the match through the same `endMatch` a
    disconnect uses. FFA names a `winnerSessionId`; team mode names a `winnerTeam`; zero living sides
    is a draw (`-1`, `""`), which a mutual head-on kill can produce.
  - `"deathmatch"` (`FFA_DEATHMATCH`) — `livingSides` is never called: with respawns, every player
    can be simultaneously dead while waiting out a timer, and `livingSides` would read that as zero
    living sides and end the match. The mode ends instead on `tick >= ArenaState.matchEndsTick` or
    fewer than two roster players remaining, and the winner is `deathmatchOutcome(players)` — ranked
    kills descending, then deaths ascending. A top position still tied on both is the existing draw
    path (`winnerSessionId: ""`), which reads identically to "nobody won"; naming tied leaders is
    deliberately out of scope. See "Kill attribution" and "The respawn lifecycle" below.
- Ending a match clears every shot in flight, and so does setting one up, so nothing from a previous
  match can carry into the next one.

## Kill attribution

The kill goes to whoever dealt damage last — not most damage, not a share, not a contribution window.
There is no per-attacker damage ledger; one string per car is the whole mechanism.

Every point of hp loss already has a known attacker: the plain ram deals no damage (see Ramming
above), status damage-over-time carries `ActiveStatus.sourceSessionId`, a contact hit (a dash
landing or a hard slam) carries `ContactHit.attackerSessionId`, and a spike hit carries
`SpikeHit.sourceSessionId` — the shover if one pushed this car within `SPIKE_CONFIG.shoverCreditMs`,
else the victim's own session id (see [Environmental hazards](#environmental-hazards-wall-spikes)
above). `CombatPlayer` carries
`lastDamagerSessionId`, stamped by `dealDamageTo()` in `sim/combat.ts` — the sim's one hp/`alive`
writer — from the shot's `ownerSessionId`, the pulse's `sourceSessionId`, the contact hit's attacker,
or the spike hit's source, and only when hp actually moved: an `invulnerable` (armored) target yields
no credit, exactly as a 0-damage pure-applicator hit does. It is **server-only,
never networked**: the client does not predict damage, so putting it on the schema would patch a
string to every client at the tick rate for nothing (invariant 8, satisfied by the front door).

`combat-bridge.ts`'s existing death-transition detector books the kill the tick a car's `alive` flips
false: `victim.deaths += 1`, `victim.killedBySessionId = lastDamagerSessionId`, and
`killer.kills += 1` if that id still resolves to a present player. A killer who has disconnected
simply does not get the increment — the victim's `killedBySessionId` still names them, so the "killed
you" banner reads correctly even for a departed killer. `lastDamagerSessionId` is cleared on
respawn, so an attacker who hurt you earlier can never be credited with a later death.

Kills and deaths are counted in **every** mode — the attribution code runs regardless, so gating it
would cost a mode check in the damage path and buy nothing. Only `FFA_DEATHMATCH` decides a winner
from them; Last Standing and Team get a real K/D scoreboard out of it for free, replacing the
placeholder zeroes `results-view.ts` used to render. Assists remain zero everywhere — there are none
to attribute.

## The respawn lifecycle

**This section applies to `FFA_DEATHMATCH` only.** In `FFA_LAST_STANDING` and `TEAM` no car is ever
granted `phased`, no respawn sweep runs, and death stays terminal exactly as described above.

A roster player who is `!alive` and has waited `DEATHMATCH_TICKS.respawnDelay` since `diedAtTick`
(`isDueToRespawn`, `flow/respawn.ts`) respawns at the top of the room tick, before `statusTick` — so
there is no tick on which a freshly respawned car reads as solid. Respawn:

- picks the arena's `ffaSpawns` entry that maximises distance to the nearest living enemy
  (`farthestSpawn`, pure and unit-tested);
- resets the car exactly as `revealCars` already does: pose to the chosen spawn, `vx = vy = 0` (ram
  knock cleared via `clearKnock`), `hp = hpOf(carId)`, `alive = true`, `diedAtTick = 0`, `killedBySessionId = ""`,
  `lastDamagerSessionId = ""`, statuses cleared, fire state fresh — nothing survives a death, no
  stock, no switch lock, no lingering debuff, no knock; and
- grants `phased`.

**`phased` is intangible and invulnerable as one rule, not two.** Rather than "cannot be hurt" plus
"passes through cars," a phasing car is simply not present in the world: not a collider, not a ram
partner, not a weapon target. It is a status — networked on
`PlayerState.statuses`, client-predicted, rendered as a HUD badge and a ghost alpha — that flips one
`Modifiers` flag and scales nothing. It is granted `chainable: true` (`StatusDef`), the one row
allowed to be `reapply: "refresh"` while carrying a flag, because contact-clear extension (below)
needs to re-arm it without the anti-chain rule that keeps hard CC from being held on a car
indefinitely by an opponent — a rule `phased` cannot violate, since only the room grants it and no
opponent can apply it at all.

The predicate that reads it splits in two: `isOnField` stays the **mover** gate (may this car be
simulated), unchanged; `isSolid` is the new **wall** gate (`isOnField && !phased`), read by
`otherCarHulls` (both `serverTick` and the client's `buildStepContext` call it, so both halves of the
lockstep change together) and the ram pair list in `ram-bridge.ts`. `resolveWorld`, the OBB hull
model, and `carHullOf` are all untouched — only which cars are *members* of a contact test changes.

**A phase ends on whichever comes first**, decided each tick by the pure `phaseDecision` in
`flow/respawn.ts`:

1. the player commits a press — protection is traded for the shot;
2. the hard cap (`DEATHMATCH_TICKS.phaseMax`) elapses, regardless of overlap — belt-and-braces, since
   parking on a phased car to hold it intangible is weak griefing that only delays the camper's own
   shot; or otherwise
3. the timer (`DEATHMATCH_TICKS.phase`) elapses **and** the car's OBB overlaps no other solid car —
   "contact-clear." Checked only on the tick the phase would otherwise lapse, never sooner, so a car
   merely driving past someone is not extended.

If the timer would lapse while still overlapping, the phase is extended (a `reapply: "refresh"`
application) rather than ending — this is the failure `phaseSeconds` being a floor rather than a fixed
window exists to prevent: two cars suddenly interpenetrating and `resolveWorld` separating them with a
single-tick position push and a speed bounce. This is the Quake/Source-lineage answer — a spawning
body stays non-solid until its hull is unobstructed — reusing `collide.ts`'s existing SAT rather than
reimplementing the overlap test.

Phasing passes through **cars only**; obstacles and the arena bounds stay solid, so a phased car
cannot leave the map.

See [`superpowers/specs/2026-09-01-ffa-game-modes-design.md`](superpowers/specs/2026-09-01-ffa-game-modes-design.md)
for the full decision record (M1–M33), including the M15 correction on why the phased filter has to
apply in both directions inside `otherCarHulls`.

## What the client shows

`ArenaScene` draws every live instance from `state.weapons` — projectile and beam rows in one map,
discriminated by `kind` — and never predicts a shot or an HP change. A projectile is extrapolated
along its own constant velocity between patches (`extrapolateShot`, capped at one patch interval); a
beam's `extent` is extrapolated the same way under the same cap. An attached beam's origin is
re-anchored to its owner's pose by the **server**, every tick, and reaches the client on the row like
any other instance — the client does no owner lookup of its own, so a welded beam carries the same
patch-to-patch lag as the car it is welded to. Both extrapolations are exact
rather than a guess, because the server integrates the identical motion, and nothing either produces
feeds back into state. An instance is drawn from its own hitbox shape and dimensions, never a
sprite — what you see is the hitbox, so a new weapon is playable with no art at all.

A weapon may additionally carry a **look**, held in one of three tables in `scenes/combat-visual.ts`,
split by what the weapon's hitbox is. Each returns `[]` for a weapon it does not own, so the flat
fill stays the fallback for anything unstyled:

| Table | Owns | Nests by | Today |
|---|---|---|---|
| `WEAPON_GLOW_STYLES` | round projectiles | radius | `magmablast` |
| `WEAPON_BEAM_STYLES` | beams | extent and cross-section | `afterburner`, `lance`, `tremor` |
| `WEAPON_PROJECTILE_STYLES` | ellipse and capsule projectiles | markings inside the hull | `thumper`, `predator` |

Two of those rows outgrew "markings on a hitbox" in September 2026 and are worth knowing about
before authoring a third. `predator` is a **missile** — nose cone, stripe, swept fins and an exhaust
plume — drawn from a `poly` layer, the free-polygon escape hatch for a silhouette the named shapes
cannot describe. `lance` is a **lightning bolt**: a dead-straight white-hot core inside an envelope
whose edges tear, re-rolled `crackleHz` times a second off the wall clock, with a rounded `domeScale`
cap on its origin. Both stay strictly inside their hitboxes, but neither is inscribed *by
construction* the way a `band` or a `tongue` is — a `poly`'s vertices are arbitrary and a bolt's are
placed by a hash — so both are contained by an explicit per-vertex clamp instead, and both are
tested for it across headings, extents and animation frames rather than at a single pose.

Two rules keep this from undoing the paragraph above. Every scale is a fraction of the instance's own
hitbox rather than a world distance, so a look rescales with any hitbox re-tune. And nothing may draw
*outside* the hitbox — a marking is inscribed by construction, which `projectile-marks.test.ts` checks
at six headings (the same rule the retired `fireball`'s flicker used to demonstrate, shrinking its rim
rather than growing past it). A drawn shot larger than the thing that hits would make players believe
in hits that never happened.

The converse — that the drawn shape *fills* the hitbox — held everywhere except the retired `skewer`,
whose disc-and-spikes spindle covered 43% of its ellipse; that documented exception left with the
weapon. Nothing in the current roster relaxes the rule.

Styles are deliberately per weapon and not a shared formula over `color`: each weapon is meant to have
its own silhouette in flight, and a shared ramp would make every weapon a differently-tinted copy of
one object.

Its fill is the **weapon's** `color` (`weaponFillOf`), not the firing player's. Every `predator` shot
in the arena is the same red whoever fired it: a shot's colour answers "what is coming at me",
and the car that fired it is already on screen wearing the player colour, so spending the shot's one
colour channel on ownership would say the less useful thing twice.

That is the only question a shot's colour answers. It does **not** encode which chassis fired it:
between 2026-08-31 and 2026-09-02 the roster carried a per-car palette (Mirage maroon, Bullseye
navy, Bastion yellow) so a car's three weapons resembled each other, and that theme has been
retired — colours are now chosen per weapon on their own merits, and two weapons on different cars
sharing a hue is not a defect to fix. What a colour is still held to is its own weapon's **HUD
icon**, so the slot and the shot read as one weapon; `check:weapons` measures that distance and
warns, never blocks. `shotPaletteOf` returns every colour a weapon actually draws in, since `color`
alone is only one layer of six of them. Shots were owner-coloured before
weapon colours existed; nothing in the sim ever read that, and nothing does now — `color` is
render-only, like `name`. `WEAPON_TABLE`'s colours are kept clear of `COLOR_TABLE`'s six player
colours (a table test enforces it) so a shot can never be mistaken for somebody's paint.

A camera-fixed slot column down the HUD gutter — the strip of canvas to the right of the arena that
the world camera's viewport does not cover — shows the local player's weapons, or, while spectating,
the watched car's. (Deathmatch never spectates, so there it is always your own kit, dead or alive.) One round slot each: icon inside, fire key beside it, weapon name beneath, dimmed
into one of
four states: full brightness when ready, a dimmed icon with an anticlockwise cooldown wedge while
recharging, a heavier *static* dim when the slot is not unlocked yet, and a lighter dim across every
slot during a wind-up or volley (or across the other slots during recovery). Locked and recharging
use different, deliberately distinguishable dims so "you don't have this yet" can never be mistaken
for "back in a few seconds." See [`asset-pipeline.md`](asset-pipeline.md) for how a slot's icon
resolves and its procedural fallback.

Two chassis slots author a beam **row** today (`afterburner`, `lance`) and one projectile is a
multi-pellet fan (`pepperbox`, four muzzles), so the beam half of the drawing code above still runs
in every live match: `instanceDrawShape` branches on the weapon definition's own `kind`, and a `beam`
definition is reachable the moment either fires. The 2026-09-01 overhaul retired two beams from this
list — `magmablast` (formerly `shockwave`, then a plain projectile) and `bulwark` outright — and with
them the roster's one multi-wave beam press; see [Auras](#auras) above. A third path to a `beam`
definition opened back up on 2026-09-02: `magmablast`'s explosion is synthesized as a `kind: "beam"`
def by `instanceDefOf` even though the shell itself is authored `kind: "projectile"`, so the
disc-drawing branch runs on every magmablast detonation without either shipped beam **row** changing.

**Every live instance draws below every car** (`SHOT_DEPTH`, under `CAR_DEPTH`) — one rule for
projectiles and beams alike, so parking inside your own beam never hides you under it. The
accepted cost is that a projectile crossing behind a car is briefly occluded by it; the alternative
is a per-weapon "is this a ground effect" flag, which is a second taxonomy encoding a distinction
`kind` already carries. This does not weaken "what you see is the hitbox": the drawn shape is still
exactly the shape that hits, it is merely occluded by cars rather than occluding them.

A beam holds **full opacity for its whole life** and then ramps out across a fixed
`BEAM_FADE_OUT_MS` window that ends exactly on its death tick, so the visual and the hitbox vanish
together (`beamFadeAlpha`). The window used to be the entire lifetime, which left the retired
`bulwark` a ghost for 2875 ms while it was still dealing full damage — a zone lying about where it
was safe to stand. One constant covers every beam, clamped to the linger so it can never start the
fade before the beam is fully grown; `lifetimeMs` is untouched by it, so no damage window and no TTK
number moves. What the *tests* for that branch
do and do not reach is narrower than what play reaches — see the coverage list under
[Instances: two lifecycles](#instances-two-lifecycles) for exactly what the sim-side and client-side
tests do reach.

Living cars carry an HP bar scaled to their own chassis maximum (`hpFraction`), so a bastion at half
hp and a bullseye at half hp both read as half a bar. Its **length is the whole of the health
channel; its colour says allegiance and nothing else** — green for you and your teammates, red for
every enemy, at full hp and at one hp alike (`allegianceOf`, `hpBarColor`). That deliberately gives
up the old amber/red low-health warning: colour was spending its one channel on the sentence length
already said, while the question a 3v3 actually asks went unanswered. There is no exception for your
own car — a rule with one exception has to be taught. In FFA the rule degrades to "green is me, red
is everyone else".

Allegiance is always computed against the **local player**, never against whoever the spectate camera
is following: a wreck can cycle through living cars, and green stays your team's green while you
watch an enemy fill the screen. `allegianceOf` takes the viewer as an argument rather than reading
the room, so that is a property of the signature rather than a rule somebody has to remember.

There is no wreck alpha. A dead car is intangible and frozen from the tick it dies, fades to nothing
over `DEATH_FADE_MS` (`deathFadeAlpha`, driven by the networked `diedAtTick`), and is then not drawn
at all — it also stops being predicted or interpolated.

A wrecked player becomes a spectator **in Last Standing**: `[` / `]` — or Left / Right — cycle the
living cars, `V` toggles free roam, and WASD or the arrows pan in free roam. All of it is local; the
server has no notion of who anyone is watching.

Spectating is gated on `isSpectating` (dead, in the match, during `MATCH`, in a mode that will not
give the car back) and deliberately **not** on "cannot drive right now" — the drive gate is also
false during the countdown, and keying the camera off it made the 3-2-1 follow whichever car sorted
first by session id instead of your own.

**Deathmatch is never spectated.** Spectating is what the game offers a player it has removed from
the match for good; a Deathmatch death lasts `respawnDelaySeconds` and hands the car straight back,
so the camera going to find a stranger costs the player the two things they actually want — the fight
they were just in, and their own kit in the gutter. A Deathmatch wreck therefore keeps its own seat:
`cameraTarget` and `hudTargetPlayer` both fall through to the local session, the camera **holds on
the spot it died** (there is no pose to follow once the wreck has faded), and the slot column keeps
showing the player's own weapons. The "[name] killed you" banner and the respawn countdown are
unchanged. On the way back the camera **cuts** rather than eases: `farthestSpawn` is by construction
the far side of the arena, and `smoothFollow` would otherwise spend a second sailing across it with
the player already driving a car they cannot see (`syncRespawnCamera` drops `camFocus` on the
dead → alive edge, so `followCamera` re-seeds outright).

The rule is keyed on `winRuleOf(mode)`, not on "does this room respawn". The dev-only playground
respawns forever while running `FFA_LAST_STANDING`, and is the one place those two questions come
apart — it keeps the spectate camera.

The respawn itself is marked by the **countdown arrow drawn a second time**: the same green triangle
that says "this one" before the gun, over your own car, for exactly as long as spawn protection lasts
(`isPhasedAt` — the same derivation that dims the car to a ghost, so the marker and the ghost end
together, including the early drop the player buys by firing). It **blinks** where the countdown's
bobs: that arrow labels a car standing still with the player's full attention, while this one has to
be found mid-fight on a car that just teleported. It is drawn off `drivenSid` on the local client
alone, so where you came back is never shown to anybody else.
