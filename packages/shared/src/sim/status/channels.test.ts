import { describe, expect, it } from "vitest";
import type { ChassisDrive } from "../../config/car-config.js";
import { STATUS_LIMITS, STATUS_TABLE } from "../../config/status-config.js";
import type { CarId } from "../../config/types.js";
import { scaleTicks, weaponTicksOf } from "../../config/weapon-ticks.js";
import { MS_PER_TICK } from "../../constants.js";
import type { InputMessage } from "../../net/input.js";
import { applyHeal, scaleDamage } from "../damage.js";
import { stepDrive } from "../drive.js";
import { resolveRam, type RamCar } from "../ram.js";
import type { SimBody } from "../step.js";
import { newFireState, releaseShots, tickRecharge } from "../weapons/fire.js";
import { spawnInstances } from "../weapons/instances.js";
import { forwardOf, lateralOf } from "../velocity.js";
import { modifiersOf, NEUTRAL_MODIFIERS, type Modifiers } from "./modifiers.js";

/**
 * Every channel and flag, proved to reach the sim call site it names.
 *
 * `modifiers.test.ts` pins how a status list becomes a set of multipliers; this file pins that each
 * of those multipliers is actually read by the thing it is supposed to scale. Between them, "does
 * this channel do anything" is answerable without running the game.
 *
 * **Two of the members the Unity drive-model port added are DECLARED AHEAD OF USE, and this file
 * says which.** That contract above is about reaching a call site, so a member whose call site is
 * not wired yet cannot satisfy it and must not be allowed to look as if it does:
 *
 * - **`grip`** is fully wired: it reaches `gripFactorOf` in `stepDrive` and is proved below the same
 *   way every other channel here is, against `drive-vector.test.ts`'s expression for the lateral
 *   bleed. It is not an exception.
 * - **`spinFree`** reaches `nextSpinOf`, but `chassis.spinPerTick` is the placeholder 1 until
 *   **stage 3** of the port sets `RAM_CONFIG.reelingSpinDecayRate`, so that branch is the identity
 *   today: the flag genuinely gates something, and what it gates does not yet decay. Proved here as
 *   neutrality and clamping only; `drive-vector.test.ts`'s "keeps its spin while spinFree" covers
 *   the branch against a hand-set `spinPerTick`.
 * - **`ramBlocked`** reaches `participantOf`'s `qualifies` check in `ram.ts` — wired by stage 3
 *   Tasks 2-3's Unity ram rewrite, which also deleted the two-sided contest that comment used to
 *   name. Proved there, in `ram.test.ts`'s own suite ("will not let a reeling or locked car
 *   attack"), not here: this file only carries its neutrality and clamping, the same standard as
 *   `spinFree` above.
 */

const DT = MS_PER_TICK / 1000;
const CAR: CarId = "mirage";

/**
 * The drive numbers this suite was recorded against.
 *
 * Frozen here rather than read from `CAR_TABLE` deliberately: these expectations pin the SHAPE of
 * the integration, not the roster's balance. A car's ratings must be free to move without any
 * number below moving with them.
 *
 * RE-PINNED for the Unity drive-model port (car-physics-port stage 1 Task 3): the old 8-field
 * `ChassisDrive` (`maxSpeed`/`reverseMaxSpeed`/`accel`/`reverseAccel`/`turnRate`/`turnRateAtStop`/
 * `coastPerTick`/`brakeDecel`) is gone. `engineAccel` is chosen as `maxSpeed * dragRate` so the
 * equilibrium this fixture settles at is exactly `maxSpeed` (matching the old field's name-implied
 * meaning as closely as the new model allows); `reverseAccel` is chosen the same way against a
 * smaller nominal reverse top speed.
 */
const DRAG_RATE = 1;
const GOLDEN_CHASSIS: ChassisDrive = Object.freeze({
  maxSpeed: 540,
  engineAccel: 540 * DRAG_RATE,
  reverseAccel: 351 * DRAG_RATE,
  brakeDecel: 1600,
  turnRate: 4.2,
  dragRate: DRAG_RATE,
  dragPerTick: Math.exp(-DRAG_RATE / 30),
  gripPerTick: Math.exp(-3 / 30),
  spinPerTick: 1,
});

