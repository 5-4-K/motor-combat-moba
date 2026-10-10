import { describe, expect, it } from "vitest";
import { debugLine } from "./overlay.js";
import { pauseKeyAction } from "./ui-model.js";

describe("debugLine (BB55)", () => {
  it("prints the one-line read-out", () => {
    expect(debugLine({ tick: 1, situation: "fight", targetSessionId: "t", goalRange: 300, goalFacing: "orbit", firedSlot: 1, bestHitChance: 0.72, hitChanceBar: 0.7, steer: -1, throttle: 1 }))
      .toBe("fight | range 300 orbit | slot 1 | hit 0.72/0.70 | drive(-1,+1)");
    // The FIRE slot itself: abilities read 1/2/3 (LMB/RMB/SPACE), the basic attack (Q) reads 0.
    expect(debugLine({ tick: 1, situation: "fight", targetSessionId: "t", goalRange: 300, goalFacing: "orbit", firedSlot: 3, bestHitChance: 0.72, hitChanceBar: 0.7, steer: 0, throttle: 0 }))
      .toContain("| slot 3 |");
    expect(debugLine({ tick: 1, situation: "fight", targetSessionId: "t", goalRange: 300, goalFacing: "orbit", firedSlot: 0, bestHitChance: 0.72, hitChanceBar: 0.7, steer: 0, throttle: 0 }))
      .toContain("| slot 0 |");
    expect(debugLine({ tick: 1, situation: "waitOut", targetSessionId: "", goalRange: 0, goalFacing: "nose", firedSlot: -1, bestHitChance: 0, hitChanceBar: 0.7, steer: 0, throttle: 1 }))
      .toContain("slot -");
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
