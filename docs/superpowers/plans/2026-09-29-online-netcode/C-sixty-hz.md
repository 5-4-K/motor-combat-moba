# Phase C — 60 Hz and per-tick snapshots

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the sim at 60 Hz and send exactly one snapshot per tick, with every tick-authored value converted first so the flip itself is a one-line change plus measured re-pins.

**Architecture:** Three steps, each green: (C1) bot knobs authored in ms and resolved to ticks, proven identical at 30 Hz; (C2) tests that hardcode 30 Hz derive from `TICK_RATE_HZ`, still at 30; (C3) flip `TICK_RATE_HZ` to 60, add `SNAPSHOT_RATE_HZ`, broadcast per tick, re-pin what legitimately moved, and measure.

**Tech Stack:** TypeScript, vitest, Colyseus 0.18 (`Room#patchRate`, `Room#broadcastPatch`).

**Spec:** `docs/superpowers/specs/2026-09-29-online-netcode-redesign-design.md` (NR11–NR16)

## Global Constraints

- `TICK_RATE_HZ` is defined once, in `packages/shared/src/constants.ts` (hard invariant 1).
- No drive-model rule changes; only the integration step size changes (NR15).
- Every re-pinned fixture states in its diff comment the old value, the new value, and why the move is the rate change.
- A change the playtest probes measure is reported loudly in the phase summary (root `CLAUDE.md`).

## Review Focus

