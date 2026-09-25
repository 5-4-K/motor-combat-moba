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
 * `createGutter` is deliberately absent from this interface in Task 7 — it lands in Task 8 once the
 * gutter host types exist. Conquer's gutter keeps reading `winRuleOf` at `ArenaScene.ts`'s L1941
 * branch until then.
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
}
