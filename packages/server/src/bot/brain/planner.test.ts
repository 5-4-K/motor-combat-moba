import { describe, expect, it } from "vitest";
import {
  ARENA_01, boundsOf, DRIVE_CONFIG, slotsOf, weaponDefOf, type SimBody,
} from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import type { BotArenaView, BotCarView, BotSelfView, BotSlotView } from "../types.js";
import type { PosePredictor } from "./solution.js";
import {
  ALL_ACTIONS, commitWindowOf, facingErrorOf, plan, type PlanArgs, type PlanWeights,
} from "./planner.js";

const arena: BotArenaView = { width: 1280, height: 720, obstacles: [] };

function slotsFor(carId: "bullseye"): BotSlotView[] {
  return slotsOf(carId).map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  }));
}

function selfAt(x: number, y: number, angle: number): BotSelfView {
  return {
    sessionId: "me", carId: "bullseye", team: 0, x, y, angle,
    // 200 u/s along the heading — the car-physics rework's spelling of the old `speed: 200`.
    vx: Math.cos(angle) * 200, vy: Math.sin(angle) * 200,
    hp: 65, maxHp: 65, alive: true, statuses: [], slots: slotsFor("bullseye"),
    switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
  };
}

const target: BotCarView = {
  sessionId: "them", carId: "mirage", team: 1, x: 700, y: 360, angle: Math.PI, vx: 0, vy: 0,
  hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
};

const fightWeights: PlanWeights = {
  myEv: 1, theirEv: 0, rangeError: 0.01, wallPenalty: 5, lockKeep: 0.5, threatAvoid: 0,
  facingError: 0,
};

const stationary: PosePredictor = () => ({ x: target.x, y: target.y, angle: target.angle });

const base: Omit<PlanArgs, "self"> = {
  target, targetAt: stationary,
  readiness: () => 1, aimSigmaRad: 0.03, preferredRange: 400,
  // The commitment window is derived from the horizon (R-P12,
  // `BRAIN_CONSTANTS.commitWindowFraction`): a candidate is the first half of the horizon under
  // the action being tested, then a neutral coast to a stop over the second half.
  weights: fightWeights, horizonTicks: 20, depth: 1, shotThreats: [], actuationDelayTicks: 0,
  pending: [],
  targetBranches: 1, commitPenalty: 0, lastAction: undefined,
  tick: 0, arena,
};

/**
 * Bullseye turns at ~7.11 rad/s, so a 20-tick horizon is 4.7 radians — three quarters of a full
 * revolution, and enough for a hard-over steer to loop past the target and come back pointing at
 * it. Six ticks (1.42 rad) is the horizon at which "turned toward it" and "turned away from it"
 * are still two different answers, which is what the steering assertions below are about.
 */
const SHORT_HORIZON = 6;

describe("ALL_ACTIONS", () => {
  it("is the complete input space, not a sample (P23)", () => {
    expect(ALL_ACTIONS).toHaveLength(9);
    const seen = new Set(ALL_ACTIONS.map((a) => `${a.steer}:${a.throttle}`));
    expect(seen.size).toBe(9);
  });

  it("leads with drive-straight-on, the tie-break of record", () => {
    expect(ALL_ACTIONS[0]).toEqual({ steer: 0, throttle: 1 });
  });
});

