import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { ArenaState } from "@motor-combat-moba/shared";
import {
  GameMode,
  PlayerStatus,
  controlPercentText,
  derived,
  modeConfigOf,
  withMode,
} from "@motor-combat-moba/shared";
import { HUD_GUTTER_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from "../../config/display.js";
import type { GutterHost } from "../types.js";
import { CONQUER_HUD } from "./hud.js";
import { ConquerGutter } from "./gutter.js";
import { conquerGutterLayout } from "./layout.js";

const withConquerMode = <T>(fn: () => T): T => withMode(modeConfigOf(GameMode.CONQUER), fn);

/** A `Text` stand-in that records what the gutter did to it. No Phaser runtime. */
class StubText {
  text = "";
  visible = false;
  destroyed = false;
  x = 0;
  y = 0;
  origin: [number, number] = [0.5, 0.5];
  readonly style: { color: string } = { color: "#ffffff" };
  constructor(readonly fontPx: number) {}
  setText(text: string): this {
    this.text = text;
    return this;
  }
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  setVisible(visible: boolean): this {
    this.visible = visible;
    return this;
  }
  setColor(color: string): this {
    this.style.color = color;
    return this;
  }
  setOrigin(x: number, y: number): this {
    this.origin = [x, y];
    return this;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

class StubGfx {
  readonly rects: { x: number; y: number; w: number; h: number; color: number; alpha: number }[] = [];
  clears = 0;
  private fill = { color: 0, alpha: 1 };
  clear(): this {
    this.clears++;
    this.rects.length = 0;
    return this;
  }
  fillStyle(color: number, alpha = 1): this {
    this.fill = { color, alpha };
    return this;
  }
  fillRect(x: number, y: number, w: number, h: number): this {
    this.rects.push({ x, y, w, h, ...this.fill });
    return this;
  }
}

interface Fixture {
  host: GutterHost;
  created: StubText[];
  gfx: StubGfx;
  names: StubText[];
  kills: StubText[];
}

function fixture(viewerSessionId: string): Fixture {
  const created: StubText[] = [];
  const gfx = new StubGfx();
  const names = Array.from({ length: 6 }, () => new StubText(12));
  const kills = Array.from({ length: 6 }, () => new StubText(12).setVisible(true));
  const host: GutterHost = {
    addText: (fontPx, ox, oy) => {
      const text = new StubText(fontPx).setOrigin(ox, oy);
      created.push(text);
      return text as unknown as Phaser.GameObjects.Text;
    },
    get gfx() {
      return gfx as unknown as Phaser.GameObjects.Graphics;
    },
    rosterNameTexts: names as unknown as Phaser.GameObjects.Text[],
    rosterKillTexts: kills as unknown as Phaser.GameObjects.Text[],
    viewerSessionId: () => viewerSessionId,
    carFill: () => 0x123456,
  };
  return { host, created, gfx, names, kills };
}

const player = (sessionId: string, team: number, joinedAtTick: number) => ({
  sessionId,
  name: sessionId.toUpperCase(),
  colorId: 0,
  team,
  joinedAtTick,
  alive: true,
  status: PlayerStatus.IN_MATCH,
  kills: 3,
  diedAtTick: 0,
});

function room(): Room<ArenaState> {
  const players = new Map(
    [player("a1", 0, 1), player("a2", 0, 2), player("b1", 1, 3)].map((p) => [p.sessionId, p]),
  );
  return {
    state: {
      players,
      tick: 300,
      matchEndsTick: 6000,
      overtime: false,
      controlTicksA: 450,
      controlTicksB: 90,
      zoneHolder: -1,
      zoneStreakTicks: 0,
      zoneContested: false,
    },
  } as unknown as Room<ArenaState>;
}

describe("ConquerGutter (GM22–GM24)", () => {
  it("is what CONQUER_HUD.createGutter builds", () => {
    const { host } = fixture("a1");
    expect(CONQUER_HUD.createGutter?.(host)).toBeInstanceOf(ConquerGutter);
  });

  it("returns conquerGutterLayout's slotTopInset", () => {
    withConquerMode(() => {
      const { host } = fixture("a1");
      const inset = new ConquerGutter(host).render(room());
      expect(inset).toBe(conquerGutterLayout(2, 1, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH).slotTopInset);
    });
  });

  it("reads the ally bar off the viewer's own team", () => {
    withConquerMode(() => {
      const target = derived().conquerTicks.controlTarget;
      // Pool order: clock, 2 labels, 2 percents, chip, 2 headers.
      const teamA = fixture("a1");
      new ConquerGutter(teamA.host).render(room());
      expect(teamA.created[3]!.text).toBe(controlPercentText(450, target));
      expect(teamA.created[4]!.text).toBe(controlPercentText(90, target));

      const teamB = fixture("b1");
      new ConquerGutter(teamB.host).render(room());
      expect(teamB.created[3]!.text).toBe(controlPercentText(90, target));
      expect(teamB.created[4]!.text).toBe(controlPercentText(450, target));
    });
  });

  it("hides every kill text and shows one name per player", () => {
    withConquerMode(() => {
      const { host, kills, names, gfx } = fixture("a1");
      new ConquerGutter(host).render(room());
      expect(kills.every((text) => !text.visible)).toBe(true);
      expect(names.filter((text) => text.visible)).toHaveLength(3);
      expect(gfx.clears).toBe(1);
      // Two bars (track + fill each), the chip, and three swatches.
      expect(gfx.rects).toHaveLength(2 * 2 + 1 + 3);
    });
  });

  it("owns and destroys exactly the texts it created", () => {
    const { host, created } = fixture("a1");
    const gutter = new ConquerGutter(host);
    expect(created).toHaveLength(8);
    expect(gutter.objects()).toStrictEqual(created);
    gutter.destroy();
    expect(created.every((text) => text.destroyed)).toBe(true);
    expect(gutter.objects()).toStrictEqual([]);
  });
});
