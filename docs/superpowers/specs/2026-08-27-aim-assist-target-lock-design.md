# Motor Combat MOBA — Aim Assist and Target Lock Design

**Designed:** 2026-08-27 · **Recorded in repo:** 2026-08-27
**Status:** Draft, awaiting approval. Not implemented.
**Plan:** not yet written.

---

## Problem

Every weapon fires along the car's heading. `spawnInstances` derives both the muzzle position and
the travel angle from `owner.angle`, so firing direction is welded to the car's face and aiming is
purely a driving problem.

Some weapons should instead **lock onto an enemy** and fire in that direction. The lock decides the
firing *direction only*: the projectile is a normal instance, frozen to its exit pose, with no
homing and no mid-flight correction. Which weapons behave this way must be configurable, and the
geometry and feel of the lock must be tunable without touching logic.

## Constraints

1. The hard invariants in `CLAUDE.md` hold. In particular: no magic numbers in logic, balance lives
   in shared config, and anything `stepSim` reads is a networked schema field.
2. Combat is **server-only** and stays so (`runCombat`). The client predicts its own motion and
   nothing else, so it must not predict, compute, or arbitrate a lock.
3. `runCombat` stays pure over plain objects. All rules land in `@motor-combat-moba/shared`;
   `combat-bridge.ts` keeps holding zero rules.
4. Ramming, the drive model, the OBB hull model and friendly fire are not touched.
5. v1 is LAN, but online play is planned. Nothing here may make competitive integrity structurally
   unreachable later.
6. Existing weapons must be unchanged by default — adding the system ships zero balance change.

## Non-goals