describe("plan", () => {
  it("turns toward a target that is off to one side", () => {
    // Target is at bearing 0; the bot faces 90 degrees away from it.
    const result = plan({
      ...base, self: selfAt(300, 360, -Math.PI / 2), horizonTicks: SHORT_HORIZON,
    });
    expect(result.action.steer).toBe(1);
  });

  it("does not steer into a wall it is about to hit", () => {
    // Nose into the left wall, target behind. Turning away must beat driving on.
    const result = plan({ ...base, self: selfAt(30, 360, Math.PI) });
    expect(result.action.throttle === 1 && result.action.steer === 0).toBe(false);
  });

  it("reports a score breakdown for the overlay (P45)", () => {
    const result = plan({ ...base, self: selfAt(300, 360, 0) });
    expect(Object.keys(result.terms).sort()).toEqual(
      ["facingError", "lockKeep", "myEv", "rangeError", "theirEv", "threatAvoid", "wallPenalty"],
    );
  });

  // --- R-P7: the whole arc is scored, not its terminus ----------------------------------------
  it("finds a shot the arc SWEEPS through, not only the one it ends on (R-P7, spec 2)", () => {
    // A 22-tick full-lock roll rotates a Bullseye ~2.6 rad, so the only headings a K=22 candidate
    // can END on are 0 and +-150 degrees; a small correction is not on the menu and, scored at the
    // terminus alone, `steer: 0` wins from any pose that is merely a little off. Here the target
    // sits 0.25 rad off the nose — the exact geometry that froze the duel — and the bot is at rest.
    const self: BotSelfView = { ...selfAt(200, 360, 0), vx: 0, vy: 0 };
    const offAxis = { ...target, x: 753, y: 500, carId: "mirage" as const };
    const result = plan({
      ...base, self, target: offAxis,
      targetAt: () => ({ x: offAxis.x, y: offAxis.y, angle: offAxis.angle }),
      preferredRange: 530, horizonTicks: 22, commitPenalty: 0,
    });
    // Turning toward it must beat holding, and it can only do so on a value found MID-ARC: at the
    // end of a 22-tick full-lock roll the nose is 2.36 rad the wrong way.
    expect(result.action.steer).toBe(1);
    expect(result.terms.myEv).toBeGreaterThan(20);
  });

  // --- R-P8 / P40: the reactive dodge ----------------------------------------------------------
  it("scores displacement along an in-flight shot's away heading (P40, R-P8)", () => {
    const dodging: PlanWeights = {
      myEv: 0, theirEv: 0, rangeError: 0, wallPenalty: 0, lockKeep: 0, threatAvoid: 1,
      facingError: 0,
    };
    // Away is +y. The bot faces +x, so only a turn can carry it there.
    const north = plan({
      ...base, self: selfAt(400, 360, 0), weights: dodging, horizonTicks: SHORT_HORIZON,
      shotThreats: [{ awayHeadingRad: Math.PI / 2 }],
    });
    const south = plan({
      ...base, self: selfAt(400, 360, 0), weights: dodging, horizonTicks: SHORT_HORIZON,
      shotThreats: [{ awayHeadingRad: -Math.PI / 2 }],
    });
    expect(north.terms.threatAvoid).toBeGreaterThan(0);
    expect(south.terms.threatAvoid).toBeGreaterThan(0);
    // Flipping which way the shot came from must flip which way the bot leans.
    expect(north.action.steer).toBe(1);
    expect(south.action.steer).toBe(-1);
  });

  it("is inert when nothing is in the air, and costs nothing to ask", () => {
    const result = plan({ ...base, self: selfAt(300, 360, 0), shotThreats: [] });
    expect(result.terms.threatAvoid).toBe(0);
  });

  it("lets two shots from opposite sides cancel rather than sidestepping into one (R-P8)", () => {
    const result = plan({
      ...base, self: selfAt(400, 360, 0), horizonTicks: SHORT_HORIZON,
      shotThreats: [{ awayHeadingRad: Math.PI / 2 }, { awayHeadingRad: -Math.PI / 2 }],
    });
    expect(Math.abs(result.terms.threatAvoid)).toBeLessThan(1e-9);
  });

  it("with horizon 0, the candidates are not all tied -- moving the scene changes the answer (P29, R-P6)", () => {
    // A degenerate K=0 that rolled nothing would score every one of the nine candidates at the
    // identical CURRENT pose, so the ALL_ACTIONS tie-break would decide the same action regardless
    // of the scene -- an open field and a car jammed against a wall would come out identical. R-P6
    // floors the roll at one tick even at K=0, so these two must differ.
    const openField = plan({ ...base, self: selfAt(300, 360, Math.PI), horizonTicks: 0 });
    const nearWall = plan({ ...base, self: selfAt(30, 360, Math.PI), horizonTicks: 0 });
    expect(nearWall.action).not.toEqual(openField.action);
  });

  it("does not steer into a wall it is about to hit, even at horizon 0 (P29, R-P6)", () => {
    // The same assertion as "does not steer into a wall it is about to hit" above, at K=0: a
    // degenerate zero-tick roll cannot tell a candidate that drives into the wall apart from one
    // that turns away, since neither one actually moves before it is scored.
    const result = plan({ ...base, self: selfAt(30, 360, Math.PI), horizonTicks: 0 });
    expect(result.action.throttle === 1 && result.action.steer === 0).toBe(false);
  });

  it("names a runner-up that is a genuinely different action", () => {
    const result = plan({ ...base, self: selfAt(300, 360, 0) });
    expect(result.runnerUp).toBeDefined();
    expect(result.runnerUp).not.toEqual(result.action);
  });

  it("scores an aim-assisted slot's lock envelope, not its bare reach (P13)", () => {
    // Nose exactly on the target at 400u: inside predator's cone, lateral cap and aim range.
    const onLine = plan({ ...base, self: selfAt(300, 360, 0), horizonTicks: 0 });
    expect(onLine.terms.lockKeep).toBe(1);
    // Nose 90 degrees off, at the same distance — inside predator's 800u REACH, but far outside
    // the 20-degree acquisition cone, so no lock is held or acquirable from there.
    const offLine = plan({ ...base, self: selfAt(300, 360, -Math.PI / 2), horizonTicks: 0 });
    expect(offLine.terms.lockKeep).toBe(0);
  });

  it("only lets the assist zero the aim error inside the lock envelope (P13)", () => {
    // Same distance, same kit, same everything but the nose. An assist that were gated on the
    // weapon's RANGE alone would call both of these assisted, hand both a certain shot, and score
    // a car pointed 90 degrees away from its target exactly as highly as one aimed at it.
    // Predator alone, so `myEv` is the assisted slot's own number and not pepperbox's.
    const predatorOnly: BotSelfView = {
      ...selfAt(300, 360, 0), slots: [slotsFor("bullseye")[0]!],
    };
    const onLine = plan({ ...base, self: predatorOnly, horizonTicks: 0 });
    const offLine = plan({
      ...base, self: { ...predatorOnly, angle: -Math.PI / 2 }, horizonTicks: 0,
    });
    expect(onLine.terms.myEv).toBeGreaterThan(0);
    expect(offLine.terms.myEv).toBeLessThan(onLine.terms.myEv);
  });

  it("scores the aim point the SHOT reaches, not the one the bot arrives at (R-P5)", () => {
    // A target crossing at 400 u/s, 400 units away, against pepperbox's 800 u/s pellets: the shot
    // is roughly 17 ticks in the air, so the target is ~227 units further down the screen by the
    // time it lands and the heading worth holding is ~0.5 rad, not 0.
    // `angle: PI/2` with 400 u/s along it is straight down the screen — matching the `crossing`
    // predictor just below, which advances y by 400 u/s and holds x.
    const crossingTarget: BotCarView = { ...target, angle: Math.PI / 2, vx: 0, vy: 400 };
    const crossing: PosePredictor = (ticksAhead) => ({
      x: 700, y: 360 + (400 * ticksAhead) / 30, angle: Math.PI / 2,
    });
    const pepperboxOnly: BotSelfView = {
      ...selfAt(300, 360, 0), slots: [slotsFor("bullseye")[1]!],
    };
    const scene = {
      ...base, target: crossingTarget, targetAt: crossing, horizonTicks: 0,
    };
    const atTargetNow = plan({ ...scene, self: pepperboxOnly });
    const ledAhead = plan({ ...scene, self: { ...pepperboxOnly, angle: 0.5 } });
    expect(ledAhead.terms.myEv).toBeGreaterThan(atTargetNow.terms.myEv);
  });

  it("reads the danger it is standing in from the opponent's kit (P16, P26)", () => {
    const result = plan({
      ...base, self: selfAt(300, 360, 0), horizonTicks: 0,
      weights: { ...fightWeights, theirEv: 1 },
    });
    expect(result.terms.theirEv).toBeGreaterThan(0);
  });

  it("takes the worst case over the target's plausible inputs (P28)", () => {
    // Their nose is turned away from us, so a hedged branch that turns it back reads WORSE.
    const turnedAway: BotCarView = { ...target, angle: Math.PI * 0.6 };
    const scene = {
      ...base, self: selfAt(300, 360, 0), target: turnedAway,
      targetAt: (() => ({
        x: turnedAway.x, y: turnedAway.y, angle: turnedAway.angle,
      })) as PosePredictor,
      weights: { ...fightWeights, theirEv: 1 },
      horizonTicks: SHORT_HORIZON,
    };
    const nominal = plan({ ...scene, targetBranches: 1 });
    const hedged = plan({ ...scene, targetBranches: 3 });
    expect(hedged.terms.theirEv).toBeGreaterThan(nominal.terms.theirEv);
  });

  // --- R-P3: no target is not a separate code path ------------------------------------------
  describe("with no target", () => {
    const waypoint: PosePredictor = () => ({ x: 700, y: 360, angle: 0 });
    const hunt: Omit<PlanArgs, "self"> = {
      ...base, target: undefined, targetAt: waypoint, preferredRange: 0,
      horizonTicks: SHORT_HORIZON,
    };

    it("still drives toward the synthetic waypoint", () => {
      const result = plan({ ...hunt, self: selfAt(300, 360, -Math.PI / 2) });
      expect(result.action.steer).toBe(1);
    });

    it("rolls its own car with the engine ON (R-D3)", () => {
      // From a dead stop. `predict.ts`'s OBSERVATION_MODIFIERS zero `accel` so that rolling a car
      // the bot can only look at HOLDS the speed it was seen at — under that set this candidate
      // could not move at all and every rangeError would still read the full 400 units. The
      // planner rolls its OWN car under a throttle it is choosing, so it must use NEUTRAL.
      const stopped: BotSelfView = { ...selfAt(300, 360, 0), vx: 0, vy: 0 };
      const result = plan({ ...hunt, self: stopped, horizonTicks: 10 });
      expect(result.terms.rangeError).toBeLessThan(399);
    });

    it("still scores the wall and the range, and zeroes only the target terms", () => {
      const result = plan({ ...hunt, self: selfAt(30, 360, Math.PI), horizonTicks: 0 });
      expect(result.terms.wallPenalty).toBeGreaterThan(0);
      expect(result.terms.rangeError).toBeGreaterThan(0);
      expect(result.terms.myEv).toBe(0);
      expect(result.terms.theirEv).toBe(0);
      expect(result.terms.lockKeep).toBe(0);
    });
  });

  // --- R-P4: commitPenalty is a fraction of the candidate score SPREAD ----------------------
  describe("commitPenalty (P30)", () => {
    const waypoint: PosePredictor = () => ({ x: 700, y: 360, angle: 0 });
    const scene: Omit<PlanArgs, "self"> = {
      ...base, target: undefined, targetAt: waypoint, preferredRange: 0,
      horizonTicks: SHORT_HORIZON,
    };
    const self = selfAt(300, 360, -Math.PI / 2);

    it("prefers its last action when the bonus is large, all else equal", () => {
      const sticky = plan({
        ...scene, self, commitPenalty: 1000, lastAction: { steer: -1, throttle: -1 },
      });
      expect(sticky.action).toEqual({ steer: -1, throttle: -1 });
    });

    it("flips a near-tie at a value the profiles actually ship, and not at 0", () => {
      const neutral = plan({ ...scene, self, commitPenalty: 0, lastAction: undefined });
      const rival = neutral.runnerUp;
      expect(rival).toBeDefined();
      expect(rival).not.toEqual(neutral.action);

      const sticky = plan({ ...scene, self, commitPenalty: 0.8, lastAction: rival });
      expect(sticky.action).toEqual(rival);

      const unchanged = plan({ ...scene, self, commitPenalty: 0, lastAction: rival });
      expect(unchanged.action).toEqual(neutral.action);
    });

    it("is scale-free: one value makes the same call at a hundred times the weights", () => {
      // The whole of R-P4. Scores are linear in the weights, so scaling every weight by 100 scales
      // every candidate score and the spread by exactly 100 and changes no ordering. A bonus that
      // is a FRACTION OF THE SPREAD therefore makes the identical decision at both scales; the
      // raw addend this replaced would flip the small scene and go inert on the large one, which
      // is how a knob shipped at 0.1 / 0.4 / 0.8 stays honest against a `myEv` in the tens.
      const fight: Omit<PlanArgs, "self"> = { ...base, horizonTicks: SHORT_HORIZON };
      const nose = selfAt(300, 360, -Math.PI / 2);
      const hundredfold: PlanWeights = {
        myEv: 100, theirEv: 0, rangeError: 1, wallPenalty: 500, lockKeep: 50, threatAvoid: 0,
        facingError: 0,
      };

      const neutral = plan({ ...fight, self: nose, commitPenalty: 0 });
      const rival = neutral.runnerUp;
      expect(rival).not.toEqual(neutral.action);

      // 0.95, not the 0.8 this shipped at when the test was written: since R-P7 began scoring the
      // whole arc, `myEv` reads the best moment along each candidate rather than its terminus, and
      // the winner's margin over the runner-up in THIS scene grew as a fraction of the spread. The
      // property under test is unchanged and is not that number — it is that ONE value makes the
      // SAME call at both weight scales, which is what a fraction-of-the-spread bonus buys and what
      // a raw addend could not. (0.18, hard's, is the largest shipped value; see `commitPenalty`.
      // The test value is deliberately far above it — this is a property check, not a calibration.)
      const bonus = 0.95;
      const asShipped = plan({ ...fight, self: nose, commitPenalty: bonus, lastAction: rival });
      const scaled = plan({
        ...fight, self: nose, weights: hundredfold, commitPenalty: bonus, lastAction: rival,
      });
      expect(asShipped.action).toEqual(rival);
      expect(scaled.action).toEqual(rival);
      expect(scaled.score).toBeCloseTo(asShipped.score * 100, 6);
    });
  });

  // --- R-P16: the commit bonus is a fraction of a ROBUST spread ------------------------------
  it("does not let one out-of-arena candidate turn commitPenalty into a latch (R-P16)", () => {
    // Nose planted at the very edge of the left wall, facing straight into it, with a horizon long
    // enough (40 ticks) that the naive "drive straight on" candidate (`steer: 0, throttle: 1`)
    // covers hundreds of units past the wall with nothing in the rollout to stop it — exactly the
    // out-of-arena outlier R-P16 is about. `wallPenalty` squares the overshoot, so that candidate's
    // score comes in far below every candidate a driver would actually weigh against each other,
    // while the other eight stay within a normal few-dozen-point band.
    const waypoint: PosePredictor = () => ({ x: 700, y: 360, angle: 0 });
    const scene: Omit<PlanArgs, "self"> = {
      ...base, target: undefined, targetAt: waypoint, preferredRange: 0, horizonTicks: 40,
    };
    const self = selfAt(5, 360, Math.PI);

    const neutral = plan({ ...scene, self, commitPenalty: 0, lastAction: undefined });
    // The genuine best play here is to brake rather than drive further into the wall.
    //
    // RE-PINNED at the 2026-09-07 merge of the car-physics rework: the winner was `steer: 0`
    // under the pre-rework drive model and is `steer: -1` under the vector one. Both brake — the
    // `throttle: -1` half, which is what the comment above is about, is unchanged — but a heavy
    // car that now carries its momentum into the wall does better to turn OFF the wall while it
    // sheds that momentum than to sit square against it. A better play, and the expected direction
    // for this scene under the new physics. This assertion only names the winner so the two
    // `sticky` assertions below have something to compare against; R-P16's actual subject is that
    // a commit bonus toward `clearlyWorse` cannot latch the planner onto it, and that is untouched.
    expect(neutral.action).toEqual({ steer: -1, throttle: -1 });

    // A SANE candidate that is nonetheless clearly worse than the winner — reversed hard while
    // steering, not the wall-crashing outlier. Under the old `max - min` normalisation the outlier
    // inflates the spread so far that even hard's real shipped `commitPenalty` (0.1) produces a
    // bonus bigger than this candidate's genuine deficit, and the planner repeats it regardless of
    // how bad it is: exactly the latch behaviour R-P16 fixes. `max - median` keeps the bonus scaled
    // to the spread among the eight candidates that never left the arena, which is far too small to
    // cover this gap.
    // RE-CHOSEN at the 2026-09-07 merge, for the same reason the winner above moved. This used to
    // be `{ steer: 1, throttle: -1 }` — reversed hard while steering the OTHER way. Under the
    // vector drive that candidate is no longer clearly worse: facing square into the wall at the
    // arena's vertical centre, turning left and turning right are symmetric, and the two score
    // within 0.23 of each other against a ~200-point spread across the nine candidates. A gap that
    // is 0.1% of the spread is a tie, not a deficit, so the assertion below stopped testing
    // anything — a commit bonus SHOULD be able to break a tie, and R-P16 never promised otherwise.
    //
    // `{ steer: 0, throttle: 0 }` restores the gap the test needs: no input at all, coasting into
    // the wall, ~93 points below the winner where `max - median` (what R-P16 scales the bonus to)
    // is 1.78. It is still a SANE candidate rather than the out-of-arena outlier the scene is built
    // around — that is `{ steer: 0, throttle: 1 }`, 203 points down, and using it would test the
    // easy case instead of R-P16's real one.
    const clearlyWorse = { steer: 0, throttle: 0 } as const;
    expect(clearlyWorse).not.toEqual(neutral.action);

    const sticky = plan({
      ...scene, self, commitPenalty: BOT_PROFILES.hard.commitPenalty, lastAction: clearlyWorse,
    });
    expect(sticky.action).not.toEqual(clearlyWorse);
    expect(sticky.action).toEqual(neutral.action);
  });



  // --- P43 / H21: no randomness anywhere in the planner --------------------------------------
  it("draws no random numbers (P43)", () => {
    const original = Math.random;
    Math.random = (() => { throw new Error("planner must not draw rng"); }) as typeof Math.random;
    try {
      expect(() => plan({ ...base, self: selfAt(300, 360, 0) })).not.toThrow();
    } finally {
      Math.random = original;
    }
  });

  it("is deterministic: the same observation plans the same way twice", () => {
    const args: PlanArgs = {
      ...base, self: selfAt(300, 360, -Math.PI / 2), depth: 2, targetBranches: 3,
      horizonTicks: 22, commitPenalty: 0.8, lastAction: { steer: 1, throttle: 1 },
    };
    const first = plan(args);
    const second = plan(args);
    expect(second).toEqual(first);
  });

  // --- R-P17: the commitment window is PER DEPTH -------------------------------------------
  describe("commitWindowOf", () => {
    it("leaves a real coasting tail at depth 2 (R-P17)", () => {
      // THE DEFECT: `commit` was `ceil(K * fraction)` computed from the WHOLE horizon and then
      // applied `depth` times, so `commit * depth` was `2 * 0.52K > K` for every K and `tail` was
      // identically 0 at depth 2 — hard would roll 24 committed ticks against a 22-tick horizon
      // with no coast at all. That is the whole-horizon hold R-P10 replaced, silently reinstated,
      // and it disables the property the two terminal-read terms depend on: with no coast, the
      // terminus is not a place the car can be left. Under the old formula this test reads
      // commit 12, tail 0, and fails on the first assertion.
      const { commit, tail } = commitWindowOf(22, 2);
      expect(commit * 2).toBeLessThanOrEqual(22);
      expect(tail).toBeGreaterThan(0);
      expect(commit).toBe(6);
      expect(tail).toBe(10);
    });

    it("is arithmetically unchanged at the depth every profile ships (depth 1)", () => {
      // The division by `depth` must be a no-op at depth 1, or the fix moves behaviour the
      // seven-seed sweep already settled. Hard, medium, and easy's K=0 floor.
      expect(commitWindowOf(BOT_PROFILES.hard.planHorizonTicks, 1)).toEqual({ commit: 12, tail: 10 });
      expect(commitWindowOf(BOT_PROFILES.medium.planHorizonTicks, 1)).toEqual({ commit: 5, tail: 3 });
      expect(commitWindowOf(BOT_PROFILES.easy.planHorizonTicks, 1)).toEqual({ commit: 1, tail: 0 });
    });

    it("never rolls a zero-tick window, at either depth (R-P6)", () => {
      // The floor outranks the `floor(K / depth)` cap. K=1 at depth 2 is the only case where it
      // wins and `commit * depth` exceeds K; no profile ships it, and the plan is then two ticks
      // long rather than zero, which is the floor doing its job.
      for (const depth of [1, 2] as const) {
        for (const k of [0, 1, 2, 3, 8, 22, 40]) {
          expect(commitWindowOf(k, depth).commit).toBeGreaterThanOrEqual(1);
        }
      }
      expect(commitWindowOf(1, 2)).toEqual({ commit: 1, tail: 0 });
    });
  });

  it("plans at the preserved depth-2 dial, which no profile ships today", () => {
    // `planDepth: 2` is the upgrade path spec P33 names and `planDepth`'s own doc advertises; all
    // three tiers ship depth 1. This exercises the dial end to end at hard's horizon, and pins that
    // the arc it rolls is genuinely LONGER than its committed windows — i.e. a coast segment
    // survives, which is what makes reading `rangeError` and `threatAvoid` at the terminus honest.
    const { commit, tail } = commitWindowOf(22, 2);
    expect(commit * 2 + tail).toBeGreaterThan(commit * 2);

    const result = plan({
      ...base, self: selfAt(300, 360, -Math.PI / 2), depth: 2, targetBranches: 3,
      horizonTicks: 22,
    });
    expect(ALL_ACTIONS).toContainEqual(result.action);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  /**
   * AS28. `wallPenalty` is the planner's only anti-wall-hugging gradient, and it used to compare
   * against `0`/`width`/`height` — which on the octagon is not the playable edge, so the whole term
   * was dead there except for poses already outside the arena.
   *
   * Both cases use an OBSTACLE-FREE view of `arena-01`: the real arena's fourteen spike strips sit
   * against the same walls and the binary obstacle term inside `boundsPenalty` would fire on this
   * pose regardless of which edge the bounds half compared against, which is exactly why the dead
   * gradient went unnoticed. Isolating the planes is what makes this discriminate.
   */
  describe("wallPenalty on a polygon arena", () => {
    const bare = { width: ARENA_01.width, height: ARENA_01.height, obstacles: [] };
    const octagon = { ...bare, planes: boundsOf(ARENA_01).planes };
    // Inside the top-left chamfer and clear of every rect edge by more than the 48-unit margin:
    // x=120 and y=100 are both far from 0, and from 1280/720.
    const nearChamfer = selfAt(120, 100, 0);

    it("penalises a pose jammed into a chamfer", () => {
      const result = plan({ ...base, arena: octagon, self: nearChamfer, horizonTicks: 0 });
      expect(result.terms.wallPenalty).toBeGreaterThan(0);
    });

    it("scores that same pose at zero on a rectangle, so arena-02 is untouched", () => {
      const result = plan({ ...base, arena: bare, self: nearChamfer, horizonTicks: 0 });
      expect(result.terms.wallPenalty).toBe(0);
    });
  });
});

describe("facingErrorOf", () => {
  // A body with only the fields the function reads. The planner's rollout produces full
  // SimBodies; this pins the function, not the rollout.
  const at = (vx: number, vy: number, angle: number) =>
    ({ x: 0, y: 0, angle, vx, vy } as SimBody);

  it("is 0 driving straight ahead, at any heading", () => {
    expect(facingErrorOf(at(100, 0, 0))).toBeCloseTo(0, 9);
    expect(facingErrorOf(at(0, 100, Math.PI / 2))).toBeCloseTo(0, 9);
    expect(facingErrorOf(at(-100, 0, Math.PI))).toBeCloseTo(0, 9);
  });

  it("is 1 reversing — the case the whole term exists for", () => {
    expect(facingErrorOf(at(-100, 0, 0))).toBeCloseTo(1, 9);
    expect(facingErrorOf(at(0, -100, Math.PI / 2))).toBeCloseTo(1, 9);
  });

  it("is 0.5 sliding exactly sideways", () => {
    expect(facingErrorOf(at(0, 100, 0))).toBeCloseTo(0.5, 9);
    expect(facingErrorOf(at(0, -100, 0))).toBeCloseTo(0.5, 9);
  });

  it("is 0 at rest, not undefined — this is what removes the reference-direction problem (F8)", () => {
    expect(facingErrorOf(at(0, 0, 0))).toBe(0);
    // Inside the sim's own rest band, so the sim and the planner agree on what 'stopped' means.
    expect(facingErrorOf(at(DRIVE_CONFIG.stopEpsilon / 2, 0, Math.PI))).toBe(0);
  });

  it("is scale-free: doubling the speed does not change the term", () => {
    expect(facingErrorOf(at(50, 50, 0))).toBeCloseTo(facingErrorOf(at(500, 500, 0)), 9);
  });

  it("stays inside [0, 1] at every angle, so it can never swamp a weight table tuned against it", () => {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const e = facingErrorOf(at(Math.cos(a) * 137, Math.sin(a) * 137, 0.7));
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });
});
