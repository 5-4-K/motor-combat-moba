---
name: process-car-asset
description: Post-process and wire a car image asset into the game — trims, downscales, desaturates, writes packages/client/public/art/cars/<carId>.png, and updates the art manifest via scripts/import-art.mjs. Use this whenever someone wants to add, import, replace, swap, or wire up car art, a car sprite, a vehicle image, or a generated/AI/pack image for a car, even when they only hand over an image file and a car name without naming the script. Also use it when they ask why a car's art looks wrong, blurry, too small in its hitbox, or is not showing up in the game.
---

# Process a car image asset

Get one image into the game as a car sprite: validated, post-processed, written to the art folder,
and wired into `manifest.json` so the client picks it up with no code change and no rebuild.

The actual work is done by `scripts/import-art.mjs`, which already exists and is unit-tested. Your
job is the part around it — confirming the inputs, refusing art that cannot work, choosing the
flags, and reporting what landed in terms the person can act on. Do not reimplement the import with
your own sharp script; the importer's fit maths mirrors the client's renderer, and a parallel
implementation would drift from what the game actually draws.

## Inputs you need

Two things, and the skill cannot proceed without both:

| Input | What it is | If missing |
|---|---|---|
| **image asset** | Path to the source image | Ask for it. Do not guess from files lying around the repo — importing the wrong image silently overwrites a car's art. |
| **car id** | Which car this art is for | Ask, and list the known ids from the preflight output rather than from memory — the roster is defined in `CAR_TABLE` in shared and can change. |

Ask for whichever is missing in a single question, and offer the known car ids as concrete choices
so the person is picking from a list rather than recalling one. If they name a car that is not in
`CAR_TABLE`, say which ids exist rather than inventing one — adding a car is a shared-config change,
well outside this skill.

## The workflow

### 1. Make sure the toolchain can run

The importer reads the hull dimensions from `DRIVE_CONFIG` in shared's **built** `dist`, not its
source. A stale or absent `dist` is the single most common way this pipeline fails, and it fails
with an unhelpful module-resolution error, so get ahead of it:

```bash
npm run build -w @motor-combat-moba/shared
```

Run it before the preflight rather than in reaction to an error. It is fast, and it is idempotent.
If `sharp` turns out to be missing, `npm install` at the repo root fixes it.

### 2. Preflight the asset

```bash
node .claude/skills/process-car-asset/scripts/preflight.mjs <image> <carId>
```

It prints one JSON object: the source's format and alpha, the trimmed art, the size the importer
will write, how much of the 48x32 hull the result will cover, any existing manifest row, and three
buckets of findings — `blockers`, `warnings`, `notes`. Exit code is 0 when there are no blockers.

The fit numbers come from the importer's own helpers, so what the preflight predicts is what the
import will report.

### 3. Act on the findings

**Blockers stop the import.** There are only two of substance, and both mean the same thing: the
image has no real transparency.

- `not-png` — the source is a JPEG, WebP, or similar.
- `no-alpha` — a PNG saved without an alpha channel.

A car sprite is composited over the arena and rotates with the car, so an opaque rectangle is not a
slightly-worse result, it is a visibly broken one. Tell the person what is wrong and what fixes it
— re-export from the source tool as a PNG with transparency — and stop. Do not run the importer
anyway, and do not reach for `--key-background` to force a blocked asset through: that flag is a
rescue for art that is already in the repo's pipeline, not a way around the gate.

`unknown-car-id`, `missing-file`, `undecodable`, and `empty-after-trim` also block, and each says
what to do.

**Warnings need a decision, not a veto.** Things like `under-fills-hull`, `small-source`,
`alpha-fully-opaque`, or `mostly-transparent` describe art that will import and might look fine —
the pipeline's design is to degrade rather than block, because the real verdict comes from looking
at the car in `?dev=assets`. Relay each warning in plain terms, say what it will look like in game,
and ask whether to proceed. Proceeding is a perfectly reasonable answer; the point is that it is
theirs to give.

### 4. Choose the flags, say what you chose

Infer both flags from the asset and the manifest, state your reasoning in one line, and proceed —
there is no need to ask when the evidence is clear.

| Flag | Use it when | Leave it off when |
|---|---|---|
| `--keep-color` | The art is meant to ship in its own colours | Default. The game tints desaturated art with the player's colour, so most art should stay greyscale |
| `--key-background` | The preflight reports `alpha-fully-opaque` or `opaque-corners`, **and** the car has a continuous dark outline for the flood fill to stop against | Anything else. On art without that outline the fill walks straight through a light panel and eats the vehicle |

Two things worth knowing so you do not ask a question that is already answered: a manifest row with
`"colorMode": "none"` already implies `--keep-color`, and the preflight reports it as the
`pre-coloured` note. And `--key-background` only reaches a PNG-with-alpha that is fully opaque —
a genuinely alpha-less source was already blocked in step 3.

If the evidence is genuinely split — a fully-opaque PNG whose outline you cannot judge — say what
you see, name the risk, and let them choose.

### 5. Run the import

```bash
node scripts/import-art.mjs <image> <carId> [--keep-color] [--key-background]
```

### 6. Report what landed

The importer prints the source dimensions, the trimmed art, what the client will draw inside the
hull, whether it desaturated, and any warnings of its own. Relay that — especially the in-game line
and the hull-coverage percentages, which are the numbers that predict whether the car will look
right — plus:

- the file written (`packages/client/public/art/cars/<carId>.png`) and its size,
- the manifest row (`car.<carId>` → `cars/<carId>.png`),
- and the next step: `npm run dev`, then `http://localhost:5173/?dev=assets` to check the art
  against its hitbox.

Leave both the PNG and the manifest edit uncommitted. They are a visual change, and the person
should see the car on screen before deciding it is right.

## When the result looks wrong

Most complaints after a successful import are manifest tuning, not a re-import — the fields are
documented in `packages/client/public/art/README.md`:

| Complaint | Field |
|---|---|
| Car drives sideways or backwards | `rotationOffset` — the sim's forward is `+x`, so art drawn facing up needs `1.5707963` |
| Art is too small inside its hitbox | `scale` — a positive number overrides `"fit"`, which is right when pack art carries heavy transparent padding |
| Art is the wrong colour, or the tint muddies it | `colorMode` — `"none"` ships pre-coloured art untinted |
| Car pivots around the wrong point | `origin` |

These are hand-edited in `manifest.json` and preserved across re-imports, which is why re-running
the importer to fix a rotation is wasted effort — edit the field instead. Tune them by eye in
`?dev=assets`.

If the sprite does not appear at all, the client falls back to its procedural silhouette when a
manifest key is missing or its file is absent — check the row and the file on disk before
suspecting the import.
