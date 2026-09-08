import { isWeaponId } from "@motor-combat-moba/shared";
import type { FxBurst, FxChannel, WeaponFxRow } from "./table.js";
import { isCarEventId, weaponFxOf } from "./table.js";

/**
 * The playground's VFX tuning model (spec PG42-PG45, PG49, PG50).
 *
 * Pure and Phaser-free, so it runs under vitest's node environment beside the rest of `fx/`. It
 * turns a weapon's `WeaponFxRow` — a variable-length list per phase — into a FIXED grid of eight
 * cells, two phases by four channels, and applies a sparse override map to it. `count: 0` is the
 * off switch for a cell (PG42), which is what lets one rectangular grid represent every row in
 * `WEAPON_FX` and every row that has no entry there at all.
 */

const TAU = Math.PI * 2;

export type FxPhase = "muzzle" | "impact";

/** Phase order in the panel and in every derived list. */
export const FX_PHASES: readonly FxPhase[] = ["muzzle", "impact"];

/**
 * Which phases a subject has (EV21).
 *
 * A car event has no muzzle, so it renders a 1 x 4 grid rather than 2 x 4. It reuses the EXISTING
 * `"impact"` phase rather than introducing a third value, which is what keeps the override key
 * format and `sanitizeStoredVfx`'s phase check untouched.
 */
export function phasesForSubject(id: string): readonly FxPhase[] {
  return isCarEventId(id) ? ["impact"] : FX_PHASES;
}

/** Every id the fx panel can edit. Weapons first, then the two car events. */
export function isFxSubjectId(id: string): boolean {
  return isWeaponId(id) || isCarEventId(id);
}

/** Channel order in the panel. NOT the render order — see `resolveWeaponFx` in Task 2. */
export const FX_CHANNELS: readonly FxChannel[] = ["smoke", "fire", "spark", "debris"];

export type FxFieldName = keyof Omit<FxBurst, "channel">;

export interface FxFieldDef {
  readonly name: FxFieldName;
  readonly label: string;
  readonly kind: "number" | "boolean";
  /** Control-unit bounds. For `coneRad` these are DEGREES, not radians — see `toControl`. */
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The control edits degrees while the store holds radians (PG44). */
  readonly degrees: boolean;
  /** Rendered on every row for grid regularity, but live on smoke alone (PG50). */
  readonly smokeOnly: boolean;
}

/**
 * Every editable field of an `FxBurst`, with the range its slider spans (PG49).
 *
 * Ranges contain every shipped value with headroom and are deliberately NOT a budget guard: the
 * largest authored values are `count` 64, `speed` 420, `lifeMs` 1100, `size` 82, `growPerSec` 80,
 * and `MAX_SPECS_PER_FRAME` already caps a frame. A panel that refuses an extreme is a panel that
 * cannot answer "is this too much".
 *
 * `channel` is absent on purpose: it is the cell's identity, not one of its values.
 */
export const FX_FIELDS: readonly FxFieldDef[] = [
  // In `FxBurst`'s own declaration order — `soot` before `coneRad` — because this list orders the
  // panel's rows AND the export's keys. Emitting keys in a different order than `table.ts` writes
  // them produces a valid literal that no longer matches the rows beside it, and the whole point of
  // the export is a paste that leaves a clean diff.
  { name: "count", label: "Count", kind: "number", min: 0, max: 100, step: 1, degrees: false, smokeOnly: false },
  { name: "speed", label: "Speed", kind: "number", min: 0, max: 600, step: 5, degrees: false, smokeOnly: false },
  { name: "lifeMs", label: "Life (ms)", kind: "number", min: 0, max: 4000, step: 10, degrees: false, smokeOnly: false },
  { name: "size", label: "Size", kind: "number", min: 0, max: 120, step: 1, degrees: false, smokeOnly: false },
  { name: "growPerSec", label: "Grow/s", kind: "number", min: -20, max: 120, step: 1, degrees: false, smokeOnly: false },
  { name: "alpha", label: "Alpha", kind: "number", min: 0, max: 1, step: 0.01, degrees: false, smokeOnly: false },
  { name: "soot", label: "Soot", kind: "boolean", min: 0, max: 1, step: 1, degrees: false, smokeOnly: true },
  { name: "coneRad", label: "Cone", kind: "number", min: 0, max: 360, step: 1, degrees: true, smokeOnly: false },
];

/** A sparse map of `"<weaponId>.<phase>.<channel>.<field>"` to its value (PG43). */
export type FxOverrides = Record<string, number | boolean>;

export function fxKey(
  weaponId: string,
  phase: FxPhase,
  channel: FxChannel,
  field: FxFieldName,
): string {
  return `${weaponId}.${phase}.${channel}.${field}`;
}

/**
 * What a cell opens at when the weapon's row does not use that channel (PG45).
 *
 * The starting position of a control, not something the game renders — every one is `count: 0`, so
 * none of these reaches an emitter until a developer raises it. The other fields are plausible
 * values for that channel, taken from the shape the shipped rows use, so raising `count` off zero
 * produces something visible rather than a burst of zero-size particles.
 */
