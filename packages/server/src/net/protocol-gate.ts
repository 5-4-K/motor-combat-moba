import { ServerError } from "@colyseus/core";
import { CLOSE_CODES, protocolRefusal } from "@motor-combat-moba/shared";

/**
 * NR55: refuse a join whose `protocol` option is not this server's `PROTOCOL_VERSION`, with the
 * readable "Refresh the page" message the join screen shows. The first check in every room's
 * `onJoin` (and in `PracticeRoom.onCreate`, whose own setup check would otherwise answer an old
 * client with "Invalid practice setup").
 *
 * D4 changed the input wire, so before this gate an old client joined, sent frames the server's
 * validator dropped, and simply never moved.
 */
export function assertProtocol(options: unknown): void {
  const refusal = protocolRefusal(options);
  if (refusal !== undefined) throw new ServerError(CLOSE_CODES.PROTOCOL_MISMATCH, refusal);
}
