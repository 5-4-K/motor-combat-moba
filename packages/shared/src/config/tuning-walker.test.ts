import { describe, expect, it } from "vitest";
import { setTuning } from "./tuning.js";
import { sanitizeStoredTuning, tunableFields, validateTuning } from "./tuning-walker.js";

describe("tuning walker", () => {
  it("every emitted path round-trips through setTuning without throwing", () => {
    for (const f of tunableFields()) {
      expect(() => setTuning({ [f.path]: f.shipped })).not.toThrow();
    }
    setTuning(null);
  });

  it("walks the six ratings per car and nothing else from CAR_TABLE", () => {
    const mirage = tunableFields().filter((f) => f.group === "car" && f.ownerId === "mirage");
    expect(mirage.map((f) => f.label).sort()).toEqual(["accel", "attack", "handling", "hp", "mass", "speed"]);
  });

  it("skips identity fields at any depth and never emits color or kind", () => {
    expect(tunableFields().some((f) => /(^|\.)(id|name|kind|color)$/.test(f.label))).toBe(false);
  });

  // Regression (code review): `shape` and `type` are discriminated-union tags — `ProjectileHitbox`'s
  // `shape` and `ManeuverSpec`'s `type` each gate which sibling keys the object legally has.
  // Emitting them as leaf-writable enums let a validated blob flip the tag while leaving the OTHER
  // variant's siblings in place (a `circle` tag with a `capsule`'s `radiusAlong`/`radiusAcross` and
  // no `radius`), which NaNs `capsuleShapeAt`/`circleShapeAt` in `sim/weapons/shapes.ts`. They must
  // never be emitted as tunable fields at all, alongside `id`/`name`/`kind`/`color`.
  it("never emits a union-tag field (shape, type) as tunable, at any depth", () => {
    const fields = tunableFields();
    expect(fields.some((f) => /(^|\.)(shape|type)$/.test(f.label))).toBe(false);
  });

  it("statusId and other non-tag string leaves are still safe to enumerate", () => {
    // The enum machinery itself (options drawn from same-kind rows, >=2 threshold) stays live for
    // leaves that don't gate sibling keys: swapping which status a weapon applies leaves every
    // sibling of that `applies` entry (`target`, `durationMs`) intact.
    const statusIdFields = tunableFields().filter((f) => f.label.endsWith(".statusId"));
    expect(statusIdFields.length).toBeGreaterThan(0);
    expect(statusIdFields.every((f) => f.kind === "enum" && (f.options?.length ?? 0) >= 2)).toBe(true);
  });

  it("validateTuning rejects the whole blob on one bad entry", () => {
    expect(validateTuning({ "drive.baseTurnRate": 1, "drive.nope": 2 }).ok).toBe(false);
    expect(validateTuning({ "drive.baseTurnRate": Number.NaN }).ok).toBe(false);
    expect(validateTuning({ "car.mirage.speed": 101 }).ok).toBe(false); // above max
  });

  // Regression (code review): both paths were unknown-but-plausible-looking dot-paths before the
  // `shape`/`type` skip landed, and `validateTuning` would have accepted them as legal enum writes —
  // exactly the NaN-poisoning and silently-broken-maneuver bugs review caught. Now they are simply
  // not in the field map at all, so both are rejected as unknown paths.
  it("rejects a hitbox-shape or maneuver-type override — the field no longer exists to tune", () => {
    expect(validateTuning({ "weapon.magmablast.hitbox.shape": "capsule" }).ok).toBe(false);
    expect(validateTuning({ "weapon.thunderclap.maneuver.type": "charge" }).ok).toBe(false);
  });

  it("sanitizeStoredTuning drops stale paths silently and keeps good ones", () => {
    const clean = sanitizeStoredTuning({ "drive.baseTurnRate": 2, "weapon.retired.damage": 5 });
    expect(Object.keys(clean)).toEqual(["drive.baseTurnRate"]);
  });
});
