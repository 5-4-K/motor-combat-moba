# Motor Combat MOBA — Game Balance Harness Design

**Designed:** 2026-09-03 · **Recorded in repo:** 2026-09-03
**Status:** Approved, not yet implemented.
**Builds on:** [`2026-09-01-playtest-playground-design.md`](2026-09-01-playtest-playground-design.md)
(whose `tick-pipeline` extraction and bot this reuses),
[`2026-09-01-ffa-game-modes-design.md`](2026-09-01-ffa-game-modes-design.md) (whose deathmatch
respawn and `phased` protection every match runs under),
[`2026-09-03-practice-mode-design.md`](2026-09-03-practice-mode-design.md) (whose promotion of the
bot and its profiles to shipped balance this inherits), and
[`2026-08-27-weapon-system-design.md`](2026-08-27-weapon-system-design.md) (whose press/volley model
the per-weapon statistics are defined against).

Decisions are numbered **B1–B52** (plus B5a, B8a, B26a, B28a) and referenced by number elsewhere.

---

## Problem

There is no way to find out whether this game is balanced.

Three tools exist and each answers a different, narrower question. `npm run ttk` computes a
time-to-kill matrix from the tables — a damage ceiling, explicitly "not a prediction of play": every
shot connects, nobody dodges, nothing travels. `npm run playtest` drives the real pipeline through
placed scenarios and reports whether the sim *misbehaves* — tunneling, wedging, prediction error —
not whether a chassis is too strong. Practice mode puts one human against one bot, which measures a
feeling, one match at a time, with no record.

None of them can answer the questions a balance pass actually turns on:

- Is any chassis over- or under-powered?
- Is any weapon over- or under-powered — and if it underperforms, is that because it misses or
  because it is weak? Those have opposite fixes.
- Which matchups are lopsided?
- Does the match itself pace well?

And a fifth question that the three difficulty tiers make askable and nothing today can answer:
**does the answer change with player skill?** A weapon that only pays off with precise timing is
strong for a pro and dead weight for a beginner; a chassis that punishes mistakes is the mirror of
that. Balancing for one group at the expense of the other is a decision worth making deliberately
rather than by accident.

**The balance harness** runs N complete matches headlessly, with bots at a chosen skill tier, and
reports per-car and per-weapon performance with enough statistical honesty to be acted on.

---

## Scope

**In:** an opt-in combat-event seam in shared (`fired` / `damaged` / `killed`); a stateful
`BotController` that collapses the duplicated bot driver in `PracticeRoom` and `PlaygroundRoom` and
serves the harness as a third host; a perception-fair `BotView` projection with view staleness and
reaction delay as profile-owned knobs; a match runner with two shapes (six-car FFA, 1v1 duel
round-robin); seeded, replayable runs with paired-baseline comparison; a Markdown + CSV + JSON
report with confidence intervals and full provenance; an `npm run balance` script.

**Out:** any change to `stepSim`, the drive model, the OBB hitbox model, collision-damage rules or
friendly fire; any change to the sim's *behaviour* whatsoever — the event seam is observation only;
bot decision logic beyond the behaviour-preserving move of today's `botInput` behind the new
interface (**a separate session owns bot intelligence**); retuning any `BOT_PROFILES` row; new
playtest probes; changes to `ArenaRoom`; networking any event to clients; a UI for any of this.

---

## The governing principle

**B1. The harness measures; it never changes what it measures.**

Every number comes from the same `runPipeline` a live `ArenaRoom` runs, through the same
`runCombat`, over the same `WEAPON_TABLE` and `CAR_TABLE`. The event seam is opt-in and, when not
opted into, allocates nothing and alters nothing. A run that had to special-case the sim to observe
it would be measuring a game nobody plays.

The corollary, and it has teeth: **`golden.test.ts` and the full combat suite must pass unchanged
after the seam lands.** If any pinned number moves, the seam is wrong, not the test.

