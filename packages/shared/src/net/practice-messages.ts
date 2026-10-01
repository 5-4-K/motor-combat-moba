import { activeCarIds, isActiveCarId } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import { flow } from "../modes/active.js";
import { isBotDifficulty, type BotDifficulty } from "./playground-messages.js";
import { CLOSE_CODES } from "./close-codes.js";

/** Room name, registered on EVERY process — practice ships (spec PR3). */
export const PRACTICE_ROOM_NAME = "practice";

export const MSG_PRACTICE_PAUSE = "pr_pause"; // no payload: toggle
export const MSG_PRACTICE_IDLE_WARNING = "pr_idle_warn"; // no payload: server -> client

/**
 * Practice's close codes, named aliases into the one app-code table `CLOSE_CODES` (D5 ruling A moved
 * every app code out of the 4000–4010 block Colyseus claims). None of these four are
 * interchangeable — FULL refuses a join over the room cap, PLAYGROUND_BUSY refuses one because a
 * playground is live (PR10's mirror: the tuning store it writes through is process-wide, so a
 * practice session born under its overrides would run on tables no arena is using), IDLE ends a
 * session already in progress (PR25), and INVALID_SETUP refuses join options that fail
 * `isPracticeSetup` — this room's own counterpart to `ArenaRoom`'s "bad name" refusal.
 */
export const PRACTICE_IDLE_CLOSE_CODE = CLOSE_CODES.PRACTICE_IDLE;
export const PRACTICE_FULL_CLOSE_CODE = CLOSE_CODES.PRACTICE_FULL;
export const PRACTICE_PLAYGROUND_BUSY_CLOSE_CODE = CLOSE_CODES.PRACTICE_PLAYGROUND_BUSY;
export const PRACTICE_INVALID_SETUP_CLOSE_CODE = CLOSE_CODES.PRACTICE_INVALID_SETUP;

export const PRACTICE_IDLE_ERROR = "Practice session ended — no input for a while";
export const PRACTICE_FULL_ERROR = "Too many practice sessions are running right now";
export const PRACTICE_PLAYGROUND_BUSY_ERROR =
  "Close the playground first: its tuning is process-wide";
export const PRACTICE_INVALID_SETUP_ERROR = "Invalid practice setup";

/** An explicit active chassis, or "random" — resolved once, server-side, at room creation (PR15). */
export type PracticeOpponent = CarId | "random";

export interface PracticeSetup {
  name: string;
  carId: CarId;
  opponentCarId: PracticeOpponent;
  difficulty: BotDifficulty;
}

function isPracticeOpponent(value: unknown): value is PracticeOpponent {
  return value === "random" || isActiveCarId(value);
}

/**
 * Validates the join options off the wire (PR7).
 *
 * `isActiveCarId` rejects an id that exists only via the prototype chain ("toString"), and rejects
 * an inactive chassis — practice may never show one the live roster hides (PR15). An EMPTY name is
 * accepted on purpose: the "Player" fallback is applied client-side before the join (PR20), and the
 * server has no uniqueness rule to enforce here.
 *
 * Reads the ACTIVE MODE's `flow()` for the length bound (2026-09-22 final review) — it already
 * reads `isActiveCarId` (mode-scoped via `cars()`) two lines down, so this was never reachable
 * unscoped anyway, and `flow()` matches the convention `lobby/names.ts`'s `validateName` and the
 * client's own join screen (`join.ts`'s `flow().nameMax`) already follow. Every real call site runs
 * scoped: `PracticeRoom.onCreate`'s own top-level check (2026-09-22 final review, see its own
 * comment) and `onJoin`'s re-check both wrap in `scoped(this.modeConfig, ...)`.
 */
export function isPracticeSetup(msg: unknown): msg is PracticeSetup {
  if (msg === null || typeof msg !== "object") return false;
  const rec = msg as Record<string, unknown>;
  return (
    typeof rec.name === "string" &&
    rec.name.length <= flow().nameMax &&
    isActiveCarId(rec.carId) &&
    isPracticeOpponent(rec.opponentCarId) &&
    isBotDifficulty(rec.difficulty)
  );
}

/** What the settings screen opens on before a player has ever chosen (PR21). */
export function defaultPracticeSetup(): PracticeSetup {
  return {
    name: "",
    carId: activeCarIds()[0]!,
    opponentCarId: "random",
    difficulty: "medium",
  };
}
