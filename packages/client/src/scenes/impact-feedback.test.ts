import { describe, expect, it } from "vitest";
import { freshImpacts, newImpactTracker } from "./impact-feedback.js";

const pose = (sessionId: string, x: number, y: number, angle = 0, team: 0 | 1 = 0) => ({
  sessionId,
  x,
  y,
  angle,
  team,
});

describe("freshImpacts", () => {
  it("reports nothing when nobody is touching", () => {
    const tracker = newImpactTracker();
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 500, 500)], tracker, "ffa")).toEqual([]);
  });

  it("reports a contact on the frame it begins, with a midpoint to draw at", () => {
    const tracker = newImpactTracker();
    const hits = freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sessionId).toBe("them");
    expect(hits[0]!.x).toBeCloseTo(23.5, 6);
    expect(hits[0]!.y).toBeCloseTo(0, 6);
  });

  it("does not re-report a contact that is still held", () => {
    const tracker = newImpactTracker();
    freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa");
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa")).toEqual([]);
  });

  it("reports again after separating and re-touching", () => {
    const tracker = newImpactTracker();
    freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa");
    freshImpacts(pose("me", 0, 0), [pose("them", 500, 0)], tracker, "ffa");
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa")).toHaveLength(1);
  });

  it("forgets a car that disappears, so a rejoin is not stuck as still-touching", () => {
    const tracker = newImpactTracker();
    freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa");
    freshImpacts(pose("me", 0, 0), [], tracker, "ffa");
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa")).toHaveLength(1);
  });

  describe("team gating", () => {
    // A ram is structurally impossible between teammates (R15, `canDamage`), so the spark must be
    // just as impossible — it would otherwise shake the screen and flash as if a ram had landed on
    // every push through a teammate, contradicting `docs/combat-model.md`'s "no spin, no shove, no
    // authority loss" for friendly contact.
    it("does not spark on a teammate in team mode", () => {
      const tracker = newImpactTracker();
      const hits = freshImpacts(
        pose("me", 0, 0, 0, 0),
        [pose("mate", 47, 0, 0, 0)],
        tracker,
        "team",
      );
      expect(hits).toEqual([]);
    });

    it("still sparks on an opponent in team mode", () => {
      const tracker = newImpactTracker();
      const hits = freshImpacts(
        pose("me", 0, 0, 0, 0),
        [pose("foe", 47, 0, 0, 1)],
        tracker,
        "team",
      );
      expect(hits).toHaveLength(1);
    });

    it("sparks on everyone in FFA regardless of team field", () => {
      // Team mode is what makes team meaningful; FFA ignores it entirely, exactly like `canDamage`.
      const tracker = newImpactTracker();
      const hits = freshImpacts(
        pose("me", 0, 0, 0, 0),
        [pose("them", 47, 0, 0, 0)],
        tracker,
        "ffa",
      );
      expect(hits).toHaveLength(1);
    });

    it("still tracks a teammate as touching, so a later opponent contact is read as fresh, not stale", () => {
      // The gate is only on whether a spark FIRES, not on whether contact is tracked at all —
      // otherwise a teammate parked in contact the whole time could never be told apart from one who
      // just arrived, once team membership changes underneath them (e.g. a mode switch).
      const tracker = newImpactTracker();
      freshImpacts(pose("me", 0, 0, 0, 0), [pose("x", 47, 0, 0, 0)], tracker, "team");
      const hits = freshImpacts(pose("me", 0, 0, 0, 0), [pose("x", 47, 0, 0, 0)], tracker, "team");
      expect(hits).toEqual([]);
    });
  });
});