**B2. The harness is a rig, not a verdict.**

Its output is only as good as the pilot driving it, and the pilot is deliberately somebody else's
job. Run #1 will use the 1v1 chaser that ships today. That bot holds a fixed standoff — 70u on
`hard` — which systematically understates a chassis whose game is range (Bullseye: `predator`
reaches 1800u, `lance` 1200u) and overstates one whose game is contact (Bastion). **Run #1 validates
the rig. Verdicts start when the real bot lands.** Every report says so in its own header rather
than letting a reader discover it later.

---

## Part 1 — The combat event seam

Per-weapon statistics do not exist today and cannot be derived. `CombatResult` carries players,
instances and a sequence counter; attribution stops at `CombatPlayer.lastDamagerSessionId`, which
names *who* and never *which weapon*. A miss produces nothing at all, so hit rate is not merely
missing but unreachable.

**B3. `runCombat` gains an optional event sink. Absent sink, nothing changes.**

```ts
export interface CombatEvents {
  fired: FiredEvent[];
  damaged: DamagedEvent[];
  killed: KilledEvent[];
}
```

Passed in on `CombatInput` as `events?: CombatEvents` — a caller-owned bag that `runCombat` pushes
into. When the field is absent every emit site is a single `undefined` check and no array is
allocated. `ArenaRoom` and `PracticeRoom` pass nothing and pay nothing.

A sink rather than a return value because `runCombat` is called once per tick and the harness wants
one log for the whole match: a returned array would be allocated and concatenated 5,400 times.

**B4. Three event kinds, and no more.**

```ts
interface FiredEvent   { tick; shooterSessionId; carId; weaponId; slot; pressId }
interface DamagedEvent { tick; victimSessionId; victimCarId;
                         attackerSessionId; attackerCarId;
                         source: DamageSource; amount; killingBlow }
interface KilledEvent  { tick; victimSessionId; victimCarId;
                         killerSessionId; killerCarId; source: DamageSource }
```

`DamageSource` is a tagged union covering every path into `dealDamageTo`:

| Tag | From | Carries |
|---|---|---|
| `weapon` | an instance's hit | `weaponId`, `pressId`, `isExplosion` |
| `contact` | the contact pass | `weaponId`, `pressId` |
| `pulse` | a status pulse | `statusId`, `sourceSessionId` |

`KilledEvent` duplicates what `killingBlow` already marks on the damage event. That redundancy is
deliberate: the kill table wants victim and killer without joining across two logs, and the weapon
table wants credited kills without joining either.

**B5. Every point of damage in this game is weapon-attributable, but two of the three paths arrive
one hop removed.**

There is no "ram damage" bucket, because **a plain ram deals no damage** — `sim/ram.ts` states it
outright ("`applyDamage` is never called from here"), and it is what keeps weapons the only damage
source. Every `ContactHit` the contact pass produces is a dash landing or a hard slam, so it always
names the maneuver weapon that caused it. `weaponId` on the `contact` source is therefore never
null.

Pulse damage is the hop that matters. `corroded` is the only damaging status on the table
(`pulse: { intervalMs: 400, damage: 8 }`), and over its 2 s duration that is **40 damage** — against
`magmablast`'s 50 on the direct hit. Bank that under "corroded" and the weapon table understates the
weapon that caused it by nearly half.

**B5a. Pulse damage is credited to the weapon that applied the status, derived at runtime.**

`ActiveStatus` carries `sourceSessionId` but not a source *weapon*, and adding one is not worth it:
`StatusState` is networked, so it would widen the wire permanently to serve a statistic.

Instead the harness scans `WEAPON_TABLE` once at startup — every row's `applies`, and every
explosion's `applies` — and builds `statusId → weaponId[]`. When exactly one weapon applies a status,
its pulse damage is credited to that weapon and the report says the attribution was derived. When two
or more do, attribution is genuinely ambiguous from the event alone, and the damage is reported under
the status instead.

