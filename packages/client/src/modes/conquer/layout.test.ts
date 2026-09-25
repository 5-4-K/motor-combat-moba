import { describe, expect, it } from "vitest";
// Mode scope: shared's `withDefaultMode` lives in its test-setup and is not exported from the
// package, so this uses the public `withMode` over the default bundle — the same scope it wraps.
import { DEFAULT_GAME_MODE, modeConfigOf, withMode } from "@motor-combat-moba/shared";
import { CONTROL_PANEL_H, captureChip, conquerClockLabel, conquerGutterLayout } from "./layout.js";
import { slotBarLayout } from "../../scenes/weapon-hud.js";
import { statusStripLayout } from "../../scenes/status-hud.js";
import { HUD_GUTTER_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from "../../config/display.js";

const withDefaultMode = <T>(fn: () => T): T => withMode(modeConfigOf(DEFAULT_GAME_MODE), fn);

describe("captureChip (CQ55)", () => {
  it("reads viewer-relative", () => {
    expect(captureChip(0, 0, 30, false, 150, 30)).toStrictEqual({ text: "TAKING CONTROL · 4", tone: "ally" });
    expect(captureChip(1, 0, 30, false, 150, 30)).toStrictEqual({ text: "ENEMY CAPTURING · 4", tone: "enemy" });
    expect(captureChip(0, 0, 150, false, 150, 30)).toStrictEqual({ text: "HOLDING", tone: "ally" });
    expect(captureChip(0, 1, 150, false, 150, 30)).toStrictEqual({ text: "ENEMY HOLDING", tone: "enemy" });
    expect(captureChip(0, -1, 0, true, 150, 30)).toStrictEqual({ text: "CONTESTED", tone: "neutral" });
    expect(captureChip(0, -1, 0, false, 150, 30)).toStrictEqual({ text: "ZONE EMPTY", tone: "muted" });
  });
});

describe("conquerClockLabel (CQ54)", () => {
  it("counts down m:ss and switches to OVERTIME", () => {
    expect(conquerClockLabel(0, 5400, false, 30, 5400)).toBe("3:00");
    expect(conquerClockLabel(5400 - 30 * 134, 5400, false, 30, 5400)).toBe("2:14");
    expect(conquerClockLabel(5400, 5400, false, 30, 5400)).toBe("0:00");
    expect(conquerClockLabel(9999, 5400, true, 30, 5400)).toBe("OVERTIME");
  });

  it("shows the full match length during a countdown, before matchEndsTick is stamped", () => {
    // matchEndsTick is 0 for every tick before the edge into MATCH (CAR_SELECT/REVEAL/COUNTDOWN),
    // and counting down against 0 would misread as an elapsed clock rather than the match length.
    expect(conquerClockLabel(0, 0, false, 30, 5400)).toBe("3:00");
    // Overtime still wins even if it were somehow set during a countdown.
    expect(conquerClockLabel(0, 0, true, 30, 5400)).toBe("OVERTIME");
  });
});

describe("conquerGutterLayout (CQ54): worst case fits without overlap", () => {
  it("control panel, then status+slots, then roster at the bottom, all inside the gutter", () => {
    withDefaultMode(() => {
      const L = conquerGutterLayout(3, 3, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH);
      expect(L.slotTopInset).toBe(CONTROL_PANEL_H);
      expect(L.chip.y + L.chip.h).toBeLessThanOrEqual(CONTROL_PANEL_H);
      // 3 is the build's ability-slot count N, and the HUD shows ability slots only. If
      // ABILITY_SLOTS is raised, this test is expected to fail loudly (CQ54): the Conquer gutter's
      // vertical budget was sized for three slots and has to be re-planned, not squeezed.
      const slots = slotBarLayout(3, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, L.slotTopInset);
      const strip = statusStripLayout(99, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, slots[0]!.y);
      expect(strip[0]!.y).toBeGreaterThanOrEqual(CONTROL_PANEL_H); // badges clear the panel
      const lastSlot = slots.at(-1)!;
      expect(lastSlot.nameY + 14).toBeLessThan(L.roster.top); // slot name line clears the roster
      const lastRow = L.roster.rows.at(-1)!;
      expect(lastRow.centerY + 9).toBeLessThanOrEqual(VIEW_HEIGHT); // nothing past the bottom
      for (const p of [L.clock, ...L.roster.headers, ...L.roster.rows]) {
        expect(p.x).toBeGreaterThanOrEqual(VIEW_WIDTH - HUD_GUTTER_WIDTH);
        expect(p.x).toBeLessThan(VIEW_WIDTH);
      }
      expect(L.roster.rows).toHaveLength(6);
      expect(L.roster.headers[0]!.y).toBeLessThan(L.roster.rows[0]!.centerY);
      expect(L.roster.headers[1]!.y).toBeGreaterThan(L.roster.rows[2]!.centerY);
    });
  });
});
