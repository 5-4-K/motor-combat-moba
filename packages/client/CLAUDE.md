# `@motor-combat-moba/client`

Phaser 3 render + join. Boot → Join → Lobby → Car select → Arena → Results, routed by `bindViewRouter`.

**Local invariant:** send inputs (and lobby intents) only — never authoritative sim state.

`ArenaScene` emits one `InputMessage` per `MS_PER_TICK` (not per frame), predicts the local car through shared `stepSim` via `PredictionBuffer`, reconciles against each state patch, and draws remotes from `InterpolationBuffer`. See [`docs/networking.md`](../../docs/networking.md).

Keep the scene thin: pure, testable logic lives beside it (`net/step-context.ts`, `scenes/car-visual.ts`, `scenes/arena-input.ts`) because `ArenaScene` itself cannot be unit-tested without a browser. Client tests are vitest in the **node** environment — never import Phaser from a test.

`buildStepContext` must keep agreeing with `serverTick`. The parts that decide who is solid and how a hull is sized are the *same* shared functions both call (`carIdOf`, `otherCarHulls` in `@motor-combat-moba/shared`) — change them there, never fork a client copy.

`?debug=1` draws the car OBB hitbox.

Combat is drawn, never predicted: live instances (projectiles and beams alike) come from `state.weapons` (cosmetically extrapolated along their own motion by `combat-visual.ts`), HP from `PlayerState.hp`. A wreck stops driving, predicting, and interpolating, and gains the spectate controls in `spectate.ts`.

The weapon slot HUD (`scenes/weapon-hud.ts` for the pure derivations, drawn by `ArenaScene.drawHudSlot`) reads `PlayerState.weapons` (`WeaponSlotState[]`, one row per slot) and `player.level`/`switchLockUntilTick`. It cannot yet show the car-wide lockout dim correctly for every weapon: `fire.ts`'s `pending` and `lastFiredWeaponId` were never networked, which is harmless only because every shipped weapon has `startUpMs: 0`, `volleys: 1`, and the one weapon with `recoveryMs > 0` (`repeater`) is carried by no car. The first weapon that breaks any of those needs `PlayerState.pendingUntilTick` and `lastFiredSlot` added to the schema — see the comment on `drawHudSlot` and [`docs/schema-reference.md`](../../docs/schema-reference.md#weaponslotstate).

Art is data, not code. `public/art/manifest.json` maps namespaced keys (`car.rectangle`) to sprite entries; `src/assets/` parses and fits them. A missing, malformed, or unloadable entry falls back to the procedural silhouette in `drawCar` — that fallback is permanent, not legacy, and is what lets art be added one file at a time. Sprites are cosmetic: they are fitted to the OBB hull and never change it. `?dev=assets` opens the asset tuning tool, which is stripped from release builds and asserted absent by `scripts/build-release.mjs`.
