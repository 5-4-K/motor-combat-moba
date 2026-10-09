import { describe, expect, it } from "vitest";
import { ARENAS } from "./registry.js";

/**
 * AR2: the arena select screen shows `displayName`, so two arenas a player cannot tell apart by name
 * are a bug. Compared trimmed and case-folded — "Arena 01" and "arena 01 " are the same name to a
 * player.
 */
describe("arena display names (AR2)", () => {
  const rows = Object.entries(ARENAS).map(([id, def]) => ({ id, name: def.displayName }));

  it.each(rows)("$id has a non-blank display name", ({ name }) => {
    expect(typeof name).toBe("string");
    expect(name.trim().length).toBeGreaterThan(0);
  });

  it("no two arenas share a display name, ignoring case and surrounding space", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const { id, name } of rows) {
      const key = name.trim().toLowerCase();
      const other = seen.get(key);
      if (other !== undefined) clashes.push(`${other} and ${id} are both "${name.trim()}"`);
      else seen.set(key, id);
    }
    expect(clashes).toEqual([]);
  });

  it("seeds names from the id (AR1)", () => {
    expect(ARENAS["arena-01"].displayName).toBe("Arena 01");
    expect(ARENAS["arena-02"].displayName).toBe("Arena 02");
    expect(ARENAS["arena-03"].displayName).toBe("Arena 03");
  });
});
