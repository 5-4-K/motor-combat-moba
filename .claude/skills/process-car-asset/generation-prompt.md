# Car sprite generation prompt

Substitute `[CAR_CHASIS_DESCRIPTION]`, then use verbatim.

```text
Top-down orthographic view of a vehicle, format PNG, seen from directly overhead
at 90 degrees, bird's eye view. Perfectly flat, no perspective, no vanishing
point, no tilt — the camera looks straight down at the roof. Image format - png. No background
The vehicle points RIGHT: front at the right edge, rear at the left edge,
symmetrical about its long axis. The facing
direction should be obvious.
Extremely simplified flat vector game sprite, legible at 48x32 pixels. Bold
chunky graphic shapes like a mobile game icon. No panel lines, no bolts, no
rivets, no vents, no grilles, no small greebles, no surface texture.
Stocky game proportions, only about 1.5 times longer than wide — a compact
arcade vehicle, not a realistically long car. Fills the whole frame edge to
edge with no empty margin. Thick dark outline.
GREYSCALE ONLY, no colour anywhere. Body panels light to mid grey (70-90%
brightness), tyres and glass near black (10-25%). Isolated on a fully
transparent background. No shadow, no ground, no reflection, no glow.

[CAR_CHASIS_DESCRIPTION]
```

## Why each demand is in there

Four of these are not style preferences — they are the pipeline's requirements, and art that
ignores one imports without complaint and looks broken in game.

| The demand | What breaks without it |
|---|---|
| **GREYSCALE ONLY** | The sprite is multiplied by the player's colour at runtime (`colorMode: "tint"`), so only its *values* survive. `import-art.mjs` will desaturate for you (`.greyscale()` unless `--keep-color`), but that is damage control: flattening a finished colour design collapses hues of equal brightness into one grey. Generating in greyscale is how you choose which values the tint gets. |
| **Points RIGHT** | The sim's forward is `+x`. Art drawn facing up drives sideways, fixable only by hand-editing `rotationOffset` to `1.5707963` in the manifest. |
| **No empty margin** | The importer fits art to the 48×32 hull. Heavy transparent padding makes the car render small inside its own hitbox, and the fix is a hand-tuned `scale`. |
| **Legible at 48x32** | That is the hull, and the whole car is drawn at roughly that size. Detail below it is invisible at best and noise at worst. |

`[CAR_CHASIS_DESCRIPTION]` is the chassis as an object — its silhouette and character, not its
colour (see greyscale, above) and not the game around it.

This file is the only copy of the prompt. [`SKILL.md`](SKILL.md) points here rather than repeating
it — keep it that way. The sibling
[weapon icon prompt](../process-weapon-icon/generation-prompt.md) deliberately does **not** ask for
greyscale: icons are never tinted. See
[`asset-pipeline.md`](../../../docs/asset-pipeline.md).
