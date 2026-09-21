---
name: weapon-look
description: Use when someone wants a weapon's shot to LOOK a certain way in the arena — a glow, a flame, a bolt, a missile silhouette, markings, a halo, "make it feel like fire", "give it a core", "the shot looks flat" — or wants an existing look changed, animated, recoloured or made cheaper. Also use when a frame-time complaint names a weapon's shots. Not for the weapon's numbers (damage, range, hitbox — that is weapon-forger) and not for its HUD icon (process-weapon-icon).
---

# Weapon look

A look is a **client-only table row** in `packages/client/src/scenes/combat-visual.ts`. It changes
nothing on the wire and owes no manual rebuild, which is exactly why nothing else will catch a look
that is dishonest or expensive: the two rules below are the whole discipline, and **a look is not
shippable until it has been priced and seen.**

Read first: `packages/client/CLAUDE.md` (the shot paragraphs) and
`docs/asset-pipeline.md#how-much-detail-a-shot-can-afford`. `docs/combat-model.md` §look has the
honesty rule. This skill is the process around them.

## 1. Pick the table from the hitbox

| Hitbox | Table | Primitives |
|---|---|---|
| circle | `WEAPON_GLOW_STYLES` | nested discs by `radiusScale`, flicker, `halo` |
| ellipse / capsule | `WEAPON_PROJECTILE_STYLES` | `hull`, `tip`, `band`, `disc`, `spikes`, free `poly`; `halo` |
| rect beam | `WEAPON_BEAM_STYLES` | nested bars, or a bolt (`crackle`, `wander`, `domeScale`, `shards`, `flare`) |
| cone beam | `WEAPON_BEAM_STYLES` | tongued fan, or a jet (`flameHz`, `billow`, `breakUp`, `wander`, `embers`) |
| disc beam (aura, explosion) | none — drawn as a ring | — |

Start from the shipped row nearest the brief (`magmablast`, `predator`, `lance`, `afterburner`) and
say which one you copied. Every scale is a **fraction of the hitbox**, never a world distance.

## 2. Two rules that are tests

- **Nothing draws outside the hitbox.** What you see is what hits (D19). `combat-visual.test.ts`
  and `projectile-marks.test.ts` sweep headings, extents and clock times for the shipped rows;
  a new row gets the same sweep, copied from the nearest one, in the same commit.
- **A station walk is a ribbon.** Any layer built as stations down one edge and back up the other
  must return `ribbon` (the per-edge count), so `fillRibbon` tiles it instead of Phaser running
  Earcut over hundreds of vertices every frame. `ribbon-fill.test.ts` fails any un-ribboned polygon
  past 64 vertices. Reusing `conePoints`/`rectPoints` gets this for free; a new builder does not.
  A crackling layer whose tear is under `BOLT_VISIBLE_TEAR` (0.5 u) is drawn straight — do not
  author sub-pixel tears.

## 3. Price it — both halves, before calling it done

Cost is **not** a fill count. It is build milliseconds plus render milliseconds, at twelve live
instances of the one weapon, and `lance` was costing more per beam than the rest of the scene
while every fill count looked fine.

**Build half (headless, two minutes).** Copy `price-look.scratch.test.ts` from this folder to
`packages/client/src/scenes/`, then from `packages/client`:

```bash
LOOK=<weaponId> npx vitest run price-look
```

Read the table, compare against the same run on the row you copied from, delete the file.
An "Earcut-bound vertices" column in the hundreds is a missing `ribbon`.

**Render half (browser, the one that found `lance`).** `npm run dev`, open
`http://localhost:5173/?dev=playground`, seat the weapon, fire it, press `P` to pause on a frame
with the instance alive. Temporarily wrap the body of the `room.state.weapons.forEach` in
`ArenaScene.renderShots` in a `for (let k = 0; k < 12; k++)` that offsets `x` by `k * 40`, record
five seconds in Chrome's Performance panel, and read the mean frame's render time against the
same frame with the loop count at 0. Revert the loop. Report both halves as
`weapon: build X ms, render Y ms per instance per frame`, beside the reference row's figures.
No browser where you are running? Then the render half is **unpriced**, and the summary says the
look is not shippable until someone runs it — it is not done with a caveat.

**Stop and say so** before any of: a `setBlendMode` per instance, 15+ bands to fake a gradient, a
`Graphics` per shot, or a per-frame allocation that scales with band count.

## 4. Colour agrees with `WEAPON_TABLE.color`

The look's dominant colour, the row's `color` and the HUD icon are meant to read as one weapon:
`color` is what the slot swatch, the playground loadout picker and the guide's heading draw. If the
look moves the hue, move `color` with it — that is a shared edit, so rebuild shared, run
`npm run build:manual`, commit the page, and run `npm run check:weapons` for icon drift. Leaving
them apart is a decision to name in the summary, not a default.

## 5. Look at it

Open the playground and watch the shot at rest, in flight and dying, at the arena's zoom of 1.
Palette tests prove ordering, not readability against the light floor. Say in the summary that you
looked, or that you could not and why.

## Common mistakes

| Mistake | Instead |
|---|---|
| Measuring build cost only | Both halves; the render half is where `lance` hid |
| A throwaway loop, deleted, nothing comparable next time | The scratch file, run against the reference row too |
| Counting fills as the budget | Vertices through Earcut are; ribbons are free |
| A new station-walk builder without `ribbon` | Return `ribbon`; the guard names the weapon |
| Look recoloured, `color` left as it was | Move both, rebuild the manual, check icon drift |
| Shipping without opening the playground | Look, at zoom 1, on the light floor |
| Authoring a distance in world units | Fractions of the hitbox, so a re-tune carries the look |
