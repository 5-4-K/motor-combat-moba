---
name: process-weapon-icon
description: Post-process and wire a weapon HUD icon into the game — trims, fits to a square, writes packages/client/public/art/weapon-icons/<weaponId>.png, and updates the art manifest via scripts/import-weapon-icon.mjs. Use this whenever someone wants to add, import, replace, swap, or wire up a weapon icon, HUD icon, or a generated/AI/pack image for a weapon slot, even when they only hand over an image file and a weapon name without naming the script. Also use it when they ask why a weapon's icon looks wrong, grey, blurry, or is not showing up in the HUD.
---

# Process a weapon icon asset

Get one image into the game as a weapon slot's HUD icon: validated, post-processed, written to the
art folder, and wired into `manifest.json` so the client picks it up with no code change and no
rebuild.

The actual work is done by `scripts/import-weapon-icon.mjs`, which already exists and is
unit-tested (`npm run test:scripts`). Your job is the part around it — confirming the inputs,
refusing art that cannot work, and reporting what landed in terms the person can act on. Do not
reimplement the import with your own sharp script.

## The one rule that overrides everything else here

**Weapon icons keep their colour.** The sibling car-art pipeline (`scripts/import-art.mjs`,
`process-car-asset`) desaturates its images, because a car's sprite is tinted by the player's colour
at runtime and residual colour under a tint multiplies into mud. A weapon icon is never
player-tinted — it ships as `"colorMode": "none"` — so desaturating it would leave every weapon's
icon the same grey blob. `import-weapon-icon.mjs` has no `--keep-color` flag and no `.greyscale()`
call anywhere in it, on purpose. If a future edit "fixes" that in by mirroring the car importer more
closely, it is breaking this rule, not completing it.

**This skill is the HUD icon only.** If what they actually want is the colour of the weapon's
*shots* in the arena — the disc or beam flying across the screen — that is `WEAPON_TABLE.color` in
`packages/shared/src/config/weapon-config.ts`, a one-line edit with no image involved. World
instances are drawn from their own hitbox and never take a sprite. See
[`combat-model.md`](../../../docs/combat-model.md#what-the-client-shows). Nothing links the two:
an icon can be blue while the shot is orange, and neither importer will warn you.

## Inputs you need

Two things, and the skill cannot proceed without both:

| Input | What it is | If missing |
|---|---|---|
| **image asset** | Path to the source image | Ask for it. Do not guess from files lying around the repo — importing the wrong image silently overwrites a weapon's icon. |
| **weapon id** | Which weapon this icon is for | Ask, and list the known ids from `WEAPON_TABLE` in shared rather than from memory — the roster can change. |

If they name a weapon that is not in `WEAPON_TABLE`, say which ids exist rather than inventing one
— adding a weapon is a shared-config change, well outside this skill.

## The workflow

### 1. Make sure the toolchain can run

The importer reads `isWeaponId`/`WEAPON_TABLE` from shared's **built** `dist`, not its source. A
stale or absent `dist` fails with an unhelpful module-resolution error, so get ahead of it:

```bash
npm run build -w @motor-combat-moba/shared
```

Run it before the import rather than in reaction to an error. It is fast and idempotent. If `sharp`
turns out to be missing, `npm install` at the repo root fixes it.

### 2. Check the source image

There is no separate preflight script here — the checks are simple enough that the importer's own
guardrails cover them. Before running it, glance at the source yourself:

- It should have a real alpha channel (a PNG with transparency). An opaque background will be
  contained onto the square canvas rather than trimmed away, and will show as a visible box behind
  the icon in the HUD slot.
- It should already read as the intended silhouette at small size — the importer resizes to
  128x128, twice the ~64px HUD box, but does not simplify or reduce detail beyond that.

Neither of these is a hard gate the importer enforces; they are things worth a visual sanity check
because a bad source imports without complaint and the game just looks wrong.

### 3. Run the import

```bash
node scripts/import-weapon-icon.mjs --weapon <weaponId> --src <path>
```

It trims the transparent margin, fits the result into a 128x128 canvas (`ICON_PX`, twice the HUD
box so the icon stays sharp and the deferred device-pixel-ratio work needs no re-import), and
writes or updates the manifest row at `weapon-icon.<weaponId>`. Re-run it on the same weapon to
replace its icon; **fields you tuned by hand — `origin`, in particular — are preserved**, only
`file` is rewritten.

### 4. Report what landed

- the file written (`packages/client/public/art/weapon-icons/<weaponId>.png`) and its size
  (128x128),
- the manifest row (`weapon-icon.<weaponId>` → `weapon-icons/<weaponId>.png`, `colorMode: "none"`,
  `scale: "fit"`),
- and the next step: `npm run dev`, join a match with that weapon equipped, and check its slot in
  the HUD bar. There is no `?dev=assets` preview for weapon icons — that tool is car-only — so the
  live HUD is the only place to judge the fit.

Leave both the PNG and the manifest edit uncommitted. They are a visual change, and the person
should see the icon in the HUD before deciding it is right.

## When the result looks wrong

| Complaint | What is actually happening |
|---|---|
| Icon looks grey or washed out | Something desaturated it — check the file itself in an image viewer. This importer never does; if the icon arrived pre-desaturated, the fix is a new source image, not a flag. |
| Icon does not appear at all, glyph still shows | The client falls back to the procedural glyph (a circle or bar) whenever a slot's weapon has no manifest icon or the file failed to load — check the manifest row and the file on disk before suspecting the HUD code. |
| Icon sits off-centre or the wrong size in its slot | `origin` or `scale` in the manifest row, same fields the car pipeline uses — documented in `packages/client/public/art/README.md`. Tune them by hand; re-importing will not touch them. |
| Icon is too detailed to read at a glance | That is a source-image problem, not an import one — regenerate with a bolder, simpler silhouette. [`generation-prompt.md`](generation-prompt.md) is what tends to work. |

## Generating an icon from scratch

When there is no source image yet and one needs to be generated, the prompt lives in
**[`generation-prompt.md`](generation-prompt.md)**, next to this file. Read it and use it verbatim;
it is the only copy, so do not paste it back in here.

Two things it will ask you for. `[WEAPON_DESCRIPTION]` is the weapon as an object. `[WEAPON_COLOR]`
is **looked up, not chosen** — that weapon's `color` in `WEAPON_TABLE`
(`packages/shared/src/config/weapon-config.ts`), the hex its shots already draw in, which is what
makes the slot icon and the thing crossing the arena read as one weapon. A weapon with no row there
is not a weapon yet; send them to `weapon-forger` first.
