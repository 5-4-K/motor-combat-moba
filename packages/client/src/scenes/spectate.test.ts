import { describe, expect, it } from "vitest";
import { PlayerStatus, RoomPhase } from "@motor-combat-moba/shared";
import {
  cycleSpectate,
  isSpectating,
  panFreeCam,
  resolveSpectateTarget,
  smoothFollow,
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

describe("isSpectating", () => {
  it("is true for a wreck in a live match", () => {
    expect(isSpectating(RoomPhase.MATCH, PlayerStatus.IN_MATCH, false)).toBe(true);
  });

  it("is false while still alive", () => {
    expect(isSpectating(RoomPhase.MATCH, PlayerStatus.IN_MATCH, true)).toBe(false);
  });

  it("is false during the countdown, even though the car cannot move yet", () => {
    // The bug this pins: gating the camera on "cannot drive" instead of "is dead" made the 3-2-1
    // follow whichever car sorted first by session id rather than the player's own.
    expect(isSpectating(RoomPhase.COUNTDOWN, PlayerStatus.IN_MATCH, true)).toBe(false);
    expect(isSpectating(RoomPhase.COUNTDOWN, PlayerStatus.IN_MATCH, false)).toBe(false);
  });

  it("is false in the lobby and car select", () => {
    expect(isSpectating(RoomPhase.LOBBY, PlayerStatus.IN_MATCH, false)).toBe(false);
    expect(isSpectating(RoomPhase.CAR_SELECT, PlayerStatus.IN_MATCH, false)).toBe(false);
  });

  it("is false for someone who is not in the match at all", () => {
    expect(isSpectating(RoomPhase.MATCH, PlayerStatus.READY, false)).toBe(false);
    expect(isSpectating(RoomPhase.MATCH, PlayerStatus.POST_MATCH, false)).toBe(false);
  });
});

describe("smoothFollow", () => {
  const REF_FRAME_MS = 1000 / 60;

  /**
   * Distance still separating focus from a stationary target after `ms` of following at `fps`.
   * Frame count is derived rather than accumulated: summing `dt` drifts by an ULP and silently
   * buys the slower rate an extra frame, which reads as a real difference in decay.
   */
  function gapAfter(ms: number, fps: number, camLerp: number): number {
    const dt = 1000 / fps;
    const frames = Math.round(ms / dt);
    let focus = { x: 0, y: 0 };
    for (let i = 0; i < frames; i++) {
      focus = smoothFollow(focus, { x: 100, y: 0 }, camLerp, dt);
    }
    return 100 - focus.x;
  }

  /** Steady-state trailing offset behind a target moving at `speed` world units per second. */
  function settledLag(fps: number, speed: number, camLerp: number): number {
    const dt = 1000 / fps;
    let focus = { x: 0, y: 0 };
    let target = 0;
    for (let i = 0; i < fps * 5; i++) {
      target += (speed * dt) / 1000;
      focus = smoothFollow(focus, { x: target, y: 0 }, camLerp, dt);
    }
    return target - focus.x;
  }

  it("closes camLerp of the gap on a 60 Hz frame, leaving that rate's tuned feel unchanged", () => {
    expect(smoothFollow({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.18, REF_FRAME_MS).x).toBeCloseTo(18, 9);
  });

  it("closes the same fraction of a gap per second at any frame rate", () => {
    // The exact property: decay over equal *elapsed time* must match, however that time is sliced
    // into frames. This is what a per-frame constant gets wrong.
    expect(gapAfter(1000, 60, 0.18)).toBeCloseTo(gapAfter(1000, 144, 0.18), 6);
    expect(gapAfter(500, 30, 0.18)).toBeCloseTo(gapAfter(500, 240, 0.18), 6);
  });

  it("trails a moving car by the same distance at 60 and 144 Hz", () => {
    // A per-frame constant trails 75 units at 60 Hz and 31 at 144 — a 44-unit difference in how
    // much road ahead each player sees. Time-based smoothing leaves only the sub-frame sampling
    // difference, which is a couple of units.
    const at60 = settledLag(60, 540, 0.18);
    const at144 = settledLag(144, 540, 0.18);
    expect(at60).toBeGreaterThan(0);
    expect(Math.abs(at60 - at144)).toBeLessThan(5);
  });

  it("pulls both axes toward the target", () => {
    const out = smoothFollow({ x: 0, y: 100 }, { x: 100, y: 0 }, 0.5, REF_FRAME_MS);
    expect(out.x).toBeCloseTo(50, 9);
    expect(out.y).toBeCloseTo(50, 9);
  });

  it("stays put when it is already on the target", () => {
    expect(smoothFollow({ x: 7, y: 9 }, { x: 7, y: 9 }, 0.18, REF_FRAME_MS)).toEqual({ x: 7, y: 9 });
  });

  it("does not mutate the focus it was given", () => {
    const focus = { x: 10, y: 20 };
    smoothFollow(focus, { x: 999, y: 999 }, 0.18, REF_FRAME_MS);
    expect(focus).toEqual({ x: 10, y: 20 });
  });
});
