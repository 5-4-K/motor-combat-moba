# Bot Predictive Brain — Master Index, Execution Strategy, Tracker

> **For agentic workers:** This file is **not** executed directly. Execute one plan file at a time,
> in the numbered order. Source design:
> `docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md` — read it before the first plan
> and keep it open; every task cites its `Pnn` decisions.
>
> **REQUIRED SUB-SKILL** for each plan file: `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans`.
>
> **Completion rule (do not skip):** when a plan is implemented and its Validation section has been
> run successfully, update the **Execution Tracker** below in the same change (status → Done, date,
> short note). Never mark Done without Validation evidence. Do not start executing unless the human
> explicitly asks.

**Goal:** Rework the bot brain so easy plays like an amateur, medium like an experienced casual, and
hard like a highly skilled player — replacing a reflex-with-noise agent with one that predicts,
evaluates real firing solutions, and plans.

**Architecture:** A firing-solution solver built on the sim's own projectile geometry, a threat
evaluator that is the same solver with its arguments swapped, physics-based prediction through the
real `stepDrive`, and a receding-horizon planner over the complete 9-action input space. The
situation FSM survives as the strategy layer, supplying objective weights instead of headings.

**Tech Stack:** TypeScript, npm workspaces, Vitest. Server-only (`packages/server`); this work reads
`@motor-combat-moba/shared` and never modifies it.

**Environment:** Windows 10, PowerShell. Worktree
`E:\Work\motor-combat-MOBA\.claude\worktrees\bot-intelligence-rework-c37f8f`, branch
`claude/bot-intelligence-rework-c37f8f`.

**Spec:** `docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md`

---

## Global Constraints

Copied verbatim from the spec and from `CLAUDE.md`. Every task's requirements implicitly include
this section.

- **No cheating (P1, P4).** `BotView` is the whole of what a bot may know. Never reach for
  `inputQueues`, `prevFireMasks`, or `ArenaState` from inside `decide` or anything it calls.
- **State a human infers is inferred (P5).** `angVel`, `authority`, `shoveX/Y`, `reverseHold` on
  another car come from observed motion, never from the wire.
- **A behaviour is code, a tier is data (H8).** No module may branch on `"easy" | "medium" | "hard"`.
  Tier differences are numbers in `BOT_PROFILES`.
- **Fixed random draw counts (H21).** Every layer draws the same number of `rng()` calls regardless
  of branch. **The solver and planner draw zero** (P43).
- **One press per tick (H27).** `chooseSlot` returns one slot index, never a mask.
- **No magic numbers in logic.** New constants go in `BRAIN_CONSTANTS` or `BOT_PROFILES`.
- **`npm install` before the first build in this worktree**, or the build inlines the main checkout's
  shared `dist`. Verify with: the inlined path comment in `packages/server/dist/index.js` must read
  `// ../shared/dist/…`, not `// ../../../../../packages/shared/dist/…`.
- **Verify with root `npm test`**, never a per-workspace run — a per-workspace run silently skips the
  server suite.
- **Never create a new playtest probe or scenario.** Fix a compile break in one; otherwise report and
  recommend, do not edit (`CLAUDE.md`).
- **Do not touch `docs/ideas/` or `docs/invariants/`.**

---

## Plan list

Files are numbered by **execution order**, with the spec's phase letter in parentheses. The spec's
letters (B → C → A → D) are the dependency graph's topological order and are deliberately *not*
alphabetical; the numbers exist so nobody executes them in the wrong order.

| # | Plan file | Spec phase | What you get after Validation |
|---|---|---|---|
| 1 | `2026-09-05-bot-brain-1-firing-solutions.md` | **B** | The §1.1 lockout is fixed and the bot shoots on expected value instead of an angle. Hard reliably kills a stationary target. The bot presses `wildcharge` for the first time. |
| 2 | `2026-09-05-bot-brain-2-threat-and-cooldowns.md` | **C** | The bot knows when it is standing in someone's firing solution, and estimates enemy weapon readiness from what it has seen fire. |
| 3 | `2026-09-05-bot-brain-3-physics-prediction.md` | **A** | Lead comes from rolling the real drive model forward instead of a constant-velocity solve. Prediction quality becomes a tier knob. |
| 4 | `2026-09-05-bot-brain-4-planner.md` | **D** | Vector-averaging is gone. The bot plans an arc, hedges against the target's possible inputs, and the overlay shows why. The tier ladder becomes reflex → shallow → planning. |

---

## Execution strategy

### Required sequence

```
1 (B)  →  2 (C)  →  3 (A)  →  4 (D)
```

Strictly sequential. Nothing here may run in parallel, and the reasons are structural rather than
conventional:

