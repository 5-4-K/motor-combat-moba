# Motor Combat MOBA — Arena Sprite, Polygon Boundary and Spike Hazard Design

**Designed:** 2026-09-11 · **Recorded in repo:** 2026-09-11
**Status:** Approved, not yet implemented.
**Builds on:** the arena registry and art-key namespace shipped by the
[asset pipeline](2026-08-25-asset-pipeline-design.md) and
[arena selection](2026-08-26-arena-selection-and-release-pruning-design.md) designs — the
`arena.<id>.<slot>` manifest convention and the release pruner already exist and have never had a
file to carry; the vector-drive collision model from the
[car-physics rework](2026-09-06-car-physics-rework-design.md), whose `applyContact` already computes
the inward velocity this spec's hazard trigger reads; and the deathmatch
[kill-attribution rule](2026-09-01-ffa-game-modes-design.md) (M9), which books a kill in exactly one
line and is what lets an environment death fall out of this design for free.

Decisions are numbered **AS1–AS31** and referenced by number elsewhere.

---

## Problem

`arena-01` is a flat colour with a generated asphalt tile over it. It reads as a surface, not as a
place. The player-facing arena has no identity, and the one thing the asset pipeline was built to
allow — dropping in real art — has never been exercised for an arena, because nothing in the client
reads an arena floor sprite. `packages/client/public/art/arenas/README.md` says so in as many words:
"Nothing lives here yet."

There is now art: a hand-made top-down render of a scrap-metal fighting pit, with walls, hazard
banding, floor grates and **inward-pointing spikes** ringing the wall faces. Two things about it do
not fit the arena model as it stands.

**First, the playable floor is not the image.** The image includes its own walls, so the region a car
may occupy is inset from the picture, and its corners are cut at 45° — an octagon, not a rectangle.
`Bounds` is `{ width, height }` with an implicit `(0, 0)` origin. It cannot express an inset, let
alone a cut corner.

**Second, the spikes are drawn but mean nothing.** A car would stop at an invisible straight line
somewhere near them, sometimes overlapping a spike visually and sometimes leaving a gap. And a spike
that a car can lean on with no consequence is scenery pretending to be a hazard.

This spec covers both, because they are the same measurement: where the floor ends is where the
spikes begin.

---

## Scope

**In:** the source art and its mapping to world units; an optional convex **boundary polygon** on
`ArenaDef`, carried as inward half-planes through `Bounds` and consumed by every existing boundary
reader; an optional **`kind`** on `Obstacle` and the fourteen spike strips that use it; a
**`SPIKE_CONFIG`** table and the contact-pass reporting, edge-trigger and damage application behind
it; kill attribution for a spike death; the floor sprite in `ArenaScene` and the procedural
decoration it replaces; new spawn tables for `arena-01`; the bot's wall awareness.

**Out:** any change to the drive model, the OBB hitbox model, friendly-fire, or collision damage
between **cars** — ramming still deals zero HP and this spec does not change that (AS20); any change
to `stepSim`'s tick order; any change to the weapon, car or status tables; `arena-02`, which keeps a
rectangular boundary and no art; multiple arenas in one build; a second hazard kind; destructible
geometry; spikes that push, slow, or apply a status rather than damage.

---

## Part 1 — The art and the mapping

**AS1. The source art is `2560 × 1440`.** Exactly 16:9, and exactly twice the client's logical
`1280 × 720`. The world scale is therefore **exactly 0.5 world units per image pixel**, and every
measurement below halves to an integer. This is not a convenience: a non-integer scale would put the
boundary planes and the hazard strips on fractional coordinates that no test could state cleanly.

**AS2. The image frame is the world rect, unchanged at `1280 × 720`.** `ArenaDef.width`/`height`
keep their present meaning — the extent the camera is bounded to and the sprite is drawn at — so
`fitsViewport` stays true, `CAMERA_CONFIG.zoom` stays 1, and the camera stays static with the whole
arena on screen. The playable region is inset **inside** that rect (AS6). Nothing about the camera
changes.

**AS3. The measured geometry**, in image pixels and the world units they halve to:

