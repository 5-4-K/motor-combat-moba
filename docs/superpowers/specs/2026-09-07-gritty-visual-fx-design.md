# Motor Combat MOBA — Gritty Visual FX Design

**Designed:** 2026-09-07 · **Recorded in repo:** 2026-09-07
**Status:** Approved, not yet implemented.
**Builds on:** the shipped client render path — `ArenaScene`'s `update` order, its two-camera split,
the depth ladder, and the pure-decision-module convention that `combat-visual.ts`, `car-visual.ts`
and `impact-feedback.ts` already follow. Nothing here changes `sim/`, the schema, or a shared table.

Decisions are numbered **VFX1–VFX36** and referenced by number elsewhere.

---

## Problem

The game reads as a prototype, and the reason is measurable rather than a matter of taste. A count of
render features across `packages/client/src` at the time of writing:

| Feature | Occurrences |
|---|---|
| `add.particles` / emitters | **0** |
| `setBlendMode` | **1** |
| `postFX` / `preFX` / filters | **0** |
| `RenderTexture` | **0** |
| `setPipeline` | **0** |
| `Graphics` | 44 |

Six specific causes follow from that, ordered by how much each costs:

1. **Nothing glows.** Every shot is an opaque vector fill with a hard edge — `WEAPON_PROJECTILE_STYLES.thumper`
   is a `"hull"` disc plus a `"band"`. Layered vector reads as coloured plastic no matter how many
   bands are added.
2. **No particles anywhere.** No muzzle flash, impact sparks, smoke, debris, exhaust or tyre dust.
   Shots appear and vanish.
3. **Nothing persists.** No `RenderTexture`, so no scorch, no rubber, no lingering smoke. The floor
   at second 90 is pixel-identical to second 0; nothing records that a fight happened.
4. **The floor is one flat colour.** `ArenaScene.drawArena` is `cam.setBackgroundColor(colors.floor)`
   and a `Graphics` pass for obstacles and the border. No texture, no grade, no vignette.
5. **Cars are 48×32 at `CAMERA_CONFIG.zoom` 1** on a 1280×720 canvas — 3.7% of the screen width.
   Each is one flat multiply-tinted image: no drop shadow, no highlight pass, no light direction.
6. **No camera language.** Seven `shake` calls and two `flash` in the whole client; no hit-stop, no
   zoom punch. `showImpact` is a fixed `shake(120, 0.006)` and one white circle.

---

## Scope

**In:** a new `packages/client/src/fx/` module set — procedural texture generators, an FX event seam
derived from state deltas, a client-side `WEAPON_FX` table, emitter spec math, a decal layer, and a
smoke-occlusion mask; one Phaser shell (`fx/layer.ts`) that owns the `RenderTexture`s and emitters;
three new depth constants; a gritty treatment of the arena floor; a severity-driven replacement for
`showImpact`'s fixed shake, plus hit-stop on kills; two global camera Filters (`ColorMatrix` grade
and `Vignette`); and a scratchpad previewer built off the shipped `fx/` functions.

**Out:** any change to `stepSim`, the drive model, the OBB hitbox model, collision-damage rules or
friendly-fire; any new or changed **schema field**; any change to a **shared** config table
(`WEAPON_TABLE`, `CAR_TABLE`, `DRIVE_CONFIG`, `COMBAT_CONFIG`, `STATUS_*`, `RAM_CONFIG`, `AIM_CONFIG`);
any change to the tick pipeline, prediction, or `TICK_RATE_HZ`; any new image file in `public/art/`;
any change to `CAMERA_CONFIG.zoom` or the arena's world scale; new playtest probes; sound.

---

## Direction

**VFX1.** The target is **gritty / grounded**: textured asphalt with cracks and painted markings,
rubber and scorch that persist, fire and smoke rather than energy, physical debris, a warm-desaturated
grade and a vignette.

**VFX2.** Three alternatives were rendered at true 1:1 on the real arena with the real car sprites
and rejected. **Neon/energy** — dark floor, additive bloomed shots — was the lower-variance path and
the original recommendation, rejected on preference. **Clean stylized arcade** — uniform dark outline
and drop shadow on everything — was the most readable and least cinematic. **Juice-only** — today's
art direction plus an effects layer — was shown to genuinely fix "there are no effects" while leaving
the flat floor and hard-edged shots that read as prototype.

