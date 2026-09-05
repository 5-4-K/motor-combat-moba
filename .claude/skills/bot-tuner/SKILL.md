---
name: bot-tuner
description: >-
  Use when someone says a bot feels wrong, too easy, too hard, too accurate, not
  attacking, wasting ults, sitting in a corner, not dodging, or fighting at the
  wrong range — including phrases like "medium bot is too hard to hit" or "hard
  bot is not attacking me even when I don't have ult". Tune BOT_PROFILES knobs
  for easy/medium/hard. Do not rewrite the brain unless they explicitly ask for
  a situation-play change.
---

# Bot tuner

The game has **one brain**. Easy / medium / hard are rows of numbers in
[`packages/server/src/config/bot-profiles.ts`](../../../packages/server/src/config/bot-profiles.ts).
The human cheat-sheet is [`docs/bot-behavior.md`](../../../docs/bot-behavior.md). The design is
[`docs/superpowers/specs/2026-09-05-bot-situation-play-design.md`](../../../docs/superpowers/specs/2026-09-05-bot-situation-play-design.md).

**You do not invent a Hard-only `if`.** **You do not nerf damage, speed, or HP.** **You do not
edit `DRIVE_CONFIG`.** **You do not tune around a solver bug.** Weakness is worse use of the same
facts, and worse hands.

## Path

1. Read the live `BOT_PROFILES` object (not this skill's memory of the numbers).
2. **Read the EV picture before naming a factor.** Firing is gated by `minShotValue` now, not an
   angle — before guessing from the symptom, check what `solve()` (`bot/brain/solution.ts`) is
   actually computing for the best available slot that tick. The playground overlay shows
   `personality | situation | range N | slot K` (`slot -` means it held fire) but does **not** yet
   print the solver's `value`, so "is it declining a real shot, or is nothing worth taking" has to be
   answered by instrumenting `solve()` or `chooseSlot`, not by eyeballing the overlay alone. If the
   best value clears `minShotValue` and the bot still holds fire, that is a bug, not a tuning
   question — stop and say so.
3. Name the **factor**: judgment (dead, ranges, corner, ult save, dodge notice) vs hands (aim,
   steer, blunder) vs the solver itself (hit chance, value — not a knob).
4. Name the **tier** they complained about. Do not "fix Hard" by changing Easy unless they asked.
5. Propose **one knob, one direction, the current value → the new value**, with a one-line why.
   Wait for them to confirm before editing — same as weapon-forger.
6. After a confirmed edit: update the matching cells in `docs/bot-behavior.md` in the same change.
   `bot-profiles.test.ts` `LADDER` must still rise/fall as declared. Bump `BOT_BRAIN_VERSION` only
   if you also changed brain *code*; a table-only retune is enough for the fingerprint hash.

If the overlay already shows the wrong **situation** for the moment (Hard in `waitOut` while you
are alive in front of it, or `fight` while you are phased), that is a brain bug — stop tuning and
say so.

## Complaint → knobs

| They say | Factor | First knobs (direction relative to "too much of this feel") |
|---|---|---|
| "medium is too hard to hit" | hands | Raise `aimErrorSigmaRad` on **medium**. `minShotValue` is not a straightforward easier/harder dial: lowering it widens what the bot will attempt (more, worse shots); raising it makes the bot *pickier and therefore MORE deadly per shot* — it is not the knob to reach for "easier to hit" |
| "hard tracks me perfectly" | hands | Same on **hard** |
| "hard isn't attacking / holds fire" | fire threshold | Lower `minShotValue` on **hard** — but check the EV picture first (Path step 2): a bot in `fight` correctly declining shots it cannot make is not the same bug as one that should be firing |
| "isn't attacking even when I don't have ult" | their ult is irrelevant | They mean the bot's own guns. Same as holds-fire. Do **not** drop `ultDisciplineChance` unless they also waste / never use the 5s gun |
| "wastes ult" / "ults my corpse" | judgment | Raise `deadRespect` (corpse); raise `ultDisciplineChance` (live full-HP dump) |
| "sits in a corner" | judgment | Raise `cornerRespect`; confirm overlay `unpin`. Do not send them to the map centre |
| "never dodges" | judgment | Raise `dodgeChance` / `incomingCarChance`; lower `dodgeReactionTicks` |
| "shots are all over the place" | **not a knob** | The solver (`bot/brain/solution.ts`) decides hit chance and value. If it is firing shots that miss, that is a solver bug to investigate, not a value to tune — say so rather than reaching for `aimErrorSigmaRad` |
| "it weaves instead of fighting" | steering, or a bug | `orbitBias` no longer exists — the orbit desire was deleted with the angular fire gate; a later phase reintroduces circling as emergent planner behaviour. Weaving today is either the steering lag compensation mis-tuned (`BRAIN_CONSTANTS.deadzoneFloorFraction` / `deadzoneCapMultiplier` in `bot-profiles.ts`) or a real bug — say so |
| "too close / too far" | range | `standoffFraction` (own band), `opponentRangeRespect` (their shortest gun). Predator uses aim reach (~800), not 1800 |
| "easy and hard feel the same" | not a single knob | Read `packages/server/src/bot/brain/tiers.test.ts`. If green, the values are too close — move several judgment+hands knobs apart, still no `if (hard)` |

## After they confirm

Edit only `bot-profiles.ts` (and the `docs/bot-behavior.md` cells). Run:

```
npx vitest run src/config/bot-profiles.test.ts src/bot/brain/tiers.test.ts
```

from `packages/server`. Recommend they try it in Practice or `?dev=playground`. Recommend
`npm run balance` only if they want a new win-rate baseline — the table hash will have moved.
