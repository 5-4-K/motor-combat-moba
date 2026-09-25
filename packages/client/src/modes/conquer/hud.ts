import { GameMode, controlPercentText, derived, modeConfigOf } from "@motor-combat-moba/shared";
import { localTeamOf, type ResultsViewState } from "../../ui/results-view.js";
import type { ModeHud } from "../types.js";

/** `m:ss`, the same shape the countdown clocks elsewhere on the lobby screen use. */
function secondsLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Viewer-relative, like the match HUD's US/THEM: the viewer's own team is always read first. */
function controlLine(state: ResultsViewState, localSessionId: string): string {
  const target = derived().conquerTicks.controlTarget;
  const a = controlPercentText(state.controlTicksA, target);
  const b = controlPercentText(state.controlTicksB, target);
  const [ours, theirs] = localTeamOf(state, localSessionId) === 1 ? [b, a] : [a, b];
  return `Control — You ${ours} · Them ${theirs}`;
}

/**
 * Conquer names the outcome from the viewer's side ("You win"), because its whole HUD is US/THEM
 * and a team-B player, whose base sat at the bottom of their screen, never saw "Team B" anywhere.
 */
function resultsHeadline(state: ResultsViewState, localSessionId: string): string | undefined {
  if (state.winnerTeam !== 0 && state.winnerTeam !== 1) return "Draw";
  return state.winnerTeam === localTeamOf(state, localSessionId) ? "You win" : "You lose";
}

/**
 * `CONQUER`'s HUD. The lobby card reads Conquer's OWN bundle through
 * `modeConfigOf(GameMode.CONQUER)` (CQ58) rather than the ambient `conquer()`/`deathmatch()`
 * accessors, since this card renders under whatever mode the LOBBY has installed, which need not be
 * Conquer — an ambient read would then quote the wrong mode's numbers. Conquer reads its clock from
 * its OWN `deathmatch` table (`modes/conquer/deathmatch.ts`, 180 s / 5 s respawn), not Deathmatch's.
 *
 * `clockLabel` is always "": the arena clock lives in Conquer's own gutter panel instead (CQ56),
 * which lands in Task 8.
 */
export const CONQUER_HUD: ModeHud = {
  lobbyCard: () => {
    const { conquer: cq, deathmatch: cqDm } = modeConfigOf(GameMode.CONQUER);
    return {
      kicker: "Team objective",
      body: `${cq.teamSize}v${cq.teamSize} teams fight over the centre zone. Hold it unopposed for ${cq.captureDelaySeconds} s to take control; ${cq.controlTargetSeconds} s of control wins. Highest control when the ${secondsLabel(cqDm.matchSeconds)} clock ends wins; a tie goes to overtime.`,
      meta: [`${cq.teamSize}v${cq.teamSize}`, secondsLabel(cqDm.matchSeconds), "zone control"],
    };
  },
  clockLabel: () => "",
  showsKills: false,
  resultsLine: controlLine,
  resultsHeadline,
};