Derived rather than hardcoded because CLAUDE.md's own note on `corroded` — "grep `applies:.*corroded`
if a second source ever needs checking" — describes a fact that a future weapon can change silently.
A map built from the table cannot go stale; a constant would, and would go stale in the direction of
a wrong number rather than a missing one.

**B6. Emit sites — four, all already single points.**

| Event | Site |
|---|---|
| `fired` | `runCombat` phase 3, where `beginFire` newly commits (`pending !== null && prevPending === null`) |
| `damaged` | inside `dealDamageTo`, whose three call sites are `combat.ts` lines 269 (pulse), 306 (contact), 526 (weapon hit) |
| `killed` | the same place, on the `hp === 0` transition |

`dealDamageTo` is already documented as "the only writer of damage-inflicted hp/alive changes in
combat". Instrumenting it is exactly as safe as that claim, and if the claim were ever false the
harness would be the thing that noticed.

**B7. A shot is a press, and `pressId` needs no counter.**

`beginFire` commits at most one press per player per tick, so

```
pressId = `${sessionId}#${tick}#${slot}`
```

is unique by construction. Deterministic, allocation-cheap, and requires no new mutable state.

**B8. `WeaponInstance` carries `pressId`, frozen at spawn.**

Sim-only, never networked — exactly like the `damage`, `ownerTeam` and `finalWave` fields already
beside it, and for the same reason: it must be answerable at impact, long after the press. This is
what makes press↔damage attribution *exact* rather than a correlation window, which matters most for
the weapons where a window would be least trustworthy — a lingering `lance` beam, an attached
`afterburner` cone, a bursting `pepperbox`.

An explosion synthesized by `instanceDefOf` inherits its shell's `pressId`, so a `magmablast`
detonation is credited to the press that threw the shell.

**B8a. A maneuver press carries its `pressId` on the car, beside `maneuverWeaponId`.**

`wildcharge` and `thunderclap` spawn no instance. Their damage arrives through the contact pass, a
tick or many ticks after the press, and without this it would carry no press at all — so both would
report a 0% hit rate under B30, which is precisely backwards for the two weapons whose whole design
question is *how often does this actually land*.

`CombatPlayer` already carries a server-only `maneuverWeaponId` for exactly this kind of
after-the-fact attribution ("the contact pass reads it to price a slam/dash hit"). A
`maneuverPressId` sits beside it, set by `startManeuver`, cleared by `clearManeuver`, and copied onto
the contact damage event. Symmetric with B8, and it makes "did this charge convert?" a directly
measured number rather than an inference.

**B9. Events are server-side. Networking them is a separate decision.**

`stepSim` never reads them, so invariant 8 does not apply. Any future consumer — a results-screen
damage breakdown, a kill feed naming the weapon — is additive work on top, not implied by this.

---

## Part 2 — The bot seam

The plan splits bot *intelligence* into its own session. This part builds only the seam, and builds
it wide enough that the bot session never has to change its shape.

### Why a seam is needed at all

`botInput(seq, self, target, slotRanges, profile)` is a pure function of one opponent's *pose*.
`BotPose` is `{x, y, angle}` — that is everything a bot may know today. Not its own hp, not its
cooldowns, not the other four cars, not the obstacles. Every skill axis a better bot would need
reaches for something outside that signature, so the bot session's first act is to widen it. Any
caller holding the old signature breaks on that commit.

Meanwhile the *stateful* half of the driver is duplicated: `PracticeRoom.enqueueBotInput` and
`PlaygroundRoom`'s equivalent are near-identical blocks each holding their own `heldBotIntent`,
`botSeq`, target choice and call sequence. A third host would make three copies.

**B10. `BotController` is an instance, one per bot, owning all bot-side state.**

```ts
interface BotController {
  readonly profileId: BotDifficulty;
  decide(view: BotView): BotIntent;
}
```

`BotIntent` is `{steer, throttle, fireSlots}` — deliberately not an `InputMessage`. `seq` is the
host's business; the bot reports intent.

It absorbs the reaction clock, the held intent, the fire pulse, target selection, and (when the bot
session arrives) observation memory. `shouldRecomputeIntent` and `pulsedFireSlots` — already lifted
into `rooms/bot.ts` by the practice-mode work — move inside it.

**B11. This overturns one shipped comment, deliberately.** `PlaygroundRoom` documents the fire pulse
as *the room's* decision: "the bot reports intent, the room decides what reaches the wire, exactly as
a real client's key state does." Under an instance model the bot *is* the client and holds its own
key state, so the pulse travels with it. Coherent, but it is a reassignment of ownership and is
recorded here rather than slipped in.

**B12. Both rooms migrate onto `BotController` in this work.** Behaviour-preserving, pinned by
`bot.test.ts`, `practice-room.test.ts` and `playground-room.test.ts`. Leaving a shipped room on the
old path would leave two bot drivers in the tree while the whole point is one.

**B13. `bot.ts` moves from `rooms/` to `src/bot/`.** It serves two rooms and a harness and depends on
nothing room-shaped. `BOT_PROFILES` stays in `src/config/bot-profiles.ts`, where practice mode
correctly put it — those are balance a player judges.

**B14. Bots are server-side only.** They author inputs, and only the server authors inputs
(invariant 3). This closes the shared-vs-server placement question permanently.

### The fair view

**B15. `BotView` is a constructed projection, never a handle on `ArenaState`.**

This is the structural form of "the bot never cheats". `inputQueues` and `prevFireMasks` — the actual
keypresses — are not reachable from inside `decide`, because they are not in the type. A promise
would decay; a type does not. A test asserts the projection carries no forbidden field.

**B16. The line is perception-fair: what a human can *see*, not what the wire carries.**

Everything a human perceives, the bot gets:

- **Self, in full** — pose, speed, hp, carId, statuses, own slot states (stocks, recharge, refire
  lock), own lock target, own maneuver state. All of it is on the player's own HUD.
- **Every other car** — pose, speed, hp, alive, carId, team, statuses, phased. All rendered on
  screen, hp bars included.
- **Live weapon instances** — projectiles and beams in flight, as drawn.
- **Arena** — bounds and obstacles.

**B17. `arena-01` fits the viewport exactly, so no vision limit is needed today.** `arena-camera.ts`
is explicit: the arena is authored to the size of the view, "so the whole match is on screen." There
is no fog of war to model. `arena-02` (2000×2000) does *not* fit; when a larger arena ships, the
viewport limit belongs in `buildBotView` and nowhere else.

**B18. Enemy `WeaponSlotState` is never exposed — but observed usage is.**

`stocks` / `rechargeEndsTick` / `refireLockUntilTick` are networked for every player, yet the HUD
draws only your own. A bot reading an enemy's recharge timer would be inside the wire and outside
what a human can see: clairvoyance, and it would inflate the measured value of cooldown-punishing
play.

What a human *does* get is the **event**: they watch the ult go off and remember it. So the view
carries the tick's observable fire events, and the bot's own memory turns them into "Bastion's
`wildcharge` is roughly twelve seconds out." Skill lives in the remembering — which is precisely one
of the things separating a pro from a casual, and precisely why the controller has to be a stateful
instance rather than a pure function.

Both ults are observable without new plumbing: an instance in the world names its owner, and
`wildcharge` — which spawns no instance — is visible through the networked `maneuver` /
`maneuverTicksLeft` fields the client already draws.

**B19. Three latency knobs, not one, all owned by the profile.**

| Knob | Models | Exists today |
|---|---|---|
| **View staleness** | the world you see is N ticks old (20 Hz patch + ping) | no |
| **Reaction delay** | the gap between seeing and your hands moving | no |
| **Recompute cadence** | how often you re-evaluate at all | yes, `reactionTicks` |

Today's `reactionTicks` is only the third, and it is not a reaction time: a bot can be slow to
re-decide and still respond instantly to what it sees. Real human latency is delay on the decision
itself. This work builds the machinery for all three — a short snapshot ring in the host, and an
intent delay line in the controller. **This work does not set the values**; `reactionTicks` keeps its
current numbers and the two new knobs default to 0, so behaviour is bit-identical to today. The bot
session picks the tier values.

**B20. Every bot draws from an injected seeded RNG.** `Math.random()` is banned from the bot path,
and the contract carries the RNG from day one even though today's bot ignores it — otherwise the
first bot that wants inconsistency (which is most of what makes a casual a casual) silently destroys
reproducibility.

**B21. Instance lifecycle.** One controller per bot, constructed at match start, seeded from
`(matchSeed, slot)`. A deathmatch respawn does **not** reset it: a human does not forget what they
learned when they respawn. The harness constructs fresh controllers per match, so match #2 never
inherits match #1's memory.

**B22. `LegacyController` wraps today's `botInput` and is the only implementation this work ships.**
It reproduces current behaviour exactly, which is what lets both rooms migrate under their existing
tests. The bot session replaces it; this session must not pre-empt that.

**B23. One profile table, and the bot session reconciles the two purposes.** PR18 retuned `easy` and
`medium` *for players* — passive, gentle, pleasant to fight. Faithful skill simulation wants
something different: a beginner over-commits, charges in, wastes their ult. Those goals usually
converge (a beginner who over-commits is also easy to beat) but they can pull apart, and when they
do, **practice-mode feel wins** and the harness inherits the compromise, documented in the report.
`hard` stays frozen and pinned by value; that is what keeps pro-tier numbers comparable across bot
revisions.

---

## Part 3 — The match runner

**B24. A match is assembled from the pieces `ArenaRoom` already uses, minus Colyseus.**
`runPipeline`, `respawnSweep`, `respawnPlayer`, `phaseEndSweep` from `tick-pipeline.ts`; `livingSides`
/ `deathmatchEnded` / `deathmatchOutcome` / `winRuleOf` from shared flow; `assignSpawns` for
placement. Almost no new sim code, and strictly closer to a real room than the playtest probes are.

**B25. The harness does not use `PlaytestWorld`.** That class predates the pipeline extraction and
hand-rolls the tick order inline, with no phase sweep and no respawns. Reusing it would mean
measuring a slightly different game from the one that ships. The glitch probes keep it; this does
not.

**B26. Two shapes, because one experiment cannot answer both questions.**

- **`ffa`** — six cars, 2/2/2 composition, `FFA_DEATHMATCH` by default. Answers overall chassis and
  weapon strength under real multi-way pressure, and yields the most samples per second of sim
  because respawns keep every car fighting for the full clock.
- **`duel`** — 1v1, round-robin over all nine ordered chassis pairs including mirrors,
  `FFA_LAST_STANDING` by default. Answers the matchup matrix, which a six-way melee cannot: with five
  cars shooting each other, every pairwise claim is confounded.

Same runner, same statistics, same report. Each table states which shape produced it.

**B26a. The three mirror matchups are the harness's own noise floor.** Bullseye-vs-Bullseye must
converge on 50%. It cannot be anything else — identical chassis, identical kit, identical pilot — so
a mirror that reads 58% is not a finding about the game, it is proof that the rig has a positional
bias (spawn seat, resolution order, who gets slot 0) large enough to invalidate every other cell in
the matrix. Printed first, with its interval, and read before anything else on the page.

**B27. `2/2/2` is fixed, not randomized.** Equal representation every match makes the null hypothesis
exactly 33% and removes the need to normalize win rates by appearance count. Randomized composition
samples a more realistic lobby and can answer "does four Bastions break the game" — it is a later
`--composition` flag, not this work.

**B28. Deathmatch is the FFA default** for sample density; `--mode` selects last-standing when the
question is pace or survival.

**B28a. Spawn protection distorts hit rate, and the report sizes the distortion rather than claiming
to remove it.** `runCombat` drops a `phased` car from the hit snapshot entirely, so a shot aimed at
one produces no damage event — a press that reads as a miss. The harness cannot know intent, so it
cannot honestly reclassify that press. What it can do is report **the fraction of match time spent
phased**, per car, next to the hit rates, so a reader can size the effect; and note that
`last-standing` mode has no phasing at all, making it the cleaner shape when accuracy is the
question. Claiming the presses were "excluded" would be a filter nobody could implement correctly.

**B29. Match end and teardown are the room's rules, not the harness's.** The runner asks
`winRuleOf(mode)` and applies the same check `ArenaRoom` applies. A harness with its own end
condition would drift from the game the first time either changed.

---

## Part 4 — Statistics

### Per-car (FFA shape)

Win rate with a confidence interval; mean placement; kills and deaths per match; damage dealt and
taken per match; damage ratio; mean survival time between spawns; kills per minute alive.

### Per-weapon

**B30. A shot is one press; a press connects if any damage event carries its `pressId`.**

The roster is not uniform — `pepperbox` throws a pellet fan, `lance` is a beam damaging over many
ticks, `wildcharge` lands 250 through a contact hit. Counting raw impacts would make those numbers
mutually incomparable. Defining the unit as the press makes hit rate mean the same thing for every
row on the table:

> **hit rate = presses with ≥1 attributed damage event ÷ presses**

Reported alongside: total damage, damage share within the chassis's own kit, damage per press,
killing blows credited, **presses per minute**, and time-to-first-use for the two ults.

**B31. Presses per minute is not a redundant stat.** It is the only one that reveals an *ignored*
weapon. A row can post respectable damage-per-press and still be dead weight because nothing ever
presses it — and no damage figure will ever show that.

**B32. Hit rate is what separates the two opposite fixes.** A weapon posting low damage because it
misses needs accuracy, reach or a bigger hitbox. One posting low damage because it connects for
little needs a damage number. Without `fired` events those look identical, which is why B4 carries
three event kinds rather than two.

### Matchup matrix (duel shape)

**B33.** 3×3 including mirrors: win rate per ordered pair, mean duel length, and **mean winner hp
remaining** — the difference between "edges it out" and "walks it", which a win rate alone flattens.

### Pace

**B34.** Time to first blood, kills per minute, match duration, and the fraction of matches that hit
the clock rather than resolving.

### Statistical honesty

**B35. Every rate prints a 95% Wilson interval, inline, never a bare percentage.**

At 2/2/2 a chassis holds two of six seats, so the null is 33.3%. Over 100 matches the interval is
roughly ±9 points — a chassis reading 38% is not evidence of anything. Without intervals this
harness would mostly generate false leads, and its most likely failure mode is a confident tuning
pass against noise.

**B36. Paired runs are the primary workflow.** Everything is seeded, so the same seed replays
identically. Run seed 7, change one number, run seed 7 again: every match starts from identical
conditions and the delta is *caused* by the edit rather than sampled around it. `--baseline=<dir>`
reads a previous `run.json` and prints deltas.

**B37. A baseline comparison refuses to run when the bot fingerprint or the config fingerprint
differs**, unless forced. Comparing across a bot revision or a config edit is exactly the mistake
that would attribute a bot improvement to a weapon nerf.

### Report

**B38.** A dated run folder, `NN` convention shared with playtest:

```
balance/reports/2026-09-03-01/
  summary.md     the tables, with intervals and deltas
  matches.csv    one row per car per match
  weapons.csv    one row per weapon per match
  run.json       machine-readable; what --baseline reads back
