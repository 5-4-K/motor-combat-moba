import { describe, expect, it } from "vitest";
import { activeCarIds } from "@motor-combat-moba/shared";
import {
  isIdleWarningDue,
  isPracticeIdle,
  resolveOpponentCar,
  shouldRefusePractice,
} from "./practice-rules.js";

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