**VFX3.** Gritty needs **no car art**. The comparison frames used the shipped `bastion.png`,
`bullseye.png` and `mirage.png` unmodified: the cast shadow and the top-light gradient are both
derived from the sprite's own **alpha channel**, so they are correct for any chassis added later and
cost nothing per chassis. A car re-lighting pass is a later upgrade, not an entry cost.

---

## The texture spike, and what it settled

**VFX4.** Every texture is **generated in code from seeded value noise at boot**. No image files are
added to `public/art/`. This was proven with a live previewer before the design was written, and it
is the decision the whole cost estimate rests on: an earlier estimate of roughly nine one-time image
files collapses to zero.

**VFX5.** The generator that matters is the **noise bite**: a puff's alpha is a radial falloff *eaten
into* by fbm, so the silhouette is ragged. A smooth radial gradient alone produces a grey blob. The
same bite applies to the flame edge, which is what stops fire ringing like a circle.

**VFX6.** The set is **dust, soot, fire, spark, scorch, asphalt** — six generators, two variants each
for dust, soot and fire, so no two puffs in a burst are the same shape.

**VFX7.** Soot is a **warm mid-grey, not black.** Near-black soot on dark asphalt has no contrast and
swallows whatever it lands on — it was tried and was worse than no smoke. Blast smoke is lit from
inside by its own fire, so it carries a warm bias (r > g > b) and sits well above the floor's value.

**VFX8.** Textures are **reseedable**, and surviving a reseed is the acceptance criterion. A generator
that only looks right on one seed is a lucky image, not a generator.

---

## The event seam

**VFX9.** FX events are **derived from state deltas on the client**. No event is added to the wire and
no schema field is added. `deriveFxEvents(prev, next)` is pure and returns `FxEvent[]`.

**VFX10.** The derivations available with no wire change:

| Event | Derived from |
|---|---|
| `shotFired` | a new id in the `instances` map (`WeaponInstanceState.spawnTick`) |
| `shotEnded` | an id leaving the map, at its last known pose |
| `damaged` | an hp drop on a `PlayerState` between patches |
| `died` | `alive` going false, or a fresh `diedAtTick` |
| `rammed` | already derived locally by `freshImpacts` in `impact-feedback.ts` |

**VFX11.** This is not a compromise, it is the load-bearing choice. Hard invariant 8 stays intact
because `stepSim` never reads any of it, and **netcode phase 2 replaces the Colyseus schema with a
hand-packed binary snapshot** — a schema field added here would be thrown away by that phase. A
derivation over two views survives it.

**VFX12.** `shotEnded` knows *where* a shot ended but not *what it hit*. That is sufficient for a
detonation at the last known pose, and no more precision is bought.

---

## Architecture

**VFX13.** The system lives in **`packages/client/src/fx/`** as pure modules with one Phaser shell,
matching the convention `combat-visual.ts`, `car-visual.ts` and `impact-feedback.ts` already
establish: decisions are pure and unit-tested without a browser, and `ArenaScene` is the shell that
makes the Phaser calls.

| Module | Responsibility | Imports Phaser |
|---|---|---|
| `fx/textures.ts` | the noise generators; seed in, pixel data out | no |
| `fx/events.ts` | `deriveFxEvents(prev, next)` | no |
| `fx/table.ts` | `WEAPON_FX`, one row per weapon id | no |
| `fx/emitters.ts` | event + row → plain emitter spec data | no |
| `fx/decals.ts` | what to stamp where, and the fade rate | no |
| `fx/occlusion.ts` | eraser stamps for a set of car poses | no |
| `fx/layer.ts` | owns the `RenderTexture`s and emitters; draws | **yes** |

**VFX14.** `fx/layer.ts` is the only file in `fx/` that cannot be unit tested, and it is kept thin
enough to be reviewed by eye.

