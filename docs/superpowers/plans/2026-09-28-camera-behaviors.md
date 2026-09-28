# Per-Mode Camera Behaviours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the arena camera a per-game-mode configuration (rotation, field of vision,
spectating), refactor today's arena-driven camera onto it with no visible change, then add
heading-up rotation and a restricted FOV that no shipped mode turns on.

**Architecture:** `ModeTables.camera` (shared, per mode, merged over the base) grows `rotate`,
`rotateLerp`, `fov` and `spectate`. A new client folder `packages/client/src/camera/` holds pure,
Phaser-free logic (rotation, spectate targeting, vision geometry) tested with vitest; `ArenaScene`
only reads `camera()`, calls those functions and applies the results to Phaser objects.

**Tech Stack:** TypeScript, npm workspaces, vitest, Phaser 4.2.1 (client), Colyseus schema (shared).

**Spec:** `docs/superpowers/specs/2026-09-28-camera-behaviors-design.md` (CB1–CB45). Read it first.

## Global Constraints

- Read `CLAUDE.md` at the repo root first; `packages/client/CLAUDE.md` before touching the client.
- Never read a config accessor (`camera()` etc.) at module scope — call it inside functions only.
- Shared is consumed as built `dist`: after editing `packages/shared/src`, run
  `npm run build -w @motor-combat-moba/shared` before client/server typecheck or tests.
- Snapshots: update only the named files with `-u`; never a blanket `-u` across the repo.
- Stage 1 must leave every shipped mode visually identical in play, except the spectator banner no
  longer mentioning `V` (CB21).
- Do not edit anything under `docs/ideas/` or `docs/invariants/`.
- Commit after each task with the message given; end every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01RY2ucHUHod1ahtUVMEoHjR
  ```
- Test commands: `npx vitest run <path>` from inside the package directory
  (`packages/shared`, `packages/client`, `packages/server`); typecheck with
  `npm run typecheck -w @motor-combat-moba/<pkg>`.
- Match surrounding code style: this codebase writes long "why" doc comments; new exported
  functions get a short doc comment citing the spec clause (e.g. `(CB12)`).

## Review Focus

1. **The local player's team is not known on the first frames** (no player row yet): `teamFacing`
   must read rotation 0 until the team is known, then snap to the team angle — never throw on an
   undefined team. Pinned in Task 2.
2. **Heading easing across the ±π seam**: easing from 170° toward −170° must travel 20°, not 340°.
   Pinned in Task 2.
3. **"teammates" spectating with every teammate dead** must yield an empty cycle (camera holds,
   banner "Wrecked — no one left to watch"), and must never list the local car or an enemy.
   Pinned in Task 3.
4. **FOV apex inside an obstacle** (a large forward offset): that obstacle must not blank the whole
   vision — obstacles containing the apex are ignored. Pinned in Task 6.
5. **A hidden enemy shot entering vision must not flash a muzzle burst mid-air**: fx events are
   derived from the full world view and only FILTERED by visibility, so a shot that becomes visible
   mid-flight produces no `shotFired`. Pinned in Task 7.

---

## File map

**Create**
- `packages/client/src/camera/rotation.ts` (+ `rotation.test.ts`) — heading→rotation, team angle,
  angle easing, axis-alignment, `resolveViewRotation`.
- `packages/client/src/camera/spectate.ts` (+ `spectate.test.ts`) — moved from `scenes/`, retargeted.
- `packages/client/src/camera/vision.ts` (+ `vision.test.ts`) — FOV geometry and viewers.
- `packages/client/src/fx/hidden.ts` (+ `hidden.test.ts`) — which fx events a viewer may see.

**Modify**
- `packages/shared/src/config/drive-config.ts` — `CameraConfig` interface and base values.
- `packages/shared/src/index.ts` — export the new camera types.
- `packages/shared/src/modes/deathmatch/config.ts`, `packages/shared/src/modes/conquer/config.ts`.
- `packages/shared/src/modes/invariants.test.ts` — CB30–CB33 + temporary stage guards.
- `packages/shared/src/modes/__snapshots__/*.tables.json` — regenerated (all four).
- `packages/shared/src/arena/types.ts`, `arena-03.ts`, `arena-03.test.ts` — drop `flipForTeamB`.
- `packages/client/src/scenes/ArenaScene.ts` — rotation, spectate, follow, FOV wiring.
- `packages/client/src/scenes/countdown-arrow.ts` — comment only (flag name).
- `packages/client/src/scenes/movement-hint.test.ts` — new `isSpectating` signature/import.
- `packages/client/src/fx/events.ts`, `packages/client/src/fx/layer.ts` — `instanceId` on shot
  events, a `hidden` filter on `update`.
- `docs/config-reference.md`, `CLAUDE.md`, `.claude/skills/game-mode/SKILL.md`.

**Delete**
- `packages/client/src/scenes/view-rotation.ts`, `view-rotation.test.ts`
- `packages/client/src/scenes/arena-camera.ts`, `arena-camera.test.ts`
- `packages/client/src/scenes/spectate.ts`, `spectate.test.ts` (moved to `camera/`)

---

# Stage 1 — refactor, no visible change

### Task 1: Per-mode camera config shape, overrides and invariants (shared)

**Files:**
- Modify: `packages/shared/src/config/drive-config.ts` (the `CameraConfig`/`CAMERA_CONFIG` block, ~line 352)
- Modify: `packages/shared/src/index.ts` (~line 305)
- Modify: `packages/shared/src/modes/deathmatch/config.ts`, `packages/shared/src/modes/conquer/config.ts`
- Modify: `packages/shared/src/modes/invariants.test.ts`
- Regenerate: `packages/shared/src/modes/__snapshots__/{brawl,team-brawl,deathmatch,conquer}.tables.json`

**Interfaces:**
- Produces (exported from `@motor-combat-moba/shared`): types `CameraConfig`, `CameraRotate`,
  `FovConfig`, `SpectateConfig`, `SpectateTarget`, `NoTargetVision`; `camera()` now returns the
  full `CameraConfig` below.

- [ ] **Step 1: Write the failing invariant tests**

Add to `packages/shared/src/modes/invariants.test.ts`, inside the existing
`for (const def of Object.values(MODE_TABLE)) { describe(...) { ... } }` loop (after the
"names at least one arena" test). Add `import { DEFAULT_GAME_MODE } from "./registry.js";` and
`import { GameMode } from "../constants.js";` if not already imported (check the import block first;
`MODE_TABLE` is already imported from `./registry.js`, extend that import).

```ts
    // --- Camera (spec 2026-09-28-camera-behaviors-design.md, CB30–CB32, CB38) -------------

    it("puts teamFacing only on a team mode whose arenas give each team one spawn heading (CB30)", () => {
      const cam = def.config.camera;
      if (cam.rotate !== "teamFacing") return;
      expect(rulesOf(def.id).sides, `${def.name}: teamFacing needs a team mode`).toBe("team");
      for (const id of def.config.arenas) {
        const arena = getArena(id);
        for (const [label, spawns] of [
          ["teamASpawns", arena.teamASpawns],
          ["teamBSpawns", arena.teamBSpawns],
        ] as const) {
          const angles = new Set(spawns.map((s) => s.angle));
          expect(
            angles.size,
            `${def.name}: ${id}.${label} faces ${[...angles].join(", ")} — teamFacing needs one angle per team`,
          ).toBe(1);
        }
      }
    });

    it("lets a mode spectate teammates only when it has teams (CB31)", () => {
      if (def.config.camera.spectate.target !== "teammates") return;
      expect(rulesOf(def.id).sides, `${def.name}: spectate "teammates" needs a team mode`).toBe("team");
    });

    it("keeps camera numbers in range (CB32)", () => {
      const { rotateLerp, fov } = def.config.camera;
      const where = `${def.name}: camera`;
      for (const [k, v] of Object.entries({ rotateLerp, ...fov })) {
        if (typeof v === "number") expect(Number.isFinite(v), `${where}.${k} = ${v}`).toBe(true);
      }
      expect(rotateLerp, `${where}.rotateLerp`).toBeGreaterThan(0);
      expect(rotateLerp, `${where}.rotateLerp`).toBeLessThanOrEqual(1);
      expect(fov.rangeX, `${where}.fov.rangeX`).toBeGreaterThan(0);
      expect(fov.rangeY, `${where}.fov.rangeY`).toBeGreaterThan(0);
      expect(fov.angleDeg, `${where}.fov.angleDeg`).toBeGreaterThan(0);
      expect(fov.angleDeg, `${where}.fov.angleDeg`).toBeLessThanOrEqual(360);
      expect(fov.outsideDim, `${where}.fov.outsideDim`).toBeGreaterThanOrEqual(0);
      expect(fov.outsideDim, `${where}.fov.outsideDim`).toBeLessThanOrEqual(1);
    });

    // TEMPORARY (CB38): removed by the stage that wires each behaviour into ArenaScene.
    it("does not turn on a camera behaviour that is not wired yet (CB38)", () => {
      expect(def.config.camera.rotate, `${def.name}: "heading" is wired in stage 2`).not.toBe("heading");
      expect(def.config.camera.fov.enabled, `${def.name}: fov is wired in stage 3`).toBe(false);
    });
```

After the loop (at file level), add the bot guard:

```ts
describe("bots and FOV (CB33)", () => {
  // Bots read the whole world (server/bot/view.ts); they are not taught FOV yet (CB5). Practice
  // runs FFA_DEATHMATCH, the playground runs DEFAULT_GAME_MODE, and both seat bots.
  it.each([GameMode.FFA_DEATHMATCH, DEFAULT_GAME_MODE])(
    "keeps FOV off in mode %i, which a bot-seated room runs",
    (mode) => {
      expect(
        MODE_TABLE[mode].config.camera.fov.enabled,
        `${MODE_TABLE[mode].name}: bots cannot see through FOV yet — teach server/bot/view.ts first`,
      ).toBe(false);
    },
  );
});
```

Also add one test that pins today's per-mode values (CB9), inside the file at top level:

```ts
describe("shipped camera choices reproduce the pre-2026-09-28 camera (CB9)", () => {
  it.each([
    [GameMode.FFA_LAST_STANDING, "none", "anyone"],
    [GameMode.TEAM, "none", "anyone"],
    [GameMode.FFA_DEATHMATCH, "none", "none"],
    [GameMode.CONQUER, "teamFacing", "none"],
  ] as const)("mode %i: rotate %s, spectate %s, no fov", (mode, rotate, target) => {
    const cam = MODE_TABLE[mode].config.camera;
    expect(cam.rotate).toBe(rotate);
    expect(cam.spectate.target).toBe(target);
    expect(cam.spectate.noTargetVision).toBe("pov");
    expect(cam.fov.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (in `packages/shared`): `npx vitest run src/modes/invariants.test.ts`
Expected: FAIL — TypeScript/vitest errors on `cam.rotate`, `spectate`, `fov` not existing on the
camera config.

- [ ] **Step 3: Implement the config shape**

In `packages/shared/src/config/drive-config.ts`, replace
`export type CameraConfig = typeof CAMERA_CONFIG;` and the `CAMERA_CONFIG` literal with the block
below. Keep the existing doc comment above it and append a paragraph pointing at the spec. Keep the
existing `freeRoamSpeed` inner comment verbatim.

```ts
/** How the camera turns (CB10–CB14). */
export type CameraRotate = "none" | "teamFacing" | "heading";
/** Who a wrecked player may watch (CB18–CB24). */
export type SpectateTarget = "anyone" | "teammates" | "none" | "free";
/** What a wrecked player sees with nobody to watch (CB26). */
export type NoTargetVision = "pov" | "blind";

