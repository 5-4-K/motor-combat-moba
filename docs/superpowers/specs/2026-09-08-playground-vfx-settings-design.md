# Motor Combat MOBA — Playground VFX Settings Design

**Designed:** 2026-09-08 · **Recorded in repo:** 2026-09-08
**Status:** Designed, not yet implemented.
**Builds on:** [`2026-09-01-playtest-playground-design.md`](2026-09-01-playtest-playground-design.md)
and [`2026-09-02-playground-usability-and-bot-difficulty-design.md`](2026-09-02-playground-usability-and-bot-difficulty-design.md),
whose overlay, storage codec and settings panel this extends (**PG1–PG40**); decisions here continue
that sequence at **PG41–PG55**. It also extends
[`2026-09-07-gritty-visual-fx-design.md`](2026-09-07-gritty-visual-fx-design.md), whose `WEAPON_FX`
table (**VFX30**) is the thing being tuned; no decision there is reversed.

---

## Problem

`WEAPON_FX` in `packages/client/src/fx/table.ts` is the most tunable surface in the fx layer —
nine fields per burst, and by VFX30 it is deliberately client-side, outside `balanceStamp`, so
editing it owes no manual rebuild, no stamp update, no doc change. It is the one part of the game's
look that costs nothing to change.

Reaching it still costs the full loop: edit the file, rebuild, reload the browser, get back into a
match, fire the weapon. That is four steps between a number and the thing it does, which is why
**six of the ten weapon ids have no authored row at all** — `pepperbox`, `thunderclap`,
`afterburner`, `roadblock`, `wildcharge` and `tremor` all render `DEFAULT_WEAPON_FX`, so Mirage's
dash and Bastion's charge currently look like generic gunfire.

The playground already solves this shape of problem for balance numbers, with a settings panel of
live sliders over `tunableFields()`. It has no equivalent for how anything looks.

Two smaller problems come with it. The panel is called **Settings** while tuning nothing but
physics, which leaves no room for a second kind of settings. And the overlay is visible **only
while paused** (`effectiveView()` returns `"hidden"` unless `room.state.paused`), which physics
tolerates — you tune, resume, and feel the difference — but which fx does not: a `lifeMs` slider
dragged against a frozen screen shows nothing at all.

---

## Scope

**In:** renaming the existing settings panel to Physics settings; a second panel, VFX settings,
tuning every field of `WEAPON_FX` for all ten weapons; a sparse client-side override store read
only by a playground room; an in-panel preview that replays the burst being edited; a Copy
overrides button that emits a pasteable `table.ts` fragment; persistence in the existing playground
localStorage blob.

**Out:** anything in `sim/`; any shared table; any wire contract or schema field; the camera grade,
vignette, shake, hit-stop, decal and occlusion constants (`fx/camera.ts`, `fx/decals.ts`,
`fx/depths.ts`, `fx/occlusion.ts`, `fx/textures.ts`); the `deathBursts`/`damageBursts` literals in
`fx/emitters.ts`; adding, removing or reordering bursts; two bursts on one channel in one phase;
any reach outside the playground room; `?dev=fx`'s own toggles; new playtest probes.

Nothing here moves `balanceStamp`, so `npm run build:manual` is not owed. Nothing here changes a
turn stat, so `docs/turn-tuning.md` is untouched. No probe in `packages/server/playtest/` measures
particle counts or lifetimes. Nothing crosses the wire, so no schema field is added and hard
invariant 8 is not engaged.

---

## The two panels

### PG41. `Settings` becomes `Physics settings`, and the menu gains `VFX settings`

The paused menu becomes four entries: Resume, Switch car, Physics settings, VFX settings.

`OverlayView` (`ui-model.ts`) goes from `"hidden" | "menu" | "settings"` to
`"hidden" | "menu" | "physics" | "vfx"`, and `overlay.ts`'s `subView` follows. The rename is
mechanical and confined to the playground: no shipped scene reads either name.

`pauseKeyAction` treats `"vfx"` exactly as it treats the physics panel today — P backs out to the
menu without touching pause, and a keystroke landing in a form control is still ignored. Its
current test asserts against `"settings"`; both panel keys get a case.

The panel header string becomes "Physics settings" to match its menu entry.

