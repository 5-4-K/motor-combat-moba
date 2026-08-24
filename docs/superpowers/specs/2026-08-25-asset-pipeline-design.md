# Motor Combat MOBA — Client Asset Pipeline Design

**Designed:** 2026-08-24 · **Recorded in repo:** 2026-08-25
**Status:** Approved. Not yet implemented.
**Plan:** [`docs/superpowers/plans/2026-08-25-asset-pipeline.md`](../plans/2026-08-25-asset-pipeline.md)

---

## Problem

The client draws everything procedurally today. `drawCar` (`packages/client/src/scenes/ArenaScene.ts:462`)
emits a `Phaser.GameObjects.Graphics` per car — a rect, ellipse, or hexagon chosen by `carShapeOf`
and filled with `carFillOf(colorId)`. There is no `public/` directory and no image asset anywhere in
the repo.

The goal is to introduce real art for cars (and later powers and effects) while keeping one property
above all others: **art must be trivial to add, replace, and modify.**

## Constraints

1. Art arrives from **mixed external sources** — free packs, AI generation, possibly paid packs.
   Sizes, orientations, and colour conventions will be inconsistent. Normalisation is the pipeline's job.
2. Visual register is **clean vector / flat top-down** today, but the style may change wholesale later.
3. **v1 is LAN; online multiplayer is planned.** The design must survive internet hosting even though
   the online build work is out of scope for now.
4. Load weight and frame smoothness both matter.
5. **No themes.** Possibly a distant-future feature.
6. The `?dev=assets` developer tool must **not exist in a release build**.

## Non-goals

- Player-selectable themes.
- A texture atlas.
- Any change to the drive model, the OBB hitbox model, or collision damage rules.

---

## Decisions

### D1 — Typed schema, JSON data

The manifest *shape* is a TypeScript type plus a validator, compiled with the client. The manifest
*data* is JSON on disk. This yields load-time guardrails without making an art change a code change.

Rejected alternatives:

- **Runtime JSON with no schema.** Every malformed entry becomes a runtime mystery.
- **Typed TS table, Vite-bundled** (mirroring `CAR_TABLE`). Type-safe and forces art to exist when a
  car is added, but every asset change becomes a code edit plus a rebuild, and the shipped release
  zip is sealed. Directly fights the primary goal.

### D2 — The manifest lives in the client package

Files sit under `packages/client/`. Nothing goes in `packages/shared/` or `packages/server/`.

- Invariant 8 says "if `stepSim` reads it, it is a networked schema field." Nothing in `stepSim`
  reads a sprite, so it is not shared state.
- The server is headless now and will be a small cloud instance later. It must never parse an image path.
- Invariant 9 says shared is consumed as built `dist`. Assets in shared would mean rebuilding shared
  on every PNG swap — the stale-`dist` trap `CLAUDE.md` warns about.

The seam: the manifest is **keyed by shared ids** (`CarId` now, `PowerId` later) but lives entirely
client-side. Shared owns the ids; the client owns what they look like.

### D3 — Sprites are cosmetic skins over an unchanged hull

`CAR_TABLE`, `DRIVE_CONFIG.carWidth/carHeight` (48×32), and the OBB are untouched. Art is fitted *to*
the hull; the hull never follows the art.

This is load-bearing for determinism. If the hitbox tracked the art, `stepSim` agreement between
server and client would depend on a PNG's pixel dimensions.

### D4 — The procedural renderer is permanent

`carShapeOf` and `drawCar`'s existing shape path stay forever as the bottom of the resolution chain:

```
carId "hexagon"
  -> key "car.hexagon"
  -> manifest hit?  -> sprite: tinted, rotated by rotationOffset, fitted to hull
  -> miss / malformed / failed load -> procedural silhouette + one-time console warning
```

Consequences: the game never crashes or shows an invisible car because of art, and **art can be added
incrementally** — cars first, powers later — with the game playable at every step.

### D5 — Flat namespaced-key registry

A schema keyed by entity type with a bespoke shape per type dies the moment powers arrive. Instead:
one flat map of string keys to uniformly-shaped entries.