function body(over: Partial<SimBody> = {}): SimBody {
  return {
    x: 0,
    y: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    angVel: 0,
    ...over,
  };
}

/** Forward speed along the car's own nose — the vector-model successor to the old scalar `speed`. */
function fwd(b: SimBody): number {
  return forwardOf(b.vx, b.vy, b.angle);
}

function input(steer: -1 | 0 | 1, throttle: -1 | 0 | 1): InputMessage {
  return { seq: 0, steer, throttle, fireSlots: 0 };
}

function mods(over: Partial<Modifiers>): Modifiers {
  return { ...NEUTRAL_MODIFIERS, ...over };
}

/**
 * `commandFactorOf`'s own formula (drive.ts, drive.ts-private), duplicated so these tests can
 * predict a command term's exact contribution instead of `* DT`: drag and the command are solved
 * TOGETHER over one tick (`dv/dt = a - k*v`), and `k` is the EFFECTIVE rate `dragRate * accelMod`.
 */
function commandFactorAt(accelMod: number): number {
  const rate = GOLDEN_CHASSIS.dragRate * accelMod;
  const drag = Math.pow(GOLDEN_CHASSIS.dragPerTick, accelMod);
  return rate > 0 ? (1 - drag) / rate : DT;
}

describe("topSpeed reaches the drive cap", () => {
  it("caps forward speed at the scaled maximum", () => {
    let out = body();
    for (let i = 0; i < 1000; i++) out = stepDrive(out, input(0, 1), DT, GOLDEN_CHASSIS, mods({ topSpeed: 0.5 }));
    expect(fwd(out)).toBeCloseTo(GOLDEN_CHASSIS.maxSpeed * 0.5, 6);
  });

  it("caps reverse too, so backing away is not the way out of a slow", () => {
    // RE-PINNED for the Unity drive-model port: `reverseMaxSpeed` is gone from `ChassisDrive` —
    // reverse top speed is the emergent equilibrium `reverseAccel / dragRate` now, same shape as
    // forward's `maxSpeed`. The reverse-hold ceremony is gone from `stepDrive`, and `reverseHold`
    // itself is gone from `SimBody` — there is no field left for the initial body to carry.
    let out = body({ vx: -10 });
    for (let i = 0; i < 1000; i++) out = stepDrive(out, input(0, -1), DT, GOLDEN_CHASSIS, mods({ topSpeed: 0.5 }));
    expect(fwd(out)).toBeCloseTo(-(GOLDEN_CHASSIS.reverseAccel / GOLDEN_CHASSIS.dragRate) * 0.5, 6);
  });

  // DELETED: "clamps a car already above the new cap the moment it asks for throttle". Its
  // premise — that a car above the (scaled) cap snaps DOWN to it the instant throttle is pressed —
  // is gone: there is no clamp any more, only an asymptote approached at the drag rate like any
  // other speed change. A car at 540 asking for a 270 equilibrium decays toward it gradually
  // (measured: 531 after one tick, not 270), the same shape "caps forward speed" above already
  // covers over many ticks.

  it("lets a car above the cap coast down proportionally rather than snapping", () => {
    // Coasting no longer reads `mods.topSpeed` at all — the cap clamp only fires on active
    // throttle — so a car above the new cap decays by the chassis's own proportional DRAG
    // (`coastPerTick` is gone; `dragPerTick` is the same always-on rate that also sets top speed).
    const fast = body({ vx: GOLDEN_CHASSIS.maxSpeed });
    expect(fwd(stepDrive(fast, input(0, 0), DT, GOLDEN_CHASSIS, mods({ topSpeed: 0.5 })))).toBeCloseTo(
      GOLDEN_CHASSIS.maxSpeed * GOLDEN_CHASSIS.dragPerTick,
      6,
    );
  });
});

