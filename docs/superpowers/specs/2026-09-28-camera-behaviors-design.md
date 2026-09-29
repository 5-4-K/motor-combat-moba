# Per-mode camera behaviours — design

**Date:** 2026-09-28 · **Branch:** `claude/camera-behavior-refactor-2neiv1` · **Status:** approved in
conversation, written for review.

Clauses are numbered **CB1–CB45** so the plan, the code and later changes can cite them.

## 1. Why

Before this work, a mode did not choose its camera. Two facts about the ARENA did:

- **Fixed or follow** was `fitsViewport(arena, view, zoom)` in `ArenaScene.drawArena`: a
  one-screen arena (`arena-01`, `arena-02`, 1280×720) got a static camera, a bigger one
  (`arena-03`, 1280×2160) got a soft follow. Brawl "had a fixed camera" only because of the
  arenas it plays.
- **The 180° team-B view** was `viewRotationFor(arena, sides, team)`: `ArenaDef.flipForTeamB`,
  a team mode, and team 1.
- **Spectating** was derived from `rulesOf(mode).respawns`: a mode that does not respawn lets a
  wreck spectate any living car; a mode that does holds the camera where the car died.

The user wants the camera to be **tied to the game mode**, configurable per mode, extensible, and
to gain two new behaviours: a camera that rotates with the car's heading, and a restricted field of
vision (FOV). Existing modes must look exactly as they do today; no shipped mode turns the new
behaviours on.

## 2. Decisions (settled in conversation)

- **CB1** The camera is configured by the MODE, through the existing `ModeTables.camera` /
  `camera()` accessor. An arena never switches a camera behaviour on; it can only make a mode's
  choice illegal, and that is caught by a per-mode invariant test (CB30–CB33), never by a silent
  fallback.