```json
{
  "sprites": {
    "car.rectangle":     { "file": "cars/rectangle.png" },
    "car.oval":          { "file": "cars/oval.png" },
    "car.hexagon":       { "file": "cars/hexagon.png", "rotationOffset": 1.5707963 },
    "projectile.bullet": { "file": "fx/shot.png", "colorMode": "none" }
  }
}
```

**The design test: powers arrive as new rows, not a new schema.** `power.boost.icon` and
`power.boost.pickup` are just more keys.

Per-entry knobs, all optional with defaults so a bare `{ "file": ... }` works:

| Field | Default | Purpose |
|---|---|---|
| `rotationOffset` | `0` | Reconciles "art drawn facing up" with the sim's `+x is forward`. The most common pack mismatch. |
| `scale` | `"fit"` | `"fit"` contains the art inside the hull; a number is an explicit multiplier. Lets a 2048² AI image and a 64² pack sprite both land correctly. |
| `colorMode` | `"tint"` | `"tint"` or `"none"`. An enum, so `"overlay"` is additive later. |
| `origin` | `[0.5, 0.5]` | For art whose visual centre is not its geometric centre. |

### D6 — Player colour: procedural marker always, tint optionally

A colour marker (ring / underglow) is drawn procedurally under every car regardless of art. It needs
no asset and works with any pack, including pre-coloured ones that cannot be tinted.

Tint is the enhancement on top where the pack supports it. Phaser's tint is multiplicative, so a
desaturated base keeps dark tyres and windows dark rather than turning them to coloured mush.
Desaturating a pack is a batch step (`mogrify -colorspace Gray` or a short `sharp` script), not manual work.

### D7 — Loose PNGs, no atlas

At six players and ~20 sprites the GPU batching win from an atlas is negligible — Phaser 3's WebGL
renderer binds many texture units at once. The cost is exactly the friction being avoided: changing
one car means re-running a packer, both outputs change, the sheet is an unreviewable binary blob in
git, and edge bleed between packed neighbours is a classic source of coloured fringing.

If the online build ever wants an atlas, the packer runs **in the build step** and rewrites the
manifest to atlas form. Because consumers only ask the manifest for a key, no scene code changes.

### D8 — Size caps

**VRAM cost is dimensions, not file size.** A 40 KB PNG at 2048² still occupies ~16 MB of VRAM. This
is the single biggest trap with pack and AI-generated art.

Cars render at ~48×32 world units, so **128² is the working size and 256² the ceiling**. The same cap
doubles as the download cap when the game goes online, where it matters more than it looks: images do
not gzip, so asset bytes are wire bytes 1:1, unlike the JS bundle.

### D9 — Nothing loads during a match

A mid-match texture upload is a GPU stall and reads as a frame spike. All assets load at boot.

`BootScene` currently does nothing but `this.scene.start("join")`. It becomes the loader — but must
**not block first paint**. Join renders while the pack downloads; the lobby and car-select hide the
remaining time; only Arena entry waits on readiness.

### D10 — Dev tool, dev-only

`?dev=assets` routes from Boot into a scene that draws every manifest entry parked on its own OBB
hull, with no server connection. It exists because `rotationOffset`, `scale`, and `origin` must be
tuned by eye per sprite, and the alternative loop is unbearable: the client has **no reconnect or
session persistence** (nothing in `packages/client/src/net/connection.ts`, and `BootScene` always
starts `join`), so checking one sprite's alignment via `?debug=1` costs a full rejoin — name, lobby,
car select, countdown — in a live room.

**A namespaced selector, not a flag per tool.** The URL is `?dev=<id>`, not `?preview=1`. Balance
tuning and other dev tools are expected later, and one boolean per tool needs precedence rules the
moment two are set. More importantly, a single selector gives the whole suite **one registry, one
dynamic-import site, one `import.meta.env.DEV` guard, and one strip marker** — adding tool number
three costs a registry row and no new stripping machinery, which is what stops one from eventually
shipping. `?debug=1` stays as it is: it is an overlay on live play, a different category from a
standalone tool.

