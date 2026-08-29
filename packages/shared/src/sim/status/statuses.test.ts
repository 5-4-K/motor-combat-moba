import { describe, expect, it } from "vitest";
import { STATUS_CONFIG, STATUS_IDS, statusDefOf } from "../../config/status-config.js";
import { statusPulseTicksOf } from "../../config/status-ticks.js";
import type { StatusId } from "../../config/status-types.js";
import {
  applyStatus,
  clearStatuses,
  expireStatuses,
  hasStatus,
  modifiersFromRows,
  newStatusState,
  remainingTicks,
  statusPulses,
  toActiveStatuses,
} from "./statuses.js";

const REFRESHING: StatusId = "overheated";
const IGNORING: StatusId = "stunned";
const BLEEDING: StatusId = "spiked";
const HEALING: StatusId = "fortified";
const CLEANSING: StatusId = "overhauled";

describe("applyStatus", () => {
  it("runs for exactly the duration the applier asked for, not one from the table", () => {
    const after = applyStatus(newStatusState(), REFRESHING, 100, 45);
    expect(after).toHaveLength(1);
    expect(after[0]!.statusId).toBe(REFRESHING);
    expect(after[0]!.startTick).toBe(100);
    expect(after[0]!.endsTick).toBe(145);
  });

  it("lets two appliers give the same status different lengths", () => {
    expect(applyStatus(newStatusState(), REFRESHING, 0, 20)[0]!.endsTick).toBe(20);
    expect(applyStatus(newStatusState(), REFRESHING, 0, 90)[0]!.endsTick).toBe(90);
  });

  it("never mutates the list it is given", () => {
    const before = newStatusState();
    applyStatus(before, REFRESHING, 0, 30);
    expect(before).toHaveLength(0);
  });

  it("refuses a non-positive or non-finite duration rather than clamping it to a tick", () => {
    expect(applyStatus(newStatusState(), REFRESHING, 0, 0)).toHaveLength(0);
    expect(applyStatus(newStatusState(), REFRESHING, 0, -5)).toHaveLength(0);
    expect(applyStatus(newStatusState(), REFRESHING, 0, Number.NaN)).toHaveLength(0);
  });

  it("records the source, and `` for the world itself", () => {
    expect(applyStatus(newStatusState(), REFRESHING, 0, 10, "shooter")[0]!.sourceSessionId).toBe("shooter");
    expect(applyStatus(newStatusState(), REFRESHING, 0, 10)[0]!.sourceSessionId).toBe("");
  });

  it("`refresh` extends the clock", () => {
    const first = applyStatus(newStatusState(), REFRESHING, 0, 30);
    const second = applyStatus(first, REFRESHING, 10, 30);
    expect(second).toHaveLength(1);
    expect(second[0]!.endsTick).toBe(40);
  });

  it("`refresh` NEVER shortens — a weak short source cannot cut a long one down", () => {
    const long = applyStatus(newStatusState(), REFRESHING, 0, 100);
    const short = applyStatus(long, REFRESHING, 10, 5);
    expect(short[0]!.endsTick).toBe(100);
  });

  it("`refresh` keeps the original startTick, so its pulse cadence is not restarted", () => {
    const first = applyStatus(newStatusState(), BLEEDING, 0, 60);
    const again = applyStatus(first, BLEEDING, 17, 60);
    expect(again[0]!.startTick).toBe(0);
    expect(again[0]!.endsTick).toBe(77);
  });

  it("`ignore` refuses to re-apply while running — not even the clock moves", () => {
    const first = applyStatus(newStatusState(), IGNORING, 0, 30);
    const again = applyStatus(first, IGNORING, 5, 90);
    expect(again[0]!.endsTick).toBe(30);
  });

  it("`ignore` re-arms once its own clock has run out", () => {
    const first = applyStatus(newStatusState(), IGNORING, 0, 30);
    const again = applyStatus(first, IGNORING, 30, 30);
    expect(again[0]!.endsTick).toBe(60);
    expect(again[0]!.startTick).toBe(30);
  });

  it("caps live statuses, dropping the NEW id rather than evicting a running one", () => {
    const ids = STATUS_IDS.filter((id) => statusDefOf(id).onApply === undefined);
    expect(ids.length).toBeGreaterThan(0);

    let state = newStatusState();
    for (const id of ids) state = applyStatus(state, id, 0, 500);
    const atCap = Math.min(ids.length, STATUS_CONFIG.maxActive);
    expect(state).toHaveLength(atCap);
  });

  it("keeps the list sorted by statusId, whatever order they arrived in", () => {
    const forwards: StatusId[] = ["spiked", "corroded", "fortified"];
    const a = forwards.reduce((s, id) => applyStatus(s, id, 0, 50), newStatusState());
    const b = [...forwards].reverse().reduce((s, id) => applyStatus(s, id, 0, 50), newStatusState());
    expect(a.map((x) => x.statusId)).toEqual(b.map((x) => x.statusId));
    expect(a.map((x) => x.statusId)).toEqual([...forwards].sort());
  });
});

