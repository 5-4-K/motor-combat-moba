# Motor Combat MOBA — Magma Blast Lava Field Design

**Designed:** 2026-09-09 · **Recorded in repo:** 2026-09-09
**Status:** Designed, not yet implemented.
**Builds on:** [`2026-09-02-predator-magmablast-mechanics-design.md`](2026-09-02-predator-magmablast-mechanics-design.md),
whose explosion mechanism (**P13–P27**) this extends and one of whose clauses (**P19**) it
supersedes; [`2026-09-07-gritty-visual-fx-design.md`](2026-09-07-gritty-visual-fx-design.md), whose
fx layer, depth ladder and procedural textures (**VFX1–VFX36**) the visual half is built on; and
[`2026-09-08-playground-environment-vfx-design.md`](2026-09-08-playground-environment-vfx-design.md),
whose `ENVIRONMENT_FX` table and panel (**EV1–EV34**) gain a section here. Decisions are numbered
**LZ1–LZ38**, with lettered sub-clauses where a decision needed a consequence recorded beside it.

---

## Problem

Magma Blast detonates into a 60-unit disc that exists for five ticks. `ExplosionDef` names that
window "mostly for the eye" (P19), and in practice it is entirely for the eye: 150 ms is 40 units of
travel at Mirage's top speed — less than one car length — so the only cars a burst catches are the
ones already standing where the shell landed. The field is a damage number attached to an impact, not a place.

The weapon reads as a fireball, and the arena it lands on shows nothing afterwards — since the
2026-09-08 fx pass set `decals.maxScorch` to `0`, not even a scorch mark. There is a gap between
what the weapon is called and what it does to the ground.

Three changes close it, and they are one change because they share one piece of renderer
infrastructure:

1. The shell should glow rather than read as a flat orange disc.
2. The burst should **stay** — a lava field that hurts whoever drives into it, once per entry.
3. That field should look like ground, not like a ring.

**LZ1.** `ExplosionDef`'s own doc comment reserves the second of these: *"There is deliberately no
damage-frequency knob. A burst hits each car once, ever; a repeating explosion is a different
feature and should be argued for on its own terms rather than arriving as a field nobody chose a
value for."* This spec is that argument. The answer it reaches is **not** a frequency knob — see
LZ4.

---

## Scope

**In:** a `damageMode` field on `ExplosionDef`, an `explosionDamageModeOf` accessor, and a third
damage-clock mode in `resolveInstanceHits`; `magmablast.explosion.lingerMs` 150 → 2000; an additive
`glowGfx` in `ArenaScene`; a `halo` block on `GlowStyle`; a procedural cracked-crust texture pair in
`fx/textures.ts`; a pooled per-instance ground stamp in `fx/layer.ts` and two widened
`FxInstanceView` fields; a `lava` section in `ENVIRONMENT_FX` and its rows in `ENV_FIELDS`; two new
rungs on the depth ladder.

**Out:** any other weapon's row; `canDamage` and the friendly-fire rules; the bot's situation
vocabulary; `magmablast.cooldownMs`; any change to how a burst is *spawned* (P13–P15 and P22–P27
stand unaltered); `VolleyDef`; any new schema field; any change to `sim/drive.ts`, `sim/ram.ts` or
`sim/contact.ts`; new playtest probes.

**LZ2.** **Hard invariant 8 is not engaged.** The per-entry bookkeeping rides on
`WeaponInstance.damageClock`, which is server-only by construction — `instances.ts:62` says so, and
`WeaponInstanceState` carries no counterpart. What crosses the wire is the already-resolved hp
change, exactly as today. No schema field is added by any part of this design.

**LZ3.** **`docs/turn-tuning.md` is untouched.** Nothing here changes a `CAR_TABLE` rating, a
`DRIVE_CONFIG` knob, `RAM_CONFIG.spinMaxRate`, `TICK_RATE_HZ`, or any `STATUS_TABLE` row's
`turnRate`. `scripts/turn-tuning-doc.test.mjs` has nothing to recompute.

