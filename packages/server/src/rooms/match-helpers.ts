import {
  DEFAULT_CAR_ID,
  RoomPhase,
  modeConfigOrDefault,
  type ArenaId,
  type CarId,
  type GameMode,
  type LivingPlayer,
  type ModeConfig,
  type Spawn,
} from "@motor-combat-moba/shared";

export function copySpawnNumbers(spawn: Spawn): { x: number; y: number; angle: number } {
  return { x: spawn.x, y: spawn.y, angle: spawn.angle };
}

export function livingAfterLeave(
  remaining: readonly { sessionId: string; team: 0 | 1; alive: boolean }[],
  roster: ReadonlySet<string>,
): LivingPlayer[] {
  return remaining.map((p) => ({
    sessionId: p.sessionId,
    team: p.team,
    alive: p.alive,
    inRoster: roster.has(p.sessionId),
  }));
}

/**
 * The car a roster member is given when the car-select deadline catches them unlocked.
 *
 * Nothing is random: the player gets whatever the screen was showing them. A previewed pick wins,
 * and the fallback is `DEFAULT_CAR_ID` — the very chassis car select opens on — so a player who
 * never touched the screen still drives the car it had selected for them the whole time. Sharing
 * one constant with the screen is what makes that true by construction rather than by coincidence.
 */
export function carAtDeadline(previewed: CarId | undefined): CarId {
  return previewed ?? DEFAULT_CAR_ID;
}

/** Everything `MSG_SET_MODE` changes about a room, resolved together so the three cannot diverge. */
export interface SetModeResolution {
  readonly mode: GameMode;
  readonly config: ModeConfig;
  readonly arenaId: ArenaId;
}

/**
 * Whether a host's `MSG_SET_MODE` may land, and — when it may — every value it changes.
 *
 * Pure, and extracted from `ArenaRoom` for exactly one reason: nothing in this repo instantiates
 * `ArenaRoom` (no test mocks `matchMaker`), so the decision was untestable while it lived inside the
 * handler. It returns all three writes as one object so a caller physically cannot apply the mode
 * without also applying its bundle and its arena — which is the bug this replaced. The handler used
 * to write `state.mode` unconditionally while re-resolving the bundle and the arena only in LOBBY,
 * so in any other phase with nobody `IN_MATCH` (CAR_SELECT, REVEAL, COUNTDOWN, or a MATCH whose
 * players had all been eliminated) the room advertised one mode while running another mode's tables
 * and another mode's arena.
 *
 * LOBBY is the whole of the window (MC21): it is the only phase the client ever sends this from —
 * `LobbyScene` is the only sender, and `viewFor` shows it in LOBBY alone — and it is the same guard
 * `MSG_START_MATCH` already applies. `hasPlayerInMatch` stays as a second, independent refusal: a
 * spectator-only LOBBY is reachable while another player is still `IN_MATCH`.
 */
export function resolveSetMode(
  phase: RoomPhase,
  hasPlayerInMatch: boolean,
  mode: GameMode,
): SetModeResolution | undefined {
  if (phase !== RoomPhase.LOBBY) return undefined;
  if (hasPlayerInMatch) return undefined;
  // `modeConfigOrDefault`, never `modeConfigOf`: `mode` arrived off the wire.
  const config = modeConfigOrDefault(mode);
  return { mode, config, arenaId: config.arenas[0] };
}
