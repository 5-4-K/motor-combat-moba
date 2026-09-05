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
edit `DRIVE_CONFIG`.** Weakness is worse use of the same facts, and worse hands.

## Path

1. Read the live `BOT_PROFILES` object (not this skill's memory of the numbers).
2. Name the **factor**: judgment (dead, ranges, corner, ult save, dodge notice) vs hands (aim,
   cone, lead, steer, blunder).
3. Name the **tier** they complained about. Do not "fix Hard" by changing Easy unless they asked.
4. Propose **one knob, one direction, the current value → the new value**, with a one-line why.
   Wait for them to confirm before editing — same as weapon-forger.
5. After a confirmed edit: update the matching cells in `docs/bot-behavior.md` in the same change.
   `bot-profiles.test.ts` `LADDER` must still rise/fall as declared. Bump `BOT_BRAIN_VERSION` only
   if you also changed brain *code*; a table-only retune is enough for the fingerprint hash.

If the overlay already shows the wrong **situation** for the moment (Hard in `waitOut` while you
are alive in front of it, or `fight` while you are phased), that is a brain bug — stop tuning and
say so.

## Complaint → knobs

| They say | Factor | First knobs (direction relative to "too much of this feel") |
|---|---|---|
| "medium is too hard to hit" | hands | Raise `aimErrorSigmaRad`, `fireConeRad`, `aimToleranceRad`; lower `leadFactor` on **medium** |
| "hard tracks me perfectly" | hands | Same on **hard** |
| "hard isn't attacking / holds fire" | hands + fight gate | Lower `fireDisciplineChance`; if they are in range and facing, overlay must be `fight`. Lock wait is forbidden — do not add it back |
| "isn't attacking even when I don't have ult" | their ult is irrelevant | They mean the bot's own guns. Same as holds-fire. Do **not** drop `ultDisciplineChance` unless they also waste / never use the 5s gun |
| "wastes ult" / "ults my corpse" | judgment | Raise `deadRespect` (corpse); raise `ultDisciplineChance` (live full-HP dump) |
| "sits in a corner" | judgment | Raise `cornerRespect`; confirm overlay `unpin`. Do not send them to the map centre |
| "never dodges" | judgment | Raise `dodgeChance` / `incomingCarChance`; lower `dodgeReactionTicks` |
| "weaves / moonwalks" | fight drive | Lower `orbitBias`; lowering `standoffFraction` if they reverse-kite in open floor |
| "too close / too far" | range | `standoffFraction` (own band), `opponentRangeRespect` (their shortest gun). Predator uses aim reach (~800), not 1800 |
| "easy and hard feel the same" | not a single knob | Read `packages/server/src/bot/brain/tiers.test.ts`. If green, the values are too close — move several judgment+hands knobs apart, still no `if (hard)` |

`aimToleranceRad` must stay **below** `fireConeRad` on that same row.

## After they confirm

Edit only `bot-profiles.ts` (and the `docs/bot-behavior.md` cells). Run:

```
npx vitest run src/config/bot-profiles.test.ts src/bot/brain/tiers.test.ts
```

from `packages/server`. Recommend they try it in Practice or `?dev=playground`. Recommend
`npm run balance` only if they want a new win-rate baseline — the table hash will have moved.