describe("onApply cleanse", () => {
  it("strips every running debuff", () => {
    let state = applyStatus(newStatusState(), BLEEDING, 0, 200);
    state = applyStatus(state, REFRESHING, 0, 200);
    state = applyStatus(state, HEALING, 0, 200);

    const after = applyStatus(state, CLEANSING, 10, 30);
    expect(hasStatus(after, BLEEDING, 10)).toBe(false);
    expect(hasStatus(after, REFRESHING, 10)).toBe(false);
    // Buffs survive: this cleanses one kind, not everything.
    expect(hasStatus(after, HEALING, 10)).toBe(true);
    expect(hasStatus(after, CLEANSING, 10)).toBe(true);
  });

  it("never cleanses itself away", () => {
    const after = applyStatus(newStatusState(), CLEANSING, 0, 30);
    expect(hasStatus(after, CLEANSING, 0)).toBe(true);
  });

  it("stops a bleed but gives back no hp — it removes statuses, it does not heal", () => {
    // The cleanse's whole contract, and the reason it can be generous: after it, the bleed produces
    // no more pulses, and nothing anywhere hands hp back.
    let state = applyStatus(newStatusState(), BLEEDING, 0, 300);
    const interval = statusPulseTicksOf(BLEEDING);
    expect(statusPulses(state, interval)).toHaveLength(1);

    state = applyStatus(state, CLEANSING, 1, 30);
    expect(statusPulses(state, interval)).toHaveLength(0);
    expect(statusPulses(state, interval * 2)).toHaveLength(0);
  });

  it("frees a capped car's slots, so a repair is never refused for being full", () => {
    const debuffs = STATUS_IDS.filter((id) => statusDefOf(id).kind === "debuff");
    let state = newStatusState();
    for (const id of debuffs) state = applyStatus(state, id, 0, 500);
    const after = applyStatus(state, CLEANSING, 1, 30);
    expect(hasStatus(after, CLEANSING, 1)).toBe(true);
    for (const id of debuffs) expect(hasStatus(after, id, 1)).toBe(false);
  });
});

describe("expireStatuses", () => {
  it("keeps a status through the tick before its endsTick and drops it ON that tick", () => {
    const state = applyStatus(newStatusState(), REFRESHING, 0, 30);
    expect(expireStatuses(state, 29)).toHaveLength(1);
    expect(expireStatuses(state, 30)).toHaveLength(0);
  });

  it("returns the same array reference when nothing expired, so a no-op writes no patch", () => {
    const state = applyStatus(newStatusState(), REFRESHING, 0, 30);
    expect(expireStatuses(state, 1)).toBe(state);
  });

  it("drops only what has lapsed", () => {
    let state = applyStatus(newStatusState(), IGNORING, 0, 10);
    state = applyStatus(state, REFRESHING, 0, 90);
    expect(expireStatuses(state, 10).map((s) => s.statusId)).toEqual([REFRESHING]);
  });
});

