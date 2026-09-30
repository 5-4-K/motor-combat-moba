import type { InputKeys, TickInputBuffer } from "@motor-combat-moba/shared";

/**
 * An in-process producer's input for the tick about to run (NR27, lead 0): a bot, the playground's
 * parked seats, the balance and playtest harnesses. It goes into the same `TickInputBuffer` a human's
 * frames do, so every car on every path is stepped by the one consumption rule.
 *
 * `tick` is the tick the input is FOR — the one the next `serverTick` simulates — and it is offered
 * against `tick - 1`, the last tick the room completed. A caller that runs before its room's
 * `state.tick += 1` passes `state.tick + 1`; one that runs after the increment passes `state.tick`.
 * Either way the frame is exactly one tick ahead of the buffer's clock, so it is never late and never
 * early. Only whitelisted keys reach the buffer (it copies them), whatever else `keys` carries.
 */
export function offerForTick(buffer: TickInputBuffer, tick: number, keys: InputKeys): void {
  buffer.offer({ ...keys, tick }, tick - 1);
}
