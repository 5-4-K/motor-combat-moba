import {
  DEFAULT_CAR_ID,
  RoomPhase,
  isActiveGameMode,
  modeConfigOrDefault,
  type ArenaId,
  type CarId,
  type GameMode,
  type ModeConfig,
  type Spawn,
} from "@motor-combat-moba/shared";

export function copySpawnNumbers(spawn: Spawn): { x: number; y: number; angle: number } {
  return { x: spawn.x, y: spawn.y, angle: spawn.angle };
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
 *
 * **`isActiveGameMode` is the third refusal, added 2026-09-23.** `MODE_TABLE`'s own header has
 * always said "flip `isActive` false and the mode disappears from the lobby picker and `set_mode`
 * refuses it", and the second half of that was simply untrue: this function checked phase and
 * `hasPlayerInMatch`, then resolved through `modeConfigOrDefault`, so a hand-built or stale client
 * could seat an unpublished mode by sending its wire id. The comment was made true rather than
 * weakened: `isActive` is documented as the publish gate in the registry, in the `game-mode` skill
 * and in the root `CLAUDE.md`, and a mode nothing publishes has no business being reachable from a
 * client message. The playground, practice and the headless harnesses all pin or pass a mode
 * directly and never come through here, so driving an unpublished mode is as available as it ever
 * was.
 *
 * This subsumes the old unknown-byte fallback: an unregistered value is not active either, so it is
 * refused outright and the room keeps the mode it already had — which is what a fallback to
 * `DEFAULT_GAME_MODE` was reaching for anyway, minus the surprise of a client's typo silently
 * rewriting the host's pick.
 */
export function resolveSetMode(
  phase: RoomPhase,
  hasPlayerInMatch: boolean,
  mode: GameMode,
): SetModeResolution | undefined {
  if (phase !== RoomPhase.LOBBY) return undefined;
  if (hasPlayerInMatch) return undefined;
  if (!isActiveGameMode(mode)) return undefined;
  // `modeConfigOrDefault`, never `modeConfigOf`: `mode` arrived off the wire. Unreachable as a
  // FALLBACK now that the guard above refuses every unregistered byte, and kept deliberately — the
  // wire-facing form is the correct spelling for a wire value whatever guards precede it.
  const config = modeConfigOrDefault(mode);
  return { mode, config, arenaId: config.arenas[0] };
}
