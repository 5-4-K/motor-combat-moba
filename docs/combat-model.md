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

Ram is a separate pass, not part of `combatTick`: `rooms/tick-pipeline.ts`'s `runPipeline` runs
`serverTick` (drive), then `contactTick` (`packages/server/src/sim/ram-bridge.ts`), then `combatTick`.
`contactTick` maps `ArenaState` onto plain `RamCar`s and calls `applyRams`, the pure step in
`packages/shared/src/sim/ram.ts` — no schema, no room. Running between the two means ram detection
reads the poses driving actually
produced this tick, and the knock it writes is what `stepDrive` reads on the next one. Ram is
server-only, like combat, and the client never computes an authoritative outcome — it does run its
own local contact check against remote hulls to fire a camera shake and impact spark immediately,
but that is render-only and feeds nothing back into `stepSim`, the schema, or the server.

**A ram deals zero hp.** `applyRams` never calls `applyDamage`. The whole feature is contact turned
into control loss — a spin, a sideways shove, and a degraded steering multiplier — never damage.
Weapons stay the only damage source, so the `attack` rating keeps meaning exactly what its name
says: ramming sets up the kill, weapons land it.

Contact is **edge-triggered**: a knock fires only on the tick a pair of car hulls *enters* contact.
A pair still touching on the following tick is skipped, and a pair no longer touching is dropped
from the tracked set. Holding the throttle into a victim therefore lands one knock, not a
stun-lock — to ram the same car again you must separate and re-approach.

