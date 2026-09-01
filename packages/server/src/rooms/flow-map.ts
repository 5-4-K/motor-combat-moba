import {
  PlayerStatus,
  RoomPhase,
  type FlowStatus,
} from "@motor-combat-moba/shared";

export function toFlowPhase(
  phase: RoomPhase,
): "lobby" | "car_select" | "reveal" | "countdown" | "match" {
  if (phase === RoomPhase.CAR_SELECT) return "car_select";
  if (phase === RoomPhase.REVEAL) return "reveal";
  if (phase === RoomPhase.COUNTDOWN) return "countdown";
  if (phase === RoomPhase.MATCH) return "match";
  return "lobby";
}

export function fromFlowPhase(
  phase: "lobby" | "car_select" | "reveal" | "countdown" | "match",
): RoomPhase {
  if (phase === "car_select") return RoomPhase.CAR_SELECT;
  if (phase === "reveal") return RoomPhase.REVEAL;
  if (phase === "countdown") return RoomPhase.COUNTDOWN;
  if (phase === "match") return RoomPhase.MATCH;
  return RoomPhase.LOBBY;
}

export function toFlowStatus(status: PlayerStatus): FlowStatus {
  if (status === PlayerStatus.IN_MATCH) return "in_match";
  if (status === PlayerStatus.POST_MATCH) return "post_match";
  return "ready";
}

export function fromFlowStatus(status: FlowStatus): PlayerStatus {
  if (status === "in_match") return PlayerStatus.IN_MATCH;
  if (status === "post_match") return PlayerStatus.POST_MATCH;
  return PlayerStatus.READY;
}
