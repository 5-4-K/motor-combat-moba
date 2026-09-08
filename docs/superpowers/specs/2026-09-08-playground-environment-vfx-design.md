# Motor Combat MOBA — Playground Environment VFX Design

**Designed:** 2026-09-08 · **Recorded in repo:** 2026-09-08
**Status:** Designed, not yet implemented.
**Builds on:** [`2026-09-08-playground-vfx-settings-design.md`](2026-09-08-playground-vfx-settings-design.md),
whose VFX panel, override store and export this extends (**PG41–PG55**), and
[`2026-09-07-gritty-visual-fx-design.md`](2026-09-07-gritty-visual-fx-design.md), whose fx layer
holds the constants being lifted (**VFX1–VFX36**). Decisions here are numbered **EV1–EV34** and
reverse nothing in either.

---

## Problem

The VFX panel tunes `WEAPON_FX` and nothing else. That was the right first cut — a weapon's burst is
the most-authored surface in the fx layer — but it leaves everything a player looks at *between*
shots hard-coded across five files and one scene method.

The warm-desaturated grade and the vignette, the two things VFX27 calls "a large fraction of what
reads as gritty", are four magnitudes and four numbers written inline in `ArenaScene.drawArena`.
Camera shake and hit-stop are seven literals in `fx/camera.ts`. The rubber and scorch that persist
on the floor — the whole of VFX23 — are eleven constants in `fx/decals.ts`. The generated asphalt of
VFX36 is six numbers in `fx/textures.ts`. The painted markings are eight magic numbers drawn inline
into a `Graphics`.

Every one of them costs the loop the VFX panel exists to remove: edit, rebuild, reload, rejoin,
drive. The result is that they have been tuned once, at authoring time, and not since.

**EV1.** The two non-weapon burst lists in `fx/emitters.ts` — `damageBursts` and `deathBursts` —
have the same problem and a cheaper cure: they are already `FxBurst`-shaped, so they belong in the
panel that already edits `FxBurst`s.

---

## Scope

**In:** a new `packages/client/src/fx/environment.ts` holding every environment constant as one
table; defaulted `env` parameters on the fx modules that read them; a flat tuning model in
`fx/env-tuning.ts`; a playground-only override store; a third settings panel; persistence in the
existing playground localStorage blob; a pasteable `environment.ts` export; and `car.damage` /
`car.death` as two entries in the **existing** weapon panel.

**Out:** anything in `sim/`; any shared table, `ArenaDef.palette` included; any wire contract or
schema field; per-arena variation of any kind; the asphalt seed; `?dev=fx`'s channel toggles;
`FxPreviewScene`; new playtest probes; any reach outside a playground room.

**EV2.** Nothing here moves `balanceStamp`, so `npm run build:manual` is not owed. Nothing changes a
turn stat, so `docs/turn-tuning.md` is untouched. No probe in `packages/server/playtest/` measures
particles, decals or camera. Nothing crosses the wire, so no schema field is added and hard
invariant 8 is not engaged. This is the same argument VFX30 makes for `WEAPON_FX`, and it is why
this surface is cheap to change at all.

---

## What "arena VFX" means here, and what it does not

**EV3.** This is **environment** VFX — the arena-level counterpart to per-weapon VFX — and it is
**global, not per-arena**. One table, the same values in `arena-01` and `arena-02`. Keying by
`ArenaId` was considered and rejected: it doubles the model for a variation nobody has asked for.

**EV4.** **Arena colours are therefore out of scope**, and the reason is worth recording because it
is not obvious. `arenaColorsOf` reads `ArenaDef.palette`, which lives in **shared** and which both
arenas already declare (`arena-01` `#3b4747/#4a5568/#2d3436`, `arena-02` `#d8cfc4/#6b5b4b/#2f2a26`).
Tuning them would cross into shared and would be inherently per-arena — two constraints this design
takes as fixed. `obstacle` and `border` are two hex values editable directly in `arena-0N.ts`.

