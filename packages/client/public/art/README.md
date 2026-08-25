# Art

Drop PNGs in here and name them in `manifest.json`. Nothing else is required — no code change,
no rebuild. A key with no entry, or an entry whose file is missing, falls back to the procedural
silhouette the game drew before any art existed.

## Importing a generated image

For anything that did not arrive already sized for the hull — an AI generation, a pack sprite —
use the importer rather than doing it by hand:

```bash
node scripts/import-art.mjs <image> <carId>
```

It trims the transparent margin, scales the long edge to 4x the hull, desaturates for `"tint"`,
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

## Fields

All optional except `file`.

| Field | Default | Meaning |
|---|---|---|
| `file` | required | Path relative to this folder. |
| `rotationOffset` | `0` | Radians added to the car's angle. The sim's forward is `+x`, i.e. pointing **right**. Art drawn facing **up** needs `1.5707963`. |
| `scale` | `"fit"` | `"fit"` contains the art inside the 48x32 hull. A positive number is an explicit multiplier — use it when pack art has heavy transparent padding and `"fit"` renders it too small. |
| `colorMode` | `"tint"` | `"tint"` multiplies the texture by the player colour and needs desaturated art. `"none"` leaves pre-coloured art alone; the coloured marker under the car still identifies the player. |
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