**VFX15.** Built **now**, not after the netcode rewrite. `ArenaScene.ts` is 2951 lines and netcode
phase 3 splits it into a headless `match/` half and a `render/` half; because `fx/` is self-contained
behind a narrow seam, that phase moves it wholesale rather than untangling it. Waiting would queue
the visuals behind the two largest phases of a fourteen-phase program, none of which has started.

---

## Data flow

**VFX16.** One hook in `ArenaScene.update`, between `renderShots` and the HUD passes:

```
deriveFxEvents(prevView, view)          → events
  emitterSpecsFor(event, WEAPON_FX)     → specs
  FxLayer.spawn(specs)
  FxLayer.render(cars):
      1. decal RT:  fade, then stamp new rubber and scorch
      2. smoke RT:  draw smoke, erase soft car silhouettes, blit
      3. fire / sparks / debris: direct, ADD blend, no occlusion pass
```

**VFX17.** The HUD passes stay last. `renderRosterPanel` returns the panel height that
`renderWeaponHud` lays out against, and nothing in `fx/` may sit between them.

---

## Occlusion: smoke fades where it overlaps a car

**VFX18.** Smoke **must never hide a car.** In a last-player-standing game, losing sight of an
opponent to your own weapon effect costs information the player needs, and would be reported as a
bug. This is a gameplay constraint, not an aesthetic one.

**VFX19.** The mechanism is an **erase mask**: smoke renders into a `RenderTexture`, a soft blurred
car silhouette is erased at each car's pose, and the result is blitted. Smoke keeps full thickness
everywhere except a soft halo punched exactly around each car. `RenderTexture.erase()` exists in the
installed Phaser 4.2.1 (`node_modules/phaser/types/phaser.d.ts:49950`), and the `ERASE` blend mode is
documented as working only when rendering to a framebuffer — which is this case exactly.

