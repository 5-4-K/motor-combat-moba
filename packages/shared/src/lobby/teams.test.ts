import { describe, expect, it } from "vitest";
import { pickTeam, pickColor } from "./teams.js";

describe("pickTeam", () => {
  it("joins the smaller team", () => {
    expect(pickTeam([0, 0, 1], () => 0)).toBe(1);
    expect(pickTeam([0, 1, 1], () => 0)).toBe(0);
  });
  it("uses random when equal", () => {
    expect(pickTeam([0, 1], () => 0)).toBe(0);
    expect(pickTeam([0, 1], () => 0.9)).toBe(1);
  });
});

describe("pickColor", () => {
  it("returns an unused colorId", () => {
    const id = pickColor([0, 1, 2], () => 0);
    expect([3, 4, 5]).toContain(id);
  });
});