**EV5.** `palette.floor` is close to dead already: since VFX36 the asphalt `tileSprite` covers the
whole arena at `FLOOR_DEPTH` and the camera is bounded to the arena, so the colour it sets is only
the ground *beneath* the tile. Recorded so nobody spends time tuning a value that does not draw.

---

## The table

**EV6.** One new client-side module, `packages/client/src/fx/environment.ts`, holds every one of
these values. It sits beside `fx/table.ts` and carries the same client-side argument (EV2).

```ts
export interface EnvironmentFx {
  readonly grade:     { saturate; warmR; warmB; brightness };
  readonly vignette:  { x; y; radius; strength };
  readonly shake:     { max; diedMs; damagedMs; damagedBase; damagedPerHp; damagedCap;
                        explosionMs; explosionCap; ramMs; ramFloor; ramPerSpeed; ramCap };
  readonly hitStop:   { ms; scale };
  readonly decals:    { halfLifeMs; maxTotal; maxScorch; fadeCutoff;
                        tyreSpacing; tyreMaxStep; tyreSpeedFloor; tyreTrackRatio;
                        tyreRadius; tyreAlpha; tyreTint;
                        scorchAlphaShot; scorchAlphaDeath; scorchScaleDeath; scorchScaleDefault };
  readonly occlusion: { halo };
  readonly floor:     { grainCells; patchCells; grainOctaves; patchOctaves;
                        grainWeight; patchWeight; baseGrey; greySpan; warmR; warmG; warmB };
  readonly markings:  { laneColor; laneAlpha; laneWidth; laneSpacing; laneDash; laneMargin;
                        circleAlpha; circleWidth; circleRadius };
  readonly carBursts: { sparkPerHp; countFloor };
}

export const ENVIRONMENT_FX: EnvironmentFx = { /* today's shipped values, verbatim */ };
```

**EV7.** Every field is a value that exists in the codebase today, moved rather than invented. The
table's first commit must be behaviour-identical: the shipped game renders the same pixels before
and after.

**EV8.** `decals.tyreTrackRatio` keeps the `DRIVE_CONFIG.carHeight` derivation and tunes the `1/3`,
rather than freezing a pixel number. A chassis retune must still move the track width.

**EV9.** **The asphalt seed is not a field.** It is `arena.width * 31 + arena.height` precisely so
every client in a room generates the same floor, and `ArenaScene`'s comment already marks it as "not
a tuning knob". A persisted or exported seed override would break that agreement. The panel instead
offers a **reroll that is never saved and never exported** (EV27), so the noise parameters can be
judged beyond one particular seed.

**EV10.** **`SCORCH_SCALE` moves out of `decals.ts` and onto `WeaponFxRow` as `scorchScale`.** Its
rows (`magmablast` 1.25, `predator` 1.0, `thumper` 0.5) are keyed by `weaponId` — weapon fx data
that ended up in the decal module. On `WeaponFxRow` it rides the existing weapon panel, selector,
persistence and export with no new machinery. Only the `0.35` fallback stays in the environment
table, as `decals.scorchScaleDefault`.

**EV10a.** The consequence for the seam: `decalStampsFor` takes the **weapon fx resolver** alongside
`env`, because a scorch mark's scale now comes from the weapon's own row. It already receives the
`weaponId` on the event, so this is a parameter rather than a lookup it cannot perform. `FxLayer`
holds both resolvers and passes both.

---

## The seams

**EV11.** Every consumer takes the table as a **defaulted parameter**. This is the seam `FxLayer`
already uses for `resolveFx` (PG46), and reusing it is what keeps the override store off the shipped
code path: a shipped arena passes nothing and gets `ENVIRONMENT_FX`.

