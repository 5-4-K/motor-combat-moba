import { describe, expect, it } from "vitest";
import { TICK_RATE_HZ } from "../constants.js";
import {
  CAR_TABLE,
  DEFAULT_CAR_ID,
  activeCarIds,
  driveOf,
  engineAccelOf,
  forwardMaxSpeedOf,
  hpOf,
  isActiveCarId,
  isCarId,
  ramAttackOf,
  ramDefenceOf,
  reverseAccelOf,
  turnRateOf,
} from "./car-config.js";
import type { CarId } from "./types.js";
import { COLOR_TABLE } from "./color-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { CAMERA_CONFIG, DRIVE_CONFIG, perTickDecay } from "./drive-config.js";
import { FLOW_CONFIG } from "./flow-config.js";
import { NET_CONFIG } from "./net-config.js";
import { RAM_CONFIG } from "./ram-config.js";
import { damageFor } from "../sim/damage.js";

describe("CAR_TABLE", () => {
  it("has exactly the three shipped chassis plus the six unreleased prototypes", () => {
    expect(Object.keys(CAR_TABLE).sort()).toEqual([
      "anvil",
      "bastion",
      "bullseye",
      "caprico",
      "cleaver",
      "mirage",
      "prowler",
      "skorpios",
      "taurus",
    ]);
  });

  it("matches the locked ratings", () => {
    // 2026-09-02: `speed` and `handling` were rewritten to move together per car (85/85, 65/65,
    // 50/50) instead of trading off — Bastion's `handling` used to be the roster's highest (82)
    // despite its lowest `speed` (30); now it is the roster's lowest on both.
    expect(CAR_TABLE.mirage).toMatchObject({ speed: 85, accel: 85, handling: 85, attack: 63, hp: 70, ramAttack: 55, ramDefence: 50 });
    expect(CAR_TABLE.bullseye).toMatchObject({ speed: 65, accel: 45, handling: 65, attack: 55, hp: 65, ramAttack: 45, ramDefence: 30 });
    expect(CAR_TABLE.bastion).toMatchObject({ speed: 50, accel: 20, handling: 50, attack: 42, hp: 90, ramAttack: 70, ramDefence: 90 });
  });

  it("gives every chassis whole 0-100 ratings on all seven axes", () => {
    // The 150-point budget that used to be asserted here was removed on 2026-08-29 so a free-floating
    // ram rating could exist. Nothing enforces roster fairness now; see CAR_TABLE. `accel` and
    // `handling` joined the sweep once they became real per-chassis ratings rather than global drive
    // constants, and stage 3 of the car-physics rework made the single ram rating two (`ramAttack`
    // and `ramDefence`, replacing `mass`) — seven now, not six. Every one of them feeds a derivation
    // that NaNs on a non-number, which is what this sweep is for.
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const def = CAR_TABLE[id];
      for (const rating of [def.speed, def.accel, def.handling, def.attack, def.hp, def.ramAttack, def.ramDefence]) {
        expect(Number.isInteger(rating)).toBe(true);
        expect(rating).toBeGreaterThanOrEqual(0);
        expect(rating).toBeLessThanOrEqual(100);
      }
    }
  });

  it("derives actual HP via hpPerRating", () => {
    expect(hpOf("mirage")).toBe(700);
    expect(hpOf("bullseye")).toBe(650);
    expect(hpOf("bastion")).toBe(900);
  });

  // The spec's headline TTK number (S7) was pinned to `fireball` as the roster's one anchor weapon
  // that every other row was solved against. The 2026-09-01 overhaul (O17) retired `fireball`
  // outright and with it the idea of a single anchor row — the nine current weapons are each solved
  // on their own terms (see each row's comment in `weapon-config.ts`) rather than against one
  // headline TTK figure. `npm run ttk` is the roster-wide replacement for this kind of check.

  it("pins damagePerAttack through off-baseline chassis", () => {
    // At `attackBaseline` the scale is identically 1, so no baseline assertion can see
    // `damagePerAttack` move. These three cells are all off-baseline in both directions.
    expect(damageFor(63, 50)).toBe(57); // mirage 1.13x
    expect(damageFor(55, 45)).toBe(47); // bullseye 1.05x
    expect(damageFor(42, 60)).toBe(55); // bastion 0.92x
  });

  it("derives forward max speed from the speed rating", () => {
    expect(forwardMaxSpeedOf("mirage")).toBeGreaterThan(forwardMaxSpeedOf("bullseye"));
    expect(forwardMaxSpeedOf("bullseye")).toBeGreaterThan(forwardMaxSpeedOf("bastion"));
  });
});