const CHANNEL_SEED: Readonly<Record<FxChannel, FxBurst>> = {
  smoke: { channel: "smoke", count: 0, speed: 40, lifeMs: 900, size: 26, growPerSec: 26, alpha: 0.3, soot: false, coneRad: TAU },
  fire: { channel: "fire", count: 0, speed: 70, lifeMs: 200, size: 34, growPerSec: 16, alpha: 0.9, soot: false, coneRad: TAU },
  spark: { channel: "spark", count: 0, speed: 280, lifeMs: 300, size: 5, growPerSec: -3, alpha: 1, soot: false, coneRad: TAU },
  debris: { channel: "debris", count: 0, speed: 140, lifeMs: 800, size: 4, growPerSec: 0, alpha: 1, soot: false, coneRad: TAU },
};

/**
 * The burst this cell would render with no overrides at all.
 *
 * Reads through `weaponFxOf`, so a weapon with no `WEAPON_FX` row seeds from `DEFAULT_WEAPON_FX` —
 * the six unauthored weapons open showing what they actually render today (PG45).
 */
export function shippedBurstFor(weaponId: string, phase: FxPhase, channel: FxChannel): FxBurst {
  const authored = weaponFxOf(weaponId)[phase].find((b) => b.channel === channel);
  return authored ?? CHANNEL_SEED[channel];
}

/** The burst this cell renders now: shipped, with any overridden field replaced. */
export function burstFor(
  weaponId: string,
  phase: FxPhase,
  channel: FxChannel,
  overrides: FxOverrides,
): FxBurst {
  const shipped = shippedBurstFor(weaponId, phase, channel);
  const out: Record<string, unknown> = { ...shipped };
  for (const field of FX_FIELDS) {
    const value = overrides[fxKey(weaponId, phase, channel, field.name)];
    if (value === undefined) continue;
    // A stored value of the wrong type is dropped rather than written through: the storage codec
    // (Task 5) is lenient by design, and a string where a number belongs would NaN-poison an
    // emitter config rather than fail loudly.
    if (field.kind === "number" && typeof value !== "number") continue;
    if (field.kind === "boolean" && typeof value !== "boolean") continue;
    out[field.name] = value;
  }
  return out as unknown as FxBurst;
}

export interface FxCell {
  readonly phase: FxPhase;
  readonly channel: FxChannel;
  readonly shipped: FxBurst;
  readonly current: FxBurst;
}

/**
 * All cells for one subject, phase-major, in `FX_CHANNELS` order — the panel's row order.
 *
 * Eight cells (two phases) for a weapon, four (one phase) for a car event — see `phasesForSubject`.
 */
export function fxCellsFor(
  weaponId: string,
  overrides: FxOverrides,
  phases: readonly FxPhase[] = FX_PHASES,
): FxCell[] {
  const cells: FxCell[] = [];
  for (const phase of phases) {
    for (const channel of FX_CHANNELS) {
      cells.push({
        phase,
        channel,
        shipped: shippedBurstFor(weaponId, phase, channel),
        current: burstFor(weaponId, phase, channel, overrides),
      });
    }
  }
  return cells;
}

/**
 * Stored value to control value. Identity for every field but `coneRad`, which is edited in degrees
 * (PG44) because a slider from 0 to 6.283 in steps of 0.098 is unreadable.
 *
 * Written as `rad / TAU * 360` rather than `rad * 180 / Math.PI` so that a full sphere — the value
 * 14 of the 25 shipped bursts author — round-trips to exactly `TAU` and back, instead of landing a
 * float's width away and writing a phantom override for a field nobody touched.
 */
export function toControl(field: FxFieldDef, stored: number): number {
  return field.degrees ? (stored / TAU) * 360 : stored;
}

/** Control value to stored value. The exact inverse of `toControl`. */
export function fromControl(field: FxFieldDef, control: number): number {
  return field.degrees ? (control / 360) * TAU : control;
}

/**
 * Should this control's value be treated as "shipped", i.e. should its override entry be DELETED?
 *
 * Both arguments are in CONTROL units, so the tolerance below is in the same units as `field.step`.
 * The half-step rule is `isAtShipped`'s, from `dev/playground/ui-model.ts`, and exists for the same
 * reason: a range input snaps to its `min`/`step` grid, the shipped value very often does not sit on
 * that grid, and a strict comparison would leave a phantom override behind every time a slider was
 * dragged back to where it started.
 */
export function isFxAtShipped(
  field: FxFieldDef,
  value: number | boolean,
  shipped: number | boolean,
): boolean {
  if (field.kind !== "number" || typeof value !== "number" || typeof shipped !== "number") {
    return value === shipped;
  }
  return Math.abs(value - shipped) < field.step / 2;
}

