export const INPUT_MESSAGE = "input";

export interface InputMessage {
  seq: number;
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  /** Slot bitmask: bit 0 = slot 1. The server masks it to the car's real slots before simulating. */
  fireSlots: number;
}