describe("isCarId", () => {
  it("accepts CAR_TABLE keys and rejects unknown ids", () => {
    expect(isCarId("mirage")).toBe(true);
    expect(isCarId("bullseye")).toBe(true);
    expect(isCarId("bastion")).toBe(true);
    expect(isCarId("triangle")).toBe(false);
    expect(isCarId("")).toBe(false);
    expect(isCarId(1)).toBe(false);
  });

  it("rejects names inherited from Object.prototype", () => {
    // `"constructor" in CAR_TABLE` is true; the own-property check is what keeps it out.
    expect(isCarId("constructor")).toBe(false);
    expect(isCarId("toString")).toBe(false);
    expect(isCarId("hasOwnProperty")).toBe(false);
  });
});

describe("isActive", () => {
  it("publishes the three shipped chassis and none of the prototypes", () => {
    // The list is the publish gate, not a roster census: taurus, anvil, caprico, prowler, cleaver
    // and skorpios sit in `CAR_TABLE` with `isActive: false` and must stay out of every
    // player-facing path until someone flips their flag.
    expect(activeCarIds()).toEqual(["mirage", "bullseye", "bastion"]);
  });
  it("keeps DEFAULT_CAR_ID active, so every fallback path resolves to a selectable car", () => {
    expect(CAR_TABLE[DEFAULT_CAR_ID].isActive).toBe(true);
  });
  it("isActiveCarId refuses unknown ids and inherited names", () => {
    expect(isActiveCarId("mirage")).toBe(true);
    expect(isActiveCarId("toString")).toBe(false);
    expect(isActiveCarId(undefined)).toBe(false);
  });
});

describe("driveOf", () => {
  it("resolves every car's drive numbers from the tables", () => {
    // `reverseMaxSpeed` and `turnRateAtStop` are gone from `ChassisDrive` (Unity drive-model port,
    // car-physics-port stage 1 Task 3): there is no separately-authored reverse top speed any more
    // (reverse is the emergent equilibrium `reverseAccel / dragRate`, same shape as forward's
    // `maxSpeed`) and no separate at-rest turn rate (yaw is speed-independent under this model).
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const d = driveOf(id);
      expect(d.maxSpeed).toBe(forwardMaxSpeedOf(id));
      expect(d.engineAccel).toBeGreaterThan(0);
      expect(d.reverseAccel).toBeGreaterThan(0);
      expect(d.turnRate).toBeGreaterThan(0);
      expect(d.dragRate).toBeGreaterThan(0);
    }
  });

  it("returns the same frozen object every call, so the tick allocates nothing", () => {
    expect(driveOf("mirage")).toBe(driveOf("mirage"));
    expect(Object.isFrozen(driveOf("mirage"))).toBe(true);
  });
});