- **CB2** There is no fixed/follow setting. The camera **always follows** its target, clamped to
  the arena by `cam.setBounds(0, 0, arena.width, arena.height)`. On a one-screen arena the clamp
  leaves no room to scroll, which reproduces today's "fixed" camera exactly; on `arena-03` it
  scrolls exactly as today. (Phaser's `clampX`/`clampY` pin the scroll to 0 when the bounds are
  exactly the view size — verified against Phaser 4.2.1's `BaseCamera.clampX`.) `fitsViewport` has
  no reader left once the `V` toggle goes (CB21), so it and `scenes/arena-camera.ts` are deleted.
- **CB3** `flipForTeamB` is **deleted** from `ArenaDef` and every arena. The team view angle is
  derived from spawn angles (CB10).
- **CB4** Config values are **flat** (string unions and an always-present `fov` block with an
  `enabled` flag), never discriminated-union objects. `mergeTables` merges objects key by key and
  refuses keys the base lacks, so a `{ kind: ... }` shape would force `replace(...)` on every
  override and a forgotten one would only fail at load. Flat values merge with no special case.
- **CB5** Bots are **not** taught FOV in this work (deferred to the user). A guard test (CB33)
  fails if a bundle a bot-seated room runs under enables FOV.
- **CB6** FOV is **client-side only**. The server still sends every car to every client; a player
  who reads packets or patches the client sees everything. Accepted for a LAN game between
  friends. Server-side interest management is out of scope and would collide with the planned
  netcode rewrite.
- **CB7** Heading-up rotation can cause motion sickness for some players. `rotateLerp` softens it;
  it is a design choice the mode author owns. Nothing ships with it on.

## 3. The config shape

`CameraConfig` becomes an explicit interface (today it is `typeof CAMERA_CONFIG` with `as const`,
which types every value as a literal and would make a mode override of any camera number fail to
typecheck).

```ts
export type CameraRotate = "none" | "teamFacing" | "heading";
export type SpectateTarget = "anyone" | "teammates" | "none" | "free";
export type NoTargetVision = "pov" | "blind";

export interface FovConfig {
  readonly enabled: boolean;
  readonly rangeX: number;          // semi-axis along the car's nose, world units, > 0
  readonly rangeY: number;          // semi-axis across the car, world units, > 0
  readonly offsetX: number;         // ellipse centre, car-local, + is forward
  readonly offsetY: number;         // ellipse centre, car-local, + is the car's right (+y local)
  readonly angleDeg: number;        // cone width, (0, 360]
  readonly blockedByObstacles: boolean;
  readonly outsideDim: number;      // 0..1, alpha of the dark overlay outside vision
  readonly sharedVision: boolean;   // team modes: teammates' vision is yours
}

export interface SpectateConfig {
  readonly target: SpectateTarget;
  readonly noTargetVision: NoTargetVision;
}

export interface CameraConfig {
  readonly camLerp: number;         // unchanged
  readonly zoom: number;            // unchanged
  readonly freeRoamSpeed: number;   // unchanged
  readonly rotate: CameraRotate;
  readonly rotateLerp: number;      // (0, 1], per 60 Hz frame; read only by "heading"
  readonly fov: FovConfig;
  readonly spectate: SpectateConfig;
}
```

- **CB8** Base values (`CAMERA_CONFIG` in `config/drive-config.ts`, which stays where it is):
  `rotate: "none"`, `rotateLerp: 0.15`, `fov.enabled: false` with the other `fov` fields at
  sensible authored defaults (`rangeX: 600, rangeY: 450, offsetX: 0, offsetY: 0, angleDeg: 120,
  blockedByObstacles: true, outsideDim: 0.45, sharedVision: true`), `spectate: { target:
  "anyone", noTargetVision: "pov" }`. The `fov` defaults are inert while `enabled` is false; they
  exist so a mode turns FOV on with `fov: { enabled: true }` alone.
- **CB9** Per-mode overrides reproducing today:

  | Mode | rotate | fov.enabled | spectate.target | spectate.noTargetVision |
  |---|---|---|---|---|
  | Brawl (`brawl/config.ts`) | none (base) | false (base) | anyone (base) | pov (base) |
  | Team brawl (`team-brawl/config.ts`) | none (base) | false (base) | anyone (base) | pov (base) |
  | Deathmatch (`deathmatch/config.ts`) | none (base) | false (base) | **none** | pov (base) |
  | Conquer (`conquer/config.ts`) | **teamFacing** | false (base) | **none** | pov (base) |

  Every mode's snapshot moves once (the base grew); Deathmatch's and Conquer's also carry their
  overrides. The move is deliberate and is accepted with a per-file `vitest -u`.

## 4. Rotation

- **CB10** `"teamFacing"`: the camera angle is the one that puts the local player's TEAM's spawn
  heading straight up on screen. The team heading is the `angle` shared by every spawn in
  `teamASpawns` (team 0) or `teamBSpawns` (team 1). It is computed **once per match** (in
  `drawArena` and whenever the local player's team first becomes known or changes, as
  `syncViewRotation` does today) and never eased — it snaps.
- **CB11** On `arena-03`: team A spawns at `-π/2` (up the map) → rotation 0; team B at `+π/2` →
  rotation π. This reproduces CQ46 exactly without the flag.
- **CB12** `"heading"`: the target angle is the one that puts the camera target car's current
  heading straight up on screen, eased toward it every frame along the shortest arc by
  `rotateLerp`, rescaled for frame time exactly as `smoothFollow` rescales `camLerp`. The first
  frame of a match, and the first frame after a respawn cut (CB22), snap instead of easing.
- **CB13** One function maps a heading to a camera rotation, `viewRotationForHeading(angle)`, and
  both options use it. Its sign convention is pinned by a test that composes it with the existing
  `aim-offset.ts` screen↔world maths: a world point straight ahead of the car must land straight
  above the screen centre.
- **CB14** `"none"`: rotation 0, as Brawl and Deathmatch have today.
- **CB15** The arena clamp (CB2) is only correct when the rotation is a multiple of π, because
  Phaser clamps an unrotated scroll rectangle. Whether it is applied is decided **by the mode's
  `rotate` choice, not by the current frame's instantaneous angle** (`boundsAlignedFor` in
  `camera/rotation.ts`): `"heading"` never clamps, full stop — bounds are removed (`removeBounds`)
  from the very first frame of the match, before any pose has even been read, and stay off for the
  whole time the mode is `"heading"`. `"none"` and `"teamFacing"` hold one fixed angle per match, so
  clamping when THAT angle is a multiple of π is safe: it is applied (`setBounds`) when it is, and
  left off when it is not (a sideways-spawning `"teamFacing"` team). The earlier draft of this clause
  tested `isAxisAligned` on the live, per-frame rotation for every mode — for `"heading"`, whose
  angle eases continuously and passes back through axis-aligned values on the way to some other
  heading, that toggled `setBounds`/`removeBounds` on and off mid-ease, which read as a camera lurch
  rather than a clamp (I2). Deciding by mode instead removes that thrash: a mode that rotates freely
  is simply never bounded.
