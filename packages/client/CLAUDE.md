# `@motor-arena/client`

Phaser 3 render + join. Boot → Join → Arena. Placeholder rectangles from server `{x, y, angle}`. `PredictionBuffer` / `InterpolationBuffer` are identity stubs.

**Local invariant:** send inputs (and later lobby intents) only — never authoritative sim state. P0 does not send `input` yet; P4 will.
