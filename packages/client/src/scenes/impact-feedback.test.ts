import { describe, expect, it } from "vitest";
import { RAM_CONFIG, type CarId } from "@motor-combat-moba/shared";
import { freshImpacts, newImpactTracker, type ImpactPose } from "./impact-feedback.js";

const pose = (
  sessionId: string,
  x: number,
  y: number,
  angle = 0,
  team: 0 | 1 = 0,
  vx = 0,
  vy = 0,
): ImpactPose => ({
  sessionId,
  x,
  y,
  angle,
  team,
  vx,
  vy,
  carId: "mirage" as CarId,
  defenceMult: 1,
  ramBlocked: false,
});

/** Nose-first at a speed comfortably over `minRamSpeed` (39 u/s). */
const charging = (sessionId: string, x: number, y: number, team: 0 | 1 = 0) =>
  pose(sessionId, x, y, 0, team, 150, 0);

describe("freshImpacts", () => {
  it("reports nothing when nobody is touching", () => {
    const tracker = newImpactTracker();
    expect(freshImpacts(charging("me", 0, 0), [pose("them", 500, 500)], tracker, "ffa")).toEqual(
      [],
    );
  });

  it("reports a contact on the frame it begins, with a midpoint to draw at", () => {
    const tracker = newImpactTracker();
    const hits = freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sessionId).toBe("them");
    expect(hits[0]!.x).toBeCloseTo(23.5, 6);
    expect(hits[0]!.y).toBeCloseTo(0, 6);
  });

  it("does not re-report a contact that is still held", () => {
    const tracker = newImpactTracker();
    freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa");
    expect(freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa")).toEqual([]);
  });

  it("reports again after separating and re-touching", () => {
    const tracker = newImpactTracker();
    freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa");
    freshImpacts(charging("me", 0, 0), [pose("them", 500, 0)], tracker, "ffa");
    expect(freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa")).toHaveLength(
      1,
    );
  });

  it("forgets a car that disappears, so a rejoin is not stuck as still-touching", () => {
    const tracker = newImpactTracker();
    freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa");
    freshImpacts(charging("me", 0, 0), [], tracker, "ffa");
    expect(freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa")).toHaveLength(
      1,
    );
  });

  it("does not spark on a contact the sim does not call a ram", () => {
    // Drifting in sideways: the drive-in along the nose is zero, so §7.1 disqualifies it as an
    // attacker outright. The cars touch, separate positionally, and nothing else happens — so
    // nothing should flash either.
    const tracker = newImpactTracker();
    const sliding = pose("me", 0, 0, Math.PI / 2, 0, 150, 0);
    expect(freshImpacts(sliding, [pose("them", 47, 0)], tracker, "ffa")).toEqual([]);
  });

  it("does not spark below the ram threshold", () => {
    const tracker = newImpactTracker();
    const crawling = pose("me", 0, 0, 0, 0, RAM_CONFIG.minRamSpeed / 2, 0);
    expect(freshImpacts(crawling, [pose("them", 47, 0)], tracker, "ffa")).toEqual([]);
  });

  it("sparks when the remote is the one ramming", () => {
    // The local car is the victim here, and it is still the local car's screen that should shake —
    // harder, if anything, since it is the one being flung.
    const tracker = newImpactTracker();
    const hit = freshImpacts(
      pose("me", 0, 0),
      [pose("them", 47, 0, Math.PI, 0, -150, 0)],
      tracker,
      "ffa",
    );
    expect(hit).toHaveLength(1);
    expect(hit[0]!.closingSpeed).toBeGreaterThan(0);
  });

  it("does not spark for a car that may not ram", () => {
    const tracker = newImpactTracker();
    const locked = { ...charging("me", 0, 0), ramBlocked: true };
    expect(freshImpacts(locked, [pose("them", 47, 0)], tracker, "ffa")).toEqual([]);
  });

  it("still tracks a non-ram contact, so speeding up mid-grind cannot fake a fresh hit", () => {
    // Contact bookkeeping is independent of whether a spark fires — the same split `applyRams` makes
    // when it records `contacts` for pairs that produce no ram.
    const tracker = newImpactTracker();
    freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa");
    expect(freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa")).toEqual([]);
  });

  it("reports the drive-in speed, so the shake can scale with the hit", () => {
    const tracker = newImpactTracker();
    const hit = freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa")[0]!;
    expect(hit.closingSpeed).toBeGreaterThan(0);
  });

  describe("team gating", () => {
    // A ram is structurally impossible between teammates (R15, `canDamage`), so the spark must be
    // just as impossible — it would otherwise shake the screen and flash as if a ram had landed on
    // every push through a teammate, contradicting `docs/combat-model.md`'s "no spin, no shove, no
    // authority loss" for friendly contact.
    it("does not spark on a teammate in team mode", () => {
      const tracker = newImpactTracker();
      const hits = freshImpacts(
        charging("me", 0, 0),
        [pose("mate", 47, 0, 0, 0)],
        tracker,
        "team",
      );
      expect(hits).toEqual([]);
    });

    it("still sparks on an opponent in team mode", () => {
      const tracker = newImpactTracker();
      const hits = freshImpacts(charging("me", 0, 0), [pose("foe", 47, 0, 0, 1)], tracker, "team");
      expect(hits).toHaveLength(1);
    });

    it("sparks on everyone in FFA regardless of team field", () => {
      // Team mode is what makes team meaningful; FFA ignores it entirely, exactly like `canDamage`.
      const tracker = newImpactTracker();
      const hits = freshImpacts(charging("me", 0, 0), [pose("them", 47, 0, 0, 0)], tracker, "ffa");
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
