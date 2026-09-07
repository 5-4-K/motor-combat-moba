# Stage 2: Contact and Impulse — Implementation Plan

> **EXECUTED — 2026-09-06, in 9 commits. Its unchecked `- [ ]` boxes below are historical, not a
> to-do list.** Written against spec revision 1, and **partly superseded**: the plumbing survives
> (`Impulse`, the single-applier seam, `resolveWorld`'s fifth parameter, `CarObstacle`), but the
> mass-derived parts and equal-and-opposite reactions were replaced by stage 3's contest —
> `reactionOf` no longer exists. **Do not re-execute it, and do not trust a step here over the
> shipped code** — read [`EXECUTION.md`](EXECUTION.md) first.

> **SUPERSEDED NOTE (2026-09-06).** This plan executed as written — the tasks below are history, not
> being rewritten. But the design has since moved on: **Task 4** (routing ram and slam through the
> equal-and-opposite `reactionOf` reaction) and **the mass-weighted parts of Task 2** (splitting
> car-vs-car separation by `mass`) are superseded by a revised design. `mass` is being removed from
> the game entirely, replaced by per-car `attack` and `defence` stats, and the equal-and-opposite
> reaction is being replaced by a contest between the two cars' pushes — each side's outcome computed
> directly from the other car's push, not derived by negating its own. See
> [`docs/superpowers/specs/2026-09-06-car-physics-rework-design.md`](../../specs/2026-09-06-car-physics-rework-design.md)
> for the authority. Everything else this plan built stands: walls deflecting and
> `restitution: 0.15` (Task 1), the `Impulse` struct and its single-applier seam (Task 3),
> edge-triggered contact, and `resolveWorld`'s fifth parameter plus the `CarObstacle` plumbing (the
> plumbing stays — only `mass` becoming `defence` changes what value it carries).

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make contact behave like a collision — walls deflect, mass decides who moves, and every
push in the game goes through one applier that is equal and opposite.

**Architecture:** `applyContact` stops discarding the reflected direction. `resolveWorld` splits its
separation by mass. A new `Impulse` struct and `applyImpulse` become the single path by which
anything changes a car's velocity from outside, and `reactionOf` gives the attacker its half.

**Tech Stack:** TypeScript, npm workspaces, Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-06-car-physics-rework-design.md`](../../specs/2026-09-06-car-physics-rework-design.md) (P9–P16)

**Ledger:** [`interfaces.md`](interfaces.md)

**Depends on:** Stage 1 complete. `SimBody` carries `vx`/`vy`; `speed`, `shoveX`, `shoveY` and
`authority` are gone.

## Global Constraints

Identical to stage 1 — see [`01-vector-drive.md`](01-vector-drive.md#global-constraints). The ones
that bite hardest here:

- No magic numbers in logic. Every constant comes from `shared/config`.
- `stepSim` is the lockstep; server and client import the same function.
- The complete verification gate is root `npm test`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/shared/src/sim/collide.ts` | Whole-velocity reflection; mass-weighted separation. | Modify |
| `packages/shared/src/sim/impulse.ts` | The `Impulse` struct, `applyImpulse`, `reactionOf`. | Create |
| `packages/shared/src/sim/impulse.test.ts` | Tests for the above. | Create |
| `packages/shared/src/sim/ram.ts` | `RamKnock` → `Impulse`. | Modify |
| `packages/shared/src/sim/contact.ts` | Slam builds an `Impulse`; attacker reactions collected. | Modify |
| `packages/server/src/sim/ram-bridge.ts` | Applies impulses to both cars. | Modify |
| `packages/shared/src/config/drive-config.ts` | `restitution` 0.35 → 0.15. | Modify |
| `packages/shared/src/sim/context.ts` | `otherCarHulls` gains mass, for weighted separation. | Modify |

---

## Task 1: Walls deflect

**Files:**
- Modify: `packages/shared/src/sim/collide.ts`
- Modify: `packages/shared/src/config/drive-config.ts`
- Test: `packages/shared/src/sim/collide.test.ts`

