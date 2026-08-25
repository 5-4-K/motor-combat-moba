import { PlayerStatus, RoomPhase } from "../constants.js";

export type StatusInput = PlayerStatus | "ready" | "in_match" | "post_match";
export type ViewId = "lobby" | "car_select" | "reveal" | "match" | "results";

const BADGE_READY = "#2ECC71";
const BADGE_IN_MATCH = "#F1C40F";
const BADGE_POST_MATCH = "#E74C3C";

function isReady(status: StatusInput): boolean {
  return status === PlayerStatus.READY || status === "ready";
}

function isInMatch(status: StatusInput): boolean {
  return status === PlayerStatus.IN_MATCH || status === "in_match";
}

function isPostMatch(status: StatusInput): boolean {
  return status === PlayerStatus.POST_MATCH || status === "post_match";
}

export function badgeColor(status: StatusInput): string {
  if (isReady(status)) return BADGE_READY;
  if (isInMatch(status)) return BADGE_IN_MATCH;
  if (isPostMatch(status)) return BADGE_POST_MATCH;
  throw new Error(`Unknown status: ${String(status)}`);
}

export function viewFor(status: StatusInput, phase: RoomPhase): ViewId {
  if (isPostMatch(status)) return "results";
  if (isReady(status)) return "lobby";
  if (phase === RoomPhase.CAR_SELECT) return "car_select";
  if (phase === RoomPhase.REVEAL) return "reveal";
  if (phase === RoomPhase.COUNTDOWN || phase === RoomPhase.MATCH) return "match";
  return "lobby";
}
