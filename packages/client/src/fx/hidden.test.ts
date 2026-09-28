import { describe, expect, it } from "vitest";
import { deriveFxEvents, type FxWorldView } from "./events.js";
import { carryHiddenInstances, isHiddenFxEvent, NOTHING_HIDDEN } from "./hidden.js";

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

describe("carryHiddenInstances (I1, CB27)", () => {
  it("carries forward an id that was hidden last frame and is now gone from the world", () => {
    const prevHidden = new Set(["s1"]);
    const currentIds = new Set<string>(); // s1 was deleted this tick, same tick it died
    const currentHidden = new Set<string>();
    expect(carryHiddenInstances(prevHidden, currentIds, currentHidden)).toEqual(new Set(["s1"]));
  });
  it("does not carry an id that is still present in the world, hidden or not", () => {
    const prevHidden = new Set(["s1"]);
    const currentIds = new Set(["s1"]);
    expect(carryHiddenInstances(prevHidden, currentIds, new Set())).toEqual(new Set());
    expect(carryHiddenInstances(prevHidden, currentIds, new Set(["s1"]))).toEqual(new Set(["s1"]));
  });
  it("keeps this frame's own hidden ids alongside a carried one", () => {
    const result = carryHiddenInstances(new Set(["s1"]), new Set(["s2"]), new Set(["s2"]));
    expect(result).toEqual(new Set(["s1", "s2"]));
  });
  it("carries nothing forward when nothing was hidden last frame", () => {
    expect(carryHiddenInstances(new Set(), new Set(), new Set())).toEqual(new Set());
  });
});
