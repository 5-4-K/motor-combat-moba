import { activeCarIds, isActiveCarId } from "../config/car-config.js";
import { FLOW_CONFIG } from "../config/flow-config.js";
import type { CarId } from "../config/types.js";
import { isBotDifficulty, type BotDifficulty } from "./playground-messages.js";

/** Room name, registered on EVERY process — practice ships (spec PR3). */
export const PRACTICE_ROOM_NAME = "practice";

export const MSG_PRACTICE_PAUSE = "pr_pause"; // no payload: toggle
export const MSG_PRACTICE_IDLE_WARNING = "pr_idle_warn"; // no payload: server -> client

/**
 * Close codes, continuing the room-defined 4000+ block (4000 bad name, 4001 taken name, 4002 kicked,
 * 4003 second arena, 4004 arena busy, 4005 playground busy). None of these three are
 * interchangeable — 4007 refuses a join over the room cap, 4008 refuses one because a playground is
 * live (PR10's mirror: the tuning store it writes through is process-wide, so a practice session born
 * under its overrides would run on tables no arena is using), and 4006 ends a session already in
 * progress (PR25).
 */
export const PRACTICE_IDLE_CLOSE_CODE = 4006;
export const PRACTICE_FULL_CLOSE_CODE = 4007;
export const PRACTICE_PLAYGROUND_BUSY_CLOSE_CODE = 4008;

export const PRACTICE_IDLE_ERROR = "Practice session ended — no input for a while";
export const PRACTICE_FULL_ERROR = "Too many practice sessions are running right now";
export const PRACTICE_PLAYGROUND_BUSY_ERROR =
  "Close the playground first: its tuning is process-wide";

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
 */
export function isPracticeSetup(msg: unknown): msg is PracticeSetup {
  if (msg === null || typeof msg !== "object") return false;
  const rec = msg as Record<string, unknown>;
  return (
    typeof rec.name === "string" &&
    rec.name.length <= FLOW_CONFIG.nameMax &&
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
