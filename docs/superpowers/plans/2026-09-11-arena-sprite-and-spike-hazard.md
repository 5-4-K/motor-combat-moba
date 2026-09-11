# Arena Sprite, Polygon Boundary and Spike Hazard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the real `arena-01` art on the floor, make the playable area the octagon the art
draws, and make its wall spikes deal 80 damage when a car is pushed into them.

**Architecture:** `Bounds` grows an optional list of inward half-planes, so the world boundary stays
a positional clamp (never SAT wall boxes) while describing a convex octagon instead of a rectangle.
The fourteen inward spike notches are ordinary AABB obstacles carrying a new `kind: "spike"`, which
keeps the *boundary* convex while the *playable region* is not. Damage flows shared-detects →
server-bridge-attributes → combat-applies, so death, FX events and kill booking all come for free.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared` / `server` / `client`),
Vitest for package tests, `node --test` for `scripts/*.test.mjs`, Phaser 4 on the client.

**Spec:** [`docs/superpowers/specs/2026-09-11-arena-sprite-and-spike-hazard-design.md`](../specs/2026-09-11-arena-sprite-and-spike-hazard-design.md)

## Global Constraints

- **Read the spec first.** Every task below cites decisions by number (AS1–AS31). Where this plan
  and the spec disagree, the spec wins — stop and say so rather than guessing.
- **Shared is consumed as built `dist`.** After editing `packages/shared`, run
  `npm run build -w @motor-combat-moba/shared` before the server or client will see it. Verify with
  root `npm run build`, **never** `npm run build --workspaces` (it has been observed building the
  server before shared, producing a bundle silently running the previous sim).
- **Verify with root `npm test`.** Per-workspace runs silently skip the server suite.
- **No magic numbers in logic** (hard invariant 2). Every constant lands in a shared config table.
- **`TICK_RATE_HZ` is 30** and stays 30. Millisecond knobs convert to ticks the way
  `WEAPON_TICKS` already does; do not hand-roll a second conversion helper.
- **Enum and wire values are stable** (hard invariant 7). Nothing in this plan adds a schema field
  (AS17) — if you find yourself reaching for one, stop.
- **Branch:** all work goes on `feature/arena-sprite-and-spikes`, cut from `development/main`.
  "main" means `development/main`, never `master`.
- **Every commit message ends with:**
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **Exact geometry, world units** (AS3, AS6, AS11) — copy these verbatim, do not re-derive:
  - Wall faces: `x = 74 / 1206`, `y = 54 / 666`. Playable rect `1132 × 612`.
  - Octagon, clockwise (screen coords, `+y` down):
    `(124,54) (1156,54) (1206,104) (1206,616) (1156,666) (124,666) (74,616) (74,104)`
  - Notch depth 20. Strips: top `y ∈ [54,74]`, bottom `y ∈ [646,666]`, left `x ∈ [74,94]`,
    right `x ∈ [1186,1206]`.
  - Strip spans — top and bottom (x): `129–310`, `452–565`, `715–828`, `970–1151`.
    Left and right (y): `105–200`, `305–415`, `520–615`.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `packages/shared/src/sim/boundary.ts` | `BoundaryPlane`, deriving planes from a polygon, OBB support radius, per-plane penetration. Pure geometry, no arena knowledge. |
| `packages/shared/src/sim/boundary.test.ts` | Unit tests for the above. |
| `packages/shared/src/arena/bounds.ts` | `boundsOf(arena)` — the single place a `Bounds` is built from an `ArenaDef`. |
| `packages/shared/src/arena/bounds.test.ts` | Tests for the rect default and the octagon. |
| `packages/shared/src/config/spike-config.ts` | `SPIKE_CONFIG` and its tick conversions. |
| `packages/shared/src/config/spike-config.test.ts` | Table sanity tests. |
| `packages/server/src/sim/spike-bridge.ts` | Server-side hazard state: the re-trigger lockout and the last-shover window. |
| `packages/server/src/sim/spike-bridge.test.ts` | Tests for lockout and attribution. |
| `packages/client/public/art/arenas/arena-01/floor.png` | The art (copied in, 2560×1440). |

**Modified**

| File | Change |
|---|---|
| `packages/shared/src/sim/collide.ts` | `Bounds.planes`; `boundsPush`/`resolveBounds`/`clampIntoBounds`/`pointOutsideBounds` generalised. |
| `packages/shared/src/sim/contact.ts` | `hullTouchesWorld` generalised; `ContactEvents.spikeContacts` added; detection in `resolveContacts`. |
| `packages/shared/src/sim/weapons/instances.ts` | `bounceOffWorld` reflects about a plane normal. |
| `packages/shared/src/sim/combat.ts` | `spikeHits` input; applies the damage. |
| `packages/shared/src/arena/types.ts` | `ArenaDef.boundary`, `Obstacle.kind`. |
| `packages/shared/src/arena/arena-01.ts` | Octagon, fourteen strips, new spawn tables. |
| `packages/shared/src/arena/arena.test.ts` | Clearance rule split by `kind`; polygon spawn tests; symmetry tests. |
| `packages/shared/src/index.ts` | Re-exports. |
| `packages/server/src/sim/tick.ts`, `packages/server/src/rooms/tick-pipeline.ts`, `packages/server/src/bot/brain/solution.ts`, `packages/server/src/bot/brain/duel.fixture.ts`, `packages/client/src/net/step-context.ts` | Five `{ width, height }` literals → `boundsOf(arena)`. |
| `packages/server/src/sim/ram-bridge.ts` | Feeds the spike bridge; records shoves. |
| `packages/server/src/bot/types.ts`, `packages/server/src/bot/view.ts` | `BotArenaView` carries the boundary planes. |
| `packages/server/src/bot/brain/movement.ts`, `packages/server/src/bot/brain/controller.ts`, `packages/server/src/config/bot-profiles.ts` | Boundary-aware `wallAhead`, a `spikesAhead` predicate, `BOT_BRAIN_VERSION` bump. |
| `packages/client/src/assets/asset-keys.ts` | `arenaFloorKey`. |
| `packages/client/public/art/manifest.json` | The `arena.arena-01.floor` row. |
| `packages/client/src/scenes/ArenaScene.ts` | Floor image; suppressed decoration; `kind` obstacles not drawn; spike FX. |

---

## Task 1: Boundary plane geometry

**Files:**
- Create: `packages/shared/src/sim/boundary.ts`
- Test: `packages/shared/src/sim/boundary.test.ts`

**Interfaces:**
- Consumes: `Vec2`, `Obb` from `sim/collide.ts`; `DRIVE_CONFIG` from `config/drive-config.ts`.
- Produces:
  - `interface BoundaryPlane { nx: number; ny: number; d: number }`
  - `planesOf(vertices: readonly Vec2[]): BoundaryPlane[]`
  - `rectPlanes(width: number, height: number): BoundaryPlane[]`
  - `supportRadius(angle: number, nx: number, ny: number): number`
  - `planePenetration(x: number, y: number, r: number, plane: BoundaryPlane): number`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/sim/boundary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { planePenetration, planesOf, rectPlanes, supportRadius } from "./boundary.js";

describe("rectPlanes", () => {
  it("produces four inward unit normals for a rectangle", () => {
    expect(rectPlanes(1280, 720)).toEqual([
      { nx: 1, ny: 0, d: 0 },
      { nx: 0, ny: 1, d: 0 },
      { nx: -1, ny: 0, d: -1280 },
      { nx: 0, ny: -1, d: -720 },
    ]);
  });
});

describe("planesOf", () => {
  it("derives the same planes from a clockwise rectangle", () => {
    const planes = planesOf([
      { x: 0, y: 0 },
      { x: 1280, y: 0 },
      { x: 1280, y: 720 },
      { x: 0, y: 720 },
    ]);
    // Same set, edge order rather than rectPlanes' axis order.
    for (const p of planes) expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1, 12);
    expect(planes).toHaveLength(4);
    // Every corner is on or inside every plane.
    for (const c of [{ x: 0, y: 0 }, { x: 1280, y: 720 }, { x: 640, y: 360 }]) {
      for (const p of planes) expect(p.nx * c.x + p.ny * c.y - p.d).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("points a chamfer's normal into the arena", () => {
    // The top-left chamfer of ARENA_01, as its own two-vertex edge. Vertex order matters: this is
    // the CLOCKWISE direction, the same one the octagon winds. Reversed, the normal points out.
    const [plane] = planesOf([{ x: 74, y: 104 }, { x: 124, y: 54 }]);
    expect(plane!.nx).toBeCloseTo(Math.SQRT1_2, 12);
    expect(plane!.ny).toBeCloseTo(Math.SQRT1_2, 12);
    // The arena centre is well inside it.
    expect(plane!.nx * 640 + plane!.ny * 360 - plane!.d).toBeGreaterThan(0);
  });
});

describe("supportRadius", () => {
  it("matches the axis-aligned half-extent an axis normal implies", () => {
    const { carWidth, carHeight } = DRIVE_CONFIG;
    const angle = 0.7;
    const c = Math.abs(Math.cos(angle));
    const s = Math.abs(Math.sin(angle));
    expect(supportRadius(angle, 1, 0)).toBeCloseTo((c * carWidth + s * carHeight) / 2, 12);
    expect(supportRadius(angle, 0, 1)).toBeCloseTo((s * carWidth + c * carHeight) / 2, 12);
  });

  it("is half the length along the car's own forward axis", () => {
    expect(supportRadius(0, 1, 0)).toBeCloseTo(DRIVE_CONFIG.carWidth / 2, 12);
    expect(supportRadius(0, 0, 1)).toBeCloseTo(DRIVE_CONFIG.carHeight / 2, 12);
  });
});

describe("planePenetration", () => {
  const left = { nx: 1, ny: 0, d: 0 };

  it("is zero for a body clear of the plane", () => {
    expect(planePenetration(500, 360, 24, left)).toBeLessThanOrEqual(0);
  });

  it("is how far the hull pokes through", () => {
    expect(planePenetration(10, 360, 24, left)).toBeCloseTo(14, 12);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/sim/boundary.test.ts --root packages/shared`
Expected: FAIL — `Failed to resolve import "./boundary.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/sim/boundary.ts`:

```ts
import { DRIVE_CONFIG } from "../config/drive-config.js";
import type { Vec2 } from "./collide.js";

/**
 * One inward half-plane of a convex world boundary. A point `p` is inside when
 * `nx * p.x + ny * p.y >= d`, so `(nx, ny)` is a UNIT normal pointing INTO the arena — the same
 * direction the resulting push is applied along, which is what lets `applyContact` take it
 * unchanged.
 *
 * Half-planes rather than wall boxes on purpose (AS7). A clamp cannot pick the wrong separating
 * axis for a deeply penetrating body; a thin SAT wall box would happily eject a fast car out the
 * far side. See `resolveBounds` in `collide.ts`, which has said so since before there were planes.
 */
