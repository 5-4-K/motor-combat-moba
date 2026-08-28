# Invariant Reconciliation — Tracker & Resume Point

**Last session:** 2026-08-28
**State:** **All eight conflicts resolved on paper (R0–R8).** Three carry branches pending one measurement (R4.3, R4.6, R5). Next phase is execution — see "Build order" below.
**Branch:** `claude/motor-combat-rules-review-f319c6` (worktree) off `development/main` @ `7439c2f`

> **Resuming? Read this file first, then the rulings doc.** Everything else is reference.

---

## The four documents

| What | Where | Role |
|---|---|---|
| The rules being reconciled against | [`docs/invariants/NETCODE_INVARIANTS.md`](../../invariants/NETCODE_INVARIANTS.md), [`BROWSER_CLIENT_INVARIANTS.md`](../../invariants/BROWSER_CLIENT_INVARIANTS.md) | Input. Copied verbatim from the supplied zip, **unmodified** — the rulings amend them on paper, not in the file. |
| What the audit found | [`specs/2026-08-28-invariant-audit-findings.md`](../specs/2026-08-28-invariant-audit-findings.md) | Durable findings register. Frozen — do not edit as rulings land. |
| What we decided and why | [`specs/2026-08-28-invariant-reconciliation-decisions.md`](../specs/2026-08-28-invariant-reconciliation-decisions.md) | **The live document.** New rulings go here. |
| This file | you are here | Session state, open items, artifact links. |

**Published artifacts** (same content, prettier; the markdown is canonical). Pass the URL as `url`
when republishing or a duplicate artifact is created instead:

- Audit — `https://claude.ai/code/artifact/5d9c8704-a3a6-4e6b-8612-4d82d9a641df`
- Rulings — `https://claude.ai/code/artifact/bbf01772-0adf-4674-846d-61f76d66ced7`

---

## Register

| # | Conflict | Status |
|---|---|---|
| R0 | Scope & latency targets | ✅ Set — governs everything below |
| R1 | Projectile prediction | ✅ Resolved (revised once, for online) |
| R2 | Simulation tick rate | ✅ Resolved — hold 30 Hz; R2.1 ms-authoring first; patch rate moved to R4 |
| R3 | Remote car handling | ✅ Resolved |
| R3a | Contact & ram-as-crowd-control | ✅ Resolved |
| R3b | Collision response as impulse physics | ✅ Resolved |
| R4 | Transport — WebSocket vs WebRTC (also owns the patch rate) | ✅ Resolved on paper; R4.3/R4.6 conditional |
| R5 | Input redundancy | ✅ Resolved — conditional on R4.3; **seq dedupe is a prerequisite** |
| R6 | Tick sync / client lead | ✅ Resolved — jitter buffer, not a clock |
| R7 | Design resolution | ✅ Resolved — keep 1424; free at the floor viewport |
| R8 | HTTPS / secure context | ✅ Resolved — collapses into R4.3 |

---

## Standing context — do not re-derive

**R0 governs every remaining ruling.** LAN is a v1 convenience; the goal is **online multiplayer with
mixed ping**. Targets: feel parity ≤ 80 ms RTT, competitive fairness ≤ 130 ms, honest degradation to
250 ms, refuse beyond. Feel is bought with prediction; fairness with lag compensation; neither
substitutes for the other.

**Weapons will include both aim-assisted and manual-aim entries.** Manual aim stays — it is the *easy*
netcode case and the only aiming-skill axis in a keyboard-only game. Its bill: **manual aim is what
forces lag compensation**, because aim assist is inherently lag-compensating and manual aim is not.
Not needed for LAN v1 or an all-aim-assist roster; required before the first manual-aim weapon ships
online. D20's `PoseSnapshot` seam already exists for it.

**Ram damage may be removed**; ramming becomes crowd control via impulse physics — pushback and spin
from contact geometry, on cars *and* on walls/obstacles at reduced intensity. That is a **separate
design pass** (`CLAUDE.md` gates the drive model, collision-damage rules and physics engines) and
deserves its own numbered register in the shape of D1–D22 / A1–A14. R3/R3a/R3b make it possible; they
do not decide it.

### Facts established by inspection — cite, don't re-measure

| Fact | Source |
|---|---|
| Shot latency (key press → seeing your own shot): **~44 ms LAN, ~112 ms at 70 RTT** | R0 arithmetic |
| Remote car is drawn **~76 ms behind on LAN, ~110 ms online** — 41 / 59 units at 540 u/s, ≈ a car length | R3 |
| A car has **three different positions**: drawn (interp, ~76 ms), collided-against (raw pose, ~26 ms), server truth. The first two differ by **27 units** | `ArenaScene.ts:793` vs `step-context.ts` |
| `turnRate` **4.2 rad/s** → staleness becomes **6.3° / 14.5° / 18.3° / 26.5°** of angle error | `drive-config.ts` |
| Aim-assist hit tolerance ≈ **28 units** (half a 32-unit car + 12-unit hitbox) | `AIM_CONFIG` comments |
| `fireball` has `usesAimAssist: true` and **every chassis carries only fireball** → aim assist is universal today | `weapon-config.ts` |
| `updateLock`, `AIM_CONFIG`, `lockScore`, `hasLineOfSight` are **already pure and exported from shared** — the client can run the identical lock | `shared/src/index.ts` |
| `SimBody` is `{x, y, angle, speed, reverseHold}` — **`speed` is a scalar along the heading, so a car cannot be pushed sideways, and nothing can spin** | `sim/step.ts`, `drive.ts` |
| `WeaponInstanceState` carries no input `seq` — **no key to match a predicted shot to a server instance** | `WeaponInstanceState.ts` |
| `resolveWorld` penetration is **unbounded** — a documented 48-unit stable overlap exists | `collide.ts` |
| The **client has no roster loop** — it steps only itself against frozen remote hulls, so the mutual push-apart the server gets never happens in prediction | `collide.ts` comment, `step-context.ts` |
| `RELAXATION_PASSES` = **1** | `collide.ts:62` |
| The latency injector is the **predecessor's pre-fix version** (reorders inputs; TCP does not) | vs `E:\Work\motor-combat` |

