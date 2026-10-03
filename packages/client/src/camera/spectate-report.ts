/**
 * When the arena scene tells the server which car its spectate camera shows (`MSG_SPECTATE_TARGET`,
 * NR45). Under a mode's field of vision the server sends a wreck exactly what its watched car sees,
 * so it has to know the pick — which used to be client-local. Reported on the wreck's first frame
 * and on every change after it (a `[`/`]` press, or the fall to the front of the cycle when the
 * watched car dies); never repeated for an unchanged pick, so it costs a message per key press at
 * most. An empty pick (nobody left to watch, free roam) is not reported: the server already shows
 * the no-target vision then. Leaving the wreck (a respawn, the match ending) forgets what was sent,
 * so the next wreck reports afresh — the server forgets its pick on the same edge.
 */
export class SpectateReport {
  private sent = "";

  /** The target to send this frame, or undefined for nothing. */
  next(spectating: boolean, target: string): string | undefined {
    if (!spectating) {
      this.sent = "";
      return undefined;
    }
    if (target === "" || target === this.sent) {
      if (target === "") this.sent = "";
      return undefined;
    }
    this.sent = target;
    return target;
  }
}