export interface BoundaryPlane {
  nx: number;
  ny: number;
  d: number;
}

/**
 * The four planes of the axis-aligned rectangle `0,0 -> width,height`.
 *
 * Spelled out rather than routed through `planesOf` so the default costs no trig and lands on
 * exact integers: an arena that declares no boundary must behave bit-identically to the code this
 * replaced, and `cos(PI/2)` is not exactly 0.
 */
export function rectPlanes(width: number, height: number): BoundaryPlane[] {
  return [
    { nx: 1, ny: 0, d: 0 },
    { nx: 0, ny: 1, d: 0 },
    { nx: -1, ny: 0, d: -width },
    { nx: 0, ny: -1, d: -height },
  ];
}

/**
 * Planes from a convex polygon wound CLOCKWISE in screen coordinates (`+y` down).
 *
 * For an edge `a -> b` with direction `e`, the inward normal is `(-e.y, e.x)` normalised. Check it
 * against the top edge of a rectangle: `e = (+w, 0)` gives `(0, +w)`, i.e. straight down, into the
 * arena. Winding the polygon the other way inverts every normal and turns the boundary inside out,
 * which is why `arena.test.ts` asserts the arena centre is inside every plane.
 *
 * Degenerate edges (a repeated vertex) are dropped rather than producing a NaN normal.
 */
export function planesOf(vertices: readonly Vec2[]): BoundaryPlane[] {
  const planes: BoundaryPlane[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len === 0) continue;
    const nx = -ey / len;
    const ny = ex / len;
    planes.push({ nx, ny, d: nx * a.x + ny * a.y });
  }
  return planes;
}

/**
 * How far the car's hull reaches from its centre along `(nx, ny)` — the OBB's support radius.
 *
 * This is the generalisation of `hullHalfExtents` in `collide.ts`: project both half-extents onto
 * the normal and add. For `(1, 0)` and `(0, 1)` it reproduces that function exactly, which is the
 * property `boundary.test.ts` pins and what makes a rectangular arena unchanged.
 */
export function supportRadius(angle: number, nx: number, ny: number): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const { carWidth, carHeight } = DRIVE_CONFIG;
  // (c, s) is the car's forward axis (length carWidth); (-s, c) is its lateral axis (carHeight).
  return Math.abs(nx * c + ny * s) * (carWidth / 2) + Math.abs(-nx * s + ny * c) * (carHeight / 2);
}

/**
 * How deep a hull of support radius `r` centred at `(x, y)` pokes through `plane`. Positive means
 * penetrating; zero or negative means clear. Push the body by `plane.n * penetration` to separate.
 */