| | image px | world |
|---|---|---|
| Wall face, left / right | `x = 148 / 2412` | `x = 74 / 1206` |
| Wall face, top / bottom | `y = 108 / 1332` | `y = 54 / 666` |
| Corner chamfer legs | 100, at 45° | **50** |
| Spike protrusion (notch depth) | 40 | **20** |
| Playable rect | 2264 × 1224 | **1132 × 612** |

The chamfer leg is 50 world units against a car length of 48 (`DRIVE_CONFIG.carWidth`), and the
notch depth is 20 against a car width of 32. Both are figures a player can read off the screen.

**AS4. The playfield shrinks by a quarter, and that is accepted.** `1132 × 612` against today's
`1280 × 720` is −12% width, −15% height, **−25% area**. Every balance number on the roster was tuned
against the larger field, so closing distance shortens and weapon reach grows relative to the arena.
This is a deliberate trade for the art, taken with eyes open; the obligation it creates is a balance
run after implementation (AS31), not a pre-emptive retune.

**AS5. The file ships as `packages/client/public/art/arenas/arena-01/floor.png`,** declared in
`manifest.json` under the key **`arena.arena-01.floor`**. That namespace already exists:
`arenaIdFromArtKey` parses it, `shouldLoadAssetKey` filters on it at boot, and
`scripts/build-release.mjs` prunes every other arena's directory out of the zip. This is the first
file to use any of it. PNG is effectively mandatory — `ART_EXTENSIONS` in `scripts/check-art.mjs` is
`[".png"]`, and a manifest row naming any other extension reads as a missing file and fails the
suite.

---

## Part 2 — The boundary model

**AS6. `ArenaDef` gains an optional `boundary`: a convex polygon, authored as vertices, carried as
inward half-planes.** Absent means "the rectangle `0,0 → width,height`", so `ARENA_02` and every
future rectangular arena are untouched and no call site has to special-case them.

The octagon for `arena-01`, in world units, clockwise from the top-left chamfer:

```
(124, 54) (1156, 54) (1206, 104) (1206, 616) (1156, 666) (124, 666) (74, 616) (74, 104)
```

**AS7. Half-planes, not edges, and not SAT boxes.** Each plane is an inward unit normal `n` and an
offset `d`; a point is inside when `dot(n, p) >= d`. The rectangle is the four axis-aligned planes;
the chamfers add four at `(±1/√2, ±1/√2)`.

This is the shape the existing code already has. `boundsPush` computes, per axis, how far the car's
axis-aligned extent pokes past the edge; the generalisation projects the OBB's half-extents onto an
arbitrary normal instead — `r = |n·u| · w/2 + |n·v| · h/2` for the car's own axes `u`, `v` — and
pushes by `d + r - dot(n, c)` when that is positive. Same arithmetic, one more dot product.

Keeping it a clamp rather than four wall boxes preserves the property `resolveBounds` was written
for and documents in place: *"a thin wall box would happily eject a fast car out the far side."* A
half-plane cannot pick the wrong separating axis, however deep the penetration.

**AS8. Five construction sites, one helper.** `Bounds` is built as `{ width, height }` in exactly
five places — `sim/tick.ts`, `rooms/tick-pipeline.ts`, `bot/brain/solution.ts`,
`bot/brain/duel.fixture.ts`, and the client's `net/step-context.ts`. All five become a call to a
single `boundsOf(arena)` in shared, so an arena's planes cannot reach four consumers and miss the
fifth. That divergence is the failure this spec most wants to prevent: a client predicting against a
rectangle while the server simulates an octagon is a rubber-band bug that would look like netcode.

**AS9. Four downstream readers follow the generalisation.**

- `pointOutsideBounds` (projectile death in `combat.ts`, beam clipping in `weapons/instances.ts`)
  becomes "outside any plane". Its inclusive-on-the-edge convention is preserved exactly — that
  convention is load-bearing and was the fix for a shot surviving where a beam already stopped.
