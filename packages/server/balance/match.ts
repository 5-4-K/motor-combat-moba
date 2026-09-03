/**
 * One headless match, assembled from the EXACT pieces `ArenaRoom.tick` runs — minus Colyseus.
 *
 * `ArenaRoom` also owns a lobby, car select, and a reveal grid; none of that is simulated here.
 * A match starts already in `RoomPhase.MATCH` with cars placed and armed, which is what
 * `ArenaRoom.revealCars` hands off to the countdown for in a real room. What follows is the same
 * `statusTick -> serverTick -> contactTick -> combat` pipeline (`runPipeline`), the same respawn
 * lifecycle (`respawnSweep`, run inside `runPipeline` via `combatTick`'s `phaseEndSweep`), and the
 * same win rule (`winRuleOf`, `deathmatchEnded`/`deathmatchOutcome`, `livingSides`) the room itself
 * reads. A harness with its own copy of any of that would be measuring a game nobody plays.
 */
import {
  ArenaState,
  DEATHMATCH_TICKS,
  GameMode,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  assignSpawns,
  deathmatchEnded,
  deathmatchOutcome,
  getArena,
  hpOf,
  livingSides,
  newCombatEvents,
  sidesOf,
  winRuleOf,
  type BotDifficulty,
  type CarId,
  type CombatEvents,
  type DeathmatchPlayer,
  type InputMessage,
  type LivingPlayer,
} from "@motor-combat-moba/shared";
import { buildBotView, deriveSeed, makeRng, LegacyController, type Rng } from "../src/bot/index.js";
import { newCombatMemory, type CombatMemory } from "../src/sim/combat-bridge.js";
import { newContactMemory, type ContactMemory } from "../src/sim/ram-bridge.js";
import { respawnSweep, runPipeline, type PipelineCtx } from "../src/rooms/tick-pipeline.js";

export interface MatchSetup {
  seats: readonly { sessionId: string; carId: CarId; team: 0 | 1 }[];
  mode: GameMode;
  arenaId: string;
  difficulty: BotDifficulty;
  seed: number;
  maxTicks: number;
}

export interface MatchOutcome {
  ticks: number;
  winnerSessionId: string;
  winnerTeam: number;
  /**
   * The match ran out of `maxTicks` without its own win rule ever firing — the harness's safety
   * valve, not a real conclusion. Expected in Deathmatch whenever `maxTicks` is shorter than
   * `DEATHMATCH_TICKS.match`, and otherwise a sign a scenario is set up to stalemate.
   */
  hitClock: boolean;
  seats: readonly {
    sessionId: string;
    carId: CarId;
    kills: number;
    deaths: number;
    aliveTicks: number;
    placement: number;
  }[];
  events: CombatEvents;
}

/**
 * Run one match to a conclusion (or to `setup.maxTicks`, whichever comes first) and report what
 * happened.
 *
 * Every random draw in this function's reach is seeded — `assignSpawns`'s shuffle and each seat's
 * bot both come from `makeRng`/`deriveSeed` off `setup.seed`, and nothing here ever calls
 * `Math.random()` or reads the wall clock. That is what lets the same seed replay identically
 * (B43) and a paired seed comparison mean something.
 */
