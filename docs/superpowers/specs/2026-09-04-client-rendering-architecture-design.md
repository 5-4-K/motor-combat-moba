# Motor Combat MOBA — Client Rendering Architecture Design

**Status: reviewed and approved by the user on 2026-09-04; every open question in §12 is resolved
in place.** Companion to
[`2026-09-04-online-netcode-and-client-architecture-design.md`](2026-09-04-online-netcode-and-client-architecture-design.md),
which gives the client a headless match model (`MatchClient`) that hands the renderer a plain
`RenderFrame` each frame and a stream of server events. That document said *what* the renderer is
given and split it into modules; it did not say *how* anything should be drawn. This one does. The
goal it was asked to meet: **cool visuals without eating resources or slowing the game down, on a
common personal computer.** Decisions are numbered R1–R26 (with R12a, R17a, R18a).

## 1. What the frame budget is, and where it goes today

A 60 Hz frame is 16.7 ms. On an integrated-graphics laptop the main thread has to fit the sim, the
render-frame build, Phaser's own scene-graph walk and draw submission, the browser's compositing and
GC pauses into it, so the client's own work has to fit in **about 6 ms of JavaScript** and the GPU
side in **about 6 ms of fill**. The two are separate budgets: a laptop can be starved on either
while the other idles.

Two measurements taken for this document, on this container's CPU (slower than a modern laptop by
perhaps 2×, so read the ratios, not the absolutes), at the roster's realistic visual ceiling —
six Mirages all burning `afterburner` (12 flame instances):

