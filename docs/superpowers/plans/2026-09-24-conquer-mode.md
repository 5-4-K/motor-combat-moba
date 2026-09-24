# Conquer Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship "Conquer", a 3v3 zone-control game mode on a new 1280 × 2160 arena, playable from a real LAN lobby.

**Architecture:** Conquer is a new `GameMode` (wire value 3) with its own mode folder. It reuses the
dormant team machinery (`sidesOf → "team"`) and Deathmatch's respawn and clock, and adds one new win
rule (`"conquer"`). All capture and win logic is pure shared code (`flow/conquer.ts`), and the room
only calls it. The client gains a 180° world-camera rotation for team B, procedural spike and chamfer
drawing for an art-less arena, a zone ring, and a Conquer-only gutter layout.

**Tech Stack:** TypeScript, npm workspaces, Colyseus schema (`@type`), Phaser 4.2.1, vitest,
`node --test` for `scripts/`.

**Spec:** `docs/superpowers/specs/2026-09-24-conquer-mode-design.md` (CQ1–CQ62). Read it first; the
clauses are referenced by number below.

## Global Constraints

- The branch is `game/team-shooter`. Build with root `npm run build`, never `npm run build --workspaces`. Shared is consumed as built `dist`: after editing shared, `npm run build -w @motor-combat-moba/shared` before running server or client tests.
- Enum wire values never renumber: `GameMode.CONQUER = 3` (invariant 7).
- Never read a config accessor at module scope. `cfg()` throws outside a mode scope. Tests use `withDefaultMode(fn)` or `withMode(modeConfigOf(GameMode.CONQUER), fn)` from `packages/shared/src/modes/test-setup.ts` / `modes/active.ts`.
- There are no magic numbers in logic. Every Conquer number comes from `conquer()` / `derived().conquerTicks` / `deathmatch()` / `derived().deathmatchTicks`, or from the arena's `zone`.
- Do not read or touch `docs/ideas/` or `docs/invariants/`.
- **Baseline:** 2 tests are failing before this plan starts: `packages/server/src/bot/brain/controller.test.ts` "hunts a quadrant waypoint…" and "hunts toward a last-known pose…" (G12). They are pre-existing. Do not fix them, and do not count them as regressions. Because `npm test` stops at the server suite, run the client suite (`npm run test -w @motor-combat-moba/client`) and `npm run test:scripts` separately to check them.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019NCq7UZFizmo7Yuouznmj1
  ```
- Conquer ships `isActive: false` until Task 13.

## Review Focus

1. **The only holder dies or disconnects mid-countdown.** The countdown must reset. Only living roster cars count as present. A disconnected player's car is no longer in the roster. Owned by Task 4 (`zonePresence` excludes non-roster and dead) and Task 6.
2. **On the tick the clock expires, a bar reaches 100 %.** The 100 % team wins; there is no tie and no overtime. Owned by Task 4 (`conquerOutcome` ordering test).
3. **At the car-select deadline, a player's previewed car has been taken by a teammate.** They must get a different, untaken chassis, never a duplicate. Owned by Task 5 (`pickDeadlineCar` test).
4. **The lobby is 4v2, 3v2 or 2v2.** Start must be refused with the teamSize message. Team brawl must still start at 1v1. Owned by Task 5 (`canStart` tests).
5. **Team B's self-arrow and lighting under the rotated view.** The arrow must still sit above the car on screen, pointing down, and must not appear upside down below it. Owned by Task 9 (`countdownArrowPoints` flipped test).

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `packages/shared/src/config/conquer-config.ts` (new) | `CONQUER_CONFIG`, `ConquerConfig`, `ConquerTicks`, `resolveConquerTicks` | 1 |
| `packages/shared/src/modes/{brawl,deathmatch}/conquer.ts` (new) | per-mode copies (inert outside conquer) | 1 |
| `packages/shared/src/modes/{types,build,active}.ts`, `index.ts` | 16th table, `conquerTicks`, `conquer()` | 1 |
| `packages/shared/src/arena/types.ts`, `arena/arena-03.ts` (new), `arena/registry.ts`, `arena/arena.test.ts`, `arena/arena-03.test.ts` (new) | zone + flip fields, the new arena | 2 |
| `packages/shared/src/constants.ts`, `modes/conquer/*` (new), `modes/registry.ts`, `flow/modes.ts`, `packages/server/src/config/mode-bot.ts` | the mode | 3 |
| `packages/shared/src/flow/conquer.ts` (new), `schema/ArenaState.ts`, `modes/invariants.test.ts` | zone rules and networked zone state | 4 |
| `packages/shared/src/flow/spawns.ts`, `flow/respawn.ts`, `lobby/start-rules.ts`, `lobby/car-claims.ts` (new), `schema/PlayerState.ts` | team threading, start rule, chassis claims | 5 |
| `packages/server/src/rooms/{ArenaRoom,tick-pipeline,match-helpers}.ts` | room wiring | 6 |
| `packages/server/balance/cli.ts` (+ test), `modes/mode-arg.test.ts` | harness refusal | 7 |
| client allegiance, lobby, reveal, spectate, respawn text | team and respawn threading | 8 |
| `packages/client/src/scenes/view-rotation.ts` (new), `countdown-arrow.ts`, `car-lighting.ts`, `input/aim-offset.ts`, `ArenaScene.ts` | team B's rotated view | 9 |
| `packages/client/src/scenes/arena-visual.ts`, `zone-visual.ts` (new), `ArenaScene.ts` | spikes, chamfers, zone ring | 10 |
| `packages/client/src/scenes/conquer-hud.ts` (new), `ArenaScene.ts` | the Conquer gutter | 11 |
| `packages/client/src/ui/car-select-view.ts`, `ui/screens/car-select.ts`, `ui/results-view.ts`, `ui/screens/results.ts`, `ui/lobby-view.ts` | taken cards, results line, lobby card | 12 |
| registry flag, docs, manual, turn-tuning | publishing | 13 |

---

### Task 1: The `conquer` config table and accessor (CQ25, CQ26)

**Files:**
- Create: `packages/shared/src/config/conquer-config.ts`
- Create: `packages/shared/src/config/conquer-config.test.ts`
- Create: `packages/shared/src/modes/brawl/conquer.ts`, `packages/shared/src/modes/deathmatch/conquer.ts`
- Modify: `packages/shared/src/modes/types.ts` (add `conquer` to `ModeTables`, `conquerTicks` to `ModeDerived`)
- Modify: `packages/shared/src/modes/build.ts` (one line in `derived`)
- Modify: `packages/shared/src/modes/active.ts` (add `conquer()` after `deathmatch()`)
- Modify: `packages/shared/src/modes/brawl/index.ts`, `modes/deathmatch/index.ts` (add `conquer:`)
- Modify: `packages/shared/src/index.ts` (export `conquer` accessor, `CONQUER_CONFIG`, types)
- Modify: `packages/shared/src/modes/table-pinning.test.ts` (new row, with a `conquer` column not needed: the row compares raw vs brawl vs deathmatch)
- Modify: `packages/shared/src/modes/parity.test.ts` (`conquer` is post-fixture)
- Modify: `packages/shared/src/modes/no-raw-config-in-sim.test.ts` (ban `CONQUER_CONFIG`)

**Interfaces:**
- Produces: `interface ConquerConfig { readonly captureDelaySeconds: number; readonly controlTargetSeconds: number; readonly teamSize: number; readonly uniqueChassisPerTeam: boolean }`, `CONQUER_CONFIG: ConquerConfig`, `interface ConquerTicks { readonly captureDelay: number; readonly controlTarget: number }`, `resolveConquerTicks(c?: ConquerConfig): ConquerTicks`, accessor `conquer(): ConquerConfig`, `derived().conquerTicks: ConquerTicks`.

- [ ] **Step 1: Write the failing test** at `packages/shared/src/config/conquer-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import { CONQUER_CONFIG, resolveConquerTicks } from "./conquer-config.js";
import { withDefaultMode } from "../modes/test-setup.js";
import { conquer, derived } from "../modes/active.js";

describe("CONQUER_CONFIG (CQ25)", () => {
  it("authors the brainstormed values", () => {
    expect(CONQUER_CONFIG).toStrictEqual({
      captureDelaySeconds: 5,
      controlTargetSeconds: 60,
      teamSize: 3,
      uniqueChassisPerTeam: true,
    });
    expect(Object.isFrozen(CONQUER_CONFIG)).toBe(true);
  });

  it("resolves whole ticks with Math.round", () => {
    expect(resolveConquerTicks(CONQUER_CONFIG)).toStrictEqual({
      captureDelay: Math.round(5 * TICK_RATE_HZ),
      controlTarget: Math.round(60 * TICK_RATE_HZ),
    });
    expect(resolveConquerTicks({ ...CONQUER_CONFIG, captureDelaySeconds: 0.51 }).captureDelay).toBe(
      Math.round(0.51 * TICK_RATE_HZ),
    );
  });

  it("is reachable through the active bundle", () => {
    withDefaultMode(() => {
      expect(conquer()).toStrictEqual(CONQUER_CONFIG);
      expect(derived().conquerTicks).toStrictEqual(resolveConquerTicks(CONQUER_CONFIG));
    });
  });
});
```

- [ ] **Step 2: Run it and check that it fails.** Run: `cd packages/shared && npx vitest run src/config/conquer-config.test.ts`. Expected: FAIL (the module is not found).

- [ ] **Step 3: Create `packages/shared/src/config/conquer-config.ts`:**

```ts
import { TICK_RATE_HZ } from "../constants.js";

/**
 * Conquer's zone-control tuning (spec CQ25). Every mode carries a copy (CQ26), the way every mode
 * carries a `deathmatch` table, but only a mode whose `winRuleOf` is `"conquer"` reads any of it:
 * `teamSize` and `uniqueChassisPerTeam` are inert everywhere else, which is how Team brawl keeps its
 * 1v1-to-3v3 start rule.
 *
 * The match clock, respawn delay and spawn-protection windows are NOT here. Conquer reads them from
 * its own `deathmatch` table (CQ22), which is the "clock and respawn" table, named for its first user.
 */
export interface ConquerConfig {
  /** Uncontested presence needed before a team is "in control" and its bar starts to fill. */
  readonly captureDelaySeconds: number;
  /** Accumulated control that fills a bar to 100 % and wins outright. */
  readonly controlTargetSeconds: number;
  /** The exact number of ready players each team must have to start (CQ28). */
  readonly teamSize: number;
  /** A chassis a teammate has locked is refused (CQ4, CQ30). */
  readonly uniqueChassisPerTeam: boolean;
}

export const CONQUER_CONFIG: ConquerConfig = Object.freeze({
  captureDelaySeconds: 5,
  controlTargetSeconds: 60,
  teamSize: 3,
  uniqueChassisPerTeam: true,
});

/** The two durations in the whole ticks the room counts. */
export interface ConquerTicks {
  readonly captureDelay: number;
  readonly controlTarget: number;
}

export function resolveConquerTicks(conquer: ConquerConfig = CONQUER_CONFIG): ConquerTicks {
  return {
    captureDelay: Math.round(conquer.captureDelaySeconds * TICK_RATE_HZ),
    controlTarget: Math.round(conquer.controlTargetSeconds * TICK_RATE_HZ),
  };
}
```

- [ ] **Step 4: Create both mode copies.** `packages/shared/src/modes/brawl/conquer.ts`:

```ts
// Inert in Brawl (and in Team brawl, which shares these tables): only a "conquer" win rule reads it.
import type { ConquerConfig } from "../../config/conquer-config.js";

