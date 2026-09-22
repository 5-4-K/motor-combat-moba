import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { CAR_TABLE, type TuningValue } from "@motor-combat-moba/shared";
import type { AssetManifest, SpriteEntry } from "../../assets/manifest-schema.js";
import { carScaleKey } from "../../scenes/turret-view.js";
import {
  clearTurretSimPaths,
  isTurretSimPath,
  turretExportText,
  turretSimSections,
  withoutTurretSimPaths,
} from "./turret-model.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

function row(over: Partial<SpriteEntry> = {}): SpriteEntry {
  return { file: "turrets/default.png", rotationOffset: 0, scale: "fit", colorMode: "tint", origin: [0.31, 0.5], ...over };
}

const DEFAULT_ONLY: AssetManifest = { sprites: { "turret.default": row() } };

describe("turret panel model (TR58, TR61)", () => {
  it("offers the two global knobs first, then one mount section per CAR_TABLE row, inactive ones marked", () => {
    const sections = turretSimSections();
    expect(sections[0]!.carId).toBeUndefined();
    expect(sections[0]!.fields.map((f) => f.path).sort()).toEqual([
      "turret.maxSwingDeg",
      "turret.turnRateDegPerSec",
    ]);
    const cars = sections.slice(1);
    expect(cars.map((s) => s.carId)).toEqual(Object.keys(CAR_TABLE));
    for (const section of cars) {
      const car = CAR_TABLE[section.carId!];
      expect(section.inactive).toBe(!car.isActive);
      expect(section.title).toBe(car.name);
      expect(section.fields.map((f) => f.label)).toEqual(["turretMount.x", "turretMount.y"]);
    }
  });

  it("tells a turret path from a Physics one, so each panel's reset clears only its own", () => {
    expect(isTurretSimPath("turret.turnRateDegPerSec")).toBe(true);
    expect(isTurretSimPath("car.mirage.turretMount.y")).toBe(true);
    expect(isTurretSimPath("car.mirage.speed")).toBe(false);
    expect(isTurretSimPath("drive.baseTurnRate")).toBe(false);

    const shared: Record<string, TuningValue> = {
      "turret.maxSwingDeg": 180,
      "car.bastion.turretMount.x": 5,
      "car.bastion.hp": 50,
    };
    clearTurretSimPaths(shared);
    expect(shared).toEqual({ "car.bastion.hp": 50 });

    const both: Record<string, TuningValue> = { "turret.maxSwingDeg": 180, "car.bastion.hp": 50 };
    expect(withoutTurretSimPaths(both)).toEqual({ "car.bastion.hp": 50 });
    expect(both).toEqual({ "turret.maxSwingDeg": 180, "car.bastion.hp": 50 });
  });

  it("exports nothing when nothing moved", () => {
    expect(turretExportText({ "car.mirage.speed": 70 }, {}, DEFAULT_ONLY)).toBe("");
  });

  it("names the file and field every changed value belongs in", () => {
    const text = turretExportText(
      { "turret.turnRateDegPerSec": 720, "turret.maxSwingDeg": 240, "car.bastion.turretMount.y": -3 },
      { crosshairMaxDistance: 120, lengthUnits: 40 },
      DEFAULT_ONLY,
    );
    expect(text).toContain("packages/shared/src/config/turret-config.ts");
    expect(text).toContain("TURRET_CONFIG.turnRateDegPerSec = 720");
    expect(text).toContain("TURRET_CONFIG.maxSwingDeg = 240");
    // The whole mount, so the untouched axis is written back as its shipped value.
    expect(text).toContain("packages/shared/src/config/car-config.ts");
    expect(text).toContain("CAR_TABLE.bastion.turretMount = { x: 0, y: -3 }");
    expect(text).toContain("packages/client/src/config/crosshair.ts");
    expect(text).toContain("CROSSHAIR_CONFIG.maxDistance = 120");
    expect(text).toContain("packages/client/src/config/turret-visual.ts");
    expect(text).toContain("TURRET_VISUAL.lengthUnits = 40");
    // A Physics-panel path in the same map is not this panel's to export.
    expect(text).not.toContain("speed");
  });

  it("writes a per-car size as that car's manifest scale, on top of its row's own numeric scale", () => {
    const manifest: AssetManifest = {
      sprites: { "turret.default": row(), "turret.mirage": row({ file: "turrets/mirage.png", scale: 1.2 }) },
    };
    const text = turretExportText({}, { [carScaleKey("mirage")]: 1.5 }, manifest);
    expect(text).toContain("packages/client/public/art/manifest.json");
    expect(text).toContain(`"turret.mirage"`);
    expect(text).toContain(`"scale": 1.8`);
  });

  it("says a car with no row of its own needs per-car art or a row pointing at the default image", () => {
    const text = turretExportText({}, { [carScaleKey("bastion")]: 1.25 }, DEFAULT_ONLY);
    expect(text).toContain(`"turret.bastion"`);
    expect(text).toContain("no manifest row");
    expect(text).toContain("turrets/default.png");
    expect(text).toContain(`"scale": 1.25`);
  });

  it("a multiplier of exactly 1 exports nothing for that car", () => {
    expect(turretExportText({}, { [carScaleKey("bastion")]: 1 }, DEFAULT_ONLY)).toBe("");
  });
});
