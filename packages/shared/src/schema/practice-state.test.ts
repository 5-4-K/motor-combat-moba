import { describe, expect, it } from "vitest";
import { ArenaState } from "./ArenaState.js";
import { PracticeState } from "./PracticeState.js";

describe("PracticeState", () => {
  it("is an ArenaState, so a plain arena client decodes it", () => {
    expect(new PracticeState()).toBeInstanceOf(ArenaState);
  });

  it("starts unpaused", () => {
    expect(new PracticeState().paused).toBe(false);
  });

  it("adds exactly one field over ArenaState (PR6)", () => {
    // Schema 5 keeps synced fields as prototype accessors, not own keys, so read the declared
    // field names from the class's own metadata rather than from an instance.
    const fieldsOf = (ctor: object): string[] => {
      const meta = (ctor as Record<symbol, Record<string, { name: string }> | undefined>)[
        Symbol.metadata
      ];
      const names: string[] = [];
      for (const key in meta) if (/^\d+$/.test(key)) names.push(meta[key]!.name);
      return names;
    };
    const base = fieldsOf(ArenaState);
    const added = fieldsOf(PracticeState).filter((name) => !base.includes(name));
    expect(added).toEqual(["paused"]);
  });
});
