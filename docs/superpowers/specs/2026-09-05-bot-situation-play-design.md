# Bot situation-play brain — design

**Date:** 2026-09-05
**Status:** design approved (implementation follows this document)
**Supersedes:** G4–G28 of
[`2026-09-04-bot-tactical-intelligence-design.md`](2026-09-04-bot-tactical-intelligence-design.md)
(the scored goal catalog, those knobs, overlay scoreboard, lock-wait-as-veto, and the
characterisation that required Hard to wait for lock). G1–G3 are restated as S1–S3. H1–H8 and
H16–H48 (except H9–H15 already superseded) stand unless this document names a replacement.

Decisions here are numbered **S1–S28**.

---

## 1. The problem

The 2026-09-04 goal catalog is shipped and still does not play like a person. Utility over eleven
independent jobs produces actions with no purpose. Observed in practice / playground against Hard:

- Sits in a corner while the opponent approaches; does not leave or dodge.
- Attacks look random; often does not fire when the opponent is in range.
- Wastes an ult while the opponent is dead or respawning.
- Seems unaware of match data the module already receives.

The HUD view is not the bug. `BotView` already carries pose, HP, `phased`, live shots,
`observedFires`, own slots, and `carId`. Practice and playground already pass `observedFires`.
Assess barely reads those facts. Dodge only exists for projectile trajectories. Memory keeps the
last *alive* snapshot after death (`visible()` drops `!alive`), so Hard will still dump a 5 s gun
at a ghost for `memoryTicks`. Preferred range is a weighted average of authored `range` (predator
1800) capped at awareness 900, so the default fight is reverse-kite on a 1280-wide arena.
`fireDisciplineChance` 0.85 plus lock-wait skips shots that a player would take.

This is a brain rework, not a Hard retune.

**S1. Weakness remains worse use of the same facts, and worse hands (H1).** No damage, speed, or
post-aim miss handicaps. Easy may intend a decent play and still miss, stall, or step into a shot.

**S2. Hard remains a strong human (H2).** No fourth tier. No clairvoyance: no enemy stocks, no
`pressId`, no `lastDamagerSessionId`, no live enemy `FireState`.

**S3. One brain. A tier is data (H8).** No module under `bot/brain/` branches on `profileId`. Every
factor exists for every tier. Easy / medium / hard differ only in profile numbers: how much each
factor moves the play, and how tightly the hands execute it.

**S4. Same module, three hosts (B13).** `BotController.decide(BotView)` remains the only door.
Practice, playground, and the balance harness keep calling it. No room-specific brain.

---

## 2. Architecture

**S5. Situation then one play, not a scored catalog.** Each recompute: name exactly one situation
from a closed priority list, then drive and shoot in service of that play. A player does not score
`rush` vs `holdRange`. They ask what is happening, then commit.

**S6. Five layers, one `decide` call, same cadence as H5–H6.**

```
perceive (every tick)
  → assess: facts from the view + memory → one situation → one play
  → move: that play's heading / range / throttle rule + wall (never reverse into a bound)
  → shoot: that play's fire rule, one slot
  → humanize (every tick)
```

**S7. A play publishes `{ headingRad, preferredRange, closing, mayFire }`.** Movement serves that
primary. A wall desire may deflect heading. Dodge is **not** a competing blend on every fight tick;
incoming threat **is** a situation (`evade`) that takes the wheel until it ends.

**S8. Pre-emption is priority, not a three-item escape hatch.** A higher-priority situation always
cuts in immediately. Equal or lower priority waits `situationCommitTicks`. Dodging is `evade`, so
it *is* a pre-emption when the facts say a shot or a car is about to hit.

---

## 3. Facts (the one brain's inputs)

**S9. `buildFacts` is the only place assess reads the world.** It returns a plain object. Situations
and firing read facts, not raw maps. Every field is computable from `BotView` + `PerceptionState` +
`BotProfile` + one RNG draw sequence that is always the same length (H21).

Facts (all present every tick):

| Fact | Source (fair) |
|---|---|
| Self pose, HP, alive, phased, own slots / locks / switch lock | own HUD |
| Hittable target (or none) | live `others`: `alive && !phased`, after acquire delay |
| Ghost pose (hunt only) | memory; never a fire target unless `deadRespect` fails (S12) |
| Own gun reaches (per slot) | S10 |
| Their kit reaches | visible `carId` → `slotsOf(carId)`, union weapons from `observedFires` for that session (S11) |
| Their HP fraction | HP bar |
| They are stunned | status drawn on them |
| They spent a big gun recently | `ultIsSpent` from `observedFires` |
| Incoming shot | live instances, existing threat geometry |
| Incoming car | closing on a collision course inside `dodgeHorizonTicks` (S16) |
| Pinned on a bound / in a corner | wall lookahead, or within a car-length of two bounds |
| Own hurt | HP vs `retreatHpFraction` |

**S10. Own weapon reach is the range a player aims with.** For a slot:
`usesAimAssist && aimRangeUnits` → `aimRangeUnits`; else `range > 0` → `range`; else
`BRAIN_CONSTANTS.contactTriggerUnits`. Predator fights around 800, not 1800. Preferred fight
distance is `standoffFraction * selectedSlotReach`, still floored at `minEngageUnits` and capped at
`awarenessRadiusUnits`.

