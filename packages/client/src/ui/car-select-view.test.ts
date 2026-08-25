import { describe, expect, it } from "vitest";
import { CAR_TABLE, TICK_RATE_HZ, forwardMaxSpeedOf, hpOf } from "@motor-combat-moba/shared";
import { CAR_BARS, carSelectView, fullStatsFor } from "./car-select-view.js";

const state = (over = {}) => ({
  mode: 1 as const,
  tick: 0,
  carSelectDeadlineTick: 60 * TICK_RATE_HZ,
  ...over,
});

describe("fullStatsFor", () => {
  it("derives every row from the shared config, never from hardcoded numbers", () => {
    const rows = fullStatsFor("rectangle");
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Top speed"]).toBe(`${forwardMaxSpeedOf("rectangle")} u/s`);
    expect(byLabel["Hull HP"]).toBe(String(hpOf("rectangle")));
  });

  it("matches the documented Rectangle top speed of 360", () => {
    expect(fullStatsFor("rectangle").find((r) => r.label === "Top speed")?.value).toBe("360 u/s");
  });

  it("halves the top speed for reverse", () => {
    expect(fullStatsFor("rectangle").find((r) => r.label === "Reverse speed")?.value).toBe("180 u/s");
  });

  it("shows the ram cooldown in seconds, not raw ticks", () => {
    expect(fullStatsFor("oval").find((r) => r.label === "Hit cooldown")?.value).toBe("0.5 s");
  });

  it("lists the seven rows the design specifies, in order", () => {
    expect(fullStatsFor("hexagon").map((r) => r.label)).toEqual([
      "Top speed",
      "Reverse speed",
      "Turn rate",
      "Hull HP",
      "Ram damage",
      "Hit cooldown",
      "Hull size",
    ]);
  });

  it("gives each car its own numbers", () => {
    const speed = (id: "rectangle" | "oval" | "hexagon") =>
      fullStatsFor(id).find((r) => r.label === "Top speed")?.value;
    expect(new Set([speed("rectangle"), speed("oval"), speed("hexagon")]).size).toBe(3);
  });
});

describe("carSelectView", () => {
  it("offers every car in CAR_TABLE", () => {
    const view = carSelectView(state(), "rectangle", false);
    expect(view.cars.map((c) => c.id)).toEqual(Object.keys(CAR_TABLE));
  });

  it("marks only the selected card", () => {
    const view = carSelectView(state(), "oval", false);
    expect(view.cars.filter((c) => c.selected).map((c) => c.id)).toEqual(["oval"]);
  });

  it("scales each bar to the raw 0-10 rating", () => {
    const rect = carSelectView(state(), "rectangle", false).cars[0];
    const speedBar = rect?.bars.find((b) => b.key === "speed");
    expect(speedBar?.percent).toBe(CAR_TABLE.rectangle.speed * 10);
  });

  it("carries the three summary bars the card shows", () => {
    const rect = carSelectView(state(), "rectangle", false).cars[0];
    expect(rect?.bars.map((b) => b.key)).toEqual(CAR_BARS);
  });

  it("titles the stats panel with the selected car", () => {
    expect(carSelectView(state(), "hexagon", false).selectedName).toBe("Hexagon");
  });

  it("counts the deadline down and turns urgent at ten seconds", () => {
    expect(carSelectView(state(), "rectangle", false).urgent).toBe(false);
    const late = carSelectView(state({ tick: 51 * TICK_RATE_HZ }), "rectangle", false);
    expect(late.secondsLeft).toBe(9);
    expect(late.urgent).toBe(true);
  });

  it("formats the clock as m:ss", () => {
    expect(carSelectView(state(), "rectangle", false).clock).toBe("1:00");
    expect(carSelectView(state({ tick: 13 * TICK_RATE_HZ }), "rectangle", false).clock).toBe("0:47");
  });

  it("disables locking in once the pick is committed", () => {
    expect(carSelectView(state(), "rectangle", false).canLockIn).toBe(true);
    expect(carSelectView(state(), "rectangle", true).canLockIn).toBe(false);
  });

  it("says so when the pick is already locked", () => {
    expect(carSelectView(state(), "rectangle", true).lockLabel).toBe("Locked in");
    expect(carSelectView(state(), "rectangle", false).lockLabel).toBe("Lock in");
  });
});
