# Combat model

Everything that removes HP, and the rules that decide who it comes off. Balance numbers live in
`@motor-combat-moba/shared` config (`WEAPON_TABLE`, `COMBAT_CONFIG`, `CAR_TABLE`) — the tables below name
the knobs, not copies of them. See [`config-reference.md`](config-reference.md) for the values.

## Where combat runs

`runCombat` in `packages/shared/src/sim/combat.ts` is the whole step, pure and over plain objects.
The server calls it once per tick from `ArenaRoom.combatTick`, **after** `serverTick` has driven and
resolved every car, so hit tests read the poses cars actually ended the tick at.
`packages/server/src/sim/combat-bridge.ts` is the only file that knows about the Colyseus schema; it
maps `ArenaState` onto the POJOs and writes the answer back. No rules live there.

Combat is **server-only**. The client draws `state.weapons` and never predicts a shot or an HP
change: a mispredicted bullet is a phantom kill, and there is no honest way to reconcile "you were
dead for 80 ms". Prediction covers the local car's motion and nothing else.

## Ramming

Ram is a separate pass, not part of `combatTick`: `ArenaRoom.tick` runs `serverTick` (drive), then
`ramTick` (`packages/server/src/sim/ram-bridge.ts`), then `combatTick`. `ramTick` maps `ArenaState`
onto plain `RamCar`s and calls `applyRams`, the pure step in `packages/shared/src/sim/ram.ts` — no
schema, no room. Running between the two means ram detection reads the poses driving actually
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

## `applyDamage` is the only HP writer

```ts
applyDamage(hp, amount) // max(0, hp - amount); a non-positive amount changes nothing
```

Every source routes through it, so a later buff, shield, or damage cap is one edit. Nothing else may
subtract from `PlayerState.hp`. `hp === 0` sets `alive = false`; that is the wreck.

## Weapon

Every car carries an ordered list of weapons, `CAR_TABLE[car].weapons` — index 0 is slot 1, and
order *is* the slot mapping, so a chassis's whole identity (speed, attack, hp, guns) lives in one
table row. `WEAPON_SLOT_CONFIG.maxWeaponSlots` (3) caps how many slots any chassis may present; a
car listing more logs one `console.warn` naming the car and truncates the extras, never a thrown
error or a failed test. Today's roster ships three exclusive kits, one per chassis: Rectangle carries
`["fireball", "pepperbox", "afterburner"]`, Oval carries `["splinter", "skewer", "lance"]`, and
Hexagon carries `["thumper", "shockwave", "bulwark"]` — no weapon id appears on two chassis. See
[`config-reference.md`](config-reference.md) for the full table.

To add one, see [Authoring a weapon](#authoring-a-weapon) below; the sections between here and there
are the rules a weapon's stats are interpreted by.

`splinter` is Oval's slot 1 and the table's only multi-stock weapon — three stocks, a 400 ms
recharge, carried into every match rather than sitting only in unit-test fixtures, so a stock bug now
surfaces on screen rather than only in `fire.test.ts`.

### Firing input

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
so at the fireball's range it would span half the arena; a pure lane's angular width explodes near the
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

`skewer` is the table's reference row for `usesAimAssist: false`, as `fireball` is for `true`.
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
  on an obstacle, or outside the arena. A weapon's `volley` block (`volleys`, `volleyIntervalMs`,
  `pelletsPerVolley`, `spreadAngleDeg`) composes burst and spread in one place: `pelletsPerVolley`
  fans evenly and symmetrically about the car's heading and spawns on the same tick, each its own
  instance with its own pierce budget; sequential `volleys` exit on their own ticks, each from the
  car's pose *at that tick*. The burst holds the car's global fire lock for its whole duration — no
  other slot may fire until the last shot lands and `recovery` elapses — and the slot's own recharge
  starts at that **last** shot, so total downtime is burst duration + `cooldownMs`. Being wrecked
  mid-burst cancels the remaining shots. A plain single shot is simply a volley of 1/0/1/0.
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
  committed does not un-commit because its owner didn't survive to see it land. Beams are
  single-instance; `volley` does not apply to them.

Four chassis slots ship beams (`afterburner` and `shockwave` attached, `lance` and `bulwark`
detached), one ships a multi-pellet multi-volley burst (`pepperbox`), one ships `pierce` (`skewer`),
two ship a wind-up (`skewer`, `lance`), and six of the nine rows now carry `recoveryMs > 0` — none of
this is theoretical any more, and all of it is reachable from a real match. But "shipped and carried"
and "unit-tested by the weapon that carries it" are different claims, and several of these paths are
still only proven through code that predates the weapon which now exercises them in play. What the
tests do and do not reach, exactly:

- **Beam growth, clamping, attached re-anchoring/re-clipping, and expiry on `flight + lifetime`** are
  all real in play now — every beam grows, clips against walls, and (if attached) follows its owner
  the way `weapons/instances.test.ts` describes. But that suite still hand-builds a synthetic
  `kind: "beam"` instance over `fireball`'s row rather than driving a real beam id through it, and
  because that borrowed row's `lifetimeMs` is 0, the expiry test still asserts `flight` alone: **no
  test exercises a non-zero linger**, even though all four shipped beams have one (150–2500 ms).
- **Volleys.** Genuinely covered now: `weapons/fire.test.ts`'s "volleys and wind-up" block drives
  `pepperbox`'s real 3-volley/2-pellet burst through `beginFire`/`releaseShots` tick by tick, rather
  than hand-staging the `pending` a press would have produced.
- **Wind-up and the two clocks.** Also genuinely covered: `weapons/fire.test.ts`'s "the two lockouts"
  block drives `lance`'s real 700 ms `startUpMs` and 1000 ms `recoveryMs` through `beginFire` and
  `releaseShots`, including the same-weapon-in-two-slots case (`["lance", "lance"]`) that used to be
  illustrated only in prose.
- **The pellet fan.** Still only partially reached: `fanOffset` itself is tested directly and
  correctly, but `spawnInstances` — the function that actually turns `pelletsPerVolley` into multiple
  live instances — is still only ever driven with `fireball` in `weapons/instances.test.ts`. No test
  calls `spawnInstances` with `pepperbox` to prove the wiring from its `pelletsPerVolley: 2` through
  to two emitted pellets.
- **Pierce.** Also only partially reached: `hits.test.ts` tests the pierce-spending mechanism by
  hand-setting `pierceLeft` on a generic instance, and `instances.test.ts`'s only assertion that
  `spawnInstances` carries a weapon's `pierce` onto `pierceLeft` uses `fireball` (`pierce: 0`). No
  test derives `pierceLeft` from `skewer`'s real `pierce: 1` end to end.
- **`damageFrequencyMs > 0`, the re-arming per-target clock.** Still genuinely uncovered: `afterburner`
  (200 ms) and `bulwark` (400 ms) both ship it and re-tick a target still standing in them during a
  real match, but `hits.test.ts` only exercises `damageFrequencyMs: 0`'s arm-at-infinity behaviour,
  and `weapon-config.test.ts` / `weapon-ticks.test.ts` only pin the raw ms/tick values — no test
  drives an instance through a re-arm and a second hit on the same target.
- **`splinter`.** Driven through `runCombat` for real (`combat.test.ts`, "drives splinter, the
  table's only multi-stock weapon, through a real tick" — Oval's actual loadout, not a hand-built
  one), so the stock mechanic is no longer seen only in hand-built `FireState` literals.
- **Drawing.** `instanceDrawShape`'s beam branch runs on every screen now — any of the four shipped
  beams reaches it in a live match. The client-side unit test in `combat-visual.test.ts` still
  exercises that branch through a synthetic "claiming beam" fixture built over `fireball`'s numbers
  rather than a real beam weapon id, so it is covered by mechanism but not by a real def; `beamShapeAt`'s
  own rect and cone geometry is covered in `weapons/shapes.test.ts` regardless.

### Shaped hitboxes and the smear

Hitboxes are a nested tagged object on the weapon def — a cone cannot carry a circle's `radius`, nor
a beam a projectile's `pierce` — with one hit-test path underneath: circle-vs-OBB is exact, and
`ellipse` / `rect` / `cone` are converted to convex polygons at table-build time and run through the
same SAT the car hulls already use.