- `wallClipDistance` needs no change beyond the above; it walks points and asks that predicate.
- `bounceOffWorld` reflects about the violated plane's normal instead of mirroring per axis. For an
  axis-aligned plane the two are identical, so `arena-02` is bit-identical.
- `hullTouchesWorld` tests the hull's corners against every plane rather than the four rect edges.

**AS10. `Obstacle` gains an optional `kind`.** Today it is a bare AABB. `kind: "spike"` marks the
notch strips; absent means an ordinary solid, so `ARENA_02`'s six rects and every existing test
fixture are unchanged. The field is authored data, not a runtime flag.

**AS11. The fourteen notch strips are ordinary obstacles.** They block exactly the way level geometry
already blocks — cars resolve against them, projectiles die on them, beams clip on them, bouncing
projectiles reflect off them, the bot avoids them. Nothing new is needed for any of that. Their
`kind` matters only to the hazard pass (Part 3).

One consequence worth naming rather than discovering: **shots skimming a wall now die on the spike
strips.** A projectile fired along a wall used to travel until it left the arena; it now expires
against the first strip it clips. That is correct — the spikes are solid — but it changes how a
weapon behaves in the outer lane, and it is the kind of thing a player reports as "my shot vanished".

Depth is 20 world units on every wall: `y ∈ [54, 74]` on top, `y ∈ [646, 666]` on the bottom,
`x ∈ [74, 94]` on the left, `x ∈ [1186, 1206]` on the right. Their spans along each wall:

| wall | spans (world) |
|---|---|
| Top and bottom (x) | `129–310`, `452–565`, `715–828`, `970–1151` |
| Left and right (y) | `105–200`, `305–415`, `520–615` |

Each set is symmetric about the arena's centre line — top about `x = 640`, side about `y = 360` —
matching the art, which was drawn symmetric for exactly this reason. A test asserts that symmetry so
a later art revision cannot quietly break it (AS29).

**AS12. The playable region is non-convex once the strips are counted, and that is the whole reason
the strips are obstacles rather than more planes.** Half-planes describe convex regions only.
Splitting the shape — a convex octagon for the *boundary*, fourteen rectangles for the notches — is
what keeps the boundary a clamp (AS7) while still letting the region a car may occupy have inward
notches.

**AS13. `arena.test.ts`'s obstacle-clearance rule has to be reworded, not deleted.** It currently
requires every obstacle to sit at least one car diagonal clear of the arena boundary, because
`resolveWorld` ranks bounds above obstacles and a car squeezed between the two has nowhere to be
pushed. Wall-mounted geometry touches the boundary by definition. The rule becomes: an obstacle
**without** a `kind` keeps the full clearance requirement; a `kind: "spike"` obstacle must instead
lie **flush against** a boundary plane and protrude inward by exactly `SPIKE_CONFIG.depth`. That is
a stricter statement, not a weaker one — it says where wall geometry is allowed to be, rather than
exempting it from a rule.

The corridor rule (no gap between obstacles too narrow for a car) applies unchanged, and holds: the
narrowest opposing pair is 1132 − 40 units apart.

---

## Part 3 — The spike hazard

**AS14. Spikes deal a flat 80 damage.** Against hull HP of 650 (Bullseye), 700 (Mirage) and 900
(Bastion), that is 12.3% / 11.4% / 8.9% — **nine** touches to kill the lightest chassis, twelve to
kill the heaviest. It sits between a Thumper shell (60) and a Roadblock (100), so it reads as "a
solid hit" without being a weapon-class threat.

Flat, not speed-scaled. Speed scaling was considered and rejected: it makes the hazard's cost
unpredictable at the moment a player commits to a line, and the readable rule — *touching spikes
costs you a Thumper* — is worth more than the simulation fidelity.

**AS15. The trigger is a fresh push into the surface, not mere contact.** Because the boundary stops
a car at the notch face, "in contact with spikes" is a state a car can hold indefinitely; someone who
drove into a wall and stopped is touching them. Damage fires when, on a tick where the hull overlaps
a `kind: "spike"` obstacle, the car's speed **into** that surface exceeds
`SPIKE_CONFIG.triggerSpeed`.

