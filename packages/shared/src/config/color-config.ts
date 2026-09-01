import type { ColorDef } from "./types.js";

export const COLOR_TABLE = [
  { colorId: 0, name: "Crimson", hex: "#BF1402" },
  { colorId: 1, name: "Azure", hex: "#3498DB" },
  { colorId: 2, name: "Emerald", hex: "#2ECC71" },
  { colorId: 3, name: "Gold", hex: "#F1C40F" },
  { colorId: 4, name: "Violet", hex: "#9B59B6" },
  { colorId: 5, name: "Orange", hex: "#DB6C09" },
] as const satisfies readonly ColorDef[];
