# `@motor-combat-moba/client`

Phaser 4 render + join. Boot → Join → Lobby → Car select → Arena → Results, routed by
`bindViewRouter`.

**Local invariant:** send inputs (and lobby intents) only — never authoritative sim state.

This file describes the current state; history lives in the specs. Update facts in place. Most of
the rules below were learned by looking at the screen, not at a test — keep the reason with the rule.

## Netcode and prediction

`ArenaScene` sends one tick-stamped `InputFrame` per server tick (not per frame; `InputScheduler`
runs it ahead of a `ClockSync` estimate of the server clock), predicts the local car through shared
`stepSim` via `TickPrediction`, reconciles against each snapshot's tick, and draws remotes through
shared `RemoteTimeline` (tick-keyed interpolation, adaptive delay, capped extrapolation), predicting
against remotes at their dead-reckoned pose and drawing near ones blended toward it. See
[`docs/networking.md`](../../docs/networking.md).

- **Keep the scene thin.** Pure, testable logic lives beside it (`packages/shared/src/net/step-context.ts`,
  `scenes/car-visual.ts`, `scenes/arena-input.ts`, `scenes/combat-visual.ts`), because `ArenaScene`
  cannot be unit-tested without a browser. Client tests are vitest in the **node** environment —
  never import Phaser from a test.
- `buildStepContext` must keep agreeing with `serverTick`: who is solid and how a hull is sized come
  from the *same* shared functions (`carIdOf`, `otherCarHulls`) — change them there, never fork.
- **Statuses are the one part of combat the client predicts**, because `stepSim` reads them:
  `localModifiers` (shared `net/step-context.ts`) feeds the schema rows to the same
  `modifiersFromRows` the server uses. The badge strip (`scenes/status-hud.ts`, drawn by
  `ArenaScene.drawStatusStrip`) is load-bearing: **a status the player cannot see is reported as the
  car feeling wrong** — a slow with no badge reads as netcode. Drain is measured from the row's own
  `startTick`, since duration comes from the applier.
- **Combat is drawn, never predicted.** Your own press is drawn at once as a provisional shot
  (shared `ProvisionalShots`/`LocalFire`, spawned in `sendInputTick`, confirmed and eased in
  `beginShotFrame`) — never damage, FX or prediction. Live instances come from `state.weapons`,
  drawn at the local present by shared `ShotView` (advanced with `stepInstance`, bounces included,
  cars ignored; attached beams welded to the owner's drawn pose). **An impact is drawn only from an
  ENDED row (`alive: false`, `isShotEnding`), never from a row vanishing** — that may only mean it
  left the view. HP comes from `PlayerState.hp`.
- A dead car stops driving, predicting and interpolating. If `camera().spectate.target` is not
  `"none"` it gains shared `vision/spectate.ts` controls; a `"none"` wreck (Deathmatch, Conquer)
  holds the camera where it died and cuts (never eases) to the new car on respawn, marked by the
  blinking self arrow (`drawSelfArrow`, gated on `isPhasedAt`). There is no wreck on the field: it is
  intangible from the tick it dies and `deathFadeAlpha` fades it over `DEATH_FADE_MS` from
  `diedAtTick`, then the container is destroyed.

## Mode bundle

**The client installs exactly one mode bundle and lets it persist** (a tab holds one room), so
`net/mode-scope.ts` uses shared's `installMode`, not `withMode`/`scoped`. `BootScene.create()`
installs `DEFAULT_GAME_MODE` **before launching any scene** (`JoinScene` reads `flow().nameMax`; a
`cfg()` throw there blanks the page), and `watchRoomMode(room)` reinstalls from `state.mode` on join
and every change. Leaf reads then call `drive()`/`cars()`/`weapons()` directly. **Never read an
accessor at module scope**; `net/mode-memo.ts`'s `memoOnBundle(compute)` defers the read and
recomputes when the bundle identity changes.

## Field of vision

Pure geometry in shared `vision/vision.ts`, applied by `ArenaScene` only when `camera().fov.enabled`
(off in every shipped mode — `computeVision` returns at once). Under FOV the server stops sending
what this client may not know: a hidden enemy's `@view()` fields decode `undefined`, so **every
reader of a car's tagged fields goes through `net/in-view.ts`** (`carInView`, `inViewRoster`,
`feedRemoteTimeline`) and treats an out-of-view car as absent. A wreck reports its spectate pick
(`camera/spectate-report.ts`, `MSG_SPECTATE_TARGET`).

