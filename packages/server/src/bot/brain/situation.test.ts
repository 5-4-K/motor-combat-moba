import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import {
  classifySituation, newSituationState, pickSituation, type SituationInputs,
} from "./situation.js";

const fight: SituationInputs = {
  selfControlLost: false, hittable: true, evade: false, unpin: false,
  punish: false, reset: false, inOwnReach: true,
};

describe("classifySituation", () => {
  it("names recover when control is lost", () => {
    expect(classifySituation({ ...fight, selfControlLost: true })).toBe("recover");
  });

  it("names waitOut when there is nobody hittable", () => {
    expect(classifySituation({ ...fight, hittable: false })).toBe("waitOut");
  });

  it("lets unpin beat fight when pinned with a target", () => {
    expect(classifySituation({ ...fight, unpin: true })).toBe("unpin");
  });

  it("lets punish beat fight when the target is a free hit", () => {
    expect(classifySituation({ ...fight, punish: true })).toBe("punish");
  });

  it("names close when they are up but not in reach", () => {
    expect(classifySituation({ ...fight, inOwnReach: false })).toBe("close");
  });
});

describe("pickSituation", () => {
  const hard = BOT_PROFILES.hard;

  it("lets a higher-priority situation cut in before the commit window", () => {
    const state = { current: "fight" as const, sinceTick: 100 };
    const next = pickSituation(state, "punish", 101, hard);
    expect(next.current).toBe("punish");
  });

  it("holds a lower-priority replacement until situationCommitTicks", () => {
    const state = { current: "punish" as const, sinceTick: 100 };
    const next = pickSituation(state, "fight", 101, hard);
    expect(next.current).toBe("punish");
  });

  it("takes the lower-priority replacement after the window", () => {
    const state = { current: "punish" as const, sinceTick: 100 };
    const next = pickSituation(state, "fight", 100 + hard.situationCommitTicks, hard);
    expect(next.current).toBe("fight");
  });

  it("leaves waitOut the moment a fight exists, without waiting out the commit window", () => {
    const state = { current: "waitOut" as const, sinceTick: 100 };
    const next = pickSituation(state, "fight", 101, hard);
    expect(next.current).toBe("fight");
  });
});
