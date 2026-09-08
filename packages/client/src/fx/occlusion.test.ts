import { describe, expect, it } from "vitest";
import { DRIVE_CONFIG } from "@motor-combat-moba/shared";
import { ENVIRONMENT_FX } from "./environment.js";
import { eraserStampHeight, eraserStampsFor, eraserStampWidth } from "./occlusion.js";

const car = (sessionId: string, alive = true) => ({
  sessionId,
  x: 300,
  y: 400,
  angle: 0.7,
  hp: 50,
  alive,
  carId: "bastion",
  vx: 0,
  vy: 0,
});

describe("eraserStampsFor", () => {
  it("stamps once per living car, at its pose", () => {
    const stamps = eraserStampsFor([car("a"), car("b")]);
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toMatchObject({ x: 300, y: 400, angle: 0.7, carId: "bastion" });
  });

  it("stamps BIGGER than the hull, so the halo clears the car rather than tracing it", () => {
    const [stamp] = eraserStampsFor([car("a")]);
    expect(stamp.width).toBeGreaterThan(DRIVE_CONFIG.carWidth);
    expect(stamp.height).toBeGreaterThan(DRIVE_CONFIG.carHeight);
    expect(stamp.width).toBe(DRIVE_CONFIG.carWidth + ENVIRONMENT_FX.occlusion.halo * 2);
  });

  it("skips a dead car — a wreck is gone, and smoke should close over where it was", () => {
    expect(eraserStampsFor([car("a", false)])).toEqual([]);
  });

  it("returns nothing for an empty field rather than throwing", () => {
    expect(eraserStampsFor([])).toEqual([]);
  });

  it("keeps each car's own carId, so the mask uses that chassis's silhouette", () => {
    const stamps = eraserStampsFor([{ ...car("a"), carId: "mirage" }, { ...car("b"), carId: "bullseye" }]);
    expect(stamps.map((s) => s.carId)).toEqual(["mirage", "bullseye"]);
  });
});

describe("occlusion reads the environment table", () => {
  it("grows the stamp box with the halo", () => {
    const env = { ...ENVIRONMENT_FX, occlusion: { halo: 30 } };
    expect(eraserStampWidth(env)).toBe(DRIVE_CONFIG.carWidth + 60);
    expect(eraserStampHeight(env)).toBe(DRIVE_CONFIG.carHeight + 60);
  });

  it("defaults to the shipped halo of 14", () => {
    expect(eraserStampWidth()).toBe(DRIVE_CONFIG.carWidth + 28);
  });

  it("sizes each stamp from the same env it was given", () => {
    const env = { ...ENVIRONMENT_FX, occlusion: { halo: 30 } };
    const cars = [{ sessionId: "a", x: 1, y: 2, angle: 0, hp: 10, alive: true, carId: "bastion", vx: 0, vy: 0 }];
    expect(eraserStampsFor(cars, env)[0]!.width).toBe(DRIVE_CONFIG.carWidth + 60);
  });
});
