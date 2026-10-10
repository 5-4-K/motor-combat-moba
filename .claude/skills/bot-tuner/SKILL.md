---
name: bot-tuner
description: >-
  Use when someone says a bot feels wrong, too easy, too hard, too accurate, not
  attacking, holding fire, sitting in a corner, reversing into a wall, moonwalking,
  not dodging, never ramming, walking into fire, feeling robotic, or fighting at
  the wrong range — including phrases like "medium bot is too hard to hit" or
  "hard bot is not attacking me". Tune BOT_PROFILES knobs for easy/medium/hard.
  Do not rewrite the brain unless they explicitly ask for a situation-play change.
---

# Bot tuner

The game has **one brain** (`BOT_BRAIN_VERSION` 7.1.1). Easy / medium / hard are rows of
numbers in [`packages/server/src/config/bot-profiles.ts`](../../../packages/server/src/config/bot-profiles.ts):
23 fields per tier, no coin flips. The practice bot and the balance harness's measurement pilot are
the same code and the same rows, so a retune moves both. The cheat-sheet is
[`docs/bot-behavior.md`](../../../docs/bot-behavior.md); the design is
[`docs/superpowers/specs/2026-10-09-bot-brain-v7-design.md`](../../../docs/superpowers/specs/2026-10-09-bot-brain-v7-design.md)
(BB1–BB70).

**You do not invent a Hard-only `if`.** **You do not nerf damage, speed, or HP.** **You do not
edit `DRIVE_CONFIG`.** **You do not tune around a solver bug.** **You do not move a
`BRAIN_CONSTANTS` value for a one-tier complaint** — a constant retunes all three tiers at once.
Weakness is worse use of the same facts, later reactions, and worse hands.

## Path

1. Read the live `BOT_PROFILES` object (not this skill's memory of the numbers).
2. **Read the overlay before naming anything.** In `?dev=playground` the debugged bot prints one
   line, sampled at 5 Hz:

   ```
   situation | range N facing | slot K | hit BEST/BAR | drive(+1,0)
   ```

   - `situation` is the committed situation (`recover`, `evade`, `unpin`, `waitOut`, `punish`,
     `reset`, `ram`, `fight`, `close`, in priority order).
   - `range N facing` is the goal the navigator is driving: the range it holds and `nose`, `orbit`
     or `free` (`none` in `recover`).
   - `slot K` is the pressed fire slot itself: the abilities read 1/2/3 (LMB/RMB/SPACE), the basic
     attack (Q) 0; `slot -` means it held fire.
   - **`hit BEST/BAR` answers every holds-fire complaint.** `BEST` is the best solved hit chance
     among ready slots; `BAR` is the tier's `hitChanceBar`. Below the bar with `slot -` is the bar
     working, and `hitChanceBar` is the tune. At or above it with `slot -`, check the burst gap,
     the switch lock and the situation's fire column (`waitOut` and `close` hold fire; `recover`
     holds only while dead, `phased` or `stunned`); if none explains it, it is a bug — stop and say
     so.
   - `drive(steer,throttle)` is the navigator's output.
3. Name the **factor**. Five, and four have knobs:
   - **judgment** — situations and ranges: `hitChanceBar`, `retreatHpFraction`,
     `punishHpFraction`, `opponentRangeRespect`, `wallLookaheadUnits`, and target politics
     (`woundedBias`, `vengefulness`, `targetCommitMs`).
   - **hands** — aim: `aimErrorSigmaRad` (how wide), `aimErrorDriftMs` (how fast it wanders),
     `burstGapMs`.
   - **prediction** — `stateEstimationSigma`: how wrong its read of your speed and turn rate is. A
     bot that misses a TURNING car is reading the curve wrong; one that sprays at a car driving
     STRAIGHT has bad hands. `aimErrorSigmaRad` will not fix the first.
   - **reaction** — the five timing knobs: `viewStalenessMs`, `reactionDelayMs`, `recomputeMs`,
     `acquireMs`, `dodgeReactionMs`; and what it notices at all: `awarenessRadiusUnits`,
     `rearBlindHalfAngleRad`, `memoryMs`, `trackedThreatLimit`, `dodgeHorizonMs`,
     `situationCommitMs`.
   - **the solver** — hit chance and expected damage (`bot/brain/solution.ts`). Not a knob.
4. Name the **tier** they complained about. Do not "fix Hard" by changing Easy unless they asked.
5. Propose **one knob, one direction, the current value → the new value**, with a one-line why.
   Wait for them to confirm before editing — same as weapon-forger.
6. After a confirmed edit: update the matching cells in `docs/bot-behavior.md`'s profile table in
   the same change. `bot-profiles.test.ts`'s `LADDER` must still hold. A table-only `BOT_PROFILES`
   retune moves `botFingerprint` on its own; bump `BOT_BRAIN_VERSION` if you changed brain code or
   `BRAIN_CONSTANTS` (the fingerprint hashes `BOT_PROFILES` and the version, never the constants).

**Stop tuning and say so** when the overlay shows a brain bug:

- the wrong **situation** for the moment (hard in `waitOut` while you are alive in front of it,
  `fight` while you are phased, `ram` while a slot is ready, `unpin` out in open floor);
- a press (`slot K`) in `recover` while the bot is stunned or phased;
- `hit` at or above the bar with `slot -` in a firing situation, outside the burst gap and switch
  lock;
- `solve()` reporting a hit chance for a shot the weapon plainly cannot make;
- a `drive` that contradicts the goal (driving away from a `nose` goal that is out of band).

## Complaint → knobs