Say the sign convention once, because getting it backwards makes the hazard fire on cars driving
*away*: with `n` the surface's inward-facing normal — the same vector the push is applied along —
the speed into the surface is `-dot(v, n)`, and it is positive when the car is closing. `v` is
sampled **before** resolution, so a car being shoved still registers even though the bounce is about
to zero it.

The consequence, stated plainly because it is the design: a car resting against spikes is safe; a
car driving into them, scraping along them, reversing into them, or being held in them under
pressure keeps paying.

**AS16. A lockout bounds the rate.** After a hit, that car is immune for `SPIKE_CONFIG.retriggerMs`,
starting at **750 ms** — about 107 HP/s while pinned, so roughly six seconds of sustained pressure
kills a Bullseye. Without it a shoved car takes 80 per tick, thirty times a second. The number is a
tuning knob and is expected to move after playtest; it is stated here so the first implementation is
not silently lethal.

**AS17. The trigger state is server-side memory, not schema state.** It rides alongside
`ContactMemory` in `packages/server/src/sim/`, the same call the ram falloff stack already made.
This is not an invariant-8 violation: `stepSim` never reads it, and what crosses the wire is the
already-applied HP.

**AS18. `SPIKE_CONFIG` lives in shared config.** Starting values, every one of them a knob:

```
damage: 80          depth: 20            triggerSpeed: 25
retriggerMs: 750    shoverCreditMs: 4000  contactPad: 2
```

`triggerSpeed` of 25 units/s against roster top speeds of 190–267 is deliberately low: it is the
line between "resting" and "moving into", not a difficulty dial. `contactPad` matches the scale of
`RAM_CONFIG.contactPad` and `SLAM_CONFIG.wallContactPad` rather than inventing a new one. No magic
numbers in logic (invariant 2), and the playground's tuning walker picks the table up for free.

**AS19. Three stages, and the middle one is the bridge.** Say the split precisely, because the
credited source cannot be computed where the contact is detected:

1. **`resolveContacts` (shared) detects and reports.** A `spikeHits` list in `ContactEvents`, one
   entry per victim, carrying the session id and the contact geometry. It knows nothing about who
   shoved anyone.
2. **`ram-bridge.ts` (server) attaches the source.** It is the only place that holds `ContactMemory`,
   the trigger lockout (AS17) and the last-shover window (AS21), all of which are server-side state.
   It drops hits still inside their lockout and stamps `sourceSessionId` on the survivors.
3. **`runCombat` prices and applies**, taking the enriched list as its own input beside
   `contactHits`, and putting the damage through the same path every other damage source uses.

It does **not** ride the existing `contactHits` seam: a `ContactHit` carries a `weaponId` and is
priced from the weapon table, and a spike is not a weapon.

The pipeline order already supports this exactly — `contactTick` runs before `combatTick` and
already hands `contactHits` and `statusRequests` forward the same way.

Routing it through combat rather than the bridge is what buys death detection, the `damaged` and
`died` events the FX layer already listens for, and the single kill-booking line — all of it,
unchanged.

**AS20. This does not make ramming damage cars.** A ram still applies knockback and `reeling` and
zero HP. What changes is that shoving someone into level geometry now has a consequence, which is a
different statement and stays inside the collision-damage guard rail: cars still never damage each
other by contact.

**AS21. Kill credit goes to the shover, if there was one.** A per-victim **last-shover** memory with
a window of `SPIKE_CONFIG.shoverCreditMs` (4 s), hung on the ram bridge's existing per-victim
attacker tracking. Any push counts — an ordinary ram or a slam. Spike damage names that car as the
source. If the window is dead, it names **the victim's own session id**.

That last detail is the whole mechanism, and it needs no new code in `combat.ts`: damage application
writes `lastDamagerSessionId` whenever the source is non-empty, and the one line that books a kill
already reads `if (killer && killer !== player)`. A victim credited to themselves therefore records
the death, moves no kill counter, and shows in the banner as self-inflicted. An empty source id
would have been wrong — it leaves `lastDamagerSessionId` untouched, so a car shot once early in the
match and killed by spikes minutes later would still credit that shooter.

