import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GAME_MODE, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { activeCarIds } from "@motor-combat-moba/shared";
import { carOptions, opponentOptions } from "./practice-setup.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

describe("practice setup options", () => {
  it("offers every active chassis and nothing else (PR15)", () => {
    expect(carOptions().map((o) => o.value)).toEqual(activeCarIds());
  });

  it("labels each chassis with its display name, not its id", () => {
    expect(carOptions().every((o) => o.label.length > 0 && o.label !== o.value)).toBe(true);
  });

  it("puts Random first in the opponent list", () => {
    expect(opponentOptions()[0]).toEqual({ value: "random", label: "Random" });
  });

  it("offers the same chassis set after Random", () => {
    expect(opponentOptions().slice(1).map((o) => o.value)).toEqual(activeCarIds());
  });
});