export const BRAWL_CONQUER = {
  captureDelaySeconds: 5,
  controlTargetSeconds: 60,
  teamSize: 3,
  uniqueChassisPerTeam: true,
} as const satisfies ConquerConfig;
```

`packages/shared/src/modes/deathmatch/conquer.ts` is identical, with the export named `DEATHMATCH_CONQUER` and the comment reading "Inert in Deathmatch".

- [ ] **Step 5: Wire the table.**
  - In `modes/types.ts`, import `ConquerConfig, ConquerTicks` from `../config/conquer-config.js`. Add `readonly conquer: ConquerConfig;` directly after `readonly deathmatch: DeathmatchConfig;` in `ModeTables`, and `readonly conquerTicks: Readonly<ConquerTicks>;` after `deathmatchTicks` in `ModeDerived`.
  - In `modes/build.ts`, import `resolveConquerTicks` and add `conquerTicks: resolveConquerTicks(cloned.conquer),` after the `deathmatchTicks` line. Update the doc comment "eight derived artifacts" wherever it appears in `build.ts`/`types.ts` to "nine".
  - In `modes/active.ts`, import `type ConquerConfig` and add:

```ts
export function conquer(): ConquerConfig {
  return cfg().conquer;
}
```

  - Add `conquer: BRAWL_CONQUER,` / `conquer: DEATHMATCH_CONQUER,` after `deathmatch:` in the two `index.ts` files.
  - In `packages/shared/src/index.ts`, add `conquer` to the accessor re-export list (next to `deathmatch`). Beside the `DEATHMATCH_CONFIG` export, add `export { CONQUER_CONFIG, resolveConquerTicks } from "./config/conquer-config.js";` and `export type { ConquerConfig, ConquerTicks } from "./config/conquer-config.js";`.

- [ ] **Step 6: Pin and exempt.**
  - `table-pinning.test.ts`: import `CONQUER_CONFIG`, `BRAWL_CONQUER`, `DEATHMATCH_CONQUER`, and add the row `{ table: "conquer (CONQUER_CONFIG)", raw: CONQUER_CONFIG, brawl: BRAWL_CONQUER, deathmatch: DEATHMATCH_CONQUER },` after the deathmatch row.
  - `parity.test.ts`: add `"conquer",` to `TABLE_KEYS` after `"deathmatch"`. Add `const POST_FIXTURE_KEYS = ["conquer"] as const;` with the comment `// Tables added after the fixture was captured (Conquer, 2026-09-24): no pre-migration value to compare.`. Change the fixture key assertion to `expect(Object.keys(shippedTables).sort()).toStrictEqual(TABLE_KEYS.filter((k) => !(POST_FIXTURE_KEYS as readonly string[]).includes(k)).sort());`, and in the loop add `if ((POST_FIXTURE_KEYS as readonly string[]).includes(key)) continue;`.
  - `no-raw-config-in-sim.test.ts`: add `CONQUER_CONFIG` to the `BANNED` alternation (after `DEATHMATCH_TICKS`), and add `conquer()` to the accessor list in the header comment.

- [ ] **Step 7: Run the shared suite and typecheck.** Run: `cd packages/shared && npx vitest run && npx tsc --noEmit -p .`. Expected: all pass, including the new test.

- [ ] **Step 8: Commit.** `git add -A packages/shared && git commit -m "feat(shared): conquer config table and accessor (CQ25, CQ26)"`, plus the trailer lines.

---

### Task 2: `ArenaDef.zone` / `flipForTeamB` and arena-03 (CQ20, CQ36–CQ40)

**Files:**
- Modify: `packages/shared/src/arena/types.ts`
- Create: `packages/shared/src/arena/arena-03.ts`, `packages/shared/src/arena/arena-03.test.ts`
- Modify: `packages/shared/src/arena/registry.ts` (register `"arena-03": ARENA_03`)
- Modify: `packages/shared/src/arena/arena.test.ts` (the team-sides assertion, CQ36)
- Modify: `packages/shared/src/index.ts` (export `ARENA_03` if `ARENA_01`/`ARENA_02` are exported, and the `ArenaZone` type)

**Interfaces:**
- Produces: `interface ArenaZone { readonly x: number; readonly y: number; readonly radius: number }`, `ArenaDef.zone?: ArenaZone`, `ArenaDef.flipForTeamB?: boolean`, `ARENA_03`, `ArenaId` now includes `"arena-03"`.

- [ ] **Step 1: Write the failing test** `packages/shared/src/arena/arena-03.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ARENA_03 } from "./arena-03.js";
import { getArena } from "./registry.js";

/** 180° about the arena centre. */
function rot(x: number, y: number): { x: number; y: number } {
  return { x: ARENA_03.width - x, y: ARENA_03.height - y };
}

describe("arena-03 (Conquer, CQ37–CQ40)", () => {
  it("is registered, 1280 x 2160, flips for team B, and has the centre zone", () => {
    expect(getArena("arena-03")).toBe(ARENA_03);
    expect([ARENA_03.width, ARENA_03.height]).toStrictEqual([1280, 2160]);
    expect(ARENA_03.flipForTeamB).toBe(true);
    expect(ARENA_03.zone).toStrictEqual({ x: 640, y: 1080, radius: 150 });
  });

  it("maps onto itself under a 180° rotation (obstacles, spawns A<->B, zone)", () => {
    const key = (o: { x: number; y: number; w: number; h: number }) => `${o.x},${o.y},${o.w},${o.h}`;
    const rotated = ARENA_03.obstacles.map((o) => {
      const p = rot(o.x + o.w, o.y + o.h); // the far corner becomes the new top-left
      return key({ x: p.x, y: p.y, w: o.w, h: o.h });
    });
    expect(new Set(rotated)).toStrictEqual(new Set(ARENA_03.obstacles.map(key)));
    const bFromA = ARENA_03.teamASpawns.map((s) => rot(s.x, s.y)).map((p) => `${p.x},${p.y}`);
    expect(new Set(bFromA)).toStrictEqual(new Set(ARENA_03.teamBSpawns.map((s) => `${s.x},${s.y}`)));
    const z = rot(ARENA_03.zone!.x, ARENA_03.zone!.y);
    expect([z.x, z.y]).toStrictEqual([ARENA_03.zone!.x, ARENA_03.zone!.y]);
  });

  it("team A spawns at the bottom facing up, team B at the top facing down", () => {
    for (const s of ARENA_03.teamASpawns) {
      expect(s.y).toBeGreaterThan(ARENA_03.height / 2);
      expect(s.angle).toBeCloseTo(-Math.PI / 2);
    }
    for (const s of ARENA_03.teamBSpawns) {
      expect(s.y).toBeLessThan(ARENA_03.height / 2);
      expect(s.angle).toBeCloseTo(Math.PI / 2);
    }
  });

  it("keeps every spawn at least ~800 u from the zone edge (CQ42's dependency)", () => {
    const z = ARENA_03.zone!;
    for (const s of [...ARENA_03.teamASpawns, ...ARENA_03.teamBSpawns]) {
      expect(Math.hypot(s.x - z.x, s.y - z.y) - z.radius).toBeGreaterThan(800);
    }
  });
});
```

- [ ] **Step 2: Run it and check that it fails.** Run: `cd packages/shared && npx vitest run src/arena/arena-03.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Extend `ArenaDef`** in `arena/types.ts`. Add:

```ts
/** A capture circle (Conquer, CQ20). A car is "in" it when its CENTRE is within `radius`. */
export interface ArenaZone {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}
```

  and inside `ArenaDef`:

```ts
  /** The capture zone. Required by any mode whose win rule is "conquer" (modes/invariants.test.ts). */
  readonly zone?: ArenaZone;
  /**
   * In a team mode, team 1's WORLD camera is rotated 180° so each team sees its own base at the
   * bottom (CQ46). Only meaningful on a layout that maps onto itself under that rotation.
   */
  readonly flipForTeamB?: boolean;
```

- [ ] **Step 4: Create `arena/arena-03.ts`** with the exact geometry from CQ37–CQ40:

```ts
import type { ArenaDef } from "./types.js";

/**
 * Conquer's arena (spec CQ37–CQ40): a tall pitch, one screen wide and three tall, the capture zone at
 * its centre and each team's base at an end. Symmetric about both centre lines, so a 180° rotation
 * maps it onto itself. That is what lets team B's view be rotated (CQ46) and still show the same map
 * with its own base at the bottom.
 *
 * No floor art: it renders procedurally, spikes and chamfer corners included (CQ49, CQ50). The
 * boundary is the frame itself with 100 u chamfers, since there is no painted wall band to inset.
 *
 * Distances: spawn row to zone edge ≈ 810 u (about 3 s for Mirage at top speed). CQ42: that
 * distance plus the 3 s `phaseMaxSeconds` ceiling is what keeps a freshly respawned (phased) car
 * from contesting the zone while untouchable. Moving these spawns toward the zone weakens that.
 */
const W = 1280;
const H = 2160;
const CHAMFER = 100;
const SPIKE_DEPTH = 20;
const SPIKE_TOP = 760;
const SPIKE_LENGTH = 640;

export const ARENA_03 = {
  id: "arena-03",
  width: W,
  height: H,
  palette: { floor: "#2b2f35", obstacle: "#4b5362", border: "#1a1d22" },
  /** Clockwise from top-left, `+y` down. */
  boundary: [
    { x: CHAMFER, y: 0 },
    { x: W - CHAMFER, y: 0 },
    { x: W, y: CHAMFER },
    { x: W, y: H - CHAMFER },
    { x: W - CHAMFER, y: H },
    { x: CHAMFER, y: H },
    { x: 0, y: H - CHAMFER },
    { x: 0, y: CHAMFER },
  ],
  zone: { x: W / 2, y: H / 2, radius: 150 },
  flipForTeamB: true,
  obstacles: [
    // B: lane pillars
    { x: 200, y: 480, w: 100, h: 100 },
    { x: 980, y: 480, w: 100, h: 100 },
    { x: 200, y: 1580, w: 100, h: 100 },
    { x: 980, y: 1580, w: 100, h: 100 },
    // C: midfield blocks, cutting the zone-to-base-exit sightline
    { x: 590, y: 660, w: 100, h: 60 },
    { x: 590, y: 1440, w: 100, h: 60 },
    // D: zone cover on the diagonals
    { x: 330, y: 850, w: 120, h: 60 },
    { x: 830, y: 850, w: 120, h: 60 },
    { x: 330, y: 1250, w: 120, h: 60 },
    { x: 830, y: 1250, w: 120, h: 60 },
    // F: side-wall spikes level with the zone
    { x: 0, y: SPIKE_TOP, w: SPIKE_DEPTH, h: SPIKE_LENGTH, kind: "spike" as const },
    { x: W - SPIKE_DEPTH, y: SPIKE_TOP, w: SPIKE_DEPTH, h: SPIKE_LENGTH, kind: "spike" as const },
  ],
  /** Unused by Conquer (a team mode); required by the type and by the ≥ MAX_PLAYERS test. */
  ffaSpawns: [
    { x: 460, y: 2040, angle: -Math.PI / 2 },
    { x: 640, y: 2040, angle: -Math.PI / 2 },
    { x: 820, y: 2040, angle: -Math.PI / 2 },
    { x: 460, y: 120, angle: Math.PI / 2 },
    { x: 640, y: 120, angle: Math.PI / 2 },
    { x: 820, y: 120, angle: Math.PI / 2 },
  ],
  /** Team A (team 0): the bottom base, facing up the map. */
  teamASpawns: [
    { x: 460, y: 2040, angle: -Math.PI / 2 },
    { x: 640, y: 2040, angle: -Math.PI / 2 },
    { x: 820, y: 2040, angle: -Math.PI / 2 },
  ],
  /** Team B (team 1): the top base, facing down the map. */
  teamBSpawns: [
    { x: 820, y: 120, angle: Math.PI / 2 },
    { x: 640, y: 120, angle: Math.PI / 2 },
    { x: 460, y: 120, angle: Math.PI / 2 },
  ],
} as const satisfies ArenaDef;
```

  Register it in `arena/registry.ts`'s `ARENAS` as `"arena-03": ARENA_03`.

- [ ] **Step 5: Generalise the team-sides test (CQ36).** In `arena/arena.test.ts`, find the case asserting team A is left of `width / 2` and team B right of it (around line 182). Replace its body with:

```ts
    const allA = arena.teamASpawns;
    const allB = arena.teamBSpawns;
    const splitX =
      allA.every((s) => s.x < arena.width / 2) && allB.every((s) => s.x > arena.width / 2);
    const splitY =
      allA.every((s) => s.y > arena.height / 2) && allB.every((s) => s.y < arena.height / 2);
    // CQ36: opposite halves along x (arena-01/02, side bases) OR along y (arena-03, end bases).
    expect(splitX || splitY).toBe(true);