describe("accel reaches the engine", () => {
  // RENAMED from "...and never the brakes or coast": that second half of the old title is now
  // false. `accel` scales the drag exponent itself (U36: `accel: 0` holds a speed instead of
  // stopping the car, `drive-vector.test.ts`), which is a deliberate design change from the
  // pre-port model where `accel` touched only the throttle push.
  it("scales one tick of forward acceleration", () => {
    // RE-PINNED: `GOLDEN_CHASSIS.accel` (deleted) -> `engineAccel`, and the command's contribution
    // is `command * commandFactorAt(accel)`, not `command * DT` — see `commandFactorAt`'s comment.
    const command = GOLDEN_CHASSIS.engineAccel * 0.5;
    expect(fwd(stepDrive(body(), input(0, 1), DT, GOLDEN_CHASSIS, mods({ accel: 0.5 })))).toBeCloseTo(
      command * commandFactorAt(0.5),
      9,
    );
  });

  // DELETED: "leaves coasting alone — a car with no input must always slow down". Its premise is
  // now false ON PURPOSE (see the describe block's rename above): `accel` debuffing a car to 0.4
  // measurably changes how fast it coasts, because `dragFactorOf` raises `dragPerTick` to the
  // `accel` power. The two `stepDrive` calls this case compared no longer land on the same speed.
});