export function runMatch(setup: MatchSetup): MatchOutcome {
  const spawnRng = makeRng(setup.seed);
  const deathmatch = winRuleOf(setup.mode) === "deathmatch";

  const state = new ArenaState();
  state.arenaId = setup.arenaId;
  state.phase = RoomPhase.MATCH;
  state.mode = setup.mode;
  // The room writes this only on the edge into MATCH (`ArenaRoom.applyFlow`) — a headless match
  // opens already on that edge, so it is stamped once, here, the same value that edge would produce.
  state.matchEndsTick = deathmatch ? DEATHMATCH_TICKS.match : 0;

  const matchRoster = new Set(setup.seats.map((seat) => seat.sessionId));
  const inputQueues = new Map<string, InputMessage[]>();
  const prevFireMasks = new Map<string, number>();
  const phaseCaps = new Map<string, number>();
  const combat: CombatMemory = newCombatMemory();
  const ram: ContactMemory = newContactMemory();
  const events = newCombatEvents();

  // The same call `ArenaRoom.revealCars` makes to open a real match: one shuffle of the arena's own
  // spawn points, seeded rather than `Math.random`.
  const spawns = assignSpawns(
    getArena(setup.arenaId),
    setup.mode,
    setup.seats.map((seat) => ({ sessionId: seat.sessionId, team: seat.team })),
    spawnRng,
  );

  const bots = new Map<string, LegacyController>();
  const botRngs = new Map<string, Rng>();
  const seqs = new Map<string, number>();

  for (const [slot, seat] of setup.seats.entries()) {
    const spawn = spawns[seat.sessionId];
    if (!spawn) throw new Error(`no spawn assigned for seat ${seat.sessionId}`);

    // Built exactly as `PlaytestWorld.add` builds a headless car — see its own comment for why: the
    // same fields `revealCars` sets on a real reveal, minus anything only a live room needs.
    const player = new PlayerState();
    player.sessionId = seat.sessionId;
    player.name = seat.sessionId;
    player.carId = seat.carId;
    player.team = seat.team;
    player.status = PlayerStatus.IN_MATCH;
    player.alive = true;
    player.hp = hpOf(seat.carId);
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = spawn.angle;
    player.speed = 0;
    player.authority = 1;
    state.players.set(seat.sessionId, player);

    inputQueues.set(seat.sessionId, []);
    prevFireMasks.set(seat.sessionId, 0);
    seqs.set(seat.sessionId, 0);

    bots.set(seat.sessionId, new LegacyController(setup.difficulty));
    // A distinct, seeded stream per seat rather than one shared stream: two seats sharing an RNG
    // would have each bot's draw depend on the other's turn order, which is not what "seat 0's bot"
    // is supposed to mean.
    botRngs.set(seat.sessionId, makeRng(deriveSeed(setup.seed, "seat", slot)));
  }

  /**
   * Built fresh at every call, never cached — `PipelineCtx`'s own doc comment is why: nothing here
   * reassigns `matchRoster` or `ram` mid-match, but caching one anyway would be the exact hazard the
   * type warns every caller off of.
   */
  const ctx = (): PipelineCtx => ({
    state,
    inputQueues,
    prevFireMasks,
    matchRoster,
    phaseCaps,
    combat,
    ram,
    hz: TICK_RATE_HZ,
    // `phaseEndSweep` runs inside `runPipeline` when this is set — same flag `ArenaRoom.ctx` derives
    // from `winRuleOf`, and the harness must not call `phaseEndSweep` a second time itself: it would
    // double-apply the same tick's phase decision (a `refresh` branch would extend spawn protection
    // twice in one tick).
    runPhaseSweep: deathmatch,
    events,
  });

  const aliveTicks = new Map<string, number>(setup.seats.map((seat) => [seat.sessionId, 0]));
  // Last-standing only: session ids in the order they died, first death first. Deathmatch never
  // touches this — kills/deaths already rank it, and a respawning car "dies" many times.
  const eliminationOrder: string[] = [];

  let concluded = false;
  let winnerSessionId = "";
  let winnerTeam = -1;

  while (state.tick < setup.maxTicks) {
    state.tick += 1;

    // Top of the tick, before statuses — same placement `ArenaRoom.tick` and `PracticeRoom.tick`
    // use, and the comment on `respawnSweep` explains why: the modifiers derived moments later must
    // already reflect a freshly respawned car's `phased` status.
    if (deathmatch) respawnSweep(ctx());

    for (const seat of setup.seats) {
      const queue = inputQueues.get(seat.sessionId);
      const bot = bots.get(seat.sessionId);
      const rng = botRngs.get(seat.sessionId);
      if (!queue || !bot || !rng) continue;

      const view = buildBotView({ state, selfSessionId: seat.sessionId, combat, rng });
      if (!view) continue;

      const seq = (seqs.get(seat.sessionId) ?? 0) + 1;
      seqs.set(seat.sessionId, seq);
      queue.push({ seq, ...bot.decide(view) });
    }

    runPipeline(ctx());

    for (const seat of setup.seats) {
      const player = state.players.get(seat.sessionId);
      if (!player) continue;
      if (player.alive) {
        aliveTicks.set(seat.sessionId, (aliveTicks.get(seat.sessionId) ?? 0) + 1);
      } else if (!deathmatch && !eliminationOrder.includes(seat.sessionId)) {
        eliminationOrder.push(seat.sessionId);
      }
    }

    // The win check is the room's, not the harness's (B29) — the same two calls `ArenaRoom.tick`
    // makes, on the state combat just wrote.
    if (deathmatch) {
      if (deathmatchEnded(matchRoster.size, state.tick, state.matchEndsTick)) {
        const outcome = deathmatchOutcome(deathmatchPlayers(setup, state));
        winnerSessionId = outcome.winnerSessionId;
        winnerTeam = outcome.winnerTeam;
        concluded = true;
        break;
      }
    } else {
      const outcome = livingSides(sidesOf(setup.mode), livingPlayers(setup, state));
      if (outcome.sides <= 1) {
        winnerSessionId = outcome.winnerSessionId;
        winnerTeam = outcome.winnerTeam;
        concluded = true;
        break;
      }
    }
  }

  const placements = placementsFor(setup, state, deathmatch, eliminationOrder);

  const seats = setup.seats.map((seat) => {
    const player = state.players.get(seat.sessionId);
    return {
      sessionId: seat.sessionId,
      carId: seat.carId,
      kills: player?.kills ?? 0,
      deaths: player?.deaths ?? 0,
      aliveTicks: aliveTicks.get(seat.sessionId) ?? 0,
      placement: placements.get(seat.sessionId) ?? setup.seats.length,
    };
  });

  return {
    ticks: state.tick,
    winnerSessionId,
    winnerTeam,
    hitClock: !concluded,
    seats,
    events,
  };
}

