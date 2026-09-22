import { describe, expect, it } from "vitest";
import {
  ACTIVE_ARENA_ID,
  BOT_SESSION_ID,
  PLAYGROUND_SEATS,
  PLAYGROUND_SEAT_IDS,
  WEAPON_SLOT_CONFIG,
  defaultPlaygroundSetup,
  isPlaygroundSetup,
} from "@motor-combat-moba/shared";
import { envKey } from "../../fx/env-tuning.js";
import { carScaleKey } from "../../scenes/turret-view.js";
import {
  PLAYGROUND_STORAGE_KEY,
  decodeStored,
  defaultStoredView,
  encodeStored,
  loadStored,
  saveStored,
  sanitizeStoredEnv,
  sanitizeStoredVfx,
  upgradeStoredSetup,
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

  it("still loads a full six-seat setup an older (pre-VS34) build persisted (VS34)", () => {
    // Every build before this task wrote exactly three weapons per seat and no length field at all
    // — there was nothing else to write. That shape must keep decoding intact now that a seat's
    // loadout is 1..N rather than always three.
    const setup = defaultPlaygroundSetup();
    const cars = setup.cars.map((c, i) => ({
      ...c,
      weapons: i === 0 ? ["thumper", "roadblock", "wildcharge"] : ["predator", "thunderclap", "afterburner"],
    }));
    const raw = JSON.stringify({ setup: { ...setup, cars }, overrides: {} });
    const result = decodeStored(raw);
    expect(result.setup.cars[0]!.weapons).toEqual(["thumper", "roadblock", "wildcharge"]);
    expect(result.setup.cars[1]!.weapons).toEqual(["predator", "thunderclap", "afterburner"]);
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
      overrides: { "car.mirage.speed": 42, "ram.attackerLockMs": 5 },
      view: { showHitbox: true },
      vfx: {},
      env: {},
      carTint: {},

      turret: {},
    };
    expect(decodeStored(encodeStored(stored))).toEqual(stored);
  });

  it("round-trips the empty-overrides case (a valid, deliberate reset)", () => {
    const stored: StoredPlayground = {
      setup: defaultPlaygroundSetup(),
      overrides: {},
      view: defaultStoredView(),
      vfx: {},
      env: {},
      carTint: {},

      turret: {},
    };
    expect(decodeStored(encodeStored(stored))).toEqual(stored);
  });
});

describe("loadStored / saveStored with an injected storage", () => {
  it("round-trips through the injected storage", () => {
    const storage = fakeStorage();
    const stored: StoredPlayground = {
      setup: defaultPlaygroundSetup(),
      overrides: { "ram.attackerLockMs": 5 },
      view: defaultStoredView(),
      vfx: {},
      env: {},
      carTint: {},

      turret: {},
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
      vfx: {},
      env: {},
      carTint: {},

      turret: {},
    });
  });

  it("saveStored with no injected storage and no window is a harmless no-op", () => {
    expect(() =>
      saveStored({
        setup: defaultPlaygroundSetup(),
        overrides: {},
        view: defaultStoredView(),
        vfx: {},
        env: {},
        carTint: {},

        turret: {},
      }),
    ).not.toThrow();
  });

  it("loadStored with no injected storage and no window returns defaults + {}", () => {
    expect(loadStored()).toEqual({
      setup: defaultPlaygroundSetup(),
      overrides: {},
      view: defaultStoredView(),
      vfx: {},
      env: {},
      carTint: {},

      turret: {},
    });
  });
});