---

## Part 1 — The lingering field

### The damage rule

**LZ4.** The rule is **once per entry**, not once per interval. A car that drives in and parks takes
the field's damage exactly once no matter how long it stays; a car that leaves and returns takes it
again. This is deliberately *not* the `damageFrequencyMs` knob LZ1 quotes: a frequency turns a field
into a damage-over-time tick that punishes standing still, where an entry rule punishes crossing.
The field is area denial, and the counterplay is "go around", which only a per-entry rule teaches.

**LZ5.** `ExplosionDef` gains **`damageMode: "onceEver" | "perEntry"`**, **required**. Required
rather than optional-with-a-default, for the reason `BeamWeaponDef.origin` is required: an explosion
that inherits a damage rule nobody chose is precisely the silent mistake LZ1's comment was written
to prevent. `magmablast` is the only row in `WEAPON_TABLE` carrying an `explosion`, so the cost of
requiring it is one line today and one line per future explosion.

**LZ6.** `"onceEver"` is today's behaviour, bit for bit, and stays the sensible answer for a burst
short enough that re-entry is not physically possible. Nothing about this design deprecates it.

**LZ7.** The mode lives on `ExplosionDef` and not on `WeaponBase`. A fired instance is aimed and
short-lived; only a detached, lingering field has an inside to leave. Putting the field on the base
would make every projectile author answer a question that cannot apply to a shot in flight, which is
the same argument `PelletDef` and `BeamStyle` are kept separate on.

### How it resolves

**LZ8.** `resolveInstanceHits` gains a third clock mode. Today's loop body checks the clock *before*
the shape ([`hits.ts:74-81`](../../../packages/shared/src/sim/weapons/hits.ts)), which is correct
for both existing modes and wrong for this one: the whole point is to learn that a car is *outside*,
and a clock check that `continue`s never runs the test that could tell you. For a `perEntry`
instance the order inverts — the shape test runs first, and its result drives the clock:

| overlapping | has clock entry | outcome |
|---|---|---|
| yes | no | **damage**, write the entry |
| yes | yes | nothing (still inside, already paid) |
| no | yes | **delete the entry** — re-armed |
| no | no | nothing |

**LZ9.** Presence in the map is the flag; the value written is `Number.POSITIVE_INFINITY`. A finite
tick would read as "re-arm at tick N" to anything inspecting the map generically, which is exactly
what this mode does not mean.

**LZ10.** `WEAPON_TICKS[id].explosion.damageInterval` stays `POSITIVE_INFINITY` and is **unread**
for a `perEntry` instance. It is not deleted: `onceEver` still needs it, and a mode-dependent field
that vanishes is harder to reason about than one that is simply not consulted. The implementation
must not compute an interval it then ignores.

**LZ10a.** **The mode reaches the hit resolver through `weapon-config.ts`, not through the
synthesized def and not through `WEAPON_TICKS`.** `instanceDefOf` returns a `BeamWeaponDef` for a
burst, and that type has no `damageMode` — nor should it gain one, since a beam fired from a muzzle
has no inside to leave. `WeaponTicks.explosion` is the other tempting home and is also wrong: every
field in it is a duration converted to ticks, and a mode string is not a clock. Instead a small
`explosionDamageModeOf(weaponId)` in `weapon-config.ts` reads `WEAPON_TABLE[id].explosion?.damageMode`
and returns `undefined` for a weapon with no explosion; `hits.ts` calls it only when
`instance.isExplosion`, and already imports from that module. Recorded because the synthesis seam
(P24) makes this look solved when it is not.

**LZ11.** **Absence from the pose snapshot is not an exit.** `PoseSnapshot` holds living, solid cars
only, so a car that dies or goes `phased` inside a field leaves the snapshot without ever failing
the overlap test, and its entry survives. That is correct for a wreck and harmless for a Deathmatch
respawn, which happens at a spawn point rather than inside a two-second-old field. Recorded because
the alternative — treating absence as an exit — would let a phased car re-arm the field by respawning.