| File | Change |
|---|---|
| `fx/camera.ts` | `shakeFor(event, env?)`, `ramShake(speed, env?)`; `HIT_STOP_*` and `MAX_SHAKE` become fields |
| `fx/decals.ts` | `tyreMarkSteps`, `tyreMarksFor`, `decalFadeAlpha` gain `env?`; `decalStampsFor` gains `env?` **and** the weapon fx resolver (EV10a); `SCORCH_SCALE` is deleted; `TYRE_TRACK_HALF_WIDTH` becomes a function of `env` |
| `fx/occlusion.ts` | `eraserStampsFor(cars, env?)`; `ERASER_STAMP_WIDTH`/`HEIGHT` become functions |
| `fx/textures.ts` | `asphaltTexture(seed, size, env?)` |
| `fx/emitters.ts` | `damageBursts` reads `carBursts`; `deathBursts` and the damage template move to the weapon table (EV20) |
| `fx/layer.ts` | `FxLayer` takes an `env` resolver beside `resolveFx`; `MAX_SCORCH_DECALS` and the tyre tint come from it |
| `scenes/ArenaScene.ts` | grade, vignette and markings read `env`; markings lift into `drawMarkings(gfx, arena, env)` |

**EV12.** A module-level store read *inside* each fx module was rejected. It puts the store on the
shipped path and relies on it merely being empty in a real match; it makes currently-pure modules
order-dependent under vitest; and it would leave `fx/` carrying two contradictory precedents for the
same problem. The churn of threading a parameter is the price of keeping one.

---

## The tuning model

**EV13.** `packages/client/src/fx/env-tuning.ts`, pure and Phaser-free, mirroring `fx/tuning.ts`:

```ts
type EnvSection = "grade" | "vignette" | "shake" | "hitStop" | "decals"
                | "occlusion" | "floor" | "markings" | "carBursts";
interface EnvFieldDef { section; name; label; kind: "number" | "integer" | "color";
                        min; max; step }

export const ENV_FIELDS: readonly EnvFieldDef[]
export function envKey(section, field): string          // "<section>.<field>"
export type EnvOverrides = Record<string, number>
export function resolveEnvironment(overrides): EnvironmentFx
export function isEnvAtShipped(field, value, shipped): boolean
export function envTableSource(overrides): string
```

**EV14.** **Flat, not a grid.** Weapons got a rectangular 2 phases × 4 channels model because a
weapon row *is* rectangular. The environment is nine sections of heterogeneous scalars, so the model
is a flat list keyed `"<section>.<field>"`.

**EV15.** Two field kinds the weapon model did not need. **`integer`** for `floor.grainCells`,
`floor.patchCells`, the two octave counts and the two decal caps — a fractional cell count stops the
tileable lattice closing, which is the seam bug `tileableFbm` exists to prevent. **`color`** for
`decals.tyreTint` and `markings.laneColor`, edited as hex rather than dragged on a slider.

**EV16.** `isEnvAtShipped` keeps the half-step tolerance for `number` — the rule
`isFxAtShipped`/`isAtShipped` already share, and for the same reason: a range input snaps to its
`min`/`step` grid and a shipped value usually does not sit on it. `integer` and `color` compare
exactly.

**EV17.** `EnvOverrides` is `Record<string, number>`. There are no booleans in the inventory;
colours are stored as integers.

**EV18.** `fx/env-store.ts` mirrors `fx/override-store.ts`: `envOverrides()`, `setEnvOverrides()`,
`liveEnvResolver()`, read at call time so an edit reaches the next frame rather than the next arena
restart.

**EV19.** **`liveEnvResolver` memoises on a version counter.** This is the one place the environment
resolver must *not* copy the weapon one. `resolveWeaponFx` is called once per event, a handful of
times a frame; `resolveEnvironment` would be called per particle per frame by `decalFadeAlpha` and
its neighbours, and rebuilding a ~45-field object each time is a per-frame allocation storm. The
counter is bumped by `setEnvOverrides` and by each panel edit, so the table is resolved once per
edit.

---

## The car bursts