```

  Retitle it to "team A and team B spawn on opposite halves (x or y axis)".

- [ ] **Step 6: Run the arena tests.** Run: `cd packages/shared && npx vitest run src/arena`. Expected: PASS, and arena-03 goes through every generic `describe.each` case: spike flush at depth 20, obstacle clearance ≥ 72.1 from the boundary, corridor width, spawns clear. If a generic case fails, the geometry is wrong. **Do not weaken the generic test.** Report the failing case instead: the spec's geometry must then be revisited.

- [ ] **Step 7: Typecheck and run the full shared suite, then commit.** Run `npx vitest run && npx tsc --noEmit -p .`, then `git commit -m "feat(shared): arena-03 and ArenaDef zone/flipForTeamB (CQ20, CQ36–CQ40)"`.

---

### Task 3: `GameMode.CONQUER`, the mode folder, and the rule functions (CQ12–CQ15, CQ17)

**Files:**
- Modify: `packages/shared/src/constants.ts` (`CONQUER = 3`)
- Create: `packages/shared/src/modes/conquer/` (copy of `modes/deathmatch/`, renamed)
- Modify: `packages/shared/src/modes/registry.ts` (row, `MODE_ORDER`, comment)
- Modify: `packages/shared/src/flow/modes.ts` (cases, the `"conquer"` rule, `respawnsIn`)
- Modify: `packages/shared/src/flow/modes.test.ts`, `modes/registry.test.ts`, `modes/mode-arg.test.ts`
- Modify: `packages/shared/src/index.ts` (export `respawnsIn`)
- Modify: `packages/server/src/config/mode-bot.ts` (+ its test if it enumerates modes)

**Interfaces:**
- Consumes: `CONQUER_CONFIG`-shaped `conquer` table (Task 1) and `"arena-03"` (Task 2).
- Produces: `GameMode.CONQUER`, `winRuleOf(mode): "last_standing" | "deathmatch" | "conquer"`, `respawnsIn(mode: GameMode): boolean`, `CONQUER_TABLES`.

- [ ] **Step 1: Write the failing tests.** Add to `flow/modes.test.ts`:

```ts
describe("Conquer (CQ14, CQ15)", () => {
  it("plays in teams under its own win rule", () => {
    expect(sidesOf(GameMode.CONQUER)).toBe("team");
    expect(winRuleOf(GameMode.CONQUER)).toBe("conquer");
  });
  it("respawnsIn is true exactly for the respawning modes", () => {
    expect(respawnsIn(GameMode.FFA_DEATHMATCH)).toBe(true);
    expect(respawnsIn(GameMode.CONQUER)).toBe(true);
    expect(respawnsIn(GameMode.FFA_LAST_STANDING)).toBe(false);
    expect(respawnsIn(GameMode.TEAM)).toBe(false);
  });
});
```

  Add to `modes/registry.test.ts` (in addition to updating the pinned expectations in Step 5):

```ts
it("Conquer is registered, unpublished, and plays arena-03 only (CQ12, CQ13)", () => {
  const def = MODE_TABLE[GameMode.CONQUER];
  expect(def.name).toBe("Conquer");
  expect(def.isActive).toBe(false);
  expect(def.config.arenas).toStrictEqual(["arena-03"]);
  expect(def.config.maxPlayers).toBe(6);
  expect(MODE_ORDER.at(-1)).toBe(GameMode.CONQUER);
});
```

- [ ] **Step 2: Run the tests and check that they fail.** Run: `cd packages/shared && npx vitest run src/flow/modes.test.ts src/modes/registry.test.ts`. Expected: FAIL (`GameMode.CONQUER` is undefined).

- [ ] **Step 3: Add the enum value.** `constants.ts`: add `CONQUER = 3,` after `FFA_DEATHMATCH = 2,`.

- [ ] **Step 4: Create the mode folder.** Run `cp -r packages/shared/src/modes/deathmatch packages/shared/src/modes/conquer`. In every file under `modes/conquer/`, rename every export `DEATHMATCH_X` to `CONQUER_X` (so `DEATHMATCH_DEATHMATCH` becomes `CONQUER_DEATHMATCH`, `DEATHMATCH_CONQUER` becomes `CONQUER_CONQUER`, and `DEATHMATCH_TABLES` becomes `CONQUER_TABLES`). Change nothing else. In `modes/conquer/index.ts`, set `arenas: ["arena-03"] as readonly ArenaId[]` and change the header comment to "Conquer mode's table bundle (CQ13). Byte-equal to Deathmatch's on day one; deliberately NOT in table-pinning.test.ts (game-mode skill §9)." In `modes/conquer/deathmatch.ts`, add this comment above `phaseMaxSeconds`:

```ts
  /**
   * CQ42: with arena-03's ~810 u spawn-to-zone distance, this ceiling is what keeps a freshly
   * respawned (phased) car from arriving at the zone still untouchable. Phased enemies DO contest
   * (CQ10), so raising this, or moving spawns toward the zone, lets a car stall a capture while
   * immune. Re-check that before tuning it.
   */
```

- [ ] **Step 5: Register the mode.** In `modes/registry.ts`, import `CONQUER_TABLES` and add the row after `FFA_DEATHMATCH`:

```ts
  [GameMode.CONQUER]: {
    id: GameMode.CONQUER,
    name: "Conquer",
    isActive: false,
    config: assembleModeConfig(GameMode.CONQUER, CONQUER_TABLES),
  },
```

  Append `GameMode.CONQUER` to `MODE_ORDER`, and update its comment to "Brawl, Team brawl, Deathmatch, Conquer". In `registry.test.ts`, update the pinned expectations: the key list becomes `["0","1","2","3"]` with names; `isGameMode(3)` becomes `true` and `isGameMode(4)` is `false`; `isActiveGameMode(3)` stays `false` (it flips in Task 13). In `modes/mode-arg.test.ts`, update the `modeOptions()` string to `"0/brawl, 1/team-brawl (inactive), 2/deathmatch, 3/conquer (inactive)"`. Match the existing format exactly; read the current assertion first.

- [ ] **Step 6: Add the rules in `flow/modes.ts`.** In `sidesOf` add `case GameMode.CONQUER: return "team";`. Change `winRuleOf`'s return type to `"last_standing" | "deathmatch" | "conquer"` and add `case GameMode.CONQUER: return "conquer";`. Then append:

```ts
/**
 * Whether a dead car comes back (CQ15). The question every "=== 'deathmatch'" check that gated
 * respawning, the phase sweep, the match clock, the no-spectate rule or the "Respawning in N" text
 * was really asking. Sites that mean "kills decide the match" keep asking `winRuleOf` instead.
 *
 * Exhaustive for the same reason `sidesOf` is, and with the same wire-byte fallback.
 */
export function respawnsIn(mode: GameMode): boolean {
  switch (mode) {
    case GameMode.FFA_DEATHMATCH:
      return true;
    case GameMode.CONQUER:
      return true;
    case GameMode.FFA_LAST_STANDING:
      return false;
    case GameMode.TEAM:
      return false;
    default: {
      const _never: never = mode;
      void _never;
      return false;
    }
  }
}
```

  Export `respawnsIn` from `packages/shared/src/index.ts` next to `sidesOf`/`winRuleOf`.

- [ ] **Step 7: Server `MODE_BOT_CONFIG`.** In `packages/server/src/config/mode-bot.ts`, add a `[GameMode.CONQUER]` entry that copies the `FFA_DEATHMATCH` entry's value, with the comment `// CQ17: no bot plays Conquer; this row exists because the table is Record<GameMode, …>.`. If `mode-bot.test.ts` pins the key set, extend it.

- [ ] **Step 8: Build and test.** Run: `npm run build -w @motor-combat-moba/shared && cd packages/shared && npx vitest run && cd ../server && npx tsc --noEmit -p . && npx vitest run src/config`. Expected: PASS. `invariants.test.ts` now runs over the Conquer row too.
  - If `tsc` fails anywhere with "not all code paths return" or a `never` error, a `switch` over `GameMode` or over `winRuleOf`'s result needs its new case. Add `"conquer"` handling that mirrors `"deathmatch"` **only** where the site means respawn/clock. Otherwise add a case that behaves like the team/last-standing path. Note every such site in the commit message.
  - If the client typecheck fails the same way, do the same there (`cd packages/client && npx tsc --noEmit -p .`).

- [ ] **Step 9: Commit.** `git commit -m "feat: GameMode.CONQUER, its mode folder, and the conquer win rule (CQ12–CQ17)"`.

---

### Task 4: Zone rules and networked zone state (CQ18–CQ22, CQ27, CQ43)

**Files:**
- Create: `packages/shared/src/flow/conquer.ts`, `packages/shared/src/flow/conquer.test.ts`
- Modify: `packages/shared/src/schema/ArenaState.ts` (six fields)
- Modify: `packages/shared/src/modes/invariants.test.ts` (zone and teamSize invariants)
- Modify: `packages/shared/src/index.ts` (exports)

**Interfaces:**
- Consumes: `ArenaZone` (Task 2), `winRuleOf`, `activeCarIds` (existing).
- Produces:

```ts
export interface ZoneState {
  readonly controlTicks: readonly [number, number];
  readonly holder: -1 | 0 | 1;
  readonly streak: number;
  readonly contested: boolean;
}
export const INITIAL_ZONE: ZoneState;
export interface ZonePresenceCar { readonly x: number; readonly y: number; readonly team: number; readonly alive: boolean; readonly inRoster: boolean }
export function zonePresence(zone: ArenaZone, cars: readonly ZonePresenceCar[]): readonly [number, number];
export function stepZone(prev: ZoneState, present: readonly [number, number], delayTicks: number, targetTicks: number): ZoneState;
export function inControl(zone: ZoneState, delayTicks: number): -1 | 0 | 1;
export type ConquerOutcome = { readonly ended: false; readonly overtime: boolean } | { readonly ended: true; readonly winnerTeam: -1 | 0 | 1 };
export function conquerOutcome(zone: ZoneState, tick: number, matchEndsTick: number, overtime: boolean, delayTicks: number, targetTicks: number): ConquerOutcome;
export function conquerLeaveOutcome(rosterCounts: readonly [number, number]): { readonly ended: false } | { readonly ended: true; readonly winnerTeam: -1 | 0 | 1 };
export function controlPercentText(controlTicks: number, targetTicks: number): string; // "42.52%"
export function captureCountdownSeconds(streak: number, delayTicks: number, hz: number): number; // 5..1, 0 once in control
```