/** How `fx/emitters.ts` asks for a weapon's row. `weaponFxOf` is the shipped implementation. */
export type WeaponFxResolver = (weaponId: string) => WeaponFxRow;

/**
 * One phase's bursts, in RENDER order, with every disabled cell dropped.
 *
 * The authored order is preserved and newly enabled channels are appended after it, rather than
 * emitting `FX_CHANNELS` order throughout. Order decides which burst is spawned first and therefore
 * which one survives the `MAX_SPECS_PER_FRAME` cap, so re-sorting would be a silent behaviour change
 * for every weapon whose authored order differs — `magmablast`'s impact leads with fire, not smoke.
 */
function resolvePhase(
  weaponId: string,
  phase: FxPhase,
  authored: readonly FxBurst[],
  overrides: FxOverrides,
): FxBurst[] {
  const order: FxChannel[] = [
    ...authored.map((b) => b.channel),
    ...FX_CHANNELS.filter((c) => !authored.some((b) => b.channel === c)),
  ];
  const out: FxBurst[] = [];
  for (const channel of order) {
    const burst = burstFor(weaponId, phase, channel, overrides);
    // PG47: a disabled cell produces no burst at all, so it costs no emitter call, no texture
    // re-resolve, and none of the per-frame spec budget.
    if (burst.count > 0) out.push(burst);
  }
  return out;
}

/** A weapon's row with the override map applied. Equal to the shipped row for an empty map. */
export function resolveWeaponFx(weaponId: string, overrides: FxOverrides): WeaponFxRow {
  const shipped = weaponFxOf(weaponId);
  // An untouched weapon comes back BY IDENTITY, not as a rebuilt copy: while one weapon is being
  // tuned, every other one hits the shipped object and allocates nothing per burst. The check lives
  // here rather than in a resolver factory because `liveFxResolver` reads the store on every call —
  // a factory that precomputed the touched set would go stale the moment the panel edited the map.
  const prefix = `${weaponId}.`;
  let touched = false;
  for (const key in overrides) {
    if (key.startsWith(prefix)) {
      touched = true;
      break;
    }
  }
  if (!touched) return shipped;

  return {
    muzzle: resolvePhase(weaponId, "muzzle", shipped.muzzle, overrides),
    impact: resolvePhase(weaponId, "impact", shipped.impact, overrides),
  };
}

/** A number as source: `TAU` where it is exactly that, otherwise trimmed to four decimals. */
function numberSource(field: FxFieldName, value: number): string {
  if (field === "coneRad" && value === TAU) return "TAU";
  return String(Number(value.toFixed(4)));
}

function burstSource(burst: FxBurst): string {
  const fields = FX_FIELDS.map((field) => {
    const value = burst[field.name];
    const source = typeof value === "boolean" ? String(value) : numberSource(field.name, value);
    return `${field.name}: ${source}`;
  });
  return `{ channel: "${burst.channel}", ${fields.join(", ")} }`;
}

/**
 * The overrides as a pasteable `WEAPON_FX` / `CAR_EVENT_FX` fragment (spec PG53, widened by EV20-22).
 *
 * The destination is `packages/client/src/fx/table.ts`, not a JSON blob a codec reads back — which
 * is why this emits source rather than the JSON the physics panel's Copy button produces. Full rows
 * are emitted, in `table.ts`'s own shape, for every subject the developer actually touched; an
 * untouched subject is absent, so pasting the result can never rewrite a row nobody edited.
 *
 * Weapon rows and car-event rows live in two different objects in `table.ts`, so they are emitted
 * as two separately labelled groups — `// WEAPON_FX` and `// CAR_EVENT_FX` — rather than one flat
 * list, which is what keeps a paste from landing in the wrong table.
 *
 * Empty string when nothing is overridden — there is nothing to paste.
 */
export function fxTableSource(overrides: FxOverrides): string {
  const ids = [
    ...new Set(Object.keys(overrides).map((key) => key.slice(0, Math.max(0, key.indexOf("."))))),
  ].filter((id) => id.length > 0);
  if (ids.length === 0) return "";

  const rowSource = (id: string): string => {
    const row = resolveWeaponFx(id, overrides);
    const phase = (bursts: readonly FxBurst[]): string =>
      bursts.length === 0
        ? "[]"
        : `[\n${bursts.map((b) => `      ${burstSource(b)},`).join("\n")}\n    ]`;
    return [
      `  ${id}: {`,
      `    muzzle: ${phase(row.muzzle)},`,
      `    impact: ${phase(row.impact)},`,
      `  },`,
    ].join("\n");
  };

  const weaponRows = ids.filter((id) => !isCarEventId(id)).map(rowSource);
  const carRows = ids.filter(isCarEventId).map(rowSource);
  const parts: string[] = [];
  if (weaponRows.length > 0) parts.push(`// WEAPON_FX\n${weaponRows.join("\n")}`);
  if (carRows.length > 0) parts.push(`// CAR_EVENT_FX\n${carRows.join("\n")}`);
  return parts.join("\n\n");
}
