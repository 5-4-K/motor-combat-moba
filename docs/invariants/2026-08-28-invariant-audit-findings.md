# Invariant Audit — Findings Register

**Date:** 2026-08-28
**Audited:** `development/main` @ `7439c2f`, all three packages
**Against:** [`docs/invariants/NETCODE_INVARIANTS.md`](../../invariants/NETCODE_INVARIANTS.md),
[`docs/invariants/BROWSER_CLIENT_INVARIANTS.md`](../../invariants/BROWSER_CLIENT_INVARIANTS.md)
**Rulings, standing facts, and the build order:**
[`2026-08-28-invariant-reconciliation-decisions.md`](2026-08-28-invariant-reconciliation-decisions.md)

**This file is the work list.** Every item below is fixable against the current architecture and
depends on **no open ruling** — they can be worked at any time, in any order. The eight axiom-level
conflicts are *not* here; they are resolved as `R0–R8` in the decisions doc.

Counts are per **entry**, not per clause: **18 HARD breaks** · **7 guarded or deferred** ·
**28 invariants verified held**.

Several of these are already scheduled into the decisions doc's build order — `N-12`, `C-1`, `C-2`
and `N-2` are Tranche 0, and `N-4` is Tranche 3. The rest are unscheduled and free-floating.

---

## B. Netcode — HARD breaks, fixable in place

| # | Invariant | Finding | Where |
|---|---|---|---|
| N-1 | I-N7.2, I-N7.3 | No per-client outbound filter at all. `lockTargetSessionId` is broadcast to everyone and hidden only in the UI — every client knows every car's lock target. | `PlayerState.ts:44`, `ArenaScene.renderCars` |
| N-2 | I-N7.5, I-C11.4 | `/colyseus` monitor mounted **unauthenticated in every deploy mode**, cloud included. Serves full room state and room disposal to anyone who can reach the port. | `monitor.ts:5`, `index.ts:27` |
| N-3 | I-N10.1, I-N10.2 | No client/server compatibility version anywhere. Concretely: `TICK_RATE_HZ` is env-overridable **server-side only**, while the client and `msToTicks` stay at compiled-in 30 Hz — setting it desyncs every client silently. | `mode.ts:13`, `weapon-ticks.ts:11` |
| N-4 | I-N5.7 | Positions, angles, velocities ship as raw **float64** (`@type("number")`). Rule requires quantisation with a stated bit width. Colyseus does delta-encode, so I-N5.6 is substantially met. | `PlayerState.ts:7-9,17`, `WeaponInstanceState.ts:14-18` |
| N-5 | I-N1.4 | Input validation checks shape but not plausibility — a negative or far-future `seq` passes. No arrival-rate check. Bounded by `lastProcessedInputSeq` being `uint32`, but the rule wants such inputs dropped. | `input-message.ts:8` |
| N-6 | I-N9.4 | Input intake is **unbounded by acknowledged design** — `NET_CONFIG`'s own comment says so. The per-tick *simulation* cap is sound; the queue has no cap. No per-message-type rate limits on lobby messages either. | `net-config.ts:13`, `tick.ts` |
| N-7 | I-N2.5 | `Math.random()` chooses spawns, colours and teams. Server-only so nothing desyncs today; blocks replay (I-N10.6). The functions already take the generator as a parameter. | `ArenaRoom.ts:219,220,463` |

## C. Netcode — guarded / deferred

| # | Invariant | Finding | Where |
|---|---|---|---|
| N-8 | I-N2.6 | Sim core is scrupulous about sorted iteration; the edges are not. `revealCars` builds its spawn roster from a `Set`, so spawn assignment rides insertion order. | `ArenaRoom.ts:455` |
| N-9 | I-N10.4, I-N10.5, I-N10.6 | No cross-engine determinism check, no replay from a recorded input stream, and the latency injector has **no packet-loss knob** — the required 100 ms / 30 ms / 3 % profile cannot be reproduced. | `latency-injector.ts:6` |
| N-10 | I-N9.1, I-N9.5 | No `allowReconnection`; a dropped client loses its slot mid-match. No `pagehide` handler. | `ArenaRoom.onLeave` |
| N-11 | I-N8.3 | Tick loop allocates freely — `sortedEntries`, per-player `otherCarHulls`, `masks` map, `runCombat`'s player copies. Nothing pooled. Likely fine at 6; the rule asks for the number. | `tick.ts`, `combat.ts` |
| N-12 | — | **The latency injector is the predecessor's pre-fix version.** Independent per-message `setTimeout` reorders inputs, which TCP never does; the predecessor fixed this in Phase 1.7 with a per-stream ordering clamp. `serverTick`'s seq-sort compensates for a test artifact, and every latency measurement here is harsher than the real link. | `latency-injector.ts` |

## D. Browser client — HARD breaks