- Hiding is decided **per object, never by a stencil**: `renderCars` hides an out-of-sight enemy's
  container and shadows (`setCarVisible`, never destroying) and records it in `hiddenCars`;
  `renderShots` skips out-of-sight enemy instances; the fx layer derives events from the FULL world
  and filters through `fxHidden` (`fx/hidden.ts`), so a shot entering vision is not a new one.
- The dark overlay is one `Graphics` (`dimGfx`, `FOV_DIM_DEPTH`) with vision polygons cut out by an
  inverted Phaser 4 mask over `visionMaskGfx`; the driven car and its marks are lifted to
  `FOV_SELF_CAR_DEPTH` so nothing of your own car is dimmed. Vision uses last frame's drawn poses
  (one frame of latency, accepted). Bots do not respect FOV yet; a guard keeps FOV off bundles bots
  play in. See [`docs/networking.md`](../../docs/networking.md#what-a-client-may-know-nr42nr49).

## Aiming, the turret and pointer lock

There is no target lock or aim assist of any kind. Two aiming paths, one per muzzle kind:

- A **fixed-muzzle** shot leaves along the car's heading; the nose is its aiming HUD.
- A **turret** shot (a row carrying `WeaponDef.turret` — today `predator`, `magmablast`, `thumper`,
  `fury-horn`, `roadblock`, plus the nine inert basic-attack rows) leaves from the turret toward the
  **crosshair** (`scenes/crosshair.ts`, `config/crosshair.ts`). The crosshair is a **world offset
  from the driven car's centre** (`input/aim-offset.ts`), not a screen cursor: it rides with the car,
  keeps its world direction as the car turns, and is clamped every frame to
  `CROSSHAIR_CONFIG.maxDistance` and the turret's swing arc (`TURRET_CONFIG.maxSwingDeg`). `aimAngle`
  is computed from `turretPivotOf` on the **rendered** pose, because that is what the player aimed
  at. The drawn turret (`scenes/turret-visual.ts`) requires `carHasTurretWeapon(...) &&
  turret().visible` (Brawl hides it). See [`docs/combat-model.md`](../../docs/combat-model.md#turret-muzzle).

**Every active chassis has a turret weapon, so every one takes pointer lock in every mode.** A
config test in `turret-config.test.ts` asserts the live roster's turret posture. The turret-less
path is reachable only from a hand-built playground kit or a per-mode `replace()`, and it must keep
working:

- **The aim HUD** (`scenes/aim-hud.ts`, `config/aim-hud.ts`, at `AIM_HUD_DEPTH` under the driven car
  only, in its own frame) is drawn once and then MOVED each frame, re-filled only when
  `aimHudSignature` changes (Phaser re-tessellates a `Graphics` on every rebuild). Its TURRET group
  (crosshair, ring, swing limits) is gated on `ArenaScene.wantsPointerLock` = `carHasTurretWeapon`
  over the live fire slots, re-read every frame (a playground loadout swap can remove the turret
  under a held lock); **a car with no turret weapon is never asked for pointer lock.** Its MUZZLE
  group (four arrows) is always drawn. `AIM_HUD_CONFIG.turretHud`/`.muzzleHud` hide a group;
  `turretHud` deliberately does not hide the crosshair.
- **Dropping the lock must never drop firing.** `fireButtons` takes `usesLock`: false lets mouse
  buttons through unlocked, so a turret-less car still fires on click from its fixed muzzle.

The weapon slot HUD (`scenes/weapon-hud.ts`, drawn by `ArenaScene.drawHudSlot`) reads
`PlayerState.weapons` plus `level`, `switchLockUntilTick`, `pendingUntilTick` and `lastFiredSlot` —
the last two make the car-wide lockout dim correct for any wind-up, volley or recovery with no wire
change. `fire.ts`'s `pending` machine is never networked. See
[`docs/schema-reference.md`](../../docs/schema-reference.md#playerstate).

## Car lighting and shadows

**The arena has exactly one light**, `ENVIRONMENT_FX.carLook.lightAngle` (direction from car toward
light), and `scenes/car-lighting.ts` derives everything from it: a four-corner gradient tint, a drop
shadow, a contact shadow, a rim light. **Every derivation undoes the car's rotation** — the light is
world-fixed; fixed corner constants would spin the highlight with the bodywork and six cars would
look separately lit.

- **The rim is a tinted copy of the car's own ART**, nudged toward the light — not a stroked
  outline (stroking the 60 × 40 hull drew a picture frame). A procedural-silhouette car goes rimless.
- **Every shadow is one ellipse** sized by `carLook.footprint`, well inside the hull — never the
  chassis silhouette (it cast a hard box).
- **All shadow bands carry the same alpha**, `shadowAlpha / count`; stacking is the softness.
  Ramped alphas accumulated to ~0.75 and read as a hole.
- Shadows draw at a shared `CAR_SHADOW_DEPTH`, not inside each car's container (a parented shadow
  would draw over an overlapping car). They are two pooled `Image`s per car over two shared baked
  textures (`syncShadowTextures`, `shadowStampOf`), re-baked only when the shaping `carLook` fields
  change, and handed to the HUD camera's ignore list at birth. Re-filling them per frame on a
  `Graphics` cost 0.35–0.6 ms and was drawn by both cameras.
- The gradient tint lives in `applyCarSprite`, shared with `?dev=assets` so the tool cannot drift.
  Zeroing every `carLook` strength restores flat drawing exactly.

**Do not add a car glow without new evidence** — one was tried and removed. Adding light around a
DARK car erodes the contrast that makes it visible, and a halo pooling under a car bleeds through
the gaps in its art. `floorArt.darken` failed for the mirror reason and ships at 0. **What works is
brightening the car, not the ground**: the levers for "cars are hard to see" are `litStrength`,
`shadowAlpha`, `contactAlpha` and `lightAngle` (read the shipped values in `fx/environment.ts`);
watch that a high `litStrength` does not run the lit corners to white and drain the player colour. `floorArt.*` (`floorTintOf`, `assets/arena-floor.ts`) and `floor.*`
are mirrors — only one is live per arena and the panel says which.

## Colour

**Player colour is for cars; weapon colour is for shots.**

- A car's paint is `carFillFor(sessionId, colorId)` — `carFillOf` exactly, unless the PLAYGROUND has
  a tint switched ON for that seat (Car select panel, `dev/playground/car-panel.ts`). Entries are
  `{hex, on}` with a per-car checkbox saying which control is live (a control that silently does
  nothing is worse than one that says why). Keyed by **seat id** (`pg-0`…`pg-5`), not `colorId`
  (seats may share a colour) and not session id (a seat outlives a connection). Client-only
  (`fx/car-tint.ts`), seeded only by the playground and cleared on `PlaygroundScene.onShutdown`. All
  four fill sites (body tint, container build, dash ghost, roster swatch) go through it.
- **Shot colour is an authoring choice, not a signal.** Weapons are told apart by silhouette. There is
  no per-chassis palette; do not reintroduce one or "fix" two weapons sharing a hue. The one pairing
  meant to hold is `WEAPON_TABLE.color` against **its own HUD icon** — `npm run check:weapons` warns
  past `COLOR_DRIFT_LIMIT`, never fails. Several rows have no icon yet (`tremor`, `shockwave`,
  `fury-horn`, the basic attacks).
- `weaponFillOf(weaponId)` paints every instance of a weapon the same for every owner. Do not look up
  the shooter's `PlayerState` to paint a shot; the one `ownerSessionId` read is the FOV side test.
  `color` is read through `weapons()`, so two modes could paint a weapon differently.

## How a shot looks

Three tables in `scenes/combat-visual.ts`, split by hitbox kind; each returns `[]` for a weapon it
does not own, leaving the flat `weaponFillOf` fill as the fallback:

- `weaponGlowStyleOf`/`weaponGlowStyles()` (circles, nested by radius): `magmablast`'s explosion
  disc and the basic-attack rows (a lit core so a dark disc reads as a sphere on light floors).
- `WEAPON_BEAM_STYLES` (beams): `afterburner`, `lance`, `tremor`.
- `WEAPON_PROJECTILE_STYLES` (ellipse/capsule projectiles): `thumper`, `predator`, `pepperbox`
  (a halo-only entry), `roadblock`, `fury-horn`.

**A drawn shot never exceeds its hitbox** (half of D19 — it protects the player).
`instanceGlowBands` bands are fractions of the radius and flicker only shrinks;
`projectile-marks.test.ts` sweeps every authored layer at six headings. Exceptions, each deliberate:

- **Projectile halos** (`ProjectileHaloBand`, e.g. `pepperbox`) are the one projectile draw outside
  the hitbox, and they **offset** (`spread`) rather than scale, so the ring keeps uniform thickness
  on an ellipse. `projectileHaloShapes` inflates the hitbox through shared `projectileShapeAt` — no
  second copy of the geometry. Halos stay out of `projectileDrawLayers` so the containment sweep
  stays sharp. `pepperbox` gets two bands, not three, on cost grounds: 12 projectiles per press.
- The charge orb on the shooter's own car.
- **Auras** (disc beams at `origin: "center"`) are drawn as a ring, not filled (a filled disc hides
  the cars it is about to hit), plus a low-alpha wash for a bare aura (`AURA_WASH_ALPHA`,
  `auraWashOf`; `shockwave` 0.14; `magmablast`'s burst has a crust so takes none). `drawDefOf`
  takes the whole `DrawableInstance` and resolves through `instanceDefOf`, because a burst carries its
  parent shell's `weaponId`.

Load-bearing looks:

- **`predator`** is the one full missile, built by `predatorMissileLayers` with the `poly` layer. Its
  greys are deliberately **darker than its icon's** (the icon is drawn for a white page), and its
  `radiusAlong` was grown to CONTAIN the plume — the art and that number are one decision. A
  `poly`'s containment is `clampToHull`, per vertex.
- **`lance`** is the one animated look, a lightning bolt. `crackle` falls to **zero inward** so a
  straight core sits in a torn envelope (tearing every layer equally reads as a ribbon). `domeScale`
  is carved out of the beam's length, so it needs no hitbox exception. `crackleHz` re-rolls off
  `performance.now()`, so clients see different frames. **The rate is per LAYER**: per-frame vertex
  motion scales with `crackle × rate`, rolls are smoothstep-interpolated, and
  `combat-visual.test.ts` caps motion at 2 units per frame across every layer. `beamDrawLayers` takes
  `nowMs` as a defaulted last parameter.

### What a look costs

`renderShots` clears and rebuilds one shared `shotGfx` per frame; the realistic ceiling is ~60 live
instances. Bands are cheap. **Stop and warn before** a per-instance `setBlendMode` (breaks the
batch), a faked gradient of 15–20 bands, a `Graphics` per shot, or anything multiplying
`instanceGlowBands`' per-frame allocation. **The number to check is not fill count — it is ms to
build one frame at the ceiling plus ms Phaser spends rendering it.** `afterburner` is the high-water
mark; its first cut cost 3.8 ms/frame, almost all from re-hashing noise values, not fills. Measure,
don't guess — the [`weapon-look`](../../.claude/skills/weapon-look/SKILL.md) skill has the procedure
(twelve synthetic instances on a paused playground frame). See
[How much detail a shot can afford](../../docs/asset-pipeline.md#how-much-detail-a-shot-can-afford).

**Never hand Phaser a shape whose triangulation you already know.** `fillPoints`/`fillCircle` run
Earcut every frame. `scenes/ribbon-fill.ts` has `fillRibbon` (for a `DrawBeamLayer` carrying
`ribbon`, the per-edge station count) and `fillDisc` (every filled circle, from a cached rim).
`BOLT_VISIBLE_TEAR`: a bolt layer whose edge moves under half a unit draws straight.
`ribbon-fill.test.ts` sweeps every `WEAPON_TABLE` row and fails any polygon over
`EARCUT_VERTEX_BUDGET` (64) vertices without a `ribbon`.

**The slot bar is a baked picture.** `hudGfx` is on no display list: `renderWeaponHud` builds
commands every frame and `bakeHud` draws them into the `hudBake` render texture only when
`sameCommands` (`scenes/hud-bake.ts`) sees a difference, at `HUD_BAKE_SCALE` 2x. **Anything that
changes every tick belongs on `hudSweepGfx`** (the cooldown arc, status drain bars); a clock-driven
element on `hudGfx` silently turns the bake into a per-frame redraw — watch `bakes per second` in a
profile.

## Art and debug

Art is data. `public/art/manifest.json` maps namespaced keys (`car.bastion`, `weapon-icon.thumper`,
`arena.common.tile.<id>`) to sprite entries; `src/assets/` parses and fits them. A missing or broken
entry falls back to the procedural silhouette in `drawCar` — **that fallback is permanent**, and is
what lets art land one file at a time. Sprites are fitted to the OBB hull and never change it.
`?dev=assets` opens the asset tool (stripped from release builds; `scripts/build-release.mjs`
asserts it). `?debug=1` draws the car OBB hitbox.
