# `@motor-combat-moba/client`

Phaser 3 render + join. Boot → Join → Lobby → Car select → Arena → Results, routed by `bindViewRouter`.

**Local invariant:** send inputs (and lobby intents) only — never authoritative sim state.

`ArenaScene` emits one `InputMessage` per `MS_PER_TICK` (not per frame), predicts the local car through shared `stepSim` via `PredictionBuffer`, reconciles against each state patch, and draws remotes from `InterpolationBuffer`. See [`docs/networking.md`](../../docs/networking.md).

Keep the scene thin: pure, testable logic lives beside it (`net/step-context.ts`, `scenes/car-visual.ts`, `scenes/arena-input.ts`) because `ArenaScene` itself cannot be unit-tested without a browser. Client tests are vitest in the **node** environment — never import Phaser from a test.

`buildStepContext` must keep agreeing with `serverTick`. The parts that decide who is solid and how a hull is sized are the *same* shared functions both call (`carIdOf`, `otherCarHulls` in `@motor-combat-moba/shared`) — change them there, never fork a client copy.

`?debug=1` draws the car OBB hitbox.

Combat is drawn, never predicted: shots come from `state.projectiles` (cosmetically extrapolated along their own velocity by `combat-visual.ts`), HP from `PlayerState.hp`. A wreck stops driving, predicting, and interpolating, and gains the spectate controls in `spectate.ts`.