- Bot timing at 30 Hz after C1 must equal today's bot timing tick for tick — pinned by C1's golden test.
- A room with `TICK_RATE_HZ` 60 but a client built at 30 must be refused (Phase D's protocol version); until then, note the gap.
- The countdown numeral and every HUD timer derived from ticks still counts real seconds at 60 Hz — pinned in C3 by the HUD tests that already exist, re-derived rather than re-pinned.
- The practice room's idle/presence timers (ms-authored) still fire at the same wall-clock time — pinned by `practice-room.test.ts` at 60 Hz.
- Six bots at 60 Hz stay inside `planner.bench.test.ts`'s budget — measured in C3 (NR16).

---

### Task 1 (C1): Bot timing knobs authored in milliseconds

**Files:**
- Modify: `packages/server/src/config/bot-profiles.ts` (authored table, `BOT_BRAIN_VERSION`)
- Modify: `packages/server/src/config/mode-bot.ts` (resolve at the one place profiles are handed out)
- Test: `packages/server/src/config/bot-profiles.test.ts` (create if absent)
- Modify: `docs/bot-behavior.md` (every `*Ticks` row becomes `*Ms`)

**Interfaces:**
- Produces:
  - `type AuthoredBotProfile` — `BotProfile` with each tick field replaced by a `…Ms: number` field: `viewStalenessMs`, `reactionDelayMs`, `recomputeMs`, `acquireMs`, `memoryMs`, `aimErrorDriftMs`, `burstGapMs`, `targetCommitMs`, `dodgeReactionMs`, `dodgeHorizonMs`, `blunderMs`, `situationCommitMs`, `slotStickMs`, `planHorizonMs`.
  - `BRAIN_CONSTANTS.predictionHorizonMs` (authored) and `resolveBrainConstants()` returning the existing shape with `predictionHorizonTicks`.
  - `resolveBotProfile(authored: AuthoredBotProfile): BotProfile` — `ticks = Math.round(ms * TICK_RATE_HZ / 1000)`.
  - `BotProfile` (what every brain module reads) is **unchanged**: still `*Ticks`.

- [ ] **Step 1: Write the failing golden test**

```ts
// packages/server/src/config/bot-profiles.test.ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { BOT_PROFILES, resolveBotProfile, resolveBrainConstants } from "./bot-profiles.js";

/** Today's table, in ticks at 30 Hz, copied verbatim before the conversion. */
const AT_30HZ = {
  easy: { viewStalenessTicks: 4, reactionDelayTicks: 9, recomputeTicks: 12, acquireTicks: 15, memoryTicks: 15, aimErrorDriftTicks: 20, burstGapTicks: 14, targetCommitTicks: 150, dodgeReactionTicks: 12, dodgeHorizonTicks: 12, blunderTicks: 10, situationCommitTicks: 20, slotStickTicks: 4, planHorizonTicks: 0 },
  medium: { viewStalenessTicks: 3, reactionDelayTicks: 6, recomputeTicks: 6, acquireTicks: 9, memoryTicks: 45, aimErrorDriftTicks: 14, burstGapTicks: 7, targetCommitTicks: 60, dodgeReactionTicks: 8, dodgeHorizonTicks: 18, blunderTicks: 10, situationCommitTicks: 12, slotStickTicks: 8, planHorizonTicks: 8 },
  hard: { viewStalenessTicks: 2, reactionDelayTicks: 4, recomputeTicks: 2, acquireTicks: 5, memoryTicks: 90, aimErrorDriftTicks: 9, burstGapTicks: 3, targetCommitTicks: 25, dodgeReactionTicks: 2, dodgeHorizonTicks: 24, blunderTicks: 10, situationCommitTicks: 6, slotStickTicks: 12, planHorizonTicks: 22 },
} as const;

describe("bot timing is authored in ms (NR14)", () => {
  it.runIf(TICK_RATE_HZ === 30)("resolves to exactly today's ticks at 30 Hz", () => {
    for (const tier of ["easy", "medium", "hard"] as const) {
      expect(resolveBotProfile(BOT_PROFILES[tier])).toMatchObject(AT_30HZ[tier]);
    }
    expect(resolveBrainConstants().predictionHorizonTicks).toBe(90);
  });

  it("scales with the tick rate", () => {
    const hard = resolveBotProfile(BOT_PROFILES.hard);
    expect(hard.targetCommitTicks).toBe(Math.round((BOT_PROFILES.hard.targetCommitMs * TICK_RATE_HZ) / 1000));
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --root packages/server src/config/bot-profiles.test.ts`
Expected: FAIL (`resolveBotProfile` missing).

- [ ] **Step 3: Convert the authored table**

In `bot-profiles.ts`, each authored tick value `n` becomes `…Ms: Math.round(n * 1000 / 30)` written as a literal (e.g. `viewStalenessTicks: 4` → `viewStalenessMs: 133`, `targetCommitTicks: 150` → `targetCommitMs: 5000`, `planHorizonTicks: 0` → `planHorizonMs: 0`). `predictionHorizonTicks: 90` → `predictionHorizonMs: 3000`. Keep every comment, rewording "ticks" to the ms figure where a comment quotes a count.

```ts
const TIMING_KEYS = [
  "viewStaleness", "reactionDelay", "recompute", "acquire", "memory", "aimErrorDrift", "burstGap",
  "targetCommit", "dodgeReaction", "dodgeHorizon", "blunder", "situationCommit", "slotStick", "planHorizon",
] as const;

export type AuthoredBotProfile = Omit<BotProfile, `${(typeof TIMING_KEYS)[number]}Ticks`> & {
  [K in (typeof TIMING_KEYS)[number] as `${K}Ms`]: number;
};

const toTicks = (ms: number): number => Math.round((ms * TICK_RATE_HZ) / 1000);

export function resolveBotProfile(authored: AuthoredBotProfile): BotProfile {
  const out: Record<string, unknown> = { ...authored };
  for (const key of TIMING_KEYS) {
    out[`${key}Ticks`] = toTicks(authored[`${key}Ms`]);
    delete out[`${key}Ms`];
  }
  return out as unknown as BotProfile;
}
```

`BOT_PROFILES` becomes `Readonly<Record<BotDifficulty, AuthoredBotProfile>>`. `BRAIN_CONSTANTS` gets `predictionHorizonMs`; export `resolveBrainConstants()` returning the old shape with `predictionHorizonTicks: toTicks(BRAIN_CONSTANTS.predictionHorizonMs)`, and change the three brain read sites (`controller.ts:326,359`, `planner.ts:816`) to read the resolved constant. Bump `BOT_BRAIN_VERSION` to `"6.3.0"` with a comment: "bot timing authored in ms (NR14); identical at 30 Hz, doubles in ticks at 60 Hz".

- [ ] **Step 4: Resolve at the hand-out point**

In `mode-bot.ts`, where `profiles: BOT_PROFILES` is placed into each mode's bot row, place `resolveBotProfile`'d copies instead, so every brain module still receives a `BotProfile` in ticks. Grep for any other direct `BOT_PROFILES[` read and route it through `resolveBotProfile`.

- [ ] **Step 5: Tests**

Run: `npm run build -w @motor-combat-moba/shared && npx vitest run --root packages/server`
Expected: the new test passes; every other bot test result is unchanged from the phase baseline (identical behaviour at 30 Hz).

- [ ] **Step 6: Docs and commit**

Update `docs/bot-behavior.md`'s parameter tables (`*Ticks` rows → `*Ms` with the ms values).

```bash
git add packages/server/src/config packages/server/src/bot docs/bot-behavior.md
git commit -m "refactor(bot): author bot timing in ms, resolve to ticks (NR14)"
```

---

### Task 2 (C2): Tests derive their rate from `TICK_RATE_HZ`

**Files:**
- Modify: tests that hardcode 30 Hz. Find them with
  `grep -rlnE "1 / 30|/ 30\b|\* 30\b|30 Hz|30Hz" packages/*/src --include=*.test.ts`
  (at the time of writing: `shared/src/sim/{golden,drive,drive-rate,step,combat}.test.ts`, `shared/src/sim/weapons/{hits,instances,fire}.test.ts`, `shared/src/sim/status/channels.test.ts`, `shared/src/config/weapon-config.test.ts`, `server/src/sim/{tick,pipeline-order}.test.ts`, `server/src/rooms/tick-pipeline.test.ts`, `server/src/bot/brain/{planner,planner.bench,perception}.test.ts`, `client/src/scenes/status-hud.test.ts`, `client/src/modes/{last-standing,conquer,deathmatch}/hud.test.ts`)

**Interfaces:** none.

- [ ] **Step 1: For each file, replace a literal that means "the tick rate" with `TICK_RATE_HZ` / `MS_PER_TICK`**

A literal `30` that means ticks-per-second, `1 / 30` meaning dt, or `33`/`33.3` meaning ms-per-tick becomes `TICK_RATE_HZ`, `1 / TICK_RATE_HZ` or `MS_PER_TICK`. A tick COUNT that means "one second" becomes `TICK_RATE_HZ`; "half a second" becomes `TICK_RATE_HZ / 2`. A literal `30` that is a distance, damage, angle or anything else stays. Golden fixtures that pin an integrated trajectory (`golden.test.ts`) are NOT re-derived here — they are re-pinned in C3.

- [ ] **Step 2: Run the whole suite at 30 Hz**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: identical results to before the task (only the two G12 failures).

- [ ] **Step 3: Probe the flip without committing it**

Temporarily set `TICK_RATE_HZ = 60` in `packages/shared/src/constants.ts`, run `npm test`, and paste the list of failing tests into the task report and EXECUTION.md's in-flight block (this is C3's worklist). Revert the constant.

