# Asset pipeline

How car art gets into the game, and what happens when it does not. Balance and hitboxes are
untouched by any of this — see [`combat-model.md`](combat-model.md) and
[`networking.md`](networking.md) for those. This doc is about the client's `public/art/` folder,
the manifest that names what is in it, and the procedural fallback that means a missing PNG is
never a bug.

## The `public/art/` layout

```
packages/client/public/art/
  manifest.json   # namespaced key -> sprite entry
  README.md       # the same field table reproduced below, for whoever is dropping in a PNG
  cars/           # convention for car PNGs (README.md), created the first time you add one
```

Everything under `public/` is served unhashed and unbundled — Vite copies it straight to the
`dist` root. Nothing here needs a code change or a rebuild: drop a PNG in `cars/`, add a row to
`manifest.json`, reload the page. `MANIFEST_URL` (`packages/client/src/assets/load-manifest.ts`)
is the single constant that names where the client fetches the manifest from
(`art/manifest.json`), and the folder is `art/`, not `assets/`, because Vite's
`build.assetsDir` already claims `assets/` for hashed JS and CSS — putting source art there would
merge it into the same directory as the bundle output.

`scripts/import-art.mjs` does the mechanical half of that for a source that is not already the
right shape — trim, downscale, desaturate, and write the manifest row, preserving any fields you
tuned by hand. See [the art README](../packages/client/public/art/README.md) for its flags. It is
an authoring convenience, not a required step: a correctly sized PNG dropped in by hand works
exactly the same, which is the property the manifest indirection exists to protect.