- **Homing or tracking projectiles.** The lock sets an exit angle; the instance is dumb thereafter.
- **Lead prediction / target interception.** The lock aims where the target *is*. See
  [Future work](#future-work) — this is the single largest known limitation.
- **Client-side prediction of the lock.** Server decides, client draws.
- **Per-weapon lock geometry.** Deliberately deferred; see A1.
- **Aim assist as an input-space nudge** (rotating the car, or biasing steering). The car's heading
  is never touched — only the shot's exit angle.
- **A separate weapon-selection input.** There is none today; pressing a slot key fires it.
- Lag compensation, ammunition, and the level system — all already out of scope in the weapon spec.

---

## Decisions

### A1 — Aim assist is a per-weapon boolean; the geometry is global

`WeaponBase` gains `usesAimAssist: boolean`. All geometry and feel numbers live once, in a new
`AIM_CONFIG`. A weapon either uses the car's single lock or fires along the heading, exactly as today.

There is **one lock per car**, not one per slot.

Rejected alternatives:

- **Per-slot locks with per-weapon cones.** More expressive, and the only reading under which a
  per-weapon `coneDeg` fully means what it says. Rejected on cost: up to three lock state machines
  per car (~9 fields instead of ~4), up to three brackets needing slot tagging in both the HUD and
  spectate, three commit/retention timers driven by a single per-car engagement clock, and every
  "release on target death" cleanup path running three times. Four corner cases bought for an
  expressiveness no shipped content needs — all three chassis carry exactly one slot, `["cannon"]`.
  The migration back is additive if a second aim-assist weapon ever wants a different cone: the
  boolean widens to an optional block and the lock splits per slot, decided against two real
  weapons rather than guessed at now.
- **One lock, cone taken from `lastFiredSlot`.** `lastFiredSlot` only moves when a shot is
  *committed*, so the first shot from a newly pressed slot would fire through the previously fired
  weapon's cone. A staleness bug with no clean fix.
- **One lock, cone = the union (widest) of the carried weapons' cones.** A weapon could then hold a
  lock its own cone rejects, so a visible bracket would fire straight ahead — the HUD lying about
  where the shot goes.
- **One lock, cone = the intersection (narrowest).** Adding a narrow-cone weapon to a loadout would
  silently nerf every other slot's assist: config coupling between weapons that never touch.

### A2 — Acquisition region: cone ∩ lateral cap ∩ lock range

A target is acquirable only if **all** hold:

| Bound | Test | Why |
|---|---|---|
| Cone | `abs(angleDeg) <= coneDeg` | "In front of me" at contact range |
| Lateral cap | `distance * sin(abs(angle)) <= lateralMax` | "In front of me" at long range |
| Lock range | `distance <= lockRange` | A3 |

`angleDeg` is signed, measured from the car's heading to the vector from car centre to target centre.

A pure cone was rejected because its width scales with distance, and the arena is small. At 20° the
half-width is `0.36 × distance`: 73 u at 200 u, but **327 u at `cannon`'s 900 u range** — a 654 u
wide region in a 1280 u wide arena. Since ramming is a core mechanic and cars spend much of a match
within a couple of car lengths of one another, a wide region at contact range is not an edge case.

A pure lateral lane was rejected for the mirror-image reason: a constant lateral tolerance has an
angular width that *collapses* with distance and *explodes* near the car. A 120 u lane accepts a
target 13 u ahead sitting **83° off the nose** — during a scrum, an aim-assist weapon would fire
sideways at whoever is nearest your flank while you are looking at someone else. With ambient
locking (A4) the trigger cannot override it.

| Enemy ahead by | Where a 120 u lane's edge sits, off the nose |
|---|---|
| 13 u | 83° |
| 60 u | 63° |
| 200 u | 31° |
| 330 u | 20° — the crossover with a 20° cone |
| 900 u | 7.6° |

Intersecting the two gives a true cone out to `lateralMax / tan(coneDeg)` ≈ 330 u, then a constant
240 u wide lane beyond. The cone term keeps "in front of me" meaningful at contact range; the
lateral term keeps it meaningful at long range. Neither survives alone.

A side benefit: the lateral cap removes the structural bias toward far targets sitting near the
centreline, so `scorePerDistanceUnit` (A5) is purely a feel knob rather than load-bearing.

### A3 — Lock range is its own number, well below weapon range

`lockRange` is a global 400 u, not the firing weapon's `range`.

The lock aims at where the target **is**, with no lead. A shot to 900 u takes 1.0 s, during which a
540 u/s car covers 540 u. Inheriting weapon range would make the far half of every lock reliably
acquire and reliably miss — a strong-looking snap that whiffs, which reads as the system being
broken rather than as a skill boundary.

Known consequence, stated plainly: against a target crossing at full speed, a no-lead lock only
hits inside roughly **47 u**. Displacement during flight is `(targetSpeed / projectileSpeed) ×
distance`; at 540 / 900 that is `0.6 × distance`, against a tolerance of about 28 u (half a car's
32 u width plus `cannon`'s 12 u hitbox). Aim assist is therefore genuinely useful against
approaching, receding, slow, or mostly-radially-moving targets, and near-cosmetic against a
full-speed crosser. That is what "sets direction, not lead" means. See [Future work](#future-work).

Rejected: **`lockRange` derived as `min(globalLockRange, weapon.range)`.** It sounds safer but
reintroduces per-weapon geometry through the back door, and with A1's single lock it would mean one
weapon's `range` edit changing another slot's lock. Handled instead by validation (A9).

### A4 — Ambient lock: the trigger fires, it never targets

The lock is maintained every tick whenever a valid target exists, whether or not the player is
firing. Pressing fire has exactly one effect on targeting: it refreshes the engagement timer (A8).

Firing is **never blocked**. With no lock, a weapon fires along the car's heading — identical to
today's behaviour.

Rejected: **acquire on trigger press.** It makes the bracket a post-hoc report of a decision already
taken, so the player never sees what they are about to shoot before they shoot it.

### A5 — Score: angle plus distance, lowest wins

```
score = abs(angleDeg) + distance * AIM_CONFIG.scorePerDistanceUnit
```

Lowest score wins. The distance term prevents a bias toward far targets that naturally sit near the
centreline, and its coefficient is the lever for how close-range the game feels.

**The coefficient is per world unit, and the unit matters more than the digit.** This game has no
metres — the world is in units, cars are 48 × 32. Written as `distance × 0.4`, a target at 400 u
scores 160 against an angle term that maxes at 20: the angle becomes noise and the result is
"always nearest target", not a scoring system. For the two terms to trade off across a 400 u lock
range the coefficient is **0.04 per world unit**. The field is named `scorePerDistanceUnit` so the
unit is unmissable at the call site.

Distance and angle are both measured car centre to car centre. (The *fired* angle is measured from
the muzzle — see A11.)

### A6 — Retention pads all three bounds, not just the angle

An already-locked target is retained while it stays inside every acquisition bound widened by its
own pad: `coneDeg + retentionConeDeg`, `lateralMax + retentionLateralUnits`, `lockRange +
retentionRangeUnits`.

Padding only the angle — the natural reading of "retain within cone + 5°" — would do nothing at
long range, where the lateral cap is the binding constraint. A target 400 u out crosses the lane
edge at about 17°, nowhere near the cone, so it would exit with zero hysteresis and produce exactly
the edge flicker the pad exists to prevent. Three bounds, three pads.

Pads are kept small. Wider retention starts to feel like an aimbot rather than like assistance.

### A7 — Steal: a margin and a commit timer, no spin-up penalty

A different target replaces the current one only if **both** hold:

- `candidateScore <= currentScore * (1 - AIM_CONFIG.stealMarginFraction)` — 25% better, and better
  means lower.
- `tick - lockedAtTick >= commitTicks` — at least 0.4 s since the last lock change.

There is no spin-down/spin-up penalty and no accuracy cost for switching. The margin and the commit
timer supply enough friction on their own; a third mechanism would be tuning surface with no
distinct job.

Acquiring from *no* lock has no margin and no commit gate: there is no incumbent to beat.

### A8 — Release: five conditions, one flat timeout

The lock is released when any of these holds:

1. The target stops being a valid target — wrecked, out of the roster, or disconnected.
2. It leaves any retention bound (A6).
3. Line of sight has been broken for longer than `losGraceMs` (A10).
4. No fire press on **any slot** for `lockTimeoutMs`.
5. The owner stops fighting. A wreck holds no lock.

**Condition 4 refreshes on a press of any slot, not only the aim-assist slot.** The timer answers
"has this player disengaged?", which is a fact about the driver, not about a gun.

**The timeout does not leave you unlocked.** This is the non-obvious part. Release and re-acquisition
happen in the same pass of the same tick (A13), so a lapsed timer does not blank the bracket for a
frame — it strips the current target's *incumbency*, and the next evaluation picks the best-scoring
target with no margin applied. The timeout's real job is to drop hysteresis, not to drop the lock.

That is what produces the two behavioural classes:

| Sustained fire rate | Behaviour |
|---|---|
| Faster than `1000 / lockTimeoutMs` | Presses keep refreshing the timer; incumbency never lapses, so the 25% margin governs |
| Slower | The timer lapses between shots; every shot fires at the currently best target |

Weapons authored near that cliff feel inconsistent, which is what A9 guards.

### A9 — Config validation, so tuning cannot silently break targeting

Four assertions in `weapon-config.test.ts` / `config.test.ts`, in the same spirit as the existing
`brakeDecel > drag` and camera-speed checks:

1. **`0 < coneDeg < 90`.** At 90° or more the cone stops meaning "in front".
2. **`lateralMax > 0` and `lockRange > 0`.**
3. **An aim-assist weapon's `range` must be `>= lockRange`.** Closes the one corner case A1's single
   lock leaves open: a weapon locking a target it cannot reach, firing at a visible bracket and
   falling short. Caught at authoring time rather than in play.
4. **No aim-assist weapon's sustained fire rate may sit within ±15% of the behavioural cliff.** The
   cliff is *derived* — `1000 / lockTimeoutMs` — so retuning the timeout moves the guard band with
   it rather than stranding a hardcoded range. Sustained rate is `1000 / cooldownMs` for every
   weapon: a stocked weapon still needs one `cooldownMs` per stock, and `refireDelayMs` only spaces
   a burst. The check is per weapon row and therefore conservative — a multi-slot car only ever
   presses *more* often, which moves it away from the cliff, never toward it.

Assertion 4 exists because `cooldownMs` is tuned constantly for reasons that have nothing to do with
targeting. Nerfing `cannon` from 500 ms to 700 ms would, under a 0.6 s timeout, silently move it
between behavioural classes with nothing in the diff mentioning aim assist.

### A10 — Line of sight: real check, 0.3 s grace, wrecks are not cover

A target is visible when no obstacle sits between the muzzle and the target centre, tested with the
existing `wallClipDistance` raycast (`sim/weapons/instances.ts`) already used for beam clipping.
Losing sight does not release immediately; the lock survives `losGraceMs` of obstruction and is
released only if sight has not returned.

The check is a **no-op in every shipped match**: `ACTIVE_ARENA_ID` is `arena-01`, whose `obstacles`
is `[]`. It is built now anyway because changing arenas is deliberately a one-line edit, and
`arena-02` (2000 × 2000, with obstacles) already exists — without the check, that one line silently
turns aim assist into lock-through-walls with no targeting code touched. The grace timer is built
with it for the same reason: it is one field and one comparison, unit-testable against hand-built
obstacles, and it needs to already be correct the day `arena-02` goes live.

**Wrecks do not block line of sight.** A wreck is solid to *driving* but transparent to *combat* —
`runCombat` builds its hit snapshot from `players.filter(isFighting)`, so shots pass straight through
a wreck and it does not even consume a pierce budget. Treating it as cover would drop the lock for an
obstruction that demonstrably does not stop the bullet. This also survives the planned respawn
change: during the window where a destroyed car is playing its explosion and has not yet
disappeared, it is already not a valid target but is still visibly present, and "ignore it" is the
rule that keeps working unaltered.

Arena bounds are ignored: `wallClipDistance` tests them, but every target is inside the arena by
construction, so the branch never fires.

### A11 — Fire geometry: aim from the muzzle, keep the muzzle where it is, re-read per shot

Three parts, all in `spawnInstances`, which today derives both position and angle from `owner.angle`:

**a) The fired angle is measured muzzle-to-target, not centre-to-target.** The muzzle sits
`carWidth / 2` = 24 u ahead of centre. Scoring (A5) uses the car centre because "angle off your nose"
is a fact about the car's facing, but firing from a centre-derived angle eats a parallax error — at a
target 100 u out and 40° off, roughly a car length of miss. Cheap to get right, invisible if wrong.

**b) The muzzle position does not move.** It stays the car's physical nose. If the lock moved it, a
wide-angle lock would spawn shots off the side of the hull in open space.

**c) The pellet fan and sequential volleys re-read the lock at each shot's own tick.** `fanOffset`
fans about the lock direction instead of `owner.angle`, and each volley in a burst re-derives the
current lock rather than inheriting shot 1's.

