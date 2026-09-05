# Car Physics Rework — Plan Folder

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement these plans task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-09-06-car-physics-rework-design.md`](../../specs/2026-09-06-car-physics-rework-design.md)

**Goal:** Replace the scalar drive model with a true 2D velocity vector, make contact impulses
equal-and-opposite, derive ram severity from relative closing velocity, and add an `ImpulseDef` seam
so any weapon can push a car.

## The five stages

| # | Plan | Ends with |
|---|---|---|
| 1 | [`01-vector-drive.md`](01-vector-drive.md) | Cars drive heavy and aim well. Ramming temporarily degraded. |
| 2 | [`02-contact-and-impulse.md`](02-contact-and-impulse.md) | Contact reads correctly — walls deflect, mass decides who moves. |
| 3 | [`03-ram.md`](03-ram.md) | The ramming feel the brief asks for. |
| 4 | [`04-impulse-def.md`](04-impulse-def.md) | Weapons can push. `SLAM_CONFIG` dissolved. |
| 5 | [`05-tune-and-reconcile.md`](05-tune-and-reconcile.md) | Tuned values, rebuilt docs, honest probes. |

**Run them in order.** They are sequential stages of one rework, not independent subsystems. Each
ends somewhere the game is playable, but stage N assumes stage N−1 landed.

**[`interfaces.md`](interfaces.md) is the ledger of every name these plans share.** It outranks any
individual plan and is outranked by the spec. Read it before starting any stage — a task's
implementer sees only their own task, and that file is how they learn the names their neighbours use.

## Before you start, on any machine

```bash
npm install
npm run build -w @motor-combat-moba/shared
npm test
```

In a **fresh worktree**, `npm install` is not optional — without it Node walks up to the main
checkout's `node_modules` and every build inlines the *wrong* `shared` dist while all three suites
still pass. See the "Shared `dist` gotcha" section of `CLAUDE.md`.

## Verification commands

| Purpose | Command |
|---|---|
| One test file | `npx vitest run packages/shared/src/sim/drive.test.ts` |
| One test by name | `npx vitest run packages/shared/src/sim/drive.test.ts -t "coasts"` |
| One workspace | `npm test -w @motor-combat-moba/shared` |
| **Everything (the gate)** | `npm test` |

**`npm test` at the root is the only complete run.** It builds `shared` first, then runs every
workspace *and* the `scripts/*.test.mjs` suite. A per-workspace run silently skips the server suite.
Never claim a stage is done on anything less.

## Stage-crossing obligations

These are owed by the work as a whole, not by any one task. Stage 5 discharges them, but they are
listed here so nobody is surprised:

- `golden.test.ts` is refixtured in stage 1 — deliberately, since the integration it pins is being
  rewritten. Note the real cost: the fixture that would have caught an *accidental* change is
  regenerated here.
- `docs/turn-tuning.md` is hand-maintained and `scripts/turn-tuning-doc.test.mjs` recomputes every
  cell from built shared. It fails until the page agrees. Its prose also argues from figures inside
  sentences, which no test can see.
- `npm run build:manual` — `CAR_TABLE` and `WEAPON_TABLE` both gain fields, `balanceStamp` moves,
  `scripts/manual-page.test.mjs` fails until the players' guide is rebuilt.
- `BOT_BRAIN_VERSION` must be bumped: the bot's aim and perception change behaviour without
  `BOT_PROFILES` moving.
- Every playtest probe measuring ramming, collision depth or prediction error is invalidated.
  Compile breaks get fixed on the spot. Threshold and expectation changes are the user's call.
