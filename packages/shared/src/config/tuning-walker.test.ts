import { describe, expect, it } from "vitest";
import { CAR_TABLE } from "./car-config.js";
import { DRIVE_CONFIG } from "./drive-config.js";
import { applyOverrides } from "../modes/overlay.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { sanitizeStoredTuning, tunableFields, validateTuning } from "./tuning-walker.js";

/**
 * The bundle every case below walks. Named once rather than re-resolved per call so the tests read
 * the way the production callers do: one bundle, the same one the panel, the validator and the
 * write all name (see `tuning-walker.ts`'s header for why that is now a parameter).
 */
const BASE = modeConfigOf(DEFAULT_GAME_MODE);

describe("tuning walker", () => {
  it("every emitted path round-trips through applyOverrides without throwing", () => {
    // The walker EMITS paths and `applyOverrides` RESOLVES them, and neither knows about the other:
    // this is the only thing holding the two path grammars together. Nothing is installed — a
    // rejected path throws out of `applyOverrides` itself, which is all this needs to see.
    for (const f of tunableFields(BASE)) {
      expect(() => applyOverrides(BASE, { [f.path]: f.shipped }), f.path).not.toThrow();
    }
  });

  it("walks the seven ratings per car and nothing else from CAR_TABLE", () => {
    const mirage = tunableFields(BASE).filter((f) => f.group === "car" && f.ownerId === "mirage");
    expect(mirage.map((f) => f.label).sort()).toEqual([
      "accel", "attack", "handling", "hp", "ramAttack", "ramDefence", "speed",
    ]);
  });

  it("skips identity fields at any depth and never emits color or kind", () => {
    expect(tunableFields(BASE).some((f) => /(^|\.)(id|name|kind|color)$/.test(f.label))).toBe(false);
  });

  // Regression (code review): `shape` and `type` are discriminated-union tags — `ProjectileHitbox`'s
  // `shape` and `ManeuverSpec`'s `type` each gate which sibling keys the object legally has.
  // Emitting them as leaf-writable enums let a validated blob flip the tag while leaving the OTHER
  // variant's siblings in place (a `circle` tag with a `capsule`'s `radiusAlong`/`radiusAcross` and
  // no `radius`), which NaNs `capsuleShapeAt`/`circleShapeAt` in `sim/weapons/shapes.ts`. They must
  // never be emitted as tunable fields at all, alongside `id`/`name`/`kind`/`color`.
  it("never emits a union-tag field (shape, type) as tunable, at any depth", () => {
    const fields = tunableFields(BASE);
    expect(fields.some((f) => /(^|\.)(shape|type)$/.test(f.label))).toBe(false);
  });

  it("statusId and other non-tag string leaves are still safe to enumerate", () => {
    // The enum machinery itself (options drawn from same-kind rows, >=2 threshold) stays live for
    // leaves that don't gate sibling keys: swapping which status a weapon applies leaves every
    // sibling of that `applies` entry (`target`, `durationMs`) intact.
    const statusIdFields = tunableFields(BASE).filter((f) => f.label.endsWith(".statusId"));
    expect(statusIdFields.length).toBeGreaterThan(0);
    expect(statusIdFields.every((f) => f.kind === "enum" && (f.options?.length ?? 0) >= 2)).toBe(true);
  });

  it("validateTuning rejects the whole blob on one bad entry", () => {
    expect(validateTuning(BASE, { "drive.baseTurnRate": 1, "drive.nope": 2 }).ok).toBe(false);
    expect(validateTuning(BASE, { "drive.baseTurnRate": Number.NaN }).ok).toBe(false);
    expect(validateTuning(BASE, { "car.mirage.speed": 101 }).ok).toBe(false); // above max
  });

  // Regression (code review): both paths were unknown-but-plausible-looking dot-paths before the
  // `shape`/`type` skip landed, and `validateTuning` would have accepted them as legal enum writes —
  // exactly the NaN-poisoning and silently-broken-maneuver bugs review caught. Now they are simply
  // not in the field map at all, so both are rejected as unknown paths.
  it("rejects a hitbox-shape or maneuver-type override — the field no longer exists to tune", () => {
    expect(validateTuning(BASE, { "weapon.magmablast.hitbox.shape": "capsule" }).ok).toBe(false);
    expect(validateTuning(BASE, { "weapon.thunderclap.maneuver.type": "charge" }).ok).toBe(false);
  });

  it("sanitizeStoredTuning drops stale paths silently and keeps good ones", () => {
    const clean = sanitizeStoredTuning(BASE, { "drive.baseTurnRate": 2, "weapon.retired.damage": 5 });
    expect(Object.keys(clean)).toEqual(["drive.baseTurnRate"]);
  });

  it("emits every IMPULSE_CONFIG member, so the panel cannot silently lose the root", () => {
    // The walker enumerates each root with its own explicit loop, so a root is not emitted until
    // someone writes that loop — a new member of an EXISTING root appears for free, but a dropped
    // loop takes the whole root away with no other test noticing.
    const emitted = tunableFields(BASE).filter((f) => f.group === "impulse");
    expect(emitted.map((f) => f.path).sort()).toEqual(["impulse.spinScale", "impulse.wallContactPad"]);
    expect(emitted.every((f) => f.kind === "number")).toBe(true);
  });

  it("emits the turret root and every chassis's mount under its own group, never the car group (TR58)", () => {
    const turret = tunableFields(BASE).filter((f) => f.group === "turret");
    const global = turret.filter((f) => f.ownerId === undefined).map((f) => f.path).sort();
    expect(global).toEqual(["turret.maxSwingDeg", "turret.turnRateDegPerSec"]);
    for (const carId of Object.keys(CAR_TABLE)) {
      const mount = turret.filter((f) => f.ownerId === carId).map((f) => f.path).sort();
      expect(mount, carId).toEqual([`car.${carId}.turretMount.x`, `car.${carId}.turretMount.y`]);
    }
    // The Physics panel's Cars tab reads `group === "car"`; a mount there would show up twice.
    expect(tunableFields(BASE).some((f) => f.group === "car" && f.path.includes("turretMount"))).toBe(false);
  });

  it("holds the turret knobs to a sensible range: turn rate above zero, swing in (0, 360], mount on the hull (TR58)", () => {
    expect(validateTuning(BASE, { "turret.turnRateDegPerSec": 0 }).ok).toBe(false);
    expect(validateTuning(BASE, { "turret.maxSwingDeg": 0 }).ok).toBe(false);
    expect(validateTuning(BASE, { "turret.maxSwingDeg": 361 }).ok).toBe(false);
    expect(validateTuning(BASE, { "turret.maxSwingDeg": 360, "turret.turnRateDegPerSec": 720 }).ok).toBe(true);
    const halfW = DRIVE_CONFIG.carWidth / 2;
    const halfH = DRIVE_CONFIG.carHeight / 2;
    expect(validateTuning(BASE, { "car.bastion.turretMount.x": -halfW, "car.bastion.turretMount.y": halfH }).ok).toBe(true);
    expect(validateTuning(BASE, { "car.bastion.turretMount.x": halfW + 1 }).ok).toBe(false);
    expect(validateTuning(BASE, { "car.bastion.turretMount.y": -halfH - 1 }).ok).toBe(false);
  });
});

