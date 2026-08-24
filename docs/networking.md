# Networking (P0 seams)

Clients must never send poses. The wire message is `INPUT_MESSAGE` (`"input"`): `{ seq, steer, throttle, fire }` (`InputMessage` in shared). Server `isInputMessage` validates then enqueues. `withSimulatedLatency` delays enqueue when `SIM_LATENCY_MS` / `SIM_JITTER_MS` are set; otherwise pass-through.

`ArenaRoom` ticks at sim rate and patches at a different rate. `serverTick` applies queued inputs through shared `stepSim`.

Client: `PredictionBuffer.predict` calls `stepSim`; `reconcile` copies the authoritative pose. `InterpolationBuffer` stores the latest pose and `sample`s it (no time blend). **P4 replaces these stubs** with replay prediction and interpolation.

P0 client does not send `input` yet. Join renders server placeholders; driving starts in P4.
