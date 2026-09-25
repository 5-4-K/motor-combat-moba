import type Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { ArenaState } from "@motor-combat-moba/shared";
import type { ResultsViewState } from "../ui/results-view.js";

/**
 * A lobby mode card's copy. `id`/`name` are stapled on by the registry's caller
 * (`ui/lobby-view.ts`'s `modeCards()`), which is why they are not members here — a `ModeHud` speaks
 * for exactly one mode, so it has no business naming its own `GameMode` id.
 */
export interface ModeCardCopy {
  readonly kicker: string;
  readonly body: string;
  readonly meta: readonly string[];
}

/**
 * One mode's client-facing presentation: the lobby card, the arena clock, whether the roster gutter
 * carries a kills column, and the results screen's headline and control line. `hudOf(mode)`
 * (`modes/registry.ts`) is the only way any of these should be read outside `modes/**` — see the
 * root `CLAUDE.md`'s per-mode section for why reading a mode's own bundle through its own accessor,
 * rather than the ambient one, is what keeps a card honest under a lobby installed on another mode.
 *
 * A mode that lays the right gutter out its own way supplies `createGutter`; every other mode leaves
 * it out and `ArenaScene` draws its default roster panel (CQ57).
 */
export interface ModeHud {
  lobbyCard(): ModeCardCopy;
  /** `""` when this mode has no clock to show over the arena (Conquer draws its own, in the gutter). */
  clockLabel(state: ArenaState, tick: number): string;
  /** Whether the roster gutter panel carries a kills column. */
  readonly showsKills: boolean;
  /** The results screen's extra line under the stat tables (Conquer's control percentages), or none. */
  resultsLine(state: ResultsViewState, localSessionId: string): string | undefined;
  /** Overrides the results screen's default "X wins"/"Draw" headline, when a mode needs its own. */
  resultsHeadline?(state: ResultsViewState, localSessionId: string): string | undefined;
  /**
   * Builds this mode's own right-gutter layout in place of `ArenaScene`'s roster panel. Called once
   * per arena entry, where the scene pools its other gutter texts; absent for a mode whose gutter is
   * the default panel.
   */
  createGutter?(host: GutterHost): ModeGutter;
}

/**
 * What `ArenaScene` lends a mode's gutter. An object literal, not the scene itself, so a gutter can
 * reach exactly these and nothing else — and `gfx` is a getter because the scene rebuilds
 * `rosterGfx` on every arena entry.
 */
export interface GutterHost {
  /** A HUD text at the depth/scroll settings of every other gutter text (`makeHudText`), with this origin. */
  addText(fontPx: number, originX: number, originY: number): Phaser.GameObjects.Text;
  /** The live roster layer (`rosterGfx`), cleared by the gutter each frame. */
  readonly gfx: Phaser.GameObjects.Graphics | undefined;
  /** The pooled roster row texts the default panel also uses. */
  readonly rosterNameTexts: readonly Phaser.GameObjects.Text[];
  readonly rosterKillTexts: readonly Phaser.GameObjects.Text[];
  /** The session id of the car the local player drives (`drivenSid`). */
  viewerSessionId(room: Room<ArenaState>): string;
  /** Body colour for a roster swatch (`carFillFor`). */
  carFill(sessionId: string, colorId: number): number;
}

/** A mode's own gutter: drawn every frame, routed to the HUD camera, torn down with the scene. */
export interface ModeGutter {
  /** Draws this frame's gutter and returns the slot stack's `topInset`. */
  render(room: Room<ArenaState>): number;
  /** Every display object this gutter created, for `splitCameras`' HUD-camera list. */
  objects(): Phaser.GameObjects.GameObject[];
  destroy(): void;
}