- [ ] **Step 1: Write the failing tests** in `packages/shared/src/flow/conquer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  INITIAL_ZONE,
  captureCountdownSeconds,
  conquerLeaveOutcome,
  conquerOutcome,
  controlPercentText,
  inControl,
  stepZone,
  zonePresence,
  type ZoneState,
} from "./conquer.js";

const D = 150;
const T = 1800;
const run = (z: ZoneState, present: [number, number], n: number): ZoneState => {
  let s = z;
  for (let i = 0; i < n; i++) s = stepZone(s, present, D, T);
  return s;
};

describe("zonePresence (CQ18)", () => {
  const zone = { x: 0, y: 0, radius: 100 };
  it("counts living roster cars whose CENTRE is inside, per team", () => {
    expect(
      zonePresence(zone, [
        { x: 0, y: 100, team: 0, alive: true, inRoster: true }, // on the rim: in
        { x: 0, y: 101, team: 0, alive: true, inRoster: true }, // just out
        { x: 10, y: 0, team: 1, alive: true, inRoster: true },
        { x: 0, y: 0, team: 1, alive: false, inRoster: true }, // dead: out
        { x: 0, y: 0, team: 0, alive: true, inRoster: false }, // left the match: out
      ]),
    ).toStrictEqual([1, 1]);
  });
});

describe("stepZone (CQ19)", () => {
  it("an empty zone does nothing", () => {
    expect(run(INITIAL_ZONE, [0, 0], 500)).toStrictEqual(INITIAL_ZONE);
  });

  it("takes control on the D-th tick and fills from the next one", () => {
    const at = run(INITIAL_ZONE, [1, 0], D);
    expect(at.holder).toBe(0);
    expect(at.streak).toBe(D);
    expect(inControl(at, D)).toBe(0);
    expect(at.controlTicks).toStrictEqual([0, 0]);
    expect(stepZone(at, [1, 0], D, T).controlTicks).toStrictEqual([1, 0]);
  });

  it("saturates the streak at D", () => {
    expect(run(INITIAL_ZONE, [2, 0], D + 40).streak).toBe(D);
  });

  it("contested freezes both bars and resets the countdown; leaving restarts it from zero", () => {
    const filling = run(INITIAL_ZONE, [1, 0], D + 10);
    expect(filling.controlTicks).toStrictEqual([10, 0]);
    const contested = stepZone(filling, [1, 1], D, T);
    expect(contested).toStrictEqual({ controlTicks: [10, 0], holder: -1, streak: 0, contested: true });
    const back = run(contested, [1, 0], D);
    expect(back.controlTicks).toStrictEqual([10, 0]); // D ticks of countdown again, no fill yet
    expect(stepZone(back, [1, 0], D, T).controlTicks).toStrictEqual([11, 0]);
  });

  it("the holder dying (present -> 0) resets the streak for team B too", () => {
    const b = run(INITIAL_ZONE, [0, 1], 100);
    const gone = stepZone(b, [0, 0], D, T);
    expect(gone.holder).toBe(-1);
    expect(gone.streak).toBe(0);
    expect(gone.contested).toBe(false);
  });

  it("switching holder restarts the streak at 1", () => {
    const a = run(INITIAL_ZONE, [1, 0], 50);
    expect(stepZone(a, [0, 1], D, T)).toMatchObject({ holder: 1, streak: 1 });
  });

  it("caps the bar at the target", () => {
    const nearly: ZoneState = { controlTicks: [T - 1, 0], holder: 0, streak: D, contested: false };
    expect(run(nearly, [1, 0], 5).controlTicks).toStrictEqual([T, 0]);
  });
});

describe("conquerOutcome (CQ21)", () => {
  const z = (a: number, b: number, holder: -1 | 0 | 1 = -1, streak = 0): ZoneState => ({
    controlTicks: [a, b],
    holder,
    streak,
    contested: false,
  });

  it("a full bar wins, even on the tick the clock expires", () => {
    expect(conquerOutcome(z(T, 5), 1000, 1000, false, D, T)).toStrictEqual({ ended: true, winnerTeam: 0 });
    expect(conquerOutcome(z(5, T), 999, 1000, false, D, T)).toStrictEqual({ ended: true, winnerTeam: 1 });
  });

  it("before the clock nothing ends", () => {
    expect(conquerOutcome(z(900, 10), 999, 1000, false, D, T)).toStrictEqual({ ended: false, overtime: false });
  });

  it("at the clock the higher bar wins", () => {
    expect(conquerOutcome(z(900, 10), 1000, 1000, false, D, T)).toStrictEqual({ ended: true, winnerTeam: 0 });
    expect(conquerOutcome(z(1, 2), 1000, 1000, false, D, T)).toStrictEqual({ ended: true, winnerTeam: 1 });
  });

  it("a tie at the clock starts overtime, including 0-0", () => {
    expect(conquerOutcome(z(0, 0), 1000, 1000, false, D, T)).toStrictEqual({ ended: false, overtime: true });
    expect(conquerOutcome(z(77, 77), 1000, 1000, false, D, T)).toStrictEqual({ ended: false, overtime: true });
  });

  it("in overtime the first team in control wins; a countdown alone does not", () => {
    expect(conquerOutcome(z(0, 0, 1, D - 1), 1300, 1000, true, D, T)).toStrictEqual({ ended: false, overtime: true });
    expect(conquerOutcome(z(0, 0, 1, D), 1301, 1000, true, D, T)).toStrictEqual({ ended: true, winnerTeam: 1 });
  });

  it("a team already in control when overtime starts wins on the next evaluation", () => {
    const tied = z(40, 40, 0, D);
    expect(conquerOutcome(tied, 1000, 1000, false, D, T)).toStrictEqual({ ended: false, overtime: true });
    expect(conquerOutcome(tied, 1001, 1000, true, D, T)).toStrictEqual({ ended: true, winnerTeam: 0 });
  });

  it("matchEndsTick 0 means no clock (never ends on time)", () => {
    expect(conquerOutcome(z(1, 0), 99999, 0, false, D, T)).toStrictEqual({ ended: false, overtime: false });
  });
});

describe("conquerLeaveOutcome (CQ23)", () => {
  it("an emptied team loses; both empty is a draw; otherwise play on", () => {
    expect(conquerLeaveOutcome([0, 2])).toStrictEqual({ ended: true, winnerTeam: 1 });
    expect(conquerLeaveOutcome([1, 0])).toStrictEqual({ ended: true, winnerTeam: 0 });
    expect(conquerLeaveOutcome([0, 0])).toStrictEqual({ ended: true, winnerTeam: -1 });
    expect(conquerLeaveOutcome([2, 3])).toStrictEqual({ ended: false });
  });
});

describe("HUD text helpers (CQ3, CQ55)", () => {
  it("floors the percentage to two decimals and never shows 100% early", () => {
    expect(controlPercentText(0, T)).toBe("0.00%");
    expect(controlPercentText(765, T)).toBe("42.50%");
    expect(controlPercentText(T - 1, T)).toBe("99.94%");
    expect(controlPercentText(T, T)).toBe("100.00%");
  });
  it("counts the capture down 5..1 and reads 0 once in control", () => {
    expect(captureCountdownSeconds(1, D, 30)).toBe(5);
    expect(captureCountdownSeconds(120, D, 30)).toBe(1);
    expect(captureCountdownSeconds(D, D, 30)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and check that they fail.** Run: `cd packages/shared && npx vitest run src/flow/conquer.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/shared/src/flow/conquer.ts`:**

```ts
import type { ArenaZone } from "../arena/types.js";

/**
 * Conquer's zone rules (spec CQ18–CQ23), pure and tick-counted. The room calls these; nothing here
 * reads config, so the caller passes `derived().conquerTicks` values in.
 */
export interface ZoneState {
  readonly controlTicks: readonly [number, number];
  /** The team whose uninterrupted, unopposed streak is running, or -1. */
  readonly holder: -1 | 0 | 1;
  /** Consecutive holder ticks, saturating at the capture delay. */
  readonly streak: number;
  /** Both teams present this tick. */
  readonly contested: boolean;
}

export const INITIAL_ZONE: ZoneState = Object.freeze({
  controlTicks: Object.freeze([0, 0] as const),
  holder: -1,
  streak: 0,
  contested: false,
}) as ZoneState;

export interface ZonePresenceCar {
  readonly x: number;
  readonly y: number;
  readonly team: number;
  readonly alive: boolean;
  readonly inRoster: boolean;
}

/** Per-team count of living roster cars whose centre is inside the zone. Phased cars count (CQ10). */
export function zonePresence(zone: ArenaZone, cars: readonly ZonePresenceCar[]): readonly [number, number] {
  const r2 = zone.radius * zone.radius;
  let a = 0;
  let b = 0;
  for (const car of cars) {
    if (!car.alive || !car.inRoster) continue;
    const dx = car.x - zone.x;
    const dy = car.y - zone.y;
    if (dx * dx + dy * dy > r2) continue;
    if (car.team === 1) b += 1;
    else a += 1;
  }
  return [a, b];
}

/** CQ19. A streak broken for one tick restarts the countdown from zero. */
export function stepZone(
  prev: ZoneState,
  present: readonly [number, number],
  delayTicks: number,
  targetTicks: number,
): ZoneState {
  const [a, b] = present;
  if ((a > 0) === (b > 0)) {
    return { controlTicks: prev.controlTicks, holder: -1, streak: 0, contested: a > 0 && b > 0 };
  }
  const holder: 0 | 1 = a > 0 ? 0 : 1;
  const continuing = prev.holder === holder;
  const streak = continuing ? Math.min(prev.streak + 1, delayTicks) : 1;
  let controlTicks = prev.controlTicks;
  if (continuing && prev.streak >= delayTicks) {
    const next: [number, number] = [controlTicks[0], controlTicks[1]];
    next[holder] = Math.min(next[holder] + 1, targetTicks);
    controlTicks = next;
  }
  return { controlTicks, holder, streak, contested: false };
}

/** The team that has taken control, or -1. */
export function inControl(zone: ZoneState, delayTicks: number): -1 | 0 | 1 {
  return zone.holder >= 0 && zone.streak >= delayTicks ? zone.holder : -1;
}

export type ConquerOutcome =
  | { readonly ended: false; readonly overtime: boolean }
  | { readonly ended: true; readonly winnerTeam: -1 | 0 | 1 };

/**
 * CQ21, evaluated after `stepZone` on the same tick: full bar, then the clock, then overtime.
 * `matchEndsTick <= 0` means no clock, matching `deathmatchEnded`.
 */
export function conquerOutcome(
  zone: ZoneState,
  tick: number,
  matchEndsTick: number,
  overtime: boolean,
  delayTicks: number,
  targetTicks: number,
): ConquerOutcome {
  const [a, b] = zone.controlTicks;
  if (a >= targetTicks) return { ended: true, winnerTeam: 0 };
  if (b >= targetTicks) return { ended: true, winnerTeam: 1 };
  if (!overtime) {
    if (matchEndsTick <= 0 || tick < matchEndsTick) return { ended: false, overtime: false };
    if (a !== b) return { ended: true, winnerTeam: a > b ? 0 : 1 };
    return { ended: false, overtime: true };
  }
  const controller = inControl(zone, delayTicks);
  if (controller >= 0) return { ended: true, winnerTeam: controller };
  return { ended: false, overtime: true };
}

/** CQ23: a team with nobody left loses; nobody left at all is a draw. */
export function conquerLeaveOutcome(
  rosterCounts: readonly [number, number],
): { readonly ended: false } | { readonly ended: true; readonly winnerTeam: -1 | 0 | 1 } {
  const [a, b] = rosterCounts;
  if (a === 0 && b === 0) return { ended: true, winnerTeam: -1 };
  if (a === 0) return { ended: true, winnerTeam: 1 };
  if (b === 0) return { ended: true, winnerTeam: 0 };
  return { ended: false };
}

/** CQ3: floored to two decimals, so a bar never reads 100.00% before it is full. */
export function controlPercentText(controlTicks: number, targetTicks: number): string {
  if (targetTicks <= 0) return "0.00%";
  const hundredths = Math.floor((controlTicks * 10000) / targetTicks);
  return `${(hundredths / 100).toFixed(2)}%`;
}

/** CQ55: whole seconds left on a capture countdown (5..1), 0 once in control. */
export function captureCountdownSeconds(streak: number, delayTicks: number, hz: number): number {
  const left = delayTicks - streak;
  return left <= 0 ? 0 : Math.ceil(left / hz);
}
```

  Export everything above from `packages/shared/src/index.ts`, following the existing `flow/win.js` export line.

- [ ] **Step 4: Add the networked fields (CQ43)** to `schema/ArenaState.ts`, after `winnerSessionId`, in the same decorator style as the file:

```ts
  /** Conquer (CQ43): accumulated fill ticks per team. Written by the room only; not read by stepSim. */
  @type("uint16") controlTicksA = 0;
  @type("uint16") controlTicksB = 0;
  /** Conquer: the team whose capture streak is running, or -1. */
  @type("int8") zoneHolder = -1;
  /** Conquer: that streak, saturating at the capture delay. */
  @type("uint16") zoneStreakTicks = 0;
  @type("boolean") zoneContested = false;
  @type("boolean") overtime = false;