(c) is the direct translation of the existing rule that a burst's shots each exit from the car's pose
*at their own tick* — which is what makes a burst steerable. Stamping the angle at shot 1 while (b)
keeps the origin live would be the only place in the weapon system where those two come apart.

Stamping was rejected on four further counts. It turns a burst into a one-shot weapon against
anything moving at exactly the range where assist works at all: at 60 u against a 350 u/s crosser,
shot 1 lands and shots 2 and 3 miss by 58 u and beyond, because they still aim where the car was
100 ms and 200 ms ago. It fires shots 2 and 3 into the empty space where a target that died to shot
1 used to be. It exempts bursts from the steal margin entirely, so the friction system does not
govern the weapons where switching matters most. And it silently couples burst duration to whether
assist means anything — a 5-volley/150 ms weapon spans 600 ms, in which a fast car covers 324 u, so
its tail is dead with nothing in config saying so.

It is also the more expensive option to build: re-read reads the car's current lock at spawn time and
needs no new state, while stamping must freeze the angle at press time and thread it through
`PendingFire` → `ShotOrder` → `spawnInstances`.

Accepted consequence: if the lock releases mid-burst with no valid target, shots 2 and 3 swing to
straight ahead and the burst visibly changes direction. That is A4's "no valid target = fire straight
ahead" doing what it says, and the alternative is firing at a car that is not there.

