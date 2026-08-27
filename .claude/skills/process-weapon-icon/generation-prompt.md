# Weapon icon generation prompt

Substitute `[WEAPON_DESCRIPTION]` and `[WEAPON_COLOR]`, then use verbatim.

> Flat vector game icon of [WEAPON_DESCRIPTION], centred single object, viewed straight on,
> filling most of a square frame with a small even margin. Bold simplified silhouette that stays
> readable at 64×64 pixels. [WEAPON_COLOR] is the dominant colour and carries the largest area of
> the icon; support it with 2–3 further saturated colours with strong value contrast against both
> light and dark backgrounds. Clean crisp edges, no gradients, no texture, no drop
> shadow, no outer glow, no perspective, no background scenery, no text, no lettering, no
> watermark. Consistent top-left light source. Transparent background. PNG.

## Filling in the placeholders

`[WEAPON_COLOR]` is **looked up, not chosen.** It is that weapon's own `color` from `WEAPON_TABLE`
([`packages/shared/src/config/weapon-config.ts`](../../../packages/shared/src/config/weapon-config.ts))
— the hex its **shots** already draw in, `#E8590C` for the fireball. Pass the hex itself; a generator
lands near it rather than on it, and near is enough. A weapon with no row there is not a weapon
yet: author it with the `weapon-forger` skill first.

The point is that the icon in the HUD slot and the disc crossing the arena read as the same weapon.
The slot is where a player learns "fireball = ember orange"; they should then recognise it in flight
without being told. Nothing enforces this — `import-weapon-icon.mjs` never inspects an image's
palette, so a blue fireball icon over orange fireball shots imports silently and looks like a bug in
the game rather than a mismatch in the art.

`[WEAPON_DESCRIPTION]` is the weapon itself, as an object: "a stubby brass cannon barrel", not
"the cannon weapon". Do not describe the HUD, the slot, or the game around it.

## Why no greyscale here

The [car prompt](../process-car-asset/generation-prompt.md) demands `GREYSCALE ONLY`; this one must
not. A car sprite is multiplied by the player's colour at runtime, so residual colour turns to mud.
A weapon icon ships `colorMode: "none"` and keeps exactly the colour it was generated with. See
[`asset-pipeline.md`](../../../docs/asset-pipeline.md).

This file is the only copy of the prompt. [`SKILL.md`](SKILL.md) points here rather than repeating
it — keep it that way.
