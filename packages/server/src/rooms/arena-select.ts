import {
  RoomPhase,
  TICK_RATE_HZ,
  isArenaHighlightPayload,
  isArenaPickPayload,
} from "@motor-combat-moba/shared";

/**
 * The arena select screen's server decisions (spec AR13-AR18), kept pure so they are tested without
 * standing up a room. `ArenaRoom` reads the mode's `flow` and `arenas`, asks these, and writes state;
 * nothing here touches the room.
 */

export type ArenaSelectOpening =
  | { kind: "skip"; arenaId: string }
  | { kind: "choose"; highlightId: string }
  | { kind: "reveal"; arenaId: string };

/**
 * What Start does (AR13): off plays `arenas[0]` straight into car select; one arena is decided
 * already, so only its reveal shows; two or more open the host's choice on `arenas[0]`.
 * `modes/invariants.test.ts` already guarantees the list is non-empty.
 */
export function openArenaSelect(enabled: boolean, arenas: readonly string[]): ArenaSelectOpening {
  const first = arenas[0];
  if (first === undefined) throw new Error("A mode's arena list is empty");
  if (!enabled) return { kind: "skip", arenaId: first };
  if (arenas.length === 1) return { kind: "reveal", arenaId: first };
  return { kind: "choose", highlightId: first };
}

export interface ArenaSelectGate {
  senderId: string;
  hostSessionId: string;
  /**
   * AR20: a host inherited from the lobby (not on this match's roster) is not looking at the screen,
   * so they may not pick; the clock decides instead.
   */
  senderOnRoster: boolean;
  phase: RoomPhase;
  arenaRevealEndsTick: number;
  arenas: readonly string[];
}

function mayAct(gate: ArenaSelectGate): boolean {
  return (
    gate.senderId === gate.hostSessionId &&
    gate.senderOnRoster &&
    gate.phase === RoomPhase.ARENA_SELECT &&
    gate.arenaRevealEndsTick === 0
  );
}

/** The arena to highlight, or null when the message is refused. */
export function acceptHighlight(gate: ArenaSelectGate, msg: unknown): string | null {
  if (!isArenaHighlightPayload(msg) || !mayAct(gate)) return null;
  return gate.arenas.includes(msg.arenaId) ? msg.arenaId : null;
}

export interface ArenaPick {
  arenaId: string;
  random: boolean;
}

/**
 * The pick, or null when refused. A random pick is drawn HERE, on the server, so every client sees
 * the same arena (AR18). `rand` returns [0, 1), like `Math.random`.
 */
export function acceptPick(gate: ArenaSelectGate, msg: unknown, rand: () => number): ArenaPick | null {
  if (!isArenaPickPayload(msg) || !mayAct(gate)) return null;
  if (isArenaHighlightPayload(msg)) {
    return gate.arenas.includes(msg.arenaId) ? { arenaId: msg.arenaId, random: false } : null;
  }
  const r = rand();
  const drawn = Math.floor((Number.isFinite(r) ? r : 0) * gate.arenas.length);
  const index = Math.max(0, Math.min(gate.arenas.length - 1, drawn));
  return { arenaId: gate.arenas[index], random: true };
}

export interface RevealTiming {
  arenaRevealSeconds: number;
  arenaRouletteSeconds: number;
}

/** AR17: the reveal's end, with the roulette's time added in front of it after a random pick. */
export function revealEndsTickFor(nowTick: number, timing: RevealTiming, random: boolean): number {
  const seconds = timing.arenaRevealSeconds + (random ? timing.arenaRouletteSeconds : 0);
  return nowTick + Math.ceil(seconds * TICK_RATE_HZ);
}