/** A car's field of vision (CB25–CB29). Inert while `enabled` is false. */
export interface FovConfig {
  readonly enabled: boolean;
  /** Semi-axis along the car's nose, world units. */
  readonly rangeX: number;
  /** Semi-axis across the car, world units. */
  readonly rangeY: number;
  /** Ellipse centre in the car's frame: + is forward. */
  readonly offsetX: number;
  /** Ellipse centre in the car's frame: + is the car's right (local +y). */
  readonly offsetY: number;
  /** Cone width in degrees, (0, 360]. The cone's apex is the ellipse centre. */
  readonly angleDeg: number;
  /** Every obstacle (spikes included) blocks sight. */
  readonly blockedByObstacles: boolean;
  /** Alpha of the dark overlay outside vision, [0, 1]. */
  readonly outsideDim: number;
  /** Team modes: living teammates' vision is yours. */
  readonly sharedVision: boolean;
}

export interface SpectateConfig {
  readonly target: SpectateTarget;
  readonly noTargetVision: NoTargetVision;
}

/**
 * Explicit rather than `typeof CAMERA_CONFIG`: an `as const` literal types every value as itself,
 * and a mode override of any number here would then fail to typecheck.
 */
export interface CameraConfig {
  readonly camLerp: number;
  readonly zoom: number;
  readonly freeRoamSpeed: number;
  readonly rotate: CameraRotate;
  /** Fraction of the remaining turn closed per 60 Hz frame, (0, 1]. Read only by "heading". */
  readonly rotateLerp: number;
  readonly fov: FovConfig;
  readonly spectate: SpectateConfig;
}

export const CAMERA_CONFIG: CameraConfig = {
  camLerp: 0.18,
  zoom: 1,
  freeRoamSpeed: 340,
  rotate: "none",
  rotateLerp: 0.15,
  fov: {
    enabled: false,
    rangeX: 600,
    rangeY: 450,
    offsetX: 0,
    offsetY: 0,
    angleDeg: 120,
    blockedByObstacles: true,
    outsideDim: 0.45,
    sharedVision: true,
  },
  spectate: { target: "anyone", noTargetVision: "pov" },
};
```

In `packages/shared/src/index.ts`, next to `export { CAMERA_CONFIG, DRIVE_CONFIG, LOGICAL_CANVAS } from "./config/drive-config.js";`, add:

```ts
export type {
  CameraConfig,
  CameraRotate,
  FovConfig,
  NoTargetVision,
  SpectateConfig,
  SpectateTarget,
} from "./config/drive-config.js";
```

(If `CameraConfig` is already type-exported elsewhere in `index.ts`, merge rather than duplicate —
`grep -n "CameraConfig" packages/shared/src/index.ts`.)

- [ ] **Step 4: Per-mode overrides (CB9)**

`packages/shared/src/modes/deathmatch/config.ts` — keep the doc comment, change the object to:

```ts
export const DEATHMATCH_OVERRIDES: ModeOverrides = {
  // A wreck comes back, so it watches nobody and holds where it died (was `rulesOf().respawns`).
  camera: { spectate: { target: "none" } },
};
```

`packages/shared/src/modes/conquer/config.ts`:

```ts
export const CONQUER_OVERRIDES: ModeOverrides = {
  arenas: ["arena-03"] as readonly ArenaId[],
  camera: {
    // Each team sees its own base at the bottom, from its spawn heading (CB10, was CQ46's flag).
    rotate: "teamFacing",
    // A wreck comes back, so it watches nobody and holds where it died.
    spectate: { target: "none" },
  },
};
```

- [ ] **Step 5: Build, regenerate the four snapshots, run tests**

```bash
cd packages/shared
npm run build
npx vitest run src/modes/snapshots.test.ts -u
git diff --stat src/modes/__snapshots__
npx vitest run
npm run typecheck
```

Expected: exactly the four `*.tables.json` files move; each gains `rotate`, `rotateLerp`, `fov`,
`spectate` under `camera`; Deathmatch and Conquer show `"target": "none"`, Conquer `"rotate":
"teamFacing"`. All shared tests pass. Open one snapshot diff and confirm nothing outside `camera`
moved.

- [ ] **Step 6: Typecheck dependants**

```bash
cd ../.. && npm run typecheck -w @motor-combat-moba/server && npm run typecheck -w @motor-combat-moba/client
```

Expected: PASS (nothing reads the new fields yet; `camera().zoom` / `camLerp` / `freeRoamSpeed`
keep their types as `number`).

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): per-mode camera config — rotate, fov, spectate (CB8-CB9, CB30-CB33)"
```

---

### Task 2: Rotation logic in `camera/rotation.ts`, `teamFacing` replaces `flipForTeamB`

**Files:**
- Create: `packages/client/src/camera/rotation.ts`, `packages/client/src/camera/rotation.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`syncViewRotation` ~line 1893–1908, its import ~line 222, the `viewRotation` field doc ~line 906)
- Modify: `packages/shared/src/arena/types.ts` (remove `flipForTeamB`), `packages/shared/src/arena/arena-03.ts` (remove `flipForTeamB: true` and reword its header comment to say team views come from spawn headings, CB10), `packages/shared/src/arena/arena-03.test.ts` (drop any assertion on the flag)
- Modify: `packages/client/src/scenes/countdown-arrow.ts` (comment mentioning `flipForTeamB` / `viewRotationFor` → "`camera/rotation.ts`")
- Delete: `packages/client/src/scenes/view-rotation.ts`, `packages/client/src/scenes/view-rotation.test.ts`

**Interfaces:**
- Consumes: `CameraRotate` (Task 1), `ArenaDef` from shared.
- Produces (`packages/client/src/camera/rotation.ts`):
  - `normalizeAngle(a: number): number` → in `(-π, π]`
  - `viewRotationForHeading(heading: number): number`
  - `teamFacingRotation(arena: Pick<ArenaDef, "teamASpawns" | "teamBSpawns">, team: number): number`
  - `easeAngle(current: number, target: number, lerp: number, deltaMs: number): number`
  - `isAxisAligned(rotation: number): boolean`
  - `resolveViewRotation(input: ViewRotationInput): number` with
    ```ts
    export interface ViewRotationInput {
      readonly rotate: CameraRotate;
      readonly arena: Pick<ArenaDef, "teamASpawns" | "teamBSpawns">;
      readonly localTeam: number | undefined;   // undefined until the local row exists
      readonly followHeading: number | undefined; // the camera target's heading, "heading" only
      readonly current: number;
      readonly lerp: number;
      readonly deltaMs: number;
      readonly snap: boolean;
    }
    ```

- [ ] **Step 1: Write the failing tests** — `packages/client/src/camera/rotation.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ARENA_03 } from "@motor-combat-moba/shared";
import { projectToScreen } from "../input/aim-offset.js";
import {
  easeAngle,
  isAxisAligned,
  normalizeAngle,
  resolveViewRotation,
  teamFacingRotation,
  viewRotationForHeading,
} from "./rotation.js";

const FRAME = 1000 / 60;

