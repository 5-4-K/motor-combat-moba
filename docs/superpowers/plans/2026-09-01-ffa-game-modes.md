# FFA Game Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add FFA Deathmatch — a timed mode with respawns, spawn protection and kill scoring — beside the existing last-car-standing rules, selectable by the host from the lobby.

**Architecture:** `GameMode` gains a third value; every existing consumer reads `sidesOf(mode)` and is unchanged, while `winRuleOf(mode)` is the new axis consumed in exactly one place. Spawn protection is *intangibility*, not invulnerability: the `isOnField` predicate splits into `isOnField` (may be simulated) and `isSolid` (participates in contacts), with the filter living inside `otherCarHulls` so it is symmetric and lockstep-safe. Kill credit is a single "last damager" string threaded to the one function that writes hp, booked at the one line that already detects death.

**Tech Stack:** TypeScript, npm workspaces, Colyseus schema, Vitest, Phaser 3.

**Spec:** [`docs/superpowers/specs/2026-09-01-ffa-game-modes-design.md`](../specs/2026-09-01-ffa-game-modes-design.md) — decisions M1–M33. Read it alongside this plan.

## Global Constraints

- **Enum wire values are never renumbered** (hard invariant 7). `GameMode.FFA` → `FFA_LAST_STANDING` is a *source rename only*; the value stays `0`. `FFA_DEATHMATCH` is appended as `2`.
- **No magic numbers in logic** (hard invariant 2). Every tunable lands in `DEATHMATCH_CONFIG`.
- **If `stepSim` reads it, it is a networked schema field** (hard invariant 8). `lastDamagerSessionId` is deliberately *not* networked because `stepSim` never reads it.
- **`stepSim` is the lockstep** (hard invariant 4). Anything changing who is solid must change inside a function both `serverTick` and the client's `buildStepContext` call.
- **Shared is consumed as built `dist`** (hard invariant 9). After editing `packages/shared`, rebuild it. Every test command below starts with the root `npm test`, which builds shared first.
- **Run the root `npm test`, never a per-workspace run** — a per-workspace run silently skips the server suite.
- **In this worktree, `npm install` must have been run once** before the first build, or builds inline the *main checkout's* shared `dist`.
- **Do not touch** `resolveWorld`, the OBB hull model, `carHullOf`, `stepDrive`, `canDamage`, `assignSpawns`, `reduceFlow`, or `livingSides`' internals. If a task seems to need one, stop and ask.
- **Do not create new playtest probe files or scenarios.** Task 16 fixes an existing compile break and two stale comments; that is the whole permitted scope.
- **Config values** (Task 2), copied verbatim into the table: `matchSeconds: 300`, `respawnDelaySeconds: 5`, `phaseSeconds: 1.5`, `phaseMaxSeconds: 3`.

**Verification command used throughout:**

```bash
npm test
```

To run one file while iterating (faster, but always finish a task with the full `npm test`):

```bash
npx vitest run packages/shared/src/flow/win.test.ts
```

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `packages/shared/src/flow/modes.ts` | `sidesOf` / `winRuleOf` — the two mode derivations |
| `packages/shared/src/flow/modes.test.ts` | tests for both |
| `packages/shared/src/config/deathmatch-config.ts` | `DEATHMATCH_CONFIG` and the derived `DEATHMATCH_TICKS` |
| `packages/shared/src/config/deathmatch-config.test.ts` | tick derivation and sanity bounds |
| `packages/shared/src/flow/respawn.ts` | the respawn lifecycle's rules, all pure: `farthestSpawn`, `isDueToRespawn`, `phaseDecision` |
| `packages/shared/src/flow/respawn.test.ts` | tests for all three |
| `packages/client/src/scenes/deathmatch-hud.ts` | pure HUD derivations: match clock, respawn countdown, killed-by banner |
| `packages/client/src/scenes/deathmatch-hud.test.ts` | tests for them |

**A note on where the tests are.** `ArenaRoom` has no test file and never has — it is deliberately a
thin shell, with every rule extracted into a pure module beside it (`match-helpers.ts`,
`select-next-host.ts`, `singleton-arena.ts`) and tested there, exactly as `ArenaScene` does on the
client. Do **not** stand up a Colyseus room harness for this work. Tasks 7, 8 and 9 put every
decision this feature makes into pure functions; Tasks 10, 11 and 15 are the wiring, and they are
verified in the browser because there is nothing left in them to unit test.

**Modified:** `packages/shared/src/constants.ts`, `config/status-types.ts`, `config/status-config.ts`, `sim/status/modifiers.ts`, `sim/status/statuses.ts`, `sim/context.ts`, `sim/combat.ts`, `schema/PlayerState.ts`, `schema/ArenaState.ts`, `lobby/start-rules.ts`, `flow/win.ts`, `index.ts`; `packages/server/src/sim/tick.ts`, `sim/ram-bridge.ts`, `sim/combat-bridge.ts`, `rooms/flow-map.ts`, `rooms/ArenaRoom.ts`; `packages/client/src/net/step-context.ts`, `ui/screens/lobby.ts`, `ui/lobby-view.ts`, `ui/results-view.ts`, `scenes/roster-panel.ts`, `scenes/ArenaScene.ts`; `packages/server/playtest/prediction.ts`, `playtest/weapons.ts`, `playtest/weapons2.ts`.

---

## Task 1: The mode axis

**Files:**
- Modify: `packages/shared/src/constants.ts:31-34`
- Create: `packages/shared/src/flow/modes.ts`
- Test: `packages/shared/src/flow/modes.test.ts`
- Modify: `packages/shared/src/lobby/start-rules.ts:15`, `packages/shared/src/index.ts`
- Modify: `packages/server/src/rooms/flow-map.ts:7-9`, `packages/server/src/rooms/ArenaRoom.ts` (6 call sites + line 534)
- Modify (rename only): `packages/shared/src/schema/ArenaState.ts:11`, `packages/client/src/scenes/LobbyScene.ts:29,40`, `packages/client/src/ui/screens/lobby.ts:25`, and the test files listed in Step 6

**Interfaces:**
- Produces: `GameMode.FFA_LAST_STANDING = 0`, `GameMode.TEAM = 1`, `GameMode.FFA_DEATHMATCH = 2`; `sidesOf(mode: GameMode): "ffa" | "team"`; `winRuleOf(mode: GameMode): "last_standing" | "deathmatch"`. Both exported from `@motor-combat-moba/shared`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/flow/modes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { sidesOf, winRuleOf } from "./modes.js";

describe("sidesOf", () => {
  it("puts both FFA modes on the same side structure", () => {
    expect(sidesOf(GameMode.FFA_LAST_STANDING)).toBe("ffa");
    expect(sidesOf(GameMode.FFA_DEATHMATCH)).toBe("ffa");
  });

  it("puts team mode on its own", () => {
    expect(sidesOf(GameMode.TEAM)).toBe("team");
  });
});

describe("winRuleOf", () => {
  it("separates the win condition from the side structure", () => {
    expect(winRuleOf(GameMode.FFA_LAST_STANDING)).toBe("last_standing");
    expect(winRuleOf(GameMode.TEAM)).toBe("last_standing");
    expect(winRuleOf(GameMode.FFA_DEATHMATCH)).toBe("deathmatch");
  });
});

