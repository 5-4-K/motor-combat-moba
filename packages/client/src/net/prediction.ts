import { stepSim, type InputMessage, type SimBody } from "@motor-arena/shared";

export class PredictionBuffer {
  predict(pose: SimBody, input: InputMessage, dt: number): SimBody {
    return stepSim(pose, input, dt);
  }

  reconcile(_predicted: SimBody, authoritative: SimBody): SimBody {
    return { x: authoritative.x, y: authoritative.y, angle: authoritative.angle };
  }
}
