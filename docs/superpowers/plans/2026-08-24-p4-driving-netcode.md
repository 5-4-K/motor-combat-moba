# P4 — Driving + Netcode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Companion: `2026-08-24-motor-combat-moba-v1-master-index.md`. Spec: `docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md` §§4–5.2, 13.
>
> **After Validation passes:** update the Execution Tracker (P4 → Done).

**Goal:** Arcade-car driving feels instant (client prediction), remote cars interpolate, everyone bounces off walls, obstacles, and other cars. No damage yet (P5). `stepSim` becomes the real lockstep movement function.

**Architecture:** All movement + bounce in `packages/shared/src/sim`. Server tick applies queued inputs through `stepSim`. Client `PredictionBuffer` replays the same function. If `stepSim` reads a field, it is already on `PlayerState` (P1).

**Depends on:** P1 Done. Works against P0’s always-in-room players if P2/P3 are not merged yet; if P3 is merged, driving is live only after GO. **May run parallel with:** P2, P3. **Blocks:** P5.

---

## Files

- Modify: `packages/shared/src/sim/step.ts`
- Create: `packages/shared/src/sim/drive.ts`
- Create: `packages/shared/src/sim/drive.test.ts`
- Create: `packages/shared/src/sim/collide.ts`
- Create: `packages/shared/src/sim/collide.test.ts`
- Modify: `packages/shared/src/sim/step.test.ts`
- Modify: `packages/server/src/sim/tick.ts`
- Modify: `packages/client/src/net/prediction.ts`
- Create: `packages/client/src/net/prediction.test.ts`
- Modify: `packages/client/src/net/interpolation.ts`
- Create: `packages/client/src/net/interpolation.test.ts`
- Modify: `packages/client/src/scenes/ArenaScene.ts` (input capture at 30Hz, follow-cam, draw OBB + obstacles)
- Modify: `docs/networking.md`

---

### Task 1: Drive integration (TDD)

`SimBody` becomes:

```ts
export interface SimBody {
  x: number;
  y: number;
  angle: number;
  speed: number;
  reverseHold: number;
}
```

`stepDrive(body, input, dt, carId): SimBody` in `drive.ts`:

- `steer`: `angle += steer * turnRate(speed) * dt` (use `DRIVE_CONFIG.turnRate` when `|speed|` > a small epsilon, else `turnRateAtStop`).
- `throttle === 1`: `speed += accel * dt`, clamp to `forwardMaxSpeedOf(carId)` (if currently negative, this is braking toward 0 then accel — **spec: Up is forward accel**. If `speed < 0`, Up applies `brakeDecel` toward 0, then accel once `speed >= 0`).
- `throttle === -1`: if `speed > 0`, apply `brakeDecel` toward 0; if `speed === 0` (or `|speed| < 1e-3`), increment `reverseHold`; once `reverseHold >= reverseHoldTicks`, `speed -= accel * dt`, clamp to `-reverseMaxSpeedOf(carId)`. If `throttle !== -1`, `reverseHold = 0`.
- `throttle === 0`: apply `drag` toward 0; `reverseHold = 0`.
- Do **not** apply world translation in `stepDrive` if you want collide to run on the attempted pose — **do** apply `x += cos(angle) * speed * dt`, `y += sin(angle) * speed * dt` here, then `stepSim` calls collide.

Tests (`drive.test.ts`), using `carId: "rectangle"` and `dt = 1/30`:

1. Hold Up from rest: `speed` increases, `x` moves along `angle` (angle 0 → +x).
2. Speed never exceeds `forwardMaxSpeedOf("rectangle")`.
3. From high +speed, hold Down: speed drops (brake) before becoming negative.
4. From rest, hold Down for `reverseHoldTicks` then more: `speed < 0` and `|speed|` ≤ `reverseMaxSpeedOf("rectangle")` which is half of forward.
5. Left steer increases `angle` (or document sign: Left = +angle = CCW). **Lock: Left increases angle (CCW), Right decreases.** Tests assert that.
6. Coast (`throttle 0`) reduces `|speed|` via drag.

- [ ] **Step 1: Failing tests, then `drive.ts`.**
- [ ] **Step 2: Commit** `feat: arcade drive integration`

---

### Task 2: Bounce collision (TDD)

`collide.ts`:

```ts
export interface Aabb { x: number; y: number; w: number; h: number }
export interface Obb { x: number; y: number; angle: number; w: number; h: number }

export function resolveWorld(
  body: SimBody,
  others: Obb[],          // other cars (not self)
  obstacles: Aabb[],
  bounds: { width: number; height: number },
): SimBody
```

Car OBB size = `DRIVE_CONFIG.carWidth` × `carHeight`.

Implementation approach (keep it simple, deterministic):

1. **Bounds:** clamp so the OBB’s AABB (or a conservative circle of radius `hypot(w,h)/2`) stays inside `[0,width]×[0,height]`. On clamp, reflect the component of `speed` along the hit axis by `-restitution` **or** zero the outward velocity component and add a positional correction. Tests should pin behavior: hitting the right wall from +x reduces `x` to in-bounds and `speed` is not increased.
2. **Obstacles and cars:** SAT for OBB-vs-AABB (car vs obstacle / world bounds) and OBB-vs-OBB (car vs car). Do not substitute an AABB hull for the car.

Push-out: move `x,y` by MTV. Apply `speed` reflection: `v = (cos(angle)*speed, sin(angle)*speed)`, reflect about MTV normal, write back `speed = sign(dot(v', forward)) * |v'| * restitution` **or** simpler v1: after positional correction, `speed *= (1 - hitSlow)` with `hitSlow` derived from `restitution`. **Lock a simple rule so tests are stable:**

