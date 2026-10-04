/**
 * When a client may say a shot ENDED (protocol 8, G5).
 *
 * The server writes every shot's ending onto its row as `alive: false` and holds that ENDED row for
 * `NET_CONFIG.endedShotRowMs`: a shot that ended on its own birth tick arrives already dead, and one
 * that lived flips from alive to dead on the row it always had. A row that simply VANISHES is never
 * an ending: under interest management (NR44) it may only have left this client's view, and before
 * protocol 8 that ambiguity drew an impact in mid-air for a shot that was still flying.
 *
 * So a row is an ending exactly when it is ENDED now and was not already ENDED last view: absent
 * before (it ended on its birth tick, or ended while out of view and arrived dead), or alive before.
 * A burst (`isExplosion`) never is: its shell's ending is the blast, and a lava field's expiry is the
 * fade of its stamps, not a second detonation.
 *
 * The one rule both the client's fx layer (`deriveFxEvents`) and the netsim's phantom counter read, so
 * the harness measures the rule the client runs.
 */
export interface ShotEndingRow {
  readonly alive: boolean;
  readonly isExplosion: boolean;
}

/** `next` (this view's row) is the shot's ending, given `before` (last view's row, if any). */
export function isShotEnding(before: ShotEndingRow | undefined, next: ShotEndingRow): boolean {
  if (next.alive || next.isExplosion) return false;
  return before === undefined || before.alive;
}
