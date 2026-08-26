# Combat model

Everything that removes HP, and the rules that decide who it comes off. Balance numbers live in
`@motor-combat-moba/shared` config (`WEAPON_CONFIG`, `COMBAT_CONFIG`, `CAR_TABLE`) — the tables below name
the knobs, not copies of them. See [`config-reference.md`](config-reference.md) for the values.

## Where combat runs

`runCombat` in `packages/shared/src/sim/combat.ts` is the whole step, pure and over plain objects.
The server calls it once per tick from `ArenaRoom.combatTick`, **after** `serverTick` has driven and
resolved every car, so hit tests read the poses cars actually ended the tick at.
`packages/server/src/sim/combat-bridge.ts` is the only file that knows about the Colyseus schema; it
maps `ArenaState` onto the POJOs and writes the answer back. No rules live there.

Combat is **server-only**. The client draws `state.projectiles` and never predicts a shot or an HP
change: a mispredicted bullet is a phantom kill, and there is no honest way to reconcile "you were
dead for 80 ms". Prediction covers the local car's motion and nothing else.

## `applyDamage` is the only HP writer

```ts
applyDamage(hp, amount) // max(0, hp - amount); a non-positive amount changes nothing
```

Every source routes through it, so a later buff, shield, or damage cap is one edit. Nothing else may
subtract from `PlayerState.hp`. `hp === 0` sets `alive = false`; that is the wreck.

## Weapon

One weapon, identical on every chassis — the cars differ in speed, strength, and HP, not in what
they shoot.

| Rule | Where |
|---|---|
| Fired by `InputMessage.fire`, gated by `weaponCooldown` | `runCombat` |
| Cooldown ticks = `ceil(TICK_RATE_HZ / WEAPON_CONFIG.fireRateHz)` | `fireCooldownTicks()` |
| Spawns at the car's nose, `DRIVE_CONFIG.carWidth / 2` ahead of centre | `muzzleOffset()` |
| Flies straight at `WEAPON_CONFIG.projectileSpeed`, no drag, no inheritance of car speed | `stepProjectile` |
| Dies on `WEAPON_CONFIG.lifetimeTicks`, on an obstacle, or outside the arena | `projectileExpired`, `projectileHitsObstacle` |
| Deals `WEAPON_CONFIG.damage` to the first car it may damage, then is spent | `runCombat` |

Holding fire and tapping it are the same rate: the cooldown gates shots, not the key.

Firing rides the same gate as movement. `serverTick` reports which session ids asked to fire on an
input it actually **simulated**, so an input past `NET_CONFIG.maxInputsPerTick` cannot buy a shot the
sim never ran, and a lobby player spamming `fire` spawns nothing.

### Who may damage whom

`canDamage(ownerId, ownerTeam, targetId, targetTeam, mode)` is the **single** friendly-fire
predicate, used by both the weapon and ramming, so the two can never disagree about who is on your
side:

- **Never yourself.** A shot is born on the shooter's own hull; without this every shot would kill
  its own shooter on the tick it was fired.
- **FFA:** anyone else. Teams are only seating.
- **Team:** enemies only. A shot passes straight through a teammate and keeps going, and a teammate
  contact deals no ram damage.

A wreck is not a target: shots pass through it rather than being spent on it.

### Hit test

A shot is a **point**, tested against the target's car OBB (`pointInObb` against `carHullOf`) — the
same box driving collides with, never the drawn silhouette. One shot damages **one** car, picked in
sorted `sessionId` order so two overlapping cars resolve reproducibly.

Two deliberate v1 limits:

- **No swept test.** At 900 u/s a shot moves 30 units per tick and is sampled once, so it could
  straddle anything thinner than that. `ARENA_01` is empty, so nothing there to straddle; an arena
  that does carry obstacles must keep every one of them at least 30 units thick for the point test
  to hold.
- **No lag compensation.** Hits are tested on the current tick with no rewind, so a shooter on 80 ms
  leads a moving target by roughly their own latency. Rewind-and-replay is the standard fix and is
  out of scope for v1.

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

`ArenaScene` draws shots from `state.projectiles` only, extrapolated along their own constant
velocity between patches (`extrapolateShot`, capped at one patch interval) — exact rather than a
guess, because the server integrates the identical straight line. Living cars carry an HP bar scaled
to their own chassis maximum (`hpFraction`), and a wreck fades to `WRECK_ALPHA` and stops being
predicted or interpolated.

A wrecked player becomes a spectator: `[` / `]` — or Left / Right — cycle the living cars, `V`
toggles free roam, and WASD or the arrows pan in free roam. All of it is local; the server has no
notion of who anyone is watching.

Spectating is gated on `isSpectating` (dead, in the match, during `MATCH`) and deliberately **not** on
"cannot drive right now" — the drive gate is also false during the countdown, and keying the camera
off it made the 3-2-1 follow whichever car sorted first by session id instead of your own.
