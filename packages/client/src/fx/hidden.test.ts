import { describe, expect, it } from "vitest";
import { deriveFxEvents, type FxWorldView } from "./events.js";
import { isHiddenFxEvent, NOTHING_HIDDEN } from "./hidden.js";

const shot = (id: string, alive = true) => ({
  id, weaponId: "predator", x: 0, y: 0, angle: 0, extent: 0, isExplosion: false, alive,
});
const view = (instances: ReturnType<typeof shot>[]): FxWorldView => ({ cars: [], instances });

describe("isHiddenFxEvent (CB27)", () => {
  const hidden = { cars: new Set(["foe"]), instances: new Set(["s1"]) };
  it("hides a hidden enemy's shot events", () => {
    const [fired] = deriveFxEvents(view([]), view([shot("s1")]));
    expect(fired?.kind).toBe("shotFired");
    expect(isHiddenFxEvent(fired!, hidden)).toBe(true);
  });
  it("hides damage and death at a hidden car", () => {
    expect(isHiddenFxEvent({ kind: "damaged", sessionId: "foe", x: 0, y: 0, amount: 5 }, hidden)).toBe(true);
    expect(isHiddenFxEvent({ kind: "died", sessionId: "foe", x: 0, y: 0 }, hidden)).toBe(true);
  });
  it("keeps everything else", () => {
    expect(isHiddenFxEvent({ kind: "damaged", sessionId: "me", x: 0, y: 0, amount: 5 }, hidden)).toBe(false);
    const [fired] = deriveFxEvents(view([]), view([shot("s2")]));
    expect(isHiddenFxEvent(fired!, hidden)).toBe(false);
    expect(isHiddenFxEvent(fired!, NOTHING_HIDDEN)).toBe(false);
  });
  it("a shot that becomes visible mid-flight fires no muzzle flash (Review Focus 5)", () => {
    // Derivation sees the full world, so the shot is not "new" on the frame it enters vision.
    const events = deriveFxEvents(view([shot("s1")]), view([shot("s1")]));
    expect(events.filter((e) => e.kind === "shotFired")).toHaveLength(0);
  });
});
