# Art

Drop PNGs in here and name them in `manifest.json`. Nothing else is required — no code change,
no rebuild. A key with no entry, or an entry whose file is missing, falls back to the procedural
silhouette the game drew before any art existed.

## Checking what is in here

```bash
npm run check:art
```

Reports every problem this directory can have: a lost alpha channel, a manifest row naming a file
that is gone, a file nothing references, an off-size icon, a car sprite that still carries colour
while being player-tinted, an icon whose colour has drifted from its weapon's `WEAPON_TABLE.color`.
`npm run check:cars` and `npm run check:weapons` scope it to one asset class.

Worth running after editing a PNG **in place** — an image editor bypasses the importers below, and
the nastiest failure is silent: a PNG saved without alpha (Paint.NET's "24-bit" option, and the
equivalent elsewhere) still loads, so nothing falls back. It just draws an opaque box. `npm test`
runs the blocker-level checks for that reason; the warnings are advisory and never fail it.

## Importing a generated image

For anything that did not arrive already sized for the hull — an AI generation, a pack sprite —
use the importer rather than doing it by hand:

```bash
node scripts/import-art.mjs <image> <carId>
```

It trims the transparent margin, scales the long edge to 2x the hull (the GPU shrinks cleanly only
down to about 1:2, so the file is kept close to its drawn size), desaturates for `"tint"`,
writes `cars/<carId>.png`, and adds or updates the manifest row. Re-run it on the same `carId` to
replace that car's art; **fields you tuned by hand are preserved**, only `file` is rewritten.

It reports what the client will actually draw, which is the part worth reading:

```
art           1197 x 698   aspect 1.71
in-game       drawn 48.0 x 28.0 inside the 48x32 hull  (100% x 88%)
```

Warnings never stop an import — a questionable source still lands, and you judge it in
`?dev=assets`. Two flags:

| Flag | Use |
|---|---|
| `--keep-color` | Skip desaturation, for art you intend to ship with `"colorMode": "none"`. Implied when the manifest row already says so. |
| `--key-background` | Flood-fill an opaque background away, for a source that arrived without alpha (a JPEG, or a checkerboard baked in as real pixels). Only works when the vehicle has a continuous dark outline for the fill to stop against — exporting a real PNG is always the better fix. |

The hull it fits against comes from `DRIVE_CONFIG` in shared, so shared must be built first
(`npm run build -w @motor-combat-moba/shared`, or just `npm run dev`).

## Adding a car sprite by hand

1. Save the image as `cars/<carId>.png`, where `<carId>` is a key of `CAR_TABLE`
   (`rectangle`, `oval`, `hexagon`).
2. Add a row:

```json
{
  "sprites": {
    "car.hexagon": { "file": "cars/hexagon.png" }
  }
}
```

3. Reload with `?dev=assets` to check the fit against the hitbox.

## Weapon icons

The weapon slot HUD draws a procedural glyph (a filled circle for a projectile, a bar for a beam)
for any slot whose weapon has no manifest icon. To replace one with real art:

```bash
node scripts/import-weapon-icon.mjs --weapon <weaponId> --src <path>
```

It trims the transparent margin, fits the result into a 128x128 square (`ICON_PX` — twice the
~64px HUD box, so the icon stays sharp and the deferred device-pixel-ratio work needs no
re-import), and writes `weapon-icons/<weaponId>.png`, adding or updating the `weapon-icon.<id>`
manifest row. Re-run it on the same weapon to replace its icon; **fields you tuned by hand are
preserved**, only `file` is rewritten.

**Icons keep their colour.** A weapon icon is never player-tinted — the row is always written with
`"colorMode": "none"` — so unlike `import-art.mjs` this importer has no `--keep-color` flag and no
desaturation step at all. The car importer desaturates *because* car sprites are multiplied by the
player's colour at runtime; doing that to an icon would leave every weapon's icon the same grey
blob rather than the colour it was drawn in.

There is no `?dev=assets` preview for icons — that tool is car-only. Check the fit by running
`npm run dev`, joining a match with the weapon equipped, and looking at its slot in the HUD bar.

## Fields

All optional except `file`.

| Field | Default | Meaning |
|---|---|---|
| `file` | required | Path relative to this folder. |
| `rotationOffset` | `0` | Radians added to the car's angle. The sim's forward is `+x`, i.e. pointing **right**. Art drawn facing **up** needs `1.5707963`. |
| `scale` | `"fit"` | `"fit"` contains the art inside the 48x32 hull. A positive number is an explicit multiplier — use it when pack art has heavy transparent padding and `"fit"` renders it too small. |
| `colorMode` | `"tint"` | `"tint"` multiplies the texture by the player colour and needs desaturated art. `"none"` leaves pre-coloured art alone — the player's colour then does not appear on the car at all, so use it only for chassis skins whose colour is not meant to identify the player. |
| `origin` | `[0.5, 0.5]` | Normalised origin, for art whose visual centre is not its geometric centre. |

## Size limits

**128x128 is the working size, 256x256 the ceiling.** VRAM cost is driven by dimensions, not file
size — a 40 KB PNG at 2048x2048 still occupies about 16 MB of VRAM. Downscale pack and
AI-generated art before committing it.

## Desaturating a pack for `"tint"`

`import-art.mjs` desaturates for you, so this is only needed for bulk-converting a whole pack
before importing any of it:

```
mogrify -path out/ -colorspace Gray cars/*.png
```

Phaser's tint is multiplicative, so dark tyres and windows stay dark rather than becoming
coloured mush. That also means residual colour multiplies into mud — a faintly blue body under a
red tint goes brown, not red — which is why the importer forces greyscale unless told otherwise.
