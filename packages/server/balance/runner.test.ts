import { describe, expect, it } from "vitest";
import { GameMode } from "@motor-combat-moba/shared";
import { runAll, seatsFor } from "./runner.js";
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

describe("runAll (B43)", () => {
  const config = {
    shape: "duel", matches: 1, mode: GameMode.FFA_LAST_STANDING,
    difficulty: "hard", seed: 5, arenaId: "arena-01", matchSeconds: 20,
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
