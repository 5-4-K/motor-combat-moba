# `@motor-combat-moba/client`

Phaser 4 render + join. Boot → Join → Lobby → Car select → Arena → Results, routed by `bindViewRouter`.

**Local invariant:** send inputs (and lobby intents) only — never authoritative sim state.

`ArenaScene` emits one `InputMessage` per `MS_PER_TICK` (not per frame), predicts the local car through shared `stepSim` via `PredictionBuffer`, reconciles against each state patch, and draws remotes from `InterpolationBuffer`. See [`docs/networking.md`](../../docs/networking.md).

Keep the scene thin: pure, testable logic lives beside it (`net/step-context.ts`, `scenes/car-visual.ts`, `scenes/arena-input.ts`) because `ArenaScene` itself cannot be unit-tested without a browser. Client tests are vitest in the **node** environment — never import Phaser from a test.

**The client installs exactly one mode bundle and lets it persist.** A tab holds one room at a time,
so there is no previous bundle to restore and `net/mode-scope.ts` uses shared's `installMode`, not
the server's `withMode`/`scoped` push-and-pop. `BootScene.create()` installs `DEFAULT_GAME_MODE`
**before it launches any scene** — `JoinScene`'s name field reads `flow().nameMax`, and a `cfg()`
throw there blanks the whole page — and `watchRoomMode(room)` reinstalls from `state.mode` the
moment a room is joined and on every later change (the host can re-mode a lobby). After that every
one of the client's ~150 leaf config reads just calls `drive()`/`cars()`/`weapons()` directly.
`runInRoomMode` exists but has no production call site; it only asserts a bundle is installed.
**Never read an accessor at module scope** — that freezes the first bundle installed for the life of
the page. `net/mode-memo.ts`'s `memoOnBundle(compute)` is the sanctioned fix: it defers the read to
first call and re-computes when the bundle identity changes (`combat-visual.ts`'s `hpBarGeometry`
and `maneuver-visual.ts`'s charge outline are the live users).

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

**Cars are lit, and the arena has exactly one light.** `ENVIRONMENT_FX.carLook.lightAngle` — the
direction from a car toward the light — is the whole model, and `scenes/car-lighting.ts` derives
everything from it: a four-corner gradient tint on the body, a drop shadow and a contact shadow, and
a rim light. Before this a car was a flat `setTint` on flat asphalt with no shadow at all, which is
exactly how it read.

**Every derivation takes the car's rotation and undoes it, and that is the point.** The light is
WORLD-fixed. Tint by fixed corner constants instead and the highlight spins with the bodywork, so a
car looks lit by itself and six cars at six headings read as six separately-lit stickers.

Three things about it are load-bearing and were each learned by looking at the screen rather than at
a test:

- **The rim is a copy of the car's own ART**, tinted and nudged toward the light behind the body —
  not a stroked outline. The hull is a 60x40 box the sprites do not fill, so stroking it drew a
  picture frame around the car. Only the art knows where a car's edge is. A chassis falling back to
  the procedural silhouette simply goes without a rim rather than earning a second code path.
- **Every car's shadow is one ellipse**, sized by `carLook.footprint` to well inside the hull, and
  never the chassis silhouette: at hull size the rect chassis cast a hard rectangle and the car sat
  in a box. A shadow is soft and nobody reads its outline.
- **The shadow bands all carry the same alpha**, `shadowAlpha / count`. They stack, so the centre
  lands near the authored number and the edge at a fraction of it — that gradient IS the softness.
  Ramping the alphas too accumulated to ~0.75 and read as a hole in the road.

`ENVIRONMENT_FX.floorArt` (`floorTintOf` in `assets/arena-floor.ts`) can knock a floor sprite back
through one multiply. It is the exact mirror of the `floor.*` group: one of the two is live per arena
and the panel says which. **It ships as a no-op (`darken: 0`)**, so floor art draws exactly as
authored.

**A car glow was tried on 2026-09-13 and removed the same day. Do not add it back without new
evidence.** An additive halo of the car's player colour, drawn on its own layer below the cars. The
reasoning was that a car needs to be the brightest thing near itself; on the arena floor art it made
readability WORSE, twice, on the screen. Two lessons are worth keeping, because both are cheap to
rediscover the hard way:

- **Adding light around a DARK car erodes the thing making it visible.** These sprites are dark and
  desaturated. On a mid-value or bright deck their silhouette IS the signal, and lifting the ground
  right around them shrinks exactly that contrast. `floorArt.darken` failed for the mirror-image
  reason — it ships at 0 now, after shipping at 0.45 on the theory that a quieter ground makes cars
  pop, which only holds if the cars are LIGHTER than their floor.
- **A halo that pools UNDER a car washes its art out.** The glow's bands first ran down to the shadow
  footprint (0.86 of the hull), so each car sat inside a filled disc of light. The sprites do not fill
  their hull, so the light bled through the gaps in the art. It read unmistakably as the glow drawing
  over the car, and it was not — it was a whole layer below. An inner radius outside the hull fixed
  that symptom, and the halo still hurt, which is what settled the question.

**What actually works here is brightening the CAR, not the ground**: `litStrength` ships at 1, so the
lit side of every body runs to white and the car carries its own contrast. `shadowAlpha` ships at 0
with `contactAlpha` 0.16 left on — no cast shadow, just the tight occlusion that sits a car down.
Those two plus `lightAngle` (-180, light from screen-left) are the levers for a "cars are hard to
see" complaint. Watch one thing at `litStrength: 1`: the lit corners run fully to white, which can
drain the player colour that says whose car it is — if colours stop reading, that is the knob.

The shadows draw at a **shared depth, `CAR_SHADOW_DEPTH`, not inside each car's container**: all
cars sit at `CAR_DEPTH` and Phaser breaks that tie by insertion order, so a parented shadow would
draw over another car's body every time two of them overlap. **They are two pooled `Image`s per car
over two baked textures every car shares** (`syncShadowTextures`, from `shadowStampOf` in
`car-lighting.ts`), not fills on a `Graphics`: the band stack was first re-filled per car per frame —
~2,000 draw commands a frame, the heaviest `Graphics` in the scene, measured at 0.35–0.6 ms of render
for a shape that never changes — and that `Graphics` was in neither list of `splitCameras`, so it was
drawn by both cameras. A shadow image is handed to the HUD camera's ignore list at birth, exactly as
`syncCar` does for the car. The textures are baked white and tinted, and re-baked only when the
`carLook` fields that shape them change, so the panel still tunes all of it live. The gradient tint lives in
`applyCarSprite` rather than in `ArenaScene`, because that helper is shared with `?dev=assets` so the
tool cannot drift from the arena. Zeroing every strength in `carLook` restores the old flat drawing
exactly, and `floorArt.darken: 0` with a white tint multiplies by one, which is what it ships at —
and the panel's "Car lighting" and "Floor art" sections tune all of it live.

**A car's paint is `carFillFor(sessionId, colorId)`, not `carFillOf` directly.** It is `carFillOf`
byte for byte unless the PLAYGROUND has a tint switched ON for that one car — a free colour picked in
the **Car select** panel (`packages/client/src/dev/playground/car-panel.ts`), alongside that seat's
chassis, colour and loadout controls, so a developer can judge a candidate palette against a real
floor before anything is typed into `COLOR_TABLE`. Physics settings is stats-only now. **The picker
and the palette dropdown both paint the same car, so a per-car checkbox says which one is live** and
the panel dims and titles the other; an entry is `{hex, on}` rather than a bare number so switching
the tint off RESTORES the dropdown without discarding the candidate colour. Precedence by mere
presence was the first cut and was wrong: the dropdown went silently dead the moment a colour was
picked, which is exactly the failure `env-panel.ts` names for `floor.*`/`floorArt.*` — a control that
quietly does nothing is worse than one that says why. It is keyed by **seat id
(`PLAYGROUND_SEAT_IDS[n]`, `"pg-0"`…`"pg-5"`), not `colorId`**, because any of the six seats are
allowed to sit on the same colour (PG31, and there is a test named for it), so overriding a slot
would repaint every seat sharing that colour from one picker. Seat id specifically, rather than the
Colyseus session id that used to be the only other candidate, because a seat outlives a connection —
that is what lets a tint survive a page reload at all. Under the old session-id keying the human's
own tint was silently discarded on every reconnect, since the key was fresh on every connection,
while the bot's — keyed on the constant `"bot"` — persisted; see `migrateTintKeys` in
`packages/client/src/dev/playground/storage.ts`, which migrates the one old key (the bot's) that can
still be identified. Client-only and never sent anywhere, like the VFX and environment maps beside it
in `fx/car-tint.ts`; only the playground overlay ever seeds it (and `PlaygroundScene.onShutdown`
clears it, exactly as it does the other two), so a shipped arena or a practice room paints
`COLOR_TABLE` no matter what is saved in that browser. All four fill sites — the per-frame body tint,
the container build, the dash ghost and the roster swatch — go through it, which is what keeps the
swatch's own claim (that the panel can never disagree with the field about who is who) true.

`?debug=1` draws the car OBB hitbox.

Combat is drawn, never predicted: live instances (projectiles and beams alike) come from `state.weapons` (cosmetically extrapolated along their own motion by `combat-visual.ts`), HP from `PlayerState.hp`. A dead car stops driving, predicting, and interpolating, and — **in Last Standing only** — gains the spectate controls in `spectate.ts`. A Deathmatch wreck keeps its own seat instead: the camera holds where it died, the slot column keeps showing the player's own kit, and the camera cuts (never eases) to the new car on respawn, which is marked for the local player alone by the blinking self arrow (`drawSelfArrow`, gated on `isPhasedAt`). **There is no wreck left on the field**: it is intangible from the tick it dies, and `deathFadeAlpha` (`car-visual.ts`) fades it out over `DEATH_FADE_MS` from the networked `diedAtTick`, after which the container is destroyed rather than left invisible.

There is no lock bracket, and no targeting assist of any kind: the 2026-09-17 removal of the aim-lock feature deleted `PlayerState.lockTargetSessionId`, `SHOW_LOCK_BRACKET`, `lockBracketArms` and the `lockGfx` layer it was stroked into. Since the 2026-09-21 mouse-aim work there are two aiming HUDs, one per muzzle kind. A **fixed-muzzle** shot leaves along the car's heading, so the nose is its aiming HUD. A **turret** shot (a row carrying `WeaponDef.turret` — on `development/main`, the nine basic-attack rows and nothing else, none of which can be pressed while `BASIC_ATTACK_CONFIG.enabled` is `false`, so this whole path is dormant on this build) leaves from the turret along the bearing to the **crosshair** (`scenes/crosshair.ts`, styled by `config/crosshair.ts`'s `CROSSHAIR_STYLE`), drawn while the lock is held and the car is on the field. Since TR56 the crosshair is a **world offset from the driven car's centre** (`input/aim-offset.ts`), not a screen cursor: mouse movement moves it, it rides with the car, keeps its world direction as the car turns, and is held within `CROSSHAIR_CONFIG.maxDistance` (60 u) and inside the turret's swing arc (`TURRET_CONFIG.maxSwingDeg`), re-clamped every frame. The drawn turret (`scenes/turret-visual.ts`, sized by `config/turret-visual.ts`'s `TURRET_VISUAL.lengthUnits`) shows where it is pointing, and turns toward the bearing before the shot leaves. `aimAngle` is computed from `turretPivotOf` on the **rendered** pose, because that is what the player aimed at on screen. See [`docs/combat-model.md`](../../docs/combat-model.md#turret-muzzle).

**The AIM HUD is three white marks drawn UNDER the driven car and nobody else's**, in the car's own
frame (`scenes/aim-hud.ts`, switched by `config/aim-hud.ts`, at `AIM_HUD_DEPTH` -2 between
`GLOW_DEPTH` and `CAR_DEPTH`): a dashed ring at `CROSSHAIR_CONFIG.maxDistance`, two dashed runs from
the turret mount to that ring at the swing arc's edges, and four arrows at the fixed muzzle
directions. It is drawn once at the origin and then MOVED — `setPosition`/`setRotation` to the render
pose each frame — and re-filled only when `aimHudSignature` changes, because Phaser re-tessellates a
`Graphics` on every rebuild and the ring alone is two dozen arcs. Client-only: no schema field,
nothing on the wire, no sim reach.

**It comes in two GROUPS, and the split is a capability, not a preference.** The TURRET group — the
crosshair, the ring and the swing limits — is everything about a bearing the player chose, and it is
gated on `ArenaScene.wantsPointerLock`, which is `carHasTurretWeapon` over the driven car's live fire
slots (TR53), the same predicate `drawCar` asks before it builds a turret at all. A car with no
turret weapon draws none of the three **and is never asked for pointer lock**, since a captured,
invisible cursor buys nothing when nothing on screen tracks it; the gate is re-read every frame
rather than cached, because a playground loadout swap can take the turret out from under a held lock.
The MUZZLE group — the four arrows — is about the car's own heading, which every chassis has, so it
is drawn whatever the loadout is. `AIM_HUD_CONFIG.turretHud` / `.muzzleHud` sit ABOVE that gate and
hide a group a car is otherwise entitled to; `turretHud` deliberately does **not** hide the
crosshair, which is shipped TR32 behaviour and not a new switch's to take away.

**Dropping the lock must never drop firing, and `fireButtons` is where that is kept true.** It gated
all mouse fire on `locked`, so a turret-less car would have lost LMB and RMB — its basic attack and
its slot-1 ability — and kept only Q and E. It now takes `usesLock`: false lets the buttons through
unlocked, which is exactly how mouse fire worked before the turret existed — click anywhere at all,
and the shot leaves the fixed muzzle it was always going to leave. `swallow` is still masked on that
path, and is always 0 there, since only `acquired` ever sets it.

**On `development/main` that gate is false for EVERY car, and that is the point.** This build
returned `predator`, `magmablast` and `thumper` to fixed muzzles and set
`BASIC_ATTACK_CONFIG.enabled` to `false`, so the only `turret` rows left are nine basic attacks on a
fire slot that refuses every press. `carHasTurretWeapon` therefore answers false for all three
chassis: no turret sprite, no pointer lock, no crosshair, no turret HUD — and the four muzzle arrows
are the whole of the aim HUD a player sees. A config test in `turret-config.test.ts` asserts that
over the live roster, so a weapon quietly regaining a turret is caught rather than discovered on
screen.

It reads the other way on `feature/mouse-aim`, where every chassis carries a turret ability on top
of a basic attack that is one, and the turret-less path is reachable only from a hand-built
playground kit. That is the branch the gate was written and verified on — by stubbing the predicate
false and looking at the screen, rather than by reading the branch.

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
weapon it does not own so the flat `weaponFillOf` fill stays the fallback: `weaponGlowStyleOf`/`weaponGlowStyles()`
(circles, nested by radius) holds ten rows — `magmablast`'s explosion disc plus all nine
basic-attack rows, each given a lit core so a flat near-black disc reads as a sphere
rather than a hole on this game's light floors (BA8) — and every round projectile with no entry
still draws the flat fallback fill. `WEAPON_BEAM_STYLES` (beams, nested by extent and cross-section) styles `afterburner`, `lance` and `tremor`
(`bulwark` retired with the cutover). `WEAPON_PROJECTILE_STYLES` (the ellipse and capsule projectiles)
styles `thumper` and `predator` (`needler` and `skewer` retired); `pepperbox` still draws the flat
hitbox fill for its BODY, but as of 2026-09-13 it carries a shaped **halo** — an entry whose `layers`
are empty and whose `halo` is not.

**That halo is the one place a projectile draws outside its own hitbox, and it offsets rather than
scales.** `HaloBand` (the disc side, `magmablast`) multiplies a radius, which is fine because
scaling a circle and offsetting its outline are the same operation. `ProjectileHaloBand` carries a
`spread` instead: both radii grow by the same distance. On `pepperbox`'s 9x3 ellipse a multiplier
adds three times more length than width, so the glow stops following the silhouette and reads as a
smear pointing along the shot — offsetting keeps it a uniform-thickness ring around that shape.
`projectileHaloShapes` builds each band by handing shared's own `projectileShapeAt` an inflated
hitbox, so there is no second copy of the geometry to drift and a future hitbox shape moves the halo
with it for free. It is deliberately **not** part of `projectileDrawLayers`, for the same reason
`BeamStyle.flare` is not part of `beamDrawLayers`: that output is swept vertex by vertex by
`projectile-marks.test.ts`, and folding in a shape that legitimately sits outside would blunt the one
check proving every other shape stays inside. `styled` in that test is filtered to rows authoring
`layers`, which is why a halo-only row is absent from it.

**Two bands, not `magmablast`'s three, and that is a cost decision rather than a taste one.**
`pepperbox` is `muzzles` x `pelletsPerVolley` = **12 projectiles per press**, so a six-Bullseye room
can carry ~72 live instances — more than any other weapon and above the ~60 the cost notes below
assume. A third band would make the cheapest-looking weapon the most expensive one to draw. The last table
is the one with a rule worth keeping: a marking may never draw OUTSIDE the hitbox, which is the half
of D19 that protects a player, and `projectile-marks.test.ts` holds every authored layer to it at six
headings.

`predator` is the table's one full **missile** and the reason the `poly` layer exists: nose cone,
red stripe, swept fins and an exhaust plume, built by `predatorMissileLayers` from the icon's own
measured proportions. Two things about it are load-bearing and easy to undo by accident. Its greys
are deliberately **darker than its icon's** — the icon is drawn for a white page, so its literal
body greys wash out against the arena floor and the shot reads shorter than it is. (That floor was
`#EBEBEB` when this was written; the gritty-VFX pass replaced it with generated warm asphalt around
`ENVIRONMENT_FX.floor.baseGrey` 50, which is darker still, so the reasoning holds and only the
number moved.) And its
`radiusAlong` was grown **14 → 19** in the same change to CONTAIN the plume: the art and that number
are one decision, so cropping the plume without shortening the capsule puts the weapon back to
reaching further than it draws. Unlike every other layer, a `poly`'s containment is not implied by
its parameters — it is `clampToHull`, applied per vertex, which pulls a stray point onto the hull
rather than dropping the layer.

`lance` is the beam side of the same story, and the table's one **animated** look. It shipped as two
flat nested rectangles that read as a highlighter stroke; it is now a lightning bolt, and three of its
parts are load-bearing. `crackle` falls to **zero as the layers go inward**, so a dead-straight
white-hot core sits inside a torn envelope — an early cut tore every layer equally and the whole beam
undulated like a ribbon, which is the failure to avoid if you author a second bolt. `domeScale` rounds
the ORIGIN into `thumper`'s capsule head, and it is **carved out of the beam's length** rather than
added behind the muzzle, which is why it needs no hitbox exception (the charge orb, sitting outside on
the shooter's own car, remains the only one). And `crackleHz` re-rolls the tear off `performance.now()`
— free, because `renderShots` rebuilds every polygon each frame regardless, but it means two live
beams crackle in step and different clients see different frames.

**The rate is per LAYER, and that is not a convenience.** A vertex moves, per rendered frame, in
proportion to `crackle × rate`, and a beam sweeping while its shape jumps reads as snapping rather
than sweeping — the bug that shipped in the first cut, at 12.2 units of movement per frame. Two
things hold it down: consecutive rolls are interpolated with a smoothstep, and each layer runs at the
rate its own tear depth can afford (lance: 0.42 at 5 Hz, 0.34 at 8 Hz, 0.14 at 14 Hz, measuring 1.81
/ 1.64 / 0.55 units per frame). Forcing one rate on every layer prices the whole beam at its widest
tear and costs a 60% cut in depth to stay smooth. `combat-visual.test.ts` caps per-frame movement at
2 units across every layer, so raising a rate or deepening a tear without re-checking the other fails
the suite. That is fine and deliberate: nothing
in the sim reads it, and `instanceGlowBands` already animates off the same clock. `beamDrawLayers`
takes `nowMs` as a defaulted last parameter, so every other caller keeps drawing a frozen frame.

How a shot is *shaped* is `weaponGlowStyleOf`/`weaponGlowStyles()` in `scenes/combat-visual.ts`: per weapon, holding ten
rows today (see above) — every weapon without one of those ten still draws the flat `weaponFillOf`
disc or polygon. Bands are fractions of the hitbox radius and the flicker only shrinks, so a drawn shot can
never exceed the hitbox — that is the invariant `instanceGlowBands` is tested against, and the reason
the maths lives in `combat-visual.ts` rather than in `ArenaScene`, which no test can load.

**Adding detail to shots is cheap; four specific things are not.** `renderShots` clears and rebuilds one shared `Graphics` per frame, so a band costs one `fillDisc` per shot per frame and the realistic ceiling is ~60 live instances. Authoring bands for every weapon is well within budget. **Stop and warn before** a per-instance `setBlendMode` (flushes the batch — one draw call becomes one per shot), a faked gradient needing 15–20 bands, a `Graphics` object per shot instead of the shared `shotGfx`, or anything that multiplies `instanceGlowBands`' per-frame allocation. See [How much detail a shot can afford](../../docs/asset-pipeline.md#how-much-detail-a-shot-can-afford). `afterburner` is the current high-water mark and took the title off `predator` (15 `fillPoints` per shot, ~180 a frame for a full room): a flame is 12 fills and ~1,040 vertices per instance, fires TWO instances per press, and a room of six Mirages all burning is ~144 fills and 12,500 vertices a frame. **Fills were never the problem — the CPU geometry was.** The first cut of the jet cost 3.8 ms a frame to build at that load, 23% of a 60fps budget for one weapon's cosmetics, and none of it was where it looked: not the trig, not `Math.pow`, not the allocation. It was re-hashing the same handful of noise values ~14 times each and calling through a closure per octave per station. Pre-sampling each octave into a per-station array took it to 1.1 ms, bit-identical output. **So the number to check a new authored beam against is not its fill count — it is `ms` to build one frame's worth at the realistic ceiling, plus the `ms` Phaser spends rendering it** (the ribbon paragraph below is where the second half was found), and the way to check either is to measure, not to guess — the [`weapon-look`](../../.claude/skills/weapon-look/SKILL.md) skill carries the procedure. `carFillFor(sessionId, colorId)` paints a car, `weaponFillOf(weaponId)` paints every instance of a weapon — the same grey for every car's `predator`, and only where a weapon has no entry in the three style tables. Drawing a shot needs no owner lookup at all (the client never reads `ownerSessionId`), so do not reach for the shooter's `PlayerState` in `renderShots`; that route was deleted on purpose. A weapon's `color` is render-only and stays off the wire — and it is read through `weapons()`, the ACTIVE MODE's own table, so two modes may paint the same weapon differently (no shipped mode does).

The weapon slot HUD (`scenes/weapon-hud.ts` for the pure derivations, drawn by `ArenaScene.drawHudSlot`) reads `PlayerState.weapons` (`WeaponSlotState[]`, one row per slot) plus four car-wide fields: `level`, `switchLockUntilTick`, `pendingUntilTick` and `lastFiredSlot`. The last two are what let the car-wide lockout dim be correct for any weapon — every slot through a wind-up or volley (`tick < pendingUntilTick`), the other slots through recovery (`index !== lastFiredSlot`) — so a weapon with `startUpMs > 0`, `volleys > 1`, or `recoveryMs > 0` needs no wire change. `fire.ts`'s `pending` machine itself is never networked. See [`docs/schema-reference.md`](../../docs/schema-reference.md#playerstate).

**On the shot layers, never hand Phaser a shape whose triangulation you already know.** `fillPoints`
and `fillCircle` both become a path, and Phaser runs Earcut over every path every frame into fresh
arrays. `scenes/ribbon-fill.ts` holds the two fills that skip it: `fillRibbon` for a flame or bolt
layer (a `DrawBeamLayer` carrying `ribbon`, the per-edge station count — `points` is still the whole
outline, so the containment sweeps are untouched), and `fillDisc` for every filled circle, from a
cached unit rim. Measured per live instance per frame: `lance` 1.68 -> 0.52 ms, `afterburner`
0.43 -> 0.25, a `magmablast` shell 0.12 -> 0.024, a basic attack 0.04 -> 0.011. **The way to price a
new look is the one that found these**: twelve synthetic instances of one weapon on a paused
playground frame, build ms plus added render ms — `lance` was costing more per beam than the rest of
the scene and no fill count would have said so. Part of `lance`'s gain is `BOLT_VISIBLE_TEAR`: a
bolt layer whose edge can move less than half a unit (a pixel, at the arena's fixed zoom of 1) is
drawn with straight edges, which on `lance` is the three innermost layers — three-eighths of its
vertices were animating a tear of 0.31 units and under. A new crackling layer that thin gets the
same treatment, and `combat-visual.test.ts` holds both sides of the rule. **The rule outlives those
two weapons by a guard, not by memory**: `ribbon-fill.test.ts` sweeps every `WEAPON_TABLE` row
through every shot-layer builder and fails any polygon past `EARCUT_VERTEX_BUDGET` (64) vertices
that carries no `ribbon`, and checks every ribbon it finds tiles its outline exactly. A new look
that walks stations either declares its layout or fails the suite naming the weapon and the count.

**The slot bar is a baked picture, not a live `Graphics`.** Phaser re-tessellates a `Graphics` every
frame it is on screen whether or not its commands moved, and the slot bar's rings, glows and
rounded pills cost ~0.5 ms of render a frame for a picture that changes a few times a second.
`hudGfx` is therefore on no display list: `renderWeaponHud` still builds its commands every frame
(0.05 ms), and `bakeHud` draws them into the `hudBake` render texture only when `sameCommands`
(`scenes/hud-bake.ts`) says they differ from the ones last baked — comparing the OUTPUT, so there is
no second description of what the HUD depends on to drift from the draw code. Baked at
`HUD_BAKE_SCALE` (2x) and displayed at half scale, because a render texture is not multisampled and
the canvas the HUD camera used to draw to is. **Anything that changes every tick belongs on
`hudSweepGfx`, the live layer, not on `hudGfx`**: the cooldown arc always was, and the status
strip's drain bars were moved there for this reason — on `hudGfx` one active status re-baked the
whole bar at the tick rate. A new HUD element that reads a clock and draws into `hudGfx` will not
break anything; it will quietly turn the bake back into a per-frame redraw, and `bakes per second`
in a profile is how to notice.

Art is data, not code. `public/art/manifest.json` maps namespaced keys (`car.bastion`, `weapon-icon.thumper`) to sprite entries; `src/assets/` parses and fits them. A missing, malformed, or unloadable entry falls back to the procedural silhouette in `drawCar` — that fallback is permanent, not legacy, and is what lets art be added one file at a time. Sprites are cosmetic: they are fitted to the OBB hull and never change it. `?dev=assets` opens the asset tuning tool, which is stripped from release builds and asserted absent by `scripts/build-release.mjs`.
