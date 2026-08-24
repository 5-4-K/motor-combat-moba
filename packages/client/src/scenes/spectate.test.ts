import { describe, expect, it } from "vitest";
import { PlayerStatus } from "@motor-arena/shared";
import {
  cycleSpectate,
  panFreeCam,
  resolveSpectateTarget,
  spectatableIds,
  type SpectateCandidate,
} from "./spectate.js";

function candidate(sessionId: string, over: Partial<SpectateCandidate> = {}): SpectateCandidate {
  return { sessionId, status: PlayerStatus.IN_MATCH, alive: true, ...over };
}

describe("spectatableIds", () => {
  it("lists the living players in the match", () => {
    expect(spectatableIds([candidate("a"), candidate("b")])).toEqual(["a", "b"]);
  });

  it("leaves out wrecks", () => {
    expect(spectatableIds([candidate("a", { alive: false }), candidate("b")])).toEqual(["b"]);
  });

  it("leaves out players who are not in the match", () => {
    expect(
      spectatableIds([candidate("a", { status: PlayerStatus.READY }), candidate("b")]),
    ).toEqual(["b"]);
    expect(
      spectatableIds([candidate("a", { status: PlayerStatus.POST_MATCH }), candidate("b")]),
    ).toEqual(["b"]);
  });

  it("sorts, so the cycle order does not depend on join order", () => {
    expect(spectatableIds([candidate("z"), candidate("a"), candidate("m")])).toEqual([
      "a",
      "m",
      "z",
    ]);
  });

  it("is empty when nobody is left alive", () => {
    expect(spectatableIds([candidate("a", { alive: false })])).toEqual([]);
  });
});

describe("cycleSpectate", () => {
  const ids = ["a", "b", "c"];

  it("steps forward", () => {
    expect(cycleSpectate(ids, "a", 1)).toBe("b");
  });

  it("steps backward", () => {
    expect(cycleSpectate(ids, "b", -1)).toBe("a");
  });

  it("wraps past the end", () => {
    expect(cycleSpectate(ids, "c", 1)).toBe("a");
  });

  it("wraps past the start rather than indexing with a negative", () => {
    expect(cycleSpectate(ids, "a", -1)).toBe("c");
  });

  it("restarts the cycle when the current target is gone", () => {
    expect(cycleSpectate(ids, "gone", 1)).toBe("a");
  });

  it("returns nothing to watch for an empty cycle", () => {
    expect(cycleSpectate([], "a", 1)).toBe("");
  });

  it("stays put in a one-player cycle", () => {
    expect(cycleSpectate(["a"], "a", 1)).toBe("a");
    expect(cycleSpectate(["a"], "a", -1)).toBe("a");
  });
});

describe("resolveSpectateTarget", () => {
  it("keeps a target that is still alive", () => {
    expect(resolveSpectateTarget(["a", "b"], "b")).toBe("b");
  });

  it("falls to the front of the cycle when the target dies", () => {
    expect(resolveSpectateTarget(["a", "b"], "c")).toBe("a");
  });

  it("yields nothing when nobody is left", () => {
    expect(resolveSpectateTarget([], "a")).toBe("");
  });
});

describe("panFreeCam", () => {
  it("moves at the given speed per second, not per frame", () => {
    expect(panFreeCam({ x: 0, y: 0 }, 1, 0, 1000, 600)).toEqual({ x: 600, y: 0 });
    expect(panFreeCam({ x: 0, y: 0 }, 1, 0, 500, 600)).toEqual({ x: 300, y: 0 });
  });

  it("covers the same ground per second at any frame rate", () => {
    const at60 = panFreeCam({ x: 0, y: 0 }, 1, 0, 1000 / 60, 600).x * 60;
    const at144 = panFreeCam({ x: 0, y: 0 }, 1, 0, 1000 / 144, 600).x * 144;
    expect(at60).toBeCloseTo(at144, 6);
  });

  it("pans both axes", () => {
    expect(panFreeCam({ x: 10, y: 20 }, -1, 1, 1000, 100)).toEqual({ x: -90, y: 120 });
  });

  it("stands still on no input", () => {
    expect(panFreeCam({ x: 10, y: 20 }, 0, 0, 1000, 600)).toEqual({ x: 10, y: 20 });
  });

  it("does not mutate the focus it was given", () => {
    const focus = { x: 10, y: 20 };
    panFreeCam(focus, 1, 1, 1000, 600);
    expect(focus).toEqual({ x: 10, y: 20 });
  });
});
