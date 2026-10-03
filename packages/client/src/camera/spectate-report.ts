import { NET_CONFIG } from "@motor-combat-moba/shared";

/**
 * When the arena scene tells the server which car its spectate camera shows (`MSG_SPECTATE_TARGET`,
 * NR45). Under a mode's field of vision the server sends a wreck exactly what its watched car sees,
 * so it has to know the pick — which used to be client-local. Reported on the wreck's first frame
 * and on every change after it (a `[`/`]` press, or the fall to the front of the cycle when the
 * watched car dies), and repeated every `NET_CONFIG.spectateResendMs` while it stands unchanged, so a
 * report the link dropped leaves the server on the previous target for a second at most rather than
 * until the next key press. An empty pick (nobody left to watch, free roam) is not reported: the
 * server already shows the no-target vision then. Leaving the wreck (a respawn, the match ending)
 * forgets what was sent, so the next wreck reports afresh — the server forgets its pick on the same
 * edge.
 */
export class SpectateReport {
  private sent = "";
  private sentAtMs = 0;

  /** The target to send this frame (`nowMs` a monotonic clock, ms), or undefined for nothing. */
  next(spectating: boolean, target: string, nowMs: number): string | undefined {
    if (!spectating || target === "") {
      this.sent = "";
      return undefined;
    }
    if (target === this.sent && nowMs - this.sentAtMs < NET_CONFIG.spectateResendMs) return undefined;
    this.sent = target;
    this.sentAtMs = nowMs;
    return target;
  }
}