**Interfaces:**
- Consumes: `SimBody.vx/vy` from stage 1.
- Produces: `applyContact` that preserves the reflected direction. Nothing new is exported.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/sim/collide.test.ts`:

```ts
import { forwardOf, lateralOf, speedOf } from "./velocity.js";

describe("contact reflection preserves direction", () => {
  it("deflects a car that glances a wall instead of pinning it", () => {
    // Facing 45 degrees into the left wall, moving along the facing at 200.
    const angle = Math.PI * 0.75; // up and to the left
    const v = toWorld(angle, 200, 0);
    const body = { ...restBody(), x: 10, y: 300, angle, vx: v.vx, vy: v.vy };

    const next = resolveWorld(body, [], [], { width: 1280, height: 720 });

    // It must now be travelling ALONG the wall (mostly +y), not stopped facing into it.
    expect(Math.abs(next.vy)).toBeGreaterThan(Math.abs(next.vx) * 2);
    // And the facing is untouched — collision resolution never rotates a car.
    expect(next.angle).toBeCloseTo(angle);
  });

  it("keeps most of its speed through a glancing blow", () => {
    const angle = Math.PI * 0.75;
    const v = toWorld(angle, 200, 0);
    const body = { ...restBody(), x: 10, y: 300, angle, vx: v.vx, vy: v.vy };

    const next = resolveWorld(body, [], [], { width: 1280, height: 720 });
    expect(speedOf(next.vx, next.vy)).toBeGreaterThan(120);
  });

  it("a glancing blow leaves the car with real lateral motion", () => {
    // The whole point: the reflected direction no longer collapses onto the heading.
    const angle = Math.PI * 0.75;
    const v = toWorld(angle, 200, 0);
    const body = { ...restBody(), x: 10, y: 300, angle, vx: v.vx, vy: v.vy };

    const next = resolveWorld(body, [], [], { width: 1280, height: 720 });
    expect(Math.abs(lateralOf(next.vx, next.vy, next.angle))).toBeGreaterThan(50);
  });

  it("still barely rebounds head-on, because cars are not billiard balls", () => {
    const body = { ...restBody(), x: 10, y: 300, angle: Math.PI, vx: -200, vy: 0 };
    const next = resolveWorld(body, [], [], { width: 1280, height: 720 });
    // restitution 0.15: it comes back at about 15% of what it arrived with, not 35%.
    expect(next.vx).toBeGreaterThan(0);
    expect(next.vx).toBeLessThan(200 * 0.25);
  });
});
```

`restBody()` is the existing helper in that file; add `vx: 0, vy: 0` to it if stage 1's port did not.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/sim/collide.test.ts -t "deflects a car"`
Expected: FAIL — the velocity is still re-projected onto the heading, so `vy` does not dominate.

- [ ] **Step 3: Delete the discard**

In `applyContact`, remove the three lines stage 1 flagged with `STAGE 2 REMOVES THE NEXT THREE LINES`
and return the reflected velocity whole:

```ts
/**
 * Positional correction along `push`, then the bounce. With `n` the unit push direction (pointing
 * out of the surface, toward the car):
 *
 *   if dot(v, n) < 0:  v' = v - (1 + restitution) * dot(v, n) * n
 *
 * `angle` never changes during resolution — collision does not rotate a car — but the VELOCITY is
 * now free to point somewhere other than the facing. That is what makes a wall deflect rather than
 * merely damp: before this rework the reflected direction was discarded and only its magnitude
 * survived along the unchanged heading, so a car angled into a wall ground along it, pinned to the
 * boundary, still facing in. It now slides off, which is also what makes a car-to-car bounce read
 * as a bounce.
 */
function applyContact(body: SimBody, push: Vec2): SimBody {
  const length = Math.hypot(push.x, push.y);
  if (length <= MIN_OVERLAP) return body;
  const n: Vec2 = { x: push.x / length, y: push.y / length };

  let vx = body.vx;
  let vy = body.vy;
  const intoSurface = vx * n.x + vy * n.y;
  if (intoSurface < 0) {
    const scale = (1 + DRIVE_CONFIG.restitution) * intoSurface;
    vx -= scale * n.x;
    vy -= scale * n.y;
  }

  return { ...body, x: body.x + push.x, y: body.y + push.y, vx, vy };
}
```

