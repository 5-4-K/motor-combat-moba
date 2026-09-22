import type { CarId, TunableField, TuningOverrides, TuningValue } from "@motor-combat-moba/shared";
import { cars, tunableFields } from "@motor-combat-moba/shared";
import type { AssetManifest } from "../../assets/manifest-schema.js";
import { turretSpriteKeys } from "../../assets/asset-keys.js";
import {
  CROSSHAIR_DISTANCE_KEY,
  TURRET_LENGTH_KEY,
  carScaleKey,
  type TurretViewOverrides,
} from "../../scenes/turret-view.js";

/**
 * Pure derivations for the playground's Turret settings panel (spec TR58–TR61). `turret-panel.ts`
 * is the untested DOM shell over these, the same split `ui-model.ts` makes for the other panels.
 */

/** One block of the panel's sim half: the global knobs, or one chassis's mount. */
export interface TurretSimSection {
  readonly title: string;
  /** Absent for the global block. */
  readonly carId?: CarId;
  /** An unreleased chassis (`isActive: false`) — offered all the same, and marked (PG18). */
  readonly inactive: boolean;
  readonly fields: readonly TunableField[];
}

function turretFields(): TunableField[] {
  return tunableFields().filter((f) => f.group === "turret");
}

/**
 * The global block first, then every `cars()` row in table order — all nine, inactive ones
 * included: a prototype is exactly where a mount gets placed before release, and the playground can
 * already drive one (PG18).
 */
export function turretSimSections(): TurretSimSection[] {
  const fields = turretFields();
  const sections: TurretSimSection[] = [
    { title: "Turret", inactive: false, fields: fields.filter((f) => f.ownerId === undefined) },
  ];
  for (const carId of Object.keys(cars()) as CarId[]) {
    const car = cars()[carId];
    sections.push({
      title: car.name,
      carId,
      inactive: !car.isActive,
      fields: fields.filter((f) => f.ownerId === carId),
    });
  }
  return sections;
}

const TURRET_PATHS: ReadonlySet<string> = new Set(turretFields().map((f) => f.path));

/** Is this tuning path one the Turret panel owns (TR58)? Both panels share one overrides map. */
export function isTurretSimPath(path: string): boolean {
  return TURRET_PATHS.has(path);
}

/** The Turret panel's Reset, in place: drops its own paths and leaves every Physics override standing. */
export function clearTurretSimPaths(overrides: Record<string, TuningValue>): void {
  for (const path of Object.keys(overrides)) {
    if (isTurretSimPath(path)) delete overrides[path];
  }
}

/** The mirror of `clearTurretSimPaths`, as a copy: what the Physics panel's Copy overrides shows. */
export function withoutTurretSimPaths(overrides: TuningOverrides): Record<string, TuningValue> {
  const out: Record<string, TuningValue> = {};
  for (const [path, value] of Object.entries(overrides)) {
    if (!isTurretSimPath(path)) out[path] = value;
  }
  return out;
}

const SHIPPED: ReadonlyMap<string, TuningValue> = new Map(turretFields().map((f) => [f.path, f.shipped]));

/** Trims a binary-float tail off a product (`1.2 * 1.5`) before it is printed for pasting. */
function tidy(value: number): number {
  return Number(value.toPrecision(12));
}

/**
 * The panel's Export (TR61): every value that differs from shipped, under the file and field it
 * belongs in, ready to type in. Empty when nothing moved, so the caller can say so instead.
 *
 * A mount is written WHOLE (`{ x, y }`) even when one axis moved, with the other at its shipped
 * value — the destination is one object literal per chassis. A per-car size multiplier has no config
 * home at all: it is written as that car's `turret.<id>` manifest row's `scale`, which is multiplied
 * by the global length exactly as the multiplier is (`turretDisplayLength`). A row whose `scale` is
 * `"fit"` counts as 1. A car with no row of its own draws `turret.default`, so the export says the
 * car needs per-car art or a row pointing at the default image, and gives that row.
 */
export function turretExportText(
  sim: TuningOverrides,
  view: TurretViewOverrides,
  manifest: AssetManifest,
): string {
  const blocks: string[] = [];

  // `TURRET_CONFIG` and `CAR_TABLE.${carId}` below (and in the loop's push just after it) are
  // PASTE-READY SOURCE TEXT, not a config read — this string is what a developer copies verbatim
  // into packages/shared/src/config/turret-config.ts, naming the real file-level constant they are
  // about to hand-edit. Converting it to an accessor call would paste the wrong thing.
  const config = (["turnRateDegPerSec", "maxSwingDeg"] as const)
    .filter((key) => sim[`turret.${key}`] !== undefined)
    .map((key) => `TURRET_CONFIG.${key} = ${String(sim[`turret.${key}`])}`);
  if (config.length > 0) blocks.push(["// packages/shared/src/config/turret-config.ts", ...config].join("\n"));

  const mounts: string[] = [];
  for (const carId of Object.keys(cars()) as CarId[]) {
    const axis = (a: "x" | "y"): TuningValue => {
      const path = `car.${carId}.turretMount.${a}`;
      return sim[path] ?? SHIPPED.get(path)!;
    };
    const moved = sim[`car.${carId}.turretMount.x`] !== undefined || sim[`car.${carId}.turretMount.y`] !== undefined;
    // Same paste-text rule as `config` above: `CAR_TABLE.${carId}.turretMount` names the real
    // shared source location this value gets typed into, not a live read.
    if (moved) mounts.push(`CAR_TABLE.${carId}.turretMount = { x: ${String(axis("x"))}, y: ${String(axis("y"))} }`);
  }
  if (mounts.length > 0) blocks.push(["// packages/shared/src/config/car-config.ts", ...mounts].join("\n"));

  const crosshair = view[CROSSHAIR_DISTANCE_KEY];
  if (crosshair !== undefined) {
    blocks.push(`// packages/client/src/config/crosshair.ts\nCROSSHAIR_CONFIG.maxDistance = ${crosshair}`);
  }
  const length = view[TURRET_LENGTH_KEY];
  if (length !== undefined) {
    blocks.push(`// packages/client/src/config/turret-visual.ts\nTURRET_VISUAL.lengthUnits = ${length}`);
  }

  const rows: string[] = [];
  for (const carId of Object.keys(cars()) as CarId[]) {
    const multiplier = view[carScaleKey(carId)];
    if (multiplier === undefined || multiplier === 1) continue;
    const [ownKey, defaultKey] = turretSpriteKeys(carId);
    const own = manifest.sprites[ownKey];
    if (own) {
      const base = typeof own.scale === "number" ? own.scale : 1;
      rows.push(`"${ownKey}": set "scale": ${tidy(base * multiplier)}`);
      continue;
    }
    const fallback = manifest.sprites[defaultKey];
    if (!fallback) {
      rows.push(
        `// "${ownKey}" has no manifest row and there is no "${defaultKey}" either, so it draws the ` +
          `procedural turret: size x${multiplier} needs per-car art before it has anywhere to go.`,
      );
      continue;
    }
    const base = typeof fallback.scale === "number" ? fallback.scale : 1;
    const row = { ...fallback, scale: tidy(base * multiplier) };
    rows.push(
      `// "${ownKey}" has no manifest row — it draws "${defaultKey}". Draw per-car art, or add a row\n` +
        `// pointing at the default image:\n"${ownKey}": ${JSON.stringify(row, null, 2)}`,
    );
  }
  if (rows.length > 0) blocks.push(["// packages/client/public/art/manifest.json", ...rows].join("\n"));

  return blocks.join("\n\n");
}
