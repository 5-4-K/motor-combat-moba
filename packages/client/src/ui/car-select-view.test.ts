import { describe, expect, it } from "vitest";
import {
  CAR_TABLE,
  DRIVE_CONFIG,
  TICK_RATE_HZ,
  forwardMaxSpeedOf,
  hpOf,
  massOf,
  reverseMaxSpeedOf,
  weaponDamageOf,
  weaponDefOf,
  type CarId,
} from "@motor-combat-moba/shared";
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

  it("reports Rectangle's top speed straight from the shared config", () => {
    // Derived rather than pinned to a literal: these rows exist to mirror DRIVE_CONFIG, so a
    // hardcoded number here fails every tuning pass without ever catching a real display bug.
    expect(fullStatsFor("rectangle").find((r) => r.label === "Top speed")?.value).toBe(
      `${forwardMaxSpeedOf("rectangle")} u/s`,
    );
  });

  it("scales reverse speed by the configured ratio", () => {
    expect(fullStatsFor("rectangle").find((r) => r.label === "Reverse speed")?.value).toBe(
      `${reverseMaxSpeedOf("rectangle")} u/s`,
    );
    expect(reverseMaxSpeedOf("rectangle")).toBeCloseTo(
      forwardMaxSpeedOf("rectangle") * DRIVE_CONFIG.reverseSpeedRatio,
      9,
    );
  });

  it("lists the design's rows plus one damage row per equipped weapon, in order", () => {
    expect(fullStatsFor("hexagon").map((r) => r.label)).toEqual([
      "Top speed",
      "Reverse speed",
      "Turn rate",
      "Hull HP",
      "Mass",
      "Hull size",
      "Fireball damage",
    ]);
  });

  it("gives each car its own numbers", () => {
    const speed = (id: "rectangle" | "oval" | "hexagon") =>
      fullStatsFor(id).find((r) => r.label === "Top speed")?.value;
    expect(new Set([speed("rectangle"), speed("oval"), speed("hexagon")]).size).toBe(3);
  });

  it("shows each chassis's own damage for every weapon it carries", () => {
    // Literals, not a re-derivation: comparing against weaponDamageOf would pass just as well
    // against a hard-coded panel, and would not catch the row being wired to the wrong car.
    const expected: Record<keyof typeof CAR_TABLE, string> = {
      rectangle: "40",
      oval: "60",
      hexagon: "50",
    };
    for (const id of Object.keys(CAR_TABLE) as (keyof typeof CAR_TABLE)[]) {
      const row = fullStatsFor(id).find((r) => r.label === "Fireball damage");
      expect(row).toBeDefined();
      expect(row!.value).toBe(expected[id]);
    }
  });

  it("derives the number rather than transcribing it, so a retune moves the screen too", () => {
    // This guards drift after a future balance retune: if weaponDamageOf changes, this row must
    // move with it. It does not, on its own, prove today's panel isn't hard-coded — the literal
    // test above covers that. Matched by exact label (not a "damage" suffix) so a future
    // multi-weapon chassis pairs each row with its own weapon rather than always the first.
    for (const id of Object.keys(CAR_TABLE) as (keyof typeof CAR_TABLE)[]) {
      const rows = fullStatsFor(id);
      for (const weaponId of CAR_TABLE[id].weapons) {
        const row = rows.find((r) => r.label === `${weaponDefOf(weaponId).name} damage`);
        expect(row).toBeDefined();
        expect(row!.value).toBe(String(weaponDamageOf(id, weaponId)));
      }
    }
  });

  it("still reports the hull HP the sim actually gives the car", () => {
    expect(fullStatsFor("hexagon").find((r) => r.label === "Hull HP")!.value).toBe("700");
  });

  it("shows mass among the full stats", () => {
    const rows = fullStatsFor("hexagon");
    const mass = rows.find((r) => r.label === "Mass");
    expect(mass?.value).toBe("850");
  });

  it("shows a heavier mass for the tank than the speedster", () => {
    const of = (id: CarId) => fullStatsFor(id).find((r) => r.label === "Mass")!.value;
    expect(Number(of("hexagon"))).toBeGreaterThan(Number(of("rectangle")));
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

  it("carries each bar's rating verbatim, already on a 0-100 scale", () => {
    const rect = carSelectView(state(), "rectangle", false).cars[0];
    const speedBar = rect?.bars.find((b) => b.key === "speed");
    expect(speedBar?.percent).toBe(CAR_TABLE.rectangle.speed);
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
