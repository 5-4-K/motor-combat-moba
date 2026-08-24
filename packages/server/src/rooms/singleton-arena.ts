export const ROOM_FULL_ERROR = "Room is full";

export function shouldRejectSecondArena(
  listings: readonly { roomId: string }[],
  selfRoomId: string,
): boolean {
  return listings.some((entry) => entry.roomId !== selfRoomId);
}