describe("wire values", () => {
  it("never renumbers, so an older client still agrees on 0 and 1", () => {
    expect(GameMode.FFA_LAST_STANDING).toBe(0);
    expect(GameMode.TEAM).toBe(1);
    expect(GameMode.FFA_DEATHMATCH).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/shared/src/flow/modes.test.ts`
Expected: FAIL — cannot resolve `./modes.js`, and `FFA_LAST_STANDING` does not exist on `GameMode`.

- [ ] **Step 3: Add the enum value**

In `packages/shared/src/constants.ts`, replace the `GameMode` enum:

```ts
/**
 * What kind of match this is. Two axes flattened into one list, because Deathmatch is FFA-only:
 * `sidesOf` answers "who is on whose side" and `winRuleOf` answers "what ends the match" (M1).
 *
 * `FFA_LAST_STANDING` was called `FFA` before 2026-09-01. That was a source rename and the wire
 * value is unchanged — renumbering would silently repoint every client that had not been rebuilt.
 */
export enum GameMode {
  FFA_LAST_STANDING = 0,
  TEAM = 1,
  FFA_DEATHMATCH = 2,
}
```

- [ ] **Step 4: Write the derivations**

Create `packages/shared/src/flow/modes.ts`:

```ts
import { GameMode } from "../constants.js";

/**
 * Which side structure this mode uses.
 *
 * This is the axis every pre-existing rule already reads — friendly fire (`canDamage`), spawn
 * assignment (`assignSpawns`) and the living-side count (`livingSides`) all take `"ffa" | "team"`
 * and none of them changed when Deathmatch was added. That is the point of deriving it: Deathmatch
 * IS free-for-all, it just ends differently.
 *
 * Replaces the server-local `toFlowMode`, which answered the same question one package too far out.
 */
export function sidesOf(mode: GameMode): "ffa" | "team" {
  return mode === GameMode.TEAM ? "team" : "ffa";
}

/**
 * What ends the match.
 *
 * The new axis, and deliberately consumed in exactly ONE place — the room's end-of-match check — so
 * that a grep for this function answers "what does the win condition actually change?" completely.
 */
export function winRuleOf(mode: GameMode): "last_standing" | "deathmatch" {
  return mode === GameMode.FFA_DEATHMATCH ? "deathmatch" : "last_standing";
}
```

- [ ] **Step 5: Export from the package surface**

In `packages/shared/src/index.ts`, beside the existing `export { assignSpawns } from "./flow/spawns.js";` line, add:

```ts
export { sidesOf, winRuleOf } from "./flow/modes.js";
```

- [ ] **Step 6: Rename every `GameMode.FFA` reference**

Mechanical: `GameMode.FFA` → `GameMode.FFA_LAST_STANDING` in exactly these files.

Source: `packages/shared/src/lobby/start-rules.ts:15`, `packages/shared/src/schema/ArenaState.ts:11`, `packages/client/src/scenes/LobbyScene.ts:29,40`, `packages/client/src/ui/screens/lobby.ts:25`, `packages/server/src/rooms/ArenaRoom.ts:534`.

Tests: `packages/client/src/ui/lobby-view.test.ts:131,149,162`, `packages/client/src/ui/results-view.test.ts:44`, `packages/client/src/ui/reveal-view.test.ts:55`, `packages/server/src/rooms/flow-map.test.ts:13`, `packages/shared/src/flow/spawns.test.ts:24,41,42,54,69`, `packages/shared/src/lobby/start-rules.test.ts:9,12,20,23,27`.

Do **not** yet make Deathmatch startable or selectable — that is Steps 7 and Task 12.

- [ ] **Step 7: Let Deathmatch start, and accept it on the wire**

In `packages/shared/src/lobby/start-rules.ts`, replace the FFA branch condition so both FFA modes share it:

```ts
  if (mode !== GameMode.TEAM) {
    if (ready.length < 2) {
      return { ok: false, error: "Need at least 2 ready players" };
    }
    return { ok: true };
  }
```

In `packages/server/src/rooms/ArenaRoom.ts:534`, widen the payload guard:

```ts
  return (
    mode === GameMode.FFA_LAST_STANDING ||
    mode === GameMode.TEAM ||
    mode === GameMode.FFA_DEATHMATCH
  );
```

- [ ] **Step 8: Retire `toFlowMode`**

Delete `toFlowMode` from `packages/server/src/rooms/flow-map.ts` and drop it from that file's imports and from `packages/server/src/rooms/flow-map.test.ts` (delete the two `toFlowMode` assertions at lines 13–14 and the import at line 6; keep the rest of the describe block, renaming it to `"fromFlowPhase / toFlowPhase"`).

In `packages/server/src/rooms/ArenaRoom.ts`, remove `toFlowMode` from the `./flow-map.js` import, add `sidesOf` to the `@motor-combat-moba/shared` import, and replace all six call sites (lines 273, 336, 363, 378, 409) — `toFlowMode(this.state.mode)` becomes `sidesOf(this.state.mode)`.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS. `modes.test.ts` is green and nothing else regressed.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/flow/modes.ts packages/shared/src/flow/modes.test.ts packages/shared/src/index.ts packages/shared/src/lobby/start-rules.ts packages/shared/src/schema/ArenaState.ts packages/shared/src/flow/spawns.test.ts packages/shared/src/lobby/start-rules.test.ts packages/server/src/rooms/flow-map.ts packages/server/src/rooms/flow-map.test.ts packages/server/src/rooms/ArenaRoom.ts packages/client/src/scenes/LobbyScene.ts packages/client/src/ui/screens/lobby.ts packages/client/src/ui/lobby-view.test.ts packages/client/src/ui/results-view.test.ts packages/client/src/ui/reveal-view.test.ts
git commit -m "feat(shared): add FFA_DEATHMATCH and split mode into sidesOf/winRuleOf (M1-M3)"
```

---

## Task 2: `DEATHMATCH_CONFIG`

**Files:**
- Create: `packages/shared/src/config/deathmatch-config.ts`
- Test: `packages/shared/src/config/deathmatch-config.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `TICK_RATE_HZ` from `../constants.js`.
- Produces: `DEATHMATCH_CONFIG` (`{ matchSeconds: 300; respawnDelaySeconds: 5; phaseSeconds: 1.5; phaseMaxSeconds: 3 }`) and `DEATHMATCH_TICKS` (`{ match: number; respawnDelay: number; phase: number; phaseMax: number }`), both frozen and exported from the package root.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/config/deathmatch-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { STATUS_CONFIG } from "./status-config.js";
import { DEATHMATCH_CONFIG, DEATHMATCH_TICKS } from "./deathmatch-config.js";

describe("DEATHMATCH_TICKS", () => {
  it("derives whole ticks from the authored seconds", () => {
    expect(DEATHMATCH_TICKS.match).toBe(300 * TICK_RATE_HZ);
    expect(DEATHMATCH_TICKS.respawnDelay).toBe(5 * TICK_RATE_HZ);
    expect(DEATHMATCH_TICKS.phase).toBe(45);
    expect(DEATHMATCH_TICKS.phaseMax).toBe(3 * TICK_RATE_HZ);
  });

  it("is frozen, so no caller can retune the match at runtime", () => {
    expect(Object.isFrozen(DEATHMATCH_TICKS)).toBe(true);
    expect(Object.isFrozen(DEATHMATCH_CONFIG)).toBe(true);
  });
});

describe("DEATHMATCH_CONFIG bounds", () => {
  it("gives the phase a cap strictly above its minimum, or extension is meaningless", () => {
    expect(DEATHMATCH_CONFIG.phaseMaxSeconds).toBeGreaterThan(DEATHMATCH_CONFIG.phaseSeconds);
  });

  it("keeps the phase inside the status system's own duration ceiling", () => {
    expect(DEATHMATCH_CONFIG.phaseMaxSeconds * 1000).toBeLessThanOrEqual(STATUS_CONFIG.maxDurationMs);
  });

  it("respawns players well inside the match, or the mode is last-standing wearing a clock", () => {
    expect(DEATHMATCH_CONFIG.respawnDelaySeconds).toBeLessThan(DEATHMATCH_CONFIG.matchSeconds / 10);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/shared/src/config/deathmatch-config.test.ts`
Expected: FAIL — cannot resolve `./deathmatch-config.js`.

- [ ] **Step 3: Write the config**

Create `packages/shared/src/config/deathmatch-config.ts`:

```ts
import { TICK_RATE_HZ } from "../constants.js";

/**
 * Deathmatch tuning (M28). Every number here is read by the room and by the client's HUD, so this is
 * networked balance rather than render preference — the same standing as `STATUS_CONFIG`.
 *
 * All four are first-pass values meant to be re-tuned from play, not defended.
 *
 * They sequence deliberately: 3 s of "[name] killed you", then 2 s of respawn countdown, then a
 * return to the field with 1.5 s of protection.
 */
export const DEATHMATCH_CONFIG = Object.freeze({
  /** Match length. Five minutes is long enough for the lead to change hands more than once. */
  matchSeconds: 300,
  /**
   * How long a wreck waits. Long enough to sting, short enough that a death is a setback rather than
   * the spectate sentence Last Standing hands out.
   */
  respawnDelaySeconds: 5,
  /**
   * The MINIMUM spawn-protection window. Not a fixed duration: the phase also has to wait until the
   * car is clear of everyone, so this is a floor and `phaseMaxSeconds` is the ceiling (M23).
   */
  phaseSeconds: 1.5,
  /**
   * The hard cap on protection, past which the car becomes solid whatever it is overlapping.
   *
   * Belt-and-braces rather than load-bearing: parking on a phased car to hold it intangible is weak
   * griefing, because the attacker cannot damage it and is only delaying their own shot.
   */
  phaseMaxSeconds: 3,
} as const);

/**
 * The same durations in whole ticks, derived once and frozen — the pattern `WEAPON_TICKS` and
 * `STATUS_PULSE_TICKS` already set. Deriving per use would round the same number in two places.
 */
export const DEATHMATCH_TICKS = Object.freeze({
  match: Math.round(DEATHMATCH_CONFIG.matchSeconds * TICK_RATE_HZ),
  respawnDelay: Math.round(DEATHMATCH_CONFIG.respawnDelaySeconds * TICK_RATE_HZ),
  phase: Math.round(DEATHMATCH_CONFIG.phaseSeconds * TICK_RATE_HZ),
  phaseMax: Math.round(DEATHMATCH_CONFIG.phaseMaxSeconds * TICK_RATE_HZ),
});
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, beside the other config exports:

```ts
export { DEATHMATCH_CONFIG, DEATHMATCH_TICKS } from "./config/deathmatch-config.js";
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config/deathmatch-config.ts packages/shared/src/config/deathmatch-config.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add DEATHMATCH_CONFIG and its derived tick counts (M28)"
```

---

## Task 3: The `phased` status

**Files:**
- Modify: `packages/shared/src/config/status-types.ts` (`StatusId`, `StatusFlag`, `StatusDef`, `StatusOnApply`)
- Modify: `packages/shared/src/config/status-config.ts` (`STATUS_TABLE`)
- Modify: `packages/shared/src/sim/status/modifiers.ts` (`Modifiers`, `NEUTRAL_MODIFIERS`, `modifiersOf`)
- Test: `packages/shared/src/config/status-config.test.ts:65-69`, `packages/shared/src/sim/status/modifiers.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `StatusId` includes `"phased"`; `StatusFlag` includes `"phased"`; `Modifiers.phased: boolean`; `StatusDef.chainable?: boolean`; `StatusOnApply.cleanse?: "debuff"`.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/config/status-config.test.ts`, **replace** the existing test at lines 65–69 with these three:

```ts
  it("makes every flag-carrying DEBUFF `ignore`, so hard CC can never be chained", () => {
    for (const id of IDS) {
      const def = statusDefOf(id);
      if ((def.flags?.length ?? 0) === 0) continue;
      if (def.kind !== "debuff") continue;
      expect(def.reapply).toBe("ignore");
    }
  });

  it("only lets a row escape that rule by declaring itself chainable", () => {
    for (const id of IDS) {
      const def = statusDefOf(id);
      if ((def.flags?.length ?? 0) === 0) continue;
      if (def.reapply === "ignore") continue;
      expect(def.chainable).toBe(true);
    }
  });

  it("never lets a buff be chainable AND a debuff, which would reopen the CC hole", () => {
    for (const id of IDS) {
      if (statusDefOf(id).chainable) expect(statusDefOf(id).kind).toBe("buff");
    }
  });
```

Append to the same file:

```ts
describe("phased", () => {
  it("is a buff that flips one flag and scales nothing", () => {
    const def = statusDefOf("phased");
    expect(def.kind).toBe("buff");
    expect(def.flags).toEqual(["phased"]);
    expect(Object.keys(def.modifiers)).toEqual([]);
  });

  it("refreshes, because contact-clear extension has to lengthen it", () => {
    expect(statusDefOf("phased").reapply).toBe("refresh");
    expect(statusDefOf("phased").chainable).toBe(true);
  });

  it("cannot be cleansed, because nothing in the game cleanses a buff", () => {
    for (const id of IDS) {
      expect(statusDefOf(id).onApply?.cleanse).not.toBe("buff");
    }
  });
});
```

In `packages/shared/src/sim/status/modifiers.test.ts`, append:

```ts
describe("phased", () => {
  it("is false for a car in no status", () => {
    expect(NEUTRAL_MODIFIERS.phased).toBe(false);
    expect(modifiersOf([], 0).phased).toBe(false);
  });

  it("is true while the status runs and false on the tick it lapses", () => {
    const rows = [
      { statusId: "phased" as const, startTick: 0, endsTick: 10, sourceSessionId: "" },
    ];
    expect(modifiersOf(rows, 9).phased).toBe(true);
    expect(modifiersOf(rows, 10).phased).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/shared/src/config/status-config.test.ts packages/shared/src/sim/status/modifiers.test.ts`
Expected: FAIL — `"phased"` is not assignable to `StatusId`, `chainable` does not exist on `StatusDef`, `phased` does not exist on `Modifiers`.

- [ ] **Step 3: Extend the types**

In `packages/shared/src/config/status-types.ts`:

Add `"phased"` to the `StatusId` union.

Add to the `StatusFlag` union, with its doc comment:

```ts
  /**
   * Not present in the world at all: no collision, no ram, no weapon target, no aim-assist lock.
   *
   * The one flag that is a BUFF. Intangibility and invulnerability are deliberately the same rule
   * rather than two (M13) — a car that is not there cannot be hit, so invulnerability falls out
   * instead of needing a second mechanism. `damageTaken: 0` was rejected: it clamps to 0.4, and even
   * at zero a shot still connects, consuming pierce and landing its on-hit statuses.
   */
  | "phased"
```

Add to `StatusDef`, after `reapply`:

```ts
  /**
   * May this row be `refresh` even though it carries a flag? Absent is false.
   *
   * The flag-carrying rows are otherwise forced to `ignore` so hard CC can never be chained. That
   * rule protects against an OPPONENT holding you in a boolean state indefinitely, which is why the
   * escape hatch is restricted to buffs: `phased` is granted by the room to a car about itself, and
   * no opponent can apply it at all.
   *
   * Deliberately NOT called `canStack`. Stacking means compounding magnitude, which nothing in this
   * system does — a refresh extends a clock and changes no number.
   */
  chainable?: boolean;
```

In `StatusOnApply`, narrow the field:

```ts
  /**
   * Strip every running DEBUFF from the car.
   *
   * Narrowed from `StatusKind` on 2026-09-01: a buff-cleanse would strip spawn protection, so the
   * type makes one impossible rather than leaving a test to police it (M20). A future "strip enemy
   * buffs" weapon needs a deliberate widening here, which is the point.
   *
   * Cleansing a damage-over-time status stops the bleeding; it does **not** give back hp already
   * lost. That is the whole difference between a repair and a heal.
   *
   * A status never cleanses itself: the strip runs before it is added.
   */
  cleanse?: "debuff";
```

- [ ] **Step 4: Add the table row**

In `packages/shared/src/config/status-config.ts`, add to `STATUS_TABLE` after `overhauled`:

```ts
  /**
   * Spawn protection: the car is not in the world (M13, M18).
   *
   * Not a new mechanic — the game already had this. `isOnField` reads `alive`, so a wreck is already
   * dropped from every collision list, every ram pair and every target list; this is that same
   * condition held a moment past the respawn.
   *
   * It scales nothing. Its whole effect is the flag, and its duration is the applier's as always —
   * the room's, from `DEATHMATCH_TICKS`. `refresh` because the phase must be extendable while the
   * car is still overlapping someone, which is what `chainable` exists to permit.
   */
  phased: {
    id: "phased",
    name: "Phasing",
    kind: "buff",
    color: "#4dabf7",
    reapply: "refresh",
    chainable: true,
    modifiers: {},
    flags: ["phased"],
  },
```

- [ ] **Step 5: Add the modifier channel**

In `packages/shared/src/sim/status/modifiers.ts`: add `phased: boolean;` to the `Modifiers` interface with the doc comment `/** Not present in the world: no collision, no ram, no weapon target. See StatusFlag. */`, add `phased: false,` to `NEUTRAL_MODIFIERS`, and add this line beside the other three flag projections at the end of `modifiersOf`:

```ts
  mods.phased = flags.has("phased");
```

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: PASS. If `manual-page.test.mjs` fails complaining about the balance stamp, that is expected and is fixed in Task 16 — note it and continue.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/config/status-types.ts packages/shared/src/config/status-config.ts packages/shared/src/config/status-config.test.ts packages/shared/src/sim/status/modifiers.ts packages/shared/src/sim/status/modifiers.test.ts
git commit -m "feat(shared): add the phased status, chainable, and a debuff-only cleanse (M18-M20)"
```

---

## Task 4: `isSolid` and the collision-membership filter

**Files:**
- Modify: `packages/shared/src/sim/status/statuses.ts` (add `isPhasedAt`)
- Modify: `packages/shared/src/sim/context.ts` (`ContextPlayer`, `isSolid`, `otherCarHulls`)
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/sim/context.test.ts`
- Modify: `packages/server/src/sim/tick.ts:148`, `packages/server/src/sim/ram-bridge.ts:57`, `packages/client/src/net/step-context.ts:59`, `packages/server/playtest/prediction.ts:162`

**Interfaces:**
- Consumes: `Modifiers.phased` and `StatusId "phased"` from Task 3.
- Produces: `isPhasedAt(rows: Iterable<StatusRow>, tick: number): boolean`; `isSolid(player: Pick<ContextPlayer, "status" | "alive" | "statuses">, tick: number): boolean`; `otherCarHulls(entries: readonly ContextEntry[], selfSessionId: string, tick: number): Obb[]`; `ContextPlayer.statuses: Iterable<StatusRow>`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/sim/context.test.ts`:

```ts
describe("isSolid", () => {
  const base = { status: PlayerStatus.IN_MATCH, alive: true, statuses: [] };
  const phasedRow = { statusId: "phased", startTick: 0, endsTick: 10, sourceSessionId: "" };

  it("agrees with isOnField for a car in no status", () => {
    expect(isSolid(base, 0)).toBe(true);
    expect(isSolid({ ...base, alive: false }, 0)).toBe(false);
    expect(isSolid({ ...base, status: PlayerStatus.READY }, 0)).toBe(false);
  });

  it("is false while phasing and true again once it lapses", () => {
    expect(isSolid({ ...base, statuses: [phasedRow] }, 5)).toBe(false);
    expect(isSolid({ ...base, statuses: [phasedRow] }, 10)).toBe(true);
  });

  it("ignores a status that is not phased", () => {
    const slowed = { statusId: "overheated", startTick: 0, endsTick: 10, sourceSessionId: "" };
    expect(isSolid({ ...base, statuses: [slowed] }, 5)).toBe(true);
  });
});

describe("otherCarHulls with a phasing car", () => {
  const player = (over: Partial<ContextPlayer> = {}): ContextPlayer => ({
    x: 0, y: 0, angle: 0, status: PlayerStatus.IN_MATCH, carId: "mirage", alive: true,
    statuses: [], ...over,
  });

  it("drops a phasing car from EVERY other car's list, not just its own", () => {
    const entries = [
      { sessionId: "a", player: player({ x: 100 }) },
      {
        sessionId: "b",
        player: player({
          x: 200,
          statuses: [{ statusId: "phased", startTick: 0, endsTick: 10, sourceSessionId: "" }],
        }),
      },
    ];
    // The solid car cannot see the ghost...
    expect(otherCarHulls(entries, "a", 5)).toHaveLength(0);
    // ...and the ghost still cannot see the solid car it is passing through, so neither shoves.
    expect(otherCarHulls(entries, "b", 5)).toHaveLength(1);
  });

  it("phases through CARS only — a wall is not a car (M17)", () => {
    // The whole guarantee, pinned as a fact about this function's inputs: `otherCarHulls` is handed
    // nothing but car entries, so there is no code path by which phasing could drop an obstacle.
    // Obstacles and bounds reach `resolveWorld` straight off the arena, and a phasing car therefore
    // still collides with both — which is what stops it driving out of the map.
    const ghost = player({
      statuses: [{ statusId: "phased", startTick: 0, endsTick: 10, sourceSessionId: "" }],
    });
    const solid = player({ x: 100 });
    const entries = [
      { sessionId: "ghost", player: ghost },
      { sessionId: "solid", player: solid },
    ];
    // Every hull that survives the filter is a car hull at a car's pose, never an arena box.
    const hulls = otherCarHulls(entries, "ghost", 5);
    expect(hulls).toEqual([carHullOf(solid.x, solid.y, solid.angle)]);
  });
});
```

Add `isSolid` to that file's imports from `./context.js`, and `ContextPlayer` to its type imports.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/shared/src/sim/context.test.ts`
Expected: FAIL — `isSolid` is not exported, and `statuses` is not a property of `ContextPlayer`.

- [ ] **Step 3: Add the phased read**

In `packages/shared/src/sim/status/statuses.ts`, after `modifiersFromRows`:

```ts
/**
 * Is this car phasing, from wire rows alone?
 *
 * Deliberately routed through `modifiersFromRows` rather than scanning for the id directly. One
 * derivation, not two: a hand-rolled scan would have to reproduce `toActiveStatuses`' validation and
 * `modifiersOf`'s exclusive end-of-clock rule exactly, and the two would drift the first time either
 * changed. Most cars carry no rows at all, where this early-outs to the shared frozen neutral.
 */
export function isPhasedAt(rows: Iterable<StatusRow>, tick: number): boolean {
  return modifiersFromRows(rows, tick).phased;
}
```

- [ ] **Step 4: Split the predicate**

In `packages/shared/src/sim/context.ts`, add the import `import { isPhasedAt, type StatusRow } from "./status/statuses.js";`, add the field to `ContextPlayer`:

```ts
  /**
   * This car's status rows, straight off the wire. Read only to answer "is it phasing" — everything
   * else the sim derives from statuses goes through `Modifiers`.
   */
  statuses: Iterable<StatusRow>;
```

Then add `isSolid` below `isOnField`, and update `isOnField`'s doc to point at it:

```ts
/**
 * Does this car participate in contacts — collisions and rams?
 *
 * `isOnField` and this used to be one predicate, and the comment above still explains why they
 * mostly agree. They separate for exactly one case: a car that is **driveable but not solid**.
 *
 * That is spawn protection (M14). A respawning car must steer normally while passing through
 * everyone, so the MOVER gate keeps `isOnField` and the WALL gate takes this. Nothing else may use
 * this to move a car, and nothing else may use `isOnField` to decide solidity.
 */
export function isSolid(
  player: Pick<ContextPlayer, "status" | "alive" | "statuses">,
  tick: number,
): boolean {
  return isOnField(player) && !isPhasedAt(player.statuses, tick);
}
```

Replace `otherCarHulls` with:

```ts
export function otherCarHulls(
  entries: readonly ContextEntry[],
  selfSessionId: string,
  tick: number,
): Obb[] {
  const hulls: Obb[] = [];
  for (const { sessionId, player } of entries) {
    if (sessionId === selfSessionId) continue;
    // Filtered on the ENTRY, never on the caller. That is what makes intangibility symmetric: were
    // a car to drop hulls according to its OWN phased state, A would pass through B while B still
    // collided with A, and one car would spend the spawn shoving a ghost.
    if (!isSolid(player, tick)) continue;
    hulls.push(carHullOf(player.x, player.y, player.angle));
  }
  return hulls;
}
```

Add `isSolid` to the existing context export line in `packages/shared/src/index.ts`:

```ts
export { carHullOf, carIdOf, isOnField, isSolid, otherCarHulls } from "./sim/context.js";
```

and add `isPhasedAt` to the alphabetical list in the `./sim/status/statuses.js` export block.

- [ ] **Step 5: Update every caller**

Four call sites, all mechanical:

- `packages/server/src/sim/tick.ts:148` — `others: otherCarHulls(entries, sessionId, state.tick),`
- `packages/client/src/net/step-context.ts:59` — `others: otherCarHulls(entries, selfSessionId, tick),`, and add a `tick: number` parameter to `buildStepContext` after `selfSessionId`. Update its callers in `packages/client/src/net/prediction.ts` and `packages/client/src/scenes/ArenaScene.ts` to pass `room.state.tick`.
- `packages/server/src/sim/ram-bridge.ts:57` — replace the two lines `if (!isOnField(player)) return;` and `if (!player.alive) return;` with `if (!isSolid(player, state.tick)) return;`, and swap `isOnField` for `isSolid` in the import. Update `ramCarsOf` to take `state` (it already does) — no signature change needed.
- `packages/server/playtest/prediction.ts:162` — `others: otherCarHulls(entries, "me", 0),`. This is the compile break M31 names; a probe that does not build measures nothing.

In `ram-bridge.ts`, update `ramCarsOf`'s doc comment: a wreck is no longer merely "scenery that still collides" — it is not solid either, and now neither is a phasing car.

- [ ] **Step 6: Run the suite and the build**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: success — this is what proves the playtest probes still compile.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sim/status/statuses.ts packages/shared/src/sim/context.ts packages/shared/src/sim/context.test.ts packages/shared/src/index.ts packages/server/src/sim/tick.ts packages/server/src/sim/ram-bridge.ts packages/client/src/net/step-context.ts packages/client/src/net/prediction.ts packages/client/src/scenes/ArenaScene.ts packages/server/playtest/prediction.ts
git commit -m "feat(shared): split isOnField into a mover gate and a solidity gate (M14-M16)"
```

---

## Task 5: Kill attribution in the sim

**Files:**
- Modify: `packages/shared/src/sim/combat.ts` (`CombatPlayer`, `damage`, its two call sites)
- Test: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `CombatPlayer.lastDamagerSessionId: string`, set by `damage(player, amount, sourceSessionId)`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/sim/combat.test.ts`. Self-contained — it builds its own players and instances rather than depending on that file's factories:

```ts
describe("kill attribution", () => {
  const HP = hpOf("mirage");

  const combatant = (sessionId: string, over: Partial<CombatPlayer> = {}): CombatPlayer => ({
    sessionId,
    x: 400, y: 150, angle: 0,
    team: 0,
    carId: "mirage",
    hp: HP,
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState: newFireState("mirage", 1),
    lock: newLockState(),
    statuses: [],
    lastDamagerSessionId: "",
    ...over,
  });

  const worldAt = (tick: number): CombatWorld => ({
    tick,
    dt: 1 / TICK_RATE_HZ,
    mode: "ffa",
    obstacles: [],
    bounds: { width: 1600, height: 900 },
  });

  // Mirrors `combat-bridge.test.ts`'s `liveInstance`, parked on top of the victim so it connects.
  const shotAt = (owner: string, x: number, y: number): WeaponInstance => ({
    id: `${owner}-1`,
    ownerSessionId: owner,
    ownerTeam: 0,
    finalWave: true,
    damage: weaponDamageOf("mirage", "fireball"),
    weaponId: "fireball",
    kind: "projectile",
    x, y,
    angle: 0,
    extent: 0,
    spawnTick: 0,
    distance: 0,
    pierceLeft: 0,
    attached: false,
    damageClock: new Map<string, number>(),
    alive: true,
  });

  it("records the owner of the shot that landed", () => {
    const victim = combatant("b");
    const out = runCombat({
      world: worldAt(1),
      players: [combatant("a"), victim],
      instances: [shotAt("a", victim.x, victim.y)],
      instanceSeq: 1,
    });
    const b = out.players.find((p) => p.sessionId === "b")!;
    expect(b.hp).toBeLessThan(HP);
    expect(b.lastDamagerSessionId).toBe("a");
  });

  it("overwrites, so the LAST damager wins and no ledger is needed", () => {
    const victim = combatant("c", { lastDamagerSessionId: "a" });
    const out = runCombat({
      world: worldAt(1),
      players: [combatant("b"), victim],
      instances: [shotAt("b", victim.x, victim.y)],
      instanceSeq: 1,
    });
    expect(out.players.find((p) => p.sessionId === "c")!.lastDamagerSessionId).toBe("b");
  });

  it("credits a bleed to whoever applied the status, not to the world", () => {
    // Stepped until the pulse fires, so the test does not depend on `spiked`'s authored interval.
    let victim = combatant("victim", {
      statuses: [{ statusId: "spiked", startTick: 0, endsTick: 300, sourceSessionId: "a" }],
    });
    for (let tick = 1; tick <= 300 && victim.hp === HP; tick++) {
      victim = runCombat({
        world: worldAt(tick),
        players: [victim],
        instances: [],
        instanceSeq: 0,
      }).players[0]!;
    }
    expect(victim.hp).toBeLessThan(HP);
    expect(victim.lastDamagerSessionId).toBe("a");
  });

  it("stays empty for a car nothing has damaged", () => {
    const out = runCombat({
      world: worldAt(1),
      players: [combatant("a"), combatant("b")],
      instances: [],
      instanceSeq: 0,
    });
    expect(out.players.every((p) => p.lastDamagerSessionId === "")).toBe(true);
  });
});
```

Import `hpOf`, `newFireState`, `newLockState`, `weaponDamageOf`, `TICK_RATE_HZ` and the types `CombatPlayer`, `CombatWorld`, `WeaponInstance` at the top of the file if they are not already there.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/shared/src/sim/combat.test.ts`
Expected: FAIL — `lastDamagerSessionId` does not exist on `CombatPlayer`.

- [ ] **Step 3: Add the field**

In `packages/shared/src/sim/combat.ts`, add to `CombatPlayer` after `statuses`:

```ts
  /**
   * Who last took hp off this car, or `""` if nothing has.
   *
   * The whole of kill attribution (M5–M7). There is no damage ledger and no contribution window,
   * because there are no assists: the last point of damage decides the kill outright.
   *
   * Carried in and back out like `fireState` and `lock`, and server-only for the same reason — the
   * client does not predict damage, so putting it on the wire would patch a string to everyone at
   * the tick rate for nothing. `stepSim` never reads it, so invariant 8 does not apply.
   *
   * This is well-defined for every death in the game: ramming deals no damage, and status pulses
   * already carry `sourceSessionId`. There is no world kill to attribute to nobody.
   */
  lastDamagerSessionId: string;
```

- [ ] **Step 4: Thread it through `damage`**

Replace the `damage` function at the bottom of `combat.ts`:

```ts
/**
 * The only writer of `hp` and `alive`. 0 hp is the wreck: the car stays on the field, inert.
 *
 * `sourceSessionId` is stamped only when the hit actually costs hp. A pure applicator weapon
 * legitimately deals 0 and still registers as a hit, and letting that claim the kill would credit a
 * player who never scratched the target.
 */
function damage(player: CombatPlayer, amount: number, sourceSessionId: string): void {
  if (amount > 0 && sourceSessionId !== "") player.lastDamagerSessionId = sourceSessionId;
  player.hp = applyDamage(player.hp, amount);
  if (player.hp === 0) player.alive = false;
}
```

Update the two call sites:

- The pulse loop (search for `if (pulse.damage > 0) damage(player, pulse.damage);`):

```ts
      if (pulse.damage > 0) damage(player, pulse.damage, pulse.sourceSessionId);
```

- The hit loop (search for `damage(target, scaleDamage(hit.amount, modsOf(hit.sessionId).damageTaken));`):

```ts
      damage(
        target,
        scaleDamage(hit.amount, modsOf(hit.sessionId).damageTaken),
        instance.ownerSessionId,
      );
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS. Existing combat tests that construct a `CombatPlayer` literal will need `lastDamagerSessionId: ""` added to their factory — do that in the factory, not per test.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/combat.ts packages/shared/src/sim/combat.test.ts
git commit -m "feat(shared): attribute every point of damage to its source (M5-M8)"
```

---

## Task 6: Score fields and kill booking

**Files:**
- Modify: `packages/shared/src/schema/PlayerState.ts`, `packages/shared/src/schema/ArenaState.ts`
- Modify: `packages/server/src/sim/combat-bridge.ts` (`CombatMemory`, `toCombatPlayers`, `applyCombatResult`)
- Test: `packages/shared/src/schema/schema.test.ts`, `packages/server/src/sim/combat-bridge.test.ts`

**Interfaces:**
- Consumes: `CombatPlayer.lastDamagerSessionId` from Task 5.
- Produces: `PlayerState.kills: number`, `PlayerState.deaths: number`, `PlayerState.killedBySessionId: string`, `ArenaState.matchEndsTick: number`; `CombatMemory.lastDamagers: Map<string, string>`.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/sim/combat-bridge.test.ts`, reusing that file's existing `playerIn` helper:

```ts
describe("kill booking", () => {
  /** One entry of a `CombatResult`, matching the schema player `playerIn` created. */
  const combatant = (sessionId: string, over: Partial<CombatPlayer> = {}): CombatPlayer => ({
    sessionId,
    x: 400, y: 150, angle: 0,
    team: 0,
    carId: "mirage",
    hp: hpOf("mirage"),
    alive: true,
    inRoster: true,
    fireMask: 0,
    fireState: newFireState("mirage", 1),
    lock: newLockState(),
    statuses: [],
    lastDamagerSessionId: "",
    ...over,
  });

  it("credits the killer and charges the victim on the death transition only", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    playerIn(state, "b");
    const memory = newCombatMemory();
    const wreck: CombatResult = {
      players: [
        combatant("a"),
        combatant("b", { hp: 0, alive: false, lastDamagerSessionId: "a" }),
      ],
      instances: [],
      instanceSeq: 0,
    };

    applyCombatResult(state, wreck, memory);
    expect(state.players.get("a")!.kills).toBe(1);
    expect(state.players.get("b")!.deaths).toBe(1);
    expect(state.players.get("b")!.killedBySessionId).toBe("a");

    // Still dead on the next tick. The score must not tick up for every tick spent as a wreck.
    applyCombatResult(state, wreck, memory);
    expect(state.players.get("a")!.kills).toBe(1);
    expect(state.players.get("b")!.deaths).toBe(1);
  });

  it("still records the killer's id when the killer has left the room", () => {
    const state = new ArenaState();
    playerIn(state, "b");
    applyCombatResult(
      state,
      {
        players: [combatant("b", { hp: 0, alive: false, lastDamagerSessionId: "gone" })],
        instances: [],
        instanceSeq: 0,
      },
      newCombatMemory(),
    );
    expect(state.players.get("b")!.deaths).toBe(1);
    expect(state.players.get("b")!.killedBySessionId).toBe("gone");
  });

  it("never credits a car for killing itself", () => {
    const state = new ArenaState();
    playerIn(state, "a");
    applyCombatResult(
      state,
      {
        players: [combatant("a", { hp: 0, alive: false, lastDamagerSessionId: "a" })],
        instances: [],
        instanceSeq: 0,
      },
      newCombatMemory(),
    );
    expect(state.players.get("a")!.kills).toBe(0);
    expect(state.players.get("a")!.deaths).toBe(1);
  });
});
```

Add `type CombatPlayer` to that file's shared type imports.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/server/src/sim/combat-bridge.test.ts`
Expected: FAIL — `kills` does not exist on `PlayerState`.

- [ ] **Step 3: Add the schema fields**

In `packages/shared/src/schema/PlayerState.ts`, after `diedAtTick`:

```ts
  /**
   * Kills and deaths this match. Counted in every mode; only Deathmatch decides a winner from them
   * (M11), and the results scoreboard has been drawing placeholder zeroes for both since it shipped.
   *
   * `uint8` is ample: six players over a five-minute match cannot approach 255.
   */
  @type("uint8") kills = 0;
  @type("uint8") deaths = 0;
  /**
   * Who landed the killing blow, or `""` while alive. Render-only — `stepSim` never reads it — and
   * networked for the same reason `diedAtTick` is: a spectator or a late joiner who never observed
   * the death still has to be able to name the killer.
   *
   * Survives until the respawn clears it, which is also what dismisses the "killed you" banner.
   */
  @type("string") killedBySessionId = "";
```

In `packages/shared/src/schema/ArenaState.ts`, after `matchStartedAtTick`:

```ts
  /**
   * The tick a Deathmatch ends on, or 0 in every other mode. Stamped on the same edge into MATCH
   * that `matchStartedAtTick` is, and for the same reason: one number patched to everyone beats a
   * local stopwatch per machine, which would start whenever each client loaded the arena.
   */
  @type("uint32") matchEndsTick = 0;
```

- [ ] **Step 4: Carry the last damager through the bridge**

In `packages/server/src/sim/combat-bridge.ts`:

Add to `CombatMemory`, and to `newCombatMemory()`'s literal as `lastDamagers: new Map()`:

```ts
  /** Who last damaged each player. Server-only; the schema carries only the frozen `killedBy`. */
  lastDamagers: Map<string, string>;
```

In `toCombatPlayers`, add to the pushed object beside `statuses`:

```ts
      lastDamagerSessionId: memory.lastDamagers.get(sessionId) ?? "",
```

In `applyCombatResult`, inside the `for (const p of result.players)` loop, add before the existing `if (!player) continue;`:

```ts
    memory.lastDamagers.set(p.sessionId, p.lastDamagerSessionId);
```

and replace the `diedAtTick` line with the death-transition block:

```ts
    // Stamp the death tick on the TRANSITION only, so a car that is already dead keeps the tick it
    // died on rather than having it rewritten every tick it stays dead. The client fades from here.
    //
    // This is also the one place a kill is booked (M9). It is the only line in the codebase that
    // detects the moment of death, so scoring anywhere else would need a second one.
    if (player.alive && !p.alive) {
      player.diedAtTick = state.tick;
      player.deaths += 1;
      player.killedBySessionId = p.lastDamagerSessionId;
      // A killer who has since left the room gets no increment — but the victim still records who
      // it was, so the banner names them correctly.
      const killer = state.players.get(p.lastDamagerSessionId);
      if (killer && killer !== player) killer.kills += 1;
    }
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schema/PlayerState.ts packages/shared/src/schema/ArenaState.ts packages/server/src/sim/combat-bridge.ts packages/server/src/sim/combat-bridge.test.ts packages/shared/src/schema/schema.test.ts
git commit -m "feat(server): book kills at the death transition (M9, M10, M24)"
```

---

## Task 7: `farthestSpawn`

**Files:**
- Create: `packages/shared/src/flow/respawn.ts`
- Test: `packages/shared/src/flow/respawn.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `Spawn` from `../arena/types.js`.
- Produces: `farthestSpawn(spawns: readonly Spawn[], enemies: readonly { x: number; y: number }[]): Spawn`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/flow/respawn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Spawn } from "../arena/types.js";
import { farthestSpawn } from "./respawn.js";

const spawns: Spawn[] = [
  { x: 0, y: 0, angle: 0 },
  { x: 100, y: 0, angle: 0 },
  { x: 1000, y: 0, angle: 0 },
];

describe("farthestSpawn", () => {
  it("picks the spawn furthest from the nearest living enemy", () => {
    expect(farthestSpawn(spawns, [{ x: 0, y: 0 }])).toEqual({ x: 1000, y: 0, angle: 0 });
  });

  it("maximises the NEAREST enemy distance, not the total", () => {
    // 0 is 1000 from the far enemy but 0 from the near one; 100 is 100 away at worst.
    expect(farthestSpawn(spawns, [{ x: 0, y: 0 }, { x: 1000, y: 0 }])).toEqual({
      x: 100, y: 0, angle: 0,
    });
  });

  it("returns the first spawn when nobody is alive to avoid", () => {
    expect(farthestSpawn(spawns, [])).toEqual({ x: 0, y: 0, angle: 0 });
  });

  it("breaks ties toward the earlier spawn, so the choice is deterministic", () => {
    const mirrored: Spawn[] = [
      { x: -50, y: 0, angle: 1 },
      { x: 50, y: 0, angle: 2 },
    ];
    expect(farthestSpawn(mirrored, [{ x: 0, y: 0 }]).angle).toBe(1);
  });

  it("throws on an empty spawn list rather than returning undefined", () => {
    expect(() => farthestSpawn([], [])).toThrow(/spawn/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/shared/src/flow/respawn.test.ts`
Expected: FAIL — cannot resolve `./respawn.js`.

- [ ] **Step 3: Write it**

Create `packages/shared/src/flow/respawn.ts`:

```ts
import type { Spawn } from "../arena/types.js";

/**
 * Where a respawning car should appear: the spawn point whose NEAREST living enemy is furthest away.
 *
 * Maximising the nearest distance rather than the sum is the whole rule. A spawn far from the pack
 * but touching one camper is the worst place on the map, and a sum would happily choose it.
 *
 * This is the upstream layer every competitive shooter leans on, and it is what makes the overlap
 * case rare before spawn protection (M23) has to handle it at all. Ties break toward the earlier
 * spawn so the choice is deterministic and testable — there is deliberately no randomness here.
 */
export function farthestSpawn(
  spawns: readonly Spawn[],
  enemies: readonly { x: number; y: number }[],
): Spawn {
  const first = spawns[0];
  if (!first) throw new Error("No spawn points to respawn into");
  if (enemies.length === 0) return first;

  let best = first;
  let bestDistance = -1;
  for (const spawn of spawns) {
    let nearest = Infinity;
    for (const enemy of enemies) {
      const dx = spawn.x - enemy.x;
      const dy = spawn.y - enemy.y;
      // Squared throughout: the ordering is identical and the square root buys nothing.
      nearest = Math.min(nearest, dx * dx + dy * dy);
    }
    // Strictly greater, so an equal candidate never displaces an earlier one.
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = spawn;
    }
  }
  return best;
}
```

Export it from `packages/shared/src/index.ts`:

```ts
export { farthestSpawn } from "./flow/respawn.js";
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/flow/respawn.ts packages/shared/src/flow/respawn.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): pick the respawn point furthest from any living enemy (M22)"
```

---

## Task 8: `deathmatchOutcome`

**Files:**
- Modify: `packages/shared/src/flow/win.ts`
- Test: `packages/shared/src/flow/win.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DeathmatchPlayer` (`{ sessionId: string; kills: number; deaths: number; inRoster: boolean }`), and `deathmatchOutcome(players: readonly DeathmatchPlayer[]): LivingSidesResult`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/flow/win.test.ts`:

```ts
describe("deathmatchOutcome", () => {
  const p = (sessionId: string, kills: number, deaths: number, inRoster = true) => ({
    sessionId, kills, deaths, inRoster,
  });

  it("gives it to the most kills", () => {
    expect(deathmatchOutcome([p("a", 3, 5), p("b", 7, 1)]).winnerSessionId).toBe("b");
  });

  it("breaks a kill tie on fewest deaths", () => {
    expect(deathmatchOutcome([p("a", 5, 4), p("b", 5, 2)]).winnerSessionId).toBe("b");
  });

  it("declares a shared win when the top two match on both", () => {
    const result = deathmatchOutcome([p("a", 5, 2), p("b", 5, 2)]);
    expect(result.winnerSessionId).toBe("");
    expect(result.winnerTeam).toBe(-1);
  });

  it("ignores players who are not on the roster", () => {
    expect(deathmatchOutcome([p("a", 1, 0), p("spec", 99, 0, false)]).winnerSessionId).toBe("a");
  });

  it("counts a dead-last player, because deathmatch has no elimination", () => {
    expect(deathmatchOutcome([p("a", 0, 9)]).winnerSessionId).toBe("a");
  });

  it("draws on an empty roster rather than throwing", () => {
    expect(deathmatchOutcome([]).winnerSessionId).toBe("");
  });
});
```

Add `deathmatchOutcome` to that file's import from `./win.js`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/shared/src/flow/win.test.ts`
Expected: FAIL — `deathmatchOutcome` is not exported.

- [ ] **Step 3: Write it**

Append to `packages/shared/src/flow/win.ts`:

```ts
/** One player as the deathmatch scoreboard sees them. */
export interface DeathmatchPlayer {
  sessionId: string;
  kills: number;
  deaths: number;
  inRoster: boolean;
}

/**
 * Who won a deathmatch: most kills, then fewest deaths (M26).
 *
 * Fewest deaths is the tie-break because it is a real skill signal, it is deterministic, and it
 * needs no overtime phase. Sudden death was rejected: it would want a new phase, a networked
 * overtime flag, and a guard against two players simply hiding from each other.
 *
 * A top position still tied on both yields `winnerSessionId: ""`, which is the same shape
 * `livingSides` returns for a draw and which `ResultsScene` already renders. `winnerTeam` is always
 * -1 — deathmatch is FFA-only, so there is no team to win it.
 *
 * Unlike `livingSides`, this does NOT read `alive`. Every player waiting on a respawn timer is dead,
 * and in a mode with respawns that says nothing about who is winning.
 */
export function deathmatchOutcome(players: readonly DeathmatchPlayer[]): LivingSidesResult {
  const ranked = players
    .filter((p) => p.inRoster)
    .sort((a, b) => (b.kills - a.kills) || (a.deaths - b.deaths));

  const leader = ranked[0];
  if (!leader) return DRAW;

  const runnerUp = ranked[1];
  const tied =
    runnerUp !== undefined &&
    runnerUp.kills === leader.kills &&
    runnerUp.deaths === leader.deaths;
  if (tied) return DRAW;

  return { sides: 1, winnerSessionId: leader.sessionId, winnerTeam: -1 };
}
```

Add to `packages/shared/src/index.ts`:

```ts
export { deathmatchOutcome } from "./flow/win.js";
export type { DeathmatchPlayer } from "./flow/win.js";
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/flow/win.ts packages/shared/src/flow/win.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): rank a deathmatch by kills, then fewest deaths (M26)"
```

---

## Task 9: The respawn lifecycle rules

`ArenaRoom` has no unit tests and never has. That is deliberate: the room is a thin shell, and every
rule is extracted into a pure module beside it (`match-helpers.ts`, `select-next-host.ts`,
`singleton-arena.ts`) and tested there — the same pattern `ArenaScene` follows on the client.

So this task puts **every decision** of the respawn lifecycle into pure functions. Tasks 10 and 11
then wire them in, and that wiring is verified in the browser because there is no rule left in it to
unit test.

**Files:**
- Modify: `packages/shared/src/flow/respawn.ts`, `packages/shared/src/flow/win.ts`
- Test: `packages/shared/src/flow/respawn.test.ts`, `packages/shared/src/flow/win.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `DEATHMATCH_TICKS` (Task 2).
- Produces: `isDueToRespawn(diedAtTick: number, tick: number): boolean`; `PhaseAction = "run" | "extend" | "drop"`; `PhaseInput = { tick: number; endsTick: number; capTick: number; fired: boolean; overlapping: boolean }`; `phaseDecision(input: PhaseInput): PhaseAction`; `deathmatchEnded(rosterSize: number, tick: number, matchEndsTick: number): boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/flow/respawn.test.ts`:

```ts
describe("isDueToRespawn", () => {
  it("waits out the full delay, then fires", () => {
    expect(isDueToRespawn(100, 100 + DEATHMATCH_TICKS.respawnDelay - 1)).toBe(false);
    expect(isDueToRespawn(100, 100 + DEATHMATCH_TICKS.respawnDelay)).toBe(true);
  });

  it("never fires for a car that has not died", () => {
    // 0 is the "alive" sentinel `diedAtTick` carries, not tick zero.
    expect(isDueToRespawn(0, 999999)).toBe(false);
  });
});

describe("phaseDecision", () => {
  const input = (over: Partial<PhaseInput> = {}): PhaseInput => ({
    tick: 100,
    endsTick: 200,
    capTick: 300,
    fired: false,
    overlapping: false,
    ...over,
  });

  it("leaves protection alone while its minimum window is still running", () => {
    expect(phaseDecision(input())).toBe("run");
  });

  it("drops it the moment the player fires, whatever else is true", () => {
    expect(phaseDecision(input({ fired: true }))).toBe("drop");
    expect(phaseDecision(input({ fired: true, overlapping: true }))).toBe("drop");
  });

  it("drops it at the hard cap even while overlapped, so it cannot be held forever", () => {
    expect(phaseDecision(input({ tick: 300, endsTick: 400, overlapping: true }))).toBe("drop");
  });

  it("lets it lapse on schedule when the car is clear", () => {
    expect(phaseDecision(input({ tick: 199, endsTick: 200 }))).toBe("drop");
  });

  it("extends it when it would otherwise lapse inside another car", () => {
    expect(phaseDecision(input({ tick: 199, endsTick: 200, overlapping: true }))).toBe("extend");
  });

  it("does not extend early — overlap only matters on the tick it would lapse", () => {
    expect(phaseDecision(input({ tick: 100, endsTick: 200, overlapping: true }))).toBe("run");
  });

  it("prefers the cap over an extension when both apply", () => {
    expect(
      phaseDecision(input({ tick: 250, endsTick: 251, capTick: 250, overlapping: true })),
    ).toBe("drop");
  });
});
```

Append to `packages/shared/src/flow/win.test.ts`:

```ts
describe("deathmatchEnded", () => {
  it("ends on the clock", () => {
    expect(deathmatchEnded(4, 899, 900)).toBe(false);
    expect(deathmatchEnded(4, 900, 900)).toBe(true);
  });

  it("ends early once there is nobody left to fight", () => {
    expect(deathmatchEnded(1, 10, 900)).toBe(true);
    expect(deathmatchEnded(0, 10, 900)).toBe(true);
  });

  it("never ends a mode that has no clock, however long it runs", () => {
    // `matchEndsTick` is 0 outside deathmatch, and 0 must not read as "already past the end".
    expect(deathmatchEnded(4, 5000, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/shared/src/flow/respawn.test.ts packages/shared/src/flow/win.test.ts`
Expected: FAIL — none of the three functions is exported.

- [ ] **Step 3: Write the respawn rules**

Append to `packages/shared/src/flow/respawn.ts`, adding the import `import { DEATHMATCH_TICKS } from "../config/deathmatch-config.js";` at the top:

```ts
/**
 * Has this wreck waited long enough?
 *
 * `diedAtTick` is 0 for a living car — the schema's own "has not died" sentinel — and that must not
 * be read as "died on tick zero", which would respawn the whole roster on the match's first tick.
 */
export function isDueToRespawn(diedAtTick: number, tick: number): boolean {
  if (diedAtTick <= 0) return false;
  return tick >= diedAtTick + DEATHMATCH_TICKS.respawnDelay;
}

/** What the room should do with a car's spawn protection this tick. */
export type PhaseAction =
  /** Inside its window and not due to lapse. Leave it alone. */
  | "run"
  /** It would lapse this tick, into another car's hull. Refresh it. */
  | "extend"
  /** End it now. */
  | "drop";

export interface PhaseInput {
  tick: number;
  /** The status row's own end, as applied or last extended. */
  endsTick: number;
  /** The room-owned ceiling this protection may never pass. */
  capTick: number;
  /** Did the player commit a press on a tick the server actually simulated? */
  fired: boolean;
  /** Is this car's hull touching any car that is solid right now? */
  overlapping: boolean;
}

/**
 * The whole of M23 in one pure function, so the room is left holding no rules at all.
 *
 * The ordering IS the design. Firing wins over everything: protection is traded for the shot, and a
 * player who shoots from inside someone has chosen to be shootable. The cap wins over extension, or
 * a car parked on a ghost could hold it intangible indefinitely. And overlap is consulted ONLY on
 * the tick protection would otherwise lapse — asking sooner would extend a car that is merely
 * driving past someone, which is not what the rule is for.
 *
 * "Drop" rather than "let it expire on its own" is deliberate: it makes the end deterministic and
 * immediate, rather than depending on which of two sweeps happens to run first next tick.
 */
export function phaseDecision(input: PhaseInput): PhaseAction {
  if (input.fired) return "drop";
  if (input.tick >= input.capTick) return "drop";
  // `endsTick` is exclusive — a status is active while `tick < endsTick` — so it lapses at
  // `tick + 1` exactly when `endsTick <= tick + 1`.
  if (input.endsTick > input.tick + 1) return "run";
  return input.overlapping ? "extend" : "drop";
}
```

- [ ] **Step 4: Write the end rule**

Append to `packages/shared/src/flow/win.ts`:

```ts
/**
 * Is this deathmatch over?
 *
 * Two ways in, and neither is "one side is left standing" — with respawns every player can be dead
 * at once while their timers run, which says nothing at all about who is winning (M25).
 *
 * A `matchEndsTick` of 0 means the mode has no clock, and must never read as "already past the end":
 * that would end a last-standing match on its first tick.
 */
export function deathmatchEnded(
  rosterSize: number,
  tick: number,
  matchEndsTick: number,
): boolean {
  // Nobody left to fight. A lone survivor would otherwise drive in circles until the clock ran out.
  if (rosterSize < 2) return true;
  if (matchEndsTick <= 0) return false;
  return tick >= matchEndsTick;
}
```

- [ ] **Step 5: Export them**

In `packages/shared/src/index.ts`, **replace** the `farthestSpawn` and `deathmatchOutcome` lines added in Tasks 7 and 8 rather than duplicating them:

```ts
export { farthestSpawn, isDueToRespawn, phaseDecision } from "./flow/respawn.js";
export type { PhaseAction, PhaseInput } from "./flow/respawn.js";
export { deathmatchEnded, deathmatchOutcome, livingSides } from "./flow/win.js";
export type { DeathmatchPlayer, LivingPlayer, LivingSidesResult } from "./flow/win.js";
```

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/flow/respawn.ts packages/shared/src/flow/respawn.test.ts packages/shared/src/flow/win.ts packages/shared/src/flow/win.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): make the respawn and spawn-protection rules pure (M21-M25)"
```

---

## Task 10: Wire respawn and spawn protection into the room

No unit tests here, by design: after Task 9 there is no rule left in this code, and the room has
never had a harness. Verification is the browser, at Step 6.

**Files:**
- Modify: `packages/server/src/rooms/ArenaRoom.ts`

**Interfaces:**
- Consumes: `winRuleOf` (Task 1), `DEATHMATCH_TICKS` (Task 2), `"phased"` (Task 3), `isSolid` (Task 4), `CombatMemory.lastDamagers` (Task 6), `farthestSpawn` (Task 7), `isDueToRespawn` / `phaseDecision` (Task 9).
- Produces: no exports.

- [ ] **Step 1: Extend the imports and add the cap map**

Add to the `@motor-combat-moba/shared` import: `winRuleOf`, `DEATHMATCH_TICKS`, `farthestSpawn`, `isDueToRespawn`, `phaseDecision`, `applyStatus`, `newFireState`, `hasStatus`, `carHullOf`, `obbsOverlap`, `isSolid`, `carIdOf`. Add `readStatuses` and `writeStatuses` to the `../sim/status-bridge.js` import.

Add a field beside `matchRoster`:

```ts
  /**
   * Per-player tick at which spawn protection must end no matter what. Server-only: the client reads
   * the status row's own `endsTick`, and this is the ceiling that row may never pass.
   */
  private phaseCaps = new Map<string, number>();
```

- [ ] **Step 2: Add the respawn sweep**

```ts
  /**
   * Bring back everyone whose respawn timer has run out.
   *
   * Runs at the TOP of the tick, before `statusTick`, and that placement is the decision (M21):
   * writing the status list here means the modifiers derived moments later already include `phased`,
   * so there is no tick on which a freshly respawned car is solid. The documented `statusRequests`
   * seam is the right route for a pickup and the wrong one here, because by design a request lands
   * this tick and bites on the NEXT one — precisely the window a spawn must not have.
   */
  private respawnSweep(): void {
    for (const id of this.matchRoster) {
      const player = this.state.players.get(id);
      if (!player || player.alive) continue;
      if (!isDueToRespawn(player.diedAtTick, this.state.tick)) continue;
      this.respawn(player);
    }
  }

  /** One car back on the field. Nothing survives a death except the score. */
  private respawn(player: PlayerState): void {
    const enemies: { x: number; y: number }[] = [];
    for (const id of this.matchRoster) {
      if (id === player.sessionId) continue;
      const other = this.state.players.get(id);
      if (other?.alive) enemies.push({ x: other.x, y: other.y });
    }

    const spawn = farthestSpawn(getArena(this.state.arenaId).ffaSpawns, enemies);
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = spawn.angle;
    player.speed = 0;
    // Or the car returns already spinning, its steering still degraded by the ram that killed it.
    clearKnock(player);

    const carId = carIdOf(player);
    player.hp = hpOf(carId);
    player.alive = true;
    player.diedAtTick = 0;
    player.killedBySessionId = "";

    // No stock, no switch lock and no half-finished burst carries across a death.
    this.combat.fireStates.set(player.sessionId, newFireState(carId, player.level));
    // Or whoever last hurt you before this death is credited with your next one.
    this.combat.lastDamagers.set(player.sessionId, "");

    this.phaseCaps.set(player.sessionId, this.state.tick + DEATHMATCH_TICKS.phaseMax);
    // Applied to an EMPTY list, not to the car's current one: every debuff goes with the wreck, so a
    // lingering slow cannot ride back onto the field with a car that was just rebuilt.
    writeStatuses(
      player,
      applyStatus([], "phased", this.state.tick, DEATHMATCH_TICKS.phase, ""),
    );
  }
```

- [ ] **Step 3: Add the phase-end sweep**

```ts
  /**
   * End spawn protection, per `phaseDecision`.
   *
   * Runs at the END of the tick, unlike `respawnSweep`, and the asymmetry is deliberate: this needs
   * the fire masks the tick actually simulated and the poses driving finally settled on. A one-tick
   * lag on *ending* protection is harmless; a one-tick lag on *starting* it would leave a car solid
   * on its spawn frame.
   */
  private phaseEndSweep(masks: ReadonlyMap<string, number>): void {
    const tick = this.state.tick;
    for (const id of this.matchRoster) {
      const player = this.state.players.get(id);
      if (!player) continue;

      const rows = readStatuses(player);
      if (!hasStatus(rows, "phased", tick)) {
        this.phaseCaps.delete(id);
        continue;
      }
      const phase = rows.find((s) => s.statusId === "phased");
      if (!phase) continue;

      const action = phaseDecision({
        tick,
        endsTick: phase.endsTick,
        capTick: this.phaseCaps.get(id) ?? tick,
        fired: (masks.get(id) ?? 0) !== 0,
        overlapping: this.overlapsSolid(player),
      });

      if (action === "run") continue;
      if (action === "drop") {
        writeStatuses(player, rows.filter((s) => s.statusId !== "phased"));
        this.phaseCaps.delete(id);
        continue;
      }
      // `refresh` extends rather than overwrites, which is what `chainable` exists to permit for a
      // flag-carrying row. Two ticks, so the new end is strictly beyond the one about to lapse.
      writeStatuses(player, applyStatus(rows, "phased", tick, 2, ""));
    }
  }

  /** Is this car's hull touching any car that is actually solid right now? */
  private overlapsSolid(player: PlayerState): boolean {
    const hull = carHullOf(player.x, player.y, player.angle);
    for (const id of this.matchRoster) {
      if (id === player.sessionId) continue;
      const other = this.state.players.get(id);
      if (!other || !isSolid(other, this.state.tick)) continue;
      if (obbsOverlap(hull, carHullOf(other.x, other.y, other.angle))) return true;
    }
    return false;
  }
```

- [ ] **Step 4: Call both, and clean up after them**

At the very start of `tick()`, immediately after `this.state.tick += 1;`:

```ts
    if (
      this.state.phase === RoomPhase.MATCH &&
      winRuleOf(this.state.mode) === "deathmatch"
    ) {
      this.respawnSweep();
    }
```

At the end of `combatTick`, after `this.combat.instanceSeq = result.instanceSeq;` and before the win
check:

```ts
    if (winRuleOf(this.state.mode) === "deathmatch") this.phaseEndSweep(masks);
```

In `endMatch`, beside `this.matchRoster.clear();`, add `this.phaseCaps.clear();`. In `onLeave`,
beside `this.matchRoster.delete(client.sessionId);`, add `this.phaseCaps.delete(client.sessionId);`.

- [ ] **Step 5: Run the suite and the build**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: success.

- [ ] **Step 6: Verify in the browser**

Start the dev server through the Browser pane — never `npm run dev` through Bash. Open two clients,
start a Deathmatch, and confirm by observation:

1. A killed car disappears, then returns after 5 seconds at full hp.
2. It returns **away from** the player who killed it, not on top of them.
3. It is translucent on return and drives straight through the other car, with neither being shoved.
4. It turns solid shortly after separating — and if you park on it, it stays translucent until the
   3-second cap, then becomes solid.
5. Firing while translucent makes it solid immediately.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/rooms/ArenaRoom.ts
git commit -m "feat(server): respawn deathmatch wrecks and run their spawn protection (M21-M23)"
```

---

## Task 11: Wire the match timer and the win split

Also thin wiring — every rule it reaches for was made pure and tested in Tasks 8 and 9.

**Files:**
- Modify: `packages/server/src/rooms/ArenaRoom.ts` (`applyFlow`, `combatTick`, `onLeave`)

**Interfaces:**
- Consumes: `winRuleOf` (Task 1), `DEATHMATCH_TICKS` (Task 2), `matchEndsTick` (Task 6), `deathmatchOutcome` (Task 8), `deathmatchEnded` (Task 9).
- Produces: no exports.

- [ ] **Step 1: Stamp the timer**

In `applyFlow`, extend the existing `matchStartedAtTick` block:

```ts
    if (this.state.phase === RoomPhase.MATCH && previousPhase !== RoomPhase.MATCH) {
      this.state.matchStartedAtTick = this.state.tick;
      // 0 in every other mode: nothing reads it there, and a stale non-zero value would hand the
      // client's HUD a clock to count down that means nothing.
      this.state.matchEndsTick =
        winRuleOf(this.state.mode) === "deathmatch"
          ? this.state.tick + DEATHMATCH_TICKS.match
          : 0;
    }
```

- [ ] **Step 2: Add the deathmatch end check**

```ts
  /**
   * Deathmatch never asks `livingSides` (M25). With respawns every player can be dead at once while
   * their timers run, and that would read as a draw and end the match under everyone's feet.
   */
  private checkDeathmatchEnd(): void {
    const players: DeathmatchPlayer[] = [];
    for (const id of this.matchRoster) {
      const player = this.state.players.get(id);
      if (!player) continue;
      players.push({ sessionId: id, kills: player.kills, deaths: player.deaths, inRoster: true });
    }

    if (!deathmatchEnded(players.length, this.state.tick, this.state.matchEndsTick)) return;
    const outcome = deathmatchOutcome(players);
    this.endMatch(outcome.winnerSessionId, outcome.winnerTeam);
  }
```

- [ ] **Step 3: Split the win check in `combatTick`**

Replace the `livingSides` block at the end of `combatTick` with:

```ts
    // Win check every tick, on the state combat just wrote.
    if (winRuleOf(this.state.mode) === "deathmatch") {
      this.checkDeathmatchEnd();
      return;
    }

    // `livingSides` counts only roster members who are still alive, so a wreck and a disconnect end
    // the match by the same rule.
    const outcome = livingSides(
      sidesOf(this.state.mode),
      result.players.map((p) => ({
        sessionId: p.sessionId,
        team: p.team,
        alive: p.alive,
        inRoster: p.inRoster,
      })),
    );
    if (outcome.sides <= 1) {
      this.endMatch(outcome.winnerSessionId, outcome.winnerTeam);
    }
```

- [ ] **Step 4: Split it in `onLeave` too**

Replace the `livingSides` block at the bottom of `onLeave` with:

```ts
    if (winRuleOf(this.state.mode) === "deathmatch") {
      this.checkDeathmatchEnd();
      return;
    }

    const remainingPlayers: { sessionId: string; team: 0 | 1; alive: boolean }[] = [];
    this.state.players.forEach((player) => {
      remainingPlayers.push({
        sessionId: player.sessionId,
        team: player.team === 1 ? 1 : 0,
        alive: player.alive,
      });
    });
    const result = livingSides(
      sidesOf(this.state.mode),
      livingAfterLeave(remainingPlayers, this.matchRoster),
    );
    if (result.sides <= 1) {
      this.endMatch(result.winnerSessionId, result.winnerTeam);
    }
```

Extend the shared import with `deathmatchEnded`, `deathmatchOutcome` and `type DeathmatchPlayer`.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verify in the browser**

With two clients in a Deathmatch:

1. Both players die at the same moment — the match must **not** end. This is the regression M25
   exists to prevent, and it is the single most important thing to check by hand in this whole plan.
2. One player leaves — the match ends immediately.
3. Temporarily set `matchSeconds` to `20` in `DEATHMATCH_CONFIG`, rebuild, and confirm the match ends
   on the clock with the higher kill count winning. **Restore it to 300 afterwards.**

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/rooms/ArenaRoom.ts
git commit -m "feat(server): end a deathmatch on its clock, never on last-standing (M24-M26)"
```

## Task 12: The lobby's third mode

**Files:**
- Modify: `packages/client/src/ui/screens/lobby.ts` (`MODE_CARDS`)
- Modify: `packages/client/src/ui/lobby-view.ts` (`modeLabel`)
- Test: `packages/client/src/ui/lobby-view.test.ts`

**Interfaces:**
- Consumes: `GameMode.FFA_DEATHMATCH` (Task 1), `DEATHMATCH_CONFIG` (Task 2).
- Produces: `modeLabel(GameMode.FFA_DEATHMATCH)` returns `"Deathmatch"`.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/ui/lobby-view.test.ts`:

```ts
describe("modeLabel", () => {
  it("names all three modes distinctly", () => {
    expect(modeLabel(GameMode.FFA_LAST_STANDING)).toBe("Brawl");
    expect(modeLabel(GameMode.TEAM)).toBe("Team brawl");
    expect(modeLabel(GameMode.FFA_DEATHMATCH)).toBe("Deathmatch");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/client/src/ui/lobby-view.test.ts`
Expected: FAIL — receives `"Brawl"` for Deathmatch.

- [ ] **Step 3: Name the mode**

In `packages/client/src/ui/lobby-view.ts`, replace `modeLabel`:

```ts
export function modeLabel(mode: GameMode): string {
  if (mode === GameMode.TEAM) return "Team brawl";
  if (mode === GameMode.FFA_DEATHMATCH) return "Deathmatch";
  return "Brawl";
}
```

- [ ] **Step 4: Add the card**

In `packages/client/src/ui/screens/lobby.ts`, import `DEATHMATCH_CONFIG` alongside `GameMode` and append a third entry to `MODE_CARDS`:

```ts
  {
    id: GameMode.FFA_DEATHMATCH,
    name: "Deathmatch",
    kicker: "Free-for-all",
    body: "Everyone fights everyone, and dying costs you five seconds instead of the round. Most kills when the clock runs out takes it.",
    metaA: "2-6 players",
    metaB: `${DEATHMATCH_CONFIG.matchSeconds / 60} minutes`,
  },
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verify it in the browser**

Start the dev server with the Browser pane (never `npm run dev` through Bash), open the lobby, click **Game modes**, and confirm three cards render, Deathmatch is selectable, and Apply sets the lobby's mode tag to "Deathmatch". Take a screenshot for the commit note.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/ui/screens/lobby.ts packages/client/src/ui/lobby-view.ts packages/client/src/ui/lobby-view.test.ts
git commit -m "feat(client): offer Deathmatch as a third lobby mode (M1)"
```

---

## Task 13: Real K/D on the results screen

**Files:**
- Modify: `packages/client/src/ui/results-view.ts` (`ResultsViewPlayer`, `rows`, the file header comment)
- Modify: `packages/client/src/scenes/ResultsScene.ts:44-51` (the snapshot)
- Test: `packages/client/src/ui/results-view.test.ts`

**Interfaces:**
- Consumes: `PlayerState.kills` / `.deaths` (Task 6).
- Produces: `ResultsViewPlayer` gains `kills: number` and `deaths: number`; `StatRow.k` / `.d` carry them.

- [ ] **Step 1: Write the failing test**

Append to `packages/client/src/ui/results-view.test.ts`:

```ts
describe("scoreboard stats", () => {
  it("carries real kills and deaths through to the row", () => {
    const view = resultsView(
      state({
        mode: GameMode.FFA_DEATHMATCH,
        winnerSessionId: "p1",
        players: [{ ...basePlayer(), sessionId: "p1", kills: 7, deaths: 2 }],
      }),
      "p1",
    );
    expect(view.statsA[0]!.k).toBe(7);
    expect(view.statsA[0]!.d).toBe(2);
  });

  it("still reports zero assists, which the game does not track", () => {
    const view = resultsView(
      state({ players: [{ ...basePlayer(), sessionId: "p1", kills: 7, deaths: 2 }] }),
      "p1",
    );
    expect(view.statsA[0]!.a).toBe(0);
  });
});
```

Add `kills: 0, deaths: 0` to that file's existing player factory.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/client/src/ui/results-view.test.ts`
Expected: FAIL — `k` is 0, and `kills` is not a property of `ResultsViewPlayer`.

- [ ] **Step 3: Carry the numbers**

In `packages/client/src/ui/results-view.ts`:

Replace the file-header paragraph about zeroes with:

```
 * K and D are real as of 2026-09-01. A stays zero on purpose: the game attributes a kill to whoever
 * dealt damage last and tracks no assists at all, so an assist column would be inventing a number.
```

Add `kills: number;` and `deaths: number;` to `ResultsViewPlayer`, and in `rows`, replace `k: 0, d: 0,` with:

```ts
    k: p.kills,
    d: p.deaths,
```

In `packages/client/src/scenes/ResultsScene.ts`, add to the pushed snapshot object:

```ts
        kills: player.kills,
        deaths: player.deaths,
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/ui/results-view.ts packages/client/src/ui/results-view.test.ts packages/client/src/scenes/ResultsScene.ts
git commit -m "feat(client): show real kills and deaths on the results scoreboard (M11)"
```

---

## Task 14: The deathmatch HUD derivations

**Files:**
- Create: `packages/client/src/scenes/deathmatch-hud.ts`
- Test: `packages/client/src/scenes/deathmatch-hud.test.ts`
- Modify: `packages/client/src/scenes/roster-panel.ts` (`RosterPlayer`, `RosterRow`, `rosterRows`)
- Test: `packages/client/src/scenes/roster-panel.test.ts`

**Interfaces:**
- Consumes: `DEATHMATCH_CONFIG` / `DEATHMATCH_TICKS` (Task 2), `TICK_RATE_HZ`.
- Produces: `matchClockLabel(tick: number, matchEndsTick: number): string`; `respawnSeconds(diedAtTick: number, tick: number): number`; `killedByText(killerName: string): string`; `showKilledBy(alive: boolean, diedAtTick: number, tick: number): boolean`; `RosterRow.kills: number`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/scenes/deathmatch-hud.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import {
  killedByText,
  matchClockLabel,
  respawnSeconds,
  showKilledBy,
} from "./deathmatch-hud.js";

describe("matchClockLabel", () => {
  it("counts down in m:ss", () => {
    expect(matchClockLabel(0, 90 * TICK_RATE_HZ)).toBe("1:30");
    expect(matchClockLabel(30 * TICK_RATE_HZ, 90 * TICK_RATE_HZ)).toBe("1:00");
  });

  it("floors, so it never briefly claims a second that has not elapsed", () => {
    expect(matchClockLabel(1, 90 * TICK_RATE_HZ)).toBe("1:29");
  });

  it("clamps at zero rather than counting backwards past the end", () => {
    expect(matchClockLabel(200 * TICK_RATE_HZ, 90 * TICK_RATE_HZ)).toBe("0:00");
  });

  it("is empty when there is no deathmatch clock to show", () => {
    expect(matchClockLabel(500, 0)).toBe("");
  });
});

describe("respawnSeconds", () => {
  it("counts whole seconds down from the delay, rounding up so it ends on 1 not 0", () => {
    expect(respawnSeconds(0, 0)).toBe(5);
    expect(respawnSeconds(0, TICK_RATE_HZ)).toBe(4);
    expect(respawnSeconds(0, 5 * TICK_RATE_HZ)).toBe(0);
  });

  it("is zero for a car that has not died", () => {
    expect(respawnSeconds(0, 900)).toBe(0);
  });
});

describe("the killed-you banner", () => {
  it("shows for three seconds after death, then stops", () => {
    expect(showKilledBy(false, 100, 100)).toBe(true);
    expect(showKilledBy(false, 100, 100 + 3 * TICK_RATE_HZ - 1)).toBe(true);
    expect(showKilledBy(false, 100, 100 + 3 * TICK_RATE_HZ)).toBe(false);
  });

  it("never shows for a living car, including one that just respawned", () => {
    expect(showKilledBy(true, 0, 10)).toBe(false);
    expect(showKilledBy(false, 0, 10)).toBe(false);
  });

  it("names the killer", () => {
    expect(killedByText("Rig")).toBe("Rig killed you");
  });

  it("falls back rather than printing an empty name", () => {
    expect(killedByText("")).toBe("You were destroyed");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/client/src/scenes/deathmatch-hud.test.ts`
Expected: FAIL — cannot resolve `./deathmatch-hud.js`.

- [ ] **Step 3: Write the module**

Create `packages/client/src/scenes/deathmatch-hud.ts`:

```ts
import { DEATHMATCH_TICKS, TICK_RATE_HZ } from "@motor-combat-moba/shared";

/** How long "[name] killed you" stays up. Render-only, so it lives here rather than in shared. */
export const KILLED_BY_TICKS = 3 * TICK_RATE_HZ;

/**
 * The deathmatch HUD's pure derivations, kept out of `ArenaScene` for the reason every other
 * `*-hud.ts` module in this directory exists: the scene cannot be unit-tested without a browser, so
 * anything with a rule in it lives beside it and the scene stays a shell over the top.
 *
 * Every one of these is derived from state the schema already carries. The respawn countdown reads
 * `diedAtTick`, which was networked for the death fade long before respawning existed, so neither it
 * nor the banner costs a new field.
 */

/** `m:ss` remaining, or `""` when this mode has no clock. Floors, and never counts past zero. */
export function matchClockLabel(tick: number, matchEndsTick: number): string {
  if (matchEndsTick <= 0) return "";
  const remaining = Math.max(0, matchEndsTick - tick);
  const total = Math.floor(remaining / TICK_RATE_HZ);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Whole seconds until this car is back, or 0 once it is due.
 *
 * Rounds UP, so the last displayed number is 1 rather than a second of "0" the player sits through
 * wondering whether the game has hung. `diedAtTick` of 0 means "has not died".
 */
export function respawnSeconds(diedAtTick: number, tick: number): number {
  if (diedAtTick <= 0) return 0;
  const remaining = diedAtTick + DEATHMATCH_TICKS.respawnDelay - tick;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / TICK_RATE_HZ);
}

/** Is the local player inside the banner's window? Local player only — nobody else sees this. */
export function showKilledBy(alive: boolean, diedAtTick: number, tick: number): boolean {
  if (alive || diedAtTick <= 0) return false;
  return tick - diedAtTick < KILLED_BY_TICKS;
}

/** A killer who left the room before the patch landed leaves no name to print. */
export function killedByText(killerName: string): string {
  return killerName === "" ? "You were destroyed" : `${killerName} killed you`;
}
```

- [ ] **Step 4: Add kills to the roster row**

In `packages/client/src/scenes/roster-panel.ts`, add `readonly kills: number;` to both `RosterPlayer` and `RosterRow` (with the comment `/** Shown only in Deathmatch; the panel's caller decides whether to draw the column. */`), and add `kills: player.kills,` to the mapped object in `rosterRows`.

Append to `packages/client/src/scenes/roster-panel.test.ts`:

```ts
it("carries each player's kill count through to the row", () => {
  const rows = rosterRows([rosterPlayer({ sessionId: "a", kills: 4 })]);
  expect(rows[0]!.kills).toBe(4);
});
```

Add `kills: 0` to that file's existing player factory.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/scenes/deathmatch-hud.ts packages/client/src/scenes/deathmatch-hud.test.ts packages/client/src/scenes/roster-panel.ts packages/client/src/scenes/roster-panel.test.ts
git commit -m "feat(client): derive the deathmatch clock, respawn countdown and kill banner (M27)"
```

---

## Task 15: Wire the HUD into `ArenaScene`

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: everything from Task 14, plus `winRuleOf` (Task 1) and `Modifiers.phased` (Task 3).
- Produces: no exports. `ArenaScene` is the untestable shell; every rule it draws came from Task 14.

- [ ] **Step 1: Add the match clock**

Create a `Phaser.GameObjects.Text` beside the existing `spectateText`, top-centre of the arena. Each frame set `text = matchClockLabel(room.state.tick, room.state.matchEndsTick)` and `visible = text !== ""`. The empty-string case means it hides itself in every non-deathmatch mode with no mode check at the call site.

- [ ] **Step 2: Add the killed-you banner**

A centred text object, hidden by default. Each frame:

```ts
const local = room.state.players.get(room.sessionId);
const show = !!local && showKilledBy(local.alive, local.diedAtTick, room.state.tick);
banner.setVisible(show);
if (show) {
  const killer = room.state.players.get(local!.killedBySessionId);
  banner.setText(killedByText(killer?.name ?? ""));
}
```

Deliberately **not** gated on mode — the banner shows in Last Standing too.

- [ ] **Step 3: Add the respawn countdown**

Below the banner, and only in Deathmatch. Each frame, when the local player is dead, set the text to `` `Respawning in ${respawnSeconds(local.diedAtTick, room.state.tick)}` `` and hide it when that returns 0.

- [ ] **Step 4: Draw phasing cars as ghosts**

In the per-player draw loop, where `deathFadeAlpha` is already consulted, multiply the resulting alpha by a ghost factor when that player's status rows report `phased` at the current tick. Use `isPhasedAt(player.statuses, room.state.tick)` from shared — the same function `isSolid` uses, so the thing the player sees and the thing the sim believes cannot disagree. Add `const PHASED_ALPHA = 0.45;` beside the other draw constants.

- [ ] **Step 5: Draw the kills column**

In the roster panel draw, when `winRuleOf(room.state.mode) === "deathmatch"`, draw `row.kills` right-aligned in the panel. Skip it entirely otherwise, so Last Standing's panel is byte-identical to today's.

- [ ] **Step 6: Verify in the browser**

Start the dev server through the Browser pane. Run a two-client Deathmatch and confirm: the clock counts down; a kill shows "[name] killed you" for three seconds **to the victim only**; the respawn countdown runs 5→1; the car returns translucent and drives through others; the ghost turns solid shortly after clearing them; and the kills column tracks. Then run a Last Standing match and confirm no clock, no countdown, no kills column — but the killed-you banner still appears.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(client): draw the deathmatch HUD and phasing cars (M27)"
```

---

## Task 16: Docs, the manual, and the probes

**Files:**
- Modify: `packages/server/playtest/weapons.ts:214`, `packages/server/playtest/weapons2.ts:259`
- Modify: `CLAUDE.md`, `docs/glossary.md`, `docs/config-reference.md`, `docs/combat-model.md`, `docs/schema-reference.md`, `docs/project-structure.md`
- Modify: `packages/client/public/manual.html` (generated)
- Modify: `docs/superpowers/specs/2026-09-01-ffa-game-modes-design.md` (status line)

- [ ] **Step 1: Qualify the two stale probe comments**

Both assert "there is no wreck — a dead car leaves the field the instant it dies." Append to each:

```
 * In Deathmatch it leaves and then comes BACK: `respawnSweep` returns it after
 * `DEATHMATCH_TICKS.respawnDelay`, briefly `phased` and so still not solid. These probes run
 * last-standing rules, where the original sentence holds unchanged.
```

- [ ] **Step 2: Rebuild the manual**

Run: `npm run build:manual`

This is required, not optional: `STATUS_TABLE` is hashed whole by `balanceStamp`, so the `phased` row moved the fingerprint and `scripts/manual-page.test.mjs` fails until the page is regenerated.

- [ ] **Step 3: Update the docs**

- `CLAUDE.md` — add a paragraph on the two FFA win conditions beside the existing statuses paragraph, note that `isOnField` has split into a mover gate and a solidity gate, and add the new spec to the "Read the right doc" table.
- `docs/glossary.md` — **Deathmatch**, **phasing**, **last damager**, **contact-clear**.
- `docs/config-reference.md` — a `DEATHMATCH_CONFIG` section with all four values.
- `docs/combat-model.md` — kill attribution and the respawn lifecycle.
- `docs/schema-reference.md` — `kills`, `deaths`, `killedBySessionId`, `matchEndsTick`.
- `docs/project-structure.md` — the four new source files.
- The spec's header: `**Status:** Designed, not implemented.` → `**Status:** Implemented.`

- [ ] **Step 4: Run everything**

Run: `npm test`
Expected: PASS, including `manual-page.test.mjs`.

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add packages/server/playtest/weapons.ts packages/server/playtest/weapons2.ts packages/client/public/manual.html CLAUDE.md docs/
git commit -m "docs: record the two FFA win conditions, and rebuild the manual (M31, M33)"
```

- [ ] **Step 6: Recommend a playtest run — do not run it unprompted**

Report to the user, in the final summary and not buried:

> This changed collision-set membership (`isSolid`), the ram pair list, and the tick order in `ArenaRoom.tick` — all of which the `ram` and `collision` probes measure. **I recommend `npm run playtest`.** The expectation is that **nothing moves**: outside Deathmatch no car ever carries `phased`, so `isSolid` is identical to `isOnField`. A number that *did* move means the predicate split leaked into modes it should not touch.

Running it is the user's call. Do not update any probe threshold without being asked.

---

## Verification Checklist

- [ ] `npm test` passes from the repo root
- [ ] `npm run build` succeeds (this is what proves the playtest probes compile)
- [ ] `golden.test.ts` passes **unmodified** — if it needed editing, the change leaked into the drive path (M30)
- [ ] `manual-page.test.mjs` passes, with `manual.html` regenerated and committed
- [ ] A Last Standing match plays identically to before: no clock, no respawn, no kills column
- [ ] A Deathmatch match respawns, protects, scores, and ends on its clock
- [ ] `npm run playtest` **recommended to the user**, not run unprompted