### PG42. A weapon's editable surface is a fixed 4-channel grid, not its burst list

Every weapon gets exactly eight rows: `muzzle` and `impact`, each crossed with `smoke`, `fire`,
`spark` and `debris`. `count: 0` means that channel is off for that phase.

This is **lossless against the shipped table**: across all 25 authored bursts, no (weapon, phase)
pair uses the same channel twice — every authored phase is at most one smoke, one fire, one spark
and one debris. So the grid can represent every row that exists today, and round-trip it.

It is chosen over mirroring the burst list because the grid needs no add/remove/reorder UI, gives
`count: 0` a natural meaning as the off switch, and hands the six unauthored weapons a full editable
surface rather than leaving them stuck with `DEFAULT_WEAPON_FX`'s two-and-two shape. The cost is
the one thing it cannot express — a second burst on one channel, for a layered look — which nothing
in the table needs today and which is called out in Risks below.

### PG43. Overrides are sparse, per-field, and keyed by a dot-path

The store is `Record<string, number | boolean>` keyed `"<weaponId>.<phase>.<channel>.<field>"`, e.g.
`"wildcharge.impact.fire.count"`. Same shape as `TuningOverrides`, for the same reason: an entry
exists only where the value differs from shipped, so the export and the resolved row both stay small
and legible.

A slider dragged back to its shipped position must **delete** its entry, not pin the shipped value.
`isAtShipped`'s existing rule applies unchanged — a number counts as shipped within half a step,
because a range input snapped to a `min`/`step` grid usually cannot land on the shipped value
exactly, and a strict comparison would leave a phantom entry in every export. Booleans keep strict
equality.

### PG44. Cone angle is edited in degrees and stored in radians

`FxBurst.coneRad` is radians, and `Math.PI * 2` is the authored value for a full sphere on 14 of the
25 bursts. A slider from 0 to 6.283 in steps of 0.098 is unreadable. The control is 0–360° in 1°
steps; the store and every consumer stay in radians, converted at the control boundary only.

The round-trip has to be exact enough that touching an unrelated field on the same row does not
rewrite `coneRad` into the overrides — 360° must resolve back to the same `TAU` the table authored.
The conversion is therefore applied on read and write of the control, never to a value passing
through untouched, which keeps an untouched field's absence from the store the thing that preserves
it.

### PG45. Unauthored weapons seed from `DEFAULT_WEAPON_FX`

`weaponFxOf` already falls back to `DEFAULT_WEAPON_FX` for a weapon with no row, so that fallback is
what the grid seeds from — the six unauthored weapons open showing what they actually render, not an
empty grid. A channel the seed row does not use opens at `count: 0` with the rest of its fields at
that channel's own defaults, so raising `count` off zero produces something plausible immediately
rather than a burst of zero-size particles.

Those defaults are a small per-channel table in the new pure module, not a fifth `WeaponFxRow`: they
are the starting position of a control, not a thing the game renders.

---

## Where an override enters the render path

### PG46. The resolver is injected, never global — which is what makes "playground only" structural

`emitterSpecsFor` and `emitterSpecsForAll` take an optional resolver, defaulting to `weaponFxOf`.
`FxLayer` takes one at construction and passes it to `emitterSpecsForAll`. `ArenaScene` builds one
**only when the room is a playground**, using a room-name check written the way `isPracticeRoom`
already is, and for the reason that function's own comment gives: a room name cannot go stale, where
a scene flag set on one screen and read on another can.

So a shipped arena or practice session constructs `FxLayer` exactly as it does now, passes no
resolver, and renders shipped `WEAPON_FX`. Overrides saved in a browser cannot follow a developer
into a LAN match — not by discipline, but because the code path that would read them is never
constructed there.

`weaponFxOf` itself is untouched. It stays the default and the fallback, and the resolver the
playground installs is a wrapper around it, so a weapon with no override still resolves through the
same function.

The override values themselves live in a small module-level store the resolver reads live, following
the precedent of `config/view-options.ts` — a client-only setting the playground writes and
`PlaygroundScene` clears on shutdown. It is read live rather than captured at construction because
the panel edits it while the `FxLayer` that will render the next burst already exists.

### PG47. `count: 0` is dropped before it reaches an emitter