**AS22. Two interactions, settled explicitly.**

- **Spike damage is not amplified by `corroded`** or any other damage multiplier. Environmental
  damage is flat and predictable; a status that makes the walls hurt more is a mechanic nobody asked
  for.
- **A `phased` car takes no spike damage, and this must be coded explicitly.** It does *not* fall
  out of the `isOnField` / `isSolid` split, and the tempting assumption that it does is wrong:
  `isSolid` gates only the car-car lists, while `stepSim` passes `ctx.obstacles` and `ctx.bounds`
  into `resolveWorld` unconditionally. A phased car therefore still collides with level geometry —
  it has to, or spawn protection would let it drive out of the arena — and would take spike damage
  unless the hazard pass skips it. Letting the walls hurt a spawn-protected car would break exactly
  the guarantee `phased` exists to give.

---

## Part 4 — Rendering

**AS23. The floor becomes an `Image`, not a `TileSprite`.** `drawArena` builds a
`tileSprite(0, 0, arena.width, arena.height, FX_TEXTURE_KEYS.asphalt)` today. A new
`arenaFloorKey(arenaId)` in `assets/asset-keys.ts` — the same shape as `carSpriteKey`, building
`arena.<id>.floor` — resolves through the identical chain: manifest lookup, then texture, then
fallback. When the row exists **and its texture loaded**, the tile sprite is replaced by an image
drawn at the world rect. When it does not — a missing PNG, a malformed manifest row, a texture that
failed — the generated asphalt stays exactly as it is. The procedural fallback is the property the
asset pipeline exists to protect and this spec does not weaken it.

