import { describe, expect, it } from "vitest";
import { freshImpacts, newImpactTracker } from "./impact-feedback.js";

const pose = (sessionId: string, x: number, y: number, angle = 0) => ({ sessionId, x, y, angle });

describe("freshImpacts", () => {
  it("reports nothing when nobody is touching", () => {
    const tracker = newImpactTracker();
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 500, 500)], tracker)).toEqual([]);
  });

  it("reports a contact on the frame it begins, with a midpoint to draw at", () => {
    const tracker = newImpactTracker();
    const hits = freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sessionId).toBe("them");
    expect(hits[0]!.x).toBeCloseTo(23.5, 6);
    expect(hits[0]!.y).toBeCloseTo(0, 6);
  });

  it("does not re-report a contact that is still held", () => {
    const tracker = newImpactTracker();
    freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker);
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker)).toEqual([]);
  });

  it("reports again after separating and re-touching", () => {
    const tracker = newImpactTracker();
    freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker);
    freshImpacts(pose("me", 0, 0), [pose("them", 500, 0)], tracker);
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker)).toHaveLength(1);
  });

  it("forgets a car that disappears, so a rejoin is not stuck as still-touching", () => {
    const tracker = newImpactTracker();
    freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker);
    freshImpacts(pose("me", 0, 0), [], tracker);
    expect(freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker)).toHaveLength(1);
  });
});