| They say | Factor | First knob (direction relative to "too much of this feel") |
|---|---|---|
| "holds fire" / "isn't attacking" | judgment | Read `hit BEST/BAR` first. `BEST` below `BAR`: lower `hitChanceBar` on that tier. The bar is quantised by the solver's nodes (0.457 centre, 0.240 at ±1.15σ, 0.031 at ±2.37σ), so a move that does not cross a step (0.457, 0.697) changes nothing |
| "fires too much / wastes shots" | judgment | `hitChanceBar` up on that tier, or `burstGapMs` up |
| "medium is too hard to hit" | hands | `aimErrorSigmaRad` up on **medium**. Not `hitChanceBar`: raising the bar makes the bot pickier and so MORE deadly per shot |
| "hard tracks me perfectly" | hands | Same on **hard** |
| "misses me when I turn" | prediction | `stateEstimationSigma` down to lead a turn better, up to lead it worse (easy 0.25, medium 0.1, hard 0.03) |
| "sprays" | hands | `aimErrorSigmaRad` down |
| "feels robotic" | reaction, hands | `reactionDelayMs` up; `aimErrorDriftMs` changes how fast the wobble wanders |
| "reacts too fast / too slow" | reaction | `reactionDelayMs`, `viewStalenessMs`, `acquireMs`; `recomputeMs` is how often it re-decides |
| "never dodges" | reaction | `dodgeReactionMs` down (or `dodgeHorizonMs` up). A shot is dodged only when its ETA at notice lies in `(dodgeReactionTicks, dodgeHorizonTicks + ~3.5]` ticks, so the window is the gap between the two. Easy's window is a sliver by design. A beam is never dodged |
| "walks into obvious fire" | judgment | `opponentRangeRespect` up: it scales the opponent's shortest gun into a keep-out range |
| "charges in / never closes" | judgment | `opponentRangeRespect` down to close. Ceiling: `fightRange = max(comfort, keep-out)`, so nothing in the profile puts a bot closer than its own comfort range (0.85 × its shortest ready gun's effective reach). A brawling bot is a new field, not a tune — say so |
| "runs away when hurt" / "fights to the death" | judgment | `retreatHpFraction` (0 at easy: never resets) |
| "doesn't finish me off" | judgment | `punishHpFraction` (0.4 on every tier; its `LADDER` entry is "equal", so move all three or change the test with them) |
| "sits in a corner" / "drives into walls" | judgment | `wallLookaheadUnits` up: how early the reactive layer steers along a wall it is driving at. `unpin` is contact-only (a corner, or a wall or spike within `minEngageUnits` capped at the tier's `wallLookaheadUnits`: 40 u at easy, 70 u at medium and hard) and is not a knob — lowering a look-ahead under 70 also shortens that tier's contact |
| "reverses into a wall" / "moonwalks" | read the overlay | `unpin` repeating: the stuck test (a corner or a contact it cannot drive out of) — a brain issue, stop and say so. `fight` with `drive(…,-1)`: the orbit weave backing out nose-on, by design; `rangeBandUnits` sets how far, for every tier. `evade` with no threat in sight: a held dodge; `dodgeDistanceUnits` sets how far, for every tier. Both are `BRAIN_CONSTANTS`, so not a one-tier fix. Nothing senses a wall behind the car |
| "chases whoever shot it" / "ignores the wounded car" | judgment | `vengefulness` / `woundedBias`; `targetCommitMs` is how long it sticks |
| "doesn't see me" | reaction | `awarenessRadiusUnits`, `rearBlindHalfAngleRad`, `memoryMs` |
| "never rams" | **not a knob** | By design: `ram` is entered only when the kit is dry (no slot ready within `ramDryWindowMs`) and the target is within `ramRangeUnits`; the target driving at it does not abort it, but a shot it dodges does |
| "wastes ult" / "saves its big gun" | **not a concept** | There is no ult holding: every slot fires when its hit chance clears the bar, cooldown ignored |
| "it weaves" | **by design** | `fight` (`orbit` facing, unless a fixed-muzzle slot wants the nose) weaves across the range band to keep the target inside the turret's ±30° half-arc. Not a knob |
| "shots are all over the place" with a good `hit` | **not a knob** | The solver decides hit chance. If it presses shots it reports as landing and they miss, that is a solver bug |
| "easy and hard feel the same" | not a single knob | Read `packages/server/src/bot/brain/tiers.test.ts`. If green, the values are too close — move several judgment, hands and reaction knobs apart, still no `if (hard)` |

`stateEstimationSigma` and `aimErrorSigmaRad` are not probabilities; a value above 1 is a wild
misread, not an invalid one. Do not add either to `bot-profiles.test.ts`'s `PROBABILITY_FIELDS`.

## After they confirm

Edit only `bot-profiles.ts` (and the `docs/bot-behavior.md` cells). Then, from `packages/server`:

```
npx vitest run src/config/bot-profiles.test.ts
npx vitest run -c vitest.slow.config.ts src/bot/brain/tiers.test.ts src/bot/brain/controller.test.ts
```

Bot tests live in the slow suite (`npm run test:slow` runs them all). Recommend they try it in
Practice or `?dev=playground`, and `npm run balance` only if they want a new win-rate baseline —
the bot fingerprint will have moved.

**The invariants a retune must not break.** `bot-profiles.test.ts` holds them; check before you
propose, not after the suite goes red.

- Every `LADDER` field moves strictly in its declared direction across easy → medium → hard
  (`punishHpFraction` is declared equal on all three).
- Every `PROBABILITY_FIELDS` entry (`hitChanceBar`, `punishHpFraction`, `woundedBias`,
  `vengefulness`, `retreatHpFraction`, `opponentRangeRespect`) stays inside [0, 1].
- Perceived latency (`viewStalenessMs + reactionDelayMs`) still falls easy > medium > hard.
- `BRAIN_CONSTANTS.minEngageUnits` (70) stays below every tier's `awarenessRadiusUnits`.