```

**B39. The header carries full provenance**: run seed, N, shape, mode, arena, git commit, wall-clock
duration, the bot profile values **verbatim** plus a fingerprint, and a config fingerprint over
`WEAPON_TABLE` / `CAR_TABLE` / the combat and drive configs. A report six weeks old must still be
interpretable, and B37 needs both fingerprints to do its job.

The config fingerprint follows the precedent `balanceStamp` set for the manual page — hash the tables
whole, so any field of any row counts — but is computed independently rather than imported:
`balanceStamp` lives in `scripts/build-cars-and-weapons.mjs`, a build script outside the TypeScript
packages, and hashes for a different consumer. Two hashes of the same tables for two purposes is
cheaper than making a build script a runtime dependency of the server.

**B40. Every report states its limitations in its own body** — B2's pilot caveat, B23's profile
tension, and the list in Part 6. A caveat that lives only in a design document is a caveat nobody
reads at the moment they are reading a number.

---

## Part 5 — Params, determinism, performance

**B41. CLI** — `npm run balance -- [flags]`:

| Flag | Default | Meaning |
|---|---|---|
| `--matches=N` | 50 | matches to run — **per ordered pair** in `duel`, so `--shape=duel --matches=50` is 450 matches |
| `--shape=ffa\|duel` | `ffa` | six-car 2/2/2, or 1v1 round-robin |
| `--mode=deathmatch\|last-standing` | `deathmatch` (ffa), `last-standing` (duel) | win rule |
| `--skill=pro\|casual\|amateur` | `pro` | maps to `hard` / `medium` / `easy` |
| `--seed=<int>` | random, always printed | pass back to replay exactly |
| `--arena=<id>` | `arena-01` | |
| `--baseline=<dir>` | — | print deltas against a previous run |
| `--match-seconds=<n>` | mode default | shorten while iterating |
| `--out=<dir>` | dated folder | |

**B42. The CLI speaks player types; the code speaks difficulties.** One mapping table, in one file,
so the two vocabularies never each own half a name. Reports print both (`pro (hard)`).

**B43. Determinism is a tested property, not an aspiration.** One PRNG seeded per run; match seeds
from `(runSeed, matchIndex)`; bot streams from `(matchSeed, slot)`. The sim already iterates players
in sorted `sessionId` order. `Math.random()` and wall-clock reads are banned from every path a run
touches. A test asserts it directly: the same seed twice produces an identical stats digest.

**B44. Performance is measured, not predicted.** A three-minute deathmatch is 5,400 ticks × 6 cars;
the runner prints per-match cost. If N=50 proves slow, matches are embarrassingly parallel across
child processes — the same reason `run-all.ts` already spawns per probe. Not built until the number
says it is needed.

---

## Part 6 — What this deliberately does not model

**B45.** Stated here and reprinted in every report:

- **Bot skill is a model of skill, not skill.** These numbers compare cars *under a fixed pilot*.
  "Amateurs find Bastion weak" is a claim about our amateur bot until a human confirms it.
- **The current pilot is a fixed-standoff 1v1 chaser** (B2), which understates range chassis and
  overstates contact chassis.
- **No network.** No latency, no packet loss, no client prediction error. A LAN game has all three.
- **One arena.** `arena-01` only, unless `--arena` says otherwise. Arena geometry is a balance input.
- **No lobby, no team play.** `GameMode.TEAM` is out of scope for this work.
- **Bot targeting drives kill distribution.** Who bots choose to shoot is a bot-tuning decision that
  moves per-car numbers, and it will change when the bot session lands.

---

## Part 7 — File layout

```
packages/shared/src/sim/
  combat-events.ts        NEW   event types, DamageSource, the sink shape
  combat.ts               EDIT  4 opt-in emit points (B6)
  weapons/instances.ts    EDIT  pressId on WeaponInstance (B8)
  weapons/fire.ts         EDIT  pressId on PendingFire (B7)
  combat.ts               EDIT  maneuverPressId on CombatPlayer (B8a)