**S11. Opponent reach is the same S10 function over their known kit.** Default kit is
`slotsOf(carId)` (the chassis a player sees). Weapons seen in `observedFires` for that session are
unioned in, so a playground custom loadout is learned when it shoots — not by reading
`CombatMemory`.

Spacing versus their kit uses their **shortest** S10 reach as keep-out (the distance their close
gun starts to work), scaled by `opponentRangeRespect`. Do **not** use their longest gun as a
standoff — that recreates the 900 u kite. `fight` preferred distance is
`max(ownComfort, shortestTheirs * opponentRangeRespect)` with `ownComfort` from S10.

**S12. Live picture beats memory for “are they hittable?”** `perceive` must update a known car from
`view.others` even when `alive` is false or `phased` is true, so the snapshot cannot stay “alive”
for `memoryTicks` after death. `pickTarget` / facts then: if the live (or just-updated) car is
dead or phased, they are not hittable unless `rng() >= deadRespect` (Easy often still treats a
ghost as a target; Hard never does). Memory without a live car is hunt-only.

---

## 4. Situations (closed, highest priority wins)

**S13. The catalog.**

| Priority | Id | When | Drive | Fire |
|---|---|---|---|---|
| 1 | `recover` | self dead or phased | coast | off |
| 2 | `waitOut` | no hittable target (after S12) | last-known / heard shot / quadrant search; never arena centre | **off**, including ult |
| 3 | `evade` | incoming shot or incoming car, and the dodge roll committed to react | step off that line, throttle 1 | still fire if already in cone and a gun reaches (peel, don’t freeze) |
| 4 | `unpin` | pinned on a bound/corner AND a hittable target exists, and `rng() < cornerRespect` | heading into open floor (inward normal of the nearest bound, or the component of the target bearing that is not into the wall). **Never** `(width/2, height/2)` | same as fight if in cone |
| 5 | `punish` | hittable and (stunned or their HP ≤ `ultWindowHpFraction` or `ultIsSpent`) | close to dump range (`max(minEngage, selectedReach * 0.5)`) | damage / ult; never another stun on an already-stunned target |
| 6 | `reset` | hittable and own HP < `retreatHpFraction` (0 means off, Easy fights to zero) | open the selected gun’s band; still never reverse into a bound | fight rules |
| 7 | `fight` | hittable and at least one ready gun’s reach covers them | stay in that gun’s band **in open floor**; coast in the deadband; **never reverse if the reverse heading would move closer to a bound** | S17–S19 |
| 8 | `close` | hittable, not yet in any ready gun’s reach | intercept / bearing, throttle 1, `closing: false` | off until a gun reaches, then the next tick is `fight` |

If `unpin`’s `cornerRespect` roll fails, skip to the next matching situation (Easy may stay in a
corner). Roll `cornerRespect` **once per pin episode** (the stretch `pinned` stays true), not every
recompute — same rule as `dodgeChance` on a shot. If `evade`’s per-threat `dodgeChance` /
`incomingCarChance` roll fails, skip `evade`.

**S14. `setupCc` / `dump` / `holdRange` / `rush` / `intercept` / `pinWall` / `huntLastKnown` cease
as scored goals.** Stun-then-dump is `fight` or `close` until they are stunned, then `punish`
pre-empts. Easy’s “drive at you” is `close` + mash (low `standoffFraction`, low `deadRespect`, low
`ultDisciplineChance`). Hard’s spacing is `fight` using S10–S11, not a 900 u reverse.

**S15. Slot stickiness.** Once `chooseSlot` picks a slot, keep it for `slotStickTicks` unless the
situation changes or that slot is no longer ready / no longer reaches. Stops kit flicker.

**S16. Incoming car.** A hittable target whose relative motion will close to `contactTriggerUnits`
inside `dodgeHorizonTicks` on the current headings. Rolled once per approach episode with
`incomingCarChance` (same “once, not per tick” rule as `dodgeChance` on shots).

---

## 5. Shooting and the ult

**S17. Fire is gated on a hittable target and `mayFire`.** `waitOut` and `recover` never fire.
A remembered corpse is not enough unless S12’s ghost path applied.

**S18. One slot per tick (H27).** Rank by the play, not raw DPS-per-second:

- `punish`: ult if ready and it reaches, else highest `weaponValueOf` that reaches; `setupCc` slot
  is disqualified while the target is stunned.
- `fight` / `evade` / `unpin` / `reset`: the ready gun whose S10 reach best fits current distance
  (still one press), then personality `slotWeights`.
- Contact / dash (`range` 0): only a candidate when distance ≤ `contactTriggerUnits`.

**S19. Facing is hands, not a second brain.** `|aimDelta| < fireConeRad` to press. Easy’s cone is
wide (misses). Hard’s is tight (must actually point) **and then they do fire**.