```

  If the file has a schema-field test that enumerates fields (grep `ArenaState` in `schema/*.test.ts`), extend it.

- [ ] **Step 5: Add the invariants (CQ20, CQ27)** in `modes/invariants.test.ts`, inside the per-mode loop (`for (const def of Object.values(MODE_TABLE))`, or however the file iterates):

```ts
    it(`${def.name}: a conquer-rule mode plays only arenas that have a zone (CQ20)`, () => {
      if (winRuleOf(def.id) !== "conquer") return;
      for (const arenaId of def.config.arenas) {
        expect(getArena(arenaId).zone, `${def.name} lists ${arenaId}, which has no zone`).toBeDefined();
      }
    });

    it(`${def.name}: a conquer-rule mode's teamSize fits its active roster (CQ27)`, () => {
      if (winRuleOf(def.id) !== "conquer") return;
      withMode(def.config, () => {
        expect(def.config.conquer.teamSize).toBeLessThanOrEqual(activeCarIds().length);
        expect(def.config.conquer.teamSize * 2).toBeLessThanOrEqual(def.config.maxPlayers);
      });
    });
```

  Import `winRuleOf`, `getArena`, `activeCarIds` and `withMode` from their modules (grep for their paths). Match the file's existing naming and style.

- [ ] **Step 6: Run and commit.** `cd packages/shared && npx vitest run && npx tsc --noEmit -p .`, all passing. Then `git commit -m "feat(shared): conquer zone rules and networked zone state (CQ18–CQ23, CQ43)"`.

---

### Task 5: Team threading in shared, the start rule, and chassis claims (CQ16, CQ28–CQ31, CQ34, CQ35)

**Files:**
- Modify: `packages/shared/src/flow/spawns.ts` (`sidesOf`), `flow/spawns.test.ts`
- Modify: `packages/shared/src/flow/respawn.ts` (`respawnPointFor`), `flow/respawn.test.ts`
- Modify: `packages/shared/src/lobby/start-rules.ts`, `lobby/start-rules.test.ts`
- Create: `packages/shared/src/lobby/car-claims.ts`, `lobby/car-claims.test.ts`
- Modify: `packages/shared/src/schema/PlayerState.ts` (`lockedCarId`)
- Modify: `packages/shared/src/index.ts` (exports)

**Interfaces:**
- Consumes: `GameMode.CONQUER`, `sidesOf`, `winRuleOf`, `modeConfigOf` (existing), `farthestSpawn` (existing).
- Produces:

```ts
// flow/respawn.ts
export function respawnPointFor(
  arena: ArenaDef, sides: "ffa" | "team", team: number,
  others: readonly { x: number; y: number; team: number }[],
): Spawn;
// lobby/car-claims.ts
export function uniqueChassisApplies(mode: GameMode): boolean;
export function chassisTakenByTeammate(
  carId: string, team: number, selfId: string,
  players: readonly { sessionId: string; team: number; lockedCarId: string }[],
): boolean;
export function pickDeadlineCar(
  previewed: CarId | undefined, team: number, selfId: string,
  players: readonly { sessionId: string; team: number; lockedCarId: string }[],
  activeIds: readonly CarId[], fallback: CarId,
): CarId;
// PlayerState
lockedCarId: string // "" = none
```

- [ ] **Step 1: Write the failing tests.**

  `lobby/start-rules.test.ts`, appended:

```ts
describe("canStart, Conquer (CQ28)", () => {
  const p = (team: number, status: "ready" | "in_match" | "post_match" = "ready") => ({ team, status });
  it("needs exactly teamSize ready players per team", () => {
    expect(canStart(GameMode.CONQUER, [p(0), p(0), p(0), p(1), p(1), p(1)])).toStrictEqual({ ok: true });
    for (const lobby of [
      [p(0), p(1)],
      [p(0), p(0), p(1), p(1)],
      [p(0), p(0), p(0), p(1), p(1)],
      [p(0), p(0), p(0), p(0), p(1), p(1)],
    ]) {
      expect(canStart(GameMode.CONQUER, lobby)).toStrictEqual({
        ok: false,
        error: "Conquer needs exactly 3 ready players per team",
      });
    }
  });
  it("ignores players who are not ready", () => {
    expect(
      canStart(GameMode.CONQUER, [p(0), p(0), p(0), p(1), p(1), p(1), p(1, "post_match")]),
    ).toStrictEqual({ ok: true });
  });
  it("leaves Team brawl's 1v1 start alone", () => {
    expect(canStart(GameMode.TEAM, [p(0), p(1)])).toStrictEqual({ ok: true });
  });
});
```

  `lobby/car-claims.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { chassisTakenByTeammate, pickDeadlineCar, uniqueChassisApplies } from "./car-claims.js";

const players = [
  { sessionId: "a1", team: 0, lockedCarId: "mirage" },
  { sessionId: "a2", team: 0, lockedCarId: "" },
  { sessionId: "b1", team: 1, lockedCarId: "bastion" },
];

describe("uniqueChassisApplies (CQ26, CQ29)", () => {
  it("is on for Conquer only", () => {
    expect(uniqueChassisApplies(GameMode.CONQUER)).toBe(true);
    expect(uniqueChassisApplies(GameMode.TEAM)).toBe(false);
    expect(uniqueChassisApplies(GameMode.FFA_DEATHMATCH)).toBe(false);
    expect(uniqueChassisApplies(GameMode.FFA_LAST_STANDING)).toBe(false);
  });
});

describe("chassisTakenByTeammate (CQ30)", () => {
  it("sees teammates' locks only, never your own and never the enemy's", () => {
    expect(chassisTakenByTeammate("mirage", 0, "a2", players)).toBe(true);
    expect(chassisTakenByTeammate("mirage", 0, "a1", players)).toBe(false);
    expect(chassisTakenByTeammate("bastion", 0, "a2", players)).toBe(false);
    expect(chassisTakenByTeammate("mirage", 1, "b1", players)).toBe(false);
  });
});

describe("pickDeadlineCar (CQ31)", () => {
  const active = ["bullseye", "mirage", "bastion"] as const;
  it("keeps an untaken preview", () => {
    expect(pickDeadlineCar("bastion", 0, "a2", players, active, "bullseye")).toBe("bastion");
  });
  it("replaces a preview a teammate has taken with the first untaken chassis", () => {
    expect(pickDeadlineCar("mirage", 0, "a2", players, active, "bullseye")).toBe("bullseye");
  });
  it("replaces no preview with the first untaken chassis, skipping a taken fallback", () => {
    const taken = [...players, { sessionId: "a3", team: 0, lockedCarId: "bullseye" }];
    expect(pickDeadlineCar(undefined, 0, "a2", taken, active, "bullseye")).toBe("bastion");
  });
});
```

  `flow/respawn.test.ts`, appended:

```ts
describe("respawnPointFor (CQ35)", () => {
  const arena = {
    ffaSpawns: [{ x: 0, y: 0, angle: 0 }, { x: 1000, y: 0, angle: 0 }],
    teamASpawns: [{ x: 0, y: 900, angle: 0 }, { x: 500, y: 900, angle: 0 }],
    teamBSpawns: [{ x: 0, y: 100, angle: 0 }, { x: 500, y: 100, angle: 0 }],
  } as unknown as ArenaDef;
  it("team mode: own team's list, threatened only by the OTHER team", () => {
    const others = [
      { x: 0, y: 880, team: 0 }, // a teammate on spawn 0: not a threat
      { x: 480, y: 500, team: 1 }, // enemy nearer spawn 1
    ];
    expect(respawnPointFor(arena, "team", 0, others)).toBe(arena.teamASpawns[0]);
    expect(respawnPointFor(arena, "team", 1, [])).toBe(arena.teamBSpawns[0]);
  });
  it("ffa: everyone is a threat, ffaSpawns as before", () => {
    expect(respawnPointFor(arena, "ffa", 0, [{ x: 0, y: 0, team: 0 }])).toBe(arena.ffaSpawns[1]);
  });
});
```

  `flow/spawns.test.ts`: add a case where `assignSpawns(ARENA_03, GameMode.CONQUER, [{sessionId:"a",team:0},{sessionId:"b",team:1}], () => 0)` gives `a` a spawn from `ARENA_03.teamASpawns` and `b` one from `teamBSpawns`.

- [ ] **Step 2: Run the tests and check that they fail.** `cd packages/shared && npx vitest run src/lobby src/flow/respawn.test.ts src/flow/spawns.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

  `flow/spawns.ts`: replace `if (mode === GameMode.TEAM)` with `if (sidesOf(mode) === "team")` (import `sidesOf` from `./modes.js`, and drop the unused `GameMode` value import if tsc flags it).

  `flow/respawn.ts`, appended:

```ts
/**
 * Where a respawning car appears (CQ35). Team modes respawn at the car's OWN base, the spawn
 * farthest from the nearest living ENEMY; teammates are not threats. FFA is unchanged: every other
 * living car is an enemy and `ffaSpawns` is the list.
 */
export function respawnPointFor(
  arena: ArenaDef,
  sides: "ffa" | "team",
  team: number,
  others: readonly { x: number; y: number; team: number }[],
): Spawn {
  if (sides === "team") {
    const own = team === 1 ? arena.teamBSpawns : arena.teamASpawns;
    return farthestSpawn(own, others.filter((o) => o.team !== team));
  }
  return farthestSpawn(arena.ffaSpawns, others);
}
```

  (Import `type ArenaDef`.)

  `lobby/start-rules.ts`: import `sidesOf, winRuleOf` from `../flow/modes.js` and `modeConfigOf` from `../modes/registry.js`. Replace `if (mode !== GameMode.TEAM)` with `if (sidesOf(mode) !== "team")`. After the team counts are computed, and before the existing `team0 === 0 || team1 === 0` check, insert:

```ts
  if (winRuleOf(mode) === "conquer") {
    // `modeConfigOf`, not the `conquer()` accessor: this runs in the lobby with no mode guaranteed in
    // scope, and the rule belongs to the mode being started (CQ28).
    const size = modeConfigOf(mode).conquer.teamSize;
    if (team0 !== size || team1 !== size) {
      return { ok: false, error: `Conquer needs exactly ${size} ready players per team` };
    }
    return { ok: true };
  }
```

  (If importing `modes/registry.js` from `lobby/` creates an import cycle that tsc or vitest reports, pass `teamSize` in instead: `canStart(mode, players, teamSize = 0)`. Have the server pass `modeConfigOf(mode).conquer.teamSize` and adjust the tests. Choose the direct import first.)

  `lobby/car-claims.ts`:

```ts
import type { GameMode } from "../constants.js";
import type { CarId } from "../config/types.js";
import { winRuleOf } from "../flow/modes.js";
import { modeConfigOf } from "../modes/registry.js";

type Claimant = { readonly sessionId: string; readonly team: number; readonly lockedCarId: string };

/** Whether a team may not field two of one chassis in this mode (CQ4, CQ26). */
export function uniqueChassisApplies(mode: GameMode): boolean {
  return winRuleOf(mode) === "conquer" && modeConfigOf(mode).conquer.uniqueChassisPerTeam;
}

/** A TEAMMATE (never yourself, never the enemy) has already locked this chassis (CQ30). */
export function chassisTakenByTeammate(
  carId: string,
  team: number,
  selfId: string,
  players: readonly Claimant[],
): boolean {
  return players.some((p) => p.sessionId !== selfId && p.team === team && p.lockedCarId === carId);
}

/**
 * The car-select deadline's pick for a player who never locked (CQ31): the preview if no teammate
 * has it, else the fallback if free, else the first free active chassis. `teamSize <= active
 * roster` (CQ27) guarantees one is free.
 */
export function pickDeadlineCar(
  previewed: CarId | undefined,
  team: number,
  selfId: string,
  players: readonly Claimant[],
  activeIds: readonly CarId[],
  fallback: CarId,
): CarId {
  const free = (id: CarId) => !chassisTakenByTeammate(id, team, selfId, players);
  if (previewed !== undefined && free(previewed)) return previewed;
  if (free(fallback)) return fallback;
  return activeIds.find(free) ?? fallback;
}
```

  `schema/PlayerState.ts`, next to `selectLocked`:

```ts
  /**
   * The chassis this player LOCKED this car select, "" otherwise (CQ29). Written only in a mode where
   * `uniqueChassisApplies`, so teammates can grey out taken cards; other modes keep a blind pick.
   * Not read by stepSim.
   */
  @type("string") lockedCarId = "";
```

  Export `respawnPointFor`, `uniqueChassisApplies`, `chassisTakenByTeammate` and `pickDeadlineCar` from `index.ts`.

- [ ] **Step 4: Run, typecheck, build and commit.** Run `cd packages/shared && npx vitest run && npx tsc --noEmit -p . && cd ../.. && npm run build -w @motor-combat-moba/shared`. Expected: PASS. Then `git commit -m "feat(shared): team spawns/respawns for team modes, Conquer start rule, chassis claims (CQ16, CQ28–CQ35)"`.

---

### Task 6: Room wiring (CQ15, CQ21–CQ24, CQ29–CQ31, CQ35, CQ43, CQ44)

**Files:**
- Modify: `packages/server/src/rooms/tick-pipeline.ts` (`respawnPlayer`)
- Modify: `packages/server/src/rooms/ArenaRoom.ts`
- Modify: `packages/server/src/rooms/match-helpers.ts`, `match-helpers.test.ts`
- Test: `packages/server/src/rooms/conquer-room.test.ts` (new)
- Create: `packages/server/src/rooms/conquer-room.ts` (thin, testable room helpers)

**Interfaces:**
- Consumes: everything from Tasks 3–5.
- Produces (`conquer-room.ts`):

```ts
export interface ZoneFields { controlTicksA: number; controlTicksB: number; zoneHolder: number; zoneStreakTicks: number; zoneContested: boolean; overtime: boolean }
export function readZone(f: ZoneFields): ZoneState;
export function writeZone(f: ZoneFields, z: ZoneState): void;
export function resetZone(f: ZoneFields): void;
/** One Conquer tick: step the zone from the roster, write it, and say whether the match ended. */
export function advanceConquer(
  f: ZoneFields & { tick: number; matchEndsTick: number },
  zone: ArenaZone,
  cars: readonly ZonePresenceCar[],
  delayTicks: number, targetTicks: number,
): { ended: false } | { ended: true; winnerTeam: -1 | 0 | 1 };
```

  `ArenaState` satisfies `ZoneFields & { tick; matchEndsTick }` structurally. Nothing in the repo instantiates `ArenaRoom`, which is why the logic goes here.

- [ ] **Step 1: Write the failing test** `packages/server/src/rooms/conquer-room.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { advanceConquer, readZone, resetZone } from "./conquer-room.js";

const fields = () => ({
  controlTicksA: 0, controlTicksB: 0, zoneHolder: -1, zoneStreakTicks: 0,
  zoneContested: false, overtime: false, tick: 0, matchEndsTick: 10_000,
});
const zone = { x: 0, y: 0, radius: 50 };
const inA = { x: 0, y: 0, team: 0, alive: true, inRoster: true };
const inB = { x: 1, y: 1, team: 1, alive: true, inRoster: true };