Delete the two-item numbered list in that function's old doc comment describing the discard's
consequences — both consequences are gone, and a comment describing behaviour the code no longer has
is worse than no comment.

- [ ] **Step 4: Lower restitution**

In `drive-config.ts`:

```ts
  /**
   * Coefficient of restitution for every contact — walls, obstacles and cars alike.
   *
   * 0.15, down from 0.35 on 2026-09-06. Real cars are built to crush, not bounce, and sit around
   * 0.1-0.15; a T-bone is a shunt, not a billiard shot. The knockback this game wants comes from
   * momentum transfer through `applyImpulse`, not from springiness here — raising this to get
   * bigger knocks is reaching for the wrong knob and makes every wall graze feel rubbery.
   */
  restitution: 0.15,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/shared/src/sim/collide.test.ts`
Expected: PASS. Several *existing* assertions in that file encode the old grind-along-the-wall
behaviour; they are now wrong about what the game does. Update them to assert deflection, and delete
any that exist only to pin the sign-flip discontinuity at 30.6° — that artefact was a consequence of
the discard and no longer exists.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/collide.ts packages/shared/src/sim/collide.test.ts packages/shared/src/config/drive-config.ts
git commit -m "feat(sim): walls deflect instead of damping; restitution 0.35 -> 0.15"
```

---

## Task 2: Mass-weighted separation

**Files:**
- Modify: `packages/shared/src/sim/context.ts`
- Modify: `packages/shared/src/sim/collide.ts`
- Test: `packages/shared/src/sim/collide.test.ts`

**Interfaces:**
- Consumes: `massOf` from `config/car-config.ts`.
- Produces: `resolveWorld(body, others, obstacles, bounds, selfMass)` — **a fifth parameter**, and
  `others` becomes `readonly CarObstacle[]` where `CarObstacle = { hull: Obb; mass: number }`.

- [ ] **Step 1: Write the failing test**

```ts
describe("mass-weighted separation", () => {
  const BOUNDS = { width: 1280, height: 720 };

  it("moves the light car further than the heavy one out of the same overlap", () => {
    // Same overlap geometry, resolved from each car's point of view.
    const light = { ...restBody(), x: 600, y: 300 };
    const heavy = { ...restBody(), x: 630, y: 300 };

    const lightOut = resolveWorld(light, [{ hull: hullAt(630, 300), mass: 900 }], [], BOUNDS, 300);
    const heavyOut = resolveWorld(heavy, [{ hull: hullAt(600, 300), mass: 300 }], [], BOUNDS, 900);

    const lightMoved = Math.abs(lightOut.x - 600);
    const heavyMoved = Math.abs(heavyOut.x - 630);
    expect(lightMoved).toBeGreaterThan(heavyMoved * 2);
  });

  it("splits evenly between two cars of equal mass", () => {
    const a = { ...restBody(), x: 600, y: 300 };
    const b = { ...restBody(), x: 630, y: 300 };

    const aOut = resolveWorld(a, [{ hull: hullAt(630, 300), mass: 480 }], [], BOUNDS, 480);
    const bOut = resolveWorld(b, [{ hull: hullAt(600, 300), mass: 480 }], [], BOUNDS, 480);

    expect(Math.abs(aOut.x - 600)).toBeCloseTo(Math.abs(bOut.x - 630), 1);
  });

  it("moves the car fully out of a static obstacle, which has infinite mass", () => {
    const body = { ...restBody(), x: 600, y: 300 };
    const out = resolveWorld(body, [], [{ x: 610, y: 290, w: 60, h: 60 }], BOUNDS, 480);
    // A wall does not yield. The car takes the whole correction, exactly as before this task.
    expect(out.x).toBeLessThan(600);
  });
});
```

Add a `hullAt(x, y)` helper returning `carHullOf(x, y, 0)` if the file has none.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/sim/collide.test.ts -t "mass-weighted"`
Expected: FAIL — `resolveWorld` takes four arguments and `others` is `readonly Obb[]`.

