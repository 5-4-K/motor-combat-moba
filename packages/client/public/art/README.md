# Art

Drop PNGs in here and name them in `manifest.json`. Nothing else is required — no code change,
no rebuild. A key with no entry, or an entry whose file is missing, falls back to the procedural
silhouette the game drew before any art existed.

## Adding a car sprite

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

```
mogrify -path out/ -colorspace Gray cars/*.png
```

Phaser's tint is multiplicative, so dark tyres and windows stay dark rather than becoming
coloured mush.