/**
 * The bundle plumbing (phase 6). Both shipped modes are byte-identical — `table-pinning.test.ts`
 * holds them that way — so "mode 2's fields differ from mode 0's" cannot be asserted and would not
 * be worth asserting if it could. What CAN be asserted, and is what actually broke, is that the
 * walker describes WHICHEVER bundle it is handed: a tuned sibling built by `applyOverrides` is a
 * genuinely different `ModeConfig` object with genuinely different numbers, which is exactly the
 * divergence a second mode will one day be.
 */
describe("the field list describes the bundle it was built from", () => {
  const TUNED = applyOverrides(BASE, { "drive.baseTurnRate": 2, "car.mirage.speed": 42 });
  const find = (fields: ReturnType<typeof tunableFields>, path: string) =>
    fields.find((f) => f.path === path)!;

  it("reports the bundle's own value as `shipped`, not the raw global's", () => {
    expect(find(tunableFields(BASE), "car.mirage.speed").shipped).toBe(BASE.cars.mirage.speed);
    expect(find(tunableFields(TUNED), "car.mirage.speed").shipped).toBe(42);
    expect(find(tunableFields(BASE), "drive.baseTurnRate").shipped).toBe(BASE.drive.baseTurnRate);
    expect(find(tunableFields(TUNED), "drive.baseTurnRate").shipped).toBe(2);
  });

  it("pitches a slider's RANGE off that same value — the half the panel showed and the write did not", () => {
    // `numberRange` is shipped*3, so a bundle whose value moved gets a different ceiling. This is
    // the concrete shape of the bug: a range taken from one bundle over a write applied to another.
    expect(find(tunableFields(TUNED), "drive.baseTurnRate").max).toBe(6);
    expect(find(tunableFields(BASE), "drive.baseTurnRate").max).toBe(BASE.drive.baseTurnRate * 3);
  });

  it("judges a value against the bundle it was given, in both directions", () => {
    // 5 sits inside the tuned bundle's 0..6 and outside the base bundle's 0..~3.
    expect(validateTuning(TUNED, { "drive.baseTurnRate": 5 }).ok).toBe(true);
    expect(validateTuning(BASE, { "drive.baseTurnRate": 5 }).ok).toBe(false);
    // `sanitizeStoredTuning` runs the same per-entry check, so a stored blob follows the bundle too.
    expect(sanitizeStoredTuning(TUNED, { "drive.baseTurnRate": 5 })).toEqual({ "drive.baseTurnRate": 5 });
    expect(sanitizeStoredTuning(BASE, { "drive.baseTurnRate": 5 })).toEqual({});
  });

  /**
   * **This case was a tautology and is now a pair.**
   *
   * The sweep below — every row a panel built from one bundle shows, offered back at its own
   * `shipped` value, accepted by the validator keyed off that same bundle — cannot fail by
   * construction. `numberRange` derives a field's range FROM its shipped value (`0..shipped*3`),
   * and an enum's options always include the row's own current value, so the answer is baked in
   * whatever the walker does with the bundle it is handed. Gutting `tunableFields` to read a
   * hardcoded config left it green.
   *
   * What it was reaching for is a CROSS-bundle property, and that needs a divergence the two
   * shipped modes cannot supply while `table-pinning.test.ts` holds them byte-identical. A tuned
   * sibling from `applyOverrides` supplies it: `FAR` moves one field far outside BASE's own
   * `shipped * 3` ceiling, which is the shape a genuinely diverged second mode will one day have.
   * The panel's own value must then be accepted by its own bundle's validator and REFUSED by the
   * other's — that pair is what proves the two read the bundle they were given rather than a
   * shared global, and it is the half that fails when they stop doing so.
   */
  it("the panel and the validator agree on one bundle and disagree across two", () => {
    const FAR = applyOverrides(BASE, { "drive.baseTurnRate": BASE.drive.baseTurnRate * 100 });
    const far = find(tunableFields(FAR), "drive.baseTurnRate");

    // The half that can fail: FAR's own shipped value sits far outside BASE's 0..shipped*3.
    expect(far.shipped).toBe(BASE.drive.baseTurnRate * 100);
    expect(far.shipped).toBeGreaterThan(BASE.drive.baseTurnRate * 3);
    expect(validateTuning(FAR, { "drive.baseTurnRate": far.shipped }).ok).toBe(true);
    expect(validateTuning(BASE, { "drive.baseTurnRate": far.shipped }).ok).toBe(false);
    // ...and symmetrically, BASE's own ceiling is no longer a legal value for FAR's slider grid.
    expect(find(tunableFields(BASE), "drive.baseTurnRate").max).toBeLessThan(far.max);

    // The tautological sweep, kept as the OTHER half of the pair rather than deleted: it is worth
    // nothing alone, and it is what says the cross-bundle refusal above is a real disagreement
    // rather than a validator that rejects everything.
    for (const f of tunableFields(FAR)) {
      expect(validateTuning(FAR, { [f.path]: f.shipped }).ok, f.path).toBe(true);
    }
  });

  it("caches per bundle without handing out the cache", () => {
    const first = tunableFields(BASE);
    const second = tunableFields(BASE);
    expect(second).not.toBe(first); // a fresh array each call, so a caller may sort it
    expect(second).toEqual(first); // ...off one cached, frozen field list
    expect(Object.isFrozen(first[0])).toBe(true);
  });
});