- [ ] **Step 3: Widen `others` and add the mass split**

In `collide.ts`:

```ts
/** One other car as the resolver sees it: where it is, and how hard it is to shove. */
export interface CarObstacle {
  hull: Obb;
  mass: number;
}
```

`resolveWorld` gains `selfMass: number` as its last parameter and passes a share to `resolveAgainst`:

```ts
/**
 * The fraction of a car-car correction THIS body absorbs.
 *
 * A heavier car takes less of the push, so a Bastion is something you cannot shoulder aside and a
 * Bullseye gets moved constantly. Static geometry has no mass and does not yield: obstacles and
 * bounds still hand the body the whole correction, which is what `OBSTACLE_SHARE` names.
 *
 * Note this is a POSITIONAL split, not an impulse — velocity exchange is `applyImpulse`'s job. The
 * two are separate on purpose: separation runs every tick a pair overlaps, and routing it through
 * impulses would re-apply a knock on each of them.
 */
function shareOf(selfMass: number, otherMass: number): number {
  const total = selfMass + otherMass;
  return total <= 0 ? OBSTACLE_SHARE : otherMass / total;
}

const OBSTACLE_SHARE = 1;
```

`resolveAgainst` takes the share and scales the push:

```ts
function resolveAgainst(body: SimBody, box: Obb, share: number): SimBody {
  const mtv = mtvBetween(carObbOf(body), box);
  if (mtv === null) return body;
  return applyContact(body, { x: mtv.x * share, y: mtv.y * share });
}
```

Car loops pass `shareOf(selfMass, other.mass)`; obstacle and bounds loops pass `OBSTACLE_SHARE`.

- [ ] **Step 4: Update `context.ts` and the two callers**

`otherCarHulls` in `context.ts` returns `Obb[]`; it must return `CarObstacle[]`, reading each car's
`massOf(carId)`. Both builders of a `StepContext` — `serverTick` and the client's
`buildStepContext` — must supply the driven car's own mass. Add `selfMass: number` to `StepContext`
beside `carId`, resolved with `massOf(ctx.carId)`, and have `stepSim` pass it through.

> Both halves of the lockstep must supply this or they will silently disagree about who moves. Make
> `selfMass` **required** on `StepContext`, never optional with a default — the compiler is what
> keeps the two halves honest, and a default would take that away. This is the same reasoning the
> existing `modifiers` field's comment records.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @motor-combat-moba/shared`
Expected: PASS. Two kinds of fixture updates in `collide.test.ts`:

- Existing cases passing bare `Obb`s in `others` need wrapping as `{ hull, mass }`.
- **Task 1's own tests, written one task ago, call `resolveWorld` with four arguments.** They each
  need a fifth. Any mass works for them — they resolve against bounds, which do not yield — so pass
  the roster's average, `480`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sim/ packages/server/src/ packages/client/src/
