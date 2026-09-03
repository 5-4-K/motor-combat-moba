import { describe, expect, it } from "vitest";
import { practiceSummaryRows } from "./practice-summary.js";

const players = [
  { sessionId: "abc", name: "Riku", carId: "mirage", colorId: 0, kills: 3, deaths: 1 },
  { sessionId: "bot", name: "Bot", carId: "bastion", colorId: 1, kills: 1, deaths: 3 },
];

describe("practiceSummaryRows", () => {
  it("puts the human first, whatever the map order", () => {
    expect(practiceSummaryRows([...players].reverse(), "abc")[0]!.name).toBe("Riku");
  });

  it("marks exactly one row as you", () => {
    expect(practiceSummaryRows(players, "abc").filter((r) => r.isYou)).toHaveLength(1);
  });

  it("carries kills and deaths through untouched", () => {
    const [you] = practiceSummaryRows(players, "abc");
    expect(you).toMatchObject({ kills: 3, deaths: 1 });
  });

  it("declares no winner — a practice session has no win condition (PR9)", () => {
    const rows = practiceSummaryRows(players, "abc");
    expect(rows.every((row) => !("winner" in row))).toBe(true);
  });
});