describe("normalizeAngle", () => {
  it("maps into (-π, π]", () => {
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(3 * Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(normalizeAngle(0)).toBeCloseTo(0);
    expect(normalizeAngle(4 * Math.PI + 0.1)).toBeCloseTo(0.1);
  });
});

describe("viewRotationForHeading (CB13)", () => {
  // The sign convention, pinned against the crosshair's own world→screen maths: a point straight
  // ahead of the car must land straight above the screen centre, for any heading.
  it.each([0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.7, -2.3])("puts heading %f straight up", (h) => {
    const view = {
      x: 0, y: 0, width: 1280, height: 720, originX: 0.5, originY: 0.5,
      zoomX: 1, zoomY: 1, scrollX: 1000 - 640, scrollY: 1000 - 360,
    };
    const ahead = { x: 1000 + Math.cos(h) * 100, y: 1000 + Math.sin(h) * 100 };
    const s = projectToScreen(view, ahead, viewRotationForHeading(h));
    expect(s.x).toBeCloseTo(640, 6);
    expect(s.y).toBeCloseTo(360 - 100, 6);
  });
});

describe("teamFacingRotation (CB10, CB11)", () => {
  it("reproduces arena-03's old 180° team-B view without a flag", () => {
    expect(teamFacingRotation(ARENA_03, 0)).toBeCloseTo(0);
    expect(Math.abs(teamFacingRotation(ARENA_03, 1))).toBeCloseTo(Math.PI);
  });
  it("reads 0 for an arena with no spawns for that team", () => {
    expect(teamFacingRotation({ teamASpawns: [], teamBSpawns: [] }, 1)).toBe(0);
  });
});

describe("easeAngle", () => {
  it("takes the short way across the ±π seam (Review Focus 2)", () => {
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    const next = easeAngle(from, to, 0.5, FRAME);
    // Half of a 20° turn, going up through 180°: 180°, i.e. ±π.
    expect(Math.abs(next)).toBeCloseTo(Math.PI, 6);
  });
  it("closes lerp of the gap per 60 Hz frame, frame-rate independent", () => {
    const one = easeAngle(0, 1, 0.2, FRAME);
    expect(one).toBeCloseTo(0.2, 6);
    let a = 0;
    for (let i = 0; i < 4; i++) a = easeAngle(a, 1, 0.2, FRAME / 4);
    expect(a).toBeCloseTo(0.2, 6);
  });
  it("lerp 1 snaps", () => {
    expect(easeAngle(0, 2, 1, FRAME)).toBeCloseTo(2);
  });
});

describe("isAxisAligned (CB15)", () => {
  it("is true for multiples of π only", () => {
    expect(isAxisAligned(0)).toBe(true);
    expect(isAxisAligned(Math.PI)).toBe(true);
    expect(isAxisAligned(-Math.PI)).toBe(true);
    expect(isAxisAligned(2 * Math.PI)).toBe(true);
    expect(isAxisAligned(Math.PI / 2)).toBe(false);
    expect(isAxisAligned(0.01)).toBe(false);
  });
});

describe("resolveViewRotation", () => {
  const base = {
    arena: ARENA_03, localTeam: 1, followHeading: 0.5, current: 0.2, lerp: 0.15,
    deltaMs: FRAME, snap: false,
  } as const;

  it('"none" is always 0 (CB14)', () => {
    expect(resolveViewRotation({ ...base, rotate: "none" })).toBe(0);
  });
  it('"teamFacing" snaps to the team angle, ignoring the car heading (CB10)', () => {
    expect(Math.abs(resolveViewRotation({ ...base, rotate: "teamFacing" }))).toBeCloseTo(Math.PI);
  });
  it('"teamFacing" reads 0 until the local team is known (Review Focus 1)', () => {
    expect(resolveViewRotation({ ...base, rotate: "teamFacing", localTeam: undefined })).toBe(0);
  });
  it('"heading" eases toward the followed car (CB12)', () => {
    const target = viewRotationForHeading(0.5);
    const got = resolveViewRotation({ ...base, rotate: "heading" });
    expect(got).toBeCloseTo(easeAngle(0.2, target, 0.15, FRAME), 9);
  });
  it('"heading" snaps when asked (first frame, respawn cut)', () => {
    expect(resolveViewRotation({ ...base, rotate: "heading", snap: true })).toBeCloseTo(
      viewRotationForHeading(0.5),
    );
  });
  it('"heading" holds its angle with nothing to follow (CB16 free roam)', () => {
    expect(resolveViewRotation({ ...base, rotate: "heading", followHeading: undefined })).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (in `packages/client`): `npx vitest run src/camera/rotation.test.ts`
Expected: FAIL — cannot resolve `./rotation.js`.

- [ ] **Step 3: Implement** — `packages/client/src/camera/rotation.ts`

```ts
import type { ArenaDef, CameraRotate } from "@motor-combat-moba/shared";

/**
 * The world camera's angle, one place (spec 2026-09-28-camera-behaviors-design.md, CB10–CB16).
 * Phaser turns world into screen by `+rotation` (see `input/aim-offset.ts`), and a car's heading 0
 * points along world +x, so the rotation that puts heading `h` at the top of the screen is
 * `-π/2 - h`. Every rotation the arena camera takes goes through `viewRotationForHeading`.
 */

const TAU = Math.PI * 2;
const REFERENCE_FRAME_MS = 1000 / 60;
const AXIS_EPSILON = 1e-6;

/** Into `(-π, π]`. */
export function normalizeAngle(a: number): number {
  return a - TAU * Math.ceil((a - Math.PI) / TAU);
}

/** The camera rotation that draws `heading` pointing straight up the screen (CB13). */
export function viewRotationForHeading(heading: number): number {
  return normalizeAngle(-Math.PI / 2 - heading);
}

/**
 * The rotation for a team's own spawn heading (CB10). Every spawn of a team shares one angle —
 * `modes/invariants.test.ts` holds any `teamFacing` mode's arenas to that (CB30) — so the first
 * spawn speaks for the team. An arena with no spawns for the team reads 0.
 */
export function teamFacingRotation(
  arena: Pick<ArenaDef, "teamASpawns" | "teamBSpawns">,
  team: number,
): number {
  const spawn = (team === 1 ? arena.teamBSpawns : arena.teamASpawns)[0];
  return spawn ? viewRotationForHeading(spawn.angle) : 0;
}

/**
 * Ease `current` toward `target` along the shorter arc, closing `lerp` of the gap per 60 Hz frame
 * and rescaled by the real frame time the same way `smoothFollow` rescales `camLerp`.
 */
export function easeAngle(current: number, target: number, lerp: number, deltaMs: number): number {
  const gap = normalizeAngle(target - current);
  const alpha = 1 - Math.pow(1 - lerp, deltaMs / REFERENCE_FRAME_MS);
  return normalizeAngle(current + gap * alpha);
}

/**
 * Whether Phaser's scroll clamp is still right at this rotation (CB15): it clamps an UNROTATED
 * rectangle, which matches the rotated view only at multiples of π.
 */
export function isAxisAligned(rotation: number): boolean {
  const m = Math.abs(normalizeAngle(rotation));
  return m < AXIS_EPSILON || Math.abs(m - Math.PI) < AXIS_EPSILON;
}

export interface ViewRotationInput {
  readonly rotate: CameraRotate;
  readonly arena: Pick<ArenaDef, "teamASpawns" | "teamBSpawns">;
  /** Undefined until the local player's row exists. */
  readonly localTeam: number | undefined;
  /** The camera target's heading ("heading" only); undefined while free-roaming or holding. */
  readonly followHeading: number | undefined;
  readonly current: number;
  readonly lerp: number;
  readonly deltaMs: number;
  /** Jump straight to the target: the first frame, and the respawn cut. */
  readonly snap: boolean;
}

/** This frame's world-camera rotation for the mode's `rotate` choice (CB10–CB16). */
export function resolveViewRotation(input: ViewRotationInput): number {
  switch (input.rotate) {
    case "none":
      return 0;
    case "teamFacing":
      return input.localTeam === undefined ? 0 : teamFacingRotation(input.arena, input.localTeam);
    case "heading": {
      if (input.followHeading === undefined) return input.current;
      const target = viewRotationForHeading(input.followHeading);
      return input.snap ? target : easeAngle(input.current, target, input.lerp, input.deltaMs);
    }
  }
}
```

- [ ] **Step 4: Run the new tests**

Run (in `packages/client`): `npx vitest run src/camera/rotation.test.ts`
Expected: PASS. If the `viewRotationForHeading` cases fail with `s.y ≈ 460`, the sign is inverted —
the convention is pinned by `projectToScreen`, so fix `rotation.ts`, not the test.

- [ ] **Step 5: Remove `flipForTeamB` and rewire `syncViewRotation`**

1. `packages/shared/src/arena/types.ts`: delete the `flipForTeamB` field and its doc comment.
2. `packages/shared/src/arena/arena-03.ts`: delete `flipForTeamB: true,`; in the header comment
   replace the sentence about CQ46's rotation with: "Symmetric about both centre lines, so each
   team's view — derived from its spawn heading by the mode's `camera.rotate: "teamFacing"`
   (2026-09-28 camera spec, CB10) — shows the same map with its own base at the bottom."
3. `grep -rn "flipForTeamB" packages scripts` — fix every remaining hit (tests asserting the flag:
   delete the assertion; comments: reword to "the mode's `teamFacing` rotation").
4. Delete `packages/client/src/scenes/view-rotation.ts` and `view-rotation.test.ts`.
5. In `ArenaScene.ts`, replace the `viewRotationFor` import with
   `import { resolveViewRotation } from "../camera/rotation.js";` and make sure `camera` is
   imported from `@motor-combat-moba/shared` (it already is). Replace `syncViewRotation`'s body:

```ts
  private syncViewRotation(arena: ArenaDef, force = false): void {
    const room = this.room;
    const local = room ? room.state.players.get(this.drivenSid(room)) : undefined;
    const rotation = resolveViewRotation({
      rotate: camera().rotate,
      arena,
      localTeam: local?.team,
      followHeading: undefined, // "heading" is wired in stage 2 (CB38 keeps it off until then)
      current: this.viewRotation,
      lerp: camera().rotateLerp,
      deltaMs: 0,
      snap: true,
    });
    if (!force && rotation === this.viewRotation) return;
    this.viewRotation = rotation;
    this.cameras.main.setRotation(rotation);
  }
```

   Update its doc comment and the `viewRotation` field's doc comment (~line 906) to say the angle
   comes from the mode's `camera().rotate` (CB10–CB14) rather than `flipForTeamB`/CQ46.

- [ ] **Step 6: Build and run**

```bash
npm run build -w @motor-combat-moba/shared
npm run typecheck -w @motor-combat-moba/shared && npm run typecheck -w @motor-combat-moba/client && npm run typecheck -w @motor-combat-moba/server
cd packages/client && npx vitest run && cd ../shared && npx vitest run
```

Expected: PASS everywhere.

- [ ] **Step 7: Commit**

```bash
git add -A packages/client/src/camera packages/client/src/scenes packages/shared/src/arena
git commit -m "refactor(camera): rotation from the mode's camera().rotate; teamFacing replaces flipForTeamB (CB10-CB14)"
```

---

### Task 3: Spectate targets from config, always-follow camera, `V` toggle removed

**Files:**
- Create: `packages/client/src/camera/spectate.ts`, `packages/client/src/camera/spectate.test.ts`
  (move with `git mv` from `packages/client/src/scenes/spectate.ts` / `spectate.test.ts`, then edit)
- Modify: `packages/client/src/scenes/ArenaScene.ts` — imports (~line 188–193), `SpectateKeys`
  (~line 700, the `freeRoam` key), key creation (~line 1277), `drawArena` follow block
  (~line 1390–1397), `staticCamera` field (~line 903), `isSpectating` (~line 4290), `updateSpectate`
  (~line 4331), `followCamera` (~line 4402), `syncSpectateHud` (~line 4638)
- Modify: `packages/client/src/scenes/movement-hint.test.ts` (import path + new signature)
- Delete: `packages/client/src/scenes/arena-camera.ts`, `packages/client/src/scenes/arena-camera.test.ts`

**Interfaces:**
- Consumes: `SpectateTarget` (Task 1).
- Produces (`packages/client/src/camera/spectate.ts`):
  - `isSpectating(phase: number, status: number, alive: boolean, target: SpectateTarget): boolean`
  - `interface SpectateCandidate { sessionId: string; status: number; alive: boolean; team: number }`
  - `spectatableIds(players: readonly SpectateCandidate[], target: SpectateTarget, viewer: { sessionId: string; team: number }): string[]`
  - unchanged: `cycleSpectate`, `resolveSpectateTarget`, `panFreeCam`, `smoothFollow`
  - `spectateBanner(target: SpectateTarget, watchedName: string): string | undefined`

- [ ] **Step 1: Move the files**

```bash
git mv packages/client/src/scenes/spectate.ts packages/client/src/camera/spectate.ts
git mv packages/client/src/scenes/spectate.test.ts packages/client/src/camera/spectate.test.ts
git rm packages/client/src/scenes/arena-camera.ts packages/client/src/scenes/arena-camera.test.ts
```

- [ ] **Step 2: Rewrite the tests for the new signatures** — in `camera/spectate.test.ts`:

  - Every `SpectateCandidate` fixture gains `team: 0` (or the team the case needs).
  - Replace every `spectatableIds(players)` call with `spectatableIds(players, "anyone", VIEWER)`
    where `const VIEWER = { sessionId: "me", team: 0 };` — the existing "anyone" expectations must
    not change.
  - Replace the whole `describe("isSpectating", ...)` block with:

```ts
describe("isSpectating (CB18)", () => {
  it.each(["anyone", "teammates", "free"] as const)("is true for a wreck in a live match (%s)", (t) => {
    expect(isSpectating(RoomPhase.MATCH, PlayerStatus.IN_MATCH, false, t)).toBe(true);
  });
  it('is false when the mode lets you watch nobody ("none")', () => {
    expect(isSpectating(RoomPhase.MATCH, PlayerStatus.IN_MATCH, false, "none")).toBe(false);
  });
  it("is false while still alive", () => {
    expect(isSpectating(RoomPhase.MATCH, PlayerStatus.IN_MATCH, true, "anyone")).toBe(false);
  });
  it("is false during the countdown, even though the car cannot move yet", () => {
    expect(isSpectating(RoomPhase.COUNTDOWN, PlayerStatus.IN_MATCH, true, "anyone")).toBe(false);
    expect(isSpectating(RoomPhase.COUNTDOWN, PlayerStatus.IN_MATCH, false, "anyone")).toBe(false);
  });
  it("is false in the lobby and car select", () => {
    expect(isSpectating(RoomPhase.LOBBY, PlayerStatus.IN_MATCH, false, "anyone")).toBe(false);
    expect(isSpectating(RoomPhase.CAR_SELECT, PlayerStatus.IN_MATCH, false, "anyone")).toBe(false);
  });
  it("is false for someone who is not in the match at all", () => {
    expect(isSpectating(RoomPhase.MATCH, PlayerStatus.READY, false, "anyone")).toBe(false);
    expect(isSpectating(RoomPhase.MATCH, PlayerStatus.POST_MATCH, false, "anyone")).toBe(false);
  });
});

describe("spectatableIds by target (CB19, CB20)", () => {
  const me = { sessionId: "me", team: 0 };
  const players = [
    { sessionId: "me", status: PlayerStatus.IN_MATCH, alive: false, team: 0 },
    { sessionId: "ally", status: PlayerStatus.IN_MATCH, alive: true, team: 0 },
    { sessionId: "foe", status: PlayerStatus.IN_MATCH, alive: true, team: 1 },
  ];
  it('"anyone" lists every living car', () => {
    expect(spectatableIds(players, "anyone", me)).toEqual(["ally", "foe"]);
  });
  it('"teammates" lists living teammates only, never yourself', () => {
    expect(spectatableIds(players, "teammates", me)).toEqual(["ally"]);
  });
  it('"teammates" is empty once every teammate is dead (Review Focus 3)', () => {
    const wiped = players.map((p) => (p.sessionId === "ally" ? { ...p, alive: false } : p));
    expect(spectatableIds(wiped, "teammates", me)).toEqual([]);
  });
  it.each(["none", "free"] as const)('"%s" lists nobody', (t) => {
    expect(spectatableIds(players, t, me)).toEqual([]);
  });
});

describe("spectateBanner (CB24)", () => {
  it("names who you watch", () => {
    expect(spectateBanner("anyone", "Ann")).toBe("Spectating Ann — [ ] or Left/Right to switch");
    expect(spectateBanner("teammates", "Ann")).toBe("Spectating Ann — [ ] or Left/Right to switch");
  });
  it("says so when nobody is left", () => {
    expect(spectateBanner("anyone", "")).toBe("Wrecked — no one left to watch");
    expect(spectateBanner("teammates", "")).toBe("Wrecked — no one left to watch");
  });
  it("free roam explains the keys", () => {
    expect(spectateBanner("free", "")).toBe("Free roam — WASD/arrows to pan");
  });
  it('"none" shows no banner', () => {
    expect(spectateBanner("none", "")).toBeUndefined();
  });
});
```

  Add `spectateBanner` to the file's import list.

- [ ] **Step 3: Run to verify failure**

Run (in `packages/client`): `npx vitest run src/camera/spectate.test.ts`
Expected: FAIL — signature mismatches / `spectateBanner` missing.

- [ ] **Step 4: Implement** — edit `packages/client/src/camera/spectate.ts`

  - Change the import to `import { PlayerStatus, RoomPhase, type SpectateTarget } from "@motor-combat-moba/shared";`
    (`rulesOf` and `GameMode` are no longer used here).
  - Replace `isSpectating` (keep and update its doc comment: the rule is now the mode's
    `camera().spectate.target`, CB18, no longer `rulesOf(mode).respawns`):

```ts
export function isSpectating(
  phase: number,
  status: number,
  alive: boolean,
  target: SpectateTarget,
): boolean {
  if (phase !== RoomPhase.MATCH) return false;
  if (target === "none") return false;
  return status === PlayerStatus.IN_MATCH && !alive;
}
```

  - Replace `SpectateCandidate` and `spectatableIds` (keep the sort and its comment):

```ts
export interface SpectateCandidate {
  sessionId: string;
  status: number;
  alive: boolean;
  team: number;
}

/** Who a wreck may cycle through (CB19, CB20). "none" and "free" watch nobody. */
export function spectatableIds(
  players: readonly SpectateCandidate[],
  target: SpectateTarget,
  viewer: { sessionId: string; team: number },
): string[] {
  if (target === "none" || target === "free") return [];
  return players
    .filter((p) => p.status === PlayerStatus.IN_MATCH && p.alive)
    .filter(
      (p) => target === "anyone" || (p.team === viewer.team && p.sessionId !== viewer.sessionId),
    )
    .map((p) => p.sessionId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
```

  - Add:

```ts
/** The spectator banner for a wreck (CB24); undefined means no banner. */
export function spectateBanner(target: SpectateTarget, watchedName: string): string | undefined {
  if (target === "none") return undefined;
  if (target === "free") return "Free roam — WASD/arrows to pan";
  return watchedName === ""
    ? "Wrecked — no one left to watch"
    : `Spectating ${watchedName} — [ ] or Left/Right to switch`;
}
```

- [ ] **Step 5: Run the spectate tests**

Run (in `packages/client`): `npx vitest run src/camera/spectate.test.ts`
Expected: PASS.

- [ ] **Step 6: Rewire `ArenaScene` and `movement-hint.test.ts`**

  1. Imports: `from "./spectate.js"` → `from "../camera/spectate.js"`, adding `spectateBanner`.
     Remove the `fitsViewport` import.
  2. Delete the `staticCamera` field. In `drawArena`, replace the `this.staticCamera = fitsViewport(...)`
     block and its `if (this.staticCamera) cam.centerOn(...)` with:

```ts
    // The camera always follows (CB2): `setBounds` above clamps it to the arena, so on a
    // one-screen arena it cannot scroll at all — the old "static" camera, with no flag. Centred once
    // here so the frames before the first pose arrives show the arena, not its top-left corner.
    cam.centerOn(arena.width / 2, arena.height / 2);
```

  3. `followCamera`: delete `if (this.staticCamera) return;` and update its doc comment (CB2).
  4. `SpectateKeys`: remove the `freeRoam` key and the `freeRoam: keyboard.addKey(Codes.V),` line
     (CB21). Keep `prev`, `next`, `panUp/Down/Left/Right`.
  5. `isSpectating(room)` becomes:

```ts
  private isSpectating(room: Room<ArenaState>): boolean {
    const local = room.state.players.get(this.drivenSid(room));
    if (!local) return false;
    return isSpectating(room.state.phase, local.status, local.alive, camera().spectate.target);
  }
```

  6. `updateSpectate` becomes:

```ts
  private updateSpectate(room: Room<ArenaState>, delta: number): void {
    if (!this.isSpectating(room)) {
      // Still alive, or not in a live match. Clearing the state means the next death starts a fresh
      // cycle rather than resuming one from a previous match.
      this.spectateTarget = "";
      this.freeRoam = false;
      return;
    }

    const target = camera().spectate.target;
    // "free" is the mode's whole spectating rule, not a toggle (CB20, CB21).
    this.freeRoam = target === "free";
    const keys = this.keys;
    if (this.freeRoam) {
      this.spectateTarget = "";
      if (keys) this.panCamera(keys, delta);
      return;
    }

    const local = room.state.players.get(this.drivenSid(room));
    const viewer = { sessionId: this.drivenSid(room), team: local?.team ?? 0 };
    const ids = spectatableIds(this.spectateCandidates(room), target, viewer);
    this.spectateTarget = resolveSpectateTarget(ids, this.spectateTarget);
    if (!keys) return;

    const back = Phaser.Input.Keyboard.JustDown(keys.prev) || this.justDown(this.cursors?.left);
    const forward = Phaser.Input.Keyboard.JustDown(keys.next) || this.justDown(this.cursors?.right);
    if (back) this.spectateTarget = cycleSpectate(ids, this.spectateTarget, -1);
    else if (forward) this.spectateTarget = cycleSpectate(ids, this.spectateTarget, 1);
  }
```

  7. `spectateCandidates` adds `team: player.team` to each candidate.
  8. `syncSpectateHud` body after the `isSpectating` check:

```ts
    const name = room.state.players.get(this.spectateTarget)?.name ?? "";
    const banner = spectateBanner(camera().spectate.target, name);
    if (banner === undefined) {
      text.setVisible(false);
      return;
    }
    text.setText(banner);
    text.setVisible(true);
```

  9. `grep -n "freeRoam\|staticCamera\|fitsViewport" packages/client/src/scenes/ArenaScene.ts`:
     only `this.freeRoam` reads that still make sense (the field, `updateSpectate`, the HUD
     target at ~line 3699) may remain. Fix stale doc comments that mention the `V` key.
  10. `movement-hint.test.ts`: import `isSpectating` from `"../camera/spectate.js"`; its call
      becomes `isSpectating(RoomPhase.COUNTDOWN, PlayerStatus.IN_MATCH, false, "anyone")`. Drop the
      now-unused `GameMode` import if nothing else uses it.
  11. `grep -rn "scenes/spectate\|arena-camera\|fitsViewport" packages docs/config-reference.md` —
      fix every remaining code reference; in docs reword to the new mechanism.

- [ ] **Step 7: Verify**

```bash
npm run typecheck -w @motor-combat-moba/client
cd packages/client && npx vitest run
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A packages/client
git commit -m "refactor(camera): spectate targets from camera().spectate; always-follow clamped camera; drop V toggle (CB2, CB18-CB24)"
```

---

### Task 4: Stage-1 docs and full-scope verification

**Files:**
- Modify: `docs/config-reference.md` (the camera section and the `flipForTeamB` paragraphs, ~lines 1190 and 1390–1420)
- Modify: `CLAUDE.md` (the per-mode config section's accessor list sentence about `camera()`; add one sentence)
- Modify: `.claude/skills/game-mode/SKILL.md` (checklist line)

- [ ] **Step 1: `docs/config-reference.md`** — find the `CAMERA_CONFIG` section (`grep -n "CAMERA_CONFIG\|camLerp" docs/config-reference.md`). Add a table of the new fields with one line each (meaning, base value, clause) and the per-mode table from spec CB9. Replace every `flipForTeamB` paragraph with: team views now come from the mode's `camera.rotate: "teamFacing"`, derived from each team's spawn heading; the flag was deleted on 2026-09-28 (CB3). Replace the sentence claiming `arena-camera.test.ts` passes with: the camera always follows, clamped to the arena, so a one-screen arena does not scroll (CB2). Link the spec.

- [ ] **Step 2: `CLAUDE.md`** — in the "Configuration is PER-GAME-MODE" section, after the sentence listing the seventeen accessors, add:

  > **The camera is per mode too** (2026-09-28): `camera()` carries `rotate` (`"none"`,
  > `"teamFacing"`, `"heading"`), `fov` (a restricted field of vision, off in every shipped mode)
  > and `spectate` (who a wreck may watch), besides `camLerp`/`zoom`/`freeRoamSpeed`. The arena no
  > longer decides anything about the camera — see
  > [`docs/superpowers/specs/2026-09-28-camera-behaviors-design.md`](docs/superpowers/specs/2026-09-28-camera-behaviors-design.md).

  Also: the Conquer paragraph mentions nothing about `flipForTeamB`? `grep -n "flipForTeamB\|CQ46" CLAUDE.md` and reword any hit.

- [ ] **Step 3: game-mode skill** — in `.claude/skills/game-mode/SKILL.md`, in the checklist where the mode's `config.ts` overrides are described, add one bullet: "Choose the mode's camera in its `config.ts` — `camera.rotate`, `camera.fov`, `camera.spectate` (spec 2026-09-28 CB9, CB30–CB33 constrain them)."

- [ ] **Step 4: Full scope**

```bash
npm test 2>&1 | tail -40
```

Expected: the same pass/fail set as the pre-change baseline (the repo documents pre-existing G12
failures in `docs/testing.md`; compare against the baseline log rather than expecting zero). Any
NEW failure must be fixed before committing.

- [ ] **Step 5: Commit**

```bash
git add docs/config-reference.md CLAUDE.md .claude/skills/game-mode/SKILL.md
git commit -m "docs(camera): per-mode camera config, teamFacing replaces flipForTeamB (CB41, CB44)"
```

---

# Stage 2 — heading rotation

### Task 5: Wire `"heading"` into `ArenaScene`

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts` — `syncViewRotation`, `update`, `drawArena` bounds, `syncRespawnCamera`
- Modify: `packages/shared/src/modes/invariants.test.ts` — drop the `"heading"` half of the CB38 guard

**Interfaces:**
- Consumes: `resolveViewRotation`, `isAxisAligned` (Task 2); `cameraTarget(room)` (existing).

- [ ] **Step 1: Remove the heading guard** — in `invariants.test.ts`, delete the line
  `expect(def.config.camera.rotate, ...).not.toBe("heading");` from the CB38 test (keep the fov line).

- [ ] **Step 2: Per-frame rotation.** In `ArenaScene`:

  1. Add fields:

```ts
  /** Snap the next rotation instead of easing it: first frame, and the respawn cut (CB12). */
  private snapRotation = true;
  /** Whether the world camera is currently clamped to the arena (CB15). */
  private cameraBounded = true;
```

  2. `syncViewRotation(arena, force = false, deltaMs = 0)` — compute the followed heading and
     apply bounds:

```ts
  private syncViewRotation(arena: ArenaDef, force = false, deltaMs = 0): void {
    const room = this.room;
    const local = room ? room.state.players.get(this.drivenSid(room)) : undefined;
    const followed = room && !this.freeRoam ? room.state.players.get(this.cameraTarget(room)) : undefined;
    // The followed car's DRAWN heading: predicted for your own car, interpolated for a remote —
    // the same pose `renderCars` hands `followCamera`, read one frame earlier.
    const followHeading =
      followed && followed.alive ? this.lastDrawnPose.get(this.cameraTarget(room!))?.angle : undefined;
    const rotation = resolveViewRotation({
      rotate: camera().rotate,
      arena,
      localTeam: local?.team,
      followHeading,
      current: this.viewRotation,
      lerp: camera().rotateLerp,
      deltaMs,
      snap: force || this.snapRotation,
    });
    if (followHeading !== undefined) this.snapRotation = false;
    this.applyCameraBounds(arena, isAxisAligned(rotation));
    if (!force && rotation === this.viewRotation) return;
    this.viewRotation = rotation;
    this.cameras.main.setRotation(rotation);
  }

  /** Clamp to the arena only while the view is axis-aligned (CB15); a turned view follows freely. */
  private applyCameraBounds(arena: ArenaDef, aligned: boolean): void {
    if (aligned === this.cameraBounded) return;
    this.cameraBounded = aligned;
    if (aligned) this.cameras.main.setBounds(0, 0, arena.width, arena.height);
    else this.cameras.main.removeBounds();
  }
```

  3. Add `private lastDrawnPose = new Map<string, { x: number; y: number; angle: number }>();`
     (Task 8's FOV reads the whole pose from the same map) and in `renderCars`, right after
     `poses.set(sessionId, pose);`, add
     `this.lastDrawnPose.set(sessionId, { x: pose.x, y: pose.y, angle: pose.angle });`. Clear it
     wherever `this.cars` is cleared on shutdown/create (search `this.cars.clear()`), and delete the
     entry where a faded car is destroyed (`this.cars.delete(sessionId)`).
  4. In `update`, pass the frame delta: `this.syncViewRotation(this.arena, false, delta);`.
  5. In `drawArena`, set `this.cameraBounded = true; this.snapRotation = true;` right after
     `cam.setBounds(...)` and before `this.syncViewRotation(arena, true)`.
  6. In `syncRespawnCamera`, where `this.camFocus = undefined` on the dead→alive edge, also set
     `this.snapRotation = true;` (CB12).
  7. In the shutdown/reset block that clears `spectateTarget`/`freeRoam`/`localAlive` (~line 1822),
     also reset `this.snapRotation = true; this.cameraBounded = true; this.lastDrawnPose.clear();`.

- [ ] **Step 3: Check every rotation consumer reads the per-frame value (CB17)**

`grep -n "viewRotation" packages/client/src/scenes/ArenaScene.ts` — every use must read
`this.viewRotation` at draw time (crosshair `syncCrosshair`/`projectToScreen`, `cssDeltaToWorld`,
the countdown arrow, `viewLook()`), never a value captured in `create`. Fix any that cache. Update
comments that say the rotation is "0 or π" to "any angle (CB12)".

- [ ] **Step 4: Verify**

```bash
cd packages/shared && npx vitest run src/modes/invariants.test.ts && cd ../..
npm run typecheck -w @motor-combat-moba/client && (cd packages/client && npx vitest run)
```

Expected: PASS.

- [ ] **Step 5: Manual smoke (local only, never committed)**

Temporarily set `camera: { rotate: "heading" }` in `packages/shared/src/modes/brawl/config.ts`,
`npm run build -w @motor-combat-moba/shared`, `npm run dev`, open `http://localhost:5173`, start a
match and drive: the car's nose stays up, the map turns smoothly, walls show floor colour past them,
the crosshair (if any) and countdown arrow stay screen-correct. If a browser is not available in
the session, skip and say so in the task report. `git checkout packages/shared/src/modes/brawl/config.ts`
before committing.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/scenes/ArenaScene.ts packages/shared/src/modes/invariants.test.ts
git commit -m "feat(camera): heading-up rotation with rotateLerp and unclamped turned views (CB12, CB15-CB17)"
```

---

# Stage 3 — field of vision

### Task 6: Vision geometry in `camera/vision.ts`

**Files:**
- Create: `packages/client/src/camera/vision.ts`, `packages/client/src/camera/vision.test.ts`

**Interfaces:**
- Consumes: `FovConfig`, `Obstacle`, `WorldShape` from shared.
- Produces:
  ```ts
  export interface Pt { readonly x: number; readonly y: number }
  export interface Pose { readonly x: number; readonly y: number; readonly angle: number }
  export interface VisionShape {
    readonly cx: number; readonly cy: number; readonly heading: number;
    readonly rangeX: number; readonly rangeY: number;
    readonly halfAngle: number; readonly full: boolean;
  }
  export function visionShapeOf(pose: Pose, fov: FovConfig): VisionShape;
  export function inShape(p: Pt, s: VisionShape): boolean;
  export function segmentHitsRect(a: Pt, b: Pt, r: Obstacle): boolean;
  export function inVision(p: Pt, shapes: readonly VisionShape[], obstacles: readonly Obstacle[], blocked: boolean): boolean;
  export function carVisible(pose: Pose, hull: { width: number; height: number }, shapes: readonly VisionShape[], obstacles: readonly Obstacle[], blocked: boolean): boolean;
  export function shotSamplePoints(shape: WorldShape): Pt[];
  export function visionPolygon(s: VisionShape, obstacles: readonly Obstacle[], blocked: boolean, rays?: number): Pt[];
  export interface VisionPlayer { readonly sessionId: string; readonly team: number; readonly alive: boolean; readonly pose: Pose }
  export function visionPoses(input: {
    readonly perspective: { readonly sessionId: string; readonly team: number };
    readonly players: readonly VisionPlayer[];
    readonly sides: "ffa" | "team";
    readonly sharedVision: boolean;
    readonly frozenPose: Pose | undefined;
  }): Pose[];
  ```

- [ ] **Step 1: Write the failing tests** — `packages/client/src/camera/vision.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { FovConfig } from "@motor-combat-moba/shared";
import {
  carVisible,
  inShape,
  inVision,
  segmentHitsRect,
  shotSamplePoints,
  visionPolygon,
  visionPoses,
  visionShapeOf,
} from "./vision.js";

const FOV: FovConfig = {
  enabled: true, rangeX: 400, rangeY: 200, offsetX: 0, offsetY: 0, angleDeg: 90,
  blockedByObstacles: true, outsideDim: 0.5, sharedVision: true,
};
const EAST = { x: 0, y: 0, angle: 0 };

describe("visionShapeOf / inShape (CB25)", () => {
  const s = visionShapeOf(EAST, FOV);
  it("sees straight ahead inside the range", () => {
    expect(inShape({ x: 399, y: 0 }, s)).toBe(true);
  });
  it("does not see past the ellipse", () => {
    expect(inShape({ x: 401, y: 0 }, s)).toBe(false);
  });
  it("does not see outside the cone", () => {
    // 60° off the nose, well inside the ellipse, outside a 90° cone (45° half-angle).
    expect(inShape({ x: 50, y: 50 * Math.tan(Math.PI / 3) }, s)).toBe(false);
    expect(inShape({ x: 100, y: 90 }, s)).toBe(true); // ~42°
  });
  it("does not see behind", () => {
    expect(inShape({ x: -10, y: 0 }, s)).toBe(false);
  });
  it("sees all round at 360°", () => {
    const round = visionShapeOf(EAST, { ...FOV, angleDeg: 360 });
    expect(inShape({ x: -150, y: 0 }, round)).toBe(true);
  });
  it("turns with the car and offsets in the car's frame", () => {
    const south = visionShapeOf({ x: 0, y: 0, angle: Math.PI / 2 }, { ...FOV, offsetX: 100 });
    expect(south.cx).toBeCloseTo(0);
    expect(south.cy).toBeCloseTo(100);
    expect(inShape({ x: 0, y: 400 }, south)).toBe(true);
    expect(inShape({ x: 400, y: 0 }, south)).toBe(false);
  });
  it("uses rangeY across the car", () => {
    const round = visionShapeOf(EAST, { ...FOV, angleDeg: 360 });
    expect(inShape({ x: 0, y: 199 }, round)).toBe(true);
    expect(inShape({ x: 0, y: 201 }, round)).toBe(false);
  });
});

describe("segmentHitsRect", () => {
  const box = { x: 100, y: -50, w: 50, h: 100 };
  it("hits a box across the segment", () => {
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 300, y: 0 }, box)).toBe(true);
  });
  it("misses a box beside it", () => {
    expect(segmentHitsRect({ x: 0, y: 100 }, { x: 300, y: 100 }, box)).toBe(false);
  });
  it("misses a box beyond the end", () => {
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 90, y: 0 }, box)).toBe(false);
  });
});

