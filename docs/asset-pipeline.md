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
  turrets/        # turret PNGs: default.png ships; <carId>.png for a per-car turret (see Turret art)
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
| `scale` | `"fit"` | `"fit"` contains the art inside the 60x40 hull. A positive number is an explicit multiplier — use it when pack art has heavy transparent padding and `"fit"` renders it too small. |
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
carId ("bastion")
  -> carSpriteKey        "car.bastion"                packages/client/src/assets/asset-keys.ts
  -> manifest lookup     sprites["car.bastion"]        assetManifest() in BootScene.ts
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
bare hexagon for the first second of a match and then popping into its sprite actually is — nothing
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
`carFillOf(colorId)`. **Those shapes are a rendering detail, not an identity.** The chassis were
named for them until 2026-08-30 — `rectangle`, `oval`, `hexagon` — and the mapping survived the
rename to `mirage` / `bullseye` / `bastion` unchanged: Mirage still falls back to a rect, Bullseye to
an ellipse, Bastion to a hex.

When you have added a PNG and it still shows as a procedural shape,
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

Sprite fitting itself — `"fit"` containing the art inside the 60×40 hull, `rotationOffset` being
added to the body's `angle`, `origin` being applied — is `fitSprite` in
`packages/client/src/assets/sprite-fit.ts`, pure and independent of Phaser so it is unit-tested
without a browser. `"fit"` measures the hull against the texture's **rotated** bounding box, because
`rotationOffset` is applied before the sprite lands in hull space: a 64×128 up-facing sprite at
`1.5707963` presents 128 along the hull's 60, not along its 40, and comparing the unrotated
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

**128×128 is the working size, 256×256 the ceiling.** Cars render at roughly 60×40 world units, and
the importer writes each sprite at 2× the hull's long edge — 120 px (`SUPERSAMPLE` in
`scripts/import-art.mjs`) — so 128² is only just above what the importer writes, where at the old
48×32 hull (96 px written) it was comfortable headroom. Source art trimmed to 128 on its long edge
now downscales by a hair rather than meaningfully; aim well above it, toward the 256×256 ceiling, for
source art headed at a car. The preflight's `small-source` warning is what catches an under-sized
source after the fact.

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
(`packages/client/src/dev/AssetTuningScene.ts`) instead of the join screen. Two sections, no server
connection:

- **Chassis** — every car in `CAR_TABLE` parked on its own OBB hull, art or "no art" label, key
  name, and current `scale`/`rotationOffset` printed underneath. Cars draw **untinted** by default,
  because a player's colour is a lobby assignment rather than a property of the art. The tint picker
  beside them (click a swatch, or press `0`–`6`) puts a real `COLOR_TABLE` colour on when the
  question is whether a sprite tints cleanly; it re-applies through `applyCarSprite`, so a
  `colorMode: "none"` row keeps refusing the tint exactly as it does in a match.
- **Weapon icons** — every weapon on every chassis kit, one row per chassis, cells left to right in
  slot order. Each sits in a real `SLOT_BOX_PX` HUD slot circle and is fitted by `resolveWeaponIcon`
  at `HUD_ICON_FIT_SCALE`, the same resolver and the same box the live HUD uses, beside a swatch of
  its `WEAPON_TABLE.color` — the colour its *shots* draw in. Nothing typed ties an icon to that hex,
  so putting the two side by side is the only place the pair can be judged as one weapon. The grid
  is built from kits, so a weapon no car carries has no cell; the header names it rather than
  dropping it silently.

