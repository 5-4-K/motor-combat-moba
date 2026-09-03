import { describe, expect, it } from "vitest";
import { defaultPracticeSetup } from "@motor-combat-moba/shared";
import { PRACTICE_STORAGE_KEY, loadPracticeSetup, savePracticeSetup } from "./storage.js";

function fakeStorage(seed?: string): Storage {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set(PRACTICE_STORAGE_KEY, seed);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("practice setup persistence", () => {
  it("falls back to the default when nothing is stored", () => {
    expect(loadPracticeSetup(fakeStorage())).toEqual(defaultPracticeSetup());
  });

  it("round-trips a saved setup", () => {
    const storage = fakeStorage();
    const setup = { ...defaultPracticeSetup(), carId: "bastion" as const, difficulty: "hard" as const };
    savePracticeSetup(setup, storage);
    expect(loadPracticeSetup(storage)).toEqual(setup);
  });

  it("falls back whole on malformed JSON", () => {
    expect(loadPracticeSetup(fakeStorage("{not json"))).toEqual(defaultPracticeSetup());
  });

  it("falls back whole on a structurally invalid blob", () => {
    const stored = JSON.stringify({ ...defaultPracticeSetup(), carId: "nope" });
    expect(loadPracticeSetup(fakeStorage(stored))).toEqual(defaultPracticeSetup());
  });

  it("falls back when a stored chassis has since been deactivated", () => {
    // isPracticeSetup rejects an inactive chassis, so retiring a car cannot strand a player on a
    // settings page that will not join.
    const stored = JSON.stringify({ ...defaultPracticeSetup(), opponentCarId: "retired-car" });
    expect(loadPracticeSetup(fakeStorage(stored))).toEqual(defaultPracticeSetup());
  });

  it("survives a storage that throws (private browsing)", () => {
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(loadPracticeSetup(hostile)).toEqual(defaultPracticeSetup());
    expect(() => savePracticeSetup(defaultPracticeSetup(), hostile)).not.toThrow();
  });
});