describe("advanceConquer (CQ44)", () => {
  it("writes the stepped zone back and fills after the delay", () => {
    const f = fields();
    for (let i = 0; i < 4; i++) {
      f.tick += 1;
      expect(advanceConquer(f, zone, [inA], 3, 100)).toStrictEqual({ ended: false });
    }
    expect(readZone(f)).toStrictEqual({ controlTicks: [1, 0], holder: 0, streak: 3, contested: false });
    advanceConquer(f, zone, [inA, inB], 3, 100);
    expect([f.zoneHolder, f.zoneStreakTicks, f.zoneContested]).toStrictEqual([-1, 0, true]);
  });

  it("ends on a full bar and sets overtime on a tie at the clock", () => {
    const f = { ...fields(), controlTicksA: 99, zoneHolder: 0, zoneStreakTicks: 3 };
    expect(advanceConquer(f, zone, [inA], 3, 100)).toStrictEqual({ ended: true, winnerTeam: 0 });
    const g = { ...fields(), tick: 10_000 };
    expect(advanceConquer(g, zone, [], 3, 100)).toStrictEqual({ ended: false });
    expect(g.overtime).toBe(true);
  });

  it("resetZone zeroes everything", () => {
    const f = { ...fields(), controlTicksA: 5, zoneHolder: 1, zoneStreakTicks: 2, zoneContested: true, overtime: true };
    resetZone(f);
    expect(f).toMatchObject({ controlTicksA: 0, controlTicksB: 0, zoneHolder: -1, zoneStreakTicks: 0, zoneContested: false, overtime: false });
  });
});
```

  In `match-helpers.test.ts`, add: `resolveSetMode(RoomPhase.LOBBY, false, GameMode.CONQUER)` returns `undefined` while Conquer is inactive. (Task 13 flips this to `{ mode: CONQUER, arenaId: "arena-03" }`.)

- [ ] **Step 2: Run the tests and check that they fail.** `cd packages/server && npx vitest run src/rooms/conquer-room.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `conquer-room.ts`:**

```ts
import {
  conquerOutcome, stepZone, zonePresence,
  type ArenaZone, type ZonePresenceCar, type ZoneState,
} from "@motor-combat-moba/shared";

export interface ZoneFields {
  controlTicksA: number;
  controlTicksB: number;
  zoneHolder: number;
  zoneStreakTicks: number;
  zoneContested: boolean;
  overtime: boolean;
}

export function readZone(f: ZoneFields): ZoneState {
  const holder = f.zoneHolder === 0 || f.zoneHolder === 1 ? f.zoneHolder : -1;
  return {
    controlTicks: [f.controlTicksA, f.controlTicksB],
    holder,
    streak: f.zoneStreakTicks,
    contested: f.zoneContested,
  };
}

export function writeZone(f: ZoneFields, z: ZoneState): void {
  f.controlTicksA = z.controlTicks[0];
  f.controlTicksB = z.controlTicks[1];
  f.zoneHolder = z.holder;
  f.zoneStreakTicks = z.streak;
  f.zoneContested = z.contested;
}

/** CQ43: on the edge into MATCH. */
export function resetZone(f: ZoneFields): void {
  f.controlTicksA = 0;
  f.controlTicksB = 0;
  f.zoneHolder = -1;
  f.zoneStreakTicks = 0;
  f.zoneContested = false;
  f.overtime = false;
}

export function advanceConquer(
  f: ZoneFields & { tick: number; matchEndsTick: number },
  zone: ArenaZone,
  cars: readonly ZonePresenceCar[],
  delayTicks: number,
  targetTicks: number,
): { ended: false } | { ended: true; winnerTeam: -1 | 0 | 1 } {
  const next = stepZone(readZone(f), zonePresence(zone, cars), delayTicks, targetTicks);
  writeZone(f, next);
  const outcome = conquerOutcome(next, f.tick, f.matchEndsTick, f.overtime, delayTicks, targetTicks);
  if (outcome.ended) return outcome;
  f.overtime = outcome.overtime;
  return { ended: false };
}
```

- [ ] **Step 4: Wire `ArenaRoom.ts`.** Import `respawnsIn`, `uniqueChassisApplies`, `chassisTakenByTeammate`, `pickDeadlineCar`, `conquerLeaveOutcome`, `activeCarIds`, `DEFAULT_CAR_ID` (check the existing imports), `conquer`, and the helpers from `./conquer-room.js`. Then make these edits (line numbers are from the pre-change file):
  1. `tick()`, around :420: replace `winRuleOf(this.state.mode) === "deathmatch"` in the respawn gate with `respawnsIn(this.state.mode)`.
  2. `ctx()`, around :491: `runPhaseSweep: respawnsIn(this.state.mode),`.
  3. `applyFlow`, around :553: `this.state.matchEndsTick = respawnsIn(this.state.mode) ? this.state.tick + derived().deathmatchTicks.match : 0;`, and inside the same `if` add `resetZone(this.state);`. Update the adjacent comment from "0 in every other mode" to "0 in every mode without respawns".
  4. `tick()` win check, around :458: before the deathmatch branch, add:

```ts
    if (winRuleOf(this.state.mode) === "conquer") {
      this.conquerTick();
      return;
    }
```

     and add the method:

```ts
  /** CQ44: one zone step on the state combat just wrote, then the end check. */
  private conquerTick(): void {
    const zone = getArena(this.state.arenaId).zone;
    if (!zone) return; // unreachable: invariants.test.ts holds every conquer arena to a zone
    const cars: ZonePresenceCar[] = [];
    this.state.players.forEach((p) => {
      cars.push({ x: p.x, y: p.y, team: p.team, alive: p.alive, inRoster: this.matchRoster.has(p.sessionId) });
    });
    const ticks = derived().conquerTicks;
    const result = advanceConquer(this.state, zone, cars, ticks.captureDelay, ticks.controlTarget);
    if (result.ended) this.endMatch("", result.winnerTeam);
  }
```

  5. `onLeave`, around :395: before the deathmatch branch, add:

```ts
      if (winRuleOf(this.state.mode) === "conquer") {
        const counts: [number, number] = [0, 0];
        for (const id of this.matchRoster) {
          const p = this.state.players.get(id);
          if (p) counts[p.team === 1 ? 1 : 0] += 1;
        }
        const left = conquerLeaveOutcome(counts);
        if (left.ended) this.endMatch("", left.winnerTeam);
        return;
      }
```

     (Confirm by reading `onLeave` that the leaver has already been removed from `this.matchRoster` and `state.players` at this point. If it has not, exclude `client.sessionId` explicitly.)
  6. `MSG_START_MATCH`: after `this.pendingCarId.clear();`, add `this.state.players.forEach((p) => { p.lockedCarId = ""; });` (CQ29).
  7. `MSG_SELECT_CAR`: after the `selectLocked` guard, add:

```ts
          if (uniqueChassisApplies(this.state.mode)) {
            if (chassisTakenByTeammate(msg.carId, player.team, client.sessionId, this.claimants())) return;
            player.lockedCarId = msg.carId;
          }
```

     and add the helper:

```ts
  private claimants(): { sessionId: string; team: number; lockedCarId: string }[] {
    const out: { sessionId: string; team: number; lockedCarId: string }[] = [];
    for (const id of this.matchRoster) {
      const p = this.state.players.get(id);
      if (p) out.push({ sessionId: id, team: p.team, lockedCarId: p.lockedCarId });
    }
    return out;
  }
```

  8. The car-select deadline loop in `tick()`: replace `this.pendingCarId.set(id, carAtDeadline(this.pendingCarId.get(id)));` with:

```ts
        const carId = uniqueChassisApplies(this.state.mode)
          ? pickDeadlineCar(this.pendingCarId.get(id), player.team, id, this.claimants(), activeCarIds(), carAtDeadline(undefined))
          : carAtDeadline(this.pendingCarId.get(id));
        this.pendingCarId.set(id, carId);
        if (uniqueChassisApplies(this.state.mode)) player.lockedCarId = carId;
```

     Because `lockedCarId` is written before the next iteration, each deadline pick sees the ones before it.

- [ ] **Step 5: Wire `respawnPlayer`** in `tick-pipeline.ts`. Replace the enemies loop and the `farthestSpawn` line with:

```ts
  const others: { x: number; y: number; team: number }[] = [];
  for (const id of ctx.matchRoster) {
    if (id === player.sessionId) continue;
    const other = ctx.state.players.get(id);
    if (other?.alive) others.push({ x: other.x, y: other.y, team: other.team });
  }

  const spawn = respawnPointFor(getArena(ctx.state.arenaId), sidesOf(ctx.state.mode), player.team, others);
```

  Import `respawnPointFor` and `sidesOf`, and drop `farthestSpawn` if it is now unused. Deathmatch behaviour is identical: FFA passes every other living car.

- [ ] **Step 6: Grep for any remaining respawn-meaning `"deathmatch"` checks** in `packages/server/src`: `grep -rn '=== "deathmatch"' packages/server/src`. Each remaining hit should mean "kills decide the match" (`checkDeathmatchEnd`, reports). Leave those alone. The Practice and Playground rooms pin Deathmatch and are unaffected.

- [ ] **Step 7: Typecheck and test.** Run `npm run build -w @motor-combat-moba/shared && cd packages/server && npx tsc --noEmit -p . && npx vitest run`. Expected: everything passes except the 2 baseline G12 failures.

- [ ] **Step 8: Commit.** `git commit -m "feat(server): Conquer room wiring — zone tick, team respawns, chassis claims (CQ15, CQ21–CQ44)"`.

---

### Task 7: Balance refuses Conquer (CQ59)

**Files:**
- Modify: `packages/server/balance/cli.ts`, `packages/server/balance/cli.test.ts`

- [ ] **Step 1: Write the failing test.** In `cli.test.ts`, find the hard-coded mode loop (around :156). Add Conquer to the loop as a refusal case, following how that file asserts a refused parse: read the file's existing refusal tests and use the same helper and shape. The refusal message must contain `"Conquer"` and `"objective"`, e.g. `Conquer is an objective mode; balance bots cannot play it.`.
- [ ] **Step 2: Run the test and check that it fails.** `cd packages/server && npx vitest run balance/cli.test.ts`.
- [ ] **Step 3: Implement.** Where `cli.ts` resolves `--mode` (around :67–:77), refuse when `winRuleOf(mode) === "conquer"`, the same way it refuses an unknown mode. Name the mode through `MODE_TABLE[mode].name`, not a literal.
- [ ] **Step 4: Run the test (PASS) and commit.** `git commit -m "feat(balance): refuse Conquer — bots cannot play an objective mode (CQ59)"`.

---

### Task 8: Client team and respawn threading (CQ15, CQ16, CQ53)

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts` (:2404 allegiance collapse, :4365 respawn text gate)
- Modify: `packages/client/src/scenes/spectate.ts` (:32)
- Modify: `packages/client/src/ui/lobby-view.ts` (:162), `ui/reveal-view.ts` (:80)
- Tests: the existing `spectate.test.ts`, `lobby-view.test.ts` and `reveal-view.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests.**
  - `lobby-view.test.ts`: a view state with `mode: GameMode.CONQUER` has `showTeamHeadings === true` (use the field name the file uses) and shows team counts.
  - `reveal-view.test.ts`: a Conquer reveal splits players by `team`, titled "Team A"/"Team B".
  - `spectate.test.ts`: the no-spectate rule holds for `GameMode.CONQUER` exactly as it does for Deathmatch. Mirror the existing Deathmatch case, or create the test file with one case if it does not exist.

  Read each file's existing TEAM or Deathmatch case and copy its shape with the mode swapped.
- [ ] **Step 2: Run the tests and check that they fail.** `cd packages/client && npx vitest run src/ui src/scenes/spectate.test.ts`.
- [ ] **Step 3: Implement.**
  - `lobby-view.ts` and `reveal-view.ts`: `const isTeam = sidesOf(mode) === "team";`.
  - `spectate.ts:32`: use `respawnsIn(mode)` where it tests the deathmatch win rule.
  - `ArenaScene.ts:2404`: replace `room.state.mode === GameMode.TEAM ? "team" : "ffa"` with `sidesOf(room.state.mode)`.
  - `ArenaScene.ts:4365`: the "Respawning in N" gate becomes `respawnsIn(mode)`.
  - Leave the kills column (:3592) on `winRuleOf === "deathmatch"`.

  Import `sidesOf` and `respawnsIn` from `@motor-combat-moba/shared`.
- [ ] **Step 4: Run the client suite and typecheck (PASS), then commit.** `git commit -m "feat(client): thread team sides and respawns through Conquer (CQ15, CQ16, CQ53)"`.

