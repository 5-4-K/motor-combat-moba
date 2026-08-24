import { ArenaState, stepSim, type InputMessage } from "@motor-arena/shared";

/** `dt` is seconds and must match the room simulation interval (1 / getTickRateHz(TICK_RATE_HZ)). */
export function serverTick(state: ArenaState, queues: Map<string, InputMessage[]>, dt: number): void {
  for (const [id, player] of state.players) {
    const q = queues.get(id);
    if (!q || q.length === 0) continue;
    while (q.length) {
      const msg = q.shift()!;
      const next = stepSim(
        { x: player.x, y: player.y, angle: player.angle, speed: player.speed, reverseHold: player.reverseHold },
        msg,
        dt,
      );
      player.x = next.x;
      player.y = next.y;
      player.angle = next.angle;
      player.speed = next.speed;
      player.reverseHold = next.reverseHold;
      player.lastProcessedInputSeq = msg.seq;
    }
  }
}