### A12 — `usesAimAssist` is rejected on an attached beam

An `attached: true` beam re-derives its origin and angle from the owner's pose every tick. Aim assist
on one would snap at birth and immediately re-weld to the car's nose. The combination is rejected in
`weapon-config.test.ts`, not silently resolved.

Making an attached beam track the lock every tick was rejected: it is a far stronger weapon than its
numbers suggest — a permanently on-target sweeping beam — and it is not a decision to make
implicitly, in a codebase where no beam ships at all.

### A13 — One pure function, one pass, one bracket

Lock evaluation is a single pure function in a new `sim/weapons/lock.ts`, run once per car per tick.
Release, steal and acquisition resolve in that one pass, so a released lock that is immediately
re-acquirable never produces an unlocked frame (A8).

The client draws a **lock bracket** on the current target, read straight off the wire. No
prediction, no client-side scoring — combat is server-only, and a mispredicted bracket is a lie
about where your shot is going.

Rejected: **a "soft bracket"** showing the would-be target while unlocked. It doubles the HUD states
for a car that is by definition not about to shoot anything.

### A14 — Lock state is server-only; only the target id crosses the wire

`LockState` lives in `CombatMemory` beside `fireStates` — server-owned, keyed by session id, never
networked. `PlayerState` gains exactly one field, `lockTargetSessionId`, written back by
`applyCombatResult` in the same way `pendingUntilTick` already is: the client is told the *result*,
never the machine.