describe("per-car drive ratings", () => {
  // DELETED: "anchors both scales so rating 50 lands on one global constant apiece" (the `baseAccel`/
  // `accelPerRating` half) and "keeps stopTurnRatio at the value it shipped with, pending its
  // deletion". Both knobs are gone outright as of the Unity drive-model port (drive-model port
  // stage 1 Task 6): `baseAccel`/`accelPerRating` had no successor of their own (the accel rating
  // now scales `dragRateOf`, anchored by `baseDrag`/`dragPerRating` instead — see "anchors the new
  // pairs at rating 50" below) and `stopTurnRatio` had none at all, since yaw is speed-independent
  // under this model and there is no "stopped" rate left to be a fraction of.

  it("drifts rather than cornering on rails: grip is finite against the sharpest turn", () => {
    // Slip angle at full lock is atan(turnRate / lateralGripRate), the same at any speed. A grip rate
    // high enough to drive that to ~0 would be the deleted `steeringGrip: 1` under another name (U3).
    // This can only be asserted once the turn rates above are the ported ones — see Task 1.
    const sharpest = DRIVE_CONFIG.baseTurnRate + 100 * DRIVE_CONFIG.turnRatePerRating;
    const slipDeg = (Math.atan(sharpest / DRIVE_CONFIG.lateralGripRate) * 180) / Math.PI;
    expect(slipDeg).toBeGreaterThan(5);
    expect(slipDeg).toBeLessThan(45);
  });

  it("anchors the new pairs at rating 50", () => {
    expect(DRIVE_CONFIG.baseTurnRate + 50 * DRIVE_CONFIG.turnRatePerRating).toBeCloseTo(1.512, 3);
    expect(DRIVE_CONFIG.baseDrag + 50 * DRIVE_CONFIG.dragPerRating).toBeCloseTo(1.072, 3);
  });

  it("keeps the brake ahead of drag at top speed for every chassis", () => {
    for (const id of activeCarIds()) {
      const d = driveOf(id);
      // Drag's strongest pull, in u/s², is `dragRate * maxSpeed` — at the ceiling.
      expect(d.brakeDecel).toBeGreaterThan(d.dragRate * d.maxSpeed);
    }
  });

  it("derives top speed as the balance point of push and drag", () => {
    for (const id of activeCarIds()) {
      const d = driveOf(id);
      expect(d.engineAccel / d.dragRate).toBeCloseTo(d.maxSpeed, 9);
    }
  });

  it("feeds the derived rates into every chassis's ChassisDrive", () => {
    // `turnRateAtStop` dropped from the assertion for the same reason it dropped from the test
    // above; `accel` -> a drag rate (`dragRateOf`) -> a derived push (`engineAccelOf`), since
    // `stepDrive` reads the engine's push under that name now, not a per-rating acceleration.
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      const d = driveOf(id);
      expect(d.turnRate).toBeCloseTo(turnRateOf(id), 9);
      expect(d.engineAccel).toBeCloseTo(engineAccelOf(id), 9);
      expect(d.reverseAccel).toBeCloseTo(reverseAccelOf(id), 9);
    }
  });

  // DELETED: "scales every car's reverse speed from its own forward speed by reverseSpeedRatio".
  // Its premise — a reverse top speed authored as a fixed ratio of the forward one, read through
  // `reverseMaxSpeedOf` — is gone: reverse top speed is now the emergent equilibrium
  // `reverseAccel / dragRate`. `DRIVE_CONFIG.reverseSpeedRatio` itself is gone too, deleted by
  // Task 6 alongside the other superseded knobs.
});

