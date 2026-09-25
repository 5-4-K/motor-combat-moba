import { describe, expect, it } from "vitest";
import { GameMode } from "../constants.js";
import { MODE_TABLE, modeConfigOf } from "./registry.js";
import { modeSlug } from "./mode-arg.js";
import { stableStringify, tablesOf } from "./snapshot-serialize.js";

describe("stableStringify", () => {
  it("sorts keys, encodes non-finite numbers, drops undefined", () => {
    expect(stableStringify({ b: 1, a: { d: Infinity, c: undefined, e: -Infinity } })).toBe(
      '{\n  "a": {\n    "d": "Infinity",\n    "e": "-Infinity"\n  },\n  "b": 1\n}\n',
    );
  });
  it("keeps array order", () => {
    expect(stableStringify([3, 1, 2])).toBe("[\n  3,\n  1,\n  2\n]\n");
  });
});

/**
 * GM10: one file per mode holding that mode's RESOLVED tables. Editing one mode's overrides moves
 * only that mode's file; editing the base moves every mode that does not override the value. A
 * moved file is the blast radius of a config edit, reviewed in the diff and accepted with `-u`.
 */
describe("per-mode resolved tables (GM10)", () => {
  const modes = Object.keys(MODE_TABLE).map(Number) as GameMode[];
  it.each(modes)("mode %i matches its committed snapshot", async (mode) => {
    await expect(stableStringify(tablesOf(modeConfigOf(mode)))).toMatchFileSnapshot(
      `./__snapshots__/${modeSlug(mode)}.tables.json`,
    );
  });
});