| # | Invariant | Finding | Where |
|---|---|---|---|
| C-1 | I-C5.4 | **No `blur` or `visibilitychange` handler.** Alt-tab while accelerating and the car keeps driving *and keeps sending that throttle*. The catch-up half of §5 *is* handled (`drainTicks` clamps). | no handler anywhere |
| C-2 | I-C11.3 | `window.game = game` in every build — the rule names this case verbatim. Nothing uses it. | `main.ts:34` |
| C-3 | I-C2.1 | No `webglcontextlost` / `webglcontextrestored` handling. Permanent black screen mid-match on driver update or GPU switch. | `main.ts` config |
| C-4 | I-C6.2, I-C6.5 | Phaser's keyboard layer matches on `event.keyCode`, not `event.code`, and `SLOT_KEYS` follows — Q/E land on different physical keys on AZERTY. And **one binding set, no alternative**, while the core control is Up+Left+Space, the exact ghosting case I-C6.5 names. Rest of §6 is in good shape. | `slot-keys.ts:16-20`, Phaser `KeyboardManager.js:200` |
| C-5 | I-C13.5 | **No team channel in the arena at all.** Cars are per-*player* colours; `team` appears nowhere in `ArenaScene`/`car-visual`/`combat-visual`. Traceable to spec §6.2 (*"Color is a session cosmetic… independent of team panel"*) — defensible, but the second channel it made necessary was never added. | `color-config.ts:4`, `car-visual.ts:25` |
| C-6 | I-C0.1 | Out-of-scope environments are not detected or refused. A phone loads the client and finds a game with no touch controls. | `JoinScene`, `main.ts` |
| C-7 | I-C2.2, I-C2.6 | `type: Phaser.AUTO` allows a silent Canvas fallback rather than a checked WebGL2 baseline; `antialias`, `powerPreference`, `transparent` all unset. | `main.ts:18-30` |
| C-8 | I-C4.1, I-C4.3 | Steady-state per-frame allocation throughout the render path — `Set`/`Map` per frame, `bodyOf` per player per frame, `blendPose` spreads, `sample` returns new objects, `buildStepContext` rebuilds and sorts per predicted tick. `Graphics` handling, by contrast, is exactly right (I-C2.5). | `ArenaScene.renderCars`, `step-context.ts:44` |
| C-9 | I-C13.1, I-C13.2 | No localization table; every user-facing string is a literal at its use site, some concatenated. I-C13.4 cannot be evaluated until this exists. | `ui/screens/*.ts` |

## E. Browser client — guarded / deferred

| # | Invariant | Finding | Where |
|---|---|---|---|
| C-10 | I-C3.4, I-C3.5, I-C3.6 | DPR unhandled — but **deliberately deferred with a written plan** in `roadmap.md` that diagnoses the symptom and specifies the fix in five steps, including capping at 2. Roadmap entry is stale on the numbers (says 1408/128, now 1424/144). Zoom and resize debouncing remain genuinely unaddressed. | `roadmap.md` Deferred |
| C-11 | I-C12.1, I-C12.2 | No global `error` / `unhandledrejection` handlers, no catch at the loop boundary. Elsewhere §12 is honoured — no console in hot paths, no empty `catch {}`. | `main.ts` |
| C-12 | I-C11.2 | `?debug=1` is a live runtime flag in production. The `?dev=` tool registry **is** correctly gated on `import.meta.env.DEV`. Only the OBB outline is exposed. | `client-mode.ts:5` |
| C-13 | I-C7.*, I-C13.6 | **Audio does not exist** — no `AudioContext`, no assets. All of §7 vacuously satisfied and none implemented. Flagged because §7 is dense with things cheap up front and expensive to retrofit: the gesture unlock gate, decode-at-load, the voice cap, and the replay guard (I-C7.6 / I-N3.8). Same shape for I-C13.6 — no shake or flash to make adjustable yet. | none |
| C-14 | I-C10.2, I-C10.3, I-C10.6 | No record of Safari or Firefox testing; suites are Node-only. Feature detection vacuously held — there are no capability checks to get wrong yet. | `vitest.config.ts` |

---

## F. Verified held — 28

Summarised; the artifact carries the detail. **Nothing here is accidental compliance.**

- **§1 Server authority, in full.** The one client→server gameplay message is
  `{seq, steer, throttle, fireSlots}` — no angle, position, health or hit confirmation. Aim assist is
  computed entirely server-side. **The anti-aimbot property the rules call structural is genuinely
  structural here.** No client-only gameplay (I-N1.5). Fire rate, cooldown, stock and slot mask all
  validated server-side, with the wire mask treated as hostile (I-N4.12).
- **§2 Determinism.** `stepSim` is one shared function; `packages/shared` imports nothing from Phaser,
  the DOM or the browser and runs under Node. No Arcade Physics. Fixed `dt`; frame `delta` reaches
  only the accumulator and the camera. No wall-clock in the sim; `Date.now()` appears nowhere in the
  codebase. Weapon spread is deterministic (`fanOffset`), no RNG.
- **§3 Prediction.** Local input applies on the frame the key is pressed. Corrections are capped and
  snap when large; derived fields always snap. No non-rollback-safe side effect can fire on replay —
  because none exist yet.
- **§4 Combat.** Swept ("smear") collision, which retired the 30-unit-wall authoring rule — the exact
  tunnelling bug I-N4.3 describes, found and fixed. Contact damage never predicted; no lag comp on
  contact. Beams evaluated per tick with origin derived, never transmitted. One hull (`carHullOf`)
  for driving, ramming and hit tests alike.
- **§5–6 Transport & timing.** Packet budget trivially met; `performance.now()` throughout.
- **Client.** Phaser boundary immaculate end to end. `FIT` + letterbox with `ARENA_VIEW_WIDTH`
  deliberately decoupled from canvas width so HUD growth cannot widen the view. Persistent `Graphics`
  cleared and redrawn, never constructed in the loop. Catch-up hard-capped. Teardown matched and
  centralised in one `resetMatchState`. Content data-driven and validated at load. No browser storage
  at all, so §9 has nothing to violate. Update order explicit and documented.