Severity is graded from the **attacker's** forward speed (`SimBody.speed`, which is already
`dot(vel, fwd)` in this drive model) and the **attacker's** `mass` rating, scaled against
`RAM_REFERENCE` (an average-mass chassis at the roster's fastest top speed). A car shunted
backwards, or one whose nose points away from the contact, deals nothing — its approach term is
non-positive — which is what keeps "get behind them" a strategy rather than "be moving fastest".
Whichever car has the higher approach score is the attacker; if both fall below
`RAM_CONFIG.minApproachSpeed` there is no ram at all.

The impact side is read in the **victim's** local frame and multiplies severity before it is
clamped back into range:

| Side | Bonus |
|---|---|
| Front | 0.3 |
| Flank | 1.0 |
| Rear | 1.3 |

so an identical approach dealt to the rear is worth more than four times the same hit to the front —
head-on ramming is deliberately weak, and positioning is the whole feature.

The knock itself is four fields on `PlayerState`: `authority` dips toward
`RAM_CONFIG.authorityFloor` and scales **steering only**, never throttle or brake, so a knocked
player can always drive out of it; `shoveX`/`shoveY` push the victim sideways; and `angVel` spins
it, from a lever arm recovered from the actual contact point rather than a guessed direction — a
dead-centre nose hit produces exactly zero spin. All four decay back toward neutral on their own
half-life, and steering against an injected spin bleeds it off faster than coasting does. See
[`schema-reference.md`](schema-reference.md#playerstate) for the fields and
[`config-reference.md`](config-reference.md#ram_config) for the tuning. None of the attacker's own
state is touched by a ram — the existing collision rebound already costs the aggressor its speed.

**Teammates are fully immune.** `resolveRam` is gated by the same `canDamage` predicate used below
for shots, so contact and weapons can never disagree about who is on your side. Teammates still
collide and shove each other through ordinary resolution; a friendly hit simply produces no spin, no
shove, and no authority loss.

See [`superpowers/specs/2026-08-29-ram-cc-and-knockback-design.md`](superpowers/specs/2026-08-29-ram-cc-and-knockback-design.md)
for the full decision record (R1–R20), including the deviations recorded there.

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
  a graded ram: a fixed impulse from `SLAM_CONFIG` (same knock for every attacker and victim, no mass
  factor, no side bonus), gated off if the victim is already `stunned` and the charger's weapon
  doesn't set `slamsStunned` (O3/O18), or if the victim is still inside `SLAM_CONFIG.reslamImmunityMs`
  of a previous slam. A landed slam ends the attacker's charge, restores
  `SLAM_CONFIG.selfKeepFactor` of its pre-impact speed, and expires the attacker's own self-applied
  statuses (`expireStatusesFromSource`) — a window that closed early cannot leave its buff running
  past it. A victim shoved into a wall within `SLAM_CONFIG.wallStunWindowMs` of the slam is stunned
  once for `wallStunDurationMs` (O2).

`sim/contact.ts`'s `resolveContacts` is where this lives: it extends `applyRams`'s pair loop —
checking each car for a dash, then a charge/slam, and only falling through to an ordinary ram when
neither side produced one — and runs in the same slot `ramTick` used to, between drive and combat.
The server-side half is `packages/server/src/sim/ram-bridge.ts`'s `contactTick`, which also tracks
each slam's wall-stun window and re-slam immunity in room memory and turns a landed wall-stun into a
`StatusRequest`.

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

## Weapon

Every car carries an ordered list of weapons, `CAR_TABLE[car].weapons` — index 0 is slot 1, and
order *is* the slot mapping, so a chassis's whole identity (speed, attack, hp, guns) lives in one
table row. `WEAPON_SLOT_CONFIG.maxWeaponSlots` (3) caps how many slots any chassis may present; a
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
`fire: boolean`. The server masks it to `maxWeaponSlots` bits and to the car's actual slot count
before the sim ever sees it, so a hand-rolled client cannot fire a slot it does not own. Multiple
bits set on the same tick resolve to the **lowest** slot. Each slot's key binding is client-only
(`config/slot-keys.ts`) — the server never sees a key, only an index — so rebinding a key is a local
change with no protocol consequence.

Firing still rides the same gate as movement: `serverTick` reports which session ids asked to fire
on an input it actually **simulated**, so an input past `NET_CONFIG.maxInputsPerTick` cannot buy a
shot the sim never ran, and a lobby player spamming a fire key spawns nothing.

### Aim assist and the target lock

A weapon whose `usesAimAssist` is true fires at the car's **lock** instead of along its heading.
The lock decides a direction only: the instance is an ordinary projectile frozen to its exit pose,
with no homing and no correction in flight.

The lock is **ambient** — maintained every tick whenever a valid target exists, whether or not the
player is firing. The trigger fires; it never targets. With no lock, a weapon fires straight ahead,
and firing is never blocked.

**The region** is a cone intersected with a lateral cap, out to `AIM_CONFIG.lockRange` — all three
bounds, because neither of the first two survives alone. A pure cone's width scales with distance,
so at `magmablast`'s 900-unit range it would span half the arena; a pure lane's angular width explodes near the
car, so it would accept a target 83° off your nose during a collision. The cone governs contact range, the
cap governs long range. They cross over at `lateralMax / tan(coneDeg)` ≈ 330 units measured **along
the car's axis** (the forward leg of the triangle at the cone's edge), which is ≈351 units measured
**radially** (`lateralMax / sin(coneDeg)`, the straight-line hypotenuse) — and the radial figure is
the one that matters in practice, since `distance` in `lock.ts` is `Math.hypot(dx, dy)`, not the
axial component.

**Scoring** is `abs(angleDeg) + distance × scorePerDistanceUnit`, lowest wins. The coefficient is per
**world unit** — there are no metres in this game, and a value sized for metres makes the distance
term swamp the angle and turns the whole system into "always nearest target".

**Hysteresis comes in two independent halves**, and conflating them is the easy mistake:

- *Spatial* — the retention pads and the sight grace — decides whether the current target is still
  held. All three bounds are padded, not just the angle: at long range the lateral cap is what binds,
  so a degrees-only pad would give a distant target no hysteresis at all.
- *Competitive* — the 25% steal margin and the commit timer — decides whether a rival may replace it.

`AIM_CONFIG.lockTimeoutMs` switches off the **competitive** half after a spell with no fire press
(any slot: the timer asks whether the driver has disengaged, not whether a particular gun is in use).
It never blanks the bracket — release and re-acquisition resolve in one pass — it just means the
best-scoring target wins outright. That is what splits weapons into two classes: faster than
`1000 / lockTimeoutMs` holds locks and the margin governs, slower re-picks the best target every
shot. `weapon-config.test.ts` fails any aim-assist weapon authored within 15% of that cliff.

**Line of sight** is a muzzle-to-target raycast reusing `wallClipDistance`. It is a no-op in
`arena-01`, which has no obstacles, and exists because switching arenas is a one-line edit.
**Wrecks are not cover** — shots already pass straight through them, so blocking a lock on one would
drop it for an obstruction that provably does not stop the bullet.

**Shot geometry:** the fired angle is measured from the **muzzle**, not the car centre (scoring uses
the centre); the muzzle never swings to the aim angle, it stays the car's physical nose (it plainly
still translates and rotates with the car — it just never deflects toward a locked target); and a
pellet fan or a sequential burst re-reads the lock at each shot's own tick, the same way it already
re-reads the car's pose.

**There is no lead** (A3), for any weapon kind. `aimAngleFor` returns the target's *current* bearing
from the muzzle: the assist sets the shot's direction, and carrying the lead against a crossing
target stays the player's job. First-order interception — aiming at where the target *will* be,
solved against the shot's own `speed` — shipped briefly and was **reverted**: it decided the shot
rather than pointing it, so a lock read as an aimbot. The known cost is the one A3 states plainly:
against a full-speed crosser a no-lead lock only connects at close range, which is a skill boundary
rather than a bug. Re-derived per shot, not once per press, so a burst's later volleys track the
target's new position at their own tick.

**Per-weapon range** (spec S1) is a second gate below the lock itself. Lock *acquisition* uses the
car's single largest `aimRangeUnits` across its assisted weapons (`carAimRangeOf`), so a bracket can
appear on a target only the car's longest-ranged gun can actually reach. At fire time each weapon
checks the target against its **own** `aimRangeUnits`, centre-to-centre exactly as lock scoring
measures it — a held lock farther than the weapon in hand can reach makes that weapon decline the
assist and fire straight ahead rather than refuse to fire.

`roadblock` is the table's reference row for `usesAimAssist: false`, as `predator` is for `true`.
See [`superpowers/specs/2026-08-27-aim-assist-target-lock-design.md`](superpowers/specs/2026-08-27-aim-assist-target-lock-design.md)
for the decisions (A1–A14) and the rejected alternatives.

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
- **`damageFrequencyMs > 0`, the re-arming per-target clock.** Still genuinely uncovered, and now down
  to one shipped example: `afterburner` (500 ms) ships it and re-ticks a target still standing in the
  flame during a real match (`bulwark`, the table's other example, retired with the overhaul), but
  `hits.test.ts` only exercises `damageFrequencyMs: 0`'s arm-at-infinity behaviour, and
  `weapon-config.test.ts` / `weapon-ticks.test.ts` only pin the raw ms/tick values — no test drives an
  instance through a re-arm and a second hit on the same target.
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
`sessionId` to the next tick it may damage that car again. `damageFrequencyMs: 0` (every weapon
shipped today) arms that clock at `Infinity` — one hit per target, ever, for that instance's whole
life; a positive value re-arms on the interval, which is what would let a lingering beam re-tick a
car still standing in it. This bookkeeping is server-only, keyed by instance id, never networked,
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
a cone `angleDeg` strictly inside 0–180, the `color` rules above, and that `usesAimAssist` is set
(it is a **required** field — there is no default). If `usesAimAssist` is `true`, two further
assertions apply: the weapon's `range` must be at least `AIM_CONFIG.lockRange` (a lock the weapon's
own range cannot reach would show a bracket and then fall short), and its sustained fire rate
(`1000 / cooldownMs`) must sit outside ±15% of the `1000 / lockTimeoutMs` behavioural cliff (see
"Aim assist and the target lock" below for why that boundary matters). A row that breaks one fails
the suite immediately rather than misbehaving at run time.

**3. Give it to a car.** Add the id to that chassis's `weapons` array in `CAR_TABLE` — array index
is the slot index, and `maxWeaponSlots` (3) is the cap. A weapon in the table that no car carries is
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
| `config/weapon-config.test.ts` | "keeps aim-assist weapons off the behavioural cliff" — every `usesAimAssist` weapon's `cooldownMs` must stay outside ±15% of `1000 / AIM_CONFIG.lockTimeoutMs`; `thumper`'s row is the named example of a value (900 ms) that was first drafted inside the forbidden band and had to move |
| `config/weapon-ticks.test.ts` | Pins the tick counts derived from them (`cooldown`, `flight`) |
| `sim/weapons/fire.test.ts` | Simulates recharge tick-by-tick across a hard-coded window; `lance`'s real `startUpMs`/`recoveryMs` are driven end to end here |
| `sim/weapons/instances.test.ts` | Beam tests borrow `weaponId: "magmablast"` for its range rather than a real beam row — see the coverage list above |
| `sim/combat.test.ts` | The `50.5` offset is derived from `predator`'s capsule hitbox (`radiusAlong: 14`) — only if you change that hitbox |

That last one is the subtle case: `50.5` places the two hulls 2.5 units apart, which must stay
inside the hitbox's reach so the shot lands. At `radiusAlong: 14` there is plenty of headroom above;
the fixture breaks if the reach is ever cut below 2.5, and the failure looks like `predator`'s damage
vanishing rather than an obviously wrong number. Update each assertion in the same commit as the
re-tune.

A re-tune needs step 6 as much as a new weapon does: the guide prints damage, recharge, reach and
derived DPS per weapon, so every one of those numbers moves with the row.

## Damage

Weapons are the only damage source. Collision costs nobody hp: cars shove each other through
ordinary resolution, and — between non-teammates on fresh contact — also ram each other for spin,
shove, and steering loss (see [Ramming](#ramming) above). Neither ever costs hp.

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
multipliers and three flags — produced by `modifiersOf`, and nothing else:

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

Five of the seven rows are reachable from a weapon; two — `overhauled` and `armored` — are waiting on
pickups. Three statuses now have more than one source (`stunned`'s third arriving outside `applies`
entirely), and `tremor`'s two rows are presence effects — short durations a live zone keeps topping
back up, held exactly while a car stands in it:

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
the shortest duration in the table plus `ignore`, so it cannot be chained. Its speed IS zeroed, every
tick, for as long as the status runs (`fullStop`, O6) — the total-stop identity the row carries since
the 2026-09-01 overhaul, replacing the coast-down design this section used to describe. Shove and
injected ram spin are untouched, so a car stunned mid-slam still slides into the wall; only the
engine, steering and trigger go dead.

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
  on the hitbox edge with a low-alpha wash inside, so what you see is still what will hit you.

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
field that lingers 150 ms and applies `corroded` to opponents for 2 s. It is not the old aura's
identity back (attached, cone-widened, multi-wave, owner-carried); it is a new, one-shot use of the
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
above), status damage-over-time carries `ActiveStatus.sourceSessionId`, and a contact hit (a dash
landing or a hard slam) carries `ContactHit.attackerSessionId`. `CombatPlayer` carries
`lastDamagerSessionId`, stamped by `dealDamageTo()` in `sim/combat.ts` — the sim's one hp/`alive`
writer — from the shot's `ownerSessionId`, the pulse's `sourceSessionId`, or the contact hit's
attacker, and only when hp actually moved: an `invulnerable` (armored) target yields no credit,
exactly as a 0-damage pure-applicator hit does. It is **server-only,
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
- resets the car exactly as `revealCars` already does: pose to the chosen spawn, `speed = 0`, ram
  knock cleared, `hp = hpOf(carId)`, `alive = true`, `diedAtTick = 0`, `killedBySessionId = ""`,
  `lastDamagerSessionId = ""`, statuses cleared, fire state fresh — nothing survives a death, no
  stock, no switch lock, no lingering debuff, no knock; and
- grants `phased`.

**`phased` is intangible and invulnerable as one rule, not two.** Rather than "cannot be hurt" plus
"passes through cars," a phasing car is simply not present in the world: not a collider, not a ram
partner, not a weapon target, not an aim-assist lock candidate. It is a status — networked on
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
| `WEAPON_GLOW_STYLES` | round projectiles | radius | **none** — empty since the 2026-09-01 overhaul retired `fireball`, its one weapon with a flicker |
| `WEAPON_BEAM_STYLES` | beams | extent and cross-section | `afterburner`, `lance`, `tremor` |
| `WEAPON_PROJECTILE_STYLES` | ellipse and capsule projectiles | markings inside the hull | `thumper` |

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

Since 2026-08-31 that colour answers a second question: **which chassis**. The nine weapons are
themed per car to match their HUD icons — Mirage maroon and orange, Bullseye navy and orange, Bastion
yellow and white — so a car's three weapons deliberately resemble each other and are told apart by
silhouette instead. `lance`'s white core is the one departure. Do not "separate" those palettes on
sight: the convergence is the design, and `check:weapons` is the tool that flags an icon reading as a
different weapon from its slot's own colour — a warning, not a blocker, since only a person looking
at the screen can judge a mismatched pair; not every icon clears it as of this writing.
`shotPaletteOf` returns every colour a weapon actually draws in, since `color` alone is now only one
layer of six of them. Shots were owner-coloured before
weapon colours existed; nothing in the sim ever read that, and nothing does now — `color` is
render-only, like `name`. `WEAPON_TABLE`'s colours are kept clear of `COLOR_TABLE`'s six player
colours (a table test enforces it) so a shot can never be mistaken for somebody's paint.

A camera-fixed slot column down the HUD gutter — the strip of canvas to the right of the arena that
the world camera's viewport does not cover — shows the local player's weapons, or, while spectating,
the watched car's. One round slot each: icon inside, fire key beside it, weapon name beneath, dimmed
into one of
four states: full brightness when ready, a dimmed icon with a clockwise cooldown wedge while
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

A wrecked player becomes a spectator: `[` / `]` — or Left / Right — cycle the living cars, `V`
toggles free roam, and WASD or the arrows pan in free roam. All of it is local; the server has no
notion of who anyone is watching.

Spectating is gated on `isSpectating` (dead, in the match, during `MATCH`) and deliberately **not** on
"cannot drive right now" — the drive gate is also false during the countdown, and keying the camera
off it made the 3-2-1 follow whichever car sorted first by session id instead of your own.
