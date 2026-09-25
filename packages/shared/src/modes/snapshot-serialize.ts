import type { ModeConfig, ModeTables } from "./types.js";

/** Canonical JSON for snapshot files: sorted keys, non-finite numbers as strings, no undefined. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function normalize(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner !== undefined) out[key] = normalize(inner);
    }
    return out;
  }
  return value;
}

/** A bundle's authored tables: everything but its `id` and the `derived` artifacts. */
export function tablesOf(config: ModeConfig): ModeTables {
  const { id: _id, derived: _derived, ...tables } = config;
  return tables;
}