describe("inVision (CB25, Review Focus 4)", () => {
  const shapes = [visionShapeOf(EAST, FOV)];
  const wall = { x: 100, y: -50, w: 50, h: 100 };
  it("an obstacle hides what is behind it when blocking is on", () => {
    expect(inVision({ x: 300, y: 0 }, shapes, [wall], true)).toBe(false);
  });
  it("blocking off sees through it", () => {
    expect(inVision({ x: 300, y: 0 }, shapes, [wall], false)).toBe(true);
  });
  it("spike obstacles block like any other", () => {
    expect(inVision({ x: 300, y: 0 }, shapes, [{ ...wall, kind: "spike" as const }], true)).toBe(false);
  });
  it("an obstacle containing the apex is ignored", () => {
    const around = { x: -20, y: -20, w: 40, h: 40 };
    expect(inVision({ x: 300, y: 0 }, shapes, [around], true)).toBe(true);
  });
  it("any shape in the union will do", () => {
    const west = visionShapeOf({ x: 0, y: 0, angle: Math.PI }, FOV);
    expect(inVision({ x: -300, y: 0 }, [shapes[0]!, west], [], true)).toBe(true);
    expect(inVision({ x: -300, y: 0 }, shapes, [], true)).toBe(false);
  });
  it("no shapes sees nothing", () => {
    expect(inVision({ x: 10, y: 0 }, [], [], true)).toBe(false);
  });
});

