import { describe, expect, it } from "vitest";
import {
  CAR_TABLE,
  DRIVE_CONFIG,
  TICK_RATE_HZ,
  accelOf,
  activeCarIds,
  forwardMaxSpeedOf,
  hpOf,
  reverseMaxSpeedOf,
  turnRateOf,
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
    const rows = fullStatsFor("mirage");
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Top speed"]).toBe(`${forwardMaxSpeedOf("mirage")} u/s`);
    expect(byLabel["Hull HP"]).toBe(String(hpOf("mirage")));
  });

  it("reports Mirage's top speed straight from the shared config", () => {
    // Derived rather than pinned to a literal: these rows exist to mirror DRIVE_CONFIG, so a
    // hardcoded number here fails every tuning pass without ever catching a real display bug.
    expect(fullStatsFor("mirage").find((r) => r.label === "Top speed")?.value).toBe(
      `${forwardMaxSpeedOf("mirage")} u/s`,
    );
  });

  it("scales reverse speed by the configured ratio", () => {
    // Rounded to match the panel's own `trim` (one decimal, no float noise): mirage's reverse speed
    // is now 576 * 0.65 = 374.4, which IEEE-754 represents as 374.40000000000003 — a raw
    // string-interpolation of the float would fail against the panel's trimmed display.
    expect(fullStatsFor("mirage").find((r) => r.label === "Reverse speed")?.value).toBe(
      `${Math.round(reverseMaxSpeedOf("mirage") * 100) / 100} u/s`,
    );
    expect(reverseMaxSpeedOf("mirage")).toBeCloseTo(
      forwardMaxSpeedOf("mirage") * DRIVE_CONFIG.reverseSpeedRatio,
      9,
    );
  });

  it("derives acceleration, turn rate and turn radius from the shared config, per car", () => {
    // The panel rounds to at most one decimal for display, so parse the number back out rather
    // than string-matching the raw float (turnRateOf can land on 6.300000000000001).
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const rows = fullStatsFor(id);
      const accelRow = rows.find((r) => r.label === "Acceleration")!;
      expect(accelRow.value.endsWith(" u/s²")).toBe(true);
      expect(Number(accelRow.value.replace(" u/s²", ""))).toBeCloseTo(accelOf(id), 1);

      const turnRateRow = rows.find((r) => r.label === "Turn rate")!;
      expect(turnRateRow.value.endsWith(" rad/s")).toBe(true);
      expect(Number(turnRateRow.value.replace(" rad/s", ""))).toBeCloseTo(turnRateOf(id), 1);

      const turnRadiusRow = rows.find((r) => r.label === "Turn radius")!;
      expect(turnRadiusRow.value.endsWith(" u")).toBe(true);
      expect(Number(turnRadiusRow.value.replace(" u", ""))).toBeCloseTo(
        forwardMaxSpeedOf(id) / turnRateOf(id),
        1,
      );
    }
  });

  it("lists the design's rows plus one damage row per equipped weapon, in order", () => {
    expect(fullStatsFor("bastion").map((r) => r.label)).toEqual([
      "Top speed",
      "Reverse speed",
      "Acceleration",
      "Turn rate",
      "Turn radius",
      "Hull HP",
      "Mass",
      "Hull size",
      "Thumper damage",
      "Roadblock damage",
      "Wild Charge damage",
    ]);
  });

  it("gives each car its own numbers", () => {
    const speed = (id: "mirage" | "bullseye" | "bastion") =>
      fullStatsFor(id).find((r) => r.label === "Top speed")?.value;
    expect(new Set([speed("mirage"), speed("bullseye"), speed("bastion")]).size).toBe(3);
  });

  it("shows each chassis's own damage for every weapon it carries", () => {
    // Literals, not a re-derivation: comparing against weaponDamageOf would pass just as well
    // against a hard-coded panel, and would not catch the row being wired to the wrong car. Each
    // chassis's slot-1 weapon is its own id (no shared damage row across all three), so this pins
    // each chassis's actual opener by label AND value. `fireball`/`needler` retired outright and
    // `predator`/`magmablast` shipped in their place by the 2026-09-01 roster cutover (O17); bastion's
    // opener (`thumper`) is unchanged.
    const expected: Record<keyof typeof CAR_TABLE, { label: string; value: string }> = {
      mirage: { label: "Predator damage", value: "28" },
      bullseye: { label: "Magma Blast damage", value: "23" },
      bastion: { label: "Thumper damage", value: "55" },
    };
    for (const id of Object.keys(CAR_TABLE) as (keyof typeof CAR_TABLE)[]) {
      const row = fullStatsFor(id).find((r) => r.label === expected[id].label);
      expect(row).toBeDefined();
      expect(row!.value).toBe(expected[id].value);
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
    expect(fullStatsFor("bastion").find((r) => r.label === "Hull HP")!.value).toBe("900");
  });

  it("shows mass among the full stats", () => {
    const rows = fullStatsFor("bastion");
    const mass = rows.find((r) => r.label === "Mass");
    expect(mass?.value).toBe("900");
  });

  it("shows a heavier mass for the tank than the speedster", () => {
    const of = (id: CarId) => fullStatsFor(id).find((r) => r.label === "Mass")!.value;
    expect(Number(of("bastion"))).toBeGreaterThan(Number(of("mirage")));
  });
});

describe("carSelectView", () => {
  it("offers only active cars, in activeCarIds order", () => {
    // All three ship active today, so this also equals Object.keys(CAR_TABLE) — but the grid is
    // meant to track activeCarIds, not the full roster, once an inactive car lands.
    const view = carSelectView(state(), "mirage", false);
    expect(view.cars.map((c) => c.id)).toEqual(activeCarIds());
  });

  it("marks only the selected card", () => {
    const view = carSelectView(state(), "bullseye", false);
    expect(view.cars.filter((c) => c.selected).map((c) => c.id)).toEqual(["bullseye"]);
  });

  it("carries each bar's rating verbatim, already on a 0-100 scale", () => {
    const rect = carSelectView(state(), "mirage", false).cars[0];
    const speedBar = rect?.bars.find((b) => b.key === "speed");
    expect(speedBar?.percent).toBe(CAR_TABLE.mirage.speed);
  });

  it("carries the three summary bars the card shows", () => {
    const rect = carSelectView(state(), "mirage", false).cars[0];
    expect(rect?.bars.map((b) => b.key)).toEqual(CAR_BARS);
  });

  it("titles the stats panel with the selected car", () => {
    expect(carSelectView(state(), "bastion", false).selectedName).toBe("Bastion");
  });

  it("counts the deadline down and turns urgent at ten seconds", () => {
    expect(carSelectView(state(), "mirage", false).urgent).toBe(false);
    const late = carSelectView(state({ tick: 51 * TICK_RATE_HZ }), "mirage", false);
    expect(late.secondsLeft).toBe(9);
    expect(late.urgent).toBe(true);
  });

  it("formats the clock as m:ss", () => {
    expect(carSelectView(state(), "mirage", false).clock).toBe("1:00");
    expect(carSelectView(state({ tick: 13 * TICK_RATE_HZ }), "mirage", false).clock).toBe("0:47");
  });

  it("disables locking in once the pick is committed", () => {
    expect(carSelectView(state(), "mirage", false).canLockIn).toBe(true);
    expect(carSelectView(state(), "mirage", true).canLockIn).toBe(false);
  });

  it("says so when the pick is already locked", () => {
    expect(carSelectView(state(), "mirage", true).lockLabel).toBe("Locked in");
    expect(carSelectView(state(), "mirage", false).lockLabel).toBe("Lock in");
  });
});