- **CB16** While spectating, `"heading"` turns with the car being watched; in free roam
  (`target: "free"`, or the no-target hold of CB22) it holds the angle it had at the moment of
  death. `"teamFacing"` always uses the LOCAL player's team, never the watched car's (as today).
- **CB17** The world-space pieces that already cancel the view rotation — the crosshair maths
  (`aim-offset.ts`), the countdown arrow (`countdown-arrow.ts`) and the car lighting
  (`lookForView`) — take the current per-frame rotation. They already handle any angle; the work
  is making sure they read it every frame rather than a value cached at create. Hp bars are drawn
  relative to their car and need no change. The HUD camera never rotates.

## 5. Spectating

- **CB18** `isSpectating` no longer reads `rulesOf(mode).respawns`. A player is spectating when
  the phase is `MATCH`, they are `IN_MATCH`, their car is dead, and the mode's `spectate.target`
  is not `"none"`.
- **CB19** `"anyone"`: cycle through every living `IN_MATCH` car (today's Brawl behaviour).
  `"teammates"`: cycle through living cars on the local player's team, excluding the local car.
- **CB20** `"free"`: no target; the camera pans with WASD/arrows at `freeRoamSpeed`, starting
  from where the car died. It is always on for that mode — there is no toggle.
- **CB21** The `V` free-roam TOGGLE is removed. It was inert on every shipped arena (a one-screen
  arena gives it nothing to pan), so no player-visible behaviour is lost — except that the
  spectator banner stops advertising `V for free roam`, which it did even where the key did
  nothing. A mode that wants free roam sets `target: "free"`.
- **CB22** `"none"`, or a target list that is empty (e.g. `"teammates"` with every teammate
  dead): the camera holds where the car died (today's Deathmatch behaviour, which falls out of the
  camera no longer receiving a pose once the wreck fades). The respawn cut (`syncRespawnCamera`)
  is unchanged: the frame the car is alive again, the camera snaps to it.
- **CB23** Respawn modes may now spectate (e.g. Conquer with `"teammates"` would let you watch a
  teammate while waiting). The respawn cut still wins the frame the car returns.
- **CB24** Spectate banner text: `"anyone"`/`"teammates"` keep today's "Spectating <name> — [ ] or
  Left/Right to switch" (minus the V clause); an empty list reads "Wrecked — no one left to
  watch" as today; `"free"` reads "Free roam — WASD/arrows to pan". `"none"` shows no banner (as
  Deathmatch today).

## 6. Field of vision

Only when the mode's `fov.enabled` is true. Every other mode renders exactly as before.

- **CB25** **Shape.** For a viewer car at pose `(x, y, θ)`: the ellipse centre is
  `c = (x, y) + R(θ)·(offsetX, offsetY)`, its semi-axes are `rangeX` along θ and `rangeY` across
  it. The cone's apex is `c` and its axis is θ; a point `p` is in the cone when the angle between
  `p − c` and θ is at most `angleDeg / 2` (or `angleDeg ≥ 360`). `p` is **in vision** when it is
  inside the ellipse AND inside the cone AND, if `blockedByObstacles`, the segment `c → p` crosses
  no obstacle rectangle (an obstacle that contains the apex itself is ignored, so a large forward
  offset cannot blank the whole vision). **Every** obstacle blocks, spikes included (spike strips sit flush
  against the boundary, so their shadow falls on nothing a car can occupy).