describe("carVisible", () => {
  const shapes = [visionShapeOf(EAST, FOV)];
  it("shows a car whose nose pokes into vision", () => {
    // Centre just outside the ellipse, front corners inside it.
    expect(carVisible({ x: 420, y: 0, angle: Math.PI }, { width: 60, height: 40 }, shapes, [], true)).toBe(true);
  });
  it("hides a car wholly outside", () => {
    expect(carVisible({ x: 600, y: 0, angle: 0 }, { width: 60, height: 40 }, shapes, [], true)).toBe(false);
  });
});

describe("shotSamplePoints", () => {
  it("a circle gives its centre and four rim points", () => {
    const pts = shotSamplePoints({ kind: "circle", x: 10, y: 20, radius: 5 });
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual({ x: 10, y: 20 });
  });
  it("a polygon gives its vertices and centroid", () => {
    const pts = shotSamplePoints({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
    expect(pts).toHaveLength(4);
  });
});

describe("visionPolygon (CB29)", () => {
  it("fans from the apex and stops at an obstacle", () => {
    const s = visionShapeOf(EAST, FOV);
    const poly = visionPolygon(s, [{ x: 100, y: -50, w: 50, h: 100 }], true, 8);
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    const straight = poly[1 + 4]!; // the middle ray of 9 (0..8) points dead ahead
    expect(straight.x).toBeCloseTo(100);
  });
  it("reaches the ellipse with nothing in the way", () => {
    const s = visionShapeOf(EAST, FOV);
    const poly = visionPolygon(s, [], true, 8);
    expect(poly[1 + 4]!.x).toBeCloseTo(400);
  });
});

describe("visionPoses (CB26)", () => {
  const me = { sessionId: "me", team: 0 };
  const car = (sessionId: string, team: number, alive: boolean) => ({
    sessionId, team, alive, pose: { x: team * 100, y: 0, angle: 0 },
  });
  const players = [car("me", 0, true), car("ally", 0, true), car("foe", 1, true)];

  it("is your own car in FFA", () => {
    expect(visionPoses({ perspective: me, players, sides: "ffa", sharedVision: true, frozenPose: undefined })).toHaveLength(1);
  });
  it("adds living teammates with shared vision in a team mode", () => {
    expect(visionPoses({ perspective: me, players, sides: "team", sharedVision: true, frozenPose: undefined })).toHaveLength(2);
  });
  it("keeps teammates out without shared vision", () => {
    expect(visionPoses({ perspective: me, players, sides: "team", sharedVision: false, frozenPose: undefined })).toHaveLength(1);
  });
  it("uses the frozen death pose for a dead perspective (pov)", () => {
    const dead = [car("me", 0, false), car("foe", 1, true)];
    const frozen = { x: 5, y: 5, angle: 1 };
    expect(visionPoses({ perspective: me, players: dead, sides: "ffa", sharedVision: true, frozenPose: frozen })).toEqual([frozen]);
  });
  it("is empty when dead, blind, and alone", () => {
    const dead = [car("me", 0, false), car("foe", 1, true)];
    expect(visionPoses({ perspective: me, players: dead, sides: "ffa", sharedVision: true, frozenPose: undefined })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (in `packages/client`): `npx vitest run src/camera/vision.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — `packages/client/src/camera/vision.ts`

```ts
import type { FovConfig, Obstacle, WorldShape } from "@motor-combat-moba/shared";

/**
 * Field-of-vision geometry (spec 2026-09-28-camera-behaviors-design.md, CB25–CB29). Pure: the
 * scene hands in poses and obstacles, this answers "is that point seen" and "what polygon do I
 * cut out of the dark overlay". Car-local frame: +x is the nose, +y the car's right.
 */

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface VisionShape {
  readonly cx: number;
  readonly cy: number;
  readonly heading: number;
  readonly rangeX: number;
  readonly rangeY: number;
  readonly halfAngle: number;
  readonly full: boolean;
}

const ANGLE_EPSILON = 1e-9;

/** One car's vision: an ellipse at the car-frame offset, cut to a cone from its centre (CB25). */
export function visionShapeOf(pose: Pose, fov: FovConfig): VisionShape {
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  return {
    cx: pose.x + fov.offsetX * cos - fov.offsetY * sin,
    cy: pose.y + fov.offsetX * sin + fov.offsetY * cos,
    heading: pose.angle,
    rangeX: fov.rangeX,
    rangeY: fov.rangeY,
    halfAngle: (fov.angleDeg * Math.PI) / 360,
    full: fov.angleDeg >= 360,
  };
}

/** Inside the ellipse and the cone, ignoring obstacles. */
export function inShape(p: Pt, s: VisionShape): boolean {
  const dx = p.x - s.cx;
  const dy = p.y - s.cy;
  const cos = Math.cos(s.heading);
  const sin = Math.sin(s.heading);
  const along = dx * cos + dy * sin;
  const across = -dx * sin + dy * cos;
  if ((along / s.rangeX) ** 2 + (across / s.rangeY) ** 2 > 1) return false;
  if (s.full || (along === 0 && across === 0)) return true;
  return Math.abs(Math.atan2(across, along)) <= s.halfAngle + ANGLE_EPSILON;
}

function containsPoint(r: Obstacle, p: Pt): boolean {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

/** Liang–Barsky: does segment a→b touch the axis-aligned box (top-left `x, y`)? */
export function segmentHitsRect(a: Pt, b: Pt, r: Obstacle): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x, r.x + r.w - a.x, a.y - r.y, r.y + r.h - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return false;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

function blockedFrom(apex: Pt, p: Pt, obstacles: readonly Obstacle[]): boolean {
  // An obstacle the apex sits inside would blank everything; it is ignored (Review Focus 4).
  return obstacles.some((o) => !containsPoint(o, apex) && segmentHitsRect(apex, p, o));
}

/** Seen by at least one shape, with a clear line from that shape's apex when `blocked` (CB25). */
export function inVision(
  p: Pt,
  shapes: readonly VisionShape[],
  obstacles: readonly Obstacle[],
  blocked: boolean,
): boolean {
  return shapes.some(
    (s) => inShape(p, s) && (!blocked || !blockedFrom({ x: s.cx, y: s.cy }, p, obstacles)),
  );
}

/** A car is seen when its centre or any hull corner is (CB27). */
export function carVisible(
  pose: Pose,
  hull: { width: number; height: number },
  shapes: readonly VisionShape[],
  obstacles: readonly Obstacle[],
  blocked: boolean,
): boolean {
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  const hw = hull.width / 2;
  const hh = hull.height / 2;
  const points: Pt[] = [{ x: pose.x, y: pose.y }];
  for (const [lx, ly] of [[hw, hh], [hw, -hh], [-hw, hh], [-hw, -hh]] as const) {
    points.push({ x: pose.x + lx * cos - ly * sin, y: pose.y + lx * sin + ly * cos });
  }
  return points.some((p) => inVision(p, shapes, obstacles, blocked));
}

/** Where to test a drawn shot: a circle's centre and four rim points, a polygon's vertices and centroid. */
export function shotSamplePoints(shape: WorldShape): Pt[] {
  if (shape.kind === "circle") {
    const { x, y, radius: r } = shape;
    return [{ x, y }, { x: x + r, y }, { x: x - r, y }, { x, y: y + r }, { x, y: y - r }];
  }
  const n = shape.points.length;
  if (n === 0) return [];
  const cx = shape.points.reduce((sum, p) => sum + p.x, 0) / n;
  const cy = shape.points.reduce((sum, p) => sum + p.y, 0) / n;
  return [...shape.points.map((p) => ({ x: p.x, y: p.y })), { x: cx, y: cy }];
}

/** Distance along a unit ray to an axis-aligned box, or Infinity. */
function rayToRect(o: Pt, dx: number, dy: number, r: Obstacle): number {
  let tmin = 0;
  let tmax = Infinity;
  for (const [origin, dir, lo, hi] of [
    [o.x, dx, r.x, r.x + r.w],
    [o.y, dy, r.y, r.y + r.h],
  ] as const) {
    if (Math.abs(dir) < 1e-12) {
      if (origin < lo || origin > hi) return Infinity;
      continue;
    }
    let t1 = (lo - origin) / dir;
    let t2 = (hi - origin) / dir;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/**
 * The shape as a ray fan for DRAWING the cut-out (CB29): the apex first (unless the cone is a full
 * circle), then `rays + 1` rim points across the cone, each stopped at the first obstacle when
 * `blocked`. Visibility tests use `inVision`, which is exact; this is only as fine as `rays`.
 */
export function visionPolygon(
  s: VisionShape,
  obstacles: readonly Obstacle[],
  blocked: boolean,
  rays = 96,
): Pt[] {
  const apex = { x: s.cx, y: s.cy };
  const start = s.full ? -Math.PI : -s.halfAngle;
  const span = s.full ? Math.PI * 2 : s.halfAngle * 2;
  const count = s.full ? rays : rays + 1;
  const live = blocked ? obstacles.filter((o) => !containsPoint(o, apex)) : [];
  const points: Pt[] = s.full ? [] : [apex];
  for (let i = 0; i < count; i++) {
    const local = start + (span * i) / rays;
    const rim = 1 / Math.hypot(Math.cos(local) / s.rangeX, Math.sin(local) / s.rangeY);
    const dx = Math.cos(s.heading + local);
    const dy = Math.sin(s.heading + local);
    let dist = rim;
    for (const o of live) dist = Math.min(dist, rayToRect(apex, dx, dy, o));
    points.push({ x: apex.x + dx * dist, y: apex.y + dy * dist });
  }
  return points;
}

export interface VisionPlayer {
  readonly sessionId: string;
  readonly team: number;
  readonly alive: boolean;
  readonly pose: Pose;
}

/**
 * Whose eyes the perspective player sees through (CB26): their own living car, or the frozen death
 * pose the scene passes for "pov" (undefined for "blind"); plus living teammates when vision is
 * shared in a team mode.
 */
export function visionPoses(input: {
  readonly perspective: { readonly sessionId: string; readonly team: number };
  readonly players: readonly VisionPlayer[];
  readonly sides: "ffa" | "team";
  readonly sharedVision: boolean;
  readonly frozenPose: Pose | undefined;
}): Pose[] {
  const poses: Pose[] = [];
  const self = input.players.find((p) => p.sessionId === input.perspective.sessionId);
  if (self?.alive) poses.push(self.pose);
  else if (input.frozenPose) poses.push(input.frozenPose);
  if (input.sharedVision && input.sides === "team") {
    for (const p of input.players) {
      if (p.sessionId === input.perspective.sessionId || !p.alive) continue;
      if (p.team === input.perspective.team) poses.push(p.pose);
    }
  }
  return poses;
}
```

- [ ] **Step 4: Run** (in `packages/client`): `npx vitest run src/camera/vision.test.ts` — Expected: PASS.
  If `carVisible`'s "nose pokes in" case fails, check the fixture: at `x: 420` heading west, the
  front corners sit at `x = 390` (±20), inside the 400 range and inside the 45° cone.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/camera/vision.ts packages/client/src/camera/vision.test.ts
git commit -m "feat(camera): field-of-vision geometry — ellipse cone, obstacle occlusion, shared viewers (CB25-CB26, CB29)"
```

---

### Task 7: Fx events can be filtered by visibility

**Files:**
- Create: `packages/client/src/fx/hidden.ts`, `packages/client/src/fx/hidden.test.ts`
- Modify: `packages/client/src/fx/events.ts` (shot events gain `instanceId`)
- Modify: `packages/client/src/fx/layer.ts` (`update` takes an optional `hidden`)

**Interfaces:**
- Produces:
  ```ts
  // fx/hidden.ts
  export interface FxHidden {
    readonly cars: ReadonlySet<string>;      // session ids of hidden enemy cars
    readonly instances: ReadonlySet<string>; // ids of hidden enemy weapon instances
  }
  export const NOTHING_HIDDEN: FxHidden;
  export function isHiddenFxEvent(event: FxEvent, hidden: FxHidden): boolean;
  // fx/layer.ts
  update(view: FxWorldView, dtMs: number, hidden?: FxHidden): void
  ```
  `FxEvent`'s `shotFired` / `shotEnded` members gain `instanceId: string`.

- [ ] **Step 1: Failing tests** — `packages/client/src/fx/hidden.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { deriveFxEvents, type FxWorldView } from "./events.js";
import { isHiddenFxEvent, NOTHING_HIDDEN } from "./hidden.js";

const shot = (id: string, alive = true) => ({
  id, weaponId: "predator", x: 0, y: 0, angle: 0, extent: 0, isExplosion: false, alive,
});
const view = (instances: ReturnType<typeof shot>[]): FxWorldView => ({ cars: [], instances });

describe("isHiddenFxEvent (CB27)", () => {
  const hidden = { cars: new Set(["foe"]), instances: new Set(["s1"]) };
  it("hides a hidden enemy's shot events", () => {
    const [fired] = deriveFxEvents(view([]), view([shot("s1")]));
    expect(fired?.kind).toBe("shotFired");
    expect(isHiddenFxEvent(fired!, hidden)).toBe(true);
  });
  it("hides damage and death at a hidden car", () => {
    expect(isHiddenFxEvent({ kind: "damaged", sessionId: "foe", x: 0, y: 0, amount: 5 }, hidden)).toBe(true);
    expect(isHiddenFxEvent({ kind: "died", sessionId: "foe", x: 0, y: 0 }, hidden)).toBe(true);
  });
  it("keeps everything else", () => {
    expect(isHiddenFxEvent({ kind: "damaged", sessionId: "me", x: 0, y: 0, amount: 5 }, hidden)).toBe(false);
    const [fired] = deriveFxEvents(view([]), view([shot("s2")]));
    expect(isHiddenFxEvent(fired!, hidden)).toBe(false);
    expect(isHiddenFxEvent(fired!, NOTHING_HIDDEN)).toBe(false);
  });
  it("a shot that becomes visible mid-flight fires no muzzle flash (Review Focus 5)", () => {
    // Derivation sees the full world, so the shot is not "new" on the frame it enters vision.
    const events = deriveFxEvents(view([shot("s1")]), view([shot("s1")]));
    expect(events.filter((e) => e.kind === "shotFired")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run** (in `packages/client`): `npx vitest run src/fx/hidden.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`fx/events.ts`: add `instanceId: string` to the `shotFired` and `shotEnded` union members, and set
`instanceId: id` (the map key / `instance.id`) where each is pushed in `deriveFxEvents`. Run
`npx vitest run src/fx` — any existing test comparing whole event objects with `toEqual` must gain
the `instanceId` field (update the expectation, not the code).

`fx/hidden.ts`:

```ts
import type { FxEvent } from "./events.js";

/**
 * What the local view may not show this frame (spec 2026-09-28 camera, CB27). Events are derived
 * from the FULL world and only filtered here, so a shot entering vision mid-flight is not mistaken
 * for a new one — no muzzle flash in mid-air.
 */
export interface FxHidden {
  readonly cars: ReadonlySet<string>;
  readonly instances: ReadonlySet<string>;
}

export const NOTHING_HIDDEN: FxHidden = { cars: new Set(), instances: new Set() };

export function isHiddenFxEvent(event: FxEvent, hidden: FxHidden): boolean {
  switch (event.kind) {
    case "shotFired":
    case "shotEnded":
      return hidden.instances.has(event.instanceId);
    case "damaged":
    case "died":
      return hidden.cars.has(event.sessionId);
  }
}
```

`fx/layer.ts` `update(view, dtMs, hidden: FxHidden = NOTHING_HIDDEN)`:
  - keep `const events = deriveFxEvents(this.prevView, view); this.frameEvents = events;` (camera
    shake reads `lastEvents()` for YOUR car, never hidden);
  - `const shown = events.filter((e) => !isHiddenFxEvent(e, hidden));` and use `shown` for
    `this.spawn(...)` and the decal loop;
  - pass a filtered view to the per-object passes so a hidden car lays no tyre marks and a hidden
    field draws no lava:
    ```ts
    const visibleView: FxWorldView = {
      cars: view.cars.filter((c) => !hidden.cars.has(c.sessionId)),
      instances: view.instances.filter((i) => !hidden.instances.has(i.id)),
    };
    this.layTyreMarks(visibleView, env);
    this.redrawDecals(env, dtMs);
    this.maskSmoke(visibleView, env);
    this.drawLavaFields(visibleView, env);
    this.prevView = view; // the FULL view: derivation must never see visibility
    ```
    Check `layTyreMarks` for per-car memory keyed by session id (last position): a car hidden for a
    while then shown must not lay one long streak across the gap. If it keeps a last-position map,
    delete the hidden car's entry while hidden (read the function; add a comment either way).

- [ ] **Step 4: Run** (in `packages/client`): `npx vitest run src/fx` and `npm run typecheck -w @motor-combat-moba/client` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/fx
git commit -m "feat(fx): filter derived fx events and per-object passes by visibility (CB27)"
```

---

### Task 8: FOV in `ArenaScene` — hide enemies, dim outside vision

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts` (`renderCars`, `renderShots`, `renderChargeOrbs`, `renderFx`, `syncRespawnCamera`, `create`/`drawArena` object setup, the HUD-camera ignore lists, shutdown reset)
- Modify: `packages/shared/src/modes/invariants.test.ts` (delete the rest of the CB38 test)
- Modify: `docs/config-reference.md` (FOV section wording: implemented), `packages/client/CLAUDE.md` (one paragraph: where FOV lives and the per-object rule, CB28)

**Interfaces:**
- Consumes: Task 6 (`visionShapeOf`, `inVision`, `carVisible`, `shotSamplePoints`, `visionPolygon`, `visionPoses`, `VisionShape`), Task 7 (`FxHidden`), `allegianceOf` (`scenes/combat-visual.ts`), `instanceDrawShape` (`scenes/combat-visual.ts`), `DRIVE_CONFIG.carWidth/carHeight` via `drive()`.

- [ ] **Step 1: Remove the last CB38 guard** — delete the whole "does not turn on a camera
  behaviour that is not wired yet" test from `invariants.test.ts` (CB33's bot guard stays).

- [ ] **Step 2: Per-frame vision state.** Add to `ArenaScene`:

```ts
  /** This frame's vision (CB25–CB27); empty `shapes` with `active` false means FOV is off. */
  private vision: { active: boolean; perspective: string; shapes: VisionShape[] } = {
    active: false,
    perspective: "",
    shapes: [],
  };
  /** The local car's pose on the frame it died, for "pov" (CB26). */
  private deathPose: { x: number; y: number; angle: number } | undefined;
  private dimGfx: Phaser.GameObjects.Graphics | undefined;
```

  In `syncRespawnCamera`, on the alive→dead edge (`!local.alive && this.localAlive`) store
  `this.deathPose = this.lastDrawnPose.get(sid)` (Task 5's map). On dead→alive clear it.

- [ ] **Step 3: Compute vision once per frame** — a new method called from `update` after
  `renderZone` and BEFORE `renderCars`, using last frame's drawn poses (one frame of latency is
  accepted; say so in its comment):

```ts
  private computeVision(room: Room<ArenaState>): void {
    const fov = camera().fov;
    if (!fov.enabled) {
      this.vision = { active: false, perspective: "", shapes: [] };
      return;
    }
    const localSid = this.drivenSid(room);
    const watching = this.isSpectating(room) && this.spectateTarget !== "" ? this.spectateTarget : "";
    const perspectiveSid = watching || localSid;
    const perspective = room.state.players.get(perspectiveSid);
    const players: VisionPlayer[] = [];
    room.state.players.forEach((p, sessionId) => {
      if (p.status !== PlayerStatus.IN_MATCH) return;
      const pose = this.lastDrawnPose.get(sessionId) ?? bodyOf(p);
      players.push({ sessionId, team: p.team, alive: p.alive, pose });
    });
    const frozen =
      watching === "" && camera().spectate.noTargetVision === "pov" ? this.deathPose : undefined;
    const poses = visionPoses({
      perspective: { sessionId: perspectiveSid, team: perspective?.team ?? 0 },
      players,
      sides: rulesOf(room.state.mode).sides,
      sharedVision: fov.sharedVision,
      frozenPose: frozen,
    });
    this.vision = {
      active: true,
      perspective: perspectiveSid,
      shapes: poses.map((pose) => visionShapeOf(pose, fov)),
    };
  }

  /** Is `subject` an enemy of whoever we are looking through, and out of their sight? */
  private hiddenEnemy(room: Room<ArenaState>, subjectSid: string, seen: () => boolean): boolean {
    if (!this.vision.active) return false;
    const perspective = room.state.players.get(this.vision.perspective);
    const subject = room.state.players.get(subjectSid);
    if (!perspective || !subject) return false;
    const sides = rulesOf(room.state.mode).sides;
    const enemy =
      allegianceOf(
        { sessionId: this.vision.perspective, team: perspective.team },
        { sessionId: subjectSid, team: subject.team },
        sides,
      ) === "enemy";
    return enemy && !seen();
  }
```

- [ ] **Step 4: Hide enemy cars** — in `renderCars`, after `pose` is computed and before
  `this.syncCar(...)`:

```ts
      const hull = { width: drive().carWidth, height: drive().carHeight };
      const obstacles = this.arena?.obstacles ?? [];
      const blocked = camera().fov.blockedByObstacles;
      const hidden = this.hiddenEnemy(room, sessionId, () =>
        carVisible(pose, hull, this.vision.shapes, obstacles, blocked),
      );
```

  If `hidden`: record `this.lastDrawnPose.set(sessionId, pose)` (vision still needs it), make every
  per-car display object invisible — the car container (`this.cars.get(sessionId)`), its shadow,
  its lighting/look objects and its turret (read `syncCar`, `drawCarLook`, `syncTurret` and the
  shadow helpers to find each object; add a small `setCarVisible(sessionId, visible)` helper that
  toggles them all) — skip the hp bar and maneuver draws, and `return` from the callback (but only
  after `poses.set`/`impactCars.set`, which the impact pass needs). When not hidden, call
  `setCarVisible(sessionId, true)` so a car leaving hiding reappears. Do not destroy objects.
  `drive()` must be imported from shared (check the import block). The camera-follow call at the
  end of the callback must still run for the camera target even if that car is hidden (it never is
  in practice: you never spectate outside your perspective, but keep the order safe).

- [ ] **Step 5: Hide enemy shots and charge orbs** — in `renderShots`, after `const shape = ...`:

```ts
      if (
        this.hiddenEnemy(room, instance.ownerSessionId, () =>
          shotSamplePoints(shape).some((p) =>
            inVision(p, this.vision.shapes, this.arena?.obstacles ?? [], camera().fov.blockedByObstacles),
          ),
        )
      ) {
        return;
      }
```

  In `renderChargeOrbs`, skip a player when `this.hiddenEnemy(room, sessionId, () => carVisible(...))`
  (use the player's drawn pose from `lastDrawnPose`, falling back to `bodyOf(player)`; the
  `forEach` callback needs its second `sessionId` argument).

- [ ] **Step 6: Hide enemy fx** — in `renderFx`, build an `FxHidden` from the same tests (hidden
  enemy cars by session id, hidden enemy instances by id — for instances use the same
  `shotSamplePoints(instanceDrawShape(instance, elapsedMs))` test, `elapsedMs` computed as in
  `renderShots`) and pass it as the third argument to `fx.update`. When `!this.vision.active`, pass
  `NOTHING_HIDDEN` without computing anything.

- [ ] **Step 7: The dim overlay (CB29).** In `drawArena` (after the zone graphics), create
  `this.dimGfx = this.add.graphics().setDepth(<above cars and shots, below nothing on the world
  camera>)` — find the highest world depth constant in the file (`grep -n "_DEPTH =" ArenaScene.ts`)
  and add `const FOV_DIM_DEPTH = <that + 1>;` with a comment. Make sure the HUD camera ignores it
  (follow how other world objects are added to `hud.ignore(...)` — `splitCameras` takes a one-shot
  snapshot, so create `dimGfx` before it runs, or call `this.hudCamera?.ignore(this.dimGfx)` as
  lines 2721/2805 do).

  Each frame (new `renderVisionDim()` called from `update` after `renderFx`):

```ts
  private renderVisionDim(): void {
    const gfx = this.dimGfx;
    const mask = this.visionMaskGfx;
    if (!gfx || !mask) return;
    gfx.clear();
    mask.clear();
    gfx.setVisible(this.vision.active);
    if (!this.vision.active) return;
    const fov = camera().fov;
    const cam = this.cameras.main;
    // A square that covers the view at any rotation, centred on what the camera looks at.
    const side = Math.hypot(cam.width, cam.height) / cam.zoom + 4;
    gfx.fillStyle(0x000000, fov.outsideDim);
    gfx.fillRect(cam.midPoint.x - side / 2, cam.midPoint.y - side / 2, side, side);
    // The holes: every vision polygon, filled opaque into the mask graphics.
    mask.fillStyle(0xffffff, 1);
    const obstacles = this.arena?.obstacles ?? [];
    for (const shape of this.vision.shapes) {
      mask.fillPoints(pts(visionPolygon(shape, obstacles, fov.blockedByObstacles)), true);
    }
  }
```

  (`pts` is the file's existing helper that turns `{x, y}` objects into Phaser points — check its
  name with `grep -n "function pts" ArenaScene.ts`.) Add the field
  `private visionMaskGfx: Phaser.GameObjects.Graphics | undefined;` beside `dimGfx`.

  Cutting the holes out of the cover square: Phaser 4 `Graphics` has no even-odd fill, so the mask
  graphics is applied to `dimGfx` as an INVERTED mask. Use ONE of these, verified by the smoke test
  in Step 9, and delete the other from the code:
  - **Mask filter (preferred):** `this.visionMaskGfx = this.make.graphics({}, false)` at create.
    Once at create:
    `this.dimGfx.enableFilters(); this.dimGfx.filters!.internal.addMask(this.visionMaskGfx, true);`
    (`addMask(mask, invert)` — see `node_modules/phaser/src/gameobjects/components/FilterList.js`
    ~line 575 for the exact signature and whether the mask object must be on the display list /
    needs `viewCamera` set to `this.cameras.main`).
  - **RenderTexture (fallback if the mask filter cannot be made to work):** replace `dimGfx` by a
    `this.add.renderTexture(0, 0, side, side)` repositioned each frame to the cover square;
    each frame `.clear()`, `.fill(0x000000, fov.outsideDim)`, then `.erase(this.visionMaskGfx,
    -(left), -(top))` where `left`/`top` are the cover square's world corner, then `.render()` if
    Phaser 4's DynamicTexture requires it (`node_modules/phaser/src/textures/DynamicTexture.js`).
  Either way: the polygons come from `visionPolygon(shape, this.arena.obstacles, fov.blockedByObstacles)`
  for each shape in `this.vision.shapes`; the overlay is invisible (`setVisible(false)`) when
  `!this.vision.active`.

- [ ] **Step 8: Reset** — in the shutdown/reset block, clear `deathPose`, set
  `this.vision = { active: false, perspective: "", shapes: [] }`, and null `dimGfx`/`visionMaskGfx`
  wherever the other per-scene graphics are nulled.

- [ ] **Step 9: Verify**

```bash
cd packages/shared && npx vitest run src/modes/invariants.test.ts && cd ../..
npm run typecheck -w @motor-combat-moba/client && (cd packages/client && npx vitest run)
```

Expected: PASS. Then the local-only smoke (never committed): set
`camera: { fov: { enabled: true } }` in `packages/shared/src/modes/brawl/config.ts`, rebuild shared,
`npm run dev`, start a two-player Brawl match (two browser tabs, or Playwright with
`executablePath: '/opt/pw-browsers/chromium'`), screenshot: the area outside the cone is darkened,
the other car disappears when behind you or behind a pillar, your own car and the map stay
visible. Revert the file before committing. If this cannot run in the session, say so plainly in
the task report — do not claim the overlay works.

- [ ] **Step 10: Docs** — `docs/config-reference.md`: mark `fov` as implemented, list what it hides
  (CB27) and the per-object rule (CB28). `packages/client/CLAUDE.md`: one paragraph — FOV lives in
  `camera/vision.ts` (pure) and `ArenaScene` applies it; hiding is per object; fx derive from the
  full world and are filtered (`fx/hidden.ts`); bots do not respect FOV yet (CB5, CB33).

- [ ] **Step 11: Full scope and commit**

```bash
npm test 2>&1 | tail -40
git add -A packages docs
git commit -m "feat(camera): field of vision — hide enemies outside sight, dim outside vision (CB25-CB29)"
```

Expected: same pass/fail set as the baseline.