---

### Task 9: Team B's rotated view (CQ46–CQ48)

**Files:**
- Create: `packages/client/src/scenes/view-rotation.ts`, `view-rotation.test.ts`
- Modify: `packages/client/src/scenes/countdown-arrow.ts` (+ test), `scenes/car-lighting.ts` (+ test if one exists), `input/aim-offset.ts` (+ test), `scenes/ArenaScene.ts`

**Interfaces:**
- Produces: `viewRotationFor(arena: Pick<ArenaDef, "flipForTeamB">, sides: "ffa" | "team", team: number): 0 | typeof Math.PI`; `countdownArrowPoints(x, y, bobOffset, viewRotation = 0)`; `cssDeltaToWorld(..., viewRotation = 0)` and `projectToScreen(..., viewRotation = 0)`. Keep their existing parameters, append the new one, and default it to 0 so every existing caller is unchanged.

- [ ] **Step 1: Write the failing tests.**

  `view-rotation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { viewRotationFor } from "./view-rotation.js";

describe("viewRotationFor (CQ46)", () => {
  it("rotates team B only, only in a team mode, only on a flip arena", () => {
    expect(viewRotationFor({ flipForTeamB: true }, "team", 1)).toBe(Math.PI);
    expect(viewRotationFor({ flipForTeamB: true }, "team", 0)).toBe(0);
    expect(viewRotationFor({ flipForTeamB: true }, "ffa", 1)).toBe(0);
    expect(viewRotationFor({}, "team", 1)).toBe(0);
  });
});
```

  `countdown-arrow.test.ts`, added:

```ts
it("under a 180° view sits BELOW in world space (above on screen), apex toward the car (CQ47)", () => {
  const up = countdownArrowPoints(100, 500, 0);
  const flipped = countdownArrowPoints(100, 500, 0, Math.PI);
  // Mirror of the unrotated arrow through the car centre.
  expect(flipped.map((p) => ({ x: 200 - p.x, y: 1000 - p.y }))).toEqual(
    expect.arrayContaining(up.map((p) => expect.objectContaining({ x: expect.closeTo(p.x, 6), y: expect.closeTo(p.y, 6) }))),
  );
  const apex = flipped[2]!;
  expect(apex.y).toBeGreaterThan(500); // below the car in world = above it on team B's screen
});
```

  For `aim-offset.test.ts`, add one case each for `cssDeltaToWorld` and `projectToScreen` at `viewRotation = Math.PI`: a screen delta of (+10, +5) maps to world (−10, −5) at zoom 1, and `projectToScreen` of a world point 100 u to the right of the camera centre lands 100 px to the LEFT of the viewport centre. Read the file first to match its argument order.

  For `car-lighting`, if the file exports a pure function taking the light angle, add a test that the effective angle is `lightAngle + viewRotation`. If it has no pure seam, skip the test and do the change in Step 3 at the call site.
- [ ] **Step 2: Run the tests and check that they fail.**
- [ ] **Step 3: Implement.**
  - `view-rotation.ts`:

```ts
import type { ArenaDef } from "@motor-combat-moba/shared";

/**
 * The world camera's rotation for the local player (CQ46): team B is turned 180° on an arena that
 * asks for it, so each team sees its own base at the bottom. The HUD camera never rotates.
 */
export function viewRotationFor(
  arena: Pick<ArenaDef, "flipForTeamB">,
  sides: "ffa" | "team",
  team: number,
): number {
  return arena.flipForTeamB === true && sides === "team" && team === 1 ? Math.PI : 0;
}
```

  - `countdownArrowPoints`: when `viewRotation` is non-zero, rotate each unrotated point about `(x, y)` by `viewRotation` (`x' = x + dx·cos − dy·sin`, `y' = y + dx·sin + dy·cos`). This keeps it general.
  - `aim-offset.ts`: rotate the delta by `+viewRotation` in `cssDeltaToWorld`, and the offset by `−viewRotation` in `projectToScreen`. Update the header comment that says "the arena camera never rotates" to say that it rotates by 0 or π (CQ46) and that these two functions account for it.
  - `car-lighting`: add `viewRotation` to the world light angle where `carLook.lightAngle` is consumed.
  - `ArenaScene.ts`:
    - Hold `private viewRotation = 0`.
    - In `drawArena` after `setBounds`, and whenever the local player's `team` changes (check it in the per-frame update where the local player is read: compare with the last value), set `this.viewRotation = viewRotationFor(arena, sidesOf(mode), localTeam)` and call `this.cameras.main.setRotation(this.viewRotation)`.
    - Pass `this.viewRotation` to `countdownArrowPoints` (in `drawSelfArrow`), to the lighting call, and to `cssDeltaToWorld` / `projectToScreen`.
    - Do **not** rotate the HUD camera.
- [ ] **Step 4: Run the client suite and typecheck (PASS). Commit.** `git commit -m "feat(client): rotate team B's world view 180° on a flip arena (CQ46–CQ48)"`.

---

### Task 10: Art-less arena rendering — spikes, chamfers, zone ring (CQ49–CQ52)

**Files:**
- Modify: `packages/client/src/scenes/arena-visual.ts` (+ its test)
- Create: `packages/client/src/scenes/zone-visual.ts`, `zone-visual.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`redrawArenaGraphics` ~:1421, `worldObjects`, per-frame zone redraw)

**Interfaces:**
- Produces: `spikeStrips(arena): Array<{ x; y; w; h; teeth: Array<[x1,y1,x2,y2,x3,y3]> }>`, `boundaryGaps(arena): Array<Array<{x;y}>>` (the polygons between the frame and the boundary), `markingsCircleVisible(arena): boolean`, and `zoneTint(viewerTeam: number, holder: number, contested: boolean): "ally" | "enemy" | "neutral"`.

- [ ] **Step 1: Write the failing tests.**

  `zone-visual.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { zoneTint } from "./zone-visual.js";