### Provenance of the eight conflicts

Traced through this repo *and* the predecessor at `E:\Work\motor-combat` (which has a formal gate
register, `docs/open-decisions.md`, plus measured latency evidence in `docs/networking.md`).

- **Argued:** projectile prediction, design resolution, HTTPS/LAN scope, transport (cost at the time,
  later vindicated by measurement — *"reconciliation is exact at any latency… measured peak error at
  40 ms, 150 ms and 400 ms one-way: 0"*).
- **Inherited, never justified:** tick rate (predecessor's Gate **G7 still OPEN**), remote
  interpolation (`interpolationDelayMs` marked *"not in scope"* in their gate register).
- **Absent — never considered:** input redundancy, clock sync.

Practical reading: the *argued* four will push back with evidence; the *inherited/absent* four cost
engineering but no argument.

---

## Build order

The paper phase is complete. This is R4.7's sequencing ruling as a work plan. **Nothing below has
been implemented** — the whole exercise so far is documents.

### Tranche 0 — unconditional, small, no open ruling depends on them

| Item | Why |
|---|---|
| **R2.1** — convert 4 constants to ms-authored (`collisionDamageCooldownTicks`, `reverseHoldTicks`, `pendingInputCap`, `maxInputsPerTick`) | Makes the tick rate a knob rather than a migration. New I-N10.7. |
| **R2.3** — remove the `TICK_RATE_HZ` env override | Server-only override desyncs every client silently (N-3). |
| **N-12** — port the predecessor's per-stream ordering clamp into the latency injector, add a loss knob | **Until this lands, every `SIM_LATENCY_MS` run misleads** — it manufactures reorders TCP never produces. |
| **C-1** — release held keys on `blur` / `visibilitychange` | Costs matches today: alt-tab while accelerating and the car drives on. |
| **C-2** — delete `window.game` | One line. |
| **N-2** — gate or remove the unauthenticated `/colyseus` monitor | Full room state to anyone who can reach the port, in every deploy mode. |

### Tranche 1 — the big change, with its verification

**R3 and the R4.1 harness together.** The harness is R3's verification, not a separate project;
R4.7's one hard constraint is that it must not land *after* R3.

- Lift the roster loop into shared as `stepRoster(entries, inputs, world, dt) → { bodies, contacts }`
  — note the contact-set output (I-N3.11), designed in from the start even though nothing consumes it
  until R3b.
- Add `inputBits` to `PlayerState` (one `uint8`).
- Predict and reconcile every car uniformly; retire `InterpolationBuffer`, keep `blendPose`.
- **Restore seq dedupe in `serverTick`** — R5's prerequisite, one line, and load-bearing the moment
  redundancy exists.

### Tranche 2 — measure

Run R4.1's five profiles against both transport models. Capture **R2.6's CPU budgets** in the same
pass (≤ 8 ms server, ≤ 4 ms client roster step) — neither has ever been measured, and this closes
Gate G7, open since the predecessor.

### Tranche 3 — decide the conditionals by lookup

1. **N-4 first** — quantise the wire (raw float64 poses today). It changes the bandwidth arithmetic
   both remaining conditionals depend on.
2. **R4.3** — pass → stay on WebSocket and amend I-N5.1; fail → WebRTC DataChannel, and then R4.4
   (hybrid), R5 (redundancy at 250 ms), R8 (secure context) all follow in one project.
3. **R4.6** — the patch rate, against the new encoder.
4. **R6** — size the jitter buffer against measured queue starvation.

### Tranche 4 — physics

**R3b as its own numbered spec** (`CLAUDE.md` gates the drive model, collision-damage rules and
physics engines). Static-geometry impulses (I-N4.13) can start earlier — they need no remote pose
accuracy. Car-vs-car needs R3. Produces the measured peak ω that **reopens R2.4**.

### Independent of all of it

Findings **B–E** in the audit register depend on no open ruling and can be worked at any time.

---

## Housekeeping

- **Everything here is documents.** No source file has been touched in the whole exercise, so the
  suites are unaffected and there is nothing to re-run before starting Tranche 0.
- The audit and rulings artifacts are **watched** by the session that published them; that watch does
  not survive into a new session. Republish with the `url` above rather than publishing fresh, or a
  duplicate artifact is created.
- Sections B–E of the findings register depend on no ruling and can be worked at any time. By teeth:
  `C-1` blur key release, `N-2` the open monitor endpoint, `N-3` the version handshake, `C-5` the
  team marker. `C-2` (`window.game`) is a one-line delete. The first three are already folded into
  Tranche 0 above.
- **The invariant documents in `docs/invariants/` are deliberately unmodified.** Every amendment lives
  in the rulings doc. If they are ever edited in place, the rulings become the diff's only record of
  why — keep them verbatim, or fold the amendments in as a single deliberate revision with the
  rulings cited.
