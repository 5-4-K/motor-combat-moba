import { describe, expect, it } from "vitest";
import { CAR_TABLE, MAX_PLAYERS, activeCarIds, slotsOf, type CarId } from "@motor-combat-moba/shared";
import { GameMode } from "@motor-combat-moba/shared";
import { chassisRoster, runAll, seatsFor } from "./runner.js";
import { aggregate } from "./stats.js";

/**
 * A stable digest of any JSON-safe value: recursively sort object keys, then `JSON.stringify` —
 * the same technique `fingerprint.ts`'s `stableStringify` uses, kept local here rather than
 * imported so this test file does not reach into that module's internals for a one-off.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeysDeep(source[key]);
    return sorted;
  }
  return value;
}

function digest(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

describe("seatsFor (B26, B27)", () => {
  it("seats an ffa match 2/2/2, always", () => {
    const carIds = seatsFor("ffa", 0).seats.map((s) => s.carId).sort();
    expect(carIds).toEqual(["bastion", "bastion", "bullseye", "bullseye", "mirage", "mirage"]);
  });

  it("gives every ffa match the same composition, so the null is exactly 1/3", () => {
    expect(seatsFor("ffa", 7).seats.map((s) => s.carId).sort())
      .toEqual(seatsFor("ffa", 0).seats.map((s) => s.carId).sort());
  });

  it("cycles duel through all nine ordered pairs", () => {
    const pairs = new Set(
      Array.from({ length: 9 }, (_, i) => seatsFor("duel", i).seats.map((s) => s.carId).join("-")),
    );
    expect(pairs.size).toBe(9);
  });

  it("includes the three mirrors, which are the rig's noise floor (B26a)", () => {
    const pairs = Array.from({ length: 9 }, (_, i) => seatsFor("duel", i).seats.map((s) => s.carId));
    expect(pairs.filter(([a, b]) => a === b)).toHaveLength(3);
  });
});

/**
 * The oversized-roster path, driven through `seatsFor`'s explicit `chassis` argument.
 *
 * Synthetic ids, cast rather than drawn from `CAR_TABLE`: seat assignment is parametric over the
 * roster — nothing in `ffaSeats`/`ffaWindow` looks a chassis up in any table, it only slices the
 * list it is handed — so a synthetic roster exercises exactly the production code path. The
 * alternative (wait for a seventh real chassis) is how this case stayed unhandled and crashing until
 * `--include-inactive` made it reachable.
 */
describe("seatsFor with more chassis than seats", () => {
  const roster = (n: number): CarId[] =>
    Array.from({ length: n }, (_, i) => `c${i}`) as unknown as CarId[];

  it("never seats more cars than the arena has spawns", () => {
    // The bug this replaces: `Math.max(1, Math.floor(6 / 7))` built SEVEN seats, and
    // `assignFfaSpawns` then threw "Not enough FFA spawns for roster" — both arenas author six.
    for (const n of [7, 8, 11]) {
      for (let i = 0; i < n; i++) {
        expect(seatsFor("ffa", i, roster(n)).seats).toHaveLength(MAX_PLAYERS);
      }
    }
  });

  it("seats no chassis twice in one match", () => {
    const seats = seatsFor("ffa", 3, roster(8)).seats.map((s) => s.carId);
    expect(new Set(seats).size).toBe(seats.length);
  });

  it("gives every chassis identical seat-time over a lap of n matches", () => {
    // The fairness claim `stats.ts` and the README both rest on. Stepping the window by one per
    // match (rather than by MAX_PLAYERS) is what makes it exact for every n, not just coprime ones.
    for (const n of [7, 8, 9, 12]) {
      const chassis = roster(n);
      const appearances = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        for (const seat of seatsFor("ffa", i, chassis).seats) {
          appearances.set(seat.carId, (appearances.get(seat.carId) ?? 0) + 1);
        }
      }
      expect(appearances.size).toBe(n);
      expect([...appearances.values()]).toEqual(Array.from({ length: n }, () => MAX_PLAYERS));
    }
  });

  it("leaves a roster that still fits alone, seats and all", () => {
    // n <= MAX_PLAYERS must behave exactly as before: fixed composition, largest even split.
    expect(seatsFor("ffa", 0, roster(4)).seats.map((s) => s.carId))
      .toEqual(seatsFor("ffa", 9, roster(4)).seats.map((s) => s.carId));
    expect(seatsFor("ffa", 0, roster(4)).seats).toHaveLength(4);
    expect(seatsFor("ffa", 0, roster(6)).seats).toHaveLength(6);
  });
});

