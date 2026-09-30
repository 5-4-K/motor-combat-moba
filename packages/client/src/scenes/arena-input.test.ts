import { describe, expect, it } from "vitest";
import { InputClock, axisOf, type DueTicks } from "./arena-input.js";

function spyScheduler(): DueTicks & { slacks: Array<number | undefined> } {
  const slacks: Array<number | undefined> = [];
  return {
    slacks,
    due(_now, _frame, slack) {
      slacks.push(slack);
      return [];
    },
  };
}

describe("InputClock (NR21 slack, once per snapshot)", () => {
  it("passes a snapshot's slack to the scheduler once, then undefined on every other frame", () => {
    const spy = spyScheduler();
    const clock = new InputClock(spy);
    clock.due(0, 7);
    clock.onSnapshot(2.5);
    clock.due(7, 7);
    clock.due(14, 7);
    clock.due(21, 7);
    clock.onSnapshot(1.25);
    clock.due(28, 7);
    clock.due(35, 7);
    expect(spy.slacks).toEqual([undefined, 2.5, undefined, undefined, 1.25, undefined]);
  });

  it("keeps only the newest of several snapshots between two frames", () => {
    const spy = spyScheduler();
    const clock = new InputClock(spy);
    clock.onSnapshot(3);
    clock.onSnapshot(1);
    clock.due(0, 16);
    clock.due(16, 16);
    expect(spy.slacks).toEqual([1, undefined]);
  });

  it("drops a pending sample on a frame that does not send, rather than holding it", () => {
    const spy = spyScheduler();
    const clock = new InputClock(spy);
    clock.onSnapshot(4);
    clock.discard();
    clock.due(0, 16);
    expect(spy.slacks).toEqual([undefined]);
  });
});

describe("axisOf", () => {
  it("maps a single held key to its direction", () => {
    expect(axisOf(false, true)).toBe(1);
    expect(axisOf(true, false)).toBe(-1);
  });

  it("is neutral when neither or both keys are held", () => {
    expect(axisOf(false, false)).toBe(0);
    // Both down is deliberately 0, not last-key-wins.
    expect(axisOf(true, true)).toBe(0);
  });
});
