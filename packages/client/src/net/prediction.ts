import { stepSim, type InputMessage, type SimBody, type StepContext } from "@motor-arena/shared";

export class PredictionBuffer {
  // P4 Task 4: still a pass-through. The pending-input buffer, the replay-on-reconcile, and the
  // real per-frame `StepContext` (live `others` from the room state) all land with Task 4.
  predict(pose: SimBody, input: InputMessage, dt: number, ctx: StepContext): SimBody {
    return stepSim(pose, input, dt, ctx);
  }

  reconcile(_predicted: SimBody, authoritative: SimBody): SimBody {
    return {
      x: authoritative.x,
      y: authoritative.y,
      angle: authoritative.angle,
      speed: authoritative.speed,
      reverseHold: authoritative.reverseHold,
    };
  }
}