git commit -m "feat(sim): split car-car separation by mass"
```

---

## Task 3: The `Impulse` struct and its applier

**Files:**
- Create: `packages/shared/src/sim/impulse.ts`
- Test: `packages/shared/src/sim/impulse.test.ts`

**Interfaces:**
- Consumes: `SimBody`, `RAM_CONFIG.inertiaCoefficient`, `RAM_CONFIG.spinScale`,
  `RAM_CONFIG.spinMaxRate`.
- Produces: `Impulse`, `applyImpulse(body, mass, imp): SimBody`, `reactionOf(imp): Impulse`. Stages 3
  and 4 both build on these exact signatures — see [`interfaces.md`](interfaces.md).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/sim/impulse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RAM_CONFIG } from "../config/ram-config.js";
import { applyImpulse, reactionOf, type Impulse } from "./impulse.js";
import type { SimBody } from "./step.js";
import { forwardOf } from "./velocity.js";

function body(over: Partial<SimBody> = {}): SimBody {
  return {
    x: 0, y: 0, angle: 0, vx: 0, vy: 0, reverseHold: 0, angVel: 0,
    maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
    ...over,
  };
}

function impulse(over: Partial<Impulse> = {}): Impulse {
  return {
    dirX: 0, dirY: 1, speed: 200, spin: 1, massScaled: true,
    uncontrolTicks: 30, contactX: 0, contactY: 0,
    ...over,
  };
}

describe("applyImpulse", () => {
  it("adds the push to the victim's velocity rather than replacing it", () => {
    const next = applyImpulse(body({ vx: 100, vy: 0 }), 500, impulse({ massScaled: false }));
    expect(next.vx).toBeCloseTo(100); // the car keeps driving
    expect(next.vy).toBeCloseTo(200); // and is also thrown
  });

  it("moves a light car further than a heavy one under the same impulse", () => {
    const light = applyImpulse(body(), 300, impulse());
    const heavy = applyImpulse(body(), 900, impulse());
    expect(Math.abs(light.vy)).toBeGreaterThan(Math.abs(heavy.vy));
  });

  it("ignores mass entirely when massScaled is false", () => {
    const light = applyImpulse(body(), 300, impulse({ massScaled: false }));
    const heavy = applyImpulse(body(), 900, impulse({ massScaled: false }));
    expect(light.vy).toBeCloseTo(heavy.vy);
  });

  it("imparts no spin for a dead-centre hit, where the lever arm is zero", () => {
    // Contact at the victim's own centre: force and lever are colinear, torque is zero.
    const next = applyImpulse(body(), 500, impulse({ contactX: 0, contactY: 0 }));
    expect(next.angVel).toBeCloseTo(0);
  });

  it("imparts spin for an off-centre hit", () => {
    const next = applyImpulse(body(), 500, impulse({ contactX: 20, contactY: 0 }));
    expect(Math.abs(next.angVel)).toBeGreaterThan(0);
  });

  it("imparts no spin at all when the def asks for none", () => {
    const next = applyImpulse(body(), 500, impulse({ contactX: 20, contactY: 0, spin: 0 }));
    expect(next.angVel).toBeCloseTo(0);
  });

  it("clamps spin to the configured ceiling", () => {
    const next = applyImpulse(body(), 1, impulse({ contactX: 24, speed: 100000, spin: 10 }));
    expect(Math.abs(next.angVel)).toBeLessThanOrEqual(RAM_CONFIG.spinMaxRate);
  });

  it("leaves position and facing alone", () => {
    const next = applyImpulse(body({ x: 5, y: 7, angle: 1.1 }), 500, impulse());
    expect(next.x).toBe(5);
    expect(next.y).toBe(7);
    expect(next.angle).toBe(1.1);
  });

  it("robs the victim's forward momentum when the push opposes its heading", () => {
    // Spec P15: this falls out of vector addition rather than being special-cased. A car doing 200
    // forward, hit from in front, is slowed — no code anywhere reaches in and sets its speed down.
    const driving = body({ vx: 200, vy: 0 }); // facing +x, driving +x
    const headOn = impulse({ dirX: -1, dirY: 0, massScaled: false, speed: 150 });
    const next = applyImpulse(driving, 500, headOn);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(50);
  });

  it("leaves forward momentum untouched for a perfectly perpendicular hit", () => {
    // The one case where it should NOT be robbed, and it also falls out for free.
    const driving = body({ vx: 200, vy: 0 });
    const perpendicular = impulse({ dirX: 0, dirY: 1, massScaled: false, speed: 150 });
    const next = applyImpulse(driving, 500, perpendicular);
    expect(forwardOf(next.vx, next.vy, next.angle)).toBeCloseTo(200);
  });

  it("clamps the mass factor so no chassis degenerates at either extreme", () => {
    const featherweight = applyImpulse(body(), 1, impulse());
    expect(Math.abs(featherweight.vy)).toBeLessThanOrEqual(
      impulse().speed * RAM_CONFIG.massFactorMax + 1e-6,
    );
  });
});

describe("reactionOf", () => {
  it("points the opposite way with the same magnitude", () => {
    const imp = impulse({ dirX: 0, dirY: 1, speed: 200 });
    const back = reactionOf(imp);
    expect(back.dirX).toBeCloseTo(0);
    expect(back.dirY).toBeCloseTo(-1);
    expect(back.speed).toBeCloseTo(200);
  });

  it("carries no uncontrol — being the attacker is not being rammed", () => {
    expect(reactionOf(impulse({ uncontrolTicks: 30 })).uncontrolTicks).toBe(0);
  });

  it("carries no spin — the attacker's own lever arm is a separate question", () => {
    expect(reactionOf(impulse({ spin: 1 })).spin).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/sim/impulse.test.ts`
