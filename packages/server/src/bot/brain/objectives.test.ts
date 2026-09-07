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

  it("wants off an in-flight shot's line ONLY when evading (P40, R-P8)", () => {
    // The reactive dodge is a different reflex from `theirEv`'s avoidance of a firing solution the
    // opponent could take (P40 keeps both), and it belongs to exactly one play: `evade` is the
    // situation a shot in the air PUTS the bot in. Any other play weighting it would have the bot
    // abandoning a fight, a corner or a hunt to sidestep something it has already decided not to
    // treat as an emergency.
    const evade = weightsFor("evade", BOT_PROFILES.hard);
    expect(evade.threatAvoid).toBeGreaterThan(0);
    for (const id of ALL_SITUATIONS) {
      if (id === "evade") continue;
      expect(weightsFor(id, BOT_PROFILES.hard).threatAvoid, id).toBe(0);
    }
  });

  it("weights the dodge heavily enough to actually move the car (R-P8)", () => {
    // `threatAvoid` is a DISPLACEMENT in world units, so its weight has to be read against that
    // scale and not against the 0-1 terms. The statement that matters: while a shot is in the air,
    // a sidestep must be worth more than the best shot the bot could take instead (`myEv` tops out
    // near 75 EV/s). A dodge that loses that comparison is a mechanism the three dodge knobs
    // describe and the car never performs.
    //
    // THE 100 BELOW IS A UNIT OF COMPARISON, NOT A DISPLACEMENT THE MENU OFFERS (M6, fix wave 3,
    // 2026-09-07). This comment used to justify it as "roughly +-200 over hard's 22-tick horizon",
    // which was true before R-P10: a candidate was one input held for the whole horizon. Under the
    // shipped commitment window plus `CONTINUATION`'s coast to rest, the nine terminal poses sit
    // ~40 units apart and a stationary bot's whole menu spans ~4 units of travel. So the real
    // separation this weight buys is ~24 points at the spread, not 120.
    //
    // The assertion is unchanged and still passes because it is arithmetic on the weight table
    // (0.6 x 100 = 60 against 0.3 x 75 = 22.5) — it compares the two terms' PER-UNIT rates, which
    // is the comparison that matters and is scale-free in the displacement. Do not read the 100 as
    // a claim about how far the car can move in one plan; see `objectives.ts`'s table note.
    const evade = weightsFor("evade", BOT_PROFILES.hard);
    expect(evade.threatAvoid * 100).toBeGreaterThan(evade.myEv * 75);
  });

  it("hands back a fresh object, so a caller cannot poison the shared table", () => {
    const a = weightsFor("fight", BOT_PROFILES.hard);
    a.myEv = -999;
    expect(weightsFor("fight", BOT_PROFILES.hard).myEv).toBe(2);
  });
});
