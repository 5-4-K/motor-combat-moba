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

## `applyDamage` is the only HP writer

```ts
applyDamage(hp, amount) // max(0, hp - amount); a non-positive amount changes nothing
```

Every source routes through it, so a later buff, shield, or damage cap is one edit. Nothing else may
subtract from `PlayerState.hp`. `hp === 0` sets `alive = false`; that is the wreck.

## Weapon

Every car carries an ordered list of weapons, `CAR_TABLE[car].weapons` — index 0 is slot 1, and
order *is* the slot mapping, so a chassis's whole identity (speed, strength, hp, guns) lives in one
table row. `WEAPON_SLOT_CONFIG.maxWeaponSlots` (3) caps how many slots any chassis may present; a
car listing more logs one `console.warn` naming the car and truncates the extras, never a thrown
error or a failed test. Today's whole roster carries a single slot, `["cannon"]` — see
[`config-reference.md`](config-reference.md) for the table.

`WEAPON_TABLE` also ships `repeater`, which **no car carries**, on purpose. It is the only
multi-stock weapon in the table — D5's worked example (3 stocks, a 3 s recharge) transcribed
literally — kept as the live reference for the stock mechanic and the fixture the stock unit tests
exercise. `cannon` had to ship single-stock to keep the migration a zero-balance-change diff, so
nothing in the released roster could prove stocks honestly without `repeater`. It is not dead
config; do not delete it because nothing spawns it.

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

### One fire state machine per car

A car is in exactly one state — `idle → startUp → (fire) → recovery → idle` — tracked **once per
car**, not once per slot, so a burst from one weapon has a single, unambiguous meaning for what else
may fire while it runs. Presses are **ignored**, never queued or buffered:

- Mid wind-up or mid-volley (`pending !== null`), **every** press is ignored, including one for the
  weapon already firing.
- Mid recovery, a press for a **different** weapon is ignored; the weapon that just fired is gated
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
| `stock.refireDelayMs` | How soon may **this** weapon fire again? |
| `recoveryMs` | How soon may a **different** weapon fire? |

`recoveryMs` is not a universal post-fire lockout: `repeater`'s `cooldownMs: 3000` /
`recoveryMs: 5000` means it is refirable by itself after 3 s while every other slot waits 5 s.
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
  stamped, and a projectile already in flight, finish their lives regardless, mirroring the ram rule
  that a car dying in a trade still lands its own damage. Beams are single-instance; `volley` does
  not apply to them.

No car in the shipped roster carries a beam or a multi-pellet/multi-volley weapon — `cannon` is a
plain single shot — so none of this has ever been seen working on a screen, which is worth knowing
if you are chasing a bug in it. What the tests do and do not reach, exactly:

- **Beams.** Growth, the `min(range, wall)` clamp, attached re-anchoring and re-clipping as the car
  turns, and expiry on `flight + lifetime` are covered in `weapons/instances.test.ts` by hand-building
  a `kind: "beam"` instance over `cannon`'s row (the same trick `combat.test.ts` uses for the
  ownership gate). Because that row is a projectile, its `lifetimeMs` is 0: **no test exercises a
  non-zero linger**, and none can until a beam is authored.
- **Volleys.** `releaseShots`' multi-shot path and the recharge landing on the burst's *last* shot
  are covered in `weapons/fire.test.ts` by hand-staging the `pending` a press would have produced.
- **The pellet fan.** Tested as `fanOffset` directly, not through `spawnInstances`, which can only
  ever emit one pellet against today's table.
