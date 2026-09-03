import { describe, expect, it } from "vitest";
import { activeCarIds, type InputMessage } from "@motor-combat-moba/shared";
import {
  isActiveInput,
  isIdleWarningDue,
  isPracticeIdle,
  resolveOpponentCar,
  shouldRefusePractice,
  shouldRefusePracticeForPlayground,
} from "./practice-rules.js";

const neutral: InputMessage = { seq: 1, steer: 0, throttle: 0, fireSlots: 0 };

describe("shouldRefusePractice", () => {
  it("admits a join while under the cap", () => {
    expect(shouldRefusePractice([{}, {}], 6)).toBe(false);
  });

  it("refuses at the cap, not one past it", () => {
    expect(shouldRefusePractice([{}, {}, {}, {}, {}, {}], 6)).toBe(true);
  });

  it("admits the first room", () => {
    expect(shouldRefusePractice([], 6)).toBe(false);
  });

  it("refuses everything at a cap of zero", () => {
    expect(shouldRefusePractice([], 0)).toBe(true);
  });
});

// The mirror of `shouldRefusePlayground` (PR10): an open playground writes through the same
// process-wide tuning store, so it must block a practice room from opening under its overrides too.
describe("shouldRefusePracticeForPlayground", () => {
  it("opens when no playground is listed", () => {
    expect(shouldRefusePracticeForPlayground([])).toBe(false);
  });

  it("opens when the playground is listed but empty", () => {
    expect(shouldRefusePracticeForPlayground([{ clients: 0 }])).toBe(false);
  });

  it("refuses while anyone sits in the playground", () => {
    expect(shouldRefusePracticeForPlayground([{ clients: 1 }])).toBe(true);
  });
});

describe("resolveOpponentCar", () => {
  it("passes an explicit chassis through untouched", () => {
    expect(resolveOpponentCar("bastion", () => 0.99)).toBe("bastion");
  });

  it("resolves random to an ACTIVE chassis (PR15)", () => {
    const active = activeCarIds();
    for (const roll of [0, 0.34, 0.5, 0.99]) {
      expect(active).toContain(resolveOpponentCar("random", () => roll));
    }
  });

  it("never lands out of range on a roll of exactly 1", () => {
    expect(activeCarIds()).toContain(resolveOpponentCar("random", () => 1));
  });
});

describe("isPracticeIdle", () => {
  it("is not idle before the timeout", () => {
    expect(isPracticeIdle(0, 299_000, 300)).toBe(false);
  });

  it("is idle at the timeout", () => {
    expect(isPracticeIdle(0, 300_000, 300)).toBe(true);
  });

  it("measures wall clock, so a frozen sim still ages (PR27)", () => {
    // No sim tick is involved at all: this is the whole point of the wall-clock decision.
    expect(isPracticeIdle(1_000, 302_000, 300)).toBe(true);
  });
});

// The client sends one InputMessage per sim tick unconditionally (30/s), whether or not the player
// touched anything — so "an input arrived" proves nothing about presence. Only a non-neutral one does.
describe("isActiveInput", () => {
  it("is not active on the all-neutral input a parked car sends every tick", () => {
    expect(isActiveInput(neutral)).toBe(false);
  });

  it("is active on steer alone, either direction", () => {
    expect(isActiveInput({ ...neutral, steer: 1 })).toBe(true);
    expect(isActiveInput({ ...neutral, steer: -1 })).toBe(true);
  });

  it("is active on throttle alone, either direction", () => {
    expect(isActiveInput({ ...neutral, throttle: 1 })).toBe(true);
    expect(isActiveInput({ ...neutral, throttle: -1 })).toBe(true);
  });

  it("is active on a fire mask alone", () => {
    expect(isActiveInput({ ...neutral, fireSlots: 1 })).toBe(true);
  });

  it("is active on combinations of the three fields", () => {
    expect(isActiveInput({ ...neutral, steer: 1, throttle: -1 })).toBe(true);
    expect(isActiveInput({ ...neutral, steer: 1, fireSlots: 2 })).toBe(true);
    expect(isActiveInput({ ...neutral, steer: 1, throttle: 1, fireSlots: 4 })).toBe(true);
  });
});

describe("isIdleWarningDue", () => {
  it("is not due with more than the warning window left", () => {
    expect(isIdleWarningDue(0, 239_000, 300, 60)).toBe(false);
  });

  it("is due once the remaining time drops to the warning window", () => {
    expect(isIdleWarningDue(0, 240_000, 300, 60)).toBe(true);
  });

  it("stays due right up to the close, so a late tick never skips it", () => {
    expect(isIdleWarningDue(0, 299_000, 300, 60)).toBe(true);
  });
});
