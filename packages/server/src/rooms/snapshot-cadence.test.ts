import { describe, expect, it } from "vitest";
import { SNAPSHOT_RATE_HZ, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { isSnapshotTick } from "./snapshot-cadence.js";

describe("isSnapshotTick (NR12)", () => {
  it("fires every TICK_RATE_HZ / SNAPSHOT_RATE_HZ ticks", () => {
    const every = TICK_RATE_HZ / SNAPSHOT_RATE_HZ;
    const fired = [...Array(12).keys()].filter(isSnapshotTick);
    expect(fired).toEqual([...Array(12).keys()].filter((t) => t % every === 0));
  });
  it("the snapshot rate divides the tick rate", () => {
    expect(Number.isInteger(TICK_RATE_HZ / SNAPSHOT_RATE_HZ)).toBe(true);
  });
});