| Type | Shapes | Config |
|---|---|---|
| Projectile | `circle`, `ellipse` | `radius` / `radiusAlong` + `radiusAcross` |
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
damages (`fireball`'s value today), `2` damages up to three cars before dying. Teammates and wrecks
are not contacts at all — a shot passes through them freely and they consume no pierce, which falls
out of `canDamage` below. Walls, obstacles and the arena edge always destroy a projectile regardless
of pierce budget; pierce is about cars, never about cover. Beams never spend a pierce budget — they
are never destroyed by contact and may hit several cars on the same tick.

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

A wreck is not a target: shots pass through it rather than being spent on it.

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
Copy `fireball` for a projectile; there is no beam in the table yet, so a beam starts from the
`BeamWeaponDef` type. The union decides which fields you may write: `pierce` and `volley` exist only
on a projectile, `attached` and `lifetimeMs` only on a beam, and writing the wrong one is a compile
error rather than a silently ignored field.

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
inert but legal — every row in today's table happens to be carried by exactly one chassis (L1), but
nothing enforces that for a weapon still being authored.

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

**What to expect the first time.** No shipped weapon exercises a beam, a multi-pellet volley, a
wind-up or a non-zero recovery in live play — those paths are covered by unit tests only (see the
coverage list above). The first weapon that uses one is also that path's first real shakedown, so
watch the HUD dim states and the instance count on the wire.

**If you are re-tuning `fireball` rather than adding a weapon**, expect tests to fail on purpose.
Several read the real table at run time and hard-code numbers derived from it, so the suite is how
you find out which:

| File | Why it breaks |
|---|---|
| `config/weapon-config.test.ts` | Pins `fireball`'s stats digit-for-digit — the migration's zero-balance-change guard |
| `config/weapon-config.test.ts` | "keeps aim-assist weapons off the behavioural cliff" — `fireball`'s `cooldownMs` must stay outside ±15% of `1000 / AIM_CONFIG.lockTimeoutMs`. A 500 → 700ms nerf gives a sustained rate of 1.43 Hz against a 1.25 Hz cliff: `\|1.43 − 1.25\| / 1.25 = 0.143 < 0.15`, so the guard fires |
| `config/weapon-ticks.test.ts` | Pins the tick counts derived from them (`cooldown`, `flight`) |
| `sim/weapons/fire.test.ts` | Simulates recharge tick-by-tick across a hard-coded window |
| `sim/weapons/instances.test.ts` | Beam tests still borrow `weaponId: "fireball"` for its range rather than a real beam row — see the coverage list above |
| `sim/combat.test.ts` | The `50.5` offset is derived from the hitbox radius — only if you change the hitbox |

That last one is the subtle case: `50.5` places the two hulls 2.5 units apart, which must stay
inside the hitbox radius so the shot lands. At radius 12 there is plenty of headroom above; the
fixture breaks if the radius is ever cut below 2.5, and the failure looks like the fireball's damage
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

The roster is tuned so an average chassis (500 hull HP) kills another with the baseline weapon in
**5 seconds** at perfect accuracy, reckoned as `hullHP / DPS`.

## Elimination and winning

- HP reaches 0 → `alive = false`. The wreck stays on the field and stays **solid** — it is still an
  obstacle to everyone — and stops firing and being shot.
- After damage each tick, `livingSides(mode, roster)` counts the living sides. `sides <= 1` ends the
  match through the same `endMatch` a disconnect uses. FFA names a `winnerSessionId`; team mode names
  a `winnerTeam`; zero living sides is a draw (`-1`, `""`), which a mutual head-on kill can produce.
- Ending a match clears every shot in flight, and so does setting one up, so nothing from a previous
  match can carry into the next one.

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

A weapon may additionally carry a **look**: an entry in `WEAPON_GLOW_STYLES`
(`scenes/combat-visual.ts`) naming concentric bands to fill instead of the one flat disc, plus a
flicker. `fireball` has one; the other eight weapons in the table do not, and a weapon without one
keeps drawing exactly as everything drew before styles existed. Two rules keep this from undoing
the paragraph above. Bands
are fractions of the instance's own hitbox radius rather than world distances, so the glow rescales
with any hitbox re-tune. And the flicker only ever *shrinks* the rim, never grows it — a flicker
that could push past the hitbox would make the drawn shot larger than the thing that hits. Styles
are deliberately per weapon and not a shared formula over `color`: each weapon is meant to have its
own silhouette in flight, and a shared ramp would make every weapon a differently-tinted copy of
one object.

Its fill is the **weapon's** `color` (`weaponFillOf`), not the firing player's. Every fireball shot in
the arena is the same ember orange whoever fired it: a shot's colour answers "what is coming at me",
and the car that fired it is already on screen wearing the player colour, so spending the shot's one
colour channel on ownership would say the less useful thing twice. Shots were owner-coloured before
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

Four chassis slots carry a beam (`afterburner`, `shockwave`, `lance`, `bulwark`) and one carries a
multi-pellet, multi-volley weapon (`pepperbox`), so the beam half of the drawing code above runs in
every live match now: `instanceDrawShape` branches on the weapon definition's own `kind`, and a
`beam` definition is reachable the moment any of those four fires. What the *tests* for that branch
do and do not reach is narrower than what play reaches — see the coverage list under
[Instances: two lifecycles](#instances-two-lifecycles) for exactly what the sim-side and client-side
tests do reach.

Living cars carry an HP bar scaled to their own chassis maximum (`hpFraction`), and a wreck fades to
`WRECK_ALPHA` and stops being predicted or interpolated.

A wrecked player becomes a spectator: `[` / `]` — or Left / Right — cycle the living cars, `V`
toggles free roam, and WASD or the arrows pan in free roam. All of it is local; the server has no
notion of who anyone is watching.

Spectating is gated on `isSpectating` (dead, in the match, during `MATCH`) and deliberately **not** on
"cannot drive right now" — the drive gate is also false during the countdown, and keying the camera
off it made the 3-2-1 follow whichever car sorted first by session id instead of your own.
