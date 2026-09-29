import { SNAPSHOT_RATE_HZ, TICK_RATE_HZ } from "@motor-combat-moba/shared";

/**
 * Whether the room broadcasts a snapshot at the end of this tick (NR12). A snapshot is always the
 * state of exactly one tick and carries that tick (`ArenaState.tick`); the rooms set
 * `patchRate = null` and call `broadcastPatch()` themselves, so no wall-clock patch timer can land
 * between two ticks. The netsim harness (`netsim/run.ts`) sends on the same test.
 */
export function isSnapshotTick(tick: number): boolean {
  return tick % (TICK_RATE_HZ / SNAPSHOT_RATE_HZ) === 0;
}