**S20. HUD lock is never a veto.** If lock is already on this target, that slot may rank higher.
Holding fire until lock appears is forbidden. Delete the `usesAimAssist && lockTargetSessionId !==
target` continue. `fireDisciplineChance` may still skip a shot in the outer 10% of reach (H29).

**S21. Big gun = `cooldownMs >= BRAIN_CONSTANTS.ultCooldownMs` (5000).** Not predator (1000 ms).

- Easy: `ultDisciplineChance` 0 — mash it when it ranks and reaches.
- Medium / Hard: hold unless `punish` is the situation (stun, wounded window, or they just spent
  theirs) **or** the ult is the only ready gun that reaches. Never fire a big gun because
  `distance <= reach / 2` on a map-sized reach. Delete that clause.

---

## 6. Hands

**S22. Mechanical skill stays on the existing knobs** (aim error, fire cone, lead, steer tolerance,
recompute cadence, dodge reaction, blunder, idle fidget, reverse speed is the sim’s — do not nerf
`DRIVE_CONFIG`). Easy overcorrects by holding a bad heading longer (`recomputeTicks` 12) and
blundering; Hard’s car follows the play.

**S23. Personality may only shift hands, favorite guns, and spacing flavor** (standoff, orbit,
retreat, ram, discipline, vengefulness). It must not skip `waitOut` / `unpin` / `punish`. A kiter
stands farther in *open floor*; they still leave a corner and still will not ult a corpse when
`deadRespect` says so. Drop personality shifts of deleted weights (`rushWeight`, `dumpWeight`, …).

**S24. Orbit only while coasting in `fight`’s deadband.** Never add orbit on reverse, `close`,
`punish`, `unpin`, or `evade`. `orbitBias` 0 on Easy stays “drive through.”

---

## 7. Profile knobs (first pass; all configurable)

**S25. New / renamed fields on `BotProfile`.** Deleted: `rushWeight`, `interceptWeight`,
`setupWeight`, `dumpWeight`, `pinWeight`, `dodgeWeight`, `goalCommitTicks`. `scoreNoiseSigma`
stays for `scoreTargets` only.

| Field | easy | medium | hard | Direction up the ladder |
|---|---|---|---|---|
| `deadRespect` | 0.25 | 0.75 | 1 | rises |
| `opponentRangeRespect` | 0 | 0.45 | 0.9 | rises |
| `cornerRespect` | 0.35 | 0.75 | 1 | rises |
| `incomingCarChance` | 0.1 | 0.55 | 0.95 | rises |
| `situationCommitTicks` | 20 | 12 | 6 | falls |
| `slotStickTicks` | 4 | 8 | 12 | rises |
| `lockWaitChance` | not added — S20 forbids the veto | | | |

Retune (not new fields): Hard `standoffFraction` 0.85 → **0.7** so S10’s 800 u predator band is
~560, not a map-width kite. Hard `orbitBias` 0.75 → **0.35** so coasting fight does not weave.
Hard `fireDisciplineChance` 0.85 → **0.55** and Hard `retreatHpFraction` 0.45 → **0.35** — first
pass wanted 0.45 / 0.28, but `LADDER` is a strict rise vs medium (0.45 / 0.3), so those two
landed a step above medium instead. Medium `standoffFraction` / `orbitBias` sit at **0.55 / 0.2**
so they stay below Hard. Easy’s row is unchanged.

`BOT_BRAIN_VERSION` → `"3.0.0"`.

**S26. Tuner skill + `docs/bot-behavior.md`.** A project skill (`.claude/skills/bot-tuner/`) maps
feel complaints (“medium is too hard to hit”, “hard isn’t attacking even when I don’t have ult”)
to knobs. It reads live `bot-profiles.ts`, proposes direction per tier, and refuses a Hard-only
branch. The markdown page is rewritten to the new table in the same change. Source of truth is
the config file.

---

## 8. Overlay and debug

**S27.** `BotDebug` / `BotDebugPayload`: `situation` (the S13 id) replaces `goal`. Drop
`goalScores`. Keep tick, target, preferredRange, personality, firedSlot. Overlay prints
`personality | situation | range | slot`. Shared rebuild required.

---

## 9. Tests (the examples cannot silently return)

**S28.** Characterisation, not a scoreboard:

1. Live opponent `alive: false` or `phased: true` → Hard `fireSlots === 0` for the whole
   `memoryTicks` window (no ghost ult).
2. Bot in a corner, hittable opponent approaching → Hard throttle/heading toward open floor, not
   further into the bound, not toward arena centre.
3. Hittable opponent inside a ready gun’s S10 reach and inside Hard `fireConeRad` → Hard presses
   within a few recomputes (no lock required).
4. `waitOut` never sets a fire bit.
5. `tiers.test.ts` still shows Easy and Hard using the same factors differently (dodge, ult
   discipline, deadRespect).
6. `bot-profiles.test.ts` `LADDER` is a total record over the new `BotProfile`.

Do not run `npm run balance` as part of this work. Recommend it after ship. Playtest probes are
untouched.

---

## 10. Out of scope

Analog steer, pathfinding, GOAP, per-chassis script files, ArenaRoom bots, a fourth difficulty,
damage handicaps, rewriting `DRIVE_CONFIG`.
