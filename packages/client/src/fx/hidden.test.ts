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

describe("carryHiddenInstances — ArenaScene.fxHidden's own usage contract (I1 re-review)", () => {
  /**
   * Mirrors `ArenaScene.fxHidden` exactly: the caller must feed THIS FRAME's own (uncarried) hidden
   * set back in as next frame's `prevHidden`, never the carried result — otherwise a vanished id
   * would be re-added forever (never falls out of `currentIds` again once its instance is gone), and
   * `lastHiddenInstances` would grow for the rest of the match instead of forgetting it after the one
   * frame it was needed for.
   */
  function fxHiddenFrame(
    lastHidden: ReadonlySet<string>,
    currentIds: ReadonlySet<string>,
    currentHidden: ReadonlySet<string>,
  ): { carried: Set<string>; nextLastHidden: Set<string> } {
    return {
      carried: carryHiddenInstances(lastHidden, currentIds, currentHidden),
      nextLastHidden: new Set(currentHidden),
    };
  }

  it("carries a vanished id for exactly one frame, then forgets it", () => {
    let lastHidden = new Set<string>();

    // Frame 1: "s1" is hidden and still in the world.
    const f1 = fxHiddenFrame(lastHidden, new Set(["s1"]), new Set(["s1"]));
    expect(f1.carried).toEqual(new Set(["s1"]));
    lastHidden = f1.nextLastHidden;

    // Frame 2: "s1"'s instance was deleted this tick, same tick it died — gone from the world and
    // from this frame's own hidden set — but it must still be carried, so its shotEnded is hidden.
    const f2 = fxHiddenFrame(lastHidden, new Set(), new Set());
    expect(f2.carried).toEqual(new Set(["s1"]));
    lastHidden = f2.nextLastHidden;

    // Frame 3: nothing hidden last frame (frame 2 fed forward its OWN hidden set — empty — not the
    // carried one), so "s1" must NOT be re-added; carrying it here would be the unbounded-growth bug.
    const f3 = fxHiddenFrame(lastHidden, new Set(), new Set());
    expect(f3.carried).toEqual(new Set());
  });

  it("never re-adds a vanished id across many further frames (no unbounded growth)", () => {
    let lastHidden = new Set(["s1"]);
    // Simulate feeding the carried set back in by mistake for one frame, then correctly for the rest
    // — the fix under review reads `this.lastHiddenInstances = instances`, not `= carried`, so after
    // the one legitimate carry frame every later frame's `prevHidden` must be an empty raw set.
    const f1 = fxHiddenFrame(lastHidden, new Set(), new Set());
    expect(f1.carried).toEqual(new Set(["s1"])); // the one frame it is owed
    lastHidden = f1.nextLastHidden; // = new Set(currentHidden) = empty, NOT f1.carried
    expect(lastHidden.size).toBe(0);

    for (let frame = 0; frame < 50; frame++) {
      const f = fxHiddenFrame(lastHidden, new Set(), new Set());
      expect(f.carried.size).toBe(0);
      lastHidden = f.nextLastHidden;
      expect(lastHidden.size).toBe(0);
    }
  });
});
