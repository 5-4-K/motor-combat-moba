import { describe, expect, it } from "vitest";
import {
  NEUTRAL_MODIFIERS,
  RAM_CONFIG,
  TICK_RATE_HZ,
  boundsOf,
  carHullOf,
  getArena,
  obbsInContact,
  ramDefenceOf,
  resolveRam,
  speedOf,
  stepSim,
  type CarId,
  type SimBody,
} from "@motor-combat-moba/shared";
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

  it("sparks on a head-on where only the remote is moving, crediting the shove it actually lands", () => {
    // NOT a one-way ram: "me" is stationary but faces "them" nose-to-nose, so `resolveRam`
    // classifies this a head-on (§7.1's opposite-heading rule) with `attackerId: ""`. Its two sides
    // are cross-attributed from the OTHER car's speed (`headOnResolution`'s `ontoA`/`ontoB`), so
    // "them"'s own side is exactly zero (attributed from "me"'s zero speed) while "me"'s side
    // carries the real shove (attributed from "them"'s 150 u/s) — confirmed by probing `resolveRam`
    // directly with this fixture. The local car's screen should still shake, on the shove it is
    // actually about to receive.
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

  it("sparks on a genuine one-way remote ram, matching the local car's own shove from the resolution", () => {
    // A real flank ram, unlike the head-on case above: "me" sits stationary at the origin, facing
    // +x; "them" drives nose-first into "me"'s FLANK (top side) at a speed comfortably over
    // `minRamSpeed`. The contact lands on "me"'s side face, so `ramTypeOf` returns "flank"
    // unconditionally (a side hit is never a head-on or a rear) regardless of the two headings, and
    // `resolveRam` returns a one-way resolution naming "them" as `attackerId` with "them"'s own side
    // shoved to exactly zero (the attacker stops dead) and "me"'s side carrying the real push. This
    // is the shape the selector was specifically corrected to handle — the local car as the shoved
    // victim of a remote's ram — and it is what pins the fix: the reported `closingSpeed` must be
    // the magnitude of "me"'s own `RamSide`, not "them"'s (zero) one.
    const tracker = newImpactTracker();
    const me = pose("me", 0, 0);
    const them = pose("them", 0, 37, -Math.PI / 2, 0, 0, -150);

    const ram = resolveRam(me, them, "ffa");
    if (ram === null) throw new Error("expected this fixture to resolve as a ram");
    expect(ram.type).toBe("flank");
    expect(ram.attackerId).toBe("them");
    const myShove = ram.sides.find((s) => s.sessionId === "me");
    if (!myShove) throw new Error("expected a shove recorded for the local car");
    expect(speedOf(myShove.shoveX, myShove.shoveY)).toBeGreaterThan(0);

    const hit = freshImpacts(me, [them], tracker, "ffa");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.closingSpeed).toBeGreaterThan(0);
    expect(hit[0]!.closingSpeed).toBeCloseTo(speedOf(myShove.shoveX, myShove.shoveY), 6);
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

  describe("the velocity this pass must be given", () => {
    /**
     * Drives a real `stepSim` car nose-first into a parked hull and stops on the first tick the two
     * are in contact — the tick `freshImpacts` is edge-triggered on. Returns the tick-entry
     * (PRE-collision) body and the stepped (POST-collision) one, which is what a render pose carries.
     *
     * This is the exact shape of the defect: `resolveWorld` runs inside `stepSim`, so by the time a
     * pose is drawn the component driving into the other car is already gone.
     */
    function driveIntoContact(parkedX: number) {
      const ctx = {
        carId: "mirage" as CarId,
        others: [
          { hull: carHullOf(parkedX, 360, 0), ramDefence: ramDefenceOf("mirage" as CarId) },
        ],
        obstacles: [],
        bounds: boundsOf(getArena("arena-01")),
        modifiers: NEUTRAL_MODIFIERS,
        selfRamDefence: ramDefenceOf("mirage" as CarId),
      };
      const input = { seq: 0, throttle: 1 as const, steer: 0 as const, fireSlots: 0 };
      let body: SimBody = {
        x: 300, y: 360, angle: 0, vx: 0, vy: 0, angVel: 0,
        maneuver: 0, maneuverTicksLeft: 0, maneuverAngle: 0, maneuverSpeed: 0,
      };
      for (let tick = 0; tick < 400; tick++) {
        const entry = body;
        body = stepSim(body, input, 1 / TICK_RATE_HZ, ctx);
        const touching = obbsInContact(
          carHullOf(body.x, body.y, body.angle),
          carHullOf(parkedX, 360, 0),
          RAM_CONFIG.contactPad,
        );
        if (touching) return { entry, stepped: body };
      }
      throw new Error("never reached contact");
    }

    const asImpact = (b: SimBody, v: SimBody): ImpactPose => ({
      sessionId: "me", team: 0, x: b.x, y: b.y, angle: b.angle,
      vx: v.vx, vy: v.vy, carId: "mirage" as CarId, defenceMult: 1, ramBlocked: false,
    });

    // Sweeps the sub-tick phase, because a single placement measures one arbitrary point on the tick
    // grid — the same rule the playtest probes are built on. `resolveWorld` only zeroes the drive-in
    // on the phases where the hulls actually overlapped, so one offset can pass by luck.
    const phases = Array.from({ length: 40 }, (_, i) => 600 + i * 0.25);

    it("loses most rams when given the rendered, post-collision velocity", () => {
      let sparked = 0;
      for (const parkedX of phases) {
        const { stepped } = driveIntoContact(parkedX);
        const tracker = newImpactTracker();
        const hits = freshImpacts(
          asImpact(stepped, stepped),
          [pose("them", parkedX, 360)],
          tracker,
          "ffa",
        );
        if (hits.length > 0) sparked += 1;
      }
      // Pinned as a RANGE, not as a number: this is the defect being documented, and the exact count
      // is a function of drive tuning nobody should have to re-derive on a balance edit. What must
      // stay true is that it is badly lossy and strictly worse than the case below.
      expect(sparked).toBeGreaterThan(0);
      expect(sparked).toBeLessThan(phases.length / 2);
    });

    it("sparks on every sub-tick phase when given the tick-entry velocity, as `RamCar` requires", () => {
      // `ArenaScene` feeds `predictedPrev` — the body `predict` stepped FROM — for exactly this
      // reason. It is the client's analogue of `serverTick`'s `approachVelocities`.
      for (const parkedX of phases) {
        const { entry, stepped } = driveIntoContact(parkedX);
        const tracker = newImpactTracker();
        const hits = freshImpacts(
          asImpact(stepped, entry),
          [pose("them", parkedX, 360)],
          tracker,
          "ffa",
        );
        expect(hits, `parked at ${parkedX}`).toHaveLength(1);
      }
    });
  });
});
