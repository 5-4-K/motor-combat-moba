import type { ColorDef } from "./types.js";

export const COLOR_TABLE = [
  { colorId: 0, name: "Crimson", hex: "#BF1402" },
  { colorId: 1, name: "Azure", hex: "#3498DB" },
  { colorId: 2, name: "Emerald", hex: "#2ECC71" },
  { colorId: 3, name: "Gold", hex: "#F1C40F" },
  { colorId: 4, name: "Violet", hex: "#9B59B6" },
  { colorId: 5, name: "Orange", hex: "#DB6C09" },
] as const satisfies readonly ColorDef[];

/**
 * A real index into `COLOR_TABLE`. `colorId` is a wire value and a schema field, so this is the one
 * place that answers "is this a colour" — an out-of-range id would paint a car through
 * `carFillOf`'s silent fallback rather than being rejected at the edge.
 */
export function isColorId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < COLOR_TABLE.length;
}
