# `@motor-combat-moba/client`

Phaser 4 render + join. Boot → Join → Lobby → Car select → Arena → Results, routed by `bindViewRouter`.

**Local invariant:** send inputs (and lobby intents) only — never authoritative sim state.

`ArenaScene` emits one `InputMessage` per `MS_PER_TICK` (not per frame), predicts the local car through shared `stepSim` via `PredictionBuffer`, reconciles against each state patch, and draws remotes from `InterpolationBuffer`. See [`docs/networking.md`](../../docs/networking.md).

Keep the scene thin: pure, testable logic lives beside it (`net/step-context.ts`, `scenes/car-visual.ts`, `scenes/arena-input.ts`) because `ArenaScene` itself cannot be unit-tested without a browser. Client tests are vitest in the **node** environment — never import Phaser from a test.

`buildStepContext` must keep agreeing with `serverTick`. The parts that decide who is solid and how a hull is sized are the *same* shared functions both call (`carIdOf`, `otherCarHulls` in `@motor-combat-moba/shared`) — change them there, never fork a client copy.

Statuses are the one part of combat the client DOES predict — because `stepSim` reads them.
`localModifiers` in `net/step-context.ts` reads `PlayerState.statuses` off the schema and hands the
rows to the same shared `modifiersFromRows` the server reaches through; never fork that derivation
here, for the same reason `carIdOf` and `otherCarHulls` are not forked. The badge strip above the
weapon slots is derived in `scenes/status-hud.ts` (order, drain fraction, seconds, strip layout) and
drawn by `ArenaScene.drawStatusStrip` on the slot bar's own `Graphics`. **A status the player cannot
see is a bug they will report as the car feeling wrong** — a slow with no badge reads as netcode —
so the strip is load-bearing, not decoration. The drain bar is measured from the row's own
`startTick`, because a status's duration comes from whatever applied it and is not in the table.

An **aura** (a `disc`-hitbox beam at `origin: "center"`) is the one instance too big to fill in: it is
drawn as a ring plus a low-alpha wash by `isAuraInstance`'s branch in `combat-visual.ts`, because a
filled disc would hide the cars it is about to hit. The ring still sits exactly on the hitbox, so
"what you see is what will hit you" survives. This sat as **dormant machinery** from the 2026-09-01
roster cutover — `shockwave` carried the one shipped aura and lost it to a plain projectile dart on
Bullseye's slot 1, since renamed `magmablast` — until the 2026-09-02 predator/magmablast pass revived
it: `magmablast` now detonates on death into a real `disc`-hitbox burst, drawn through this exact
branch in every live match. `drawDefOf` is what makes that reachable at all: a burst instance carries
its parent shell's `weaponId`, so the branch takes the whole `DrawableInstance` (`isExplosion` and
all) rather than a bare `weaponId`, and resolves the def through `instanceDefOf` before asking what
its hitbox is.

`?debug=1` draws the car OBB hitbox.

Combat is drawn, never predicted: live instances (projectiles and beams alike) come from `state.weapons` (cosmetically extrapolated along their own motion by `combat-visual.ts`), HP from `PlayerState.hp`. A dead car stops driving, predicting, and interpolating, and gains the spectate controls in `spectate.ts`. **There is no wreck left on the field**: it is intangible from the tick it dies, and `deathFadeAlpha` (`car-visual.ts`) fades it out over `DEATH_FADE_MS` from the networked `diedAtTick`, after which the container is destroyed rather than left invisible.

The lock bracket is drawn from `PlayerState.lockTargetSessionId` for whichever car the camera is following, never computed client-side. `SHOW_LOCK_BRACKET` in `scenes/combat-visual.ts` hides it at source; it ships `true` and `combat-visual.test.ts` asserts that, because a flip left in looks identical to a lock that never acquired.

**Player colour is for cars; weapon colour is for shots.**

**Shot colour is an authoring choice, not a signal.** It says nothing about which chassis fired the
shot, and nothing systematic about the weapon either — a weapon is told apart by its silhouette (a
lobbed ball, a spread of pellets, a 1200-unit beam). Colours are picked because they look right.
There is no per-chassis palette to preserve and no rule that the three weapons on one car should
resemble each other; do not reintroduce one, and do not "fix" two weapons that happen to share a hue.

The one pairing that *is* meant to hold is a weapon's `WEAPON_TABLE.color` against **its own HUD
icon**, so the slot and the thing crossing the arena read as the same weapon. Nothing typed enforces
it — `npm run check:weapons` measures the RGB distance and warns past `COLOR_DRIFT_LIMIT`, which is a
warning and never fails the suite. Every weapon but `tremor` carries an icon today.