**LZ12.** Pierce is untouched. A burst is a beam (`instance.kind !== "projectile"`), and the loop
already skips the pierce arithmetic for anything that is not a projectile. No beam has ever been
destroyed by contact and none is now.

**LZ13.** The cost is one `shapeHitsObb` per living opponent per tick for the life of the field,
where today the clock short-circuits it after the first hit. At five opponents over sixty ticks that
is 300 disc-versus-OBB tests per field — a rounding error against the contact pass, and the price of
knowing where cars are rather than only that they were once inside.

### Statuses and damage

**LZ14.** `corroded` is applied through the unchanged path, on each damaging hit. Its row is
`reapply: "refresh"`, so a re-entry refreshes the 2000 ms rather than stacking it — which is what
"reapplied like any other effect" means and needs no code. Standing in a field for its whole life is
one instance of damage and one corrode; leaving and returning is two of each, the second refreshing
the first.

**LZ15.** **No self-damage, unchanged (P18).** `canDamage` refuses the owner, so a driver may cross
their own field freely. That is a real design position now that a field lasts two seconds rather
than five ticks — it makes Magma Blast a pure zoning tool with no risk to its user — and it is taken
knowingly, because the alternative reverses a predicate every weapon in the game shares in order to
change one row. If it proves wrong, the fix is a `selfDamages` flag on `ExplosionDef`, not an edit
to `canDamage`.

**LZ16.** The direct victim is still inside the burst it triggered (P16): 50 contact + 15 field =
65 and corroded, on the spawn tick. Unchanged, and now followed by a clock entry that re-arms if
they get clear.

### Numbers

**LZ17.** `lingerMs: 150 → 2000`. This **supersedes P19**, whose "mostly for the eye" reasoning no
longer describes what the field is for.

**LZ18.** `explosion.damage` stays **15** and `explosion.radius` stays **60**. The mechanic is the
change; re-pricing it in the same pass would make it impossible to tell which of the two moved the
numbers.

**LZ19.** **`cooldownMs` stays 1600, knowingly, and this is the thing to measure.** A 2000 ms field
on a 1600 ms cooldown means one shooter can hold a field on the ground permanently, and two of their
fields coexist for 400 ms of every cycle. A car standing in that overlap takes 15 from each — two
instances, two clocks, correct by construction. The user has chosen to ship the mechanic at the
current cadence and tune from measurement rather than from prediction. Whoever reads the first
balance report should read LZ-C first.

---

## Part 2 — The shell's glow

**LZ20.** A new **`glowGfx`**: one `Phaser.GameObjects.Graphics` with `ADD` blending set **once at
construction**, cleared and refilled each frame beside `shotGfx`. Every *vector* glow draws into
it — the shell halos of LZ22 and the field ring of LZ34.

This is the design's load-bearing choice. `combat-visual.ts:266` warns by name against a
per-instance `setBlendMode`, and a convincing glow wants additive blending; one shared layer is the
only way to have both. What that comment forbids is setting a blend mode *inside the per-instance
draw loop*, once per shot per frame. A pooled display object that sets `ADD` once at construction
and is then reused for the life of the scene does not engage it — which is what lets the field's
seam stamps (LZ33) be additive too without becoming a second violation.

**LZ20a.** **The field's seams are therefore NOT drawn into `glowGfx`.** They are textured `Image`s,
and a `Graphics` fills vectors — the two cannot share an object however alike their blend modes are.
So there are two additive surfaces at `GLOW_DEPTH`: `glowGfx` in `ArenaScene`, and the pooled seam
stamps in `fx/layer.ts`. Recorded because the tidier-sounding "one glow layer for everything" is
unbuildable and would be discovered only halfway through the work.