**AS24. A sprite arena draws no procedural decoration.** The painted lane markings and centre circle
from `ENVIRONMENT_FX.markings`, and the border stroke from `arenaBorderRect`, are all suppressed when
a floor sprite is in use — the art carries its own markings and its own walls, and drawing a 4px
slate rectangle over a painted steel wall looks like a bug. `ENVIRONMENT_FX.floor.*` (the asphalt
generator's knobs) become inert for that arena, which the playground's environment panel should say
rather than silently doing nothing.

**AS25. The notch strips are not drawn.** They are painted in the art. `redrawArenaGraphics` fills
`arena.obstacles` with the palette's obstacle colour; obstacles carrying a `kind` are skipped, or
fourteen grey rectangles land on top of fourteen sets of painted spikes.

**AS26. Spike contact gets feedback.** A spark burst at the contact point and a small camera shake,
through the FX event path that `damaged` already drives. The shake sits at or below a ram's, per the
ordering `fx/camera.ts` documents and defends: nothing environmental should out-shake a kill.

---

## Part 5 — Spawns and the bot

**AS27. Every spawn on `arena-01` moves.** All six FFA spawns and both team lines currently sit
inside what is now the wall band. The replacements keep the shape the original tables were built
around — corner cars facing across the arena, midpoint cars facing each other, team lines dividing
the height into four equal parts — measured against the new playable rect:

```
ffaSpawns    (200, 150) (1080, 150) (200, 570) (1080, 570) (640, 150) (640, 570)
teamASpawns  (200, 207) (200, 360) (200, 513)
teamBSpawns  (1080, 207) (1080, 360) (1080, 513)
```

Angles carry over unchanged from the present tables — the geometry moved, the facing rule did not.
Every spawn clears the nearest notch strip by more than a car diagonal (57.7 units), and the set is
symmetric to the unit, which is the property `ARENA_01`'s comments call out as deliberate.

**AS28. The bot needs the polygon, or easy bots will grind themselves to death.** `movement.ts`
steers off `arena.width`/`height` plus a margin and loops `arena.obstacles`. Left alone, a bot would
treat the octagon's chamfers as open space and would have no reason to prefer a bare wall over a
spiked one. It gets the boundary planes for its wall-avoidance margin, and a stronger repulsion from
`kind: "spike"` obstacles than from ordinary geometry. Tier profiles are untouched — this is
perception, not difficulty — but `BOT_BRAIN_VERSION` is bumped, since behaviour changes without
`BOT_PROFILES` moving.

---

## Testing

**AS29.** TDD throughout; the arena numbers are data, so most of this is table assertions.

- **Half-plane resolution**: a car pushed into each of the eight planes ends inside, at the right
  distance, with the bounce applied about that plane's normal; a rectangle-only arena produces
  results identical to today's (the regression that protects `arena-02` and every existing fixture).
- **Boundary consumers**: a projectile crossing a chamfer dies at the chamfer; a beam clips there; a
  bouncing projectile reflects about the diagonal.
- **Arena data**: the octagon is convex and inside the world rect; every notch strip is flush to a
  plane and exactly `SPIKE_CONFIG.depth` deep; the strip spans are symmetric about both centre
  lines; every spawn is inside the polygon and clear of every strip.
- **Hazard trigger**: contact below `triggerSpeed` deals nothing; above it deals exactly 80; a second
  hit inside `retriggerMs` deals nothing; one after it deals 80 again; a car resting in contact with
  zero inward velocity is never damaged.
- **Attribution**: a car shoved into spikes and killed credits the shover; the same car killed after
  the window credits nobody and books a death; a car that drove in on its own credits nobody even
  when it was shot earlier in the match.
- **`corroded` does not amplify spike damage; a `phased` car takes none** — the latter asserted
  against a car that is genuinely overlapping a strip, since it still collides with one (AS22).
- **Projectiles die on a spike strip**, where before they flew on to the arena edge.
- **Golden**: `golden.test.ts` pins drive integration against a frozen fixture. Check whether its
  fixture resolves `arena-01`'s bounds; if it does, it is re-pinned in the same commit with the
  reason stated.

---

## What this does not touch

`stepSim`'s tick order · the drive model, `DRIVE_CONFIG`, or any car rating · the OBB hitbox model ·
`WEAPON_TABLE`, `CAR_TABLE`, `STATUS_TABLE`, `RAM_CONFIG` · friendly-fire · car-vs-car collision
damage (AS20) · the schema, the patch rate, or prediction's structure · `arena-02` · the practice and
playground rooms, which inherit everything through the shared arena def.

---

## Docs to update in the implementing commit

- `CLAUDE.md` — the arena is no longer "one open rectangle"; note the polygon boundary, the spike
  hazard as the first environmental damage source, and that `arena.arena-01.floor` is the first live
  arena art key.
- `docs/config-reference.md` — `SPIKE_CONFIG`, `ArenaDef.boundary`, `Obstacle.kind`.
- `docs/combat-model.md` — spike damage, its trigger, and its attribution rule, beside elimination.
- `docs/schema-reference.md` — unchanged, and say so: nothing here is a schema field (AS17).
- `docs/asset-pipeline.md` and `packages/client/public/art/arenas/README.md` — the latter currently
  reads "Nothing lives here yet."
- `npm run build:manual` — the guide's fingerprint covers `ARENA_WIDTH`; the playable area changing
  is exactly the kind of number it exists to keep honest.

---

## Playtest and balance obligations

**AS30. The probes measure a rectangle.** `packages/server/playtest/` drives the real tick pipeline
and reports on collision depth, wall contact and prediction error against `arena-01`'s bounds —
`collision.ts`, `geometry.ts`, `world.ts` and `prediction.ts` all resolve the arena. A polygon
boundary, a 25% smaller field and a new damage source move things every one of them watches. The
implementing session **names each affected probe and recommends a run**; it fixes a probe that no
longer compiles, and updates a stale expectation only if asked.

**AS31. A balance run is owed after implementation, not before.** The field shrinks a quarter and a
new damage source lands, so win rates and matchup numbers from before this change are not comparable
to after. `BOT_BRAIN_VERSION` moves too (AS28), which the harness's own `--baseline` guard will
refuse to compare across — correctly.

---

## Non-goals

A second arena using this machinery · hazards that do anything but damage · destructible or moving
geometry · per-arena hazard tuning · a hazard that fires on a projectile rather than a car ·
concave boundaries in the general case · animating the spikes.
