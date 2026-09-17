# Unity Physics Port — Execution State

> **Read this first in any session that executes one of these plans**, before the stage plan itself.
> It is the state file: where the work got to, what was measured, and which task is in flight.
>
> **The update rule, which is the whole point of this file:** update it **in the same commit** as the
> work it describes. A task's commit ticks that task's checkboxes in its plan *and* moves the block
> below. Nothing here is written from memory at the end of a session — a session can stop at any
> moment, and the last commit must already say where it stopped.

**Status as of 2026-09-18: nothing is executed.** The spec and all five stage plans are written; no
code has changed.

**Spec:** [`docs/superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`](../../specs/2026-09-18-unity-driving-and-ram-physics-port-design.md)
**Ledger:** [`interfaces.md`](interfaces.md) — outranks any one plan, is outranked by the spec.

## Starting a session

1. Read the in-flight block below. If it says *nothing in flight*, start at the first `Not started`
   row whose dependency is `Landed`.
2. **Verify it against git**, because this file is a claim and git is the fact:
   ```bash
   git log --oneline -8
   git status
   ```
3. Open that stage's plan and find the first unticked `- [ ]`. That is the resume point.
4. In a fresh worktree, `npm install` before the first build, or the build inlines the **main
   checkout's** shared `dist` and the server silently runs the wrong sim while every suite passes.

## In flight

*Nothing in flight.* Next: stage 1, Task 1.

## Stages

| # | Plan | State | Gate |
|---|---|---|---|
| 1 | [`01-drive-model.md`](01-drive-model.md) | Not started | Asymptotic top speed; measurable slip angle; `stepDrive` reads no module-level rate; 30/60 Hz equivalence test green |
| 2 | [`02-walls-and-bumps.md`](02-walls-and-bumps.md) | Not started | Restitution 0; a car slides along a wall and never gains speed; the spike self-trigger re-measured |
| 3 | [`03-rams.md`](03-rams.md) | Not started | Attacker stops and locks; victim flung, spun, reeling; head-on stops both; `applyImpulse` has one production caller |
| 4 | [`04-slam-and-effects.md`](04-slam-and-effects.md) | Not started | `wildcharge` still clearly harder than the best ordinary ram; `ramLock` published to players |
| 5 | [`05-tune-and-reconcile.md`](05-tune-and-reconcile.md) | Not started | Playground pass done with the user; probes honest; fresh balance baseline; docs true |

## What is known before any of it runs

- **Three bot tests are already red** on this branch, from the 2026-09-16 top-speed cut and the
  aim-lock merge: `controller.test.ts`'s OFF-AXIS mean offset (1.36 against a bar of 0.2),
  `tiers.test.ts` P49 (hard fires at range 6 against a bar of 7.17) and P50 (hit rate inverted
  between hard and medium). **This work does not fix them and must not silently re-pin them.** Record
  their readings at the start of stage 1 and again at the end of stage 5 — the `bot-tuner` pass in
  stage 5 is where they are addressed.
- **Every balance report from before this work is incomparable.** `configFingerprint` hashes
  `CAR_TABLE`, `DRIVE_CONFIG` and `RAM_CONFIG` whole; `BOT_BRAIN_VERSION` moves to `6.0.0` in stage 1.
- **`balanceStamp` does NOT hash `RAM_CONFIG`** but does hash `DRIVE_CONFIG`, the active `CAR_TABLE`
  rows, `STATUS_TABLE` and the guide's copy — so stages 1, 3 and 4 each owe `npm run build:manual`,
  and a ram-only retune does not.

## Measurements

Filled in as each stage lands. Each row is a number a later stage tunes against, so record the
command as well as the figure.

| What | Value | Measured in |
|---|---|---|
| Time to 90% of top speed, per chassis | — | stage 1 |
| Roll distance from top speed, per chassis | — | stage 1 |
| Slip angle at full lock, per chassis (target ~35° at `lateralGripRate` 3.0) | — | stage 1 |
| How far a ram's shove carries a reeling victim (`grip: 0.6`, target ~2.2 car lengths) | — | stage 3 |
| Settled speed into a wall, self-driven, vs `SPIKE_CONFIG.triggerSpeed` | — | stage 2 |
| Reference flank ram: shove and spin (Bastion → parked Bullseye) | — | stage 3 |
| `wildcharge` slam against the best ordinary ram | — | stage 4 |

## Deferred, and who owns it

- **`packages/server/playtest/collision.ts`'s energy-gain sweep** computes its predicted flip angle
  from `atan(sqrt(DRIVE_CONFIG.restitution))`, which is zero once stage 2 lands, so the probe sweeps
  nothing. Stage 5 owns rethinking it — not re-aiming it.
- **`DRIVE_CONFIG.dashSubstepMaxUnits` 16 → 8**, inherited from the 2026-09-06 car-physics rework's
  stage 2. Untouched by this port; stage 5 judges it with the user.
- **`wildcharge.impulse.speed` (520) and `uncontrolMs` (1400)** were provisional before this work and
  still are. Stage 4 makes their doc comments true; stage 5 pitches the numbers.
- **The netcode rewrite's phase 1 plan is stale** — its fixtures still name `speed`, `shoveX`,
  `shoveY` and `authority`, deleted by the car-physics rework's stage 1. Not this work's to fix, but
  whoever starts that rewrite must refresh it against the model this port leaves behind.

## Decisions that bind

- The spec's §2 decisions U1–U11 were put to the user and answered. **Do not re-litigate them**, in
  particular: pure Unity drag (launch and roll are one number), drift replacing the "no wash" rule,
  diminishing returns kept, the slam keeping its own rules, and 30 Hz now.
- **Grip is two knobs, not Unity's one** (U10 as revised, spec §5): `DRIVE_CONFIG.lateralGripRate`
  3.0 is the driver's drift, and `reeling`'s `grip: 0.6` multiplier is how far a shove carries a
  victim. The user chose this over a Unity-faithful single rate after seeing that one number could
  not serve both. **There is no `gripless` flag** — an earlier draft of the spec had one.
- **Turn radius is uniform across the roster on purpose, for now** (~89.9 u on all three). The user
  was shown two spreads and chose to revisit it in stage 5's tuning pass. Do not widen it silently.
- **The frozen `RAM_TICKS` table is fixed in stage 3** (U40), so stage 5's ram duration sliders are
  live. It was a real bug predating this work, not something the port introduced.
- **This work supersedes the 2026-09-06 car-physics rework's stage 5 and its parked restitution
  stage.** Stage 5 of THIS plan set records that in the rework's own `EXECUTION.md`.
- Tuning is the user's call. An agent proposes numbers and measures them; it does not decide what the
  game should feel like.