**VFX20.** Two alternatives were considered and rejected. **Per-particle proximity fade** (scale each
particle's alpha by distance to the nearest car) is free but fades the *whole* puff, so smoke reads
as timid and visibly thins from across the arena. **Depth order only** (cars above smoke) is one line
and always readable, but removes every interaction between smoke and cars, so a car inside a plume
sits cleanly on top of it.

**VFX21.** The eraser stamp is the **sprite-alpha silhouette**, blurred **once at boot per chassis**,
never per frame. Same derivation as VFX3's shadow, so a new chassis needs no new work.

**VFX22.** **Only smoke** is masked. Fire, sparks and debris are additive and live a few hundred
milliseconds; they brighten a car rather than hiding it, and a mask on them buys nothing.

---

## Depth

**VFX23.** Three constants slot into the existing ladder (`ARENA -10`, `SHOT -5`, `CAR 0`,
`MANEUVER 2`, `ARROW 52`, `LOCK 55`, `HP_BAR 60`, `HUD 1000`):

| Constant | Value | Holds |
|---|---|---|
| `DECAL_DEPTH` | −8 | rubber, scorch |
| `GROUND_FX_DEPTH` | −6 | debris, ground sparks |
| `AIR_FX_DEPTH` | 10 | smoke, fire — above the cars, because it is in the air |

**VFX24.** This yields a **second readability guarantee at no cost**: hp bars, lock brackets and
off-screen arrows all draw at 52–60, far above `AIR_FX_DEPTH`. A car inside a smoke cloud keeps its
bar and its bracket. VFX19 keeps the car readable; the depth ladder keeps its *information* readable
regardless of how the mask is later tuned.

---

## The camera-ignore trap

**VFX25.** `ArenaScene.splitCameras` requires every display object to be ignored by **exactly one**
camera — ignored by neither and it draws twice, ignored by both and it vanishes. `FxLayer` therefore
exposes a single `displayObjects()` accessor and `splitCameras` registers the whole list in one call.
One place to get right, rather than one per emitter.

---

## Camera language and grade

**VFX26.** `showImpact`'s fixed `shake(120, 0.006)` is replaced by a magnitude derived from event
severity, and a brief hit-stop is added on kills. `showImpact` stays render-only and keeps reacting
to locally observed contact — it must never change anything the sim or the schema can see.

**VFX27.** Two global camera Filters: **`ColorMatrix`** for a warm-desaturated grade, which is a large
fraction of what reads as gritty and costs nothing per object, and **`Vignette`**, which the spike
hand-rolled and which is a built-in.

**VFX28.** **Phaser 4 has no `Bloom` filter.** Phaser 4 replaced Phaser 3's `postFX`/`preFX` with a
camera **Filters** system; the installed 4.2.1 exposes `Barrel, Blend, Blocky, Blur, Bokeh,
ColorMatrix, CombineColorMatrix, Displacement, Glow, GradientMap, ImageLight, Key, Mask, NormalTools,
PanoramaBlur, ParallelFilters, Pixelate, Quantize, Sampler, Shadow, Threshold, TiltShift, Vignette,
Wipe` — and no Bloom. A bloom pass is composed from `Threshold` → `Blur` → `Blend`, which is what
`ParallelFilters` is shaped for. Recorded here because an earlier version of this design assumed a
built-in.

**VFX29.** `Displacement` for heat shimmer over detonations is a **stretch goal**, not a commitment.
`NormalTools` + `ImageLight` for per-pixel car lighting from a generated normal map is noted as the
honest answer to "a 48px car cannot show material" — you do not paint the detail, you light it — and
is explicitly **out of scope** here.

---

## Why `WEAPON_FX` is client-side

**VFX30.** `WEAPON_FX` lives in `packages/client/src/fx/table.ts`, **not** in shared. `balanceStamp`
hashes the shared tables **whole**, including purely visual fields — `WEAPON_TABLE.color` is the
known example — so a table in shared would make every effect tweak fail `manual-page.test.ts` and owe
a `npm run build:manual` rebuild. Client-side, the consequence is concrete and worth stating: this
system invalidates **no playtest probe**, moves **no balance number**, owes **no manual rebuild**,
and owes **no `docs/turn-tuning.md` update**.

---

## Testing

**VFX31.** Vitest, no browser, over the pure modules: event derivation from synthetic state pairs (a
shot appearing, an hp drop, a death, an id leaving the map); texture determinism for a given seed and
difference across seeds; emitter spec arithmetic; decal fade math; occlusion stamp placement.

**VFX32.** A scratchpad previewer is built **off the shipped `fx/` functions**, not off a parallel
mockup, so what is approved is what ships. Judged at true 1:1 on the real arena floor with the real
car sprites.

---

## Risks

**VFX33.** **Readability in a real six-car fight** is the residual risk. VFX19 and VFX24 address a
car being hidden; they do not address a screen busy enough to be tiring. Mitigation is that every
effect layer is independently switchable, so the previewer can answer this before it ships.

**VFX34.** **Performance is expected to be comfortable but is unproven in Phaser.** The spike ran
~400 particles at 60fps in **Canvas 2D** with a per-particle `save/rotate/drawImage/restore` — the
slowest possible path. The client runs Phaser 4.2.1 under `Phaser.AUTO`, which resolves to WebGL and
batches. The spike is therefore the pessimistic case, but the two extra `RenderTexture` passes
(decal, smoke) are new cost that Canvas 2D did not model.

**VFX35.** `ctx.filter = "blur(...)"` is Canvas-2D-only and does not port. It was used in the spike
for contact shadows and to fake glow. Shadows become a **pre-blurred texture generated once at boot**
— they are static per chassis, so blurring them every frame was waste — and glow becomes `Glow` or a
composed bloom per VFX28.

---

## The arena floor

**VFX36.** The floor is **generated, not authored**, by the same noise machinery as every other
texture (VFX4): a tileable asphalt base, painted markings and cracks drawn over it, and the decal
layer of VFX23 on top. It is drawn as a real object at `ARENA_DEPTH` rather than left to
`cam.setBackgroundColor`, which is what makes a texture possible at all.

The `arena.<id>.<slot>` manifest namespace, its parser and its release-pruning already exist in
`packages/shared/src/arena/art-keys.ts`, and **nothing draws arena art today**. That pipeline is
deliberately *not* used here and is left intact: it stays the seam for a future hand-authored arena
that wants a floor no generator can produce. Choosing it now would add a per-arena image file for no
gain, which VFX4 exists to avoid.
