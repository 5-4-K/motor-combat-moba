export const INPUT_MESSAGE = "input";

/**
 * The input wire shape moved to `tick-input.ts` with Phase D (NR25): a packet of tick-stamped
 * frames, `seq` gone because the tick is the sequence number. Re-exported here so an import of the
 * old path still finds the types `stepSim` reads.
 */
export type { InputFrame, InputKeys, InputPacket } from "./tick-input.js";
