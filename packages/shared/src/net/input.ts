export const INPUT_MESSAGE = "input";

export interface InputMessage {
  seq: number;
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fire: boolean;
}