**LZ21.** **`GLOW_DEPTH = -4`**: above `SHOT_DEPTH` (-5), below `CAR_DEPTH` (0). Above the shots
because additive light belongs over the thing emitting it and, being additive, it cannot occlude the
core it washes over. Below the cars because a glow that washed over a chassis would take colour off
the player paint and light off the hp bars, and VFX24's rule — information draws over atmosphere —
is not up for renegotiation by a prettier fireball.

**LZ22.** `GlowStyle` gains **`halo?: readonly HaloBand[]`** — bands with `radiusScale > 1` and
their own `alpha`, drawn into the glow layer, outermost first. Absent draws no halo, which is every
weapon but one.

**LZ23.** **This is a documented D19 exception and it is bounded three ways.** D19 says a shot is
drawn *as* the thing that can hit you, and a halo extends past the hitbox. It is allowed because:
the halo is additive-only, so it adds light and never a silhouette; it carries no opaque area, so
there is no edge to mistake for a boundary; and the outermost **solid** band stays pinned at
`radiusScale: 1`, so the crisp readable edge is still exactly the hitbox. A halo may never violate
any of the three. This is the same shape of exception the burst already takes — the aura's
ring-plus-wash bends D19 so a 60-unit disc does not hide the cars it is about to hit — bent to serve
the rule's own purpose rather than abandoned.

**LZ24.** `magmablast` gets a halo of three or four bands running out to roughly **2.5× the hitbox
radius** (30 units), continuing the existing ramp outward from `#FF6000` and falling to zero alpha
at the outer edge. The three existing bands warm up, the `#FFA800` core moving toward white-hot.
These are starting values to be tuned in the playground, not measurements.

**LZ25.** **No flicker anywhere**, per the user's call. `flickerDepth: 0` and `flickerHz: 0` stay as
they are, and the halo authors no rate of its own. The existing row's reasoning holds — a pulsing
outline on a 12-unit disc reads as a rendering fault rather than as fire — and a static halo also
costs no per-frame hash.

**LZ26.** The cost is four `fillCircle` calls per live shell plus one extra draw batch per frame.
Magma Blast fires once per 1600 ms per car, so the ceiling is a handful of live shells. This sits
well inside the budget `combat-visual.ts:266` sets out, and it spends none of the three things that
comment forbids: no per-instance blend change, no faked gradient wanting twenty bands, no `Graphics`
per shot.

**LZ27.** **The shell casts no light on the floor.** It was considered — the reference art shows
ground lit by what is above it — and cut: it needs a second stamp per shell per frame at ground
depth, for an effect visible only while a shot is in flight past a dark patch. The field below does
the ground-lighting job, and does it where it matters.

---

## Part 3 — The lava field

**LZ28.** **`crackedCrustTexture(seed, size, env)` in `fx/textures.ts`**, generated once at boot
alongside the existing asphalt and scorch textures, returning **two** `TexturePixels`: a **crust**
(dark polygonal plates, drawn normally) and a **seam** (the hot cracks between them, drawn
additively). Two textures rather than one because they need different blend modes, and generating
them in one pass is what keeps the seams registered to the plates they divide.

**LZ29.** The plates come from **cellular (Worley) noise** — a new primitive beside `fbm` and
`tileableFbm`. Distance to the nearest cell boundary drives seam heat: near a boundary it is bright,
falling off into the cell interior. That is the structure every one of the reference images has, and
`fbm` cannot produce it — fractal noise gives clouds, not plates.

**LZ30.** **It does not need to tile.** `asphaltTexture` is a `tileSprite` repeated across the arena
and pays for a closed lattice (EV15, and the seam bug that motivated it); a field is a single
stamped disc, so the whole tiling apparatus is irrelevant here. Recorded so nobody ports the
requirement across on the assumption that all generated textures carry it.

**LZ31.** **Two or three seed variants**, plus a per-instance rotation, both chosen deterministically
from `WeaponInstanceState.spawnTick` — a networked field, so every client draws the same field and
no frame reshuffles it. Consecutive fields from the same shooter must not stamp identically.

