import { ArenaState, stepSim, MS_PER_TICK, type InputMessage } from "@motor-arena/shared";

export function serverTick(state: ArenaState, queues: Map<string, InputMessage[]>): void {
  for (const [id, player] of state.players) {
    const q = queues.get(id);
    if (!q || q.length === 0) continue;
    while (q.length) {
      const msg = q.shift()!;
      const next = stepSim({ x: player.x, y: player.y, angle: player.angle }, msg, MS_PER_TICK / 1000);
      player.x = next.x;
      player.y = next.y;
      player.angle = next.angle;
      player.lastProcessedInputSeq = msg.seq;
    }
  }
}
