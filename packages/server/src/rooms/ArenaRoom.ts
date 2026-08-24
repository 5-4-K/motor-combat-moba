import { Room, type Client } from "@colyseus/core";
import {
  ArenaState,
  PlayerState,
  INPUT_MESSAGE,
  MAX_PLAYERS,
  DEFAULT_PATCH_RATE_HZ,
  TICK_RATE_HZ,
  type InputMessage,
} from "@motor-arena/shared";
import { getTickRateHz, getSimulatedLatency } from "../mode.js";
import { isInputMessage } from "../net/input-message.js";
import { withSimulatedLatency } from "../net/latency-injector.js";
import { serverTick } from "../sim/tick.js";

export class ArenaRoom extends Room<ArenaState> {
  maxClients = MAX_PLAYERS;
  private inputQueues = new Map<string, InputMessage[]>();

  onCreate(): void {
    this.setState(new ArenaState());
    this.setPatchRate(1000 / DEFAULT_PATCH_RATE_HZ);
    const hz = getTickRateHz(TICK_RATE_HZ);
    this.setSimulationInterval(() => this.tick(), 1000 / hz);

    const enqueue = withSimulatedLatency<{ sessionId: string; msg: InputMessage }>(
      ({ sessionId, msg }) => {
        const q = this.inputQueues.get(sessionId);
        if (q) q.push(msg);
      },
      getSimulatedLatency(),
    );

    this.onMessage(INPUT_MESSAGE, (client, msg: unknown) => {
      if (!isInputMessage(msg)) return;
      enqueue({ sessionId: client.sessionId, msg });
    });
  }

  onJoin(client: Client): void {
    const index = this.state.players.size;
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.x = 400 + 80 * index;
    player.y = 300;
    this.state.players.set(client.sessionId, player);
    this.inputQueues.set(client.sessionId, []);
    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.inputQueues.delete(client.sessionId);
    if (this.state.hostSessionId === client.sessionId) {
      let nextHost = "";
      this.state.players.forEach((_player, sessionId) => {
        if (nextHost === "" || sessionId < nextHost) nextHost = sessionId;
      });
      this.state.hostSessionId = nextHost;
    }
  }

  private tick(): void {
    this.state.tick += 1;
    serverTick(this.state, this.inputQueues, 1 / getTickRateHz(TICK_RATE_HZ));
  }
}