**EV20.** `car.damage` and `car.death` join the **existing** weapon panel as two extra entries in
its selector, reusing the grid, the replay preview, the storage codec and the export. Their burst
lists move from `fx/emitters.ts` into the weapon table's shape.

**EV21.** Car events have no muzzle/impact split, so those two entries render a **1 × 4** grid
rather than 2 × 4. `fxCellsFor` gains a phases argument; `FX_PHASES` stays the weapon default.

**EV22.** `damageBursts` has no free `count` — it is `clamp(1, 30, round(amount × DAMAGE_SPARK_SCALE))`.
So for `car.damage` the grid's `count` is reinterpreted as the **cap** (today's hard-coded 30), and
`sparkPerHp` (0.5) and `countFloor` (1) become the environment table's `carBursts` section. The
panel labels that cell "Count cap" for those entries so the reinterpretation is visible rather than
inferred.

---

## The apply seam, in three tiers

**EV23.** **Tier 1 — live by read.** All of `shake`, `hitStop`, `carBursts` and most of `decals`.
A pure function reads the value per call and the next call picks up the edit; nothing to wire.

**EV24.** Two consequences of tier 1 to handle rather than discover. `decals.maxTotal` and
`maxScorch` otherwise bite only as new decals arrive, so lowering a cap must **trim the buffers on
edit** or the change reads as broken. And because fade is computed from `bornAtMs`, a `halfLifeMs`
edit re-ages every decal already on the ground instantly — which is the behaviour wanted while
judging it, and is recorded so it is not later "fixed".

**EV25.** **Tier 2 — live by re-apply.** `grade` and `vignette`. `drawArena` currently calls
`addColorMatrix()` / `addVignette(…)` and discards the returned controllers; it keeps them as fields
and gains `applyGrade(env)`. `Vignette` exposes mutable `x`, `y`, `radius`, `strength`, so it is four
writes. `Display.ColorMatrix` is `reset()` followed by the same three calls **in the shipped order**
— `saturate`, warm `multiply(…, true)`, `brightness(…, true)`.

**EV26.** **The panel exposes the four grade magnitudes and cannot reorder those three calls.**
Phaser composes `M_new = M_old × a`, so the operation added *last* is applied *first* to the pixel;
`drawArena`'s own comment records that the shipped sequence therefore runs brightness, then the warm
gain, then the desaturation, and that a stronger grade would make the ordering matter. Order is a
design decision, not a knob.

**EV27.** **Tier 3 — rebuild, behind an explicit control.** Regenerating a 512×512 texture on every
slider `input` event would lock the panel, so `floor.*` edits are applied by a **Regenerate** button
calling `FxLayer.rebuildFloor(env)`. The existing private `add()` helper already does
remove-then-`createCanvas`, so the upload path exists. A **Reroll seed** button beside it re-runs the
same generation with a different seed for preview only (EV9) — never persisted, never exported.

**EV28.** **The floor rebuild must re-point the tile sprite.** `TileSprite` holds a reference to the
old texture object, so after the re-upload `ArenaScene` must call
`floorTile.setTexture(FX_TEXTURE_KEYS.asphalt)` or the floor keeps drawing the stale image. This is
the failure mode a rebuild button silently produces if it is not written down.

**EV29.** `markings.*` applies through `ArenaScene.redrawArenaGraphics(env)` — `arenaGfx.clear()`,
then obstacles, markings and border in the existing order. Cheap enough to run on edit; no button.

**EV30.** **`occlusion.halo` is a rebuild knob, not a live one**, and this is the trap in the group.
`ERASER_HALO` feeds two places: `eraserStampsFor`, which runs per frame, and `buildEraserTextures`,
which bakes the pre-blurred silhouette once with `inset = ERASER_HALO * ppu`. Editing it live would
grow the stamp box without regrowing the silhouette inside it, so the hole's soft edge drifts off its
own border — the exact class of mismatch `occlusion.ts`'s "a second multiplier here would make every
sentence above a lie" comment warns about. A halo edit therefore calls the already-public
`rebuildEraserTextures()`.

