import { describe, expect, it } from "vitest";
import { advanceConquer, readZone, resetZone } from "./conquer-room.js";

const fields = () => ({
  controlTicksA: 0, controlTicksB: 0, zoneHolder: -1, zoneStreakTicks: 0,
  zoneContested: false, overtime: false, tick: 0, matchEndsTick: 10_000,
});
const zone = { x: 0, y: 0, radius: 50 };
const inA = { x: 0, y: 0, team: 0, alive: true, inRoster: true };
const inB = { x: 1, y: 1, team: 1, alive: true, inRoster: true };

describe("advanceConquer (CQ44)", () => {
  it("writes the stepped zone back and fills after the delay", () => {
    const f = fields();
    for (let i = 0; i < 4; i++) {
      f.tick += 1;
      expect(advanceConquer(f, zone, [inA], 3, 100)).toStrictEqual({ ended: false });
    }
    expect(readZone(f)).toStrictEqual({ controlTicks: [1, 0], holder: 0, streak: 3, contested: false });
    advanceConquer(f, zone, [inA, inB], 3, 100);
    expect([f.zoneHolder, f.zoneStreakTicks, f.zoneContested]).toStrictEqual([-1, 0, true]);
  });

  it("ends on a full bar and sets overtime on a tie at the clock", () => {
    const f = { ...fields(), controlTicksA: 99, zoneHolder: 0, zoneStreakTicks: 3 };
    expect(advanceConquer(f, zone, [inA], 3, 100)).toStrictEqual({ ended: true, winnerTeam: 0 });
    const g = { ...fields(), tick: 10_000 };
    expect(advanceConquer(g, zone, [], 3, 100)).toStrictEqual({ ended: false });
    expect(g.overtime).toBe(true);
  });

  it("resetZone zeroes everything", () => {
    const f = { ...fields(), controlTicksA: 5, zoneHolder: 1, zoneStreakTicks: 2, zoneContested: true, overtime: true };
    resetZone(f);
    expect(f).toMatchObject({ controlTicksA: 0, controlTicksB: 0, zoneHolder: -1, zoneStreakTicks: 0, zoneContested: false, overtime: false });
  });
});