- **CB26** **Viewers.** The vision set is the union of the shapes of: the local car while alive;
  plus every living teammate when `sharedVision` is true and the mode has teams (`rulesOf(mode)
  .sides === "team"`). While spectating a player (CB19), the vision set is **that player's**
  vision set computed the same way. While dead with no target (`"none"`, `"free"`, or an empty
  list), the vision set is: `"pov"` — the local car's shape frozen at its death pose, plus living
  teammates if shared; `"blind"` — living teammates if shared, else nothing.
- **CB27** **What is hidden.** FOV hides ENEMY things only; the perspective player's own things
  and their teammates' are always drawn. The **perspective player** is the watched player while
  spectating one (CB19), otherwise the local player — so watching someone shows exactly what
  they see, allegiance included. "Enemy" means `allegianceOf(perspective, other, sides) ===
  "enemy"` — in FFA every other car. Hidden when out of vision:
  - an enemy car and everything drawn for it (body, shadow, lighting, turret, hp bar, maneuver
    visuals) — visible when any hull corner or its centre is in vision;
  - an enemy-owned shot (`WeaponInstanceState.ownerSessionId`) — visible when any of its sample
    points is in vision (a projectile's centre; a beam's origin, midpoint and tip; a disc's centre
    and four rim points);
  - fx events derived from an enemy-owned instance or at an enemy car (`shotFired`, `shotEnded`,
    `damaged`, `died`) whose position is out of vision at the moment they are derived.
  Map features (floor, obstacles, spikes, the Conquer zone) are never hidden. Persistent ground
  marks already stamped (scorch, lava crust) are not retroactively removed.
- **CB28** **Per object, not a stencil.** The arena scene is layered by depth, not by owner, so
  hiding is decided per object (CB27) rather than by masking an "enemy layer". Consequence: a
  shot is shown whole or not at all — a beam half inside your vision is drawn in full, origin
  included. This is a deliberate simplification of the stencil idea discussed in conversation.
- **CB29** **Dimming.** A dark overlay (`outsideDim` alpha, floor-independent black) covers the
  world view outside the union of vision shapes. It is one world-space object large enough to
  cover the view at any rotation (a square of side = the view diagonal / zoom, centred on the
  camera midpoint), with the vision polygons cut out of it — by an inverted Phaser 4 `Mask` filter
  or an erased `RenderTexture`, whichever the implementation proves works; either is acceptable.
  Each vision shape is polygonised as a ray fan from its apex: rays across the cone, each ending at
  the ellipse or at the first obstacle hit when `blockedByObstacles`. The polygon is for drawing
  only; visibility tests (CB25) are exact. The overlay is on the world camera only (the HUD
  camera ignores it), above the floor, obstacles, cars and shots — except the driven car and its
  hp bar, which sit above the overlay while FOV is on, so your own car always reads fully lit even
  where it pokes out of its own cone (decided 2026-09-29).

## 7. Invariants (per mode, in `modes/invariants.test.ts`, naming the mode on failure)

- **CB30** `rotate === "teamFacing"` requires `rulesOf(mode).sides === "team"`, and for every arena
  in the mode's `arenas`, all `teamASpawns` share one angle and all `teamBSpawns` share one angle.
- **CB31** `spectate.target === "teammates"` requires `sides === "team"`.
- **CB32** Numeric ranges: `rotateLerp ∈ (0, 1]`, `fov.rangeX > 0`, `fov.rangeY > 0`,
  `fov.angleDeg ∈ (0, 360]`, `fov.outsideDim ∈ [0, 1]`, all finite.
