import { describe, expect, it } from "vitest";
import { termLine } from "./overlay.js";
import { pauseKeyAction } from "./ui-model.js";

describe("termLine (R-C4)", () => {
  it("prints a sentinel for an empty map rather than nothing at all", () => {
    // `BotDebugPayload.terms` is `{}` until the bot's first recompute window. The overlay writes
    // `terms  ${termLine(...)}`, so an empty join would render the label followed by whitespace —
    // indistinguishable from a broken renderer. `-` is the same "nothing to report" sentinel the
    // slot field uses for `firedSlot: -1` on the line above it.
    expect(termLine({})).toBe("-");
  });

  it("prints every key that arrived, in arrival order, and hard-codes none", () => {
    // The derivation this preserves: `BotDebug.planTerms` is keyed off `PlanWeights` itself and
    // copied wholesale across the wire, so a term added to the planner must appear here with no
    // edit to the overlay. A seventh key proves the function never consults a fixed list.
    expect(termLine({ myEv: 12, theirEv: -3.5, seventhTerm: 0 }))
      .toBe("myEv 12  theirEv -3.5  seventhTerm 0");
  });
});

describe("pauseKeyAction over the Car select panel (PG74)", () => {
  it("backs Car select out to the menu without touching pause", () => {
    expect(pauseKeyAction("cars", "DIV")).toBe("back-to-menu");
  });

  it("still ignores P while focus is in one of its many form controls", () => {
    // Six seats means six chassis selects and eighteen weapon selects: picking "Pepperbox" with the
    // keyboard must never toggle pause out from under the user.
    expect(pauseKeyAction("cars", "SELECT")).toBe("ignore");
    expect(pauseKeyAction("cars", "INPUT")).toBe("ignore");
  });
});