describe("COLOR_TABLE", () => {
  it("has 6 unique hex colors", () => {
    expect(COLOR_TABLE).toHaveLength(6);
    const hex = COLOR_TABLE.map((c) => c.hex);
    expect(new Set(hex).size).toBe(6);
    for (const h of hex) expect(h).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("weapon / combat / drive / flow knobs exist", () => {
  it("combat defaults", () => {
    expect(COMBAT_CONFIG.hpPerRating).toBe(10);
    expect(COMBAT_CONFIG.attackBaseline).toBe(50);
    expect(COMBAT_CONFIG.damagePerAttack).toBe(0.01);
  });
  // DELETED: "reverse is slower than forward, but not a crawl" — `DRIVE_CONFIG.reverseSpeedRatio`
  // is gone, deleted by Task 6 alongside the other superseded knobs. Reverse top speed is now the
  // emergent equilibrium `reverseAccel / dragRate`, and `reverseAccelFactor` below is what keeps it
  // the weaker gear.

  it("gives reverse its own acceleration rate, weaker than forward pickup", () => {
    // Ranged, not pinned: reverseAccel exists to be tuned by feel, so an exact value here would go
    // red on every good change as readily as a bad one. What must hold is that it is a real rate and
    // that reverse is the WEAKER gear.
    //
    // THIS ASSERTION USED TO RUN THE OTHER WAY (`>= 1`, 2026-09-07), on the rationale that splitting
    // reverseAccel from `accel` had to buy something and a lower rate would make backing out slower
    // than the forward curve it was separated from. That argument was written when the old global
    // accel pivot (`baseAccel`/`accelPerRating`, since deleted) was 780 and every car reached BOTH
    // caps in about half a second, so the factor never governed anything a driver or a planner could
    // observe — the old `reverseSpeedRatio` (also since deleted) did. The 2026-09-06 heavy-car pass
    // cut that accel pair 420/7.2 -> 60/1.4 and stretched time-to-cap to 1.49-2.16 s, which is longer
    // than most things that sample the drive model look ahead. Cars now spend the observed part of a
    // manoeuvre acceleration-limited, this factor governs there, and at the old ratio (1.41) every
    // chassis covered 1.29x more ground REVERSING than driving forward over a 22-tick rollout. That
    // is backwards as a statement about a car, and it steered the bot: `bot/brain/planner.ts` scores
    // candidates on where they end up, so `throttle: -1` beat `throttle: 1` unconditionally.
    //
    // A car may still be tuned to back out briskly — that is `reverseAccelFactor` near 1, not above
    // it. The ordering is what this pins. Retuned to the Unity original (0.4) by Task 6 — see
    // `DRIVE_CONFIG.reverseAccelFactor`'s own comment for why 0.6 was never more than a value chosen
    // against a since-deleted knob.
    expect(DRIVE_CONFIG.reverseAccelFactor).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.reverseAccelFactor).toBeLessThan(1);
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      expect(reverseAccelOf(id)).toBeLessThan(engineAccelOf(id));
    }
  });

  it("keeps stopEpsilon a small positive rest band", () => {
    // Zero would leave a car creeping forever instead of settling, and a band wide enough to reach
    // real driving speeds would freeze the car mid-roll well before it actually stopped.
    expect(DRIVE_CONFIG.stopEpsilon).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.stopEpsilon).toBeLessThan(1);
  });

  it("never lets a dash translate past the resolver's correct band", () => {
    // The MTV resolver returns the SHORTEST way out of an overlap, which is only the way the car
    // came in while the overlap is shallow. Bounding a dash's per-check travel at half the hull's
    // SHORTEST axis is what keeps every sample inside that band: a car may be at any angle, so the
    // 40-unit face can always be the competing escape axis, and sizing against the 60-unit face
    // would leave rotated approaches unprotected. Shrinking a car without revisiting this bound
    // reopens the tunnelling bug silently, so the hull is what this is pinned to — not the number.
    expect(DRIVE_CONFIG.dashSubstepMaxUnits).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.dashSubstepMaxUnits).toBeLessThanOrEqual(
      Math.min(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2,
    );
  });
  it("flow timers", () => {
    expect(FLOW_CONFIG.carSelectSeconds).toBe(60);
    expect(FLOW_CONFIG.countdownSeconds).toBe(3);
  });
  it("camera follows softly and pushes the view in", () => {
    // Pinned, not ranged: these are the tuned values, and a camLerp outside (0, 1] either never
    // reaches the car or overshoots it every frame. Zoom 2 would draw the 2x car textures at 1:1;
    // 1 trades sprite sharpness for the widest field of view the range allows. Below 1 the
    // textures shimmer, so a change here is also a change to how sharp every car sprite is.
    expect(CAMERA_CONFIG.camLerp).toBe(0.18);
    expect(CAMERA_CONFIG.zoom).toBe(1);
  });
  it("lets a spectator's free-look camera outrun the fastest car", () => {
    // Ranged, not pinned: what matters is that free roam can get ahead of the action rather than
    // trailing behind whichever car happens to be quickest.
    const fastest = Math.max(
      ...(Object.keys(CAR_TABLE) as CarId[]).map((id) => forwardMaxSpeedOf(id)),
    );
    expect(CAMERA_CONFIG.freeRoamSpeed).toBeGreaterThan(fastest);
  });
  it("names a default chassis that is a real car id", () => {
    expect(isCarId(DEFAULT_CAR_ID)).toBe(true);
  });
  it("keeps reconcileEaseRate inside (0, 1] so corrections converge", () => {
    // The same property CAMERA_CONFIG.camLerp is pinned for, but governing the *car*: at 0 the
    // predicted pose never closes on the authoritative one, and above 1 every correction overshoots
    // and oscillates — at >= 2 it diverges outright. The prediction tests all read this constant
    // back out of NET_CONFIG, so they are structurally incapable of catching a bad value here.
    expect(NET_CONFIG.reconcileEaseRate).toBeGreaterThan(0);
    expect(NET_CONFIG.reconcileEaseRate).toBeLessThanOrEqual(1);
  });
  it("caps how many inputs one player can have applied per tick", () => {
    expect(NET_CONFIG.maxInputsPerTick).toBeTypeOf("number");
    expect(Number.isInteger(NET_CONFIG.maxInputsPerTick)).toBe(true);
    // Below 1 the server would drop every input and no one could move.
    expect(NET_CONFIG.maxInputsPerTick).toBeGreaterThanOrEqual(1);
  });
});

describe("the three types (T5/T6)", () => {
  it("derives the roster's drive profile from its ratings", () => {
    // The 2026-09-06 vector-drive rework's heavy-car pass cut `baseMaxSpeed`/`speedPerRating`
    // (135/3.7 -> 80/2.2) for a roughly 40% roster-wide top-speed cut, and the old global accel pair
    // (420/7.2 -> 60/1.4, since deleted) alongside it, roughly tripling time-to-top-speed. See
    // `DRIVE_CONFIG.speedPerRating`.
    //
    // 2026-09-16 cut the speed pair again, 80/2.2 -> 60/1.518, for a further ~29% off every top
    // speed. `toBeCloseTo` rather than `toBe` because 1.518 is not representable in binary: the
    // products land a few ULPs off the decimal (158.67000000000002, not 158.67). Accel was left
    // alone, so time-to-top-speed FELL with the ceiling — 1.81 -> 1.29 s on Bullseye.
    expect(forwardMaxSpeedOf("bullseye")).toBeCloseTo(158.67, 9);
    expect(forwardMaxSpeedOf("mirage")).toBeCloseTo(189.03, 9);
    expect(forwardMaxSpeedOf("bastion")).toBeCloseTo(135.9, 9);

    // RE-PINNED for the Unity drive-model port (car-physics-port stage 1 Task 3): `accelOf` (the
    // old `baseAccel + accel*accelPerRating`, pivoted at 130) is gone, replaced by `engineAccelOf`
    // — DERIVED as `forwardMaxSpeedOf(id) * dragRateOf(id)` rather than authored independently, so
    // these three numbers are not a retune, they are the same ratings read through the new formula.
    // (123/179/88 were the old `accelOf` figures; not comparable to the numbers below.)
    expect(engineAccelOf("bullseye")).toBeCloseTo(165.27067200000002, 6);
    expect(engineAccelOf("mirage")).toBeCloseTo(242.86574400000003, 6);
    expect(engineAccelOf("bastion")).toBeCloseTo(120.89664000000002, 6);

    // The 2026-09-02 rewrite set `speed` and `handling` to the same rating per car (65/65, 85/85,
    // 50/50), so turn rate now orders the roster the same way top speed does — Mirage highest,
    // Bastion lowest — rather than the inverse spread the roster shipped with.
    //
    // RE-PINNED for the Unity drive-model port (drive-model port stage 1 Task 6, spec §9.2):
    // `baseTurnRate`/`turnRatePerRating` 3.6/0.054 -> 0.667/0.0169. The ORDERING is unchanged
    // (Mirage > Bullseye > Bastion), only the magnitudes — every chassis turns roughly a fifth as
    // fast as it did (7.11/8.19/6.3 were the old figures; not comparable to the numbers below).
    expect(turnRateOf("bullseye")).toBeCloseTo(1.7655, 9);
    expect(turnRateOf("mirage")).toBeCloseTo(2.1035, 9);
    expect(turnRateOf("bastion")).toBeCloseTo(1.512, 9);

    expect(hpOf("bullseye")).toBe(650);
    expect(hpOf("mirage")).toBe(700);
    expect(hpOf("bastion")).toBe(900);
  });

  // CONTRADICTION, reported per the Task 6 brief rather than fixed by re-tuning the ported
  // constants: this test used to be "gives Bastion the tightest turn radius despite being the
  // slowest" (T6). Every pre-port pass (through 2026-09-16) kept that true while shrinking the
  // margin toward nothing — see the superseded comment this replaces, still visible in history.
  // The Unity turn-rate anchors (`baseTurnRate` 0.667, `turnRatePerRating` 0.0169, spec §9.2) do
  // not merely shrink the margin further: they INVERT it. Bastion now has the WIDEST radius of the
  // three, not the tightest, because the anchor term (`baseTurnRate`) is now large relative to the
  // per-rating spread, so a car's turn rate depends much more on the flat pivot than on its own
  // `handling` — which compresses the turn-rate spread far more than the speed spread, and it is the
  // RATIO of the two that decides radius order. Measured: mirage 89.8645 u, bullseye 89.8726 u,
  // bastion 89.8810 u — a ~0.016 u spread out of ~89.9, effectively degenerate. This is a design
  // question for the project owner / stage 5's tuning pass, not something Task 6 may fix by
  // adjusting `baseTurnRate`/`turnRatePerRating` back toward the old values (the brief is explicit:
  // those three numbers are the project owner's decision, use them exactly).
  it("radius is now a dead axis under the ported turn-rate anchors — Bastion no longer tightest", () => {
    const radius = (id: CarId) => forwardMaxSpeedOf(id) / turnRateOf(id);
    expect(radius("mirage")).toBeLessThan(radius("bullseye"));
    expect(radius("bullseye")).toBeLessThan(radius("bastion"));
    expect(radius("bastion")).toBeCloseTo(89.881, 2);
  });

  it("orders the three types on every axis the design names", () => {
    expect(forwardMaxSpeedOf("mirage")).toBeGreaterThan(forwardMaxSpeedOf("bullseye"));
    expect(forwardMaxSpeedOf("bullseye")).toBeGreaterThan(forwardMaxSpeedOf("bastion"));
    expect(engineAccelOf("mirage")).toBeGreaterThan(engineAccelOf("bullseye"));
    expect(engineAccelOf("bullseye")).toBeGreaterThan(engineAccelOf("bastion"));
    // Turn rate now orders with speed rather than against it — see the note above.
    expect(turnRateOf("mirage")).toBeGreaterThan(turnRateOf("bullseye"));
    expect(turnRateOf("bullseye")).toBeGreaterThan(turnRateOf("bastion"));
    expect(hpOf("bastion")).toBeGreaterThan(hpOf("mirage"));
    expect(hpOf("mirage")).toBeGreaterThan(hpOf("bullseye"));
    // The ram axis, which `mass` used to carry alone. Both halves order the same way here — see the
    // dedicated `ramAttack`/`ramDefence` block below for what the split actually buys.
    expect(ramDefenceOf("bastion")).toBeGreaterThan(ramDefenceOf("mirage"));
    expect(ramDefenceOf("mirage")).toBeGreaterThan(ramDefenceOf("bullseye"));
  });
});

describe("per-car coast and brake", () => {
  // DELETED: "resolves a coast multiplier for every active chassis". `coastPerTick` is gone —
  // there is no coast-specific field any more, only `dragPerTick`, the same rate that also sets
  // top speed and wind-up (U4). `dragPerTick` is exercised directly below.
  it("resolves a drag multiplier for every active chassis", () => {
    for (const id of activeCarIds()) {
      const drag = driveOf(id).dragPerTick;
      expect(drag).toBeGreaterThan(0);
      expect(drag).toBeLessThan(1);
    }
  });

  it("keeps the brake ahead of coasting on every chassis, measured where drag is strongest", () => {
    // RE-PINNED for the Unity drive-model port: `coastPerTick` -> `dragPerTick`. The invariant is
    // unchanged — proportional drag is fiercest at top speed, and the instantaneous decel there is
    // (1 - dragPerTick) * maxSpeed * TICK_RATE_HZ — only the field name and the mechanism behind it
    // moved (coasting was a dedicated decay knob; now it's the same drag rate that also sets top
    // speed). The brake pedal must still beat lifting off, or the control reads as broken.
    for (const id of activeCarIds()) {
      const drive = driveOf(id);
      const coastDecelAtTop = (1 - drive.dragPerTick) * forwardMaxSpeedOf(id) * TICK_RATE_HZ;
      expect(drive.brakeDecel).toBeGreaterThan(coastDecelAtTop);
    }
  });

  // DELETED: "defaults steering grip to fully on rails", "bounds steering grip to 0..1" and "has a
  // positive impact grip deceleration". `steeringGrip` and `impactGripDecel` are both gone, deleted
  // by Task 6 alongside the other superseded knobs — steering under the Unity model is not a grip
  // fraction at all (yaw sets the rate directly, U16) and ram control-loss is the `reeling` status
  // rather than a bespoke bleed-off rate. `lateralGripRate` is the model's own drift knob now — see
  // "drifts rather than cornering on rails" above.
});

describe("ram ratings", () => {
  it("gives every active chassis a positive ramAttack and ramDefence", () => {
    for (const id of activeCarIds()) {
      expect(ramAttackOf(id)).toBeGreaterThan(0);
      expect(ramDefenceOf(id)).toBeGreaterThan(0);
    }
  });

  it("keeps them as 0-100 ratings, not direct values", () => {
    for (const id of activeCarIds()) {
      expect(ramAttackOf(id)).toBeLessThanOrEqual(100);
      expect(ramDefenceOf(id)).toBeLessThanOrEqual(100);
    }
  });

  it("orders ramDefence tank-first, preserving the old mass ordering", () => {
    expect(ramDefenceOf("bastion")).toBeGreaterThan(ramDefenceOf("mirage"));
    expect(ramDefenceOf("mirage")).toBeGreaterThan(ramDefenceOf("bullseye"));
  });

  it("spreads ramAttack more narrowly than ramDefence, so offence and defence are not the same axis", () => {
    const atk = activeCarIds().map(ramAttackOf);
    const def = activeCarIds().map(ramDefenceOf);
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(atk)).toBeLessThan(spread(def));
  });

  it("has a positive defence push scale and global scale", () => {
    expect(RAM_CONFIG.defencePushScale).toBeGreaterThan(0);
    expect(RAM_CONFIG.globalScale).toBeGreaterThan(0);
  });
});

describe("the Unity drive knobs", () => {
  it("turns a per-second rate into a per-tick factor", () => {
    expect(perTickDecay(0)).toBe(1);
    // A rate of ln(2) per second halves in exactly one second, whatever the tick rate is.
    const oneSecond = perTickDecay(Math.LN2) ** TICK_RATE_HZ;
    expect(oneSecond).toBeCloseTo(0.5, 12);
  });

  it("authors drag, grip and the reverse threshold as per-second rates", () => {
    expect(DRIVE_CONFIG.baseDrag).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.dragPerRating).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.lateralGripRate).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.reverseEpsilon).toBeGreaterThan(DRIVE_CONFIG.stopEpsilon);
    expect(DRIVE_CONFIG.flipSteeringInReverse).toBe(true);
  });

});