function deathmatchPlayers(setup: MatchSetup, state: ArenaState): DeathmatchPlayer[] {
  return setup.seats.map((seat) => {
    const player = state.players.get(seat.sessionId);
    return {
      sessionId: seat.sessionId,
      kills: player?.kills ?? 0,
      deaths: player?.deaths ?? 0,
      inRoster: true,
    };
  });
}

function livingPlayers(setup: MatchSetup, state: ArenaState): LivingPlayer[] {
  return setup.seats.map((seat) => {
    const player = state.players.get(seat.sessionId);
    return {
      sessionId: seat.sessionId,
      team: seat.team,
      alive: player?.alive ?? false,
      inRoster: true,
    };
  });
}

/**
 * Rank every seat, 1 first.
 *
 * Deathmatch: `deathmatchOutcome`'s own rule — most kills, then fewest deaths — applied across the
 * whole roster rather than just its winner, so every seat gets a place instead of only the top one.
 *
 * Last standing: elimination order. The survivor (or, on a drawn/clock-hit ending, whoever is still
 * alive) places first; everyone else places by reverse death order — the car that lasted longest
 * among the losers is the runner-up, the first car out finishes last.
 */
function placementsFor(
  setup: MatchSetup,
  state: ArenaState,
  deathmatch: boolean,
  eliminationOrder: readonly string[],
): Map<string, number> {
  const placements = new Map<string, number>();

  if (deathmatch) {
    const ranked = deathmatchPlayers(setup, state).sort(
      (a, b) => b.kills - a.kills || a.deaths - b.deaths,
    );
    ranked.forEach((player, index) => placements.set(player.sessionId, index + 1));
    return placements;
  }

  const eliminated = new Set(eliminationOrder);
  const survivors = setup.seats
    .map((seat) => seat.sessionId)
    .filter((sessionId) => !eliminated.has(sessionId));
  const order = [...survivors, ...[...eliminationOrder].reverse()];
  order.forEach((sessionId, index) => placements.set(sessionId, index + 1));
  return placements;
}