| Cost, per frame | Measured | Where |
|---|---|---|
| Build the flame geometry (`beamDrawLayers` × 12) | **2.65 ms**, 12,600 vertices | `combat-visual.ts`, pure TypeScript |
| Triangulate those 144 polygons (earcut, what Phaser's `FillPath` node does per fill per frame) | **3.88 ms**, 12,132 triangles | `phaser/src/renderer/webgl/renderNodes/FillPath.js:91` |
| Everything else on the shot layer (2 lances, 6 predators, 6 thumpers, 24 pellets, 6 magmablasts) | 0.32 ms | same builders |

So one weapon's cosmetics cost **6.5 ms of CPU per frame** here — the whole JavaScript budget — and
the earlier optimisation that took the flame from 3.8 ms to 1.1 ms only ever measured the first row.
The second row was invisible because it happens inside Phaser: `Graphics.fillPoints` records a
command, and every frame the WebGL `FillPath` render node transforms every point and runs earcut on
it again (`FillPath.js:63-91`). Nothing is cached between frames: `Graphics.clear()` is
`commandBuffer.length = 0` and the renderer re-walks the buffer per frame **per camera**, boxing every
vertex into a fresh `Point` object (`GraphicsWebGLRenderer.js:15-34, 388-406`). That is not a
Phaser defect; it is what an immediate-mode vector API is for.

Three consequences that the client's own cost notes did not know:

- **`fillCircle` is a 101-point path whatever its radius** (`arc` steps at 0.01 of a turn,
  `GraphicsWebGLRenderer.js:225-278`), and `fillRoundedRect` is four of those, ~408 points. A
  "one `fillCircle` per band" glow is 101 allocations and an earcut run per band per frame; the
  three HUD slot rings with their key pills are ~1,830 points per frame for three static 64 px
  circles; the countdown's movement hint is 14 rounded rects, ~5,700 points per frame, drawing a
  picture that never changes.
- **Allocation is the GC story.** At the ceiling the client allocates roughly 20,000 short-lived
  objects of its own per frame (`{x, y}` vertices, `[...near, ...far.reverse()]` joins, per-layer
  closures, `[...entries()].filter().map()` in `renderCars`, `Array.from` layouts in the HUD) and
  Phaser re-boxes another ~20,000 `Point`s on top: about 2.4 million allocations per second at
  60 Hz.
- **Every `Text` owns its own canvas-backed GL texture**: 54 of them in the arena, against 12 art
  PNGs. `setText` with a changed string re-rasterises and re-uploads; any style touch does too.

The client uses `Graphics` for almost everything:

- `shotGfx`, `hpGfx`, `lockGfx`, `arrowGfx`, `maneuverGfx`, `hudGfx`, `hudSweepGfx`, `rosterGfx`
  are `clear()`ed and refilled every frame (`ArenaScene.ts`). Only the arena floor and the movement
  hint are drawn once.
- Every projectile, glow band, beam, orb, hp bar, bracket, dash ghost, HUD ring, sweep arc, glyph
  and roster row is a fresh fill or stroke per frame.
- `Text` objects re-rasterise a canvas and re-upload a texture on every `setText` that changes;
  the pools exist to avoid touching style, which triggers the same re-raster.
- The only sprites are car bodies and weapon icons. There is no atlas, no particle emitter, no
  filter, no baked texture, no sprite-sheet animation.

Draw calls are **not** the bottleneck: the depth stack flushes about three times in the world camera
and four in the HUD, some seven to ten GL draw calls per frame. What scales is CPU geometry and
allocation. The result is a client whose per-frame CPU cost scales with *how detailed the art is*,
which is the opposite of what "cool visuals" needs. The rest of this document inverts that: **detail is paid once
at boot, frames pay only for position.**

## 2. What Phaser 4.2.1 gives us

Verified in `node_modules/phaser` (4.2.1). This matters because the client was on Phaser 3 until
recently and none of the v4 machinery is used yet.

| Facility | What it is | Cost model |
|---|---|---|
| Render-node renderer | quads use index buffers, multi-texture batching, state fully managed | a texture-atlased sprite is the cheapest thing it can draw; thousands per batch |
| `DynamicTexture` (`src/textures/DynamicTexture.js`) | a render target you draw Graphics, sprites or text into, then use as a texture with named frames | draw once at boot; drawing into it per frame is a render-target switch |
| `Stamp` | camera-independent quad meant for stamping into a `DynamicTexture` | the tool for a permanent decal layer; not used, because decals fade individually (R12a) |
| `ParticleEmitter` (`src/gameobjects/particles/`) | batched quads with per-particle alpha/scale/tint/rotation ops, emit and death zones, `maxParticles`, `explode`, `emitting` | one batch per emitter texture; pooled `Particle` objects |
| `SpriteGPULayer` | static GPU buffer of quads with GPU-driven tween animation, one draw call, "a million sprites" | zero CPU per frame; expensive to edit — for backgrounds and ambience only |
| Filters (`src/filters/`, `renderNodes/filters/`) — `obj.filters.internal/external` after `enableFilters()`, `camera.filters.internal/external`; there is no `preFX`/`postFX` in 4.x | Bloom and Shine are `Phaser.Actions.AddEffectBloom/AddEffectShine`, composed from `ParallelFilters` of Blur and Blend (`src/actions/AddEffectBloom.js`); Glow, Shadow, Blur×3 quality levels, ColorMatrix, Vignette, Displacement, Pixelate, Wipe, Barrel, Bokeh, TiltShift, Mask (masks are filters now), GradientMap, Quantize… | Phaser's own comment (`components/Filters.js:20-23`): each filtered object is a new draw call plus one per active filter, "use sparingly"; `AddEffectBloom.js:36`: "best as a full-screen effect" |
| `Shape` objects (`Rectangle`, `Arc`, `Polygon`…) | a `Graphics` whose `pathData` is computed once and re-tessellated only when the geometry changes (`shape/Shape.js:88-93`) | the cheap middle step for static-in-local-space geometry with a moving transform; still on the untextured batch, so it does not merge with sprites |
| `render` config (`core/typedefs/RenderConfig.js`) | `powerPreference`, `mipmapFilter` (default off, power-of-two textures only), `pathDetailThreshold` (a Graphics LOD, default 1 px), `autoMobileTextures` (one texture per batch on mobile), `batchSize`, `stencil`, `roundPixels` (textured objects only) | the client sets none of these today |
| `Gradient`, `Noise`, `NoiseSimplex` game objects | GPU-generated gradients and noise, animatable | per-pixel shader; cheap at small sizes, fill-rate bound at full screen |
| `BitmapText` | glyph quads from a pre-rendered font | batched with sprites; `setText` is a quad rebuild, no rasterisation |
| Tint modes (`MULTIPLY`, `FILL`, `ADD`, `SCREEN`, `OVERLAY`, `HARD_LIGHT`) | per-object GPU tint | free; replaces CPU recolouring |
| `TileSprite` | scrolling texture on a quad, now atlas-frame capable | one quad; the classic cheap "flowing energy" trick |
| `Rope` | textured strip along a path | tens of vertices for a beam that today costs hundreds |
| `Shader` (`ShaderQuadConfig`) | one custom fragment shader on a quad | for the two or three effects that are genuinely per-pixel (a cooldown sweep, a heat ripple) |
| `setLighting(true)`, `PointLight` | 2D lighting with normal maps | not needed; noted as available |
| `Graphics` | immediate-mode vector fills, earcut per fill per frame | the tool for debug overlays and for baking at boot — not for the per-frame path |

## 3. Principles

**R1 — Bake, don't build.** Any shape that looks the same every frame up to position, rotation,
scale, alpha and tint is drawn *once* into a texture at boot and thereafter is a sprite. This covers
every projectile body, glow disc, orb, ring, glyph, bracket arm, hp bar, HUD ring, badge and
silhouette in the game today. A sprite's per-frame cost is a transform and four vertices in a batch;
a `Graphics` fill's is tessellation.

**R2 — Geometry only when the shape itself changes, and then as textured strips.** A beam whose
extent grows, a bolt whose path jitters, a flame that convects — these are the only things that need
per-frame geometry, and even they are drawn as *textured* quads or `Rope` strips of a few dozen
vertices with the detail in the texture, never as hundred-vertex filled polygons. The existing
`combat-visual.ts` geometry stays as the **authoring source**: it runs at boot to bake textures and
flipbooks, not per frame.

**R3 — Retained, not immediate.** Every visual is an object that persists across frames; a frame
*updates* it. Nothing is cleared and rebuilt. A `Graphics` on the per-frame path is a bug except
behind a debug flag.

**R4 — Batches are planned, not discovered.** The world renders as a fixed sequence of layers, each
one texture atlas and one blend mode, so a full 6-player firefight is on the order of a dozen draw
calls. Per-object blend modes and per-object filters are forbidden in the world; if a look needs
additive glow it is a sprite on the additive layer.

**R5 — Transient things are particles.** Sparks, embers, smoke, dust, debris, muzzle flashes, tyre
smoke, death bursts: `ParticleEmitter`s from a shared pool with hard caps and a global budget, never
tweened game objects created and destroyed per event (today's impact spark allocates a circle and a
tween per hit).

**R6 — Zero allocation on the frame path.** The renderer keeps preallocated objects and typed
arrays; `RenderFrame` (netcode spec N23) is filled into reused structures. The frame path must not
call `map`, `filter`, spread, `[...entries()]`, or create closures. The flame's scratch-buffer
pattern in `combat-visual.ts` is the model, made the rule.

**R7 — Cost is measured at the ceiling before an effect ships.** Every effect declares its class
(§5) and the bench scene (§9) has a scenario for the ceiling. "It looks fine on my machine" is not a
number.

**R8 — Honesty over spectacle.** The rule from `docs/asset-pipeline.md` stands: the *opaque core* of a
drawn shot never exceeds its hitbox. This design adds the allowance a glow needs: a soft additive
halo may extend to 1.5× the hitbox at ≤ 25 % alpha, because a halo does not read as a hittable
surface. `combat-visual.test.ts`'s invariant is re-stated in those terms.

**R9 — Visuals that carry information are deterministic, and every animation is time-based.** An
effect a player reads — a lightning bolt's path, a flame's flicker phase, the death burst's
direction — is seeded from `(instance id, tick)` or comes from a server event, so two clients see
the same thing. Pure ambience may use a free-running clock. Every rate is per second and every
flipbook advances by elapsed time, never per rendered frame: today's lance crackle is budgeted at
"2 units of vertex movement per frame", which is an implicit 60 Hz assumption that reads as
snapping on a 30 fps laptop. (Today two `lance` beams crackle in step and different clients see
different frames; both go away.)

**R10 — Quality is a tier, and the tier is measured.** Three tiers, auto-selected from measured
frame time and persisted, plus a per-frame governor that sheds cosmetic load before the frame
overruns. The game never *needs* the top tier to be playable or fair.

## 4. The render stack

Bottom to top, each a layer with one atlas and one blend mode unless noted. World layers live in the
`ArenaScene`; HUD layers live in a separate `HudScene` (R20).

| # | Layer | Contents | Draw mode |
|---|---|---|---|
| 0 | Floor | the arena image, baked once; optional `Gradient`/`Noise` ambience at tier High | 1 quad (+1) |
| 1 | Decals | pooled ground sprites (skids, scorch marks, blast rings — none authored yet, R12a) that fade on a configured timer; cleared at match start | atlas, NORMAL; each is a transform and an alpha until it expires |
| 2 | Ground FX | dust, tyre smoke, debris — particles under the cars | 1 emitter batch, NORMAL blend |
| 3 | Cars | body sprites, shadow sprite, hp bar sprites, status badge sprites, dash ghosts, lock bracket arms, phased ghosting | atlas, NORMAL |
| 4 | Shots | projectile bodies, beam strips (`Rope`/`TileSprite`), orb cores, explosion rings | atlas, NORMAL |
| 5 | Glow | additive halos, flame cores, embers, sparks, muzzle flash, hit flashes | atlas, **ADD** — the one additive layer |
| 6 | Overlay FX | death burst, respawn shimmer, camera-space flashes | atlas, ADD or SCREEN |
| 7 | Debug | hitboxes, netgraph, perf overlay — `Graphics`, only when a flag is set | immediate mode, opt-in |
| H0 | HUD chrome | slot rings, badge frames, roster panel | atlas, NORMAL |
| H1 | HUD dynamic | cooldown sweeps as a baked sweep sheet (frame from the cooldown fraction), drain bars | atlas |
| H2 | HUD text | every number and label as `BitmapText` | font atlas |

Target for a full 6-player firefight: **≤ 12 draw calls** in the world, ≤ 4 in the HUD. Phaser's
multi-texture batching would tolerate more textures, but planning the atlases keeps the count from
drifting as art is added.

**R11 — Two atlases.** `art-atlas` is authored art (car bodies, weapon icons, any hand-painted
effect frames), packed at build time by a new `scripts/pack-atlas.mjs` from the existing
`public/art/` tree and the manifest, so importers keep working as they do. `baked-atlas` is a
`DynamicTexture` built at boot by `render/bake.ts` from the procedural geometry in
`combat-visual.ts` (glow discs from `instanceGlowBands`, missile layers from
`projectileDrawLayers`, orb bands, rings, the HUD glyph, bracket arms, the procedural car
silhouettes, the flame flipbook of R14) with named frames. Baking six chassis-and-weapon looks takes
a few milliseconds once; it replaces the same work done sixty times a second.

## 5. Effect classes and the catalogue

Every visual belongs to one class, and its class fixes what it may cost.

| Class | Definition | Per-frame cost allowed |
|---|---|---|
| **S** static sprite | position/rotation/scale/alpha/tint of a baked frame | a transform |
| **A** animated sprite | a flipbook from the atlas, frame chosen from tick or age | a frame index |
| **T** textured strip | `Rope`, `TileSprite` or a stretched quad whose vertices follow a short path | ≤ 40 vertices |
| **P** particles | emitter output, capped | pool churn only |
| **D** decal | a pooled ground sprite that fades over its configured time (R12a) | a transform and an alpha until it expires |
| **F** filter | a camera-level post pass | tier High only |
| **G** geometry | `Graphics` | debug only |

**R12 — The catalogue.** What each thing the game draws today becomes:

| Visual | Today | Becomes | Class |
|---|---|---|---|
| Car body | sprite or procedural silhouette (Graphics) | sprite from `art-atlas`; silhouette fallback baked into `baked-atlas` | S |
| Player colour | `colorMode` tint at load | GPU tint mode (`MULTIPLY` for painted art, `FILL` for silhouettes) | S |
| Car shadow | none | one soft blob sprite under each car; sells height and speed for a quad | S |
| Hp bar | 2 `fillPoints` per car per frame | 2 sprites (track + fill scaled by `hp`, tinted by allegiance); visual ease toward the snapshot value; white flash on `hit` | S |
| Death | alpha fade over 1 s | fade + a burst of debris and smoke (P) + a scorch decal (D); wreck fades to a decal instead of vanishing | P, D |
| Phased | alpha 0.45 | alpha + a baked outline sprite pulsing; a shimmer particle ring on respawn | S, P |
| Statuses on a car | HUD badge only | badge sprite on the car: looping flipbooks — burning (overheated), drip (corroded), sparks (stunned), spikes (spiked), shield ring (fortified) | A |
| Dash ghosts | 3 `strokePoints` | 3 copies of the body sprite at falling alpha, ADD layer | S |
| Charge outline | `strokePoints` | baked outline sprite scaled to the hull | S |
| Lock bracket | 8 stroke calls | 4 baked arm sprites positioned at the target's corners | S |
| Countdown arrow | `fillTriangle` | sprite, bobbing | S |
| Projectile bodies (`predator`, `thumper`, `pepperbox`, `roadblock`, `magmablast`) | fills per frame from `projectileDrawLayers` / `instanceDrawShape` | one baked frame per weapon, rotated to `angle`; `predator` gets an exhaust emitter (P) and a 2-frame flicker (A) | S, A, P |
| Glow bands | `fillCircle` per band per frame | one baked radial-gradient disc per weapon on the Glow layer, scaled by the flicker curve | S |
| `magmablast` explosion | `fillCircle` + ring | ring sprite scaling out (S) + burst particles (P) + blast decal (D) + a 100 ms bloom boost at tier High (F) | S, P, D, F |
| `afterburner` flame | 5 layers + 8 embers of geometry, 12,600 vertices at the ceiling | **flipbook**: the existing `jetProfile` bakes 24 frames × 2 lengths at boot; the live flame is one `A` sprite anchored to the muzzle, plus an ember emitter (P) and a heat halo on the Glow layer (S). Per-frame cost at the ceiling: 12 frame indices | A, P, S |
| `lance` bolt | ~1,660 vertices of geometry per bolt | a `Rope` of 24 segments along a seeded jitter path with a lightning texture (T), a glow strip beneath it (T), a charge orb sprite (S) | T, S |
| `tremor` zone | cone polygon | baked cone gradient sprite scaled to `extent` (S) + ground dust (P) | S, P |
| Aura ring / disc | ring + wash fills | baked ring sprite scaled to `extent` | S |
| Impact | a `circle` + tween per hit, local two-timebase detection | on the server `hit` event: sparks (P) at the event's point, a flash sprite (S), target hit-flash via `FILL` tint for 60 ms, camera shake scaled by damage | P, S |
| Ram / slam | none | on the `ram`/`slam` event: debris and dust (P), a skid decal (D), shake by severity | P, D |
| Skid marks | none | stamped into the decal layer when a car's lateral velocity or a knock exceeds a threshold (client-side, cosmetic, from the predicted world) | D |
| Muzzle flash | none | 2-frame flipbook on the Glow layer at the muzzle, from the ghost shot's birth tick | A |
| Arena floor | `Graphics` once | image; at tier High a slow `Noise` breathe on the floor lines | S, F-ish |
| HUD slot ring, sweep, glyph, key pill, badges, roster | all `Graphics` + `Text` per frame | baked ring frames; the sweep as a baked sweep sheet, frame chosen from the cooldown fraction; numbers and names as `BitmapText` | S, A, H2 |

Everything in the "Becomes" column is on the list because a version of it already exists in
`combat-visual.ts` as geometry, or is the standard cheap expression of a thing the game already
signals. Nothing here adds a *mechanic*; the sim is untouched. **No decal ships in this pass**
(decided 2026-09-04): every row above that names a scorch, skid or blast decal is a candidate for
the mechanism in R12a, not a commitment.

**R12a — The decal mechanism, with no decals.** `render/decals.ts` owns a pool of ground sprites
on layer 1 and exposes `place(def, x, y, angle)`. A `DecalDef` names its atlas frame, size and
optionally its own `fadeMs`; a decal that names none fades over the global
`DECAL_CONFIG.fadeMs` (a few seconds; render-only, in `packages/client/src/config/decals.ts`
beside the other client render knobs). A placed decal holds full alpha for `holdMs`, fades
linearly to zero over `fadeMs`, and returns to the pool; the pool is capped at
`DECAL_CONFIG.maxLive` per tier and the oldest is recycled first. Because each decal is its own
sprite it fades on its own clock, which a single stamped texture cannot do; the cost is one batched
quad per live decal instead of zero, bounded by the cap. The service ships with an empty
`DecalDef` table and a unit test of the timing and the cap; authoring the first decal is a table
row and an atlas frame.

## 6. Baking

**R13 — `render/bake.ts` runs once in `BootScene`, through `DynamicTexture`, not
`generateTexture`.** `Graphics.generateTexture` renders through the Canvas 2D path
(`Graphics.js:1583`), so it cannot bake gradients or blend modes; `DynamicTexture.draw` goes through
the WebGL renderer and can (`textures/DynamicTexture.js:785-793`). It creates the `baked-atlas` `DynamicTexture`
(2048 × 2048 at tier High, 1024 at Low), walks a manifest of bake jobs, draws each with a scratch
`Graphics` at supersample 2 through the *same* pure builders the client uses today, and registers a
frame per job. Jobs are pure functions `(gfx, frame) => void` beside the style tables, so an
artist-programmer adds a look by adding a bake job and a style entry, never by writing a per-frame
draw. The bake is deterministic and its frame table is asserted by a unit test that runs the bakers
headlessly against a stub `Graphics` recorder (the same trick `combat-visual.test.ts` already uses
for geometry).

**R14 — Flipbooks are baked from the procedural authoring code.** The afterburner is the model: the
existing `jetProfile`/`conePoints` code renders N frames of its animation at boot into a strip of
frames, and the live effect plays the strip. The authoring code is kept, tested, and no longer on
the frame path. Frame count and size are tier-dependent (24 × 2 at High, 12 × 1 at Low).

**R15 — Authored art goes through one packer.** `scripts/pack-atlas.mjs` (sharp-based, a shelf
packer) emits `public/art/art-atlas.png` + `.json` from the manifest at build time;
`scripts/check-art.mjs` gains a check that every manifest row is in the atlas. The importers and
the `?dev=assets` tool are unchanged; the manual page keeps linking the loose PNGs.

## 7. Particles

**R16 — A particle service with a global budget.** `render/particles.ts` owns one emitter per
(texture frame, blend layer) pair — sparks, embers, smoke, dust, debris, shimmer — each with a
`maxParticles`, and exposes `burst(kind, x, y, count, priority)` and `stream(kind, follow, rate)`.
A global cap per tier (Low 96, Medium 256, High 512 live particles) is enforced by the service, not
by callers: when the cap is hit, the lowest-priority request is refused. Priority is
*informative* (hit sparks, death burst, ram debris — things that tell the player what happened)
over *cosmetic* (exhaust, embers, dust). Emitters are created once per match and reused; nothing is
constructed on an event.

## 8. Cameras, scenes and pixels

**R17 — Device-pixel-ratio rendering, tiered.** The deferred roadmap item lands here: the game
renders at `min(devicePixelRatio, tierCap)` (Low 1, Medium 1.5, High 2) and `FIT`s to the same CSS
size, so a 150 %-scaled laptop screen is sharp. Phaser 4 has no `resolution` option, so this is the
by-hand version the roadmap describes — game size × dpr, camera zoom × dpr — with two of its five
bullet points gone: there are no `Text` objects left to `setResolution`, and there is one scene per
camera (R20) instead of two cameras to keep in step. Textures are baked at supersample 2 already
(`SUPERSAMPLE`), so a dpr of 2 draws them 1:1; the baked atlas is power-of-two, so `mipmapFilter`
can be enabled for it and a dpr of 1.5 minifies cleanly, which non-power-of-two loose PNGs cannot.
Fill rate scales with dpr² — dpr 2 at 1424 × 720 is four times the pixels — which is why it is a
tier knob and why Low pins it at 1.

**R17a — The `render` config block.** `powerPreference: "high-performance"` (an integrated GPU still
benefits from the browser not picking its low-power path), `mipmapFilter: "LINEAR_MIPMAP_LINEAR"`
for the atlases, `autoMobileTextures: false` (this is a desktop game and the default forces one
texture per batch on anything that reports as mobile), `pathDetailThreshold` left alone (no
`Graphics` remains to apply it to). Every value is set explicitly with a one-line reason, because
today the block is absent and every default is silently in force.

**R18 — Camera shake and zoom punches are the camera's own.** `cameras.main.shake` and a 60 ms zoom
punch on a kill are native, cost nothing, and are driven by events with magnitudes from a small
table (`render/feedback-table.ts`), not from local detection.

**R18a — A late-revealed maneuver renders as the effect, not as a slide.** When a snapshot reveals
that a remote car began a dash inside the extrapolation window (netcode spec N31), the correction
is larger than any render offset should hide. Instead of decaying an offset, the car renderer plays
the maneuver's own trail — the dash ghosts and flash — from the revealed start point to the
current point over a few frames, and the car itself is placed at its corrected position at once.
The player reads "that car dashed" a little late rather than "that car teleported". The same rule
covers a revealed slam or a respawn.

**R19 — Filters are camera-level and tier-gated.** At tier High the world camera carries one
half-resolution Bloom (a `ParallelFilters` of Blur-low and Blend, which is how Phaser 4 composes
one) whose strength the explosion and death events
briefly raise, and a static Vignette. No filter is ever attached to an individual world object.
Medium and Low carry none. The Glow *layer* (R4) is what gives shots their glow at every tier; bloom
is a garnish.

**R20 — The HUD is its own scene.** `HudScene` runs in parallel with `ArenaScene` (Phaser
`scene.launch`), reads the same `RenderFrame`, and has its own camera in screen pixels. This deletes
the two-camera `ignore` lists and the "born after `splitCameras`" footgun: a world object can never
leak into the HUD or vice versa, because they are different scenes. The HUD is retained (R3): a slot
ring updates only when its slot state changes, a `BitmapText` only when its string changes.

## 9. Tiers, governor and measurement

**R21 — Tiers.**

| | Low | Medium (default) | High |
|---|---|---|---|
| dpr cap | 1 | 1.5 | 2 |
| particles | 96 | 256 | 512 |
| flipbook frames (flame) | 12 × 1 | 24 × 2 | 24 × 2 |
| status flipbooks on cars | off | on | on |
| decal cap (`maxLive`) | 16 | 48 | 96 |
| bloom / vignette | off | off | on |
| floor ambience | off | off | on |
| bake atlas | 1024² | 2048² | 2048² |

**R22 — Auto-tier and the governor.** The client starts at Medium, measures p95 frame time over
rolling 5 s windows, steps **down** a tier after one window over 14 ms, steps **up** at most once
after 60 s under 8 ms, and persists the result. Within a tier, a per-frame governor sheds cosmetic
particle spawns and skips the decal stamp when the previous frame exceeded 12 ms, so a spike never
compounds. The player can pin a tier in settings.

**R23 — `?debug=perf` overlay.** Frame time split (sim, frame build, Phaser update, render), draw
calls, live particles, texture count, tier, governor state; the netgraph from the netcode spec sits
beside it. Both are `BitmapText`.

**R24 — The bench scene.** `?dev=bench` (dev-only, stripped from release like the playground)
spawns the ceiling scenario without a server: six cars burning, two lances, forty instances, a
scripted stream of hit and ram events, 400 particles, and reports p50/p95 frame time and draw
calls over 10 s. Under Playwright with software GL, on Chromium and Firefox (the supported browsers with Edge,
decided 2026-09-04), it is the CPU-side regression check that runs in CI; on a real laptop it is the number an effect is judged against (R7). The node microbenchmark used
for this document becomes `scripts/bench-visual.mjs` and measures **bake** time, which is what the
builders now cost.

**R25 — Acceptance on the reference machine.** Decided 2026-09-04: the floor is the 2019
integrated-graphics laptop class — a four-core mobile CPU (Core i5-8250U or Ryzen 5 3500U class),
Intel UHD 620 or Vega 8 graphics, 8 GB, 1080p at 60 Hz, 125–150 % display scaling — comfortable
at tier Medium. The 2015–2017 dual-core class (HD 520/620, 4–8 GB) is the Low tier's job, caught by
the auto-tier (R22) rather than by the acceptance table; budget hardware below that is not a
target. Measured at 1080p, dpr 1.5, tier Medium:

| Metric | Required |
|---|---|
| Client JavaScript per frame at the ceiling | p95 < 5 ms (sim + frame build + Phaser update + submit) |
| Draw calls at the ceiling | ≤ 16 world + HUD |
| GC pauses during a 10-minute match | none over 5 ms attributable to the renderer |
| Frame time at the ceiling, tier High | p95 < 12 ms |
| Frame time at the ceiling, tier Low, dpr 1 | p95 < 8 ms |
| Boot bake | < 150 ms |

## 10. Migration

Each phase ships alone and keeps the suites green; each replaces a `Graphics` path with a retained
one and deletes the old path in the same change so there is never two ways to draw a thing.

| Phase | Ships | Deletes |
|---|---|---|
| V0 Instrument | perf overlay, bench scene, `bench-visual.mjs`, baseline numbers | — |
| V1 HUD | `HudScene`, `BitmapText`, baked rings, baked sweep sheet, retained updates | `hudGfx`, `hudSweepGfx`, `rosterGfx`, the `Text` pools, `splitCameras` and its ignore lists |
| V2 Bake | `bake.ts`, `baked-atlas`, `pack-atlas.mjs`; projectiles, glows, orbs, hp bars, brackets, ghosts, arrows as sprites | `shotGfx` for projectiles, `hpGfx`, `lockGfx`, `arrowGfx`, `maneuverGfx` |
| V3 Beams | flame flipbook, lance rope, tremor and aura sprites | the last per-frame `Graphics` in the world path; `beamDrawLayers` becomes bake-only |
| V4 Events | particle service, decal mechanism with no decals authored (R12a), event-driven feedback, status flipbooks, shadows, muzzle flash | `impact-feedback.ts`'s local detection |
| V5 Pixels | tiers, governor, dpr, bloom and vignette at High, floor ambience | — |

V1 and V2 can start before the netcode work's phase 3; V4 depends on the events channel of the
netcode spec (N23a) and on `RenderFrame`.

## 11. Decisions at a glance

| # | Decision |
|---|---|
| R1 | Bake anything static-up-to-transform into a texture at boot |
| R2 | Per-frame geometry only for changing shapes, as textured strips of ≤ 40 vertices |
| R3 | Retained objects updated per frame; no clear-and-refill |
| R4 | Planned layers, one atlas and one blend per layer; no per-object blend or filter in the world |
| R5 | Transients are pooled particles |
| R6 | Zero allocation on the frame path |
| R7 | Every effect is measured at the ceiling in the bench scene before it ships |
| R8 | Opaque core ≤ hitbox; additive halo ≤ 1.5× at ≤ 25 % alpha |
| R9 | Informative visuals are seeded by (instance, tick) or come from events |
| R10 | Three measured quality tiers plus a governor |
| R11 | Two atlases: authored `art-atlas`, procedural `baked-atlas` |
| R12 | The catalogue: what each visual becomes |
| R12a | The decal mechanism: pooled fading ground sprites, global fade time overridable per decal, no decals authored |
| R13 | `bake.ts` runs the existing pure builders once at boot |
| R14 | Flipbooks are baked from the procedural authoring code |
| R15 | One build-time packer for authored art |
| R16 | A particle service with tiered global caps and priorities |
| R17 | Device-pixel-ratio rendering, capped by tier |
| R17a | An explicit `render` config block |
| R18a | A late-revealed maneuver renders as its own effect, not a slide |
| R18 | Native camera shake and zoom punch from an event table |
| R19 | Camera-level filters at tier High only |
| R20 | The HUD is its own parallel scene |
| R21 | Tier table |
| R22 | Auto-tier and the per-frame governor |
| R23 | `?debug=perf` overlay |
| R24 | `?dev=bench` ceiling scene, CI-run under Playwright |
| R25 | Acceptance numbers |
| R26 | Migration V0–V5 |

## 12. Open questions for the reviewer

1. **The halo allowance (R8) — resolved 2026-09-04: allowed.** The opaque core stays pinned to the
   hitbox by the existing test; an additive halo may extend to 1.5× at ≤ 25 % alpha, and the test
   is re-stated in those two terms.
2. **Cooldown sweep: shader or sheet (R12) — resolved 2026-09-04: a baked sweep sheet**, one frame
   per 6° (90 frames at 4° if the stepping shows on a long cooldown), chosen from the cooldown
   fraction; a batched sprite, no GLSL.
3. **Bloom at all (R19) — resolved 2026-09-04: keep, tier High only.**
4. **Decal persistence (R12) — resolved 2026-09-04: decals fade after a few seconds, the time from
   a global config overridable per decal, and none is authored now; only the mechanism ships
   (R12a).**
5. **Beams: flipbook and rope, or a fragment shader (R12, R14) — resolved 2026-09-04: flipbook
   for the flame and the bolt; shaders reserved for per-pixel effects.** The order of preference
   for any new visual, cheapest first: a baked sprite transformed (glows, bodies, rings, bars);
   a flipbook when the shape itself animates (muzzle flash, flame, bolt, status badges); particles
   for anything transient and numerous (sparks, embers, smoke, trails, debris); a shader only when
   the look cannot be a picture (heat shimmer, distortion, dissolve). The reason is batching: the
   first three ride the atlas batch and cost the same to submit however many there are, while a
   `Shader` object is its own draw call each time it appears. Authored sprite sheets drop into the
   authored atlas through the importer pattern, so polish work needs no code for most effects.

## 13. What this touches that needs stop-and-ask

Nothing in the sim. This document changes only how the client draws. The hitbox model is untouched;
R8 is a *drawing* allowance and the honesty test still pins the opaque core to the hitbox.