- **`repeater`.** Driven through `runCombat` once (`combat.test.ts`, "drives repeater… through a real
  tick") so the stock mechanic is not only ever seen in hand-built `FireState` literals.
- **Drawing.** `instanceDrawShape` branches on the weapon definition's `kind`, so its beam branch is
  unreachable until a beam ships and is **not** covered; `beamShapeAt`'s own rect and cone geometry
  is covered in `weapons/shapes.test.ts`.

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
damages (`cannon`'s value today), `2` damages up to three cars before dying. Teammates and wrecks
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
predicate, used by every weapon instance and ramming alike, so the two can never disagree about who
is on your side:

- **Never yourself.** A shot is born on the shooter's own hull; without this every shot would kill
  its own shooter on the tick it was fired.
- **FFA:** anyone else. Teams are only seating.
- **Team:** enemies only. A shot passes straight through a teammate and keeps going, and a teammate
  contact deals no ram damage.

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

## Ramming

Contact damage between two cars, judged by **facing** rather than by speed. Getting behind someone is
the play; being fastest is not.

`isRamming(ax, ay, angle, bx, by, threshold)` is `dot(forward, normalize(b - a)) >= threshold`, with
`threshold` = `COMBAT_CONFIG.ramDotThreshold`. Coincident centres are never a ram — there is no
direction to face.

| Contact | Outcome | Damage |
|---|---|---|
| A drives into B's rear; B faces away | `a_hits_b` | B takes A's strength |
| Head-on, both facing each other | `both` | Each takes the other's strength |
| Sideswipe, neither facing the other | `none` | Nobody takes anything |

Damage is `CAR_TABLE[carId].strength * COMBAT_CONFIG.collisionDamagePerStrength`, from the
**attacker's** chassis. A head-on is dealt from the pre-hit state on both sides, so a car that dies in
the trade still lands its own damage — there is no first-strike advantage.

### Contact, not interpenetration

Rams are checked for every pair of living roster cars whose hulls are **in contact** —
`obbsInContact`, which inflates both hulls by `COMBAT_CONFIG.ramContactPad` before running the same
SAT the driving resolver uses.

The padding is load-bearing, not a fudge. Collision resolution runs *before* combat and pushes a car
out to exactly the separation boundary, so two cars that just crashed end the tick touching at a
measured gap of **zero** — and the SAT treats "just touching" as separated. Asking `obbsOverlap`
therefore returns false on every single tick of a real ram, which is exactly the bug that shipped
past a full suite of unit tests: they hand-placed the cars overlapping, a state the sim never
produces. The pad stays small (1 unit per hull, so 2 units of gap tolerance) because the cars rebound
to a 2–8 unit gap on the ticks after impact, and a larger pad would deal damage for near misses.

The regression tests for this drive real cars into each other through `stepSim` rather than placing
them — see the "ramming, driven through the real sim" block in `combat.test.ts`.

A damaging contact puts that **pair** on a
`COMBAT_CONFIG.collisionDamageCooldownTicks` cooldown, so grinding along someone cannot drain HP at
30 Hz. Cooldowns are per pair, server-only, and pruned once expired; a third car still connects while
a pair is cooling down.

**Friendly fire is off for rams as well as shots.** In team mode a teammate contact costs nobody hp
and does not burn the pair cooldown — otherwise shoving past your own side would swallow a real enemy
ram a few ticks later. Teammates still *collide*: they shove each other around, they just cannot hurt
each other. The gate is the same `canDamage` the weapon uses, so shots and contact can never disagree
about who is on your side. In FFA, teams are only seating, and everyone can ram everyone.

## Elimination and winning

- HP reaches 0 → `alive = false`. The wreck stays on the field and stays **solid** — it is still an
  obstacle to everyone — and stops firing, ramming, and being shot.
- After damage each tick, `livingSides(mode, roster)` counts the living sides. `sides <= 1` ends the
  match through the same `endMatch` a disconnect uses. FFA names a `winnerSessionId`; team mode names
  a `winnerTeam`; zero living sides is a draw (`-1`, `""`), which a mutual head-on kill can produce.
- Ending a match clears every shot in flight and every ram cooldown, and so does setting one up, so
  nothing from a previous match can carry into the next one.

## What the client shows

`ArenaScene` draws every live instance from `state.weapons` — projectile and beam rows in one map,
discriminated by `kind` — and never predicts a shot or an HP change. A projectile is extrapolated
along its own constant velocity between patches (`extrapolateShot`, capped at one patch interval); a
beam's `extent` is extrapolated the same way under the same cap, and an attached beam is drawn off
its owner's **rendered** pose so it does not visibly lag the car it is welded to. Both are exact
rather than a guess, because the server integrates the identical motion, and nothing either produces
feeds back into state. An instance is drawn from its own hitbox shape and dimensions, never a
sprite — what you see is the hitbox, so a new weapon is playable with no art at all.

A camera-fixed slot bar along the bottom centre shows the local player's weapons — or, while
spectating, the watched car's — one box per slot, icon above, key glyph below, dimmed into one of
four states: full brightness when ready, a dimmed icon with a clockwise cooldown wedge while
recharging, a heavier *static* dim when the slot is not unlocked yet, and a lighter dim across every
slot during a wind-up or volley (or across the other slots during recovery). Locked and recharging
use different, deliberately distinguishable dims so "you don't have this yet" can never be mistaken
for "back in a few seconds." See [`asset-pipeline.md`](asset-pipeline.md) for how a slot's icon
resolves and its procedural fallback.

No car in the shipped roster carries a beam or a multi-pellet/multi-volley weapon, so the beam half
of the drawing code above never runs — not in play and not under test either, since
`instanceDrawShape` branches on the weapon definition's own `kind` and no definition says `beam`.
Seeing it draw means adding such a weapon to a car's `CAR_TABLE` loadout. See the coverage list
under [Instances: two lifecycles](#instances-two-lifecycles) for exactly what the sim-side tests do
reach.

Living cars carry an HP bar scaled to their own chassis maximum (`hpFraction`), and a wreck fades to
`WRECK_ALPHA` and stops being predicted or interpolated.

A wrecked player becomes a spectator: `[` / `]` — or Left / Right — cycle the living cars, `V`
toggles free roam, and WASD or the arrows pan in free roam. All of it is local; the server has no
notion of who anyone is watching.

Spectating is gated on `isSpectating` (dead, in the match, during `MATCH`) and deliberately **not** on
"cannot drive right now" — the drive gate is also false during the countdown, and keying the camera
off it made the 3-2-1 follow whichever car sorted first by session id instead of your own.