describe("brakeDecel reaches the brake", () => {
  it("fades braking while rolling forward", () => {
    // RE-PINNED: the brake's contribution is `command * commandFactorAt(1)` (`mods.accel` is
    // neutral here), not `command * DT`.
    const rolling = body({ vx: 300 });
    const faded = stepDrive(rolling, input(0, -1), DT, GOLDEN_CHASSIS, mods({ brakeDecel: 0.6 }));
    const plain = stepDrive(rolling, input(0, -1), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(faded)).toBeGreaterThan(fwd(plain));
    const command = -GOLDEN_CHASSIS.brakeDecel * 0.6;
    expect(fwd(faded)).toBeCloseTo(300 * GOLDEN_CHASSIS.dragPerTick + command * commandFactorAt(1), 9);
  });

  // DELETED: "fades the brake that arrests a reversing car too". Its premise — that holding Up
  // while reversing reads `mods.brakeDecel` — is gone: `engineCommandOf`'s `throttle === 1` branch
  // (drive.ts) ALWAYS returns the plain engine push `engineAccel * mods.topSpeed * mods.accel`,
  // unconditionally, never the brake, regardless of which way the car is currently moving. Before
  // this port, `accelerateForward` braked toward 0 first when reversing and only then accelerated;
  // that branch is gone, and Up now just adds a big forward push that happens to overpower a
  // reverse speed quickly — arresting it by ENGINE force, not brake force, so `mods.brakeDecel` has
  // no effect on this scenario at all any more. `drive.test.ts`'s "holding Up from reverse..." case
  // covers the surviving shape of this (reverse to zero to forward) without asserting which channel
  // does it.

  it("still beats coasting at the worst fade the limits allow", () => {
    const rolling = body({ vx: 300 });
    const braked = stepDrive(rolling, input(0, -1), DT, GOLDEN_CHASSIS, mods({ brakeDecel: 0.6 }));
    const coasting = stepDrive(rolling, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(fwd(braked)).toBeLessThan(fwd(coasting));
  });
});

describe("turnRate reaches steering, in both directions", () => {
  it("scales the steering term down", () => {
    const rolling = body({ vx: 200 });
    const half = stepDrive(rolling, input(1, 0), DT, GOLDEN_CHASSIS, mods({ turnRate: 0.5 }));
    const full = stepDrive(rolling, input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(half.angle).toBeCloseTo(full.angle * 0.5, 9);
  });

  it("scales the steering term up too — the channel is bidirectional", () => {
    const rolling = body({ vx: 200 });
    const sharper = stepDrive(rolling, input(1, 0), DT, GOLDEN_CHASSIS, mods({ turnRate: 1.55 }));
    const plain = stepDrive(rolling, input(1, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(sharper.angle).toBeCloseTo(plain.angle * 1.55, 9);
  });

  // DELETED: "does not touch injected spin — that is the ram's term, not the driver's". Its
  // premise — that an injected `angVel` adds to the steering term regardless of `mods` — is gone:
  // outside `mods.spinFree`, steering SETS the yaw rate (U16, drive.ts's `stepDrive` step 4) rather
  // than adding to a separately-decaying spin, so a previous `angVel` is overwritten to 0 here
  // (steer: 0, not spinFree) on this very tick, not left untouched. `drive-vector.test.ts`'s "keeps
  // its spin while spinFree and erases it the moment control returns" covers the surviving shape.
});

describe("the three flags", () => {
  it("`immobilised` refuses throttle but leaves the car coasting, steering and braking", () => {
    expect(fwd(stepDrive(body(), input(0, 1), DT, GOLDEN_CHASSIS, mods({ immobilised: true })))).toBe(0);

    const rolling = body({ vx: 200 });
    const out = stepDrive(rolling, input(1, 1), DT, GOLDEN_CHASSIS, mods({ immobilised: true }));
    // Still steering, and slowing through coasting rather than snapping to rest.
    expect(out.angle).not.toBe(rolling.angle);
    expect(fwd(out)).toBeLessThan(200);
    expect(fwd(out)).toBeGreaterThan(0);
  });

  // DELETED: "`steeringLocked` kills the driver's steering but never the injected spin". Same root
  // cause as the deletion above: `steeringLocked` forces `steer` to 0, and outside `spinFree` that
  // 0 SETS the yaw rate — it does not add to whatever `angVel` the car came in with. A previous ram
  // spin is erased the moment `steeringLocked` (or any non-`spinFree` tick) runs, not preserved.

  it("`steeringLocked` forces the yaw rate to zero regardless of held steer", () => {
    // REWRITTEN: this used to claim "stops a driver COUNTERSTEERING out of a spin" — a
    // differential decay rate (steering against a spin decays it faster than steering with it)
    // that no longer exists (`nextSpinOf`'s only decay knob is `chassis.spinPerTick`, and it never
    // reads `steer`). The old assertion (`locked.angVel > free.angVel`) still happened to hold
    // numerically, but for an unrelated reason: outside `mods.spinFree`, steering SETS the yaw
    // rate (U16) rather than adding to it, so `free.angVel` here was never a "decayed spin" at
    // all — it was the raw steering rate (`-1 * turnRate`, a large negative number), and `locked`
    // (steer forced to 0) landed at exactly 0, which is bigger than a large negative number by
    // coincidence. What the channel actually guarantees is narrower and still real: held steer
    // contributes nothing to `angVel` while locked, full stop.
    const spinning = body({ vx: 200, angVel: 2 });
    const locked = stepDrive(spinning, input(-1, 0), DT, GOLDEN_CHASSIS, mods({ steeringLocked: true }));
    expect(locked.angVel).toBe(0);
    expect(locked.angle).toBe(spinning.angle);
  });

  it("a stunned car keeps its ram knock resolving", () => {
    const stunned = mods({ immobilised: true, steeringLocked: true, disarmed: true });
    // The imposed motion is the LATERAL component now (see `sim/velocity.ts`): angle 0, so `vy` is
    // what used to be `shoveY` in the pre-vector model. `vx` here is the ordinary driven component.
    const knocked = body({ vx: 200, vy: 120, angVel: 2 });
    const out = stepDrive(knocked, input(0, 1), DT, GOLDEN_CHASSIS, stunned);
    expect(Math.abs(out.angVel)).toBeLessThan(2);
    // Read in the car's own frame, not raw `vy`: injected spin rotates the heading this same tick,
    // so the world-frame axes are no longer the ones the imposed motion was measured against.
    expect(Math.abs(lateralOf(out.vx, out.vy, out.angle))).toBeLessThan(120);
    expect(out.x).not.toBe(knocked.x);
  });
});

describe("damageDealt reaches the shot, frozen at spawn", () => {
  const owner = { sessionId: "a", team: 0 as const, carId: CAR, x: 0, y: 0, angle: 0 };

  it("scales the instance's damage", () => {
    const plain = spawnInstances(
      { weaponId: "predator", slot: 0, finalVolley: true, pressId: "a#0#0" },
      owner,
      0,
      0,
    ).instances[0]!;
    const buffed = spawnInstances(
      { weaponId: "predator", slot: 0, finalVolley: true, pressId: "a#0#0" },
      owner,
      0,
      0,
      null,
      1.25,
    ).instances[0]!;
    expect(buffed.damage).toBe(scaleDamage(plain.damage, 1.25));
    expect(buffed.damage).toBeGreaterThan(plain.damage);
  });

  it("rounds to a whole number, so a piercing shot costs every car the same", () => {
    const shot = spawnInstances(
      { weaponId: "predator", slot: 0, finalVolley: true, pressId: "a#0#0" },
      owner,
      0,
      0,
      null,
      1.13,
    ).instances[0]!;
    expect(Number.isInteger(shot.damage)).toBe(true);
  });
});

describe("damageTaken is applied at impact", () => {
  it("scales an incoming amount", () => {
    expect(scaleDamage(20, STATUS_TABLE.corroded.modifiers.damageTaken)).toBe(26);
    expect(scaleDamage(20, STATUS_TABLE.fortified.modifiers.damageTaken)).toBe(14);
  });

  it("never heals, whatever a bad multiplier says", () => {
    expect(scaleDamage(20, -5)).toBe(20);
    expect(scaleDamage(20, Number.NaN)).toBe(20);
    expect(scaleDamage(20, 0)).toBe(0);
  });
});

describe("applyHeal is the only way hp goes up", () => {
  it("restores hp up to the cap and no further", () => {
    expect(applyHeal(100, 30, 500)).toBe(130);
    expect(applyHeal(480, 30, 500)).toBe(500);
    expect(applyHeal(500, 30, 500)).toBe(500);
  });

  it("never revives a wreck", () => {
    expect(applyHeal(0, 200, 500)).toBe(0);
  });

  it("ignores a non-positive amount rather than dealing damage", () => {
    expect(applyHeal(100, 0, 500)).toBe(100);
    expect(applyHeal(100, -50, 500)).toBe(100);
  });
});

describe("weaponCooldown reaches the three refire clocks and no others", () => {
  it("shortens a recharge", () => {
    // Bullseye's slot 1 since the 2026-09-02 loadout swap — predator's 1000ms cooldown is what the
    // assertion below is pinned against, not CAR (mirage), whose slot 1 is magmablast now.
    const state = newFireState("bullseye", 1);
    const spent = { ...state, slots: state.slots.map((s) => ({ ...s, stocks: 0 })) };
    const hasted = tickRecharge(spent, 0, 0.5);
    const plain = tickRecharge(spent, 0, 1);
    expect(hasted.slots[0]!.rechargeEndsTick).toBe(scaleTicks(weaponTicksOf("predator").cooldown, 0.5));
    expect(hasted.slots[0]!.rechargeEndsTick).toBeLessThan(plain.slots[0]!.rechargeEndsTick);
  });

  it("shortens the switch lock a release sets", () => {
    const state = newFireState("bullseye", 1);
    const pending = {
      ...state,
      pending: { weaponId: "lance" as const, slot: 1, shotsLeft: 1, nextShotTick: 0, pressId: "p1#0#1" },
    };
    expect(releaseShots(pending, 0, 0.5).state.switchLockUntilTick).toBe(
      scaleTicks(weaponTicksOf("lance").recovery, 0.5),
    );
  });

  it("leaves a zero clock at zero — a debuff cannot invent a recovery a weapon does not have", () => {
    expect(scaleTicks(0, 3)).toBe(0);
  });

  it("never rounds a live clock down to zero, and leaves an infinite one infinite", () => {
    expect(scaleTicks(1, 0.01)).toBe(1);
    expect(scaleTicks(Number.POSITIVE_INFINITY, 0.5)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the ramDefence channel reaches the ram, as the victim's own resistance", () => {
  // The two-sided contest (`pushOf`'s attacker term, `impactOn`'s divisor, `applyImpulse`'s
  // `defenceFactorOf`) is gone since the 2026-09-18 Unity ram port (spec §7.4): a ram is no longer a
  // push `applyImpulse` reconciles between two cars, it is `shoveOf` dividing straight by the
  // RECEIVING car's own resistance, `ramDefenceOf(victim.carId) * victim.defenceMult`. `ramDefence`
  // therefore has exactly one effect now, on the receiving side only — buffing the ATTACKER's
  // `defenceMult` does nothing, because `shoveOf` never reads it.
  function car(over: Partial<RamCar> = {}): RamCar {
    return {
      sessionId: "a", team: 0, x: 0, y: 0, angle: 0, vx: 0, vy: 0, carId: CAR,
      defenceMult: 1, ramBlocked: false, ...over,
    };
  }

  function shoveMagnitude(resolution: ReturnType<typeof resolveRam>, sessionId: string): number {
    const side = resolution!.sides.find((s) => s.sessionId === sessionId)!;
    return Math.hypot(side.shoveX, side.shoveY);
  }

  it("makes a buffed victim harder to shove", () => {
    const attacker = car({ vx: 100, vy: 0 });
    const plainVictim = car({ sessionId: "b", x: 58.75 });
    const heavyVictim = car({ sessionId: "b", x: 58.75, defenceMult: 1.5 });
    const plain = resolveRam(attacker, plainVictim, "ffa");
    const heavy = resolveRam(attacker, heavyVictim, "ffa");
    expect(shoveMagnitude(heavy, "b")).toBeLessThan(shoveMagnitude(plain, "b"));
  });

  it("leaves the attacker's own defenceMult with no effect on the shove it lands", () => {
    const victim = car({ sessionId: "b", x: 58.75 });
    const plain = resolveRam(car({ vx: 100, vy: 0 }), victim, "ffa");
    const buffed = resolveRam(car({ vx: 100, vy: 0, defenceMult: 1.5 }), victim, "ffa");
    expect(shoveMagnitude(buffed, "b")).toBeCloseTo(shoveMagnitude(plain, "b"), 9);
  });

  // The channel left `fortified`'s row in the 2026-09-01 overhaul (O5: pure damage reduction now)
  // and no other row has picked it up, so no live row demonstrates a car buffing its own
  // `ramDefence` today — the mechanism above still proves the channel itself reaches `shoveOf` for
  // whoever authors one.
});

describe("the Unity ability flags and the grip channel", () => {
  it("is neutral on every new modifier for a car in no status", () => {
    expect(NEUTRAL_MODIFIERS.spinFree).toBe(false);
    expect(NEUTRAL_MODIFIERS.ramBlocked).toBe(false);
    expect(NEUTRAL_MODIFIERS.grip).toBe(1);
  });

  it("leaves them neutral for a row that declares none of them", () => {
    const mods = modifiersOf([{ statusId: "stunned", startTick: 0, endsTick: 10, sourceSessionId: "" }], 0);
    expect(mods.spinFree).toBe(false);
    expect(mods.ramBlocked).toBe(false);
    expect(mods.grip).toBe(1);
  });

  it("clamps grip to STATUS_LIMITS, so no stack of debuffs turns a car into a puck", () => {
    expect(STATUS_LIMITS.grip.min).toBeGreaterThan(0);
    expect(STATUS_LIMITS.grip.max).toBeGreaterThanOrEqual(1);
  });

  /**
   * `grip` reaching `gripFactorOf`, to this file's own standard rather than the neutrality-only
   * standard the other two new members are held to.
   *
   * The expression is `drive-vector.test.ts`'s, deliberately: the lateral component takes drag on the
   * whole vector AND grip on top of it, and the modifier enters grip as a POWER (`gripPerTick **
   * mods.grip`) the same way `accel` enters drag — `dragFactorOf`'s own trick, so `grip: 0`
   * degenerates to no grip at all rather than to an instant stop.
   */
  it("scales the lateral bleed through gripFactorOf, as a power", () => {
    const sliding = body({ vx: 0, vy: 100 }); // pure lateral at angle 0: 100 u/s to the car's left
    const neutral = stepDrive(sliding, input(0, 0), DT, GOLDEN_CHASSIS, NEUTRAL_MODIFIERS);
    expect(lateralOf(neutral.vx, neutral.vy, neutral.angle)).toBeCloseTo(
      100 * GOLDEN_CHASSIS.dragPerTick * GOLDEN_CHASSIS.gripPerTick, 9);

    const loose = stepDrive(sliding, input(0, 0), DT, GOLDEN_CHASSIS, mods({ grip: 0.6 }));
    expect(lateralOf(loose.vx, loose.vy, loose.angle)).toBeCloseTo(
      100 * GOLDEN_CHASSIS.dragPerTick * GOLDEN_CHASSIS.gripPerTick ** 0.6, 9);
    // Less grip means the slide carries further — the direction a knockback-lengthening debuff wants.
    expect(lateralOf(loose.vx, loose.vy, loose.angle)).toBeGreaterThan(
      lateralOf(neutral.vx, neutral.vy, neutral.angle));

    // `grip: 0` is Unity's "no grip at all": drag alone, no extra sideways bleed. Out of
    // `STATUS_LIMITS`' reach for an authored row, and the degenerate case the power form must hit.
    const puck = stepDrive(sliding, input(0, 0), DT, GOLDEN_CHASSIS, mods({ grip: 0 }));
    expect(lateralOf(puck.vx, puck.vy, puck.angle)).toBeCloseTo(100 * GOLDEN_CHASSIS.dragPerTick, 9);
  });
});

describe("reeling and ramLock, redefined by the 2026-09-18 Unity ram port", () => {
  it("makes a reeling car a passenger: no throttle, no steering, no grip, free spin, no ramming", () => {
    const mods = modifiersOf([{ statusId: "reeling", endsTick: 10, sourceSessionId: "a" }], 0);
    expect(mods.immobilised).toBe(true);
    expect(mods.steeringLocked).toBe(true);
    expect(mods.spinFree).toBe(true);
    expect(mods.ramBlocked).toBe(true);
    // It is not a stun: the trigger still works.
    expect(mods.disarmed).toBe(false);
    // Grip is REDUCED, not switched off (spec §5): a shove scrubs, only slower.
    expect(mods.grip).toBeCloseTo(0.6, 9);
    expect(mods.grip).toBeGreaterThan(0);
    // The contest-era multipliers are gone.
    expect(mods.turnRate).toBe(1);
    expect(mods.accel).toBe(1);
  });

  it("puts grip on the clamped channel path, and says so while the clamp is unreachable", () => {
    // Stage 1 Task 2 added the `grip` channel with a clamp test that could only assert the SHAPE of
    // STATUS_LIMITS: no row declared `grip`, so nothing drove a value through multiply-then-clamp.
    // `reeling` is the first row that does. It still cannot REACH either limit — a single 0.6 sits
    // inside 0.25..2, and `reapply: "ignore"` stops it stacking with itself — so the honest thing to
    // assert is that the value rides the generic channel path, plus a guard that fails the day a
    // second `grip` row makes the clamp reachable and a real clamp test becomes possible.
    const mods = modifiersOf([{ statusId: "reeling", endsTick: 10, sourceSessionId: "a" }], 0);
    expect(mods.grip).toBeCloseTo(STATUS_TABLE.reeling.modifiers.grip!, 9);
    expect(mods.grip).toBeGreaterThanOrEqual(STATUS_LIMITS.grip.min);
    expect(mods.grip).toBeLessThanOrEqual(STATUS_LIMITS.grip.max);

    const gripRows = Object.values(STATUS_TABLE).filter((row) => row.modifiers.grip !== undefined);
    expect(gripRows.map((row) => row.id)).toEqual(["reeling"]);
    // If THAT line fails, a second row now scales grip: write a test that actually drives the product
    // past a limit and checks it is clamped, then delete this guard.
  });

  it("kills a rammer's own controls without making it a passenger", () => {
    const mods = modifiersOf([{ statusId: "ramLock", endsTick: 10, sourceSessionId: "a" }], 0);
    expect(mods.immobilised).toBe(true);
    expect(mods.steeringLocked).toBe(true);
    expect(mods.ramBlocked).toBe(true);
    // A rammer stops; it does not slide, and it keeps full grip.
    expect(mods.grip).toBe(1);
    expect(mods.spinFree).toBe(false);
  });
});