Expected: FAIL — `Failed to resolve import "./impulse.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/sim/impulse.ts`:

```ts
import { ramReferenceMass } from "../config/car-config.js";
import { RAM_CONFIG } from "../config/ram-config.js";
import type { SimBody } from "./step.js";

/**
 * One push, fully resolved — and the ONLY way anything outside the drive model changes a car's
 * velocity.
 *
 * Ram and weapons derive their impulses completely differently: ram grades one from relative
 * closing speed, a side bonus, mass and a falloff stack, while a weapon reads fixed numbers off its
 * own row. Neither of those derivations lives here. What lives here is how an impulse LANDS, which
 * is the only part they share — so ram feel and weapon feel stay independently tunable while a fix
 * to the physics benefits both. See spec principle D.
 */
export interface Impulse {
  /** Unit vector: the direction the victim is pushed. */
  dirX: number;
  dirY: number;
  /** Magnitude as a Δv in u/s, BEFORE the victim's mass is divided out. */
  speed: number;
  /** Torque scale from the lever arm. 0 = a clean punt with no rotation. */
  spin: number;
  /** Does the victim's mass reduce the displacement? */
  massScaled: boolean;
  /** How long the victim is left reeling, in TICKS (already converted). */
  uncontrolTicks: number;
  /** World-space contact point, for the lever arm. */
  contactX: number;
  contactY: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * How far this impulse displaces a car of this mass, relative to an average chassis.
 *
 * The single place victim mass enters the maths. Clamped at both ends so neither the heaviest nor
 * the lightest chassis degenerates — and read through `ramReferenceMass()` rather than recomputed,
 * so playground tuning of `massPerRating` moves it too.
 *
 * `massScaled: false` opts out entirely: the hard slam punts every chassis identically, which is
 * the designer's escape hatch from physics that spec principle C exists to grant.
 */
function massFactorOf(mass: number, massScaled: boolean): number {
  if (!massScaled || mass <= 0) return 1;
  return clamp(ramReferenceMass() / mass, RAM_CONFIG.massFactorMin, RAM_CONFIG.massFactorMax);
}

/**
 * Apply one impulse to one body: velocity and spin only.
 *
 * Deliberately does NOT apply the `reeling` status. A status is not `SimBody` state, and this
 * function is pure sim maths shared by both halves of the lockstep; the caller reads
 * `imp.uncontrolTicks` and applies the status server-side.
 *
 * The victim's forward momentum is robbed for free: whatever component of `dir` opposes the
 * victim's heading reduces its forward speed by ordinary vector addition, and whatever is
 * perpendicular becomes the slide. Only a perfectly perpendicular hit leaves forward speed
 * untouched, which is correct.
 */
export function applyImpulse(body: SimBody, mass: number, imp: Impulse): SimBody {
  const dv = imp.speed * massFactorOf(mass, imp.massScaled);

  const vx = body.vx + imp.dirX * dv;
  const vy = body.vy + imp.dirY * dv;

  return { ...body, vx, vy, angVel: nextSpin(body, mass, imp, dv) };
}

/**
 * Torque from a recovered contact point, in the victim's local frame.
 *
 * The 2D cross product of the lever arm with the force is the torque term a real impulse solver
 * would produce, evaluated at one point instead of over a manifold. It behaves correctly by
 * construction rather than by tuning: a dead-centre hit puts lever and force on the same line, so
 * the cross product is zero and there is no spin.
 */
function nextSpin(body: SimBody, mass: number, imp: Impulse, dv: number): number {
  if (imp.spin === 0) return body.angVel;

  const cos = Math.cos(-body.angle);
  const sin = Math.sin(-body.angle);
  const dx = imp.contactX - body.x;
  const dy = imp.contactY - body.y;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  const fx = (imp.dirX * cos - imp.dirY * sin) * dv;
  const fy = (imp.dirX * sin + imp.dirY * cos) * dv;

  const torque = rx * fy - ry * fx;
  const inertia = Math.max(1, mass * RAM_CONFIG.inertiaCoefficient);
  const spin = (torque / inertia) * RAM_CONFIG.spinScale * imp.spin;
  return clamp(body.angVel + spin, -RAM_CONFIG.spinMaxRate, RAM_CONFIG.spinMaxRate);
}

/**
 * The reaction the ATTACKER takes — Newton's third law, and the reason mass finally matters on
 * offence.
 *
 * The impulse is shared but Δv is `J/m`, so a heavy Bastion ramming a light Bullseye barely slows
 * while the reverse bounces the Bullseye off hard. That asymmetry is the whole of it; nothing here
 * is tuned. `SLAM_CONFIG.selfKeepFactor` used to hand-approximate this for slams alone.
 *
 * Carries no uncontrol and no spin: being the attacker is not being rammed, and the attacker's own
 * lever arm is a separate question this design does not answer (spec P16).
 */
export function reactionOf(imp: Impulse): Impulse {
  return { ...imp, dirX: -imp.dirX, dirY: -imp.dirY, spin: 0, uncontrolTicks: 0, massScaled: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/shared/src/sim/impulse.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Export from the index and commit**

Add `export { applyImpulse, reactionOf, type Impulse } from "./sim/impulse.js";` to
`packages/shared/src/index.ts`.

```bash
git add packages/shared/src/sim/impulse.ts packages/shared/src/sim/impulse.test.ts packages/shared/src/index.ts
git commit -m "feat(sim): add the shared Impulse struct and applier"
```

---

## Task 4: Route ram and slam through `Impulse`

**Files:**
- Modify: `packages/shared/src/sim/ram.ts` (`RamKnock` → `Impulse`)
- Modify: `packages/shared/src/sim/contact.ts`
- Modify: `packages/server/src/sim/ram-bridge.ts`
- Test: `packages/shared/src/sim/ram.test.ts`, `contact.test.ts`

**Interfaces:**
- Consumes: `Impulse`, `applyImpulse`, `reactionOf` from Task 3.
- Produces: `RamHit.impulse: Impulse` replacing `RamHit.knock: RamKnock`. `resolveContacts` returns
  `{ impulses: Map<string, Impulse>; contacts; events }` — a map keyed by victim session id, not an
  array.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/sim/ram.test.ts`, replace the knock-shaped assertions:

