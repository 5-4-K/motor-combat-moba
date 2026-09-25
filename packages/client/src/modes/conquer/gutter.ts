import type Phaser from "phaser";
import type { Room } from "colyseus.js";
import { TICK_RATE_HZ, controlPercentText, derived, type ArenaState } from "@motor-combat-moba/shared";
import { HUD_GUTTER_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from "../../config/display.js";
import { respawnSeconds } from "../../scenes/match-hud.js";
import {
  ROSTER_DEAD_SWATCH_ALPHA,
  ROSTER_DEAD_TEXT,
  ROSTER_LIVE_TEXT,
  rosterRows,
} from "../../scenes/roster-panel.js";
import type { GutterHost, ModeGutter } from "../types.js";
import {
  CONQUER_ALLY_HEADER,
  CONQUER_ALLY_LABEL,
  CONQUER_BAR_TRACK_ALPHA,
  CONQUER_CHIP_FILL_ALPHA,
  CONQUER_CHIP_FONT_PX,
  CONQUER_CLOCK_FONT_PX,
  CONQUER_ENEMY_HEADER,
  CONQUER_ENEMY_LABEL,
  CONQUER_LABEL_FONT_PX,
  captureChip,
  chipToneColor,
  conquerClockLabel,
  conquerGutterLayout,
  conquerRosterName,
  controlFillFraction,
  cssOf,
} from "./layout.js";

/**
 * Conquer's gutter (CQ54): the control panel at the top — clock, ally and enemy control bars with
 * their percentages, the capture chip — and the roster grouped by team at the bottom. `render`
 * returns the slot stack's `topInset`, in the role `ArenaScene`'s `renderRosterPanel` height plays
 * in every other mode.
 *
 * Built by `CONQUER_HUD.createGutter` once per arena entry, where the scene pools its other gutter
 * texts, and destroyed with them; `objects()` is what `splitCameras` routes to the HUD camera. Only
 * `import type` from Phaser, so a Node test can drive it against stub texts.
 */
export class ConquerGutter implements ModeGutter {
  private texts: Phaser.GameObjects.Text[] = [];
  private readonly hud: {
    readonly clock: Phaser.GameObjects.Text;
    readonly labels: readonly [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
    readonly percents: readonly [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
    readonly chip: Phaser.GameObjects.Text;
    readonly headers: readonly [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  };

  constructor(private readonly host: GutterHost) {
    // Conquer's panel texts (CQ54), pooled up front like every other gutter text. Every colour that
    // never changes is set here once; only the chip's carries state, and it is guarded where it is
    // set.
    const conquerText = (fontPx: number, ox: number, oy: number): Phaser.GameObjects.Text => {
      const text = host.addText(fontPx, ox, oy);
      this.texts.push(text);
      return text;
    };
    const allyCss = cssOf(chipToneColor("ally"));
    const enemyCss = cssOf(chipToneColor("enemy"));
    this.hud = {
      clock: conquerText(CONQUER_CLOCK_FONT_PX, 0.5, 0),
      labels: [
        conquerText(CONQUER_LABEL_FONT_PX, 0, 0).setText(CONQUER_ALLY_LABEL).setColor(allyCss),
        conquerText(CONQUER_LABEL_FONT_PX, 0, 0).setText(CONQUER_ENEMY_LABEL).setColor(enemyCss),
      ],
      percents: [
        conquerText(CONQUER_LABEL_FONT_PX, 1, 0).setColor(allyCss),
        conquerText(CONQUER_LABEL_FONT_PX, 1, 0).setColor(enemyCss),
      ],
      chip: conquerText(CONQUER_CHIP_FONT_PX, 0.5, 0.5),
      headers: [
        conquerText(CONQUER_LABEL_FONT_PX, 0, 0.5).setText(CONQUER_ALLY_HEADER).setColor(allyCss),
        conquerText(CONQUER_LABEL_FONT_PX, 0, 0.5).setText(CONQUER_ENEMY_HEADER).setColor(enemyCss),
      ],
    };
  }

  objects(): Phaser.GameObjects.GameObject[] {
    return [...this.texts];
  }

  destroy(): void {
    for (const text of this.texts) text.destroy();
    this.texts = [];
  }

  /**
   * Everything is viewer-relative, read off the LOCAL player's `team` (the same viewer
   * `renderZone` reads), so spectating an enemy never swaps whose bar is green. Every rule is in
   * `layout.ts`; this sets positions, strings and fills. Drawn on the host's `rosterGfx`, which is a
   * live layer cleared every frame, so the per-tick bar fill never touches the baked slot bar.
   */
  render(room: Room<ArenaState>): number {
    const gfx = this.host.gfx;
    const hud = this.hud;
    if (!gfx) return 0;
    gfx.clear();
    const state = room.state;
    const tick = state.tick;
    const viewerTeam = state.players.get(this.host.viewerSessionId(room))?.team ?? 0;
    const enemyTeam = viewerTeam === 1 ? 0 : 1;
    const conquerTicks = derived().conquerTicks;

    const rows = rosterRows([...state.players.values()]);
    const teamOf = (sessionId: string): number => state.players.get(sessionId)?.team ?? 0;
    const allyRows = rows.filter((row) => teamOf(row.sessionId) === viewerTeam);
    const enemyRows = rows.filter((row) => teamOf(row.sessionId) !== viewerTeam);
    const L = conquerGutterLayout(allyRows.length, enemyRows.length, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH);

    hud.clock
      .setPosition(L.clock.x, L.clock.y)
      .setText(conquerClockLabel(tick, state.matchEndsTick, state.overtime, TICK_RATE_HZ, derived().deathmatchTicks.match))
      .setVisible(true);

    // [ally, enemy], each read off the team it stands for rather than off A/B.
    const controlOf = (team: number): number => (team === 1 ? state.controlTicksB : state.controlTicksA);
    const teams = [viewerTeam, enemyTeam] as const;
    for (let i = 0; i < 2; i++) {
      const box = L.bars[i]!;
      const control = controlOf(teams[i]!);
      hud.labels[i]!.setPosition(box.label.x, box.label.y).setVisible(true);
      hud.percents[i]!
        .setPosition(box.percent.x, box.percent.y)
        .setText(controlPercentText(control, conquerTicks.controlTarget))
        .setVisible(true);
      const color = chipToneColor(i === 0 ? "ally" : "enemy");
      gfx.fillStyle(color, CONQUER_BAR_TRACK_ALPHA);
      gfx.fillRect(box.bar.x, box.bar.y, box.bar.w, box.bar.h);
      gfx.fillStyle(color, 1);
      gfx.fillRect(
        box.bar.x,
        box.bar.y,
        box.bar.w * controlFillFraction(control, conquerTicks.controlTarget),
        box.bar.h,
      );
    }

    const chip = captureChip(
      viewerTeam,
      state.zoneHolder,
      state.zoneStreakTicks,
      state.zoneContested,
      conquerTicks.captureDelay,
      TICK_RATE_HZ,
    );
    const chipColor = chipToneColor(chip.tone);
    gfx.fillStyle(chipColor, CONQUER_CHIP_FILL_ALPHA);
    gfx.fillRect(L.chip.x, L.chip.y, L.chip.w, L.chip.h);
    const chipCss = cssOf(chipColor);
    if (hud.chip.style.color !== chipCss) hud.chip.setColor(chipCss);
    hud.chip
      .setPosition(L.chip.x + L.chip.w / 2, L.chip.y + L.chip.h / 2)
      .setText(chip.text)
      .setVisible(true);

    for (let i = 0; i < 2; i++) {
      const header = L.roster.headers[i]!;
      hud.headers[i]!.setPosition(header.x, header.y).setVisible(true);
    }

    // Ally rows then enemy rows — the order `L.roster.rows` is laid out in. The swatch, the greyed
    // dead row and the truncation are the default roster panel's own; the kill column is not
    // Conquer's.
    const ordered = [...allyRows, ...enemyRows];
    const names = this.host.rosterNameTexts;
    for (let i = 0; i < names.length; i++) {
      const row = ordered[i];
      const box = L.roster.rows[i];
      const label = names[i]!;
      this.host.rosterKillTexts[i]!.setVisible(false);
      if (!row || !box) {
        label.setVisible(false);
        continue;
      }
      gfx.fillStyle(this.host.carFill(row.sessionId, row.colorId), row.alive ? 1 : ROSTER_DEAD_SWATCH_ALPHA);
      gfx.fillRect(box.x, box.y, box.size, box.size);
      const color = row.alive ? ROSTER_LIVE_TEXT : ROSTER_DEAD_TEXT;
      if (label.style.color !== color) label.setColor(color);
      const respawnIn = row.alive
        ? 0
        : respawnSeconds(state.players.get(row.sessionId)?.diedAtTick ?? 0, tick);
      label
        .setPosition(box.labelX, box.centerY)
        .setText(conquerRosterName(row.name, respawnIn, L.roster.nameMaxChars))
        .setVisible(true);
    }

    return L.slotTopInset;
  }
}