- [ ] **Step 4: Commit**

```bash
git add packages
git commit -m "test: derive tick-rate literals from TICK_RATE_HZ (NR15 prep)"
```

---

### Task 3 (C3): Flip to 60 Hz and broadcast one snapshot per tick

**Files:**
- Modify: `packages/shared/src/constants.ts` (`TICK_RATE_HZ = 60`; add `SNAPSHOT_RATE_HZ = 60`; delete `DEFAULT_PATCH_RATE_HZ` once nothing reads it)
- Modify: `packages/server/src/rooms/{ArenaRoom,PracticeRoom,PlaygroundRoom}.ts` (patch cadence)
- Create: `packages/server/src/rooms/snapshot-cadence.ts` and its test
- Modify: the fixtures on C2's worklist; `docs/turn-tuning.md` (tables recomputed by its own snippet); `packages/client/public/manual.html` (`npm run build:manual`); `CLAUDE.md` hard invariant 5; `docs/config-reference.md`

**Interfaces:**
- Produces: `SNAPSHOT_RATE_HZ` (shared), `isSnapshotTick(tick: number): boolean` (server, `snapshot-cadence.ts`).

- [ ] **Step 1: Snapshot cadence, test first**

```ts
// packages/server/src/rooms/snapshot-cadence.test.ts
import { describe, expect, it } from "vitest";
import { SNAPSHOT_RATE_HZ, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { isSnapshotTick } from "./snapshot-cadence.js";

describe("isSnapshotTick (NR12)", () => {
  it("fires every TICK_RATE_HZ / SNAPSHOT_RATE_HZ ticks", () => {
    const every = TICK_RATE_HZ / SNAPSHOT_RATE_HZ;
    const fired = [...Array(12).keys()].filter(isSnapshotTick);
    expect(fired).toEqual([...Array(12).keys()].filter((t) => t % every === 0));
  });
  it("the snapshot rate divides the tick rate", () => {
    expect(Number.isInteger(TICK_RATE_HZ / SNAPSHOT_RATE_HZ)).toBe(true);
  });
});
```

```ts
// packages/server/src/rooms/snapshot-cadence.ts
import { SNAPSHOT_RATE_HZ, TICK_RATE_HZ } from "@motor-combat-moba/shared";

/** A snapshot is always the state of exactly one tick (NR12). */
export function isSnapshotTick(tick: number): boolean {
  return tick % (TICK_RATE_HZ / SNAPSHOT_RATE_HZ) === 0;
}
```