```ts
describe("resolveRam produces an Impulse", () => {
  it("pushes the victim away from the attacker", () => {
    const hit = resolveRam(attackerAt(600, 300), victimAt(640, 300), "ffa");
    expect(hit).not.toBeNull();
    expect(hit!.impulse.dirX).toBeGreaterThan(0); // victim is to the +x side, pushed further +x
  });

  it("records a contact point, so the lever arm is real", () => {
    const hit = resolveRam(attackerAt(600, 300), victimAt(640, 320), "ffa");
    expect(hit!.impulse.contactX).not.toBe(0);
  });

  it("scales the victim's displacement by mass", () => {
    expect(resolveRam(attackerAt(600, 300), victimAt(640, 300), "ffa")!.impulse.massScaled).toBe(true);
  });
});
```

In `contact.test.ts`:

```ts
it("a slam ignores mass, unlike a ram", () => {
  const out = resolveContacts(/* charger + victim, see the existing fixture */);
  const imp = out.impulses.get(VICTIM_ID);
  expect(imp!.massScaled).toBe(false);
  expect(imp!.spin).toBe(0); // a clean straight punt is the ult's signature
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/sim/ram.test.ts packages/shared/src/sim/contact.test.ts`
Expected: FAIL — `impulse` does not exist on `RamHit`.

