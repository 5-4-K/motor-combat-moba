# Invariant Reconciliation — Tracker & Resume Point

**Last session:** 2026-08-28
**State:** R0 set; R1, R3, R3a, R3b resolved. **Five conflicts open. Next up: R2 (tick rate).**
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
| R2 | **Simulation tick rate — 30 vs 60 Hz** | ⬜ **NEXT** |
| R3 | Remote car handling | ✅ Resolved |
| R3a | Contact & ram-as-crowd-control | ✅ Resolved |
| R3b | Collision response as impulse physics | ✅ Resolved |
| R4 | Transport — WebSocket vs WebRTC | ⬜ Open |
| R5 | Input redundancy | ⬜ Open |
| R6 | Tick sync / client lead | ⬜ Open |
| R7 | Design resolution — 1280 vs 1424 | ⬜ Open |
| R8 | HTTPS / secure context | ⬜ Open |

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

## R2 — what the next session needs

**The question:** stay at `TICK_RATE_HZ = 30` or move to the rules' 60 Hz.

Open the file with these already on the table:

1. **30 Hz has no recorded justification anywhere**, in either repo. The predecessor's own
   tick-rate benchmark gate (G7) was never closed. There is no position to defend, only momentum.
2. **R3 changed the cost.** The client now runs the roster step **six times per tick**, not once.
   60 Hz doubles that.
3. **R3b changed the stakes.** A spin-out is fast angular motion, and 30 Hz samples it poorly —
   at `turnRate` 4.2 rad/s one tick is 8°, and an impulse-driven spin will exceed that.
4. **It is a protocol-version change** (I-N10.2). `msToTicks` converts every authored weapon duration
   at `TICK_RATE_HZ`, so the whole weapon table's timing moves with it — and `reverseHoldTicks`,
   `collisionDamageCooldownTicks`, `AIM_TICKS` and the countdown all re-derive.
5. **It is hard invariant #1 in `CLAUDE.md`**, so changing it is a project decision, not a feature
   change.
6. Interacts with **R4** (patch rate and transport) and **R6** (client lead is measured in ticks).

After R2, the natural order is **R4 → R5 → R6** (one cluster: transport, redundancy and clock sync
are the same project), then **R7** and **R8**, which are independent and small.

---

## Housekeeping

- **Nothing is committed yet.** The worktree holds four new/edited files under `docs/`. Committing
  before the next session is recommended; no source code has been touched, so the suites are
  unaffected.
- The audit and rulings artifacts are **watched** by the session that published them; that watch does
  not survive into a new session. Republish with the `url` above.
- Sections B–E of the findings register are **independent of every open ruling** — they can be worked
  at any time. By teeth: `C-1` blur key release, `N-2` the open monitor endpoint, `N-3` the version
  handshake, `C-5` the team marker. `C-2` (`window.game`) is a one-line delete.