export function planePenetration(x: number, y: number, r: number, plane: BoundaryPlane): number {
  return plane.d + r - (plane.nx * x + plane.ny * y);
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/sim/boundary.test.ts --root packages/shared`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/boundary.ts packages/shared/src/sim/boundary.test.ts
git commit
```

---

## Task 2: Resolve a car against boundary planes

**Files:**
- Modify: `packages/shared/src/sim/collide.ts` (the `Bounds` interface at :31, `boundsPush` at :166, `resolveBounds` at :189, `clampIntoBounds` at :202)
- Test: `packages/shared/src/sim/collide.test.ts`

**Interfaces:**
- Consumes: `BoundaryPlane`, `supportRadius`, `planePenetration`, `rectPlanes` (Task 1).
- Produces: `Bounds` gains `planes?: readonly BoundaryPlane[]`. `resolveWorld`'s signature is
  unchanged; every caller keeps compiling.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/sim/collide.test.ts`:

```ts
describe("polygon bounds", () => {
  const RECT = { width: 1280, height: 720 };
  // ARENA_01's top-left chamfer, as a boundary with that one plane plus the rectangle.
  const OCTAGON = {
    width: 1280,
    height: 720,
    planes: [
      ...rectPlanes(1280, 720),
      { nx: Math.SQRT1_2, ny: Math.SQRT1_2, d: Math.SQRT1_2 * 124 + Math.SQRT1_2 * 54 },
    ],
  };

  const bodyAt = (x: number, y: number, angle = 0) => ({
    x, y, angle, vx: 0, vy: 0, reverseHold: 0, angVel: 0,
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
  });

  it("is identical to the rectangle when no planes are declared", () => {
    const out = resolveWorld(bodyAt(5, 360), [], [], RECT, 50);
    expect(out.x).toBeCloseTo(DRIVE_CONFIG.carWidth / 2, 9);
  });

  it("pushes a car out of a diagonal plane along that plane's normal", () => {
    // Deep inside the chamfer corner: both x and y are inside the rect, so only the diagonal bites.
    const out = resolveWorld(bodyAt(90, 60), [], [], OCTAGON, 50);
    const pushX = out.x - 90;
    const pushY = out.y - 60;
    expect(pushX).toBeGreaterThan(0);
    expect(pushY).toBeGreaterThan(0);
    expect(pushX).toBeCloseTo(pushY, 9); // a 45-degree normal pushes equally on both axes
  });

  it("leaves a car well inside the polygon untouched", () => {
    const out = resolveWorld(bodyAt(640, 360), [], [], OCTAGON, 50);
    expect(out.x).toBe(640);
    expect(out.y).toBe(360);
  });

  it("bounces velocity about the diagonal normal, not about an axis", () => {
    const body = { ...bodyAt(90, 60), vx: -100, vy: -100 };
    const out = resolveWorld(body, [], [], OCTAGON, 50);
    // Moving straight into a 45-degree wall: the reflected velocity opposes the entry direction.
    expect(out.vx).toBeGreaterThan(0);
    expect(out.vy).toBeGreaterThan(0);
  });
});
```

Add `rectPlanes` and `DRIVE_CONFIG` to that file's imports if they are not already there.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/sim/collide.test.ts --root packages/shared`
Expected: FAIL — the diagonal cases, because `Bounds` has no `planes` and the octagon resolves as a
plain rectangle.

- [ ] **Step 3: Write the implementation**

In `collide.ts`, extend the interface (keep the existing doc comment above it):

```ts
/** Arena extent. The world is `[0, width] x [0, height]`, top-left origin. */
export interface Bounds {
  width: number;
  height: number;
  /**
   * The convex boundary, as inward half-planes. Absent means the plain rectangle above, which is
   * what every rectangular arena and every test fixture gets (AS6). Built once by `boundsOf`.
   */
  planes?: readonly BoundaryPlane[];
}
```

Replace `boundsPush` with a plane walk, and make both callers use it:

```ts
/**
 * The correction that brings the car's hull back inside the arena, resolved plane by plane.
 *
 * Sequential rather than summed: each plane is measured against the position the previous plane
 * left the body at. For an axis-aligned rectangle the two are identical — an x push cannot change
 * a y penetration — so this is a no-op for every arena that declares no polygon. For a chamfer it
 * is the difference between converging on the corner and overshooting it.
 */
function boundsPush(body: SimBody, bounds: Bounds): Vec2 {
  const planes = bounds.planes ?? rectPlanes(bounds.width, bounds.height);
  let x = body.x;
  let y = body.y;
  for (const plane of planes) {
    const r = supportRadius(body.angle, plane.nx, plane.ny);
    const pen = planePenetration(x, y, r, plane);
    if (pen > 0) {
      x += plane.nx * pen;
      y += plane.ny * pen;
    }
  }
  return { x: x - body.x, y: y - body.y };
}

/**
 * Bounds contact with bounce, one `applyContact` per violated plane so a corner reflects off both
 * walls rather than off some blended diagonal. That was the rule when bounds were two axes and it
 * is the rule now that they are N planes.
 */
function resolveBounds(body: SimBody, bounds: Bounds): SimBody {
  const planes = bounds.planes ?? rectPlanes(bounds.width, bounds.height);
  let next = body;
  for (const plane of planes) {
    const r = supportRadius(next.angle, plane.nx, plane.ny);
    const pen = planePenetration(next.x, next.y, r, plane);
    if (pen > 0) next = applyContact(next, { x: plane.nx * pen, y: plane.ny * pen });
  }
  return next;
}
```

`clampIntoBounds` keeps its body — it already calls `boundsPush` and adds the result — so it needs
no edit beyond inheriting the new push.

Add the import at the top of `collide.ts`:

```ts
import { planePenetration, rectPlanes, supportRadius, type BoundaryPlane } from "./boundary.js";
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run --root packages/shared`
Expected: PASS, including every pre-existing collide, step, ram and golden test. **If
`golden.test.ts` fails, stop** — it means the rectangle path changed, which this task must not do.
Diagnose rather than re-pinning.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/collide.ts packages/shared/src/sim/collide.test.ts
git commit
```

---

## Task 3: The other three boundary readers

**Files:**
- Modify: `packages/shared/src/sim/collide.ts:443` (`pointOutsideBounds`)
- Modify: `packages/shared/src/sim/contact.ts:119` (`hullTouchesWorld`)
- Modify: `packages/shared/src/sim/weapons/instances.ts:396` (`bounceOffWorld`)
- Test: `packages/shared/src/sim/collide.test.ts`, `packages/shared/src/sim/contact.test.ts`,
  `packages/shared/src/sim/weapons/instances.test.ts`

**Interfaces:**
- Consumes: `Bounds.planes` (Task 2).
- Produces: no signature changes. All three keep their exact parameter lists.

- [ ] **Step 1: Write the failing tests**

In `collide.test.ts`:

```ts
describe("pointOutsideBounds with planes", () => {
  const OCT = { width: 1280, height: 720, planes: [
    ...rectPlanes(1280, 720),
    { nx: Math.SQRT1_2, ny: Math.SQRT1_2, d: Math.SQRT1_2 * 124 + Math.SQRT1_2 * 54 },
  ] };

  it("calls a point past the chamfer out, though it is inside the rectangle", () => {
    expect(pointOutsideBounds(80, 60, OCT)).toBe(true);
    expect(pointOutsideBounds(80, 60, { width: 1280, height: 720 })).toBe(false);
  });

  it("keeps the inclusive-on-the-edge convention", () => {
    // Exactly on the left wall is out, as it always has been.
    expect(pointOutsideBounds(0, 360, OCT)).toBe(true);
  });

  it("calls the centre in", () => {
    expect(pointOutsideBounds(640, 360, OCT)).toBe(false);
  });
});
```

In `contact.test.ts`:

```ts
it("reports a hull near a chamfer as touching the world", () => {
  const OCT = { width: 1280, height: 720, planes: [
    ...rectPlanes(1280, 720),
    { nx: Math.SQRT1_2, ny: Math.SQRT1_2, d: Math.SQRT1_2 * 124 + Math.SQRT1_2 * 54 },
  ] };
  const hull = { x: 120, y: 90, angle: 0, w: 48, h: 32 };
  expect(hullTouchesWorld(hull, [], OCT, 2)).toBe(true);
  expect(hullTouchesWorld({ ...hull, x: 640, y: 360 }, [], OCT, 2)).toBe(false);
});
```

In `weapons/instances.test.ts`:

```ts
it("reflects a bouncing projectile about a diagonal plane", () => {
  const OCT = { width: 1280, height: 720, planes: [
    ...rectPlanes(1280, 720),
    { nx: Math.SQRT1_2, ny: Math.SQRT1_2, d: Math.SQRT1_2 * 124 + Math.SQRT1_2 * 54 },
  ] };
  // Travelling up-left into the chamfer at 135 degrees; it should come back down-right.
  const out = bounceOffWorld(120, 90, 80, 60, (-3 * Math.PI) / 4, [], OCT);
  expect(Math.cos(out.angle)).toBeGreaterThan(0);
  expect(Math.sin(out.angle)).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --root packages/shared`
Expected: FAIL on all three new cases.

- [ ] **Step 3: Write the implementations**

`pointOutsideBounds` in `collide.ts` — keep the existing doc comment, and add a sentence about
planes:

```ts
export function pointOutsideBounds(px: number, py: number, bounds: Bounds): boolean {
  if (bounds.planes === undefined) {
    return px <= 0 || py <= 0 || px >= bounds.width || py >= bounds.height;
  }
  // Inclusive on every edge, exactly as the rectangle form is: `<= 0` on the signed distance means
  // a point resting on a plane is out.
  for (const plane of bounds.planes) {
    if (plane.nx * px + plane.ny * py - plane.d <= 0) return true;
  }
  return false;
}
```

`hullTouchesWorld` in `contact.ts` — replace only the corner loop; the obstacle half below it is
unchanged:

```ts
  const planes = bounds.planes ?? rectPlanes(bounds.width, bounds.height);
  for (const c of obbCorners(hull)) {
    for (const plane of planes) {
      if (plane.nx * c.x + plane.ny * c.y - plane.d <= pad) return true;
    }
  }
```

`bounceOffWorld` in `weapons/instances.ts` — replace the four axis mirrors with a plane reflection.
Keep the obstacle branch that follows it untouched:

```ts
  const planes = bounds.planes ?? rectPlanes(bounds.width, bounds.height);
  for (const plane of planes) {
    const dist = plane.nx * x + plane.ny * y - plane.d;
    if (dist >= 0) continue;
    // Mirror the point back across the plane and reflect the heading about its normal:
    //   p' = p - 2 * dist * n        d' = d - 2 * dot(d, n) * n
    x -= 2 * dist * plane.nx;
    y -= 2 * dist * plane.ny;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const dot = dx * plane.nx + dy * plane.ny;
    a = Math.atan2(dy - 2 * dot * plane.ny, dx - 2 * dot * plane.nx);
  }
```

Add `import { rectPlanes } from "../boundary.js";` to `instances.ts` and
`import { rectPlanes } from "./boundary.js";` to `contact.ts`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run --root packages/shared`
Expected: PASS. The rectangle cases in every existing test still pass because a rectangle's plane
reflection is its axis mirror.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/collide.ts packages/shared/src/sim/contact.ts packages/shared/src/sim/weapons/instances.ts packages/shared/src/sim/collide.test.ts packages/shared/src/sim/contact.test.ts packages/shared/src/sim/weapons/instances.test.ts
git commit
```

---

## Task 4: `ArenaDef.boundary` and one `boundsOf`

**Files:**
- Modify: `packages/shared/src/arena/types.ts`
- Create: `packages/shared/src/arena/bounds.ts`, `packages/shared/src/arena/bounds.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/server/src/sim/tick.ts:309`, `packages/server/src/rooms/tick-pipeline.ts:155`,
  `packages/server/src/bot/brain/solution.ts:376`,
  `packages/server/src/bot/brain/duel.fixture.ts:254`, `packages/client/src/net/step-context.ts:68`

**Interfaces:**
- Consumes: `planesOf`, `rectPlanes` (Task 1); `Bounds` (Task 2).
- Produces: `boundsOf(arena: ArenaDef): Bounds`; `ArenaDef.boundary?: readonly Vec2[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/arena/bounds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { boundsOf } from "./bounds.js";
import { ARENA_01 } from "./arena-01.js";
import { ARENA_02 } from "./arena-02.js";

describe("boundsOf", () => {
  it("gives a rectangular arena no planes at all", () => {
    const bounds = boundsOf(ARENA_02);
    expect(bounds).toEqual({ width: ARENA_02.width, height: ARENA_02.height });
    expect(bounds.planes).toBeUndefined();
  });

  it("carries the width and height of a polygon arena unchanged", () => {
    const bounds = boundsOf(ARENA_01);
    expect(bounds.width).toBe(ARENA_01.width);
    expect(bounds.height).toBe(ARENA_01.height);
  });
});
```

`ARENA_01` has no `boundary` yet, so the second case passes trivially today and becomes meaningful
in Task 5. That is deliberate: this task is the seam, Task 5 is the data.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/arena/bounds.test.ts --root packages/shared`
Expected: FAIL — `Failed to resolve import "./bounds.js"`.

- [ ] **Step 3: Write the implementation**

In `packages/shared/src/arena/types.ts`, add to `ArenaDef` (above `palette`):

```ts
  /**
   * The playable region, as a CONVEX polygon wound clockwise in screen coordinates (`+y` down).
   * Absent means the plain rectangle `0,0 -> width,height`, which is what every arena had before
   * `arena-01` grew cut corners (AS6).
   *
   * This is NOT the same thing as `width`/`height`, which stay the image frame and the camera
   * bounds. The polygon is inset inside them.
   */
  boundary?: readonly { x: number; y: number }[];
```

And to `Obstacle`:

```ts
  /**
   * What this solid IS, for the rules that care. Absent means an ordinary block. `"spike"` marks
   * wall-mounted geometry that also damages (AS10) — it is the only kind today, and it is the only
   * obstacle allowed to sit flush against the boundary (AS13).
   */
  kind?: "spike";
```

Create `packages/shared/src/arena/bounds.ts`:

```ts
import type { Bounds } from "../sim/collide.js";
import { planesOf } from "../sim/boundary.js";
import type { ArenaDef } from "./types.js";

/**
 * The ONE place a `Bounds` is built from an arena.
 *
 * Five call sites used to spell `{ width: arena.width, height: arena.height }` by hand — the server
 * tick, the room pipeline, two bot builders and the client's step context. The moment an arena's
 * boundary is more than a rectangle, a site that misses it simulates a different world from the
 * others, and the one that matters most is the client: a client predicting against a rectangle
 * while the server simulates an octagon rubber-bands, and reads as a netcode bug rather than an
 * arena bug (AS8). Route every builder through here.
 *
 * An arena with no polygon gets NO `planes` key rather than the four rectangle planes, so the
 * default stays the integer fast path in `collide.ts` and nothing about a rectangular arena moves.
 */
export function boundsOf(arena: ArenaDef): Bounds {
  if (arena.boundary === undefined) return { width: arena.width, height: arena.height };
  return { width: arena.width, height: arena.height, planes: planesOf(arena.boundary) };
}
```

Export it from `packages/shared/src/index.ts` beside the other arena exports:

```ts
export { boundsOf } from "./arena/bounds.js";
export { planesOf, rectPlanes, supportRadius, planePenetration, type BoundaryPlane } from "./sim/boundary.js";
```

- [ ] **Step 4: Replace the five literals**

In each file, swap the object literal for `boundsOf(arena)` and import it from
`@motor-combat-moba/shared` (or the relative path, inside shared):

- `packages/server/src/sim/tick.ts:309` — `return { obstacles: arena.obstacles, bounds: boundsOf(arena) };`
- `packages/server/src/rooms/tick-pipeline.ts:155` — `bounds: boundsOf(arena),`
- `packages/server/src/bot/brain/solution.ts:376` — `bounds: boundsOf(arena),`
- `packages/server/src/bot/brain/duel.fixture.ts:254` — `bounds: boundsOf(ARENA),`
- `packages/client/src/net/step-context.ts:68` — `bounds: boundsOf(arena),`

Then grep to prove none survive:

```bash
grep -rn "width: arena.width" --include=*.ts packages/
```

Expected: no hits outside `bounds.ts` itself.

- [ ] **Step 5: Build and run the whole suite**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS across shared, server, client and scripts.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/arena packages/shared/src/index.ts packages/server/src packages/client/src/net/step-context.ts
git commit
```

---

## Task 5: `arena-01` becomes an octagon with spikes

**Files:**
- Modify: `packages/shared/src/arena/arena-01.ts`
- Modify: `packages/shared/src/arena/arena.test.ts:80` (the clearance rule), `:124` (spawn tests)
- Test: `packages/shared/src/arena/arena-01.test.ts`

**Interfaces:**
- Consumes: `ArenaDef.boundary`, `Obstacle.kind` (Task 4); `boundsOf` (Task 4).
- Produces: `ARENA_01` with a `boundary`, fourteen `kind: "spike"` obstacles and new spawn tables.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/arena/arena-01.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "../config/drive-config.js";
import { SPIKE_CONFIG } from "../config/spike-config.js";
import { pointOutsideBounds } from "../sim/collide.js";
import { ARENA_01 } from "./arena-01.js";
import { boundsOf } from "./bounds.js";

const bounds = boundsOf(ARENA_01);
const spikes = ARENA_01.obstacles.filter((o) => o.kind === "spike");
const CENTRE_X = ARENA_01.width / 2;
const CENTRE_Y = ARENA_01.height / 2;

describe("ARENA_01 boundary", () => {
  it("is a convex octagon inside the world rect", () => {
    expect(ARENA_01.boundary).toHaveLength(8);
    for (const v of ARENA_01.boundary!) {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.x).toBeLessThanOrEqual(ARENA_01.width);
      expect(v.y).toBeLessThanOrEqual(ARENA_01.height);
    }
  });

  it("wound clockwise, so every normal points at the centre", () => {
    for (const plane of bounds.planes!) {
      expect(plane.nx * CENTRE_X + plane.ny * CENTRE_Y - plane.d).toBeGreaterThan(0);
    }
  });
});

describe("ARENA_01 spike strips", () => {
  it("has fourteen of them", () => {
    expect(spikes).toHaveLength(14);
  });

  it("makes every one exactly the configured depth", () => {
    for (const s of spikes) {
      expect(Math.min(s.w, s.h)).toBe(SPIKE_CONFIG.depth);
    }
  });

  it("mirrors the top and bottom strips about the vertical centre line", () => {
    const spanOf = (o: { x: number; w: number }) => [o.x, o.x + o.w] as const;
    const top = spikes.filter((s) => s.y === 54).map(spanOf).sort((a, b) => a[0] - b[0]);
    const mirrored = [...top].map(([a, b]) => [ARENA_01.width - b, ARENA_01.width - a] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(top).toEqual(mirrored);
  });

  it("mirrors the left and right strips about the horizontal centre line", () => {
    const left = spikes.filter((s) => s.x === 74).map((o) => [o.y, o.y + o.h] as const)
      .sort((a, b) => a[0] - b[0]);
    const mirrored = [...left].map(([a, b]) => [ARENA_01.height - b, ARENA_01.height - a] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(left).toEqual(mirrored);
  });

  it("pairs every left strip with a right strip at the same span", () => {
    const spanY = (o: { y: number; h: number }) => `${o.y}-${o.y + o.h}`;
    const left = spikes.filter((s) => s.x === 74).map(spanY).sort();
    const right = spikes.filter((s) => s.x === 1186).map(spanY).sort();
    expect(left).toEqual(right);
  });
});

describe("ARENA_01 spawns", () => {
  const diagonal = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight);
  const all = [...ARENA_01.ffaSpawns, ...ARENA_01.teamASpawns, ...ARENA_01.teamBSpawns];

  it("puts every spawn inside the polygon", () => {
    for (const s of all) expect(pointOutsideBounds(s.x, s.y, bounds)).toBe(false);
  });

  it("clears every spike strip by more than a car diagonal", () => {
    for (const s of all) {
      for (const box of spikes) {
        const dx = Math.max(box.x - s.x, 0, s.x - (box.x + box.w));
        const dy = Math.max(box.y - s.y, 0, s.y - (box.y + box.h));
        expect(Math.hypot(dx, dy)).toBeGreaterThan(diagonal);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/arena/arena-01.test.ts --root packages/shared`
Expected: FAIL — no `boundary`, no spike obstacles, and (until Task 6) no `SPIKE_CONFIG`. Do Task 6
first if you would rather not stub; the two are independent and either order works.

- [ ] **Step 3: Write the implementation**

Replace the body of `ARENA_01` in `packages/shared/src/arena/arena-01.ts`. Keep the file's existing
header comment and update its "one open rectangle" sentence:

```ts
/** Where a spike strip sits on each wall — the inward 20 units of the wall band (AS11). */
const TOP = { y: 54, h: 20 };
const BOTTOM = { y: 646, h: 20 };
const LEFT = { x: 74, w: 20 };
const RIGHT = { x: 1186, w: 20 };

/** Spans along the top and bottom walls, mirrored about x = 640. */
const X_SPANS = [
  [129, 310],
  [452, 565],
  [715, 828],
  [970, 1151],
] as const;

/** Spans along the left and right walls, mirrored about y = 360. */
const Y_SPANS = [
  [105, 200],
  [305, 415],
  [520, 615],
] as const;

const SPIKES = [
  ...X_SPANS.flatMap(([a, b]) => [
    { x: a, y: TOP.y, w: b - a, h: TOP.h, kind: "spike" as const },
    { x: a, y: BOTTOM.y, w: b - a, h: BOTTOM.h, kind: "spike" as const },
  ]),
  ...Y_SPANS.flatMap(([a, b]) => [
    { x: LEFT.x, y: a, w: LEFT.w, h: b - a, kind: "spike" as const },
    { x: RIGHT.x, y: a, w: RIGHT.w, h: b - a, kind: "spike" as const },
  ]),
];

export const ARENA_01 = {
  id: "arena-01",
  width: 1280,
  height: 720,
  palette: { floor: "#3b4747", obstacle: "#4a5568", border: "#2d3436" },
  /**
   * The playable floor the art draws: the wall band inset on every side, with 50-unit 45-degree
   * chamfers at the corners (AS3, AS6). Clockwise from the top-left chamfer, `+y` down.
   *
   * `width`/`height` above stay 1280x720 — the image frame and the camera bounds. This polygon is
   * inset INSIDE them, which is what lets the painted walls be visible and unreachable at once.
   */
  boundary: [
    { x: 124, y: 54 },
    { x: 1156, y: 54 },
    { x: 1206, y: 104 },
    { x: 1206, y: 616 },
    { x: 1156, y: 666 },
    { x: 124, y: 666 },
    { x: 74, y: 616 },
    { x: 74, y: 104 },
  ],
  /**
   * The fourteen spike strips, flush against the four straight walls. Ordinary solids that also
   * hurt (AS10, AS11); the chamfers carry none, matching the art.
   */
  obstacles: SPIKES,
  /**
   * The four corners and the midpoint of each long wall, one margin off the playable edge. Corner
   * cars face across the arena and the two midpoint cars face each other, so wherever the shuffle
   * in `assignSpawns` puts you, you open the match looking at the fight rather than at a wall.
   * Re-measured against the octagon in 2026-09-11 (AS27); the facing rule is unchanged.
   */
  ffaSpawns: [
    { x: 200, y: 150, angle: 0 },
    { x: 1080, y: 150, angle: Math.PI },
    { x: 200, y: 570, angle: 0 },
    { x: 1080, y: 570, angle: Math.PI },
    { x: 640, y: 150, angle: Math.PI / 2 },
    { x: 640, y: 570, angle: -Math.PI / 2 },
  ],
  /**
   * A line down each side, facing the other team. The y values divide the playable height into four
   * equal parts, so the gap between two team-mates is the same as the gap from the end car to the
   * wall — no seat on the line is more exposed than another.
   */
  teamASpawns: [
    { x: 200, y: 207, angle: 0 },
    { x: 200, y: 360, angle: 0 },
    { x: 200, y: 513, angle: 0 },
  ],
  teamBSpawns: [
    { x: 1080, y: 207, angle: Math.PI },
    { x: 1080, y: 360, angle: Math.PI },
    { x: 1080, y: 513, angle: Math.PI },
  ],
} as const satisfies ArenaDef;
```

- [ ] **Step 4: Rework the two rules in `arena.test.ts`**

The clearance rule at `:80` currently requires **every** obstacle to be a car diagonal clear of the
boundary. Split it (AS13):

Keep the existing collect-into-an-array shape — it names the offending obstacle and the gap in the
failure message, which a bare `expect` per side would throw away. Only the filter is new:

```ts
  it("keeps every ordinary obstacle at least a car diagonal clear of the arena boundary", () => {
    const tooClose = arena.obstacles
      // Wall-mounted geometry touches the boundary by definition and has its own rule below (AS13).
      .filter((o) => o.kind === undefined)
      .flatMap((o) => {
        const sides = [
          ["left", o.x],
          ["top", o.y],
          ["right", arena.width - (o.x + o.w)],
          ["bottom", arena.height - (o.y + o.h)],
        ] as const;
        return sides
          .filter(([, gap]) => gap < CAR_DIAGONAL)
          .map(([side, gap]) => `obstacle at {${o.x},${o.y}}: ${side} gap ${gap} < ${CAR_DIAGONAL}`);
      });
    expect(tooClose).toEqual([]);
  });

  it("sits every spike strip flush against a boundary plane, exactly one depth deep", () => {
    const planes = boundsOf(arena).planes ?? [];
    for (const box of arena.obstacles) {
      if (box.kind !== "spike") continue;
      expect(Math.min(box.w, box.h)).toBe(SPIKE_CONFIG.depth);
      // Its outer face lies ON some plane: the deepest corner sits at distance 0 from one of them.
      const corners = [
        { x: box.x, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x, y: box.y + box.h },
        { x: box.x + box.w, y: box.y + box.h },
      ];
      const flush = planes.some((p) =>
        corners.every((c) => p.nx * c.x + p.ny * c.y - p.d >= -1e-9) &&
        corners.some((c) => Math.abs(p.nx * c.x + p.ny * c.y - p.d) < 1e-9),
      );
      expect(flush).toBe(true);
    }
  });
```

The spawn test at `:124` (`puts every spawn inside the bounds and clear of obstacles`) changes its
inside-test from a rect comparison to `pointOutsideBounds(s.x, s.y, boundsOf(arena)) === false`.
Its clear-of-obstacles half stays as it is.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS. `golden.test.ts` may now legitimately move if its fixture resolves `arena-01` —
check, and if so re-pin it in this commit with the reason in the commit body (AS29).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/arena
git commit
```

---

## Task 6: `SPIKE_CONFIG`

**Files:**
- Create: `packages/shared/src/config/spike-config.ts`, `packages/shared/src/config/spike-config.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `TICK_RATE_HZ`.
- Produces: `SPIKE_CONFIG` with `damage`, `depth`, `triggerSpeed`, `retriggerMs`, `shoverCreditMs`,
  `contactPad`; `SPIKE_TICKS` with `retrigger` and `shoverCredit` in ticks.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../config/tick.js";
import { SPIKE_CONFIG, SPIKE_TICKS } from "./spike-config.js";

describe("SPIKE_CONFIG", () => {
  it("hurts less than the biggest weapon hit and more than the smallest", () => {
    expect(SPIKE_CONFIG.damage).toBe(80);
  });

  it("states the notch depth the arena geometry is authored against", () => {
    expect(SPIKE_CONFIG.depth).toBe(20);
  });

  it("converts its windows to whole ticks, rounded up so a window is never short", () => {
    expect(SPIKE_TICKS.retrigger).toBe(Math.ceil((SPIKE_CONFIG.retriggerMs / 1000) * TICK_RATE_HZ));
    expect(SPIKE_TICKS.shoverCredit).toBe(Math.ceil((SPIKE_CONFIG.shoverCreditMs / 1000) * TICK_RATE_HZ));
    expect(Number.isInteger(SPIKE_TICKS.retrigger)).toBe(true);
    expect(Number.isInteger(SPIKE_TICKS.shoverCredit)).toBe(true);
  });
});
```

`depth` is duplicated knowledge — it appears here and in `ARENA_01`'s strip geometry. That is
deliberate and guarded: `arena-01.test.ts` (Task 5) asserts every strip is exactly
`SPIKE_CONFIG.depth` deep, so the two cannot drift.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/config/spike-config.test.ts --root packages/shared`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import { TICK_RATE_HZ } from "../constants.js";

/**
 * The wall spikes: how much they hurt, and what it takes to make them hurt again (AS14–AS18).
 *
 * `depth` is geometry, not balance — it must match the strips `ARENA_01` authors, and
 * `arena-01.test.ts` fails if it drifts.
 */
export const SPIKE_CONFIG = {
  /** Flat, per trigger. Between a Thumper shell (60) and a Roadblock (100); nine kill a Bullseye. */
  damage: 80,
  /** How far a strip protrudes from its wall, in world units. */
  depth: 20,
  /**
   * The speed INTO the surface below which nothing happens, in units/s. Deliberately low against
   * roster top speeds of 190-267: this is the line between "resting against a wall" and "moving
   * into it", not a difficulty dial. Without it, a car parked in a notch would bleed forever.
   */
  triggerSpeed: 25,
  /**
   * How long a car is immune after a hit. Without it a shoved car takes `damage` every tick —
   * thirty times a second. At 750ms this is ~107 HP/s while pinned, so roughly six seconds of
   * sustained pressure kills a Bullseye. Expect playtest to move it.
   */
  retriggerMs: 750,
  /**
   * How long after being rammed or slammed a car's death still credits the pusher (AS21). Past it,
   * a spike death credits nobody.
   */
  shoverCreditMs: 4000,
  /** Contact slack for the overlap test, matching the scale of `RAM_CONFIG.contactPad`. */
  contactPad: 2,
} as const;

/**
 * The millisecond knobs above in ticks, converted ONCE. `Math.ceil` so a window is never short by a
 * rounding — an immunity that expires a tick early is a double hit.
 */
export const SPIKE_TICKS = {
  retrigger: Math.ceil((SPIKE_CONFIG.retriggerMs / 1000) * TICK_RATE_HZ),
  shoverCredit: Math.ceil((SPIKE_CONFIG.shoverCreditMs / 1000) * TICK_RATE_HZ),
} as const;
```

`TICK_RATE_HZ` lives in `packages/shared/src/constants.ts` (hard invariant 1 — it lives once);
import it from there and nowhere else.

Export both from `packages/shared/src/index.ts`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/config --root packages/shared`
Expected: PASS. `config.test.ts` may have a table-completeness check — if it enumerates config
modules, add `SPIKE_CONFIG` to it.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/config/spike-config.ts packages/shared/src/config/spike-config.test.ts packages/shared/src/index.ts
git commit
```

---

## Task 7: The contact pass reports spike contacts

**Files:**
- Modify: `packages/shared/src/sim/contact.ts` (`ContactEvents` at :102, `resolveContacts` at :176)
- Test: `packages/shared/src/sim/contact.test.ts`

**Interfaces:**
- Consumes: `SPIKE_CONFIG` (Task 6); `contactNormalBetween`, `carHullOf` (existing).
- Produces:
  ```ts
  export interface SpikeContact {
    sessionId: string;
    /** Unit normal pointing OUT of the strip, into the arena — the push direction. */
    nx: number;
    ny: number;
    /** Speed INTO the surface, units/s. Positive when closing. */
    speedIn: number;
  }

  /**
   * One resolved spike hit. Declared HERE, in shared, rather than in the server bridge that
   * produces it: `combat.ts` consumes it (Task 9), and shared must not depend on the server.
   */
  export interface SpikeHit {
    targetSessionId: string;
    /**
     * The car the death is credited to. The VICTIM'S OWN id when nobody shoved them, never `""` —
     * an empty id leaves `lastDamagerSessionId` untouched, which would hand the kill to whoever
     * last shot them minutes earlier. Self-credit is what the single kill-booking line reads as an
     * environment death, via its `killer !== player` guard (AS21).
     */
    sourceSessionId: string;
  }
  ```
  `ContactEvents` gains `spikeContacts: SpikeContact[]`. `resolveContacts` keeps its signature —
  it already takes `obstacles`.

- [ ] **Step 1: Write the failing test**

```ts
describe("spike contacts", () => {
  const strip = { x: 74, y: 105, w: 20, h: 95, kind: "spike" as const };
  const plain = { x: 400, y: 400, w: 20, h: 95 };
  const bounds = { width: 1280, height: 720 };

  const car = (over: Partial<ContactCar> = {}): ContactCar => ({
    sessionId: "a", x: 100, y: 150, angle: 0, vx: -100, vy: 0,
    ramAttack: 50, ramDefence: 50, maneuver: 0, slamsStunned: false,
    stunned: false, maneuverWeaponId: "", ...over,
  } as ContactCar);

  it("reports a car driving into a spike strip", () => {
    const { events } = resolveContacts([car()], new Set(), "ffa", 1, new Map(), [strip], bounds);
    expect(events.spikeContacts).toHaveLength(1);
    expect(events.spikeContacts[0]!.sessionId).toBe("a");
    expect(events.spikeContacts[0]!.speedIn).toBeGreaterThan(0);
    expect(events.spikeContacts[0]!.nx).toBeGreaterThan(0); // pushes right, into the arena
  });

  it("reports nothing for an ordinary obstacle", () => {
    const overlapping = car({ x: 410, y: 450 });
    const { events } = resolveContacts([overlapping], new Set(), "ffa", 1, new Map(), [plain], bounds);
    expect(events.spikeContacts).toHaveLength(0);
  });

  it("reports a negative speedIn for a car driving away, and leaves the filtering to the bridge", () => {
    const leaving = car({ vx: 100 });
    const { events } = resolveContacts([leaving], new Set(), "ffa", 1, new Map(), [strip], bounds);
    expect(events.spikeContacts[0]!.speedIn).toBeLessThan(0);
  });
});
```

Match the real `ContactCar` fields when you write this — read the interface at `contact.ts:32`
rather than trusting the cast above.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/sim/contact.test.ts --root packages/shared`
Expected: FAIL — `events.spikeContacts` is undefined.

- [ ] **Step 3: Write the implementation**

Add to `ContactEvents`:

```ts
  /**
   * Every car overlapping a `kind: "spike"` obstacle this tick, with the contact normal and the
   * speed into it. Raw observation only: this pass applies no threshold, no lockout and no
   * attribution, because all three are server-side state (AS19). `ram-bridge.ts` filters.
   */
  spikeContacts: SpikeContact[];
```

Add the sweep at the end of `resolveContacts`, beside the existing `wallBlockedDashers` sweep:

```ts
  const spikeContacts: SpikeContact[] = [];
  for (const c of cars) {
    const hull = carHullOf(c.x, c.y, c.angle);
    for (const box of obstacles) {
      if (box.kind !== "spike") continue;
      const n = contactNormalBetween(hull, aabbToObb(box), SPIKE_CONFIG.contactPad);
      if (n === null) continue;
      // `contactNormalBetween(a, b)` points from b toward a — out of the strip, into the arena.
      // Speed INTO the surface is therefore the NEGATIVE of the velocity's component along it.
      spikeContacts.push({
        sessionId: c.sessionId,
        nx: n.x,
        ny: n.y,
        speedIn: -(c.vx * n.x + c.vy * n.y),
      });
      break; // one report per car per tick; overlapping two strips is still one set of spikes
    }
  }
```

Two imports to get right: `aabbToObb` is currently **private** to `collide.ts` — export it there and
import it rather than writing a second copy. `carHullOf` lives in `sim/context.ts`, not in
`collide.ts`; `contact.ts` already imports it.

Return `spikeContacts` in the `events` object.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/sim --root packages/shared`
Expected: PASS. Existing `resolveContacts` callers keep compiling because the new field is additive;
fix any test fixture that builds a `ContactEvents` literal.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/contact.ts packages/shared/src/sim/collide.ts packages/shared/src/sim/contact.test.ts
git commit
```

---

## Task 8: The server bridge filters and attributes

**Files:**
- Create: `packages/server/src/sim/spike-bridge.ts`, `packages/server/src/sim/spike-bridge.test.ts`
- Modify: `packages/server/src/sim/ram-bridge.ts`

**Interfaces:**
- Consumes: `SpikeContact` **and `SpikeHit`** (Task 7 — both live in shared; this task imports
  `SpikeHit`, it does not declare one), `SPIKE_CONFIG`/`SPIKE_TICKS` (Task 6).
- Produces:
  ```ts
  export interface SpikeMemory {
    immuneUntil: Map<string, number>;   // victim -> tick
    lastShover: Map<string, { id: string; tick: number }>;
  }
  export function newSpikeMemory(): SpikeMemory
  export function recordShove(memory: SpikeMemory, victimId: string, attackerId: string, tick: number): void
  export function resolveSpikeHits(contacts: readonly SpikeContact[], memory: SpikeMemory, tick: number): SpikeHit[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { SPIKE_CONFIG, SPIKE_TICKS } from "@motor-combat-moba/shared";
import { newSpikeMemory, recordShove, resolveSpikeHits } from "./spike-bridge.js";

const into = (id: string, speedIn: number) => ({ sessionId: id, nx: 1, ny: 0, speedIn });

describe("resolveSpikeHits", () => {
  it("ignores a car resting against the strip", () => {
    expect(resolveSpikeHits([into("a", 0)], newSpikeMemory(), 1)).toEqual([]);
  });

  it("ignores a car below the trigger speed", () => {
    const slow = SPIKE_CONFIG.triggerSpeed - 1;
    expect(resolveSpikeHits([into("a", slow)], newSpikeMemory(), 1)).toEqual([]);
  });

  it("ignores a car driving away", () => {
    expect(resolveSpikeHits([into("a", -200)], newSpikeMemory(), 1)).toEqual([]);
  });

  it("hits a car pushing in above the trigger speed", () => {
    const memory = newSpikeMemory();
    expect(resolveSpikeHits([into("a", 200)], memory, 1)).toEqual([
      { targetSessionId: "a", sourceSessionId: "a" },
    ]);
  });

  it("locks out a second hit inside the retrigger window", () => {
    const memory = newSpikeMemory();
    resolveSpikeHits([into("a", 200)], memory, 1);
    expect(resolveSpikeHits([into("a", 200)], memory, 1 + SPIKE_TICKS.retrigger - 1)).toEqual([]);
  });

  it("allows one again once the window has passed", () => {
    const memory = newSpikeMemory();
    resolveSpikeHits([into("a", 200)], memory, 1);
    const later = resolveSpikeHits([into("a", 200)], memory, 1 + SPIKE_TICKS.retrigger);
    expect(later).toHaveLength(1);
  });

  it("credits a recent shover", () => {
    const memory = newSpikeMemory();
    recordShove(memory, "a", "b", 1);
    expect(resolveSpikeHits([into("a", 200)], memory, 2)).toEqual([
      { targetSessionId: "a", sourceSessionId: "b" },
    ]);
  });

  it("credits the victim itself once the shove window has expired", () => {
    const memory = newSpikeMemory();
    recordShove(memory, "a", "b", 1);
    const hits = resolveSpikeHits([into("a", 200)], memory, 1 + SPIKE_TICKS.shoverCredit + 1);
    expect(hits).toEqual([{ targetSessionId: "a", sourceSessionId: "a" }]);
  });

  it("never credits a shover to themselves", () => {
    const memory = newSpikeMemory();
    recordShove(memory, "a", "a", 1);
    expect(resolveSpikeHits([into("a", 200)], memory, 2)[0]!.sourceSessionId).toBe("a");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/sim/spike-bridge.test.ts --root packages/server`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import {
  SPIKE_CONFIG,
  SPIKE_TICKS,
  type SpikeContact,
  type SpikeHit,
} from "@motor-combat-moba/shared";

/**
 * Server-side hazard state. Deliberately NOT a schema field (AS17): `stepSim` never reads it, and
 * what crosses the wire is the already-applied HP. Same call the ram falloff stack made.
 */
export interface SpikeMemory {
  /** victim session id -> the first tick they may be hurt again. */
  immuneUntil: Map<string, number>;
  /** victim session id -> who last pushed them, and when. */
  lastShover: Map<string, { id: string; tick: number }>;
}

export function newSpikeMemory(): SpikeMemory {
  return { immuneUntil: new Map(), lastShover: new Map() };
}

/**
 * Remember that `attackerId` pushed `victimId`. Called for every ram and every slam, so any push
 * counts toward the credit window — the mechanic is "you put them there", not "you rammed them".
 */
export function recordShove(memory: SpikeMemory, victimId: string, attackerId: string, tick: number): void {
  if (attackerId === "" || attackerId === victimId) return;
  memory.lastShover.set(victimId, { id: attackerId, tick });
}

/**
 * Filter this tick's raw contacts down to the ones that actually hurt, and name who is credited.
 *
 * Two gates, in this order: the car must be moving INTO the surface faster than
 * `SPIKE_CONFIG.triggerSpeed` (so resting against a wall is free), and it must be out of its
 * retrigger lockout (so being pushed in does not bill thirty times a second).
 */
export function resolveSpikeHits(
  contacts: readonly SpikeContact[],
  memory: SpikeMemory,
  tick: number,
): SpikeHit[] {
  const hits: SpikeHit[] = [];
  for (const contact of contacts) {
    if (contact.speedIn < SPIKE_CONFIG.triggerSpeed) continue;
    const immuneUntil = memory.immuneUntil.get(contact.sessionId) ?? 0;
    if (tick < immuneUntil) continue;
    memory.immuneUntil.set(contact.sessionId, tick + SPIKE_TICKS.retrigger);

    const shove = memory.lastShover.get(contact.sessionId);
    const credited =
      shove !== undefined && tick - shove.tick <= SPIKE_TICKS.shoverCredit
        ? shove.id
        : contact.sessionId;
    hits.push({ targetSessionId: contact.sessionId, sourceSessionId: credited });
  }
  return hits;
}

/** Forget a car that has left the room, so neither map grows for the life of the process. */
export function forgetSpikeState(memory: SpikeMemory, sessionId: string): void {
  memory.immuneUntil.delete(sessionId);
  memory.lastShover.delete(sessionId);
}
```

- [ ] **Step 4: Wire it into `ram-bridge.ts`**

Hold a `SpikeMemory` on the same object that holds `ContactMemory`, created with `newSpikeMemory()`
where that is created, and call `forgetSpikeState(spikeMemory, sessionId)` wherever a leaver is
already cleaned out of `ContactMemory`.

The impulses map is already keyed by victim and each entry already carries `attackerId`, so
recording a shove is one line inside the loop that already walks it:

```ts
  for (const [victimId, entry] of impulses) {
    // ...existing impulse application...
    recordShove(memory.spikes, victimId, entry.attackerId, tick);
  }
```

Then resolve the hits once, after that loop, and return them on `ContactTickResult`:

```ts
  const spikeHits = resolveSpikeHits(events.spikeContacts, memory.spikes, tick);
  return { contactHits, statusRequests, spikeHits, /* ...existing fields... */ };
```

Add `spikeHits: SpikeHit[]` to the `ContactTickResult` interface. Every existing field stays.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npm run build -w @motor-combat-moba/shared && npx vitest run --root packages/server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/sim/spike-bridge.ts packages/server/src/sim/spike-bridge.test.ts packages/server/src/sim/ram-bridge.ts
git commit
```

---

## Task 9: Combat applies the damage

**Files:**
- Modify: `packages/shared/src/sim/combat.ts` (the `runCombat` input, and the damage application
  near `:1084` where `lastDamagerSessionId` is written)
- Modify: `packages/server/src/rooms/tick-pipeline.ts:150-165`
- Test: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `SpikeHit` (declared in shared in Task 7), `SPIKE_CONFIG` (Task 6).
- Produces: `runCombat` gains `spikeHits: readonly SpikeHit[]` beside `contactHits`.

- [ ] **Step 1: Write the failing test**

```ts
describe("spike damage", () => {
  it("takes exactly SPIKE_CONFIG.damage off the victim", () => {
    const before = playerFixture({ sessionId: "a", hp: 500 });
    const out = runCombat({ ...worldFixture(), players: [before], spikeHits: [
      { targetSessionId: "a", sourceSessionId: "a" },
    ] });
    expect(out.players[0]!.hp).toBe(500 - SPIKE_CONFIG.damage);
  });

  it("names the credited source as the last damager", () => {
    const out = runCombat({ ...worldFixture(), players: [playerFixture({ sessionId: "a", hp: 500 })],
      spikeHits: [{ targetSessionId: "a", sourceSessionId: "b" }] });
    expect(out.players[0]!.lastDamagerSessionId).toBe("b");
  });

  it("names the victim themselves for an unattributed hit, so no kill is credited", () => {
    const out = runCombat({ ...worldFixture(), players: [playerFixture({ sessionId: "a", hp: 500 })],
      spikeHits: [{ targetSessionId: "a", sourceSessionId: "a" }] });
    expect(out.players[0]!.lastDamagerSessionId).toBe("a");
  });

  it("is not amplified by corroded", () => {
    const corroded = playerFixture({ sessionId: "a", hp: 500, statuses: ["corroded"] });
    const out = runCombat({ ...worldFixture(), players: [corroded], spikeHits: [
      { targetSessionId: "a", sourceSessionId: "a" },
    ] });
    expect(out.players[0]!.hp).toBe(500 - SPIKE_CONFIG.damage);
  });

  it("skips a phased car, which still collides with the strip", () => {
    const phased = playerFixture({ sessionId: "a", hp: 500, statuses: ["phased"] });
    const out = runCombat({ ...worldFixture(), players: [phased], spikeHits: [
      { targetSessionId: "a", sourceSessionId: "a" },
    ] });
    expect(out.players[0]!.hp).toBe(500);
  });
});
```

Use whatever fixture helpers `combat.test.ts` already has instead of inventing
`playerFixture`/`worldFixture`; read the top of that file first.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/sim/combat.test.ts --root packages/shared`
Expected: FAIL — `spikeHits` is not a recognised input.

- [ ] **Step 3: Write the implementation**

Add the type and the input field, then apply the hits **in step 0**, alongside burn and repair,
before anything else this tick can act — a car the spikes kill must be dead before its own weapons
fire:

```ts
  // 0c. Environmental damage. Flat and unmodified: `scaleDamage` is deliberately NOT called, so no
  // status multiplies what a wall does (AS22). A phased car is skipped explicitly — it is not
  // solid to other cars but it DOES still collide with level geometry, so without this check
  // spawn protection would not protect anyone from the walls.
  for (const hit of spikeHits) {
    const player = players.find((p) => p.sessionId === hit.targetSessionId);
    if (player === undefined || !player.alive) continue;
    if (hasStatus(player.statuses, "phased", world.tick)) continue;
    dealDamageTo(player, SPIKE_CONFIG.damage, modsFor(player), hit.sourceSessionId);
  }
```

Three names above are the file's own, verified — use them exactly:

- **`dealDamageTo(player, amount, mods, sourceSessionId)`** (`combat.ts:1077`) is the existing HP
  writer. It stamps `lastDamagerSessionId` only when `amount > 0 && sourceSessionId !== ""`, which
  is precisely the behaviour AS21 depends on. Do **not** add a second HP writer — `sim/damage.ts`
  is the only one, and that is a standing rule in `CLAUDE.md`.
- **`hasStatus(statuses, name, tick)`** takes the status ARRAY and the tick, not the player.
- **`mods`** — reuse the per-player modifiers this function already computes around `:254`
  (`p.statuses.length === 0 ? NEUTRAL_MODIFIERS : modifiersOf(p.statuses, world.tick)`); `modsFor`
  above stands for whatever that lookup is called where you insert this. Passing them matters:
  `dealDamageTo` refuses the HP change when `mods.invulnerable`, so an invulnerable car is immune to
  spikes for free and consistently with every other damage source.

Note what is deliberately absent: no `scaleDamage` call. Every other damage source routes through it
so `corroded` can amplify; environmental damage does not (AS22), and the `corroded` test above is
what holds that.

In `tick-pipeline.ts`, pass it through at `:150-165`:

```ts
    contactHits: contact.contactHits,
    spikeHits: contact.spikeHits,
    statusRequests: contact.statusRequests,
```

**And fix the empty literal at `tick-pipeline.ts:112`**, which is the phase where no contact tick
ran:

```ts
  let contact: ContactTickResult = { contactHits: [], statusRequests: [], spikeHits: [] };
```

Miss it and the build fails there rather than anywhere near the feature — the field is required on
`ContactTickResult`, deliberately, so a phase that skips contact cannot silently carry last tick's
hits into combat.

- [ ] **Step 4: Run the whole suite**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/combat.ts packages/shared/src/sim/combat.test.ts packages/server/src/rooms/tick-pipeline.ts
git commit
```

---

## Task 10: The floor sprite

**Files:**
- Create: `packages/client/public/art/arenas/arena-01/floor.png` (copy from
  `E:\Work\PROJECT DOCS\car racer\assets\arena\arena-01_2.0.png`, 2560×1440)
- Modify: `packages/client/public/art/manifest.json`
- Modify: `packages/client/src/assets/asset-keys.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts:1144` (`drawArena`)
- Test: `packages/client/src/assets/asset-keys.test.ts`

**Interfaces:**
- Consumes: `shouldLoadAssetKey` (existing).
- Produces: `arenaFloorKey(arenaId: string): string` returning `arena.<id>.floor`.

- [ ] **Step 1: Write the failing test**

```ts
describe("arenaFloorKey", () => {
  it("namespaces by arena so the release pruner can find it", () => {
    expect(arenaFloorKey("arena-01")).toBe("arena.arena-01.floor");
  });

  it("produces a key the active arena loads and an inactive one does not", () => {
    expect(shouldLoadAssetKey(arenaFloorKey("arena-01"), "arena-01")).toBe(true);
    expect(shouldLoadAssetKey(arenaFloorKey("arena-02"), "arena-01")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/assets/asset-keys.test.ts --root packages/client`
Expected: FAIL — `arenaFloorKey is not exported`.

- [ ] **Step 3: Write the implementation**

In `asset-keys.ts`:

```ts
/**
 * The manifest key for an arena's floor art. Namespaced `arena.<id>.floor` so
 * `scripts/build-release.mjs` prunes every inactive arena's art out of the zip and
 * `shouldLoadAssetKey` skips it at boot — both of which already understand this shape.
 *
 * Unlike `carSpriteKey` there is no fallback id: an arena with no art renders procedurally, which
 * is a supported state rather than a missing asset.
 */
export function arenaFloorKey(arenaId: string): string {
  return `arena.${arenaId}.floor`;
}
```

Copy the art and add the manifest row:

```json
    "arena.arena-01.floor": {
      "file": "arenas/arena-01/floor.png",
      "colorMode": "none"
    }
```

In `drawArena`, replace the unconditional tile sprite:

```ts
    // A floor sprite when the arena has one and its texture actually loaded; the generated asphalt
    // otherwise. The fallback is the property the asset pipeline exists to protect (AS23) — a
    // missing PNG or a malformed manifest row must never be a black screen.
    const floorKey = arenaFloorKey(arena.id);
    this.hasFloorSprite = this.textures.exists(floorKey);
    if (this.hasFloorSprite) {
      this.floorImage = this.add
        .image(0, 0, floorKey)
        .setOrigin(0, 0)
        .setDisplaySize(arena.width, arena.height)
        .setDepth(FLOOR_DEPTH);
    } else {
      this.floorTile = this.add
        .tileSprite(0, 0, arena.width, arena.height, FX_TEXTURE_KEYS.asphalt)
        .setOrigin(0, 0)
        .setDepth(FLOOR_DEPTH);
    }
```

Declare `private floorImage: Phaser.GameObjects.Image | undefined;` and
`private hasFloorSprite = false;` beside the existing `floorTile` field, add `floorImage` to the
world-camera ignore list at `:1362` the same way `floorTile` is, and destroy it at `:1457`.

Guard the two other `floorTile` uses: the `setTexture` call at `:1288` must be a no-op when a sprite
is in use.

- [ ] **Step 4: Verify in the running game**

```bash
npm run dev
```

Open `http://localhost:5173`, join, and confirm the art is on the floor at 1:1 with no seams and no
stretching. Then check the fallback still works: rename the PNG, hard-refresh, confirm the
procedural asphalt returns and the console shows a single manifest warning rather than an error.
Rename it back.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`

```bash
git add packages/client/public/art packages/client/src/assets/asset-keys.ts packages/client/src/assets/asset-keys.test.ts packages/client/src/scenes/ArenaScene.ts
git commit
```

---

## Task 11: Suppress the procedural decoration, and add spike feedback

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts:1234-1270` (`redrawArenaGraphics`)
- Modify: `packages/client/src/fx/events.ts` or the contact FX module, per what `damaged` already
  uses
- Test: `packages/client/src/scenes/arena-visual.test.ts`

**Interfaces:**
- Consumes: `hasFloorSprite` (Task 10); `Obstacle.kind` (Task 4).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Extract the decision so it is testable without a scene. In `arena-visual.ts`:

```ts
/**
 * What `redrawArenaGraphics` should draw. A sprite arena carries its own markings and its own
 * walls, so painting a 4px slate border and a dashed lane grid over them reads as a rendering bug
 * (AS24). Spike strips are painted in the art too, so a `kind` obstacle is never filled (AS25).
 */
export function arenaDecoration(hasFloorSprite: boolean): {
  drawMarkings: boolean;
  drawBorder: boolean;
} {
  return { drawMarkings: !hasFloorSprite, drawBorder: !hasFloorSprite };
}

/** Which obstacles the client fills. Wall-mounted geometry is in the art already. */
export function drawableObstacles<T extends { kind?: string }>(obstacles: readonly T[]): T[] {
  return obstacles.filter((o) => o.kind === undefined);
}
```

Test:

```ts
describe("arenaDecoration", () => {
  it("draws markings and border for a procedural arena", () => {
    expect(arenaDecoration(false)).toEqual({ drawMarkings: true, drawBorder: true });
  });

  it("draws neither over a floor sprite", () => {
    expect(arenaDecoration(true)).toEqual({ drawMarkings: false, drawBorder: false });
  });
});

describe("drawableObstacles", () => {
  it("keeps ordinary blocks and drops wall-mounted ones", () => {
    expect(drawableObstacles([{ kind: "spike" }, {}, { kind: "spike" }])).toEqual([{}]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/scenes/arena-visual.test.ts --root packages/client`
Expected: FAIL — neither function exists.

- [ ] **Step 3: Write the implementation**

Add both functions to `arena-visual.ts`, then use them in `redrawArenaGraphics`: loop
`drawableObstacles(arena.obstacles)` instead of `arena.obstacles`, and wrap the markings block and
the `strokeRect` in the two flags.

While you are in the playground's environment panel, mark the `floor.*` group as inert for a sprite
arena (AS24) — it already has a convention for non-live knobs (`floor.*` needs Regenerate today), so
extend that label rather than inventing a new one. A group that silently does nothing is worse than
one that says why.

- [ ] **Step 4: Add the spike feedback**

Spike damage already produces a `damaged` FX event, because Task 9 routes it through the same damage
path every weapon uses — so the spark burst and the shake come for free and there is no new emitter
to write. What this step adds is the assertion that it stays in its lane. In `camera.test.ts`:

```ts
it("keeps a spike hit's shake at or below a kill's", () => {
  const spike = shakeFor({ kind: "damaged", amount: SPIKE_CONFIG.damage } as FxEvent);
  const died = shakeFor({ kind: "died" } as FxEvent);
  expect(spike!.intensity).toBeLessThanOrEqual(died!.intensity);
});
```

That holds by construction — `shakeFor`'s `damaged` branch caps at `max * damagedCap` (0.012)
against `died`'s `max` (0.02) — but the point of the test is that a later retune of `damagedCap`
cannot quietly make the walls shake harder than a kill.

- [ ] **Step 5: Verify in the running game**

```bash
npm run dev
```

Drive into a spike run. Confirm: the car stops at the spike tips (not past them, not short of them),
HP drops by 80 once, sparks fire, and holding the throttle against the wall does **not** drain HP
until you back off and drive in again.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`

```bash
git add packages/client/src
git commit
```

---

## Task 12: Teach the bot about the polygon and the spikes

**Files:**
- Modify: `packages/server/src/bot/brain/movement.ts:39-62`
- Modify: `packages/server/src/bot/types.ts:77` (`BotArenaView`), `packages/server/src/bot/view.ts`
- Modify: `packages/server/src/bot/brain/controller.ts:242`
- Modify: `packages/server/src/config/bot-profiles.ts` (`BRAIN_CONSTANTS`, `BOT_BRAIN_VERSION:764`)
- Test: `packages/server/src/bot/brain/movement.test.ts`

**Interfaces:**
- Consumes: `boundsOf` (Task 4), `Obstacle.kind` (Task 4).
- Produces: no new exports; `BOT_BRAIN_VERSION` increments.

**Read this before starting.** `movement.ts` does **not** expose a push-vector function. It exposes
**`wallAhead(self, arena, lookaheadUnits): boolean`** — the push vector is a local, and the
`pushX !== 0 || pushY !== 0` at the end is the whole return value. Its one consumer is
`controller.ts:242`, which uses it to decide a car is `pinned`. Two consequences shape this task:

- `arena` there is a **`BotArenaView`** (`bot/types.ts:77` — `{ width, height, obstacles }`), a
  deliberately constructed projection, never a handle on the arena def. It has no planes, so it
  must gain them and `bot/view.ts` must fill them in.
- "Stronger repulsion" cannot mean a bigger push, because there is no push to scale. It means the
  bot must notice spikes **sooner** — a longer look-ahead — which is what the per-tier
  `wallLookaheadUnits` knob already expresses.

Also note the doc comment at `movement.ts:39`: *"`arena-01` has no obstacles, so on the shipped
arena this is entirely about bounds and corners."* That sentence is false the moment Task 5 lands;
correct it. And the comment two lines below — *"an easy bot at 40 units … pins itself on walls,
which is free human-likeness"* — is the exact behaviour that now bleeds HP. It stays (pinning is
deliberate), which is precisely why `spikesAhead` must fire earlier than `wallAhead`.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/bot/brain/movement.test.ts`:

```ts
import { boundsOf, ARENA_01 } from "@motor-combat-moba/shared";
import { spikesAhead, wallAhead } from "./movement.js";

const octagon = {
  width: ARENA_01.width,
  height: ARENA_01.height,
  obstacles: ARENA_01.obstacles,
  planes: boundsOf(ARENA_01).planes,
};

describe("wallAhead on a polygon arena", () => {
  it("sees a chamfer, which a rectangle test cannot", () => {
    // (110, 80) is inside the rect on both axes and outside the octagon.
    expect(wallAhead({ x: 110, y: 80, angle: 0 }, octagon, 10)).toBe(true);
  });

  it("still calls the middle of the arena clear", () => {
    expect(wallAhead({ x: 640, y: 360, angle: 0 }, octagon, 150)).toBe(false);
  });
});

describe("spikesAhead", () => {
  it("fires for a car approaching a strip", () => {
    // Driving left toward the left wall, inside the y-span of the strip at 105-200.
    expect(spikesAhead({ x: 200, y: 150, angle: Math.PI }, octagon, 150)).toBe(true);
  });

  it("does not fire for a bare stretch of the same wall", () => {
    // y = 260 sits in the gap between the strips at 105-200 and 305-415.
    expect(spikesAhead({ x: 200, y: 260, angle: Math.PI }, octagon, 150)).toBe(false);
  });

  it("does not fire in open floor", () => {
    expect(spikesAhead({ x: 640, y: 360, angle: 0 }, octagon, 150)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/bot/brain/movement.test.ts --root packages/server`
Expected: FAIL — `spikesAhead` is not exported, and the chamfer case is `false` because the current
code compares against `arena.width`/`height`.

- [ ] **Step 3: Give `BotArenaView` the planes**

In `bot/types.ts`:

```ts
export interface BotArenaView {
  width: number;
  height: number;
  obstacles: readonly Aabb[];
  /**
   * The boundary planes, when the arena is not a plain rectangle. A projection of `boundsOf`, not a
   * handle on the arena def — same rule as every other field here. Absent means the rectangle, and
   * `wallAhead` falls back to `rectPlanes` so an arena without a polygon behaves as it always has.
   */
  planes?: readonly BoundaryPlane[];
}
```

In `bot/view.ts`, wherever the view is built, add `planes: boundsOf(arena).planes`.

- [ ] **Step 4: Make `wallAhead` plane-aware**

Replace the four axis comparisons at `movement.ts:53-56`, keeping `margin` and the accumulators:

```ts
  // Every boundary plane, not two axes: a chamfer is neither, and a bot that only knows the
  // rectangle drives into one believing it is open floor. Accumulating rather than short-circuiting
  // is deliberate and pre-existing — see this function's own note about R-O2.
  for (const plane of arena.planes ?? rectPlanes(arena.width, arena.height)) {
    if (plane.nx * aheadX + plane.ny * aheadY - plane.d < margin) {
      pushX += plane.nx;
      pushY += plane.ny;
    }
  }
```

- [ ] **Step 5: Add `spikesAhead`**

```ts
/**
 * Is there a spike strip in front of this car? The hazard-aware half of wall awareness.
 *
 * Separate from `wallAhead` rather than a weight inside it, because that function answers a
 * BOOLEAN — there is no push vector here to scale. "Avoid spikes harder" therefore means "notice
 * them sooner", which is what the caller expresses by passing a longer lookahead (AS28).
 *
 * Every tier gets this. How well a tier acts on it is already governed by the reaction and
 * execution knobs it carries; a Hard-only awareness of spikes would be exactly the branch the
 * `bot-tuner` skill exists to prevent.
 */
export function spikesAhead(
  self: { x: number; y: number; angle: number },
  arena: BotArenaView,
  lookaheadUnits: number,
): boolean {
  const aheadX = self.x + Math.cos(self.angle) * lookaheadUnits;
  const aheadY = self.y + Math.sin(self.angle) * lookaheadUnits;
  const margin = Math.max(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2;
  return arena.obstacles.some(
    (box) =>
      box.kind === "spike" &&
      aheadX > box.x - margin && aheadX < box.x + box.w + margin &&
      aheadY > box.y - margin && aheadY < box.y + box.h + margin,
  );
}
```

- [ ] **Step 6: Consume it in `controller.ts`**

At `:242`, where `pinned` is computed from `wallAhead(self, view.arena, profile.wallLookaheadUnits)`,
treat a spiked wall as arriving earlier:

```ts
    const pinned =
      wallAhead(self, view.arena, profile.wallLookaheadUnits) ||
      spikesAhead(self, view.arena, profile.wallLookaheadUnits * BRAIN_CONSTANTS.spikeLookaheadFactor);
```

Add to `BRAIN_CONSTANTS` in `packages/server/src/config/bot-profiles.ts`:

```ts
  /**
   * How much further ahead a bot looks for spikes than for a bare wall. Shared across tiers on
   * purpose: every bot understands that spikes hurt (AS28), and the tiers already differ through
   * their own `wallLookaheadUnits`.
   */
  spikeLookaheadFactor: 2,
```

- [ ] **Step 7: Bump `BOT_BRAIN_VERSION`**

It is a **semver string** at `packages/server/src/config/bot-profiles.ts:764`, currently `"4.5.1"`.
Behaviour changed while `BOT_PROFILES` did not move, which is exactly what it exists to signal, so
this is a minor bump: `"4.6.0"`. Note the reason beside it. The balance harness hashes it into the
bot fingerprint, so reports across this change are correctly refused as incomparable.

- [ ] **Step 5: Watch a bot play**

```bash
npm run dev
```

Open Practice, take a 1v1 against an **easy** bot, and watch it for a full match. It must not grind
along a spiked wall or repeatedly reverse into one. Easy is the tier to watch: its lower reaction
knobs make it the one that would suicide first.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`

```bash
git add packages/server/src/bot
git commit
```

---

## Task 13: Docs, the manual, and the probe audit

**Files:**
- Modify: `CLAUDE.md`, `docs/config-reference.md`, `docs/combat-model.md`,
  `docs/asset-pipeline.md`, `packages/client/public/art/arenas/README.md`
- Modify: `packages/client/public/manual.html` (generated — do not hand-edit)
- Read: `packages/server/playtest/collision.ts`, `geometry.ts`, `world.ts`, `prediction.ts`

- [ ] **Step 1: Rebuild the cars & weapons guide**

The guide's fingerprint covers `ARENA_WIDTH`, and the playable area is exactly the kind of number it
exists to keep honest.

```bash
npm run build:manual
```

Then `npm test` — `scripts/manual-page.test.mjs` recomputes the fingerprint and fails if the page
was not rebuilt.

- [ ] **Step 2: Update the docs**

- `CLAUDE.md` — the arena is no longer "one open rectangle": note the polygon boundary, the spike
  hazard as the game's **first environmental damage source**, and `arena.arena-01.floor` as the
  first live arena art key. Also correct the standing claim that ramming is the only contact rule.
- `docs/config-reference.md` — `SPIKE_CONFIG`, `SPIKE_TICKS`, `ArenaDef.boundary`, `Obstacle.kind`.
- `docs/combat-model.md` — spike damage, its two gates, and its attribution rule, beside elimination.
- `docs/asset-pipeline.md` and `packages/client/public/art/arenas/README.md` — the latter currently
  reads "Nothing lives here yet." It does now.
- `docs/schema-reference.md` — no edit, but confirm out loud in the commit body that nothing here is
  a schema field (AS17).
- `docs/turn-tuning.md` — **no edit and no test failure expected**: nothing in this plan touches a
  car rating, `DRIVE_CONFIG`, a `STATUS_TABLE` `turnRate`, `RAM_CONFIG.spinMaxRate` or
  `TICK_RATE_HZ`. If `scripts/turn-tuning-doc.test.mjs` fails, something in this plan changed a knob
  it should not have — find it rather than editing the page.

- [ ] **Step 3: Audit the playtest probes**

Read each of the four and write down, for each: does it still compile, does it still reach the code
path it was written for, and does it quote a number this change moved?

**Fix a probe that no longer compiles** — a probe that does not build measures nothing. **Do not**
update thresholds or expectations; that is the user's call.

- [ ] **Step 4: Report, loudly**

In the final summary, name each affected probe and the number it measures, state that the playable
area shrank 25% and that a new damage source landed, and recommend:

```bash
npm run playtest
npm run balance
```

Say plainly that `BOT_BRAIN_VERSION` moved (Task 12), so the balance harness's `--baseline` flag
will refuse to compare this run against any earlier one — correctly.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs packages/client/public/manual.html packages/server/playtest
git commit
```

---

## Definition of done

- [ ] `npm test` passes from the repo root.
- [ ] `npm run build` (root, not `--workspaces`) succeeds, and
      `grep -c "spike" packages/server/dist/index.js` is non-zero — proving the server bundle
      inlined the new shared `dist` rather than a stale one.
- [ ] The arena renders the art, cars stop at the spike tips, and driving into spikes costs 80 HP
      once per push-in.
- [ ] An easy bot plays a full practice match without killing itself on a wall.
- [ ] The playtest and balance recommendations have been made to the user, with probe names.