---

## The panel, persistence and export

**EV31.** `dev/playground/env-panel.ts` is a third `subView` beside `"physics"` and `"vfx"`, with a
matching menu button. One collapsible block per section — the idiom the VFX panel already uses per
channel — each listing its `ENV_FIELDS` rows with the physics panel's slider-plus-stepper. Sections
are ordered by how often they are reached for: grade and vignette first, floor and markings last.
Three section-local controls: **Regenerate** and **Reroll seed** on `floor`, and **Test shake** on
`shake`, which fires each of the four kinds because shake cannot be judged on a frozen field.

**EV32.** Persistence is a fourth section of the existing blob: `StoredPlayground.env: EnvOverrides`,
validated by `sanitizeStoredEnv` in the same lenient entry-by-entry style as `sanitizeStoredVfx` —
an unknown section, unknown field, non-finite value, out-of-range value or non-integer in an
`integer` field costs that one entry, never the session. **No storage version bump:** `decodeStored`
already tolerates a missing section, so an existing blob loads with `env: {}`.

**EV33.** **The export emits whole sections, only the touched ones.** `fxTableSource` emits full
weapon rows because there are ten independent rows; there is exactly one environment table, so
`envTableSource` emits `grade: { … }` complete and leaves `decals` absent when it was not edited.
Colours emit as `0x141210`, not decimal. Destination is `fx/environment.ts`.

**EV34.** Reach is the weapon rule verbatim: only a playground room passes `liveEnvResolver()`, gated
on the `isPlaygroundRoom(this.room)` check `ArenaScene` already makes for `liveFxResolver()`;
`PlaygroundScene` loads on start and clears on shutdown. A shipped arena or a practice session
renders `ENVIRONMENT_FX` no matter what is saved in that browser.

---

## Testing

Vitest, node environment, no browser — the rest of `fx/` already tests this way.

- **`env-tuning.test.ts`** — `resolveEnvironment` applies one override and leaves its siblings
  alone; out-of-range and wrong-typed entries drop; `isEnvAtShipped` is half-step for `number` and
  exact for `integer`/`color`; `envTableSource` emits only touched sections and round-trips back
  through `resolveEnvironment` to the same table.
- **A reachability test** — every `ENV_FIELDS` row names a real path in `EnvironmentFx`, and every
  leaf of `EnvironmentFx` has exactly one row. Adding a knob to the table without a row, or a row
  without a knob, then fails the suite instead of silently not appearing in the panel. This is the
  environment analogue of "every shipped VFX value is reachable on its grid".
- **A behaviour-identity test for EV7** — `resolveEnvironment({})` deep-equals `ENVIRONMENT_FX`, and
  each lifted constant's old literal is asserted against its new field, so the move cannot change a
  pixel.
- **`storage.test.ts`** — `sanitizeStoredEnv` drops one bad entry and keeps the rest; a blob with no
  `env` loads as `{}`.
- **The four existing fx suites keep passing unchanged** (defaulted parameters), each gaining one
  case proving a non-default `env` changes the output.
- **`textures.test.ts`'s tiling test is the guard on EV15** — a fractional `grainCells` reopens the
  seam it pins, so the integer kind is enforced by a test that already exists.

---

## Risks

**Forty-five sliders is a lot of panel.** The per-section collapsible blocks and the
reached-for-most-often ordering are the mitigation; the residual risk is that the panel is a place
to get lost rather than a place to tune.

**The lift is wide before it is useful.** EV7's behaviour-identity requirement means the first
commits change many files and no pixels. The mitigation is that they are mechanical and covered by
the identity test — but a review that expects visible progress per commit will not find it until the
panel lands.

**Tier 3 is where a bug hides.** EV28 and EV30 are both cases where an edit appears to apply and
does not, or applies half-way. Both are written down here for that reason, and neither is
test-coverable in node — `layer.ts` has no test, by design.