- [ ] **Step 3: Replace `RamKnock` with `Impulse`**

In `ram.ts`, delete the `RamKnock` interface. `RamHit` becomes:

```ts
export interface RamHit {
  attackerId: string;
  victimId: string;
  side: ImpactSide;
  severity: number;
  impulse: Impulse;
}
```

`resolveRam` builds one instead of a knock. The contact point is the attacker's centre clamped into
the victim's hull — the same recovery `spinOf` used to do inline, now hoisted so `applyImpulse` can
use it:

```ts
  const contact = contactPointOn(victim, attacker);
  return {
    attackerId: attacker.sessionId,
    victimId: victim.sessionId,
    side,
    severity,
    impulse: {
      dirX: away.x,
      dirY: away.y,
      speed: severity * RAM_CONFIG.knockMaxSpeed,
      spin: 1,
      massScaled: true,
      uncontrolTicks: 0, // stage 3 fills this in
      contactX: contact.x,
      contactY: contact.y,
    },
  };
```

Delete `spinOf` — `applyImpulse` owns spin now. Add `contactPointOn`, which is `spinOf`'s clamping
step lifted out verbatim and returned in **world** space.

- [ ] **Step 4: Update `contact.ts`**

`best` becomes `Map<string, ImpulseEntry>` and the returned `knocks` array becomes an `impulses` map
of the same type. **The attacker's id rides in the entry** — Task 5 needs it to apply the reaction,
and reconstructing it downstream would mean re-deriving which of a pair was the attacker, a question
only `resolveRam` is in a position to answer:

```ts
/** One resolved push and who threw it. Keyed by victim id in the returned map. */
export interface ImpulseEntry {
  attackerId: string;
  severity: number;
  impulse: Impulse;
}
```

The slam branch builds its `Impulse` directly:

```ts
      const imp: Impulse = {
        dirX: away.x,
        dirY: away.y,
        speed: SLAM_CONFIG.knockSpeed,
        spin: 0,
        massScaled: false,
        uncontrolTicks: 0, // stage 3 fills this in; stage 4 moves it onto the weapon row
        contactX: other.x,
        contactY: other.y,
      };
```

- [ ] **Step 5: Apply both halves in the bridge**

In `ram-bridge.ts`, replace the shove/authority writes with `applyImpulse`, and apply the reaction:

```ts
  for (const [victimId, imp] of result.impulses) {
    const victim = bodyOf(victimId);
    writeBody(victimId, applyImpulse(victim, massFor(victimId), imp));

    // Newton's third law. The attacker's own mass decides how much it costs them, which is why a
    // Bastion barely notices ramming a Bullseye and a Bullseye bounces off a Bastion.
    const attackerId = attackerFor(victimId);
    if (attackerId !== undefined) {
      const attacker = bodyOf(attackerId);
      writeBody(attackerId, applyImpulse(attacker, massFor(attackerId), reactionOf(imp)));
    }
  }
```

`resolveContacts` must return the attacker id alongside each impulse for this. Add `attackerId` to
the map's value type rather than reconstructing it.

Delete the `SLAM_CONFIG.selfKeepFactor` line — the reaction above replaces it exactly, and the
constant is removed from the config in stage 4.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sim/ packages/server/src/sim/
git commit -m "feat(sim): route ram and slam through Impulse, with equal-and-opposite reactions"
```

---

## Stage 2 exit criteria

- [ ] `npm test` passes from the repo root.
- [ ] `npm run dev`: glance a wall at speed and slide along it rather than grinding to a stop.
- [ ] Ram a Bullseye as Bastion, then the reverse. The Bastion barely slows; the Bullseye is thrown
      and loses most of its speed.
- [ ] Drive into a Bastion head-on at low speed: you move, it mostly does not.

**Not done in this stage, deliberately:** ram severity still reads the attacker's speed alone, and a
rammed car still keeps full steering. Both land in stage 3.
