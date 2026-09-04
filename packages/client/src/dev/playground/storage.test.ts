import { describe, expect, it } from "vitest";
import { defaultPlaygroundSetup } from "@motor-combat-moba/shared";
import {
  PLAYGROUND_STORAGE_KEY,
  decodeStored,
  defaultStoredView,
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

describe("the view section", () => {
  it("defaults to off when a saved blob predates it, without touching what is saved beside it", () => {
    // Every blob written before this section existed lacks it. Losing a developer's cars, loadout
    // and tuning because a later version added a checkbox would be the worst possible trade, so a
    // missing `view` has to cost nothing but its own default.
    const raw = JSON.stringify({
      setup: defaultPlaygroundSetup(),
      overrides: { "car.mirage.speed": 10 },
    });
    const result = decodeStored(raw);
    expect(result.view).toEqual({ showHitbox: false });
    expect(result.setup).toEqual(defaultPlaygroundSetup());
    expect(result.overrides).toEqual({ "car.mirage.speed": 10 });
  });

  it("falls back per field rather than whole, and only `true` means on", () => {
    // A malformed section, and a truthy-but-not-true value, both land on the default rather than
    // throwing or coercing — the same shape of guard `decodeStored` already applies between the
    // setup and the overrides.
    expect(decodeStored('{"view":"yes"}').view).toEqual({ showHitbox: false });
    expect(decodeStored('{"view":[]}').view).toEqual({ showHitbox: false });
    expect(decodeStored('{"view":{"showHitbox":"true"}}').view).toEqual({ showHitbox: false });
    expect(decodeStored('{"view":{"showHitbox":1}}').view).toEqual({ showHitbox: false });
    expect(decodeStored('{"view":{"showHitbox":true}}').view).toEqual({ showHitbox: true });
  });

  it("keeps a good view section when the setup beside it is unreadable", () => {
    const result = decodeStored('{"setup":"nonsense","view":{"showHitbox":true}}');
    expect(result.setup).toEqual(defaultPlaygroundSetup());
    expect(result.view).toEqual({ showHitbox: true });
  });
});

describe("encodeStored / decodeStored", () => {
  it("round-trips a setup + overrides blob", () => {
    const stored: StoredPlayground = {
      setup: defaultPlaygroundSetup(),
      overrides: { "car.mirage.speed": 42, "ram.massPerRating": 5 },
      view: { showHitbox: true },
    };
    expect(decodeStored(encodeStored(stored))).toEqual(stored);
  });

  it("round-trips the empty-overrides case (a valid, deliberate reset)", () => {
    const stored: StoredPlayground = {
      setup: defaultPlaygroundSetup(),
      overrides: {},
      view: defaultStoredView(),
    };
    expect(decodeStored(encodeStored(stored))).toEqual(stored);
  });
});

describe("loadStored / saveStored with an injected storage", () => {
  it("round-trips through the injected storage", () => {
    const storage = fakeStorage();
    const stored: StoredPlayground = {
      setup: defaultPlaygroundSetup(),
      overrides: { "ram.massPerRating": 5 },
      view: defaultStoredView(),
    };
    saveStored(stored, storage);
    expect(storage.getItem(PLAYGROUND_STORAGE_KEY)).toBe(encodeStored(stored));
    expect(loadStored(storage)).toEqual(stored);
  });

  it("loadStored against empty injected storage returns defaults + {}", () => {
    const storage = fakeStorage();
    expect(loadStored(storage)).toEqual({
      setup: defaultPlaygroundSetup(),
      overrides: {},
      view: defaultStoredView(),
    });
  });

  it("saveStored with no injected storage and no window is a harmless no-op", () => {
    expect(() =>
      saveStored({ setup: defaultPlaygroundSetup(), overrides: {}, view: defaultStoredView() }),
    ).not.toThrow();
  });

  it("loadStored with no injected storage and no window returns defaults + {}", () => {
    expect(loadStored()).toEqual({
      setup: defaultPlaygroundSetup(),
      overrides: {},
      view: defaultStoredView(),
    });
  });
});

describe("decodeStored — v1 upgrade (PG25)", () => {
  /** A setup as saved BEFORE this change: no `botDifficulty`, no `colorId` on either car. */
  const v1Setup = {
    botEnabled: true,
    arenaId: "arena-01",
    me: { carId: "bastion", weapons: ["thumper", "roadblock", "wildcharge"] },
    opponent: { carId: "mirage", weapons: ["predator", "thunderclap", "afterburner"] },
  };

  it("keeps the car, loadout and arena a v1 blob chose", () => {
    const { setup } = decodeStored(JSON.stringify({ setup: v1Setup, overrides: {} }));
    expect(setup.me.carId).toBe("bastion");
    expect(setup.me.weapons).toEqual(["thumper", "roadblock", "wildcharge"]);
    expect(setup.opponent.carId).toBe("mirage");
    expect(setup.arenaId).toBe("arena-01");
    expect(setup.botEnabled).toBe(true); // the stored value wins over the new default
  });

  it("fills the new fields from the defaults, keeping the two cars distinct", () => {
    const { setup } = decodeStored(JSON.stringify({ setup: v1Setup, overrides: {} }));
    const fallback = defaultPlaygroundSetup();
    expect(setup.botDifficulty).toBe(fallback.botDifficulty);
    expect(setup.me.colorId).toBe(fallback.me.colorId);
    expect(setup.opponent.colorId).toBe(fallback.opponent.colorId);
    expect(setup.me.colorId).not.toBe(setup.opponent.colorId);
  });

  it("still falls back whole when the blob is invalid for an older reason", () => {
    const dupe = { ...v1Setup, me: { carId: "bastion", weapons: ["thumper", "thumper", "lance"] } };
    const { setup } = decodeStored(JSON.stringify({ setup: dupe, overrides: {} }));
    expect(setup).toEqual(defaultPlaygroundSetup());
  });

  it("leaves the overrides half alone either way", () => {
    const raw = JSON.stringify({ setup: v1Setup, overrides: { "car.bastion.hp": 55 } });
    expect(decodeStored(raw).overrides).toEqual({ "car.bastion.hp": 55 });
  });

  it("does not invent a setup out of a non-object", () => {
    expect(decodeStored(JSON.stringify({ setup: 7, overrides: {} })).setup).toEqual(
      defaultPlaygroundSetup(),
    );
  });

  it("does not backfill a whole missing section (e.g. `me`) — the upgrade only fills the new fields", () => {
    const stub = {
      botEnabled: true,
      arenaId: "arena-01",
      opponent: { carId: "mirage", weapons: ["predator", "thunderclap", "afterburner"] },
    };
    const { setup } = decodeStored(JSON.stringify({ setup: stub, overrides: {} }));
    expect(setup).toEqual(defaultPlaygroundSetup());
  });

  /**
   * `upgradeStoredSetup` only fills a field that is ABSENT — a present-but-malformed value is left
   * alone and reaches `isPlaygroundSetup` unchanged, which rejects it, which falls the whole setup
   * back to `defaultPlaygroundSetup()`. That asymmetry (missing gets filled, wrong gets nothing)
   * is currently defended only by the function's doc comment; this pins it against both new fields
   * so a future "upgrade a wrong value too" change fails here first.
   */
  it("falls back whole on a present-but-malformed new field, rather than coercing or filling it", () => {
    const withBadColor = {
      ...v1Setup,
      me: { ...v1Setup.me, colorId: "blue" },
    };
    expect(decodeStored(JSON.stringify({ setup: withBadColor, overrides: {} })).setup).toEqual(
      defaultPlaygroundSetup(),
    );

    const withBadDifficulty = { ...v1Setup, botDifficulty: "nonsense" };
    expect(
      decodeStored(JSON.stringify({ setup: withBadDifficulty, overrides: {} })).setup,
    ).toEqual(defaultPlaygroundSetup());
  });
});
