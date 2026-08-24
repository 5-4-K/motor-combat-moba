import type { InputMessage } from "../net/input.js";

export interface SimBody {
  x: number;
  y: number;
  angle: number;
  speed: number;
  reverseHold: number;
}

export function stepSim(body: SimBody, _input: InputMessage, _dt: number): SimBody {
  return { x: body.x, y: body.y, angle: body.angle, speed: body.speed, reverseHold: body.reverseHold };
}