**LZ32.** **`LAVA_DEPTH = -7`**: above `DECAL_DEPTH` (-8), below `GROUND_FX_DEPTH` (-6). Cars drive
visibly over it, rubber and scorch sit under it, ground sparks throw over it.

**LZ33.** Per live burst instance, two pooled `Image`s: the crust at `LAVA_DEPTH`, the seams at
`GLOW_DEPTH` from LZ20, both scaled to the 60-unit radius. The seams pulse by lerping alpha and tint
off the wall clock — **the texture is never regenerated**, at any point, for any reason.

**LZ34.** **Crust alpha holds near full to about 0.9r and falls to zero at exactly r**, so the field
has no cookie-cut circular edge. The **ring survives**, per the user's call, moved into the glow
layer so it reads as the same fire as the seams rather than as a flat outline. The ring is what
states the damage boundary, and with the crust feathered it is the only thing that does — which is
the argument for keeping it.

**LZ35.** The field fades on `beamFadeAlpha`, the same clock the ring already uses, so crust, seams
and ring die together.

**LZ36.** **The crust and seam stamps live in `fx/layer.ts`, driven by `FxWorldView.instances`** —
not in `ArenaScene.renderShots`. `renderShots` clears and refills one shared `Graphics` and owns no
pooled objects at all; `fx/layer.ts` already owns pooled Phaser objects, the depth ladder, the
generated textures and the `EnvResolver` the `lava` section needs. Every one of those is a
dependency of this stamp, and none of them is in the scene method.

**LZ36a.** `FxInstanceView` therefore gains **`isExplosion`** and **`extent`**. It carries `id`,
`weaponId`, pose and `alive` today, which is enough to tell that an instance exists and not enough
to tell that it is a 60-unit field rather than a 12-unit shell. Both are already on
`WeaponInstanceState`, so this is a widening of the view, not a new wire field (LZ2 stands).

**LZ36b.** Stamps are pooled by `id`, created on first sight, and retired when the instance goes
**`alive: false`** — *not* when its id leaves the map. `deriveFxEvents` documents why: the server
flips `alive` on the tick a shot ends and deletes the row on a later one, so keying off deletion
draws a dead field for an extra tick and fires its retirement late. This is the same trap
`shotEnded` was written around.

**LZ36c.** **The ring stays in `renderShots`**, in `glowGfx`, while the crust and seams sit in the
fx layer. The split is not arbitrary: the ring is a *hitbox statement* and belongs with the D19
logic that draws every other instance as the thing that can hit you, while the crust is atmosphere
and belongs with the smoke and the decals. It is the same line the codebase already draws between
`combat-visual.ts` and `fx/`.

**LZ37.** **`ENVIRONMENT_FX` gains a `lava` section**: crust and seam colours, pulse rate and depth,
alphas, ring width, cell count and octaves, feather radius. `ENV_FIELDS` gains a row for each — the
reachability test in `env-tuning.test.ts` holds the two lists to each other in both directions, so a
knob added to the table without a panel row fails the suite rather than silently not appearing.

**LZ38.** The cell count and octaves are **Regenerate-button** knobs, like `floor.*` (EV27): they
are baked into the texture. Every other lava knob — colours, alphas, pulse, ring width — is live.
The panel must say which is which, as it already does for the floor.

---

## Testing

- `hits.test.ts`: the LZ8 table, all four rows. In-stay-out-in yields exactly two damages;
  in-and-stay yields exactly one; an `onceEver` instance is unchanged by any of it.
- `hits.test.ts`: LZ11 — a car removed from the snapshot mid-field and returned is **not** re-armed.
- `weapon-config.test.ts`: `damageMode` present on every `ExplosionDef` (LZ5); `explosionDamageModeOf`
  returns the row's mode and `undefined` for a weapon with no explosion (LZ10a). The existing
  `toMatchObject({ radius: 60, damage: 15, lingerMs: 150 })` case moves with the row.