A row at `count: 0` produces no `EmitterSpec` at all. It is filtered in the spec builder, not by
handing `emitParticleAt` a zero — so an off channel costs no emitter call, no texture re-resolve,
and, importantly, none of `MAX_SPECS_PER_FRAME`. Switching channels off must make the frame cheaper,
which is half of what makes the panel useful for judging readability.

---

## The panel

### PG48. One weapon at a time, four collapsible blocks per phase

A weapon `<select>` at the top lists all ten in `WEAPON_TABLE` order. Below it, two sections —
Muzzle and Impact — each holding four collapsible channel blocks.

Only the selected weapon renders. Eight rows of eight controls is already ~64 controls; ten weapons
at once would be 640, which is a scroll nobody can navigate and a DOM rebuild nobody wants on every
slider input.

Each channel block's header states its own condition when collapsed — `fire — 46 ×` or
`debris — off` — so a weapon's whole shape is legible without expanding anything.

The panel reuses `.pg-settings` styling, its sticky header, and its Back button. Per-row **Reset**
and a panel-wide **Reset all** mirror the physics panel's affordances. The physics panel's
`isLoadoutLegal` trap has no analogue here: no VFX value can be illegal, so Back is never disabled.

### PG49. Field ranges

| Field | Control | Range | Step | Notes |
|---|---|---|---|---|
| `count` | range | 0–100 | 1 | 0 is the off switch (PG47) |
| `speed` | range | 0–600 | 5 | u/s peak; each particle takes a random fraction of it |
| `lifeMs` | range | 0–4000 | 20 | |
| `size` | range | 0–120 | 1 | |
| `growPerSec` | range | −20–120 | 1 | negative is authored and correct — sparks shrink |
| `alpha` | range | 0–1 | 0.02 | |
| `coneRad` | range | 0–360° | 1° | stored in radians (PG44) |
| `soot` | checkbox | — | — | smoke only (PG50) |

Ranges are chosen to contain every shipped value with headroom, not to be a balance guard: the
largest authored `count` is 64, `speed` 420, `lifeMs` 3000, `size` 82, `growPerSec` 80. There is no
budget guard on the sliders — `MAX_SPECS_PER_FRAME` already caps a frame, and a panel that refuses
an extreme is a panel that cannot answer "is this too much".

### PG50. `soot` is smoke-only, and says so by being disabled

`FxBurst.soot` documents itself as ignored on channels other than smoke. The checkbox is therefore
rendered on all four rows for grid regularity but **disabled** on fire, spark and debris, so the
grid stays rectangular while an inert control cannot be mistaken for a live one. An override is
never written for a disabled control.

---

## Preview

### PG51. Auto-replay on a timer, plus a manual Fire

The selected weapon and phase replay every 1500 ms at a marked spot on the frozen arena, and a
**Fire** button re-triggers on demand. Expanding a single channel block narrows the replay to that
channel alone, so one row's contribution can be seen in isolation; collapsed, both phases fire
together.

This works on a paused field because a playground pause is server-side. `ArenaScene` passes
`dtMs = 0` into `fx.update` while paused, which freezes the decal clock — but Phaser's particle
emitters run on the scene's own clock, which the pause does not touch. A burst spawned while paused
animates normally.

The preview calls `FxLayer.spawn()` with specs built directly from the current grid. It does not go
through `deriveFxEvents`: there is no state delta to derive from on a frozen field, and inventing a
fake one would put a synthetic event into `lastEvents()`, which `ArenaScene` reads for camera shake.
A preview must not shake the camera.

The panel shifts off-centre and the preview spot sits opposite it, so the burst is visible while a
slider is being dragged.

### PG52. The scene reference is resolved late, never held

`PlaygroundScene.onArenaChanged` stops and relaunches the `arena` scene, and the overlay is mounted
once and outlives that. An `FxLayer` reference captured when the panel opened is therefore a
use-after-destroy waiting for an arena change.

So the overlay never holds one. `mountPlaygroundOverlay` takes a preview callback from
`PlaygroundScene`, which resolves the running arena scene at call time and asks it to spawn; the
scene no-ops when its own `FxLayer` is undefined. `PlaygroundScene` already owns that lifecycle,
which makes it the right place for the lookup.

