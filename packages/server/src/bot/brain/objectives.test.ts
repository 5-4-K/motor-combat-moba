import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { ALL_SITUATIONS } from "./situation.js";
import { weightsFor } from "./objectives.js";

describe("weightsFor", () => {
  it("covers every situation", () => {
    for (const id of ALL_SITUATIONS) {
      expect(() => weightsFor(id, BOT_PROFILES.hard)).not.toThrow();
    }
  });

  it("weights my own value highest in a fight", () => {
    const fight = weightsFor("fight", BOT_PROFILES.hard);
    expect(fight.myEv).toBeGreaterThan(fight.theirEv);
  });

  it("weights danger over damage when resetting", () => {
    const reset = weightsFor("reset", BOT_PROFILES.hard);
    expect(reset.theirEv).toBeGreaterThan(reset.myEv);
  });

  it("makes leaving a wall dominate everything when unpinning", () => {
    const unpin = weightsFor("unpin", BOT_PROFILES.hard);
    const fight = weightsFor("fight", BOT_PROFILES.hard);
    expect(unpin.wallPenalty).toBeGreaterThan(fight.wallPenalty);
  });

  it("scales the danger term by opponentRangeRespect, so easy ignores it (P38)", () => {
    expect(weightsFor("fight", BOT_PROFILES.easy).theirEv).toBe(0);
    expect(weightsFor("fight", BOT_PROFILES.hard).theirEv).toBeGreaterThan(0);
  });

  it("scales ONLY the danger term by the profile, so a tier cannot change what a play is FOR (P38)", () => {
    // The base table is the situation's identity. A tier is allowed to feel a pressure more or less
    // strongly; it is not allowed to turn `punish` into `reset`. Every term except `theirEv` must
    // therefore read identically at every tier.
    for (const id of ALL_SITUATIONS) {
      const easy = weightsFor(id, BOT_PROFILES.easy);
      const hard = weightsFor(id, BOT_PROFILES.hard);
      expect(easy.myEv, id).toBe(hard.myEv);
      expect(easy.rangeError, id).toBe(hard.rangeError);
      expect(easy.wallPenalty, id).toBe(hard.wallPenalty);
      expect(easy.lockKeep, id).toBe(hard.lockKeep);
    }
  });

  it("never returns a negative weight — every term is a magnitude, the sign lives in rawScore", () => {
    for (const id of ALL_SITUATIONS) {
      for (const tier of ["easy", "medium", "hard"] as const) {
        const w = weightsFor(id, BOT_PROFILES[tier]);
        for (const [term, value] of Object.entries(w)) {
          expect(value, `${tier}/${id}/${term}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("hands back a fresh object, so a caller cannot poison the shared table", () => {
    const a = weightsFor("fight", BOT_PROFILES.hard);
    a.myEv = -999;
    expect(weightsFor("fight", BOT_PROFILES.hard).myEv).toBe(2);
  });
});