1. **1 (B) first.** Plans 2 and 4 both consume the solver's geometry. Plan 2 is literally the same
   function with its arguments swapped; writing it first would mean writing that geometry twice.
2. **2 (C) after 1.** `dangerEV` is `solve()` inverted.
3. **3 (A) after 1.** A better predictor is wasted while shots are still released through a bad
   gate — the whole reason the spec orders A third rather than first.
4. **4 (D) last.** The planner scores on plan 1's `myEV` and plan 2's `theirEV`, and reuses plan 3's
   rollout code. It also performs the `movement.ts` deletion, which the earlier plans still depend on.

### Per-plan obligations that are easy to forget

Each plan carries a **Docs and skill** task. Per **P58b** these are *correctness* obligations, not
tidiness: `bot-tuner` is a skill and fires automatically on any "the bot feels wrong" phrasing, so a
stale copy would confidently propose edits to fields that no longer exist for the whole duration of
the following plans. **Do not defer these to the end.**

Each plan also bumps `BOT_BRAIN_VERSION` (P47): `4.0.0`, `4.1.0`, `4.2.0`, `4.3.0`. Every bump
invalidates prior balance baselines, which is expected and accepted (P55).

### Session / machine handoff

Each plan file is self-contained: files, interfaces, tasks, commands, Validation. An agent picking
this up fresh should:

1. Read this index (tracker + strategy).
2. Read the spec.
3. Read **only** the next Allowed plan.
4. Implement it, run its Validation, update the tracker.

---

## Execution Tracker

| # | Plan | Status | Date | Notes |
|---|---|---|---|---|
| 1 | `bot-brain-1-firing-solutions` (B) | **Done** | 2026-09-06 | Validation run; whole-branch review clean after one fix wave. `BOT_BRAIN_VERSION` 4.0.0. See below. |
| 2 | `bot-brain-2-threat-and-cooldowns` (C) | Not started | — | Allowed |
| 3 | `bot-brain-3-physics-prediction` (A) | Not started | — | Blocked on 1 (done) — allowed after 2 |
| 4 | `bot-brain-4-planner` (D) | Not started | — | Blocked on 2, 3 |

### What plan 1 changed, and what later plans inherit

- The fire gate is `solution.ts`'s expected value, not an angle. `fireConeRad`,
  `fireDisciplineChance` and `orbitBias` are gone from `BotProfile`.
- **`minShotValueFraction` is RELATIVE to the shooter's own kit ceiling**, not an absolute EV. An
  absolute threshold made a hard Bastion mute — its best possible shot (18.3) sat below the
  threshold (25) while Bullseye's ceiling is 78.3. Values easy 0.01 / medium 0.05 / hard 0.3.
- **`leadFactor` was NOT removed** — it belongs to plan 3, which actually replaces it. Removing it
  in plan 1 silently gave easy and medium a lead upgrade.
- A steering limit cycle was found and fixed mid-plan: `compensateForLag` in `movement.ts`, with
  `BRAIN_CONSTANTS.deadzoneFloorFraction` and `deadzoneCapMultiplier`. **Plan 4 deletes all of it**
  when the planner replaces bang-bang steering.
- Spec corrections made during execution: §1.1's severity, P35's phase column, P36's threshold
  semantics, P50's fire-volume claim. Read the spec, not this summary, before starting plan 2.

---

## Things discovered while planning that the spec now records

Two spec corrections were made during plan-writing. They are noted here so a reader of an older
copy is not misled:

1. **P21 was wrong.** The first draft claimed the `fired` sink was disabled in every room and had to
   be enabled. All three bot hosts already wire it (`PlaygroundRoom.ts:424`, `PracticeRoom.ts:409`,
   `balance/match.ts:271`), and `perception.ts` already records every weapon fired, not only ults.
   Plan 2 is correspondingly smaller. Two stale comments in the codebase assert the opposite and are
   fixed in plan 2.
2. **P36's phase column and P58a/P58b were added** after the first commit, pinning which profile
   fields land in which phase and what `bot-tuner` owes beyond a find-and-replace.

One constraint discovered that the plans handle rather than the spec:

3. **`bot-profiles.test.ts`'s `LADDER` is `Record<keyof BotProfile, Direction>`** — exhaustive, so
   the compiler forces it updated whenever a field is added or removed. Its three directions are
   `"rises"` (strict), `"falls"` (strict) and `"equal"`. Two new fields are neither: `planDepth` is
   `1, 1, 2` and `targetBranches` is `1, 1, 3`. Plan 4 adds a `"rises-or-equal"` direction rather
   than distorting the values to fit the test.
