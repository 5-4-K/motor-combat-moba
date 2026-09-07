# Car Physics Rework — Plan Folder

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement these plans task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-09-06-car-physics-rework-design.md`](../../specs/2026-09-06-car-physics-rework-design.md)
— **read its Changelog first.** The spec is on revision 2: it removes `mass` entirely and replaces
equal-and-opposite contact impulses with a `ramAttack`/`ramDefence` contest (R1–R11). This README and
`interfaces.md` describe stages 1–2 as executed against revision 1 and stages 3–5 as planned against
revision 2; the Changelog explains why the model changed mid-rework.

**Goal:** Replace the scalar drive model with a true 2D velocity vector, give contact a real impulse
seam, resolve ramming as a contest between each car's `ramAttack` and `ramDefence` rather than
mass-derived equal-and-opposite impulses, and add an `ImpulseDef` seam so any weapon can push a car.

## The five stages

| # | Plan | Ends with |
|---|---|---|
| 1 | [`01-vector-drive.md`](01-vector-drive.md) | **Executed (revision 1).** Cars drive heavy and aim well. Ramming temporarily degraded. |
| 2 | [`02-contact-and-impulse.md`](02-contact-and-impulse.md) | **Executed (revision 1).** Contact reads correctly — walls deflect, `ramDefence` (then: mass) decides who moves. |
| 3 | [`03-ram.md`](03-ram.md) | *Rewritten for revision 2.* `mass` removed; `ramAttack`/`ramDefence` and the push contest replace equal-and-opposite reactions. |
| 4 | [`04-impulse-def.md`](04-impulse-def.md) | Weapons can push. `SLAM_CONFIG` dissolved. `massScaled` ships as `defenceScaled` (R10). |
| 5 | [`05-tune-and-reconcile.md`](05-tune-and-reconcile.md) | Tuned values (`globalScale` measured, not guessed), rebuilt docs, honest probes. |

**27 commits landed stages 1 and 2.** Measuring stage 2's equal-and-opposite impulses showed every
chassis gets thrown backwards faster than its own top speed for landing a ram — see the spec's
Changelog for the arithmetic. Revision 2 answers that by removing `mass` and replacing
equal-and-opposite with the contest in R1–R11. **Stage 2's work is superseded in place, not
reverted:** its plumbing — the `Impulse` struct and its single-applier seam, `resolveWorld`'s fifth
parameter, `CarObstacle`, edge-triggered contact, wall deflection, `restitution: 0.15` — is exactly
what revision 2 builds on. Only the mass-derived, equal-and-opposite parts of stage 2 (`reactionOf`,
the mass-weighted math `applyImpulse` did) are what stage 3 now removes.

**Run them in order.** They are sequential stages of one rework, not independent subsystems. Each
ends somewhere the game is playable, but stage N assumes stage N−1 landed.

**Stage 3 is not renumbered or split here.** The spec notes it is now large enough to split (the stat
model — remove `mass`, build the contest — is a different body of work from ram feel — `reeling`,
falloff, bonus tuning), by inserting a `03b-` file if needed. That split is a separate decision and
is not made by this documentation pass.

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

- `golden.test.ts` was refixtured in stage 1 — **already discharged.** Deliberate, since the
  integration it pins was being rewritten; the fixture that would have caught an *accidental* change
  was regenerated then.
- `docs/turn-tuning.md` was rewritten in stage 1 for the vector-drive numbers — **already
  discharged for that pass.** It owes **another pass** for revision 2: removing `mass` from
  `CAR_TABLE` and adding `ramAttack`/`ramDefence` moves `balanceStamp` again, and
  `scripts/turn-tuning-doc.test.mjs` recomputes every cell from built shared, so it fails until the
  page agrees. Its prose also argues from figures inside sentences, which no test can see — re-read
  it even when the suite is green.
- `npm run build:manual` — `CAR_TABLE` and `WEAPON_TABLE` both gain fields (revision 2 adds
  `ramAttack`/`ramDefence` on top of stage 4's `WEAPON_TABLE.impulse`), `balanceStamp` moves,
  `scripts/manual-page.test.mjs` fails until the players' guide is rebuilt. The guide's mass display
  is also replaced by `ramAttack`/`ramDefence` (spec R11).
- `BOT_BRAIN_VERSION` must be bumped: the bot's aim and perception change behaviour without
  `BOT_PROFILES` moving.
- Every playtest probe measuring ramming, collision depth or prediction error is invalidated —
  doubly so now, since stage 3's model changed again after stage 2 shipped. Compile breaks get fixed
  on the spot. Threshold and expectation changes are the user's call.
- Balance harness: the config fingerprint moves again with the removal of `mass` and the addition of
  `ramAttack`/`ramDefence`, so no baseline taken before revision 2 is comparable. Bot fingerprint is
  unaffected unless `BOT_BRAIN_VERSION` above also bumps it.