Today `manifest.json` ships with an empty `sprites` object (`{}`), so every car currently renders
as its procedural silhouette. That is not a placeholder state waiting to be filled in before
release — see [Resolution chain](#resolution-chain) below.

## Manifest schema

Reproduced from [`packages/client/public/art/README.md`](../packages/client/public/art/README.md)
— edit that copy first if the two ever need to change, since two tables that drift apart are worse
than one.

All optional except `file`.

| Field | Default | Meaning |
|---|---|---|
| `file` | required | Path relative to this folder. |
| `rotationOffset` | `0` | Radians added to the car's angle. The sim's forward is `+x`, i.e. pointing **right**. Art drawn facing **up** needs `1.5707963`. |
| `scale` | `"fit"` | `"fit"` contains the art inside the 48x32 hull. A positive number is an explicit multiplier — use it when pack art has heavy transparent padding and `"fit"` renders it too small. |
| `colorMode` | `"tint"` | `"tint"` multiplies the texture by the player colour and needs desaturated art. `"none"` leaves pre-coloured art alone — the player's colour then does not appear on the car at all, so use it only for chassis skins whose colour is not meant to identify the player. |
| `origin` | `[0.5, 0.5]` | Normalised origin, for art whose visual centre is not its geometric centre. |

The defaults live in code as `SPRITE_DEFAULTS` and the type as `SpriteEntry`, both in
`packages/client/src/assets/manifest-schema.ts`. A manifest entry is JSON, not TypeScript — the
schema is enforced at load time by `parseManifest`, not at compile time — which is what lets art
change without a rebuild (see D1 in the
[design doc](superpowers/specs/2026-08-25-asset-pipeline-design.md) for why that trade was made
deliberately).

`parseManifest` never throws and never rejects the whole file. A malformed row — missing `file`,
an unknown `colorMode`, a non-finite `rotationOffset` — is dropped and logged to the console as one
line in `problems`; every other entry still loads. A typo costs one car its sprite, not the game
its render. The same function also refuses `__proto__`, `constructor`, and `prototype` as manifest
keys, since the manifest is parsed from on-disk JSON and those names would otherwise write through
a plain object's prototype.

## Resolution chain

Adding a car sprite means understanding four steps, in order:

```
carId ("hexagon")
  -> carSpriteKey        "car.hexagon"                packages/client/src/assets/asset-keys.ts
  -> manifest lookup     sprites["car.hexagon"]        assetManifest() in BootScene.ts
  -> sprite               tinted/rotated/fitted image, if the entry exists AND its texture loaded
  -> procedural fallback  drawCar's silhouette, otherwise
```

`carSpriteKey(carId)` (`packages/client/src/assets/asset-keys.ts`) builds the manifest key. It is
namespaced (`car.<id>`) so that powers, projectiles, and effects can land as new rows in the same
flat map later without a new schema section — see D5 in the design doc. An unrecognised `carId`
resolves to `DEFAULT_CAR_ID`, the same fallback the sim itself takes, so a stale or hostile id
draws the default chassis rather than nothing.

`BootScene.assetManifest()` (`packages/client/src/scenes/BootScene.ts`) returns the parsed
manifest, fetched once at boot via `loadManifest` and kept module-level because Phaser textures
live in its global `TextureManager` — whichever scene loads them, every scene can draw them.
`BootScene` queues an `this.load.image(key, ...)` for every manifest entry and resolves
`assetsReady()` once every queued load has settled — every texture load happens once, at boot,
never mid-match.

`ArenaScene.create()` does **not** wait on that promise before drawing anything; it is
fire-and-forget:

```ts
void assetsReady()
  .then(() => {
    this.artPending = false;
    this.visualKeys.clear();
  })
  .catch((error: unknown) => console.warn(`[art] asset load rejected: ${String(error)}`));
```

A match can start, and every car is drawn immediately from whatever `spriteFor` currently
resolves to — the procedural silhouette, if the art has not finished loading yet. When the
promise does resolve, clearing `visualKeys` is what makes it visible: that map is `syncCar`'s only
"has this car's visual changed" check, so clearing it makes every on-screen car look changed and
each is rebuilt once on the next frame, now with its sprite. This is what a car looking like a
hexagon for the first second of a match and then popping into its sprite actually is — nothing
failed, the swap just had not landed yet. The genuine guarantee is narrower than "waits before the
first frame": it is that loading is queued once at boot and never re-triggered mid-match, so there
is at most this one swap shortly after Arena entry, never a texture upload once a match is already
running.

`ArenaScene.drawCar` (`packages/client/src/scenes/ArenaScene.ts`) is where the chain resolves per
car. It calls `spriteFor(carId, fill)` first; that returns a Phaser image only if **both** an
entry exists in the manifest **and** `this.textures.exists(key)` is true. The second half of that
check is the one that surprises people: a manifest row pointing at a filename that does not exist
on disk is not a parse error — the JSON is well-formed — so `parseManifest` accepts it. Loading
fails later, and `BootScene` logs `` [art] failed to load "<key>" from <url> `` and moves on rather
than stalling boot. The key simply never enters the texture manager, `textures.exists` is false, and
`spriteFor` returns `undefined`.

That warning is raised **after the load settles, by checking whether the texture actually exists**,
not from Phaser's `FILE_LOAD_ERROR` event alone. The event fires only on a genuine transport
failure, and under Vite's dev server a missing file under `public/` is not one: Vite answers it with
its SPA fallback — `200 text/html` — so the load *succeeds* and Phaser fails at the decode stage
instead, which emits no `FILE_LOAD_ERROR`. Warning on the same condition the renderer checks is what
makes the diagnostic fire in the environment where art is actually authored. The `FILE_LOAD_ERROR`
listener is kept alongside it because it is the only one that knows the resolved URL, and a set of
already-reported keys stops the two warning twice for the same file when a real 404 (as the release
server's `express.static` returns) does fire both.

The two failure modes — a missing manifest entry and an unloadable file — look
identical at the point they resolve, and both fall through to `drawCar`'s `silhouette(...)`: the
same rect/ellipse/hexagon shapes the game has always drawn, chosen by `carShapeOf` and filled with
`carFillOf(colorId)`.

When you have added a PNG and it still shows as a hexagon (or whatever the procedural shape is),
check in this order: is the manifest key spelled `car.<carId>` exactly; does `file` in the
manifest match the path under `public/art/` exactly (case matters on a case-sensitive deploy even
if not on your dev machine); and does the browser console show an `[art] failed to load` or
`[art] <problem>` line. `?dev=assets` (below) shows every chassis with its sprite or a "no art"
label on one screen, without needing to join a match — but it does not itself distinguish *why*
a chassis has no art: `drawCell` calls the very same `resolveCarSprite`
(`packages/client/src/assets/car-sprite.ts`) that `spriteFor` does, so a missing manifest entry and
an entry whose file failed to load both render identically as "no art". That sharing is deliberate
— the tuner is only worth anything if what it shows is what the arena draws, and with the
resolution and the compose order (`applyCarSprite`: origin, scale, rotation, tint) each living in
one place, the two cannot drift apart. Telling the two failure modes apart still means checking the
console, where
`BootScene` logged the `[art] failed to load` warning at boot.

Sprite fitting itself — `"fit"` containing the art inside the 48×32 hull, `rotationOffset` being
added to the body's `angle`, `origin` being applied — is `fitSprite` in
`packages/client/src/assets/sprite-fit.ts`, pure and independent of Phaser so it is unit-tested
without a browser. `"fit"` measures the hull against the texture's **rotated** bounding box, because
`rotationOffset` is applied before the sprite lands in hull space: a 64×128 up-facing sprite at
`1.5707963` presents 128 along the hull's 48, not along its 32, and comparing the unrotated
dimensions would render it at two thirds the size it should be — failing at precisely the mismatch
`"fit"` exists for. At `rotationOffset: 0` the formula collapses back to the plain dimensions.
`"fit"` always **contains**, never covers: a sprite that overflowed the hull it
was drawn against would visually claim a reach the car's OBB does not have, since the hull the sim
collides with never follows the art (D3 in the design doc — sprites are a cosmetic skin over an
unchanged hull, and that is load-bearing for determinism: if hitboxes tracked art, server/client
agreement in `stepSim` would depend on a PNG's pixel dimensions).

Player colour reaches the car only through `colorMode: "tint"` (or the procedural silhouette's
fill when no sprite exists). There is no separate colour marker under the car, so a pre-coloured
pack sprite with `colorMode: "none"` carries no player identity — that mode is for chassis skins,
not for player-distinguished art.

## Size limits, and why they are about dimensions

**128×128 is the working size, 256×256 the ceiling.** Cars render at roughly 48×32 world units, so
even 128² is generous headroom, not a tight budget.

The reason to actually hold that ceiling is VRAM, not download time: **texture memory cost is
driven by a PNG's decoded dimensions, not its file size on disk.** A 40 KB PNG at 2048×2048 still
decodes to roughly 16 MB of uploaded texture (2048 × 2048 × 4 bytes per RGBA pixel) — the same GPU
cost as a print-resolution photo, regardless of how well the file compressed. This is the trap that
pack downloads and AI-generated art fall into constantly: both tend to hand you oversized square
canvases with the actual artwork occupying a small fraction of the frame, and a quick glance at
"it's only 40 KB" tells you nothing about what it costs once it is a texture. Downscale before
committing — `mogrify` or any batch image tool works, since this is a one-time pass, not a build
step (see [Deferred](#deferred) below for why there is no automated downscale yet).

## `?dev=assets`

Reload the client at `?dev=assets` and `BootScene` routes into `AssetTuningScene`
(`packages/client/src/dev/AssetTuningScene.ts`) instead of the join screen: every chassis in
`CAR_TABLE`, parked on its own OBB hull with no server connection, art or "no art" label, key name,
and current `scale`/`rotationOffset` printed underneath. It exists because `rotationOffset`,
`scale`, and `origin` have to be tuned by eye per sprite, and the alternative loop is a full
rejoin per attempt — the client has no reconnect or session persistence, so checking one sprite's
alignment any other way means the name prompt, lobby, car select, and countdown again before you
can look at the car once more.

This only works when the page is actually running in dev mode — `npm run dev`'s Vite dev server,
not a built `dist`. That is not a limitation to work around; it is the point.

### How the dev-only guarantee is enforced

`?dev=assets` **must not exist in a release build**, and the guarantee is not "we remembered to
delete it" — it is structural, in three parts:

1. In `BootScene.create()`, the dynamic import of the dev registry sits lexically inside
   `if (import.meta.env.DEV) { ... }`. `import.meta.env.DEV` is a compile-time constant Vite
   replaces with the literal `false` during `vite build`, which makes the whole branch dead code
   that Rollup drops — including the `import()` call inside it, so no chunk for
   `AssetTuningScene` or the dev registry is ever emitted into `dist`. This only holds because the
   import is *inside* the `if`, not hoisted into a method the `if` merely calls: Rollup does not
   tree-shake class methods, so a helper method containing the same `import()` would survive dead
   code elimination even with every call site unreachable.
2. `AssetTuningScene` is reached only through `DEV_TOOLS` in `packages/client/src/dev/registry.ts`
   — it is not in `main.ts`'s `scene:` array, so there is no second path that could keep it alive
   in the bundle independent of the `import.meta.env.DEV` guard.
3. `assertNoDevOnlyCode` in `scripts/build-release.mjs` does not trust either of the above — it
   greps every JavaScript file (`.js`, `.mjs`, `.cjs`) under the built `packages/client/dist` for the literal string
   `"MOTOR DEV TOOL"` (`DEV_ONLY_MARKERS`) and throws, failing the release build, if it finds one.
   That string is the heading `AssetTuningScene` renders on its own canvas
   (`const MARKER = "MOTOR DEV TOOL"` in `AssetTuningScene.ts`) and is deliberately a local literal
   there rather than an import of the registry's `DEV_TOOL_MARKER` constant, so the check still
   fires even if the scene someday reaches a bundle by some route that bypasses the registry
   entirely. `npm run build:release` runs this check as part of the release build. The scan is
   deliberately restricted to JavaScript: Vite copies `public/` straight to the `dist` root, so
   Markdown and other prose sit right next to the bundle, and a check that could trip on prose
   would train whoever hit it to ignore it. `scripts/build-release.test.mjs` pins that policy —
   one of its cases plants the marker inside an `art/README.md` in a temp dist tree and asserts
   `assertNoDevOnlyCode` does not throw.

A registry rather than a boolean flag per tool is deliberate too: a balance-tuning tool is expected
to join the asset tuner eventually (see the note in the plan's "explicitly out of scope" section),
and one selector (`?dev=<id>`) with one registry, one dynamic-import site, and one guard is what
keeps adding tool number two a one-line change instead of a second copy of this whole strip
mechanism.

## Weapon icons

Weapon slot icons resolve through the same manifest chain as a car sprite, under their own
namespace: `weaponIconKey(id)` (`packages/client/src/assets/asset-keys.ts`) builds
`"weapon-icon.<id>"`; `weapon-hud.ts`'s `resolveWeaponIcon` looks it up in the manifest and the
texture manager exactly the way `resolveCarSprite` does for a car; and a missing manifest entry or
an unloaded texture both fall through to the same kind of procedural fallback — a glyph drawn from
the weapon's `kind` (a circle for a projectile, a bar for a beam) rather than a car silhouette. That
fallback is permanent, not a placeholder: a brand-new weapon is playable, and its slot readable,
with zero art.

Icons take **different defaults** than car sprites, because the two are not the same kind of art:

| Default | Car sprite | Weapon icon | Why |
|---|---|---|---|
| `colorMode` | `"tint"` | `"none"` | An icon is not player-tinted; desaturating it the way a car sprite is prepared would leave every weapon's icon the same grey blob. |
| Fit target | 48×32 hull | square slot box (~64 px on screen, imported at 128×128) | An icon is not a chassis; it fits the HUD's box, not the car's OBB. |

`scripts/import-weapon-icon.mjs` is `import-art.mjs`'s weapon-icon sibling: trim the transparent
margin, square the canvas, downscale to 128×128 (`ICON_PX` — 2× the ~64 px slot box, so the deferred
device-pixel-ratio work needs no re-import), write
`packages/client/public/art/weapon-icons/<weaponId>.png`, and upsert the `weapon-icon.<id>` manifest
row with the defaults above, preserving any field already tuned by hand. There is deliberately no
desaturation step anywhere in this script — see its header comment for why applying the car
importer's treatment here would be actively wrong, not merely unnecessary. Run it with:

```bash
node scripts/import-weapon-icon.mjs --weapon <weaponId> --src <path>
```

There is no `?dev=assets`-style preview for icons — that tool is car-only. Check a new icon's fit by
running `npm run dev`, equipping the weapon, and looking at its slot in the live HUD bar. The
`process-weapon-icon` skill mirrors `process-car-asset`: hand it an image and a weapon id, and it
runs the importer, reports the manifest row, and covers "why is my icon blurry / missing / wrong."

World instances — the actual projectile or beam hitbox flying through the arena — are never
sprites; see [`combat-model.md`](combat-model.md) for why that stays procedural instead. Only the
HUD icon goes through this pipeline.

## Arena art

Arena-owned art is namespaced by arena id, so the release can carry only the active arena's files.

| Manifest key | On disk | In the release? |
|---|---|---|
| `arena.<arenaId>.<slot>` | `public/art/arenas/<arenaId>/<slot>.png` | Only when `<arenaId>` is `ACTIVE_ARENA_ID` |
| `arena.common.<slot>` | `public/art/arenas/common/<slot>.png` | Always |
| `car.*`, and anything else | as before | Always |

Two places apply the same rule, both through `arenaIdFromArtKey` in
`packages/shared/src/arena/art-keys.ts`: `shouldLoadAssetKey` filters manifest entries at boot so a
dev build only loads the active arena's art, and `pruneArenaAssets` in `scripts/build-release.mjs`
deletes the other arenas' files from the release.

The consequence worth knowing: an arena you are experimenting with costs the shipped zip nothing, so
there is no reason to delete an arena to keep the download small.

No arena art exists in the repo yet — every arena still renders from `ArenaScene.drawArena`'s
procedural `fillRect` loop, coloured by `arenaColorsOf` (`packages/client/src/scenes/arena-visual.ts`).
The namespace above is the seam for when sprites land, not something already shipping.

## Deferred

Each of these was considered and deliberately deferred, not overlooked — each is its own future
spec and plan:

- **The online build step.** Today dev and LAN both read `public/art/` straight off disk at full
  resolution, unhashed. That is fine on a LAN, where the art ships in the same zip as everything
  else and cache headers don't matter. It stops being fine the moment the game is hosted over the
  internet: unhashed assets under weak cache headers either go stale on every deploy or can't be
  cache-busted at all, and full-resolution loose PNGs are wire bytes 1:1 since images don't gzip
  the way the JS bundle does. The fix — downscale, convert to WebP, content-hash the filenames, and
  rewrite the manifest to point at the hashed names, all inside the build — is additive on top of
  the manifest indirection that already exists: nothing that reads the manifest today needs to
  change when this lands, because it will still just be asking for a key. Building it now would be
  speculative; v1 is LAN-only.
- **Particle and spritesheet effects.** The manifest schema is flat and namespaced (`car.*` today)
  specifically so an `effects` half can arrive as more rows, not a schema rewrite. It isn't built
  because there is nothing to drive it yet — no power exists in the sim. When it lands, particle
  configs are the intended shape over baked spritesheets, and for modifiability rather than raw
  performance: a 16-frame sheet is a single quad and is actually cheaper on the GPU than a 30–50
  particle burst, but a particle system's parameters (spread, lifetime, colour) are tunable without
  regenerating art. Emitters would need to be pre-created and pooled at boot with `maxParticles`
  caps, matching the "nothing loads during a match" rule sprites already follow.
- **Powers art.** No power exists in the sim yet, so there's nothing to draw. The flat key
  namespace (`power.boost.icon`, `power.boost.pickup`, and so on) is what lets this be new rows
  when it does, not a new section of the schema.
- **Themes.** Not designed and not scheduled — possibly never. The only affordance kept for it is
  that `MANIFEST_URL` is a single constant with no project name baked into the path, which costs
  nothing today and is the one thing that would otherwise have to be found and changed everywhere
  later.
- **A texture atlas.** At six players and roughly twenty sprites, the GPU batching an atlas buys is
  negligible — Phaser 3's WebGL renderer already binds many texture units at once. What an atlas
  would cost is exactly the friction this whole pipeline exists to avoid: changing one car's art
  means re-running a packer, two files change instead of one, the sheet itself is an unreviewable
  binary blob in git diffs, and packed neighbours risk edge-bleed fringing. If the online build's
  request count ever justifies it, packing belongs in that build step — it would run against the
  same loose `public/art/` source and rewrite the manifest to atlas form, and because every
  consumer only ever asks the manifest for a key, no scene code would need to change.