describe("chassisRoster (--include-inactive)", () => {
  it("publishes only active chassis by default", () => {
    expect(chassisRoster(false)).toEqual(activeCarIds());
  });

  it("seats no chassis that cannot fire, under either flag", () => {
    // An inactive car is allowed an empty kit (`weapon-slots.test.ts`) — a prototype chassis exists
    // before its weapons do. Seating one would book a guaranteed 0% win rate that says nothing
    // about the chassis and drags every other car's number up around it.
    for (const includeInactive of [false, true]) {
      for (const id of chassisRoster(includeInactive)) {
        expect(slotsOf(id).length).toBeGreaterThan(0);
      }
    }
  });

  it("adds every armed inactive chassis when asked", () => {
    const armedInactive = (Object.keys(CAR_TABLE) as CarId[]).filter(
      (id) => !CAR_TABLE[id].isActive && slotsOf(id).length > 0,
    );
    expect(chassisRoster(true)).toEqual([...chassisRoster(false), ...armedInactive].sort(
      (a, b) => Object.keys(CAR_TABLE).indexOf(a) - Object.keys(CAR_TABLE).indexOf(b),
    ));
    // Today `armedInactive` is empty — all three ship active — so this also pins that the flag is a
    // no-op on the shipped roster rather than quietly reordering it.
    expect(chassisRoster(true)).toEqual(chassisRoster(false));
  });
});

describe("runAll (B43)", () => {
  const config = {
    shape: "duel", matches: 1, mode: GameMode.FFA_LAST_STANDING,
    difficulty: "hard", seed: 5, arenaId: "arena-01", matchSeconds: 20,
    includeInactive: false,
  } as const;

  it("runs matches x pairs in duel", () => {
    expect(runAll(config).totalMatches).toBe(9);
  });

  it("replays identically for a seed", () => {
    const a = runAll(config);
    const b = runAll(config);
    expect(b.outcomes.map((o) => o.ticks)).toEqual(a.outcomes.map((o) => o.ticks));
  });

  it("produces an identical stats digest for the same seed twice (B43)", () => {
    // The property B43 actually names — "the same seed twice produces an identical stats digest" —
    // is about the STATS a run's config produces, not about tick counts or event counts alone
    // (which would still match while damage totals, kill attribution, or hit rates diverged). Small
    // config so the test stays fast: `duel` at `matches: 1` is 9 short matches, `matchSeconds: 5`
    // caps each one well under its safety-cap default.
    const small = { ...config, matchSeconds: 5 } as const;
    const a = aggregate(runAll(small).outcomes);
    const b = aggregate(runAll(small).outcomes);
    const digestA = digest(a);
    const digestB = digest(b);
    expect(digestA.length).toBeGreaterThan(0); // sanity: not vacuously comparing "{}"
    expect(digestB).toBe(digestA);
  });

  it("gives each match its own derived seed, so two matches are not the same match", () => {
    const out = runAll({ ...config, shape: "ffa", matches: 2 });
    expect(out.outcomes[0]!.ticks !== out.outcomes[1]!.ticks
        || out.outcomes[0]!.events.damaged.length !== out.outcomes[1]!.events.damaged.length).toBe(true);
  });
});
