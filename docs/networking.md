# Networking

Clients must never send poses. The wire message is `INPUT_MESSAGE` (`"input"`): `{ seq, steer, throttle, fireSlots }` (`InputMessage` in shared) — `fireSlots` is a uint8 bitmask, bit 0 = slot 1, replacing the old single `fire` boolean. Server `isInputMessage` validates then enqueues. `withSimulatedLatency` delays enqueue when `SIM_LATENCY_MS` / `SIM_JITTER_MS` are set; otherwise pass-through.

`ArenaRoom` ticks at sim rate (`TICK_RATE_HZ`) and patches at a different rate (`DEFAULT_PATCH_RATE_HZ`). `serverTick` applies queued inputs through shared `stepSim`.

## Server

Per tick, per player, in sorted `sessionId` order:

- inputs are applied in **seq** order, not arrival order — independent per-message latency reorders them routinely;
- at most `NET_CONFIG.maxInputsPerTick` are simulated; the rest are still drained and still acked;
- `PlayerState.lastProcessedInputSeq` ends on the highest seq drained;
- only `PlayerStatus.IN_MATCH` players move, and only they are solid to each other.

`lastProcessedInputSeq` is never reset, so a client's `seq` must stay monotonic for the whole connection — a client that restarted its counter would sit below the standing ack and have every pending input discarded.

## Client — movement (P4, real)

`ArenaScene` accumulates frame `delta` and emits exactly one input per `MS_PER_TICK`, so send rate is independent of frame rate. Catch-up after a hitch is capped at `MS_PER_TICK * NET_CONFIG.maxInputsPerTick` — predicting past what the server will apply only manufactures divergence.

**Prediction.** `PredictionBuffer.predict` pushes the input onto a pending buffer capped at `NET_CONFIG.pendingInputCap` (oldest dropped on overflow) and advances the local pose through the same shared `stepSim`. The local car therefore answers on the frame the key is pressed.

**Reconciliation.** On every state patch, `PredictionBuffer.reconcile(authoritative, lastProcessedSeq, currentPredicted, ctx)`:

1. drops pending inputs by the **predicate** `seq <= lastProcessedSeq` — never by position or a remembered cursor. The ack can legitimately walk *backwards* between ticks (a high-seq input can land in tick N's batch while a lower-seq one lands in tick N+1's), and under the predicate a stale lower ack is a harmless no-op;
2. replays the remaining tail from the authoritative pose to get the target;
3. if `hypot(dx, dy) > NET_CONFIG.reconcileSnapPos`, or the **wrapped** angle error exceeds `reconcileSnapAngle`, returns the target outright;
4. otherwise eases `x`, `y` and `angle` by `reconcileEaseRate` — angle along the wrapped delta, so it takes the short way — and **snaps** `speed` and `reverseHold` to the target. Those are derived sim fields that feed the next integration; a half-eased value would poison every following step, not merely look wrong.

Angle comparisons are wrapped (`atan2(sin d, cos d)`) because `stepDrive` never normalises `angle`: after minutes of turning it is thousands of radians, and a raw subtraction would measure accumulated winding rather than error.

**Prediction context.** `StepContext` is `stepSim`'s input, so the client's copy must describe the same world the server's does. The parts that decide *who is solid* and *how a hull is sized* are not duplicated — `carIdOf`, `isOnField` and `otherCarHulls` live in `@motor-combat-moba/shared` (`sim/context.ts`) and **both** `serverTick` and the client's `buildStepContext` call them. Change a hull dimension or the fallback chassis there and both sides move together.

What each side still owns is getting its roster into **sorted `sessionId` order** before calling `otherCarHulls`: `resolveWorld` resolves contacts sequentially and the last one resolved is the one guaranteed to end separated, so order changes the result. The server sorts once per tick and reuses the array; the client rebuilds it from `MapSchema.forEach`.

Note the split gate: the `IN_MATCH` filter inside `otherCarHulls` is the **wall** half (who is solid). The **mover** half — whether the local player's inputs move anything — is `ArenaScene.canDrive`, mirroring the server's own mover gate. Remotes enter the context at their last-known server pose; the client predicts only itself.

**Interpolation.** Remotes are drawn from `InterpolationBuffer`, sampled at `now - NET_CONFIG.interpolationDelayMs`. Position lerps between the bracketing snapshots; angle lerps through `atan2` of blended sines and cosines so it crosses the ±π seam the short way. Past the newest snapshot it **holds** rather than extrapolating — a guessed pose slid through a wall the server bounced off is worse than a frame or two of freeze. Old snapshots outside the delay window are pruned, so the buffer does not grow with match length.

**Local render blend.** Prediction advances on the sim clock (`drainTicks`), so at 60 Hz the predicted pose changes every other frame. Drawing it raw makes the local car hold-and-jump while the camera eases and remotes glide, which reads as a doubled, smeared sprite in motion. `ArenaScene.localRenderPose` therefore draws `blendPose(previousPredicted, predicted, accMs / MS_PER_TICK)` — the previous tick blended toward the newest by how far the input accumulator is through the current tick. It is render-only: `predicted` is still what the next step and reconcile read, and a reconcile correction is simply carried across the rest of the tick window by the same blend.

`CAMERA_CONFIG` (`camLerp`, `zoom`, `freeRoamSpeed`) is a render knob only — nothing in `stepSim` reads it.

## Client — combat

Combat is not predicted at all. `fireSlots` rides the wire with steer and throttle, and the server decides everything that follows: whether a slot's stocks and locks allowed a shot, where it went, and what it hit. `ArenaScene` draws `state.weapons` (projectile and beam instances alike) and the HP it is told about, and spawns no local shot of its own — a predicted bullet the server never fired either vanishes or, worse, reads as a hit that never happened, and there is no honest way to reconcile "you were dead for 80 ms".

The one client-side liberty is cosmetic: a projectile is advanced along its **own constant velocity** between patches, and a beam's `extent` is grown the same way (`extrapolateShot` / `instanceDrawShape` in `combat-visual.ts`, both capped at one patch interval). That is exact rather than a guess — the server integrates the identical motion — and nothing it produces feeds back into state. See [`combat-model.md`](combat-model.md) for the weapon state machine `fireSlots` is gated by.

Firing rides the same gate as movement. `serverTick` reports the session ids that asked to fire on an input it actually **simulated**, so an input past `NET_CONFIG.maxInputsPerTick` cannot buy a shot the sim never ran. `canDrive` gains `alive` in P5: a wreck stops sending inputs and stops predicting, because the server has stopped stepping it.

v1 hit detection is **current-tick**: no rewind, no lag compensation, so a shooter leads a moving target by roughly their own latency. LAN latency is what makes that acceptable. See [`combat-model.md`](combat-model.md).