In `constants.ts` add, beside `TICK_RATE_HZ`:

```ts
/**
 * How often the server broadcasts a snapshot (NR12). Must divide `TICK_RATE_HZ`. A snapshot is the
 * state of exactly one tick and carries that tick; no client code may assume one per tick (hard
 * invariant 5).
 */
export const SNAPSHOT_RATE_HZ = 60;
```

- [ ] **Step 2: Rooms broadcast at the end of a snapshot tick**

In each room's `onCreate`, replace `this.setPatchRate(1000 / DEFAULT_PATCH_RATE_HZ);` with `this.patchRate = null;`, and at the very end of each room's `tick()` (after everything that writes state) add:

```ts
    if (isSnapshotTick(this.state.tick)) this.broadcastPatch();
```

The playground's paused path still broadcasts (it writes `paused`), so call it there too if its tick returns early. Then delete `DEFAULT_PATCH_RATE_HZ` from shared and fix every reader the compiler names (docs mention it too: `docs/networking.md`, `docs/config-reference.md`).

- [ ] **Step 3: Flip the rate**

`export const TICK_RATE_HZ = 60;`

Run: `npm run build -w @motor-combat-moba/shared && npm test 2>&1 | tee /tmp/c3.txt | grep -E "Test Files|Tests |FAIL"`

- [ ] **Step 4: Work the failure list**

For each failing test, decide which of these it is and act:
1. **A duration counted in ticks that should have been derived** → derive it (as in C2).
2. **An integrated trajectory or measured figure that legitimately moved with dt** (golden drive fixture, reach/flight tick counts, bot duel figures) → re-pin, and in the diff comment write old → new and "dt 1/30 → 1/60".
3. **A behaviour that broke** (a timer now fires at the wrong wall-clock time, a HUD counts wrong) → fix the code, not the test.

The pre-existing G12 failures stay as they are; the three bot tests CLAUDE.md lists as `bot-tuner` questions (OFF-AXIS, P49, P50) are recorded with their new numbers, not tuned here.

- [ ] **Step 5: Regenerate the derived docs**

```bash
npm run build:manual
node --test scripts/turn-tuning-doc.test.mjs 2>&1 | tail -20
```

Update `docs/turn-tuning.md`'s tables with the values its "Keeping this page honest" snippet prints until the doc test passes, and re-read its prose for figures the rate moved.

- [ ] **Step 6: Measure and report the rate change**

Run: `npm run ttk 2>&1 | tail -30` and `npx vitest run --root packages/server src/bot/brain/planner.bench.test.ts`. Record in EXECUTION.md: turn radius and time-to-top-speed per chassis before/after (from `docs/turn-tuning.md`), the TTK matrix diff, and the bench result.

- [ ] **Step 7: Invariant 5 and config docs**

In `CLAUDE.md` replace invariant 5 with: `5. Snapshot rate is its own constant (`SNAPSHOT_RATE_HZ`); no client code may assume one snapshot per tick.` Update the "Sim rate ≠ patch rate" mentions in `docs/architecture.md`/`docs/networking.md`/`docs/config-reference.md` to the new constants.

- [ ] **Step 8: Full check and commit**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL" && npm run build`
Expected: only the G12 failures plus the recorded bot-tuner cases.

```bash
git add -A packages docs CLAUDE.md
git commit -m "feat(sim): 60 Hz tick and one snapshot per tick (NR11-NR13, NR15)"
```

- [ ] **Step 9: Phase close-out**

EXECUTION.md: Phase C `Landed` with the measured numbers; re-run `npm run build -w @motor-combat-moba/shared && NETSIM_BASELINE=1 NETSIM_REPORT=1 npx vitest run --root packages/server src/netsim` (the baseline shape: 60 s, six cars, seeds 1–3, mean) and note the legacy model's numbers at 60 Hz under the baseline table. Two netsim notes:
  - (a) `packages/server/src/netsim/run.ts` imports `DEFAULT_PATCH_RATE_HZ` and runs a patch clock independent of ticks. When the constant is deleted (Step 2/3), rework it to broadcast a snapshot at the end of each snapshot tick, as the rooms do — it stops compiling otherwise.
  - (b) When recording the 60 Hz numbers, note that reconcile p95 (one sample per reconcile) and head-of-line stalls (per message) shift with the message rate alone, so a move in those rows is not by itself a netcode change. In the phase summary, say loudly: **every playtest probe now measures a 60 Hz sim; recommend `npm run playtest -- --scope=all`.**