Three tables own how a shot looks, split by what the weapon's hitbox is, and each returns `[]` for a
weapon it does not own so the flat `weaponFillOf` fill stays the fallback: `WEAPON_GLOW_STYLES`
(circles, nested by radius) is currently **empty** — the 2026-09-01 roster cutover retired the row
that used it and nothing has replaced it yet, so every round projectile draws the flat fallback fill.
`WEAPON_BEAM_STYLES` (beams, nested by extent and cross-section) styles `afterburner` and `lance`
(`bulwark` retired with the cutover). `WEAPON_PROJECTILE_STYLES` (the ellipse and capsule projectiles)
styles `thumper` and `predator` (`needler` and `skewer` retired); `pepperbox` is the one non-circular
projectile still drawing the flat hitbox fill until an owner arts it. The last table
is the one with a rule worth keeping: a marking may never draw OUTSIDE the hitbox, which is the half
of D19 that protects a player, and `projectile-marks.test.ts` holds every authored layer to it at six
headings.

`predator` is the table's one full **missile** and the reason the `poly` layer exists: nose cone,
red stripe, swept fins and an exhaust plume, built by `predatorMissileLayers` from the icon's own
measured proportions. Two things about it are load-bearing and easy to undo by accident. Its greys
are deliberately **darker than its icon's** — the floor is `#EBEBEB` and the icon is drawn for a
white page, so the icon's literal body greys wash out and the shot reads shorter than it is. And its
`radiusAlong` was grown **14 → 19** in the same change to CONTAIN the plume: the art and that number
are one decision, so cropping the plume without shortening the capsule puts the weapon back to
reaching further than it draws. Unlike every other layer, a `poly`'s containment is not implied by
its parameters — it is `clampToHull`, applied per vertex, which pulls a stray point onto the hull
rather than dropping the layer.

How a shot is *shaped* is `WEAPON_GLOW_STYLES` in `scenes/combat-visual.ts`: per weapon, and today
empty for every row (see above), so every weapon currently draws the flat `weaponFillOf` disc or
polygon. Bands are fractions of the hitbox radius and the flicker only shrinks, so a drawn shot can
never exceed the hitbox — that is the invariant `instanceGlowBands` is tested against, and the reason
the maths lives in `combat-visual.ts` rather than in `ArenaScene`, which no test can load.

**Adding detail to shots is cheap; four specific things are not.** `renderShots` clears and rebuilds one shared `Graphics` per frame, so a band costs one `fillCircle` per shot per frame and the realistic ceiling is ~60 live instances. Authoring bands for every weapon is well within budget. **Stop and warn before** a per-instance `setBlendMode` (flushes the batch — one draw call becomes one per shot), a faked gradient needing 15–20 bands, a `Graphics` object per shot instead of the shared `shotGfx`, or anything that multiplies `instanceGlowBands`' per-frame allocation. See [How much detail a shot can afford](../../docs/asset-pipeline.md#how-much-detail-a-shot-can-afford). `predator` is the current high-water mark at 15 `fillPoints` per shot: two can be in the air per player, so a full room tops out near 180 fills a frame — inside budget, because it is still one `Graphics` with no blend-mode change, but it is the number to check a new authored weapon against rather than assuming headroom. `carFillOf(colorId)` paints a car, `weaponFillOf(weaponId)` paints every instance of a weapon — the same grey for every car's `predator`, and only where a weapon has no entry in the three style tables. Drawing a shot needs no owner lookup at all (the client never reads `ownerSessionId`), so do not reach for the shooter's `PlayerState` in `renderShots`; that route was deleted on purpose. `WEAPON_TABLE.color` is render-only and stays off the wire.

The weapon slot HUD (`scenes/weapon-hud.ts` for the pure derivations, drawn by `ArenaScene.drawHudSlot`) reads `PlayerState.weapons` (`WeaponSlotState[]`, one row per slot) plus four car-wide fields: `level`, `switchLockUntilTick`, `pendingUntilTick` and `lastFiredSlot`. The last two are what let the car-wide lockout dim be correct for any weapon — every slot through a wind-up or volley (`tick < pendingUntilTick`), the other slots through recovery (`index !== lastFiredSlot`) — so a weapon with `startUpMs > 0`, `volleys > 1`, or `recoveryMs > 0` needs no wire change. `fire.ts`'s `pending` machine itself is never networked. See [`docs/schema-reference.md`](../../docs/schema-reference.md#playerstate).

Art is data, not code. `public/art/manifest.json` maps namespaced keys (`car.bastion`, `weapon-icon.thumper`) to sprite entries; `src/assets/` parses and fits them. A missing, malformed, or unloadable entry falls back to the procedural silhouette in `drawCar` — that fallback is permanent, not legacy, and is what lets art be added one file at a time. Sprites are cosmetic: they are fitted to the OBB hull and never change it. `?dev=assets` opens the asset tuning tool, which is stripped from release builds and asserted absent by `scripts/build-release.mjs`.