describe("zoneTint (CQ52)", () => {
  it("is viewer-relative", () => {
    expect(zoneTint(0, 0, false)).toBe("ally");
    expect(zoneTint(1, 0, false)).toBe("enemy");
    expect(zoneTint(1, 1, false)).toBe("ally");
    expect(zoneTint(0, -1, true)).toBe("neutral");
    expect(zoneTint(0, -1, false)).toBe("neutral");
  });
});
```

  `arena-visual.test.ts`, added:

```ts
describe("art-less arena extras (CQ49–CQ51)", () => {
  it("draws every spike obstacle, teeth pointing into the playable side", () => {
    const strips = spikeStrips(ARENA_03);
    expect(strips).toHaveLength(2);
    const left = strips.find((s) => s.x === 0)!;
    // every tooth apex is inward (x > strip's inner face - tolerance)
    for (const t of left.teeth) expect(Math.max(t[0], t[2], t[4])).toBeGreaterThan(left.x + left.w - 1);
  });
  it("fills the four chamfer triangles of arena-03", () => {
    const gaps = boundaryGaps(ARENA_03);
    expect(gaps).toHaveLength(4);
    for (const g of gaps) expect(g).toHaveLength(3);
  });
  it("finds no gaps on a boundary equal to its frame, and skips the centre circle only when a zone exists", () => {
    expect(markingsCircleVisible(ARENA_03)).toBe(false);
    expect(markingsCircleVisible(ARENA_02)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and check that they fail.**
- [ ] **Step 3: Implement.**
  - `zoneTint`: return `"neutral"` if `contested || holder < 0`, otherwise `holder === viewerTeam ? "ally" : "enemy"`.
  - `spikeStrips`: for each obstacle with `kind === "spike"`, find the boundary plane it is flush against (use `boundsOf(arena).planes`, whose normals point inward), and emit triangular teeth every `SPIKE_TOOTH_PX` (12) along the strip's long side. The base is on the wall face, and the apex protrudes `SPIKE_TOOTH_PX / 2` past the strip's inner face along the inward normal. Put `SPIKE_TOOTH_PX`, `SPIKE_STRIP_COLOR` (`0x3a2a26`) and `SPIKE_TOOTH_COLOR` (`0xb8432f`) as named constants at the top of `arena-visual.ts`.
  - `boundaryGaps`: for each frame corner `(0,0) (w,0) (w,h) (0,h)` that is not itself a boundary vertex, emit the triangle `[corner, boundary vertex before it, boundary vertex after it]`. "Before" and "after" mean the two boundary vertices lying on the two frame edges that meet at that corner. Keep it to that case, a convex boundary whose vertices lie on the frame. Any other boundary returns `[]` and keeps today's rect border.
  - `markingsCircleVisible`: `arena.zone === undefined`.
  - `ArenaScene.redrawArenaGraphics` (only when there is no floor sprite, the same condition as markings):
    - fill each `boundaryGaps` polygon in the palette's `border` colour
    - stroke the boundary polygon when there are gaps; otherwise draw today's rect border
    - draw the `spikeStrips`
    - skip the markings centre circle when `!markingsCircleVisible(arena)`

    Arenas with floor art are untouched.
  - Zone ring: create a `zoneGfx` `Graphics` when the arena has a `zone`, at a depth above the floor/markings and below the car containers. Add it to `worldObjects`, or it draws on the HUD camera too. Each frame, compute `zoneTint(localTeam, state.zoneHolder, state.zoneContested)`. When it differs from the last drawn tint, clear and draw a filled circle (alpha 0.14) plus a 5 px stroke at `zone.radius`. The colour is `hpBarColor("ally")` for ally, `hpBarColor("enemy")` for enemy, and `0xffffff` for neutral (import `hpBarColor` from `combat-visual.ts`).
- [ ] **Step 4: Run the client suite and typecheck (PASS). Commit.** `git commit -m "feat(client): procedural spikes and chamfers for art-less arenas, and the zone ring (CQ49–CQ52)"`.

---

### Task 11: The Conquer gutter (CQ54–CQ57)

**Files:**
- Create: `packages/client/src/scenes/conquer-hud.ts`, `conquer-hud.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (gutter draw in `update` ~:1805, clock banner ~:1182/`syncDeathmatchHud` ~:4337, roster ~:3583)

**Interfaces:**
- Consumes: `controlPercentText`, `captureCountdownSeconds`, `inControl`-style logic via state fields; `rosterPanelLayout` constants (`ROSTER_ROW_HEIGHT_PX`, `ROSTER_ROW_GAP_PX`, `ROSTER_PAD_X_PX`, `ROSTER_SWATCH_PX`: export them from `roster-panel.ts` if they are not exported); `slotBarLayout`, `statusStripLayout`; `respawnSeconds` from `deathmatch-hud.ts`.
- Produces:

```ts
export const CONTROL_PANEL_H = 112;
export interface ConquerGutterLayout {
  clock: { x: number; y: number };
  bars: Array<{ label: { x: number; y: number }; percent: { x: number; y: number }; bar: { x: number; y: number; w: number; h: number } }>; // [ally, enemy]
  chip: { x: number; y: number; w: number; h: number };
  slotTopInset: number; // pass as slotBarLayout's topInset
  roster: { headers: Array<{ x: number; y: number }>; rows: Array<{ x: number; y: number; size: number; labelX: number; centerY: number }>; top: number }; // headers [ally, enemy]; rows: ally rows then enemy rows
}
export function conquerGutterLayout(allyCount: number, enemyCount: number, viewWidth: number, viewHeight: number, gutterWidth: number): ConquerGutterLayout;
export type ChipTone = "ally" | "enemy" | "neutral" | "muted";
export function captureChip(viewerTeam: number, holder: number, streak: number, contested: boolean, delayTicks: number, hz: number): { text: string; tone: ChipTone };
export function conquerClockLabel(tick: number, matchEndsTick: number, overtime: boolean, hz: number): string; // "2:14" | "OVERTIME"
```

- [ ] **Step 1: Write the failing tests** `conquer-hud.test.ts`:

```ts
import { describe, expect, it } from "vitest";
// Mode scope: use whatever the other client tests use to install a bundle
// (grep `withDefaultMode|withMode|installMode` in packages/client/src/**/*.test.ts) and wrap as below.
import { withDefaultMode } from "@motor-combat-moba/shared";
import { CONTROL_PANEL_H, captureChip, conquerClockLabel, conquerGutterLayout } from "./conquer-hud.js";
import { slotBarLayout } from "./weapon-hud.js";
import { statusStripLayout } from "./status-hud.js";
import { HUD_GUTTER_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from "../config/display.js";

describe("captureChip (CQ55)", () => {
  it("reads viewer-relative", () => {
    expect(captureChip(0, 0, 30, false, 150, 30)).toStrictEqual({ text: "TAKING CONTROL · 4", tone: "ally" });
    expect(captureChip(1, 0, 30, false, 150, 30)).toStrictEqual({ text: "ENEMY TAKING CONTROL · 4", tone: "enemy" });
    expect(captureChip(0, 0, 150, false, 150, 30)).toStrictEqual({ text: "HOLDING", tone: "ally" });
    expect(captureChip(0, 1, 150, false, 150, 30)).toStrictEqual({ text: "ENEMY HOLDING", tone: "enemy" });
    expect(captureChip(0, -1, 0, true, 150, 30)).toStrictEqual({ text: "CONTESTED", tone: "neutral" });
    expect(captureChip(0, -1, 0, false, 150, 30)).toStrictEqual({ text: "ZONE EMPTY", tone: "muted" });
  });
});

describe("conquerClockLabel (CQ54)", () => {
  it("counts down m:ss and switches to OVERTIME", () => {
    expect(conquerClockLabel(0, 5400, false, 30)).toBe("3:00");
    expect(conquerClockLabel(5400 - 30 * 134, 5400, false, 30)).toBe("2:14");
    expect(conquerClockLabel(5400, 5400, false, 30)).toBe("0:00");
    expect(conquerClockLabel(9999, 5400, true, 30)).toBe("OVERTIME");
  });
});

describe("conquerGutterLayout (CQ54): worst case fits without overlap", () => {
  it("control panel, then status+slots, then roster at the bottom, all inside the gutter", () => {
    withDefaultMode(() => {
      const L = conquerGutterLayout(3, 3, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH);
      expect(L.slotTopInset).toBe(CONTROL_PANEL_H);
      expect(L.chip.y + L.chip.h).toBeLessThanOrEqual(CONTROL_PANEL_H);
      const slots = slotBarLayout(3, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, L.slotTopInset);
      const strip = statusStripLayout(99, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, slots[0]!.y);
      expect(strip[0]!.y).toBeGreaterThanOrEqual(CONTROL_PANEL_H); // badges clear the panel
      const lastSlot = slots.at(-1)!;
      expect(lastSlot.nameY + 14).toBeLessThan(L.roster.top); // slot name line clears the roster
      const lastRow = L.roster.rows.at(-1)!;
      expect(lastRow.centerY + 9).toBeLessThanOrEqual(VIEW_HEIGHT); // nothing past the bottom
      for (const p of [L.clock, ...L.roster.headers, ...L.roster.rows]) {
        expect(p.x).toBeGreaterThanOrEqual(VIEW_WIDTH - HUD_GUTTER_WIDTH);
        expect(p.x).toBeLessThan(VIEW_WIDTH);
      }
      expect(L.roster.rows).toHaveLength(6);
      expect(L.roster.headers[0]!.y).toBeLessThan(L.roster.rows[0]!.centerY);
      expect(L.roster.headers[1]!.y).toBeGreaterThan(L.roster.rows[2]!.centerY);
    });
  });
});
```

  The slot count in the fits test is 3: the build's ability-slot count `N`, and the HUD shows ability slots only. If `ABILITY_SLOTS` is raised, this test is expected to fail loudly (CQ54). Add that comment to the test.
- [ ] **Step 2: Run the tests and check that they fail.**
- [ ] **Step 3: Implement `conquer-hud.ts`.** Fixed y-offsets inside the panel, all named constants at the top of the file:
  - clock at y 6 (26 px text)
  - ally label/percent at y 38 and its bar at y 52 (h 8)
  - enemy label/percent at y 64 and its bar at y 78 (h 8)
  - chip at y 92, h 16

  With these offsets the chip ends at 108, which is ≤ 112.

  Everything is inset `ROSTER_PAD_X_PX` from the gutter's left edge, and the bar width is `gutterWidth − 2·ROSTER_PAD_X_PX`.

  Worked budget at the shipped constants, which the test pins:
  - the slot stack starts at 112 + 167 = 279, and its last name line ends at 463 + 64 + 6 + 12 = 545
  - the roster block is 14 + 58 + 6 + 14 + 58 = 150, so its top is 720 − 10 − 150 = 560, a 15 px margin
  - the status strip spans 123..263, clearing the panel by 11 px, the same margin the existing layout documents

  Roster: a header row (14 px) per team, then that team's rows at the existing row pitch, with 6 px between the two groups. The block is **bottom-anchored**: `top = viewHeight − ROSTER_PAD_BOTTOM_PX − blockHeight`. Rows use the same `x`/`size`/`labelX`/`centerY` shape `rosterPanelLayout` returns.

  `captureChip` uses `captureCountdownSeconds` from shared. `conquerClockLabel` returns `"OVERTIME"` when `overtime`, otherwise formats `max(0, ceil((matchEndsTick − tick) / hz))` seconds as `m:ss`.
- [ ] **Step 4: Wire `ArenaScene`**, only when `winRuleOf(mode) === "conquer"` (CQ57). Every other mode keeps its exact draw path.
  - In `update`, draw the control panel into the gutter with existing HUD text and graphics pools (`makeHudText`, the gutter graphics), all on the HUD camera. The bars fill `controlTicksX / derived().conquerTicks.controlTarget` of their width, in the ally/enemy colours from the viewer's team. Percent text comes from `controlPercentText`. The chip colour is ally green / enemy red / white / muted grey.
  - Call `renderWeaponHud(room, L.slotTopInset)` with the Conquer inset in place of the roster height.
  - Draw the roster at `L.roster`: the ally team first under `YOUR TEAM` (ally green), then the enemy under `ENEMY` (enemy red). Keep the existing swatch, greyed-dead and name truncation behaviour. Append ` · n` to a dead row's name, where `n = respawnSeconds(...)` from `deathmatch-hud.ts`.
  - Hide the top-centre `matchClockText` banner in Conquer, and keep Deathmatch's unchanged (CQ56).
- [ ] **Step 5: Run the client suite and typecheck (PASS). Commit.** `git commit -m "feat(client): the Conquer gutter — control panel, slots, team-grouped roster (CQ54–CQ57)"`.

---

### Task 12: Car select taken cards, results line, lobby card (CQ32, CQ33, CQ58)

**Files:**
- Modify: `packages/client/src/ui/car-select-view.ts` (+ test), `ui/screens/car-select.ts`, `scenes/CarSelectScene.ts`
- Modify: `packages/client/src/ui/results-view.ts` (+ test), `ui/screens/results.ts`
- Modify: `packages/client/src/ui/lobby-view.ts` (+ test)

- [ ] **Step 1: Write the failing tests.**
  - `car-select-view.test.ts`: given a Conquer mode, a local player on team 0, and a teammate with `lockedCarId: "mirage"`, the mirage card has `taken: true` and `takenBy: "<teammate name>"`. An enemy's lock on `bastion` does not mark bastion taken. With the local preview on mirage, `canLockIn` is false. In Brawl nothing is ever taken.
  - `results-view.test.ts`: a Conquer result with `controlTicksA: 765`, `controlTicksB: 325` and target 1800 exposes `controlLine === "Control — Team A 42.50% · Team B 18.05%"`. Non-Conquer modes have `controlLine === undefined`.
  - `lobby-view.test.ts`: `modeCardsData()` contains a Conquer entry whose meta chips are `["3v3", "3:00", "zone control"]`, built from `conquer().teamSize` and `deathmatch().matchSeconds` (assert under `withMode(modeConfigOf(GameMode.CONQUER), …)`). While Conquer is inactive, `modeCards()` still omits it.

  Read each file's existing view-state builder and test style first, and name the new fields to match its conventions.
- [ ] **Step 2: Run the tests and check that they fail.**
- [ ] **Step 3: Implement.**
  - `car-select-view.ts`: the view builder gets the players (`sessionId`, `name`, `team`, `lockedCarId`) and the local session id. When `uniqueChassisApplies(mode)` holds, mark cards whose chassis `chassisTakenByTeammate` reports taken with `taken`/`takenBy`, and make `canLockIn` false when the selected card is taken.
  - `ui/screens/car-select.ts`: render a taken card greyed (opacity 0.45), with a `Taken · <name>` label, and ignore clicks on it. Update the "deliberately no taken pills" comment to say that pills appear only in a unique-chassis mode (CQ32).
  - `CarSelectScene.ts`: pass the new inputs, re-render on `players` changes, and do not send `MSG_SELECT_CAR` for a taken card.
  - `results-view.ts`: add `controlLine` when `winRuleOf(mode) === "conquer"`, using `controlPercentText` and `derived().conquerTicks.controlTarget`. `ui/screens/results.ts` renders it under the title.
  - `lobby-view.ts` `modeCardsData()`: add the Conquer card in `MODE_ORDER` position. Kicker `"Team objective"`. Body: "Two teams of three fight over the centre zone. Hold it unopposed for {captureDelaySeconds} s to take control; {controlTargetSeconds} s of control wins. Highest control when the {mm:ss} clock ends wins; a tie goes to overtime." Interpolate the numbers from the accessors inside the function, never at module scope. Meta: `[`${conquer().teamSize}v${conquer().teamSize}`, clock label, "zone control"]`.
- [ ] **Step 4: Run the client suite and typecheck (PASS). Commit.** `git commit -m "feat(client): Conquer car-select claims, results control line, lobby card (CQ32, CQ33, CQ58)"`.

---

### Task 13: Publish and document (CQ41, CQ60–CQ62)

**Files:**
- Modify: `packages/shared/src/modes/registry.ts` (`isActive: true`), `registry.test.ts`, `mode-arg.test.ts`, `packages/server/src/rooms/match-helpers.test.ts`, `packages/client/src/ui/lobby-view.test.ts`
- Modify: `docs/turn-tuning.md`, `docs/config-reference.md`, `docs/schema-reference.md`, `docs/combat-model.md`, `CLAUDE.md`, `.claude/skills/game-mode/SKILL.md`
- Regenerate: `packages/client/public/manual.html` (`npm run build:manual`)

- [ ] **Step 1: Flip the flag and update the pinned expectations.**
  - Set `isActive: true` on Conquer.
  - `registry.test.ts`: `activeGameModes()` equals `[FFA_LAST_STANDING, FFA_DEATHMATCH, CONQUER]` and `isActiveGameMode(3)` is true.
  - `mode-arg.test.ts`: `"… 3/conquer"` without `(inactive)`.
  - `match-helpers.test.ts`: `resolveSetMode(LOBBY, false, CONQUER)` returns `{ mode: CONQUER, arenaId: "arena-03" }`, with `config` as that mode's bundle.
  - `lobby-view.test.ts`: `modeCards()` now includes Conquer, last.
  - `registry-arenas.test.ts`: `activeArenaIds()` gains `"arena-03"`.
- [ ] **Step 2: Add a `## Conquer` section to `docs/turn-tuning.md`.** Copy the `## Deathmatch` section's three tables verbatim; the tables are identical (CQ13). Run `node --test scripts/turn-tuning-doc.test.mjs`. Expected: PASS.
- [ ] **Step 3: Rebuild the guide.** Run `npm run build:manual`, then `node --test scripts/manual-page.test.mjs`. Expected: PASS.
- [ ] **Step 4: Run `npm run check:art`.** Expected: no new blockers. Arena-03 has no art and needs none.
- [ ] **Step 5: Update the docs.**
  - `docs/config-reference.md`: a `CONQUER_CONFIG` section (the four fields, where they are read, and the fact that they are inert outside the conquer rule), and the `ArenaDef.zone` / `flipForTeamB` fields.
  - `docs/schema-reference.md`: the six `ArenaState` fields and `PlayerState.lockedCarId`.
  - `docs/combat-model.md`: under elimination and winning, the Conquer win rule (CQ18–CQ23), in prose.
  - `CLAUDE.md`, in the per-mode section:
    - "thirteen table files" becomes fourteen
    - "sixteen accessors" becomes seventeen, listing `conquer()`
    - derived artifacts go from eight to nine (`conquer ticks`)
    - the mode list now includes Conquer (a sentence pointing to the spec)
    - a `GameMode` sentence says there are now three win rules
    - the "Read the right doc" table gets a Conquer row pointing to the spec
  - `.claude/skills/game-mode/SKILL.md`: the same counts, and the enum example gains `CONQUER = 3`.
- [ ] **Step 6: Run the full verification.** Run `npm run build`, then `npm test`. The server suite still shows only the 2 baseline G12 failures and stops there. Then run `npm run test -w @motor-combat-moba/client` and `npm run test:scripts`, both of which must pass. Finally `grep -n "Conquer" packages/server/dist/index.js | head -3`, which proves the server bundle inlined the new shared code.
- [ ] **Step 7: Commit.** `git commit -m "feat: publish Conquer — lobby card, guide tab, turn-tuning section, docs (CQ41, CQ60, CQ61)"`.