Each chassis cell also draws its **turret** at the car's mount, through the same resolution chain
the arena uses (see [Turret art](#turret-art)), and a dot where a turret shot with
`additionalOffset: 0` would spawn — `TURRET_CONFIG.defaultOffset` along the turret's facing. The dot
should sit on the barrel tip; this is where `defaultOffset`, `CarDef.turretMount`, the turret row's
`origin` and `TURRET_VISUAL.lengthUnits` are lined up by eye. A cell whose shipped `fireSlotsOf`
carries no turret weapon (`carHasTurretWeapon`, TR53) draws neither the turret nor the dot and reads
`turret: none` instead — the same rule the arena applies to a live car's current loadout.

It exists because `rotationOffset`, `scale`, and `origin` have to be tuned by eye per sprite, and
the alternative loop is a full rejoin per attempt — the client has no reconnect or session
persistence, so checking one sprite's alignment any other way means the name prompt, lobby, car
select, and countdown again before you can look at the car once more.

The layout arithmetic lives in `packages/client/src/dev/tuning-layout.ts` and is unit-tested; the
scene itself cannot be, since client tests run in node and never import Phaser.

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

## Turret art

Since the 2026-09-21 mouse-aim work every car draws a **turret** on top of its hull — the barrel a
turret weapon fires from (see [`combat-model.md`](combat-model.md#turret-muzzle)). It is a second,
independently rotating layer, a mount nested in the car's container (placed by `turretPivotOf` at
the car-local origin, so the container composes it to exactly
`turretPivotOf(rendered pose)` — the car's `CarDef.turretMount`, the centre on every row today),
rotated to the car's rendered angle plus the networked `PlayerState.turretAngle` (eased toward it at
the turret's own turn rate by `easeTurretAngle`, snapping on a gap over a quarter turn), tinted with
the same car fill and four-corner lighting as the hull (re-lit each frame for the turret's own world
heading, so it shades as it swings), and faded and hidden with the car.

```
carId ("bastion")
  -> turretSpriteKeys    ["turret.bastion", "turret.default"]   packages/client/src/assets/asset-keys.ts
  -> manifest lookup     the first key whose row exists AND whose texture loaded
  -> procedural fallback drawProceduralTurret (a block with a barrel), otherwise
```

- **Two keys, one shared default.** `turret.<carId>` is a per-car turret; `turret.default` is the
  one every car without its own falls back to. Unlike `car.<id>`, whose fallback is a different
  CAR's art, a turret's fallback is a shared asset — turrets are interchangeable. Only
  `turret.default` ships (`turrets/default.png`); no per-car turret does. A car with neither still
  draws, as a procedural block and barrel (`drawProceduralTurret` in `scenes/turret-visual.ts`,
  shared with `?dev=assets`) — art stays optional here as everywhere else.
- **`origin` is the pivot.** Turret art faces `+x`, like car art, and its row's `origin` is the
  point inside the image that sits on the mount. The default ships `[0.31, 0.5]`, on its mount
  plate. `colorMode` defaults to `"tint"`, so turret art is desaturated like a chassis sprite.
- **Size is a client knob, not `"fit"`.** A turret is not fitted inside the hull. Its long edge is
  `TURRET_VISUAL.lengthUnits` (`packages/client/src/config/turret-visual.ts`, 36 u) times the row's
  numeric `scale` (`"fit"` counts as 1). Resizing it does **not** move where a shot spawns — that is
  the sim's `TURRET_CONFIG.defaultOffset` (25) — so re-line the two up in `?dev=assets` after
  changing either.
- **Importing.** `node scripts/import-art.mjs <image> <carId|default> --turret` (the skill's `preflight.mjs`
  accepts the same flag) trims, downscales to 2 px per world unit — `TURRET_TARGET_PX`, a 72 px long
  edge for 36 u — desaturates unless `--keep-color`, writes `turrets/<id>.png`, and upserts the
  `turret.<id>` row, preserving hand-tuned fields as the car path does. A first import of `default`
  seeds its `origin`. The [`process-car-asset`](../.claude/skills/process-car-asset/SKILL.md) skill
  documents the turret path.
- **Checking.** `npm run check:art` covers turret rows with the car blockers (a lost alpha channel,
  a row naming a missing file); `check-art.mjs`'s `namespaceScopeOf` puts `turret.*` in the `"cars"`
  scope, so `npm run check:cars` includes them. A car with no `turret.<id>` row is not a finding —
  `turret.default` is a complete answer.
- **Not drawn at all is also a valid answer (TR53).** A row's art is only ever reached once
  `carHasTurretWeapon` says this car has a turret weapon to draw one FOR — a car with none skips the
  mount, the sprite lookup and the TR45 spawn dot together, both in the arena and in `?dev=assets`.
  Importing turret art for a car with no turret weapon is not wrong, just inert until it gets one.

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
| Fit target | 60×40 hull | square slot box (~64 px on screen, imported at 128×128) | An icon is not a chassis; it fits the HUD's box, not the car's OBB. |

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

Check a new icon's fit at [`?dev=assets`](#devassets), which draws every weapon's icon in a real HUD
slot beside every colour that weapon's shots draw in — the swatch is a stack, not a single fill,
because six of the nine are ramps or markings and `WEAPON_TABLE.color` is only one layer of them.
No rejoin, and the whole roster at once. Since the icons are themed per chassis, that pairing is also
where you check a re-imported icon still reads as its car's palette; `npm run check:weapons` scores
the drift numerically. The live HUD bar (`npm run
dev`, equip the weapon) is still the final word, since only it shows the icon under the slot's
cooldown sweep and dim states. The `process-weapon-icon` skill mirrors `process-car-asset`: hand it
an image and a weapon id, and it runs the importer, reports the manifest row, and covers "why is my
icon blurry / missing / wrong."

World instances — the actual projectile or beam hitbox flying through the arena — are never
sprites; see [`combat-model.md`](combat-model.md) for why that stays procedural instead. Only the
HUD icon goes through this pipeline. An instance is filled with its weapon's own
`WEAPON_TABLE.color`, never the firing player's colour, so a weapon looks the same in every car's
hands — the same rule as the icon's `colorMode: "none"`, applied to the shot.

### How much detail a shot can afford

Shots are drawn in immediate mode by `ArenaScene.renderShots`: one shared `Graphics`
(`this.shotGfx`) is `clear()`ed and rebuilt every frame, a projectile becomes one disc per band from
`instanceGlowBands`, and a beam becomes one polygon per layer. Detail costs **one fill per band or
layer, per shot, per frame — plus whatever it costs Phaser to triangulate that fill.** The second
half was invisible until 2026-09-21 and turned out to be the larger: `fillPoints` and `fillCircle`
both become a path that Earcut re-triangulates every frame, so one `lance` beam of eight
two-hundred-station layers cost more per frame than the rest of the scene. A fill count would never
have said so. The shot layers now fill a strip as a strip and a disc as a fan
(`scenes/ribbon-fill.ts`) and skip the triangulator; the fill count is what is left, and it is cheap.

**That budget is much larger than it sounds, so do not design timidly.** A car has one fire state
machine, so a player can only have one weapon mid-volley at a time; the worst realistic case is a
chassis with overlapping flight times (two `predator`s, a twelve-pellet `pepperbox` burst across its
four muzzles, a beam) at roughly ten live instances, times six players — call it 60. A four-band glow
style applied to all nine weapons would be ~240 `fillCircle` calls per frame, ~14k/second. Phaser
batches one Graphics object's fills into a single vertex buffer, and the `fillStyle` colour changes
*between* bands do not break that batch. Authoring a look for every weapon is comfortably within
budget.

Five things do cost, and they are the only ones worth stopping for:

| Cliff | Why it hurts |
|---|---|
| **A polygon of hundreds of vertices handed to `fillPoints`** | Earcut runs over it every frame into fresh arrays. A jet is 194 vertices a layer and a bolt 415; a look that walks stations must carry `DrawBeamLayer.ribbon` so `fillRibbon` tiles it as the strip it is. `ribbon-fill.test.ts` fails any un-ribboned shot polygon past 64 vertices. |
| A **blend mode per instance** (`setBlendMode` for additive glow) | Every change flushes the batch. This is the one that turns a single draw call into one per shot. |
| **Faking a gradient** with 15–20 bands per shot | Phaser `Graphics` has no gradient fill, so a smooth ramp means many bands. This is the only way band count itself becomes the problem. |
| **A `Graphics` object per shot** instead of the shared `shotGfx` | Loses the batch entirely, and adds a create/destroy cycle per instance. |
| **Allocation churn** in `instanceGlowBands` | It returns a fresh array per instance per frame — invisible at today's counts, GC pressure if band counts climb steeply. Cache before reaching for anything cleverer. |

**The binding constraint is honesty, not frame time.** Bands are fractions of the hitbox radius and
the flicker only ever *shrinks*, so a drawn shot can never render larger than the hitbox that
actually hits — a shot that looks bigger than it is makes players believe in hits that never
happened. `combat-visual.test.ts` enforces it. Design detail inside that rule, not around it.

Beams take detail differently: they are polygons, so the equivalent of a band is a smaller cone or
rect nested inside the outer one (a bright core inside a translucent cone). A plain nested rect or
fan is a handful of vertices and costs what a band does. An animated flame or bolt is a station walk
of hundreds, and its cost is set by how many stations it hands the triangulator — which is why
those layers are ribbons. Price a new one the way `packages/client/CLAUDE.md` says: build
milliseconds plus render milliseconds at twelve live instances, not a fill count. The
[`weapon-look`](../.claude/skills/weapon-look/SKILL.md) skill walks that.

A third kind of detail is a **marking**: geometry drawn inside a non-circular projectile's hull, since
neither of the tables above can reach an ellipse or a capsule. `WEAPON_PROJECTILE_STYLES` holds
those, built from four primitives — `hull`, `tip`, `band`, `disc`, `spikes` — each a fraction of the
weapon's own `radiusAlong` or `radiusAcross`. `thumper` takes a cream band across its hull today;
`predator` and `pepperbox`, the roster's other two non-circular projectiles, still draw the flat
hitbox fill until an owner arts them. Cost is one extra `fillPoints` per marking per shot.

All of it is data in those three tables (`packages/client/src/scenes/combat-visual.ts`), keyed per
weapon and `Partial`, so a weapon with no entry keeps the flat fill. Adding a look needs no
rendering code, no sim change and no wire change — `WEAPON_TABLE.color` and the styles are both
render-only.

## Arena art

Arena-owned art is namespaced by arena id, so the release can carry only the arenas some ACTIVE mode
could draw on — `activeArenaIds()` in `packages/shared/src/modes/registry.ts`, the de-duplicated
union of every active `GameMode`'s whole `ModeTables.arenas` list, not one arena picked for the whole
game. Brawl and Deathmatch both list `["arena-01", "arena-02"]` today, so the union is both arenas.

**Only `arenas[0]` is reachable today.** A match plays the first entry of its mode's list and
nothing selects any other, so `arena-01` is the one arena a player can actually be dropped into
while the union the zip ships is two. That slack is deliberate: the union is what the day a mode
carries a different first arena needs, and it costs nothing to keep the wider set shipping until
then. A mode authored against a narrower or disjoint set would ship only what it and its siblings
list.

| Manifest key | On disk | In the release? |
|---|---|---|
| `arena.<arenaId>.<slot>` | `public/art/arenas/<arenaId>/<slot>.png` | Only when `<arenaId>` is in `activeArenaIds()` |
| `arena.common.<slot>` | `public/art/arenas/common/<slot>.png` | Always |
| `car.*`, and anything else | as before | Always |

Two places apply the same rule, both through `arenaIdFromArtKey` in
`packages/shared/src/arena/art-keys.ts`: `shouldLoadAssetKey(key, arenaIds, everyArena)` filters
manifest entries at boot against the LIST `activeArenaIds()` returns, so `BootScene` loads every
active mode's arena art together rather than a single arena's, and `pruneArenaAssets(dir, arenaIds)`
in `scripts/build-release.mjs` keeps that same union in the release, deleting only the arenas no
active mode lists at all.

The consequence worth knowing: an arena you are experimenting with costs the shipped zip nothing, so
there is no reason to delete an arena to keep the download small.

**`arena.arena-01.floor` and `arena.arena-02.floor` are the keys in this namespace with a file behind them**,
the first landed by the 2026-09-11 arena-sprite-and-spike-hazard work, the second a dusty rectangular
pit with a continuous spike ring. `arenaFloorKey(arenaId)`
resolves it through the same chain as a car sprite — manifest lookup, then texture, then fallback —
and when the row exists **and its texture actually loaded**, `ArenaScene` draws it as a plain `Image`
at the world rect in place of the generated asphalt `TileSprite`. A missing PNG, a malformed manifest
row, or a texture that fails to load falls back to the procedural asphalt exactly as before: the
fallback this namespace exists to protect was never weakened, only finally exercised.

A sprite arena draws none of the procedural decoration a rectangle arena still needs: the painted
lane markings and centre circle (`ENVIRONMENT_FX.markings`), the border stroke
(`arenaBorderRect`), and the fourteen spike obstacles themselves all go unpainted when a floor
sprite is in use, because the art already carries walls, markings and spikes drawn to match where
the sim actually puts them. `ENVIRONMENT_FX.floor.*` (the asphalt generator's own knobs) becomes
inert for that arena — the playground's environment panel says so rather than silently doing
nothing. An arena whose floor texture never loaded still gets all three procedural layers.

Every other arena still renders from `ArenaScene.drawArena`'s procedural `fillRect` loop, coloured
by `arenaColorsOf` (`packages/client/src/scenes/arena-visual.ts`) — the namespace above is still the
seam for when sprites land for them too, exactly as it was before this arena had one.

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
  negligible — Phaser's WebGL renderer already binds many texture units at once. What an atlas
  would cost is exactly the friction this whole pipeline exists to avoid: changing one car's art
  means re-running a packer, two files change instead of one, the sheet itself is an unreviewable
  binary blob in git diffs, and packed neighbours risk edge-bleed fringing. If the online build's
  request count ever justifies it, packing belongs in that build step — it would run against the
  same loose `public/art/` source and rewrite the manifest to atlas form, and because every
  consumer only ever asks the manifest for a key, no scene code would need to change.