describe("decodeStored — v1 upgrade (PG25)", () => {
  /**
   * A setup as saved BEFORE this change: no `botDifficulty`, no `colorId` on either car — and, since
   * this predates PG85 too, still in the `me`/`opponent` shape rather than seats. Two upgrades have
   * to compose to read this back: PG25's colorId/botDifficulty fill-in runs first, then PG85's
   * me/opponent -> seats rewrite converts what that left behind. These tests pin the PG25 half of
   * that composition; PG85's own describe block below pins the seat conversion itself.
   */
  const v1Setup = {
    botEnabled: true,
    arenaId: "arena-01",
    me: { carId: "bastion", weapons: ["thumper", "roadblock", "wildcharge"] },
    opponent: { carId: "mirage", weapons: ["predator", "thunderclap", "afterburner"] },
  };

  it("keeps the car, loadout and arena a v1 blob chose", () => {
    const { setup } = decodeStored(JSON.stringify({ setup: v1Setup, overrides: {} }));
    expect(setup.cars[0]).toMatchObject({
      carId: "bastion",
      weapons: ["thumper", "roadblock", "wildcharge"],
    });
    expect(setup.cars[1]).toMatchObject({ carId: "mirage" });
    expect(setup.arenaId).toBe("arena-01");
    expect(setup.botEnabled).toBe(true); // the stored value wins over the new default
  });

  it("fills the new fields from the defaults, keeping the two cars distinct", () => {
    const { setup } = decodeStored(JSON.stringify({ setup: v1Setup, overrides: {} }));
    const fallback = defaultPlaygroundSetup();
    expect(setup.botDifficulty).toBe(fallback.botDifficulty);
    expect(setup.cars[0]!.colorId).toBe(fallback.cars[0]!.colorId);
    expect(setup.cars[1]!.colorId).toBe(fallback.cars[1]!.colorId);
    expect(setup.cars[0]!.colorId).not.toBe(setup.cars[1]!.colorId);
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

describe("upgrading a two-car blob to six seats (PG85)", () => {
  /** What a browser saved before this change: me/opponent, no cars, no drivenSeat. */
  const legacy = {
    setup: {
      botEnabled: true,
      botDifficulty: "hard",
      arenaId: ACTIVE_ARENA_ID,
      me: { carId: "bastion", colorId: 3, weapons: ["thumper", "roadblock", "wildcharge"] },
      opponent: { carId: "bullseye", colorId: 5, weapons: ["predator", "pepperbox", "lance"] },
    },
  };

  it("puts me at seat 0 and opponent at seat 1, both enabled and driving seat 0", () => {
    const stored = decodeStored(JSON.stringify(legacy));
    expect(stored.setup.cars).toHaveLength(PLAYGROUND_SEATS);
    expect(stored.setup.cars[0]).toMatchObject({ carId: "bastion", colorId: 3, enabled: true });
    expect(stored.setup.cars[1]).toMatchObject({ carId: "bullseye", colorId: 5, enabled: true });
    expect(stored.setup.drivenSeat).toBe(0);
  });

  it("fills seats 2-5 from the defaults, switched off", () => {
    const stored = decodeStored(JSON.stringify(legacy));
    expect(stored.setup.cars.slice(2).every((c) => c.enabled === false)).toBe(true);
    expect(stored.setup.cars.slice(2).map((c) => c.colorId)).toEqual(
      defaultPlaygroundSetup().cars.slice(2).map((c) => c.colorId),
    );
  });

  it("keeps the rest of the legacy setup", () => {
    const stored = decodeStored(JSON.stringify(legacy));
    expect(stored.setup.botEnabled).toBe(true);
    expect(stored.setup.botDifficulty).toBe("hard");
  });

  it("leaves a blob that already carries seats alone", () => {
    const modern = { setup: { ...defaultPlaygroundSetup(), botDifficulty: "easy" as const } };
    const stored = decodeStored(JSON.stringify(modern));
    expect(stored.setup.botDifficulty).toBe("easy");
    expect(stored.setup.cars).toHaveLength(PLAYGROUND_SEATS);
  });

  it("still falls back whole on a blob missing a required section", () => {
    // The narrowness rule is unchanged: this upgrade never invents `arenaId`, `botEnabled` or a
    // missing car record. Such a blob stays invalid and the whole setup falls back.
    const broken = { setup: { ...legacy.setup, arenaId: undefined } };
    expect(decodeStored(JSON.stringify(broken)).setup).toEqual(defaultPlaygroundSetup());
  });

  it("falls back whole on garbage", () => {
    expect(decodeStored("not json").setup).toEqual(defaultPlaygroundSetup());
    expect(decodeStored(null).setup).toEqual(defaultPlaygroundSetup());
  });
});

/**
 * VS34. A blob saved at a higher `N` carries seats whose loadouts this build no longer accepts, and
 * `isPlaygroundCarSetup` rejects a seat with more than `maxAbilitySlots` weapons. Without a
 * truncation in the upgrade path that rejection costs the ENTIRE setup — six chassis, six colours,
 * the enabled flags, the driven seat and the arena — replaced by `defaultPlaygroundSetup()` over one
 * trailing weapon, where the same over-long kit on a `CAR_TABLE` row is simply cut by `slotsFrom`.
 *
 * `N` is build-time and a test cannot move it, so the cap is a parameter with the live value bound
 * as its default (spec §11): these drive `upgradeStoredSetup` at a cap of 1, which is below every
 * legal `N`, so the cases mean the same thing at `N = 1, 2, 3, 4`. The one case that must go through
 * the live cap — the whole-setup survival that `decodeStored` decides — measures against
 * `WEAPON_SLOT_CONFIG.maxAbilitySlots` rather than against 3.
 */
describe("truncating a stored loadout to this build's slot count (VS34)", () => {
  /** Four distinct real weapons: longer than any legal `N` but one, so there is always something
   * to cut. Split across chassis on purpose — the playground lets a seat mix them (PG17). */
  const OVERLONG = ["thumper", "roadblock", "wildcharge", "predator"] as const;

  const seatBlob = {
    ...defaultPlaygroundSetup(),
    botDifficulty: "hard" as const,
    drivenSeat: 1,
    cars: defaultPlaygroundSetup().cars.map((car) => ({ ...car, weapons: [...OVERLONG] })),
  };

  it("cuts every seat's loadout to the cap, in authored order, and keeps the rest of the setup", () => {
    const upgraded = upgradeStoredSetup(seatBlob, 1) as typeof seatBlob;
    expect(upgraded.cars.map((c) => c.weapons)).toEqual(
      seatBlob.cars.map(() => [OVERLONG[0]]),
    );
    expect(upgraded.cars.map((c) => c.carId)).toEqual(seatBlob.cars.map((c) => c.carId));
    expect(upgraded.cars.map((c) => c.colorId)).toEqual(seatBlob.cars.map((c) => c.colorId));
    expect(upgraded.cars.map((c) => c.enabled)).toEqual(seatBlob.cars.map((c) => c.enabled));
    expect(upgraded.drivenSeat).toBe(1);
    expect(upgraded.arenaId).toBe(seatBlob.arenaId);
    expect(upgraded.botDifficulty).toBe("hard");
  });

  it("hands the validator something it accepts, which is the whole point", () => {
    // One weapon per seat is legal at every `N` (the floor is 1), so this assertion holds at any
    // build count without knowing which one this build is.
    expect(isPlaygroundSetup(upgradeStoredSetup(seatBlob, 1))).toBe(true);
  });

  it("truncates a LEGACY me/opponent blob on its way to six seats, too", () => {
    const legacy = {
      botEnabled: true,
      botDifficulty: "hard" as const,
      arenaId: ACTIVE_ARENA_ID,
      me: { carId: "bastion", colorId: 3, weapons: [...OVERLONG] },
      opponent: { carId: "bullseye", colorId: 5, weapons: [...OVERLONG] },
    };
    const upgraded = upgradeStoredSetup(legacy, 1) as { cars: { carId: string; weapons: string[] }[] };
    expect(upgraded.cars[0]!.weapons).toEqual([OVERLONG[0]]);
    expect(upgraded.cars[1]!.weapons).toEqual([OVERLONG[0]]);
    expect(upgraded.cars[0]!.carId).toBe("bastion");
    expect(isPlaygroundSetup(upgraded)).toBe(true);
  });

  it("leaves a loadout already inside the cap exactly as it was", () => {
    const short = {
      ...defaultPlaygroundSetup(),
      cars: defaultPlaygroundSetup().cars.map((car) => ({ ...car, weapons: [OVERLONG[0]] })),
    };
    expect(upgradeStoredSetup(short, WEAPON_SLOT_CONFIG.maxAbilitySlots)).toEqual(short);
  });

  it("is not fooled into repairing a malformed seat — that still falls back whole", () => {
    const broken = {
      ...defaultPlaygroundSetup(),
      cars: defaultPlaygroundSetup().cars.map((car, seat) =>
        seat === 2 ? { ...car, weapons: "thumper" } : car,
      ),
    };
    expect(decodeStored(JSON.stringify({ setup: broken })).setup).toEqual(defaultPlaygroundSetup());
  });

  it("SURVIVES a real load: the stored setup is truncated, never discarded for the defaults", () => {
    // The regression this exists for. At any `N` below `OVERLONG.length` the old code handed
    // `isPlaygroundSetup` a four-weapon seat, it said no, and six seats of configuration went to
    // `defaultPlaygroundSetup()`.
    const raw = JSON.stringify({ setup: { ...seatBlob, arenaId: ACTIVE_ARENA_ID } });
    const { setup } = decodeStored(raw);
    const kept = Math.min(OVERLONG.length, WEAPON_SLOT_CONFIG.maxAbilitySlots);
    expect(setup.cars[0]!.weapons).toEqual(OVERLONG.slice(0, kept));
    expect(setup.drivenSeat).toBe(1);
    expect(setup.botDifficulty).toBe("hard");
    expect(setup).not.toEqual(defaultPlaygroundSetup());
  });
});

describe("migrating stored car tints to seat ids (PG86)", () => {
  it("moves the bot's tint to seat 1", () => {
    const stored = decodeStored(
      JSON.stringify({ carTint: { [BOT_SESSION_ID]: { hex: 0xff2bd6, on: true } } }),
    );
    expect(stored.carTint[PLAYGROUND_SEAT_IDS[1]!]).toEqual({ hex: 0xff2bd6, on: true });
    expect(stored.carTint[BOT_SESSION_ID]).toBeUndefined();
  });

  it("upgrades a bare-number bot tint on the way through", () => {
    const stored = decodeStored(JSON.stringify({ carTint: { [BOT_SESSION_ID]: 0x112233 } }));
    expect(stored.carTint[PLAYGROUND_SEAT_IDS[1]!]).toEqual({ hex: 0x112233, on: true });
  });

  it("keeps a tint already stored against a seat id", () => {
    const stored = decodeStored(
      JSON.stringify({ carTint: { [PLAYGROUND_SEAT_IDS[4]!]: { hex: 0x00ff00, on: false } } }),
    );
    expect(stored.carTint[PLAYGROUND_SEAT_IDS[4]!]).toEqual({ hex: 0x00ff00, on: false });
  });

  it("never overwrites a real seat tint with the legacy bot one", () => {
    const stored = decodeStored(
      JSON.stringify({
        carTint: {
          [BOT_SESSION_ID]: { hex: 0xff0000, on: true },
          [PLAYGROUND_SEAT_IDS[1]!]: { hex: 0x0000ff, on: true },
        },
      }),
    );
    expect(stored.carTint[PLAYGROUND_SEAT_IDS[1]!]).toEqual({ hex: 0x0000ff, on: true });
  });

  it("leaves an unidentifiable old session key where it is, harmlessly", () => {
    // The human's own old key was a per-connection Colyseus id and cannot be mapped to a seat. It
    // simply never resolves, which `sanitizeCarTints` already tolerates.
    const stored = decodeStored(JSON.stringify({ carTint: { aBcDeF: { hex: 0x010203, on: true } } }));
    expect(stored.carTint[PLAYGROUND_SEAT_IDS[0]!]).toBeUndefined();
  });
});

describe("the stored vfx section (PG54)", () => {
  it("is empty for a blob saved before it existed", () => {
    const raw = JSON.stringify({ setup: defaultPlaygroundSetup(), overrides: {} });
    expect(decodeStored(raw).vfx).toEqual({});
  });

  it("round-trips a valid entry", () => {
    const stored = {
      setup: defaultPlaygroundSetup(),
      overrides: {},
      view: { showHitbox: false },
      vfx: { "lance.muzzle.fire.count": 40, "predator.muzzle.smoke.soot": true },
      env: {},
      carTint: {},

      turret: {},
    };
    expect(decodeStored(encodeStored(stored)).vfx).toEqual(stored.vfx);
  });

  it("drops a malformed key without losing the valid ones beside it", () => {
    const raw = JSON.stringify({
      setup: defaultPlaygroundSetup(),
      vfx: {
        "lance.muzzle.fire.count": 40,
        "lance.muzzle.fire": 3, // too few segments
        "no-such-weapon.muzzle.fire.count": 3, // unknown weapon
        "lance.launch.fire.count": 3, // unknown phase
        "lance.muzzle.glitter.count": 3, // unknown channel
        "lance.muzzle.fire.sparkle": 3, // unknown field
      },
    });
    expect(decodeStored(raw).vfx).toEqual({ "lance.muzzle.fire.count": 40 });
  });

  it("drops a value of the wrong type or out of range", () => {
    const raw = JSON.stringify({
      setup: defaultPlaygroundSetup(),
      vfx: {
        "lance.muzzle.fire.count": "40", // string where a number belongs
        "lance.muzzle.fire.soot": 1, // number where a boolean belongs
        "lance.muzzle.fire.speed": 99999, // outside the field's range
        "lance.muzzle.fire.alpha": 0.5, // fine
      },
    });
    expect(decodeStored(raw).vfx).toEqual({ "lance.muzzle.fire.alpha": 0.5 });
  });

  it("survives a vfx section that is not an object", () => {
    const raw = JSON.stringify({ setup: defaultPlaygroundSetup(), vfx: "nope" });
    expect(decodeStored(raw).vfx).toEqual({});
  });

  it("keeps a car event override, which isWeaponId alone would have dropped", () => {
    expect(sanitizeStoredVfx({ "carDeath.impact.fire.count": 3 })).toEqual({
      "carDeath.impact.fire.count": 3,
    });
  });

  it("drops a stale phase for a car event while keeping its valid sibling", () => {
    // A car event has only the `impact` phase (see the `phasesForSubject` case above) — a `muzzle`
    // key against `carDeath` cannot come from today's panel, only from a blob saved before a rename
    // or a stray hand edit, and `phasesForSubject` is the guard that must catch it.
    expect(
      sanitizeStoredVfx({
        "carDeath.muzzle.fire.count": 40,
        "carDeath.impact.fire.count": 3,
      }),
    ).toEqual({ "carDeath.impact.fire.count": 3 });
  });
});

describe("sanitizeStoredEnv (EV32)", () => {
  it("keeps a valid entry", () => {
    expect(sanitizeStoredEnv({ [envKey("grade", "saturate")]: -0.5 })).toEqual({
      "grade.saturate": -0.5,
    });
  });

  it("drops one bad entry and keeps the rest", () => {
    const out = sanitizeStoredEnv({
      [envKey("grade", "saturate")]: -0.5,
      "grade.nope": 1,
      "nope.saturate": 1,
      [envKey("vignette", "strength")]: 99,
      [envKey("floor", "grainCells")]: 33.5,
      [envKey("hitStop", "ms")]: "90",
    });
    expect(out).toEqual({ "grade.saturate": -0.5 });
  });

  it("returns an empty map for a non-object", () => {
    expect(sanitizeStoredEnv(null)).toEqual({});
    expect(sanitizeStoredEnv("nope")).toEqual({});
  });

  it("loads a pre-existing blob that has no env section as empty", () => {
    const decoded = decodeStored(JSON.stringify({ setup: defaultPlaygroundSetup(), vfx: {} }));
    expect(decoded.env).toEqual({});
  });
});

describe("the carTint section (per-car playground tint)", () => {
  it("round-trips a tint keyed by session id", () => {
    const stored: StoredPlayground = {
      setup: defaultPlaygroundSetup(),
      overrides: {},
      view: defaultStoredView(),
      vfx: {},
      env: {},
      carTint: { abc: { hex: 0xff2200, on: true } },

      turret: {},
    };
    expect(decodeStored(encodeStored(stored))).toEqual(stored);
  });

  it("loads a pre-existing blob that has no carTint section as empty", () => {
    const decoded = decodeStored(JSON.stringify({ setup: defaultPlaygroundSetup(), vfx: {} }));
    expect(decoded.carTint).toEqual({});
  });

  it("drops a junk entry without costing the good one beside it", () => {
    const decoded = decodeStored(
      JSON.stringify({
        setup: defaultPlaygroundSetup(),
        carTint: { a: "#fff", b: { hex: 0x123456, on: false } },
      }),
    );
    expect(decoded.carTint).toEqual({ b: { hex: 0x123456, on: false } });
  });

  it("does not let a malformed carTint invalidate the setup beside it", () => {
    const decoded = decodeStored(
      JSON.stringify({ setup: defaultPlaygroundSetup(), carTint: "nope" }),
    );
    expect(decoded.carTint).toEqual({});
    expect(decoded.setup).toEqual(defaultPlaygroundSetup());
  });
});

describe("the turret section (TR62)", () => {
  it("round-trips the client-only turret knobs", () => {
    const stored: StoredPlayground = {
      setup: defaultPlaygroundSetup(),
      overrides: { "turret.maxSwingDeg": 180 },
      view: defaultStoredView(),
      vfx: {},
      env: {},
      carTint: {},
      turret: { crosshairMaxDistance: 120, lengthUnits: 40, [carScaleKey("bastion")]: 1.5 },
    };
    expect(decodeStored(encodeStored(stored))).toEqual(stored);
  });

  it("loads a blob saved before the section existed as empty", () => {
    expect(decodeStored(JSON.stringify({ setup: defaultPlaygroundSetup() })).turret).toEqual({});
  });

  it("drops a junk entry without costing the good one beside it, or the setup", () => {
    const decoded = decodeStored(
      JSON.stringify({ setup: defaultPlaygroundSetup(), turret: { lengthUnits: -4, crosshairMaxDistance: 90 } }),
    );
    expect(decoded.turret).toEqual({ crosshairMaxDistance: 90 });
    expect(decoded.setup).toEqual(defaultPlaygroundSetup());
  });
});