The replay timer starts on entering the VFX view and is cleared on leaving it and on overlay
unmount. An arena change deliberately does **not** stop it: the scene is resolved at call time and
the spawn no-ops while no layer exists, so the preview simply resumes into the new arena — which is
what someone holding the panel open through an arena change wants, and stopping it would leave a
still-open panel silently dead. A timer firing into a torn-down scene is the one bug this feature is
most likely to ship; late resolution is what prevents it, and the two exits above are what stop it
replaying into a screen nobody is looking at.

---

## Output and persistence

### PG53. Copy overrides emits TypeScript, not JSON

The physics panel's Copy overrides emits `TuningOverrides` JSON because its destination is a
playground blob that `sanitizeStoredTuning` reads back. This one's destination is
`packages/client/src/fx/table.ts`, so it emits a **pasteable `WEAPON_FX` fragment**: full
`WeaponFxRow` literals, in `table.ts`'s own formatting, for every weapon whose grid differs from
shipped, with `count: 0` rows dropped and `coneRad` written back as radians (`TAU` where it is
exactly that).

A weapon that was not touched is absent from the output. Pasting the result over the corresponding
rows in `table.ts` is the whole promotion path from a tuning session to the shipped game — there is
no import side, deliberately: the store already persists, so an import button would only be a way to
load someone else's session, which nothing asks for.

The button copies through `navigator.clipboard` with the same guarded fallback the physics panel
uses.

### PG54. Persistence is a new section in the existing blob

A `vfx` section joins `setup`, `overrides` and `view` in `motor-combat.playground.v1`. `storage.ts`
already decodes section by section with per-section fallback, and its `decodeView` comment states
that more sections will follow — this is one. A blob saved before this existed decodes to an empty
override set and loses nothing beside it.

Decoding is lenient in the same way `sanitizeStoredTuning` is: an unknown key, a value of the wrong
type, or a number outside its field's range is dropped individually rather than invalidating the
section. A stale key from a renamed weapon must not cost a developer their whole tuning session.

`PlaygroundScene` loads the section into the module store on start and clears the store on shutdown,
the same lifecycle `config/view-options.ts` already follows: localStorage is the durable copy, the
module store is the live one, and a scene that is not running holds no overrides at all.

---

## Testing

### PG55. Everything that decides anything is a pure module

A new `packages/client/src/fx/tuning.ts` holds the grid model, seeding, override apply and clear,
the degree/radian conversion, the resolver factory and the export serializer — plain functions over
plain data, tested under vitest's node environment beside the rest of `fx/`. `overlay.ts` stays the
untested DOM shell it declares itself to be, exactly as PG16/PG19 require.

Covered: grid construction from an authored row and from the `DEFAULT_WEAPON_FX` fallback; the
per-channel seed defaults for an unused channel; apply and clear round-trips; `isAtShipped`
tolerance on every numeric field; degrees round-tripping to the authored `TAU`; the serializer
producing output that parses back to the same grid; `emitterSpecsFor` honouring an injected resolver;
and `count: 0` producing no spec.

One existing test changes: `ui-model.test.ts`'s `pauseKeyAction` cases move from `"settings"` to the
two new view keys.

---

## Risks

**The grid cannot express two bursts on one channel.** Nothing in the table needs it today, and the
lossless check in PG42 is what makes that safe now — but it is a check against the current table,
not a guarantee about a future one. If a weapon ever wants two fire bursts in one phase for a
layered look, it must be authored in `table.ts` by hand, and the panel will show it as one row and
silently flatten it on export. The mitigation is that the export only emits weapons the developer
actually edited, so an untouched hand-authored weapon is never rewritten.

**A tuning session is not a balance test.** Everything here is cosmetic by construction, but a
weapon whose muzzle flash is dialled to nothing is genuinely harder to read coming at you, and that
is a gameplay change made from a panel that promises it is only changing looks. It is confined to
the playground (PG46), which is the whole answer.

**The preview is one burst on an empty field.** VFX33 names readability in a real six-car fight as
the residual risk of the fx layer, and a preview against a frozen arena cannot answer that — it
answers "what does this burst look like", which is the question the panel exists for. Judging load
still means resuming and fighting the bot.