- `weapon-ticks.test.ts`: `explosion.lifetime === msToTicks(2000)`.
- `combat-visual.test.ts`: a halo band never exceeds zero opacity as a solid fill; the outermost
  solid band stays at `radiusScale: 1` (LZ23); a weapon with no `halo` draws none.
- `textures.test.ts`: crust alpha is zero outside the radius and non-trivial inside it; the seam
  texture has meaningful coverage and is registered to the crust's plates.
- `depths.test.ts`: `LAVA_DEPTH` and `GLOW_DEPTH` in the ordering it already holds.
- `events.test.ts`: the two widened `FxInstanceView` fields survive a round trip, and a burst going
  `alive: false` retires its stamp on that tick rather than on deletion (LZ36a, LZ36b).
- `env-tuning.test.ts`: the `lava` section reachable in both directions (LZ37) — this one is free,
  the existing test fails until the rows exist.
- `golden.test.ts` is untouched: nothing here reaches `stepDrive`.

---

## What this owes elsewhere

**LZ-A.** **`npm run build:manual`, and commit the page.** `WEAPON_TABLE.magmablast` moves, so
`balanceStamp` moves and `scripts/manual-page.test.mjs` fails until the guide is rebuilt. Check
`scripts/cars-and-weapons-copy.mjs` for prose describing the burst as brief — a sentence claiming a
momentary flash would be exactly the kind of rot `manual-facts.mjs` exists to prevent and cannot
catch on its own.

**LZ-B.** **Three playtest probes touch `magmablast` and one of them measures the burst.**
`playtest/weapons.ts:490` (W9, the burst through a wall), `playtest/geometry.ts:287` (wall leak,
which special-cases the disc by design) and `playtest/weapons2.ts:152`. A field that lives 13× longer
changes what W9 reads. **Per `CLAUDE.md`: name the probe, name the number, recommend
`npm run playtest` — do not run it and do not update the probes unless asked.** A probe that stops
compiling is the one thing to fix on the spot.

**LZ-C.** **The bot has no concept of a hazard zone.** `perceive`/`assess` know poses, HP, reach and
big-gun fires; nothing in the five-layer brain sees a field on the ground, so a bot will drive
through fields it should go around. Every `npm run balance` run after this lands therefore
**overstates Magma Blast**, and reading a win-rate move as a balance fact rather than a bot-blindness
artefact is the mistake to avoid. Teaching the brain to see fields is its own piece of work and is
explicitly out of scope. The config fingerprint moves with the table, so the harness will already
refuse to compare across the change.

**LZ-D.** Two sections of `docs/combat-model.md` describe the burst as an instantaneous field and
need the new rule: **Pierce and per-target damage clocks**, which enumerates the clock modes, and
**Auras**, which is where the magmablast disc is documented. `ExplosionDef`'s doc comment currently **promises this
feature does not exist** and must be rewritten — leaving it would be worse than never having written
it.

**LZ-E.** `CLAUDE.md`'s aura paragraph describes the magmablast disc; it gains the field.

---

## Considered and rejected

**A `damageFrequencyMs` on `ExplosionDef`.** The obvious reading of LZ1's reserved knob, and the
wrong mechanic: damage-over-time punishes the car that is stuck, where the design wants to punish
the car that chose to cross. See LZ4.

**Making the field damage its owner.** Would give the weapon real risk and is genuinely tempting at
a 2000 ms linger. Rejected because it reverses `canDamage`, a predicate shared by every weapon, to
change one row. LZ15 records the flag that would do it properly if the need is real.

**The shell lighting the floor beneath it.** LZ27.

**A per-arena lava palette.** Same answer EV3 gives for every environment value: one table, one look,
until someone asks for variation.

**Raising `cooldownMs` alongside the linger.** Proposed and declined by the user in favour of
measuring first. LZ19.
