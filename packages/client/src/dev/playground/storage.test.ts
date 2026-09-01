import { describe, expect, it } from "vitest";
import { defaultPlaygroundSetup } from "@motor-combat-moba/shared";
import {
  PLAYGROUND_STORAGE_KEY,
  decodeStored,
  encodeStored,
  loadStored,
  saveStored,
  type StoredPlayground,
} from "./storage.js";

/** A minimal in-memory `Storage` stand-in for the injectable `storage` param -- vitest runs these
 * tests in the node environment, so there is no real `window.localStorage` to reach for. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("decodeStored", () => {
  it("returns defaults + {} for null (nothing stored yet)", () => {
    const result = decodeStored(null);
    expect(result.setup).toEqual(defaultPlaygroundSetup());
    expect(result.overrides).toEqual({});
  });

  it("returns defaults + {} for unparseable JSON", () => {
    const result = decodeStored("{not json at all");
    expect(result.setup).toEqual(defaultPlaygroundSetup());
    expect(result.overrides).toEqual({});
  });

  it("returns defaults + {} for JSON that parses but isn't a plain object", () => {
    expect(decodeStored("[]").setup).toEqual(defaultPlaygroundSetup());
    expect(decodeStored('"hello"').setup).toEqual(defaultPlaygroundSetup());
    expect(decodeStored("42").setup).toEqual(defaultPlaygroundSetup());
    expect(decodeStored("null").setup).toEqual(defaultPlaygroundSetup());
    expect(decodeStored("[]").overrides).toEqual({});
  });

  it("falls back to defaults when the stored setup itself is invalid, independent of overrides", () => {
    const raw = JSON.stringify({ setup: { botEnabled: true }, overrides: { "car.mirage.speed": 10 } });
    const result = decodeStored(raw);
    expect(result.setup).toEqual(defaultPlaygroundSetup());
    expect(result.overrides).toEqual({ "car.mirage.speed": 10 });
  });

  it("keeps a valid stored setup and drops a stale tuning path", () => {
    const setup = defaultPlaygroundSetup();
    const raw = JSON.stringify({
      setup,
      overrides: { "weapon.retired.damage": 999, "car.mirage.speed": 10 },
    });
    const result = decodeStored(raw);
    expect(result.setup).toEqual(setup);
    expect(result.overrides).toEqual({ "car.mirage.speed": 10 });
  });
});

describe("encodeStored / decodeStored", () => {
  it("round-trips a setup + overrides blob", () => {
    const stored: StoredPlayground = {
      setup: defaultPlaygroundSetup(),
      overrides: { "car.mirage.speed": 42, "ram.massPerRating": 5 },
    };
    expect(decodeStored(encodeStored(stored))).toEqual(stored);
  });

  it("round-trips the empty-overrides case (a valid, deliberate reset)", () => {
    const stored: StoredPlayground = { setup: defaultPlaygroundSetup(), overrides: {} };
    expect(decodeStored(encodeStored(stored))).toEqual(stored);
  });
});

describe("loadStored / saveStored with an injected storage", () => {
  it("round-trips through the injected storage", () => {
    const storage = fakeStorage();
    const stored: StoredPlayground = {
      setup: defaultPlaygroundSetup(),
      overrides: { "ram.massPerRating": 5 },
    };
    saveStored(stored, storage);
    expect(storage.getItem(PLAYGROUND_STORAGE_KEY)).toBe(encodeStored(stored));
    expect(loadStored(storage)).toEqual(stored);
  });

  it("loadStored against empty injected storage returns defaults + {}", () => {
    const storage = fakeStorage();
    expect(loadStored(storage)).toEqual({ setup: defaultPlaygroundSetup(), overrides: {} });
  });

  it("saveStored with no injected storage and no window is a harmless no-op", () => {
    expect(() => saveStored({ setup: defaultPlaygroundSetup(), overrides: {} })).not.toThrow();
  });

  it("loadStored with no injected storage and no window returns defaults + {}", () => {
    expect(loadStored()).toEqual({ setup: defaultPlaygroundSetup(), overrides: {} });
  });
});