- **CB33** Bot guard: the bundles `PracticeRoom` (`FFA_DEATHMATCH`) and `PlaygroundRoom`
  (`DEFAULT_GAME_MODE`) run bots under have `fov.enabled === false`. The failure message says
  bots cannot see through FOV yet (CB5).

## 8. Code structure

- **CB34** A new folder `packages/client/src/camera/` holds the camera's pure logic, testable with
  no Phaser:
  - `rotation.ts` — `viewRotationForHeading`, `teamFacingRotation(arena, team)`,
    `easeAngle(current, target, lerp, deltaMs)`, `isAxisAligned(rotation)`.
  - `spectate.ts` — moved from `scenes/spectate.ts`: `isSpectating(phase, status, alive,
    target)`, `spectatableIds(candidates, target, viewer)`, `cycleSpectate`,
    `resolveSpectateTarget`, `panFreeCam`, `smoothFollow`.
  - `vision.ts` — `visionShapeOf(pose, fov)`, `inVision(point, shapes, obstacles, blocked)`,
    `carVisible`, `shotSamplePoints`, `visionPolygon(shape, obstacles, blocked, rays)`, and
    `visionViewers(...)` implementing CB26.

  (No barrel file — `ArenaScene` and every test import each module directly by its own path.)
- **CB35** `scenes/view-rotation.ts` and its test are deleted (replaced by `camera/rotation.ts`).
  `scenes/arena-camera.ts` and its test are deleted (CB2). `scenes/spectate.ts` moves to
  `camera/spectate.ts`; its test moves with it.
- **CB36** `ArenaScene` keeps only the Phaser side: it reads `camera()`, calls the pure functions,
  and applies results (`centerOn`, `setRotation`, `setBounds`/`removeBounds`, visibility flags,
  the dim overlay). `staticCamera` is deleted; `followCamera`'s early-return on it is removed because
  the clamp does that job.
- **CB37** Stage-1 code must leave every shipped mode pixel-identical in play except the CB21
  banner text. No new behaviour is reachable from a shipped mode.

## 9. Staging

- **CB38** Stage 1 — refactor: CB2–CB4, CB8–CB11, CB13–CB14, CB18–CB24 (all spectate targets are
  implemented, since today's behaviour needs two of them and the rest are small), CB30–CB36.
  `rotate: "heading"` and `fov.enabled` exist in the type and config but `"heading"` is wired in
  stage 2 and `fov` in stage 3 — in stage 1 a mode setting either is caught by a temporary
  invariant ("not implemented until stage N"), removed when the stage lands.
- **CB39** Stage 2 — heading: CB12, CB15–CB17.
- **CB40** Stage 3 — FOV: CB25–CB29, CB33.

## 10. What else this touches

- **CB41** Docs: `docs/config-reference.md` (camera section; drop `flipForTeamB`), `CLAUDE.md`
  (the per-mode config section gains a sentence that camera behaviour is per mode, and
  `camera()`'s description), `packages/client/CLAUDE.md` if it describes the camera. The old
  Conquer spec/plan keep their text (they record what was decided then).
- **CB42** The players' guide: `stampOfModes` (`scripts/build-cars-and-weapons.mjs`) hashes
  weapons, active cars, combat, statuses, drive, arena width and slots — not `camera` — so no
  `npm run build:manual` is owed. Verified 2026-09-28.
- **CB43** Playtest probes and the balance harness do not read the camera; nothing owed. The bot
  view (`server/bot/view.ts`) reads only `camera().zoom`, which does not move.
- **CB44** Test scope: `modes/base.ts`/`config/` and client-common files change → **full scope**
  (`npm test`). The `game-mode` skill's checklist gains a line: choose the mode's camera
  (`rotate`, `fov`, `spectate`) in its `config.ts`.
- **CB45** Out of scope: bots under FOV (CB5), server-side vision (CB6), minimap / off-screen
  indicators for shared vision, turning any new behaviour on in a shipped mode, and the HUD
  gutter (roster panel and kill panel still list every player's state regardless of FOV — a
  known leak to revisit when a mode ships FOV).
