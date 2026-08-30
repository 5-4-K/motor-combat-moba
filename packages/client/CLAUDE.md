# `@motor-combat-moba/client`

Phaser 3 render + join. Boot → Join → Lobby → Car select → Arena → Results, routed by `bindViewRouter`.

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
drawn as a ring plus a low-alpha wash by the branch above the circle case in `renderShots`, because a
filled 150-unit disc would hide the cars it is about to hit. The ring still sits exactly on the
hitbox, so "what you see is what will hit you" survives.

`?debug=1` draws the car OBB hitbox.

Combat is drawn, never predicted: live instances (projectiles and beams alike) come from `state.weapons` (cosmetically extrapolated along their own motion by `combat-visual.ts`), HP from `PlayerState.hp`. A dead car stops driving, predicting, and interpolating, and gains the spectate controls in `spectate.ts`. **There is no wreck left on the field**: it is intangible from the tick it dies, and `deathFadeAlpha` (`car-visual.ts`) fades it out over `DEATH_FADE_MS` from the networked `diedAtTick`, after which the container is destroyed rather than left invisible.

The lock bracket is drawn from `PlayerState.lockTargetSessionId` for whichever car the camera is following, never computed client-side. `SHOW_LOCK_BRACKET` in `scenes/combat-visual.ts` hides it at source; it ships `true` and `combat-visual.test.ts` asserts that, because a flip left in looks identical to a lock that never acquired.

**Player colour is for cars; weapon colour is for shots.**

**Shot colour says which CHASSIS fired it; shot shape says which weapon.** Since 2026-08-31 the nine
weapons are themed per chassis — Mirage maroon and orange, Bullseye navy and orange, Bastion yellow
and white — matching the HUD icons, which are themed the same way. So the three weapons on one car
deliberately look alike, and `pepperbox` and `needler` differ only by one step of navy. **That
convergence is the design, not a defect**: a weapon is told apart by silhouette (a lobbed ball, a
spread of pellets, a 1200-unit beam), and colour is spent on the question "who is shooting at me".
Every colour in `WEAPON_TABLE` and in the three style tables below traces to its weapon's icon;
`npm run check:weapons` reports the distance and all nine currently read `ok`. `lance`'s white core
is the one deliberate departure — white otherwise reads as Bastion, but a 1200-unit beam is the only
shot big enough to carry a third layer. Do not "separate" these palettes without saying so first.

Three tables own how a shot looks, split by what the weapon's hitbox is, and each returns `[]` for a
weapon it does not own so the flat `weaponFillOf` fill stays the fallback: `WEAPON_GLOW_STYLES`
(circles, nested by radius — `fireball`, `pepperbox`), `WEAPON_BEAM_STYLES` (beams, nested by extent
and cross-section — `afterburner`, `lance`, `bulwark`), and `WEAPON_PROJECTILE_STYLES` (the ellipse
and capsule projectiles — `needler`, `skewer`, `thumper`). The last is the newest and the one with a
rule worth keeping: a marking may never draw OUTSIDE the hitbox, which is the half of D19 that
protects a player, and `projectile-marks.test.ts` holds every authored layer to it at six headings.
The other half — that the drawn shape FILLS the hitbox — is relaxed for `skewer` alone, whose
disc-and-spikes spindle covers 43% of its ellipse; that exception is documented on the table and
pinned by a test, because it is the kind of thing a later reader would otherwise take for a bug.

How a shot is *shaped* is `WEAPON_GLOW_STYLES` in `scenes/combat-visual.ts`: per weapon, absent for all but `fireball`, and absent means the flat `weaponFillOf` disc that every weapon drew before. Bands are fractions of the hitbox radius and the flicker only shrinks, so the drawn shot can never exceed the hitbox — that is the invariant `instanceGlowBands` is tested against, and the reason the maths lives in `combat-visual.ts` rather than in `ArenaScene`, which no test can load.

**Adding detail to shots is cheap; four specific things are not.** `renderShots` clears and rebuilds one shared `Graphics` per frame, so a band costs one `fillCircle` per shot per frame and the realistic ceiling is ~60 live instances. Authoring bands for every weapon is well within budget. **Stop and warn before** a per-instance `setBlendMode` (flushes the batch — one draw call becomes one per shot), a faked gradient needing 15–20 bands, a `Graphics` object per shot instead of the shared `shotGfx`, or anything that multiplies `instanceGlowBands`' per-frame allocation. See [How much detail a shot can afford](../../docs/asset-pipeline.md#how-much-detail-a-shot-can-afford). `carFillOf(colorId)` paints a car, `weaponFillOf(weaponId)` paints every instance of a weapon — the same ember orange for every car's fireball. Drawing a shot needs no owner lookup at all (the client never reads `ownerSessionId`), so do not reach for the shooter's `PlayerState` in `renderShots`; that route was deleted on purpose. `WEAPON_TABLE.color` is render-only and stays off the wire.

The weapon slot HUD (`scenes/weapon-hud.ts` for the pure derivations, drawn by `ArenaScene.drawHudSlot`) reads `PlayerState.weapons` (`WeaponSlotState[]`, one row per slot) plus four car-wide fields: `level`, `switchLockUntilTick`, `pendingUntilTick` and `lastFiredSlot`. The last two are what let the car-wide lockout dim be correct for any weapon — every slot through a wind-up or volley (`tick < pendingUntilTick`), the other slots through recovery (`index !== lastFiredSlot`) — so a weapon with `startUpMs > 0`, `volleys > 1`, or `recoveryMs > 0` needs no wire change. `fire.ts`'s `pending` machine itself is never networked. See [`docs/schema-reference.md`](../../docs/schema-reference.md#playerstate).

Art is data, not code. `public/art/manifest.json` maps namespaced keys (`car.bastion`, `weapon-icon.needler`) to sprite entries; `src/assets/` parses and fits them. A missing, malformed, or unloadable entry falls back to the procedural silhouette in `drawCar` — that fallback is permanent, not legacy, and is what lets art be added one file at a time. Sprites are cosmetic: they are fitted to the OBB hull and never change it. `?dev=assets` opens the asset tuning tool, which is stripped from release builds and asserted absent by `scripts/build-release.mjs`.
