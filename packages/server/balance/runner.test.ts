import { describe, expect, it } from "vitest";
import { GameMode } from "@motor-combat-moba/shared";
import { runAll, seatsFor } from "./runner.js";

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

  it("gives each match its own derived seed, so two matches are not the same match", () => {
    const out = runAll({ ...config, shape: "ffa", matches: 2 });
    expect(out.outcomes[0]!.ticks !== out.outcomes[1]!.ticks
        || out.outcomes[0]!.events.damaged.length !== out.outcomes[1]!.events.damaged.length).toBe(true);
  });
});