**A query parameter, not a path** such as `/dev/asset-tuning`. The client is a single Phaser game
with scenes as its only routing primitive, so a path router would be a second routing system layered
on the first. Decisively, the release server is `express.static` (`packages/server/src/index.ts`)
with no SPA history fallback: a path would work under Vite's dev server and **404 in the release
build**, while an unknown query parameter is simply ignored and Join renders.

Stripping is via `import.meta.env.DEV`, which Vite replaces with the literal `false` in
`vite build`. Three details decide whether it actually strips:

1. The import must be **dynamic** (`await import()`). A static top-level import puts the scene in the
   module graph and relies on Rollup proving it side-effect-free; a dynamic import inside a dead
   branch is deterministic — the chunk is never emitted.
2. The dynamic import must sit **lexically inside** the `if (import.meta.env.DEV)` block. Moving it
   into a separate class method defeats the whole scheme: Rollup does not tree-shake class methods,
   so the method body and its `import()` survive even when every call site is dead code.
3. `AssetTuningScene` must **not** appear in `main.ts`'s `scene:` array, and must be reachable only
   through the registry.

Verification is a grep for a marker string unique to that scene, asserted **inside
`scripts/build-release.mjs`** rather than in `scripts/build-release.test.mjs`. The existing test file
unit-tests exported pure functions and never inspects `dist`; a test that greps `dist` would silently
pass whenever `dist` is absent, which is exactly when it should complain.

### D11 — Author loose, ship optimised (deferred)

Dev and LAN read `public/art/` straight from disk, preserving the drop-in-a-file workflow. The
online build will read the same folder, downscale, convert to WebP, content-hash, and rewrite the
manifest into `dist` — which is what resolves Vite's `public/` being served unhashed (forcing a
choice between weak cache headers and being unable to ship an art fix).

**Not implemented now.** v1 is LAN. The design accommodates it; building it before the deployment
exists is speculative.

---

### D12 — The art folder is `public/art/`, not `public/assets/`

Vite's `build.assetsDir` defaults to `assets`, so bundled JS and CSS are emitted into
`packages/client/dist/assets/`. Vite also copies `public/` contents to the `dist` root. Source art
placed in `public/assets/` would therefore merge into the same directory as hashed bundle output —
messy, and it makes the D10 strip-check grep ambiguous about what it is scanning.

`art/` keeps the two apart. The path appears exactly once in code, as `MANIFEST_URL`, and contains no
project name — which is also the whole of the theme affordance kept from constraint 5.

## Out of scope for the first implementation

Named explicitly so they are deferred, not forgotten:

1. **Online build step** (D11) — WebP, downscaling, content hashing, manifest rewriting. Needed when
   the game is hosted over the internet, not before.
2. **Particle and spritesheet effects.** The `effects` half of the manifest is not built yet.
   Particle configs are preferred over baked spritesheets for **modifiability, not performance** —
   a 16-frame sheet is one quad, a particle burst is 30–50, so the sheet is actually cheaper on the
   GPU. Emitters must be pre-created and pooled at boot with `maxParticles` caps. Best designed once
   powers exist and there is something concrete to tune.
3. **Powers art.** No power exists in the sim yet. The schema is shaped to absorb them (D5).
4. **Themes** (constraint 5). The only affordance kept now: nothing hardcodes the asset folder path.
5. **Texture atlas** (D7) — build-step concern if ever.

## Naming

This design was written while the workspace was still called `motor-arena`. **The rename to
`motor-combat-moba` completed on 2026-08-25**, before implementation began, so the packages are
`@motor-combat-moba/{shared,server,client}` and no migration is pending.

The convention adopted to survive that rename is kept regardless, because it costs nothing and the
next rename would be just as quiet: prefer workspace **paths** (`packages/client/...`) over package
**names** in docs and scripts, and never embed the project name in a directory, asset folder, or
config key. `public/art/`, `MANIFEST_URL`, and the `car.*` key namespace all satisfy this.
