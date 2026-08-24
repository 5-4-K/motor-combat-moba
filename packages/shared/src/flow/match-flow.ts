export type FlowStatus = "ready" | "in_match" | "post_match";

export interface FlowPlayer {
  sessionId: string;
  team: 0 | 1;
  status: FlowStatus;
  carId: string;
  selectLocked: boolean;
  alive: boolean;
}

export interface FlowState {
  phase: "lobby" | "car_select" | "countdown" | "match";
  mode: "ffa" | "team";
  tick: number;
  carSelectDeadlineTick: number;
  countdownEndsTick: number;
  roster: string[];
  postMatchIds: string[];
  winnerSessionId: string;
  winnerTeam: number;
  players: FlowPlayer[];
}

export type FlowEvent =
  | { type: "start"; readyIds: string[]; nowTick: number; carSelectTicks: number }
  | { type: "lock_car"; sessionId: string }
  | { type: "reveal"; cars: Record<string, string> }
  | { type: "begin_countdown"; nowTick: number; countdownTicks: number }
  | { type: "go" }
  | { type: "end"; winnerSessionId: string; winnerTeam: number }
  | { type: "return_to_lobby"; sessionId: string };

export function reduceFlow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "start":
      return applyStart(state, event);
    case "lock_car":
      return applyLockCar(state, event.sessionId);
    case "reveal":
      return applyReveal(state, event.cars);
    case "begin_countdown":
      return {
        ...state,
        phase: "countdown",
        countdownEndsTick: event.nowTick + event.countdownTicks,
      };
    case "go":
      return { ...state, phase: "match" };
    case "end":
      return applyEnd(state, event);
    case "return_to_lobby":
      return applyReturnToLobby(state, event.sessionId);
  }
}

function applyStart(
  state: FlowState,
  event: Extract<FlowEvent, { type: "start" }>,
): FlowState {
  const present = new Map(state.players.map((p) => [p.sessionId, p]));
  const roster = event.readyIds.filter((id) => present.get(id)?.status === "ready");
  const rosterSet = new Set(roster);

  return {
    ...state,
    phase: "car_select",
    carSelectDeadlineTick: event.nowTick + event.carSelectTicks,
    roster,
    players: state.players.map((p) =>
      rosterSet.has(p.sessionId)
        ? { ...p, status: "in_match", selectLocked: false, carId: "", alive: true }
        : p,
    ),
  };
}

function applyLockCar(state: FlowState, sessionId: string): FlowState {
  if (state.phase !== "car_select") return state;
  if (!state.roster.includes(sessionId)) return state;
  const target = state.players.find((p) => p.sessionId === sessionId);
  if (!target || target.selectLocked) return state;

  return {
    ...state,
    players: state.players.map((p) =>
      p.sessionId === sessionId ? { ...p, selectLocked: true } : p,
    ),
  };
}

function applyReveal(state: FlowState, cars: Record<string, string>): FlowState {
  const rosterSet = new Set(state.roster);
  let changed = false;
  const players = state.players.map((p) => {
    if (!rosterSet.has(p.sessionId)) return p;
    if (!Object.prototype.hasOwnProperty.call(cars, p.sessionId)) return p;
    const carId = cars[p.sessionId];
    if (p.carId === carId) return p;
    changed = true;
    return { ...p, carId };
  });
  if (!changed) return state;
  return { ...state, players };
}

function applyEnd(
  state: FlowState,
  event: Extract<FlowEvent, { type: "end" }>,
): FlowState {
  const present = new Set(state.players.map((p) => p.sessionId));
  const stillOnRoster = state.roster.filter((id) => present.has(id));
  const stillSet = new Set(stillOnRoster);

  const seen = new Set(state.postMatchIds);
  const postMatchIds = [...state.postMatchIds];
  for (const id of stillOnRoster) {
    if (seen.has(id)) continue;
    seen.add(id);
    postMatchIds.push(id);
  }

  return {
    ...state,
    phase: "lobby",
    winnerSessionId: event.winnerSessionId,
    winnerTeam: event.winnerTeam,
    postMatchIds,
    players: state.players.map((p) =>
      stillSet.has(p.sessionId) ? { ...p, status: "post_match" } : p,
    ),
  };
}

function applyReturnToLobby(state: FlowState, sessionId: string): FlowState {
  if (!state.postMatchIds.includes(sessionId)) return state;

  return {
    ...state,
    postMatchIds: state.postMatchIds.filter((id) => id !== sessionId),
    players: state.players.map((p) =>
      p.sessionId === sessionId ? { ...p, status: "ready" } : p,
    ),
  };
}