**Positional correction along MTV. Velocity: `v' = v - (1 + restitution) * proj_n(v)` if `dot(v, n) < 0` (moving into the surface). Then `speed = length(v')` and if `dot(v', forward) < 0`, `speed = -length(v')` (keep reverse as negative speed along facing).**

Tests (`collide.test.ts`):

1. Body moving +x through `x = width` ends with `x` inside and `speed` not away-into-the-wall.
2. Overlapping an obstacle AABB is pushed out (no overlap after resolve).
3. Two cars overlapping on x are separated (distance between centers ≥ a minimum).
4. Resolve is deterministic (same inputs → same outputs).

- [ ] **Step 1: Failing tests, then `collide.ts`.**
- [ ] **Step 2: Commit** `feat: wall, obstacle, and car bounce`

---

### Task 3: `stepSim` composes drive + collide

```ts
export function stepSim(
  body: SimBody,
  input: InputMessage,
  dt: number,
  ctx: {
    carId: CarId;
    others: Obb[];
    obstacles: Aabb[];
    bounds: { width: number; height: number };
  },
): SimBody {
  const driven = stepDrive(body, input, dt, ctx.carId);
  return resolveWorld(driven, ctx.others, ctx.obstacles, ctx.bounds);
}
```

Replace the P0 identity stub. Update `step.test.ts`: one integration — Up from rest on empty arena increases `x`.

**Server `serverTick`:** build `others` from all players except self (use current poses; P4 does not require simultaneous resolution — sequential per sessionId sorted alphabetically for determinism). Use `getArena(state.arenaId)`. `carId` from `player.carId` or `"rectangle"` if `""` (P0 sandbox / pre-reveal). Copy `speed` and `reverseHold` onto `PlayerState` after each input.

**Inputs during countdown:** room must **not** apply movement inputs if `phase === COUNTDOWN` (if P3 present). If P3 is absent, always apply.

- [ ] **Step 1: Wire step + tick.**
- [ ] **Step 2: Commit** `feat: stepSim drive+collide on the server tick`

---

### Task 4: Prediction and interpolation

**`PredictionBuffer`** (replace stub):

```ts
export interface PendingInput { seq: number; input: InputMessage }

predict(state, pending, ctx): SimBody  // push pending, return stepSim
reconcile(authoritative, lastProcessedSeq, currentPredicted, ctx): SimBody
```

Reconcile: drop `seq <= lastProcessedSeq`; replay remaining via `stepSim` from authoritative (include `speed`, `reverseHold`); if `hypot(dx,dy) > NET_CONFIG.reconcileSnapPos` or angle error > `reconcileSnapAngle`, return target; else ease `x,y,angle` by `reconcileEaseRate` and **snap** `speed` / `reverseHold` to the replayed target (same invariant as motor-combat: derived sim fields snap).

`prediction.test.ts`: two Up inputs predicted; authoritative ack of seq 1; reconcile replays seq 2; pose matches a local double-step.

**`InterpBuffer`:** `push(time, pose)`; `sample(now)` at `now - interpolationDelayMs` lerps `x,y` and lerps angle via `atan2` of sines/cosines. Test: two snapshots 100ms apart, sample midpoint → midpoint position.

**ArenaScene:**
- 30Hz input loop (`MS_PER_TICK`): read arrows + space (space unused until P5, still send `fire: false`), increment `seq`, `room.send(INPUT_MESSAGE, msg)`, `predict` local.
- On state change, `reconcile` local from server player.
- Remotes: push to interp, draw `sample`.
- Draw arena bounds + obstacle rects (gray). Cars: colored `CAR_TABLE` shape **visual** (rect/ellipse/hex) rotated by `angle`, fill `COLOR_TABLE[colorId].hex`. Hitbox not drawn unless `?debug=1`.
- Camera: lerp toward local (or predicted) pose each frame, `camLerp` in a small `CAMERA_CONFIG` in `shared/config/drive-config.ts` (`camLerp: 0.12`, `zoom: 0.85` so nearby fights are visible). Add those two knobs and a one-line config test.

- [ ] **Step 1: Prediction tests + implementation.**
- [ ] **Step 2: Interpolation tests + implementation.**
- [ ] **Step 3: ArenaScene input + camera + shapes.**
- [ ] **Step 4: Update `docs/networking.md` (seams now real for movement; combat hits still current-tick / P5).**
- [ ] **Step 5: Commit** `feat: prediction, interpolation, follow camera, car shapes`

---

## Validation

1. `npm run test --workspaces` exits 0 (drive, collide, prediction, interpolation).
2. `npm run build --workspaces` exits 0.
3. Manual two-tab (`npm run dev`). If P3 is Done, Start → pick cars → after GO: else P0 join immediately:
   - Local car responds instantly to arrows (no wait for ping).
   - Down brakes then reverses; reverse is slower.
   - Bounce off outer walls and the center obstacle.
   - Two cars can shove each other apart (no tunneling through).
   - Remote car in the other tab is smooth (not snapping every packet).
   - With `SIM_LATENCY_MS=80 SIM_JITTER_MS=20` on the server, local still feels OK; large errors snap rather than rubber-band forever.
4. Cars are visually Rectangle / Oval / Hexagon after P3 reveal; before reveal / P0 sandbox they may all draw as rectangles.

Update the tracker: P4 Done.
