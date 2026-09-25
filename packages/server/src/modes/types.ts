import type { ArenaState } from "@motor-combat-moba/shared";

/** What a controller reports back to `ArenaRoom` when a match has ended. */
export interface MatchOutcome {
  readonly winnerSessionId: string;
  readonly winnerTeam: number;
}

/** One combat participant as a controller needs to see them, already resolved for this tick. */
export interface CombatPlayerView {
  readonly sessionId: string;
  readonly team: 0 | 1;
  readonly alive: boolean;
  readonly inRoster: boolean;
}

/** The slice of room state a controller reads. Never the room itself (Review Focus 4). */
export interface ModeRoomView {
  readonly state: ArenaState;
  readonly roster: ReadonlySet<string>;
}

/**
 * One family's win-condition behaviour, moved out of `ArenaRoom` so the room never names a mode
 * (GM18-GM21). `controllerOf(mode)` resolves one of these per call — never cached on the room — so a
 * host switching mode between matches gets the new family's behaviour immediately (Review Focus 4).
 */
export interface ModeController {
  /** The edge into `RoomPhase.MATCH`: stamp the clock, reset whatever the family owns. */
  onMatchStart(room: ModeRoomView): void;
  /** Every tick, after combat has run. Returns the match outcome once the family's win test fires. */
  afterTick(room: ModeRoomView, combatPlayers: readonly CombatPlayerView[]): MatchOutcome | undefined;
  /** A roster member has just been removed from `room.state.players` and `room.roster`. */
  afterLeave(room: ModeRoomView): MatchOutcome | undefined;
}
