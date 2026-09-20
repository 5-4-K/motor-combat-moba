export const INPUT_MESSAGE = "input";

export interface InputMessage {
  seq: number;
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  /** Slot bitmask: bit 0 = fire slot 0, the basic attack; 1..N are the abilities (VS15). The
   *  server masks it to the car's real slots before simulating. */
  fireSlots: number;
}