describe("statusPulses", () => {
  it("fires one interval IN, not on the tick the status landed", () => {
    const state = applyStatus(newStatusState(), BLEEDING, 100, 300);
    const interval = statusPulseTicksOf(BLEEDING);
    expect(statusPulses(state, 100)).toHaveLength(0);
    expect(statusPulses(state, 100 + interval - 1)).toHaveLength(0);
    expect(statusPulses(state, 100 + interval)).toHaveLength(1);
  });

  it("repeats on its own cadence", () => {
    const state = applyStatus(newStatusState(), BLEEDING, 0, 300);
    const interval = statusPulseTicksOf(BLEEDING);
    for (const n of [1, 2, 3, 7]) expect(statusPulses(state, interval * n)).toHaveLength(1);
    expect(statusPulses(state, interval * 2 + 1)).toHaveLength(0);
  });

  it("is anchored to its own startTick, so two cars hit a tick apart bleed a tick apart", () => {
    const interval = statusPulseTicksOf(BLEEDING);
    const early = applyStatus(newStatusState(), BLEEDING, 0, 300);
    const late = applyStatus(newStatusState(), BLEEDING, 1, 300);
    expect(statusPulses(early, interval)).toHaveLength(1);
    expect(statusPulses(late, interval)).toHaveLength(0);
    expect(statusPulses(late, interval + 1)).toHaveLength(1);
  });

  it("stops on the tick the status expires", () => {
    const interval = statusPulseTicksOf(BLEEDING);
    const state = applyStatus(newStatusState(), BLEEDING, 0, interval * 2);
    expect(statusPulses(state, interval)).toHaveLength(1);
    expect(statusPulses(state, interval * 2)).toHaveLength(0);
  });

  it("reports the row's authored amount and its source, and never both directions at once", () => {
    const bleed = statusPulses(applyStatus(newStatusState(), BLEEDING, 0, 300, "a"), statusPulseTicksOf(BLEEDING))[0]!;
    expect(bleed.damage).toBe(statusDefOf(BLEEDING).pulse!.damage);
    expect(bleed.heal).toBe(0);
    expect(bleed.sourceSessionId).toBe("a");

    const repair = statusPulses(applyStatus(newStatusState(), HEALING, 0, 300), statusPulseTicksOf(HEALING))[0]!;
    expect(repair.heal).toBe(statusDefOf(HEALING).pulse!.heal);
    expect(repair.damage).toBe(0);
  });

  it("says nothing for a status with no pulse", () => {
    const state = applyStatus(newStatusState(), REFRESHING, 0, 300);
    for (let tick = 1; tick < 60; tick++) expect(statusPulses(state, tick)).toHaveLength(0);
  });
});

describe("toActiveStatuses", () => {
  it("drops an unrecognised id rather than defaulting it", () => {
    expect(toActiveStatuses([{ statusId: "nope", startTick: 0, endsTick: 99 }])).toEqual([]);
    // The prototype-chain hole `isStatusId` exists to close.
    expect(toActiveStatuses([{ statusId: "constructor", startTick: 0, endsTick: 99 }])).toEqual([]);
  });

  it("drops a row with a non-finite tick", () => {
    expect(toActiveStatuses([{ statusId: REFRESHING, startTick: 0, endsTick: Number.NaN }])).toEqual([]);
    expect(toActiveStatuses([{ statusId: REFRESHING, startTick: Number.NaN, endsTick: 9 }])).toEqual([]);
  });

  it("defaults a missing source to the world", () => {
    expect(toActiveStatuses([{ statusId: REFRESHING, startTick: 0, endsTick: 9 }])[0]!.sourceSessionId).toBe("");
  });
});

describe("clearStatuses, hasStatus and remainingTicks", () => {
  it("clearStatuses leaves nothing", () => {
    expect(clearStatuses()).toHaveLength(0);
  });

  it("hasStatus reads the same exclusive clock everything else does", () => {
    const state = applyStatus(newStatusState(), REFRESHING, 0, 30);
    expect(hasStatus(state, REFRESHING, 29)).toBe(true);
    expect(hasStatus(state, REFRESHING, 30)).toBe(false);
    expect(hasStatus(state, BLEEDING, 0)).toBe(false);
  });

  it("remainingTicks counts down to 0 and never below", () => {
    const status = applyStatus(newStatusState(), REFRESHING, 0, 30)[0]!;
    expect(remainingTicks(status, 0)).toBe(30);
    expect(remainingTicks(status, 30)).toBe(0);
    expect(remainingTicks(status, 90)).toBe(0);
  });
});

describe("modifiersFromRows", () => {
  it("is the wire path to the same answer modifiersOf gives", () => {
    const mods = modifiersFromRows([{ statusId: BLEEDING, startTick: 0, endsTick: 100 }], 0);
    expect(mods.topSpeed).toBeCloseTo(statusDefOf(BLEEDING).modifiers.topSpeed!, 10);
  });

  it("is neutral for rows the client cannot make sense of", () => {
    expect(modifiersFromRows([{ statusId: "gibberish", startTick: 0, endsTick: 100 }], 0).topSpeed).toBe(1);
  });
});