packages/server/src/bot/  NEW   mode-agnostic; imports no room types
  types.ts                      BotView, BotIntent, BotController
  view.ts                       buildBotView — the fairness projection (B15-B18)
  controller.ts                 LegacyController: today's botInput, statefully (B22)
  rng.ts                        seeded streams
  index.ts
  (rooms/bot.ts moves here; BOT_PROFILES stays in src/config/)

packages/server/src/rooms/
  PracticeRoom.ts         EDIT  use BotController (B12)
  PlaygroundRoom.ts       EDIT  use BotController (B12)

packages/server/balance/  NEW   sibling of playtest/, not inside it
  match.ts                      one match: spawn, tick loop, win rule, outcome
  runner.ts                     N matches, shapes, seeding
  stats.ts                      aggregation, Wilson intervals
  report.ts                     markdown, csv, json
  baseline.ts                   delta comparison + fingerprint guard
  run.ts                        CLI entry
  tsconfig.json
  README.md
```

**B46. `balance/` is a sibling of `playtest/`, not a folder inside it.** Different contract: probes
are hand-run diagnostics that report rather than assert, on a per-scenario cadence; this is a
statistical experiment with a different output, a different cadence and a different reader.
`run-all.ts` uses a hardcoded probe list so nesting would break nothing mechanically — the reason is
that "does `npm run playtest` run my balance suite?" is a question nobody should have to ask. The
dated-`NN` run-folder helper is lifted out of `playtest/reporter.ts` so both use one implementation.

---

## Part 8 — Testing

**B47. The pure pieces belong in `npm test`.** Stats aggregation over a synthetic event log, Wilson
intervals, composition generation, CLI parsing, `pressId` uniqueness, seed determinism, and the
`BotView` no-forbidden-field assertion are all cheap and pure. The full N-match run stays out, like
the probes.

**B48. The seam gets its own shared tests**: events emitted at each of the four sites, absent sink
allocates nothing, explosion inherits its shell's `pressId`, and contact damage carries the
maneuver's `weaponId` and `pressId`.

**B49. The room migration is proven by the tests that already exist** — `bot.test.ts`,
`practice-room.test.ts`, `playground-room.test.ts` pass unchanged, including the by-value pin on
`hard`.

**B50. `npm run playtest` runs before and after.** The claim is that behaviour is preserved; the
probes are how that claim gets checked rather than asserted. Any probe number that moves means B1 was
violated.

---

## Part 9 — Rejected alternatives

**B51. Reconstructing damage attribution harness-side from hp diffs.** Zero sim changes, and the
numbers would quietly lie: explosions, burn pulses, ram contact and simultaneous hits all land on the
same tick and cannot be told apart afterwards. It also cannot see a miss at all, so hit rate — the
stat that separates the two opposite balance fixes (B32) — stays unreachable.

**B52. Extending `lastDamagerSessionId` to carry a weapon id.** A far smaller change that buys
per-weapon *kill credit* and nothing else: no damage totals, no hit rate, no usage rate. It answers
less than half the question and would have to be replaced by the seam later anyway.

**Separate `PILOT_PROFILES` for the harness, distinct from `BOT_PROFILES`.** Rejected under B23: two
tables would need keeping coherent, and the objectives usually converge. Revisit if practice-mode
feel and skill fidelity ever provably conflict.

**Randomized six-car composition as the default.** Rejected under B27: it needs appearance-count
normalization and far more matches for the same statistical power. Worth having as a flag once the
fixed-composition baseline exists.

---

## Handoff to the bot session

This work leaves the bot session a `BotView` it never has to reshape, a `BotController` instance to
fill in, three latency knobs wired and defaulted to no-ops, a seeded RNG already threaded, and both
rooms plus the harness already consuming the interface. Its job is `decide`, the observation memory
behind B18, and the tier values behind B19 and B23.

Its first act should be a paired run (B36) against the pre-existing baseline: same seed, new pilot,
and the deltas are exactly the measure of what the new bot changed.