`clearInstances` clears locks along with fire states, so no lock survives a match end or setup —
the same rule that already stops a shot in flight carrying into the next match.

---

## Architecture

### Config

`packages/shared/src/config/aim-config.ts`:

```ts
export const AIM_CONFIG = {
  coneDeg: 20,
  lateralMax: 120,
  lockRange: 400,

  retentionConeDeg: 5,
  retentionLateralUnits: 30,
  retentionRangeUnits: 60,

  scorePerDistanceUnit: 0.04,
  stealMarginFraction: 0.25,

  commitMs: 400,
  lockTimeoutMs: 800,
  losGraceMs: 300,
} as const;
```

Durations are milliseconds and are converted to ticks once, alongside `WEAPON_TICKS` — never write
ticks (D6).

`weapon-types.ts` gains one required field on `WeaponBase`:

```ts
/** true = this weapon fires at the car's lock. false = welded to the car's heading. */
usesAimAssist: boolean;
```

Required rather than optional, so every existing row must state its answer and adding a weapon
cannot forget to.

### Lock state

```ts
export interface LockState {
  /** Session id of the locked target, or "" for no lock. */
  targetSessionId: string;
  /** Tick the current target was acquired. Gates the commit timer. */
  lockedAtTick: number;
  /** Tick line of sight was first lost, or 0 while visible. Gates the LOS grace. */
  losLostSinceTick: number;
  /** Tick of the most recent fire press on any slot. Gates the engagement timeout. */
  lastPressTick: number;
}
```

Four fields, one per car. `CombatPlayer` carries it in and out the way `fireState` already does;
`CombatMemory` gains `locks: Map<string, LockState>`.

### Tick order

`runCombat` gains one phase, between stepping existing instances and resolving presses:

```
tickRecharge -> step existing instances -> UPDATE LOCKS -> beginFire -> releaseShots -> hits -> ramming
```

It must run before `beginFire`/`releaseShots`, because `spawnInstances` reads the lock to aim
(A11c). It runs after driving has resolved for the tick, like the rest of combat, so scoring and the
LOS raycast read the poses cars actually ended the tick at.

A target wrecked during *this* tick's hit resolution is still locked until the next tick's update.
That is the same one-tick seam the pose snapshot already accepts, and at 30 Hz it costs at most one
shot.

### Module layout

One new file, matching the `sim/weapons/` module set (D21):

- `sim/weapons/lock.ts` — `updateLock`, the scoring and region predicates, and the LOS test. Pure,
  over plain objects, no schema.
- `sim/weapons/lock.test.ts`.
- `sim/weapons/instances.ts` — `spawnInstances` gains an optional aim angle; `fanOffset` fans about
  it. No other call site changes.
- `sim/combat.ts` — one new phase, and the lock passed into `spawnInstances`.
- `config/aim-config.ts` — new.
- `schema/PlayerState.ts` — one field.
- `server/src/sim/combat-bridge.ts` — carry `locks` in `CombatMemory`, write `lockTargetSessionId`
  back, clear locks in `clearInstances`.
- Client `ArenaScene` — draw the bracket.

`canDamage` is reused as the targeting predicate, so the lock can never disagree with the shot about
who is an enemy: no locking teammates in team mode, no locking yourself.

### Server and client seams

The client sends nothing new. `InputMessage` is untouched — the lock is derived entirely from poses
and presses the server already has, so a hand-rolled client cannot assert a target.

The client reads `lockTargetSessionId` and draws a bracket on that car. While spectating it reads the
watched car's field, like the rest of the HUD. The bracket arrives one patch late (50 ms at 20 Hz)
plus latency, which is the same freshness as every other combat visual.

---

## Testing

Unit, in `lock.test.ts`, over hand-built players:

- Each acquisition bound rejects independently: outside the cone but inside the lateral cap, inside
  the cone but outside the cap, inside both but beyond `lockRange`.
- The crossover: a target at 330 u is bounded by the cone; at 400 u by the cap.
- Scoring picks the lower score, including the case the distance term is there to fix — a far
  centreline target losing to a nearer off-axis one.
- Retention holds a target past each acquisition bound and releases it past each retention bound —
  three separate tests, because a cone-only pad passes the first and fails at range.
- Steal is refused below the margin, refused inside the commit window, and accepted when both clear.
- Acquisition from no lock ignores both the margin and the commit window.
- Each of the five release conditions in isolation.
- The timeout re-acquires in the same tick: a lapsed timer with a valid target in cone yields a
  non-empty lock, and switches to a better target it previously could not steal.
