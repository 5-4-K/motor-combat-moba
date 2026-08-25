import { describe, expect, it } from "vitest";
import { CAR_TABLE, DEFAULT_CAR_ID, hpOf, forwardMaxSpeedOf, isCarId } from "./car-config.js";
import type { CarId } from "./types.js";
import { COLOR_TABLE } from "./color-config.js";
import { WEAPON_CONFIG } from "./weapon-config.js";
import { COMBAT_CONFIG } from "./combat-config.js";
import { CAMERA_CONFIG, DRIVE_CONFIG } from "./drive-config.js";
import { FLOW_CONFIG } from "./flow-config.js";
import { NET_CONFIG } from "./net-config.js";

describe("CAR_TABLE", () => {
  it("has exactly rectangle, oval, hexagon", () => {
    expect(Object.keys(CAR_TABLE).sort()).toEqual(["hexagon", "oval", "rectangle"]);
  });

  it("matches the locked ratings", () => {
    expect(CAR_TABLE.rectangle).toMatchObject({ speed: 8, strength: 3, hp: 5 });
    expect(CAR_TABLE.oval).toMatchObject({ speed: 5, strength: 8, hp: 3 });
    expect(CAR_TABLE.hexagon).toMatchObject({ speed: 3, strength: 5, hp: 8 });
  });

  it("derives actual HP via hpPerRating", () => {
    expect(hpOf("rectangle")).toBe(50);
    expect(hpOf("oval")).toBe(30);
    expect(hpOf("hexagon")).toBe(80);
  });

  it("derives forward max speed from the speed rating", () => {
    expect(forwardMaxSpeedOf("rectangle")).toBeGreaterThan(forwardMaxSpeedOf("oval"));
    expect(forwardMaxSpeedOf("oval")).toBeGreaterThan(forwardMaxSpeedOf("hexagon"));
  });
});

describe("isCarId", () => {
  it("accepts CAR_TABLE keys and rejects unknown ids", () => {
    expect(isCarId("rectangle")).toBe(true);
    expect(isCarId("oval")).toBe(true);
    expect(isCarId("hexagon")).toBe(true);
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

describe("COLOR_TABLE", () => {
  it("has 6 unique hex colors", () => {
    expect(COLOR_TABLE).toHaveLength(6);
    const hex = COLOR_TABLE.map((c) => c.hex);
    expect(new Set(hex).size).toBe(6);
    for (const h of hex) expect(h).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("weapon / combat / drive / flow knobs exist", () => {
  it("weapon defaults", () => {
    expect(WEAPON_CONFIG.damage).toBe(8);
    expect(WEAPON_CONFIG.fireRateHz).toBe(2);
    expect(WEAPON_CONFIG.projectileSpeed).toBe(900);
    expect(WEAPON_CONFIG.lifetimeTicks).toBe(30);
  });
  it("combat defaults", () => {
    expect(COMBAT_CONFIG.collisionDamagePerStrength).toBe(1);
    expect(COMBAT_CONFIG.ramDotThreshold).toBe(0.5);
    expect(COMBAT_CONFIG.collisionDamageCooldownTicks).toBe(15);
    expect(COMBAT_CONFIG.hpPerRating).toBe(10);
  });
  it("reverse is slower than forward, but not a crawl", () => {
    expect(DRIVE_CONFIG.reverseSpeedRatio).toBe(0.65);
    expect(DRIVE_CONFIG.reverseSpeedRatio).toBeLessThan(1);
  });

  it("brakes harder than it coasts, or the brake button would mean nothing", () => {
    // Ranged, not pinned: the ordering is what matters. A drag above brakeDecel would make holding
    // Down *slower* to stop than releasing the throttle entirely.
    expect(DRIVE_CONFIG.brakeDecel).toBeGreaterThan(DRIVE_CONFIG.drag);
  });

  it("gives reverse its own acceleration rate, at least as quick as forward pickup", () => {
    // Ranged, not pinned: reverseAccel exists to be tuned by feel, so an exact value here would go
    // red on every good change as readily as a bad one. What must hold is that it is a real rate
    // and that splitting it from `accel` bought something — a reverseAccel below `accel` would make
    // backing out slower than the forward curve it was separated from.
    expect(DRIVE_CONFIG.reverseAccel).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.reverseAccel).toBeGreaterThanOrEqual(DRIVE_CONFIG.accel);
  });

  it("keeps stopEpsilon a small positive rest band", () => {
    // Zero would leave a car creeping forever instead of settling, and a band wide enough to reach
    // real driving speeds would freeze the car mid-roll and steer it at turnRateAtStop.
    expect(DRIVE_CONFIG.stopEpsilon).toBeGreaterThan(0);
    expect(DRIVE_CONFIG.stopEpsilon).toBeLessThan(1);
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
