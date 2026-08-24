import { Room, ServerError, type Client } from "@colyseus/core";
import {
  ArenaState,
  PlayerState,
  INPUT_MESSAGE,
  MAX_PLAYERS,
  DEFAULT_PATCH_RATE_HZ,
  TICK_RATE_HZ,
  GameMode,
  PlayerStatus,
  MSG_SWITCH_TEAM,
  MSG_SET_MODE,
  MSG_START_MATCH,
  MSG_KICK,
  MSG_START_ERROR,
  validateName,
  isNameTaken,
  pickColor,
  pickTeam,
  canStart,
  type InputMessage,
  type StartRulePlayer,
  type StartRuleStatus,
} from "@motor-arena/shared";
import { getTickRateHz, getSimulatedLatency } from "../mode.js";
import { isInputMessage } from "../net/input-message.js";
import { withSimulatedLatency } from "../net/latency-injector.js";
import { serverTick } from "../sim/tick.js";
import { selectNextHost } from "./select-next-host.js";

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

    this.onMessage(MSG_SWITCH_TEAM, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.status !== PlayerStatus.READY) return;
      player.team = player.team === 0 ? 1 : 0;
    });

    this.onMessage(MSG_SET_MODE, (client, msg: unknown) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (this.hasPlayerInMatch()) return;
      if (!isSetModePayload(msg)) return;
      this.state.mode = msg.mode;
    });

    this.onMessage(MSG_KICK, (client, msg: unknown) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      if (!isKickPayload(msg)) return;
      if (msg.sessionId === client.sessionId) return;
      const target = this.state.players.get(msg.sessionId);
      if (!target) return;
      if (target.status !== PlayerStatus.READY && target.status !== PlayerStatus.POST_MATCH) {
        return;
      }
      const targetClient = this.clients.find((c) => c.sessionId === msg.sessionId);
      if (targetClient) targetClient.leave(4002, "Kicked");
    });

    this.onMessage(MSG_START_MATCH, (client) => {
      if (client.sessionId !== this.state.hostSessionId) return;
      const players: StartRulePlayer[] = [];
      this.state.players.forEach((player) => {
        players.push({ status: toStartRuleStatus(player.status), team: player.team });
      });
      const result = canStart(this.state.mode, players);
      if (!result.ok) {
        client.send(MSG_START_ERROR, { error: result.error });
        return;
      }
      // P3: begin car select
    });
  }

  onJoin(client: Client, options?: { name?: unknown }): void {
    const nameResult = validateName(String(options?.name ?? ""));
    if (!nameResult.ok) {
      throw new ServerError(4000, nameResult.error);
    }

    const names: string[] = [];
    const teams: number[] = [];
    const colorIds: number[] = [];
    this.state.players.forEach((player) => {
      names.push(player.name);
      teams.push(player.team);
      colorIds.push(player.colorId);
    });

    if (isNameTaken(names, nameResult.name)) {
      throw new ServerError(4001, "Name is taken");
    }

    const index = this.state.players.size;
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.name = nameResult.name;
    player.colorId = pickColor(colorIds, Math.random);
    player.team = pickTeam(teams, Math.random);
    player.joinedAtTick = this.state.tick;
    player.status = PlayerStatus.READY;
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
      const remaining: { sessionId: string; joinedAtTick: number }[] = [];
      this.state.players.forEach((player) => {
        remaining.push({ sessionId: player.sessionId, joinedAtTick: player.joinedAtTick });
      });
      this.state.hostSessionId = selectNextHost(remaining);
    }
  }

  private tick(): void {
    this.state.tick += 1;
    serverTick(this.state, this.inputQueues, 1 / getTickRateHz(TICK_RATE_HZ));
  }

  private hasPlayerInMatch(): boolean {
    let found = false;
    this.state.players.forEach((player) => {
      if (player.status === PlayerStatus.IN_MATCH) found = true;
    });
    return found;
  }
}

function isSetModePayload(msg: unknown): msg is { mode: GameMode } {
  if (msg === null || typeof msg !== "object") return false;
  const mode = (msg as { mode?: unknown }).mode;
  return mode === GameMode.FFA || mode === GameMode.TEAM;
}

function isKickPayload(msg: unknown): msg is { sessionId: string } {
  return (
    msg !== null &&
    typeof msg === "object" &&
    typeof (msg as { sessionId?: unknown }).sessionId === "string"
  );
}

function toStartRuleStatus(status: PlayerStatus): StartRuleStatus {
  if (status === PlayerStatus.IN_MATCH) return "in_match";
  if (status === PlayerStatus.POST_MATCH) return "post_match";
  return "ready";
}