- LOS: blocked by a hand-built obstacle, held through the grace, released past it, **not** blocked by
  a wreck.
- `canDamage` gating: no teammate lock in team mode, no self lock, no wreck lock.

Integration, in `combat.test.ts`, driven through `runCombat`:

- An aim-assist weapon fires at an off-axis target; a non-assist weapon in the same scene fires along
  the heading. This is the regression guard for "ships zero balance change".
- The fired angle is muzzle-derived (A11a) — asserted against a target close enough that the
  parallax exceeds the hitbox.
- A multi-volley aim-assist weapon re-aims between volleys (A11c), staged the way `fire.test.ts`
  already hand-stages `pending`.
- A wrecked owner holds no lock.

Config, in `weapon-config.test.ts` / `config.test.ts`: the four assertions in A9.

Known coverage gap, in the spirit of the weapon spec's own list: **no shipped weapon has
`volleys > 1` or `pelletsPerVolley > 1`**, so A11c is reachable only through hand-staged tests until
such a weapon is authored. A12 is likewise unreachable in play — no beam ships at all.

## Rollout

1. `AIM_CONFIG`, tick derivation, and the A9 assertions.
2. `usesAimAssist` on `WeaponBase`, set to `false` on **every** existing row — `cannon` included.
3. `lock.ts` with its tests. Nothing calls it yet.
4. Wire into `runCombat`, `spawnInstances`, `CombatMemory`, and the schema field.
5. The bracket in `ArenaScene`.
6. Flip `cannon` to `usesAimAssist: true` — the one commit that changes how the game plays.

Steps 1–5 are invisible in play, because every row still says `false`: the whole system lands, is
unit-tested, and is reviewable before a single shot changes direction. Step 6 is a one-line diff and
a one-line revert, which is what makes the content decision below cheap to overturn.

### The one content decision, flagged for review

`cannon` is the only weapon any chassis carries. If it stays `usesAimAssist: false`, this entire
system ships dark — joining beams, multi-pellet volleys, wind-ups and `repeater` on the list of paths
this codebase has never seen run. That list is already long enough that the weapon spec warns
authors about it.

**This design therefore sets `cannon` to `usesAimAssist: true`** — and that forces a second change.
`cannon` fires at exactly 2.0 Hz, and a 0.6 s timeout puts the behavioural cliff at 1.67 Hz, placing
the only shipped weapon inside the 1.5–2.0 Hz band the design says to avoid: A9's own guard
assertion would fail on the game's own content. **`lockTimeoutMs` is therefore 0.8 s, not 0.6 s**,
moving the cliff to 1.25 Hz and putting `cannon` clearly in the lock-holding class.

Both are easily reverted, and the alternatives are real:

- **`cannon: false`, keep 0.6 s.** The system ships dark and is proven only by unit tests.
- **`cannon: true`, keep 0.6 s, drop assertion 4.** Accepts that the shipped weapon sits on the cliff
  and relies on players never pausing longer than 600 ms between shots.

Note also that turning `cannon` on makes aim assist universal for launch, since every chassis carries
it — "some weapons have it, some do not" becomes true only when a second weapon is authored.

## Future work

- **Lead prediction.** The largest known limitation, quantified in A3: with no lead, a lock hits a
  full-speed crosser only inside ~47 u. Aiming at an intercept point instead of a position would make
  assist meaningful across the whole lock range, and would make `lockRange` a feel knob rather than a
  damage-control one. It is a distinct feature with its own balance question (how much of the lead to
  grant), not a tuning change.
- **Per-weapon geometry.** The A1 migration: `usesAimAssist` widens to an optional block, the lock
  splits per slot, and the bracket gains slot tagging. Worth doing when a second aim-assist weapon
  genuinely wants a different cone — with both weapons in hand to tune against.
- **Respawn.** Planned, out of scope here. "Release on target death" stops being terminal: a target
  dies, disappears, and returns, and re-acquisition is then just a normal acquisition. Nothing in
  this design breaks. The genuinely new question that arrives with respawn is whether a car under
  spawn protection is lockable, which cannot be answered until spawn protection exists.
- **Lag compensation.** Inherited from the weapon spec. A lock is computed from current-tick poses,
  so a shooter on 80 ms locks where the target was 80 ms ago — on top of the no-lead error above.
  Rewind hit testing would need to decide whether the lock rewinds with it.
