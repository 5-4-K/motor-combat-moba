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
  GameMode,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  TICK_RATE_HZ,
  assignSpawns,
  deathmatchEnded,
  deathmatchOutcome,
  getArena,
  hasStatus,
  hpOf,
  livingSides,
  newCombatEvents,
  sidesOf,
  winRuleOf,
  type BotDifficulty,
  type CarId,
  type CombatEvents,
  type DeathmatchPlayer,
  type FiredEvent,
  type InputMessage,
  type LivingPlayer,
} from "@motor-combat-moba/shared";
import { buildBotView, deriveSeed, makeRng, HumanController, type Rng } from "../src/bot/index.js";
import { newCombatMemory, type CombatMemory } from "../src/sim/combat-bridge.js";
import { newContactMemory, type ContactMemory } from "../src/sim/ram-bridge.js";
import { readStatuses } from "../src/sim/status-bridge.js";
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
   * `true` when the match loop exited on `setup.maxTicks` rather than a win rule ever concluding it
   * (`concluded` stays `false`). What that MEANS — and whether it can even happen — depends on the
   * mode, because Deathmatch's clock IS `maxTicks` here (`state.matchEndsTick = setup.maxTicks`,
   * see below):
   *
   * - **Deathmatch**: this field is `false` in EVERY match this harness runs, by construction, not
   *   by observation. `deathmatchEnded`'s own clock check fires the moment `state.tick` reaches
   *   `state.matchEndsTick` — which is the same value as `setup.maxTicks` here — so the loop's win
   *   check always concludes the match (`concluded = true`) on the very tick the loop condition
   *   would otherwise have exited on anyway; there is no tick at which the loop can run out first.
   *   A reader should not expect this to ever read `true` for Deathmatch, and a report's "Hit the
   *   clock" column is marked not-applicable for the mode for exactly this reason (`report.ts`) —
   *   it is not a stalemate signal here, because Deathmatch has no OTHER way to end: it is timed,
   *   `deathmatchOutcome`'s kills-then-deaths ranking always names a real winner or a real tie at
   *   that same tick, and reaching the clock is not a sign anything failed to resolve.
   * - **Last standing**: still the harness's safety valve, and the only mode where this field
   *   carries information. This mode has no clock of its own (`matchEndsTick` stays 0), so hitting
   *   `maxTicks` here means `livingSides` never dropped to one side — a genuine stalemate, and a
   *   sign a scenario is set up to never resolve within the cap.
   */
  hitClock: boolean;
  seats: readonly {
    sessionId: string;
    carId: CarId;
    kills: number;
    deaths: number;
    aliveTicks: number;
    /**
     * Ticks this seat spent alive AND `phased` (Task 17 / B28a). Outside Deathmatch no car is ever
     * `phased` (CLAUDE.md), so this is always 0 for `FFA_LAST_STANDING` — tracked here rather than
     * derived after the fact because `phased` is a per-tick status-list fact that only exists while
     * `state` is live; once the match ends there is no later point to reconstruct it from.
     */
    phasedTicks: number;
    /**
     * Hp remaining when the match concluded (or when `maxTicks` was hit). Feeds the matchup
     * matrix's "mean winner hp" (B33) — the difference between a duel that was walked and one that
     * was barely edged out, which a win rate alone cannot show. Meaningful mainly in last-standing:
     * Deathmatch respawns reset hp to full, so a deathmatch seat's final hp says little about how
     * the match actually went.
     */
    hp: number;
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
  // The harness's own match length IS the deathmatch clock, rather than the game's default 180 s
  // (`DEATHMATCH_TICKS.match`). A real room always runs the full 180 s, so `ArenaRoom.applyFlow`
  // stamps that constant on the edge into MATCH — but this harness's loop cap is `setup.maxTicks`,
  // and for any `matchSeconds` under 180 the loop would exit on that cap before `deathmatchEnded`
  // ever fires. Every match would record a draw (`winnerSessionId: ""`) and per-car win rate — the
  // harness's headline statistic — would always read 0%, silently, for exactly the shortened runs
  // the plan offers for fast iteration (`--match-seconds`). The win RULE stays the room's own
  // (`deathmatchEnded`, `deathmatchOutcome`) — only the clock it reads is the harness's.
  state.matchEndsTick = deathmatch ? setup.maxTicks : 0;

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

  const bots = new Map<string, HumanController>();
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

    bots.set(seat.sessionId, new HumanController(setup.difficulty));
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
  // Task 17's `phasedFraction` denominator's numerator — see the field's doc comment on
  // `MatchOutcome.seats` for why this has to be counted live, tick by tick, rather than after the
  // match ends.
  const phasedTicks = new Map<string, number>(setup.seats.map((seat) => [seat.sessionId, 0]));
  // Last-standing only: the tick each seat first died on. Deathmatch never touches this — kills/
  // deaths already rank it, and a respawning car "dies" many times. Recording the TICK rather than
  // just an order lets `placementsFor` tell "died first" apart from "died on the same tick as
  // someone else" (see `competitionRank`) — an order-only list cannot represent that tie at all.
  const deathTick = new Map<string, number>();

  let concluded = false;
  let winnerSessionId = "";
  let winnerTeam = -1;

  // B18: the harness is the ONLY host that turns `observedFires` on — `ArenaRoom` and `PracticeRoom`
  // pass nothing, correctly (B3, `BotView.observedFires`'s own doc comment), because neither
  // collects combat events at all. This harness already holds `events` (`CombatEvents`), so it is
  // the one place populating this is free.
  //
  // `firedCursor` is the length of `events.fired` as of the end of the PREVIOUS tick's
  // `runPipeline`. Every bot's view this tick is built BEFORE `runPipeline` runs (its input is
  // needed for the tick about to be simulated), so the only fires that exist yet are last tick's —
  // which is also the honest model: a human sees a shot after it happens, not the instant it does.
  // Tracking a cursor and slicing the tail is O(new fires) per tick; re-filtering the whole
  // accumulated log by tick every tick would be O(all fires ever) per tick.
  let firedCursor = 0;
  let previousTickFires: readonly FiredEvent[] = [];

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

      const view = buildBotView({
        state, selfSessionId: seat.sessionId, combat, rng, observedFires: previousTickFires,
      });
      if (!view) continue;

      const seq = (seqs.get(seat.sessionId) ?? 0) + 1;
      seqs.set(seat.sessionId, seq);
      queue.push({ seq, ...bot.decide(view) });
    }

    runPipeline(ctx());

    // New fires from the tick `runPipeline` just simulated, ready for NEXT tick's views.
    previousTickFires = events.fired.slice(firedCursor);
    firedCursor = events.fired.length;

    for (const seat of setup.seats) {
      const player = state.players.get(seat.sessionId);
      if (!player) continue;
      if (player.alive) {
        aliveTicks.set(seat.sessionId, (aliveTicks.get(seat.sessionId) ?? 0) + 1);
        if (hasStatus(readStatuses(player), "phased", state.tick)) {
          phasedTicks.set(seat.sessionId, (phasedTicks.get(seat.sessionId) ?? 0) + 1);
        }
      } else if (!deathmatch && !deathTick.has(seat.sessionId)) {
        deathTick.set(seat.sessionId, state.tick);
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

  const placements = placementsFor(setup, state, deathmatch, deathTick);

  const seats = setup.seats.map((seat) => {
    const player = state.players.get(seat.sessionId);
    return {
      sessionId: seat.sessionId,
      carId: seat.carId,
      kills: player?.kills ?? 0,
      deaths: player?.deaths ?? 0,
      aliveTicks: aliveTicks.get(seat.sessionId) ?? 0,
      phasedTicks: phasedTicks.get(seat.sessionId) ?? 0,
      hp: player?.hp ?? 0,
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
 * Competition ranking ("1224" style): items that compare equal under `compareBetter` share the
 * SAME place, and the next distinct place skips ahead by however many items tied for the one
 * before it (two-way tie for 1st is followed by 3rd, not 2nd). This is deliberate over dense
 * ranking (which would give that same pair 1st and then 2nd) because it matches how
 * `deathmatchOutcome` and a scoreboard both already read a tie: two seats with identical
 * kills/deaths are the same result, not two adjacent results, and dense ranking would still let a
 * later, unrelated seat's place depend on how many ties happened to precede it.
 *
 * `compareBetter(a, b)` must return negative when `a` outranks `b`, positive when `b` outranks `a`,
 * and exactly `0` when they are tied — `0` is what triggers the shared placement, so the tie test
 * has to be exact, not "close enough". `Array.prototype.sort` is stable (guaranteed since ES2019),
 * so items that tie keep their input order for iteration purposes, but because they receive the
 * same `place` number that input order never reaches the OUTPUT — this is what fixes the bug this
 * function used to have: `setup.seats` order (== chassis seating order, see this file's header)
 * used to be silently promoted into a tiebreaker any time two seats matched on kills and deaths.
 */
function competitionRank<T>(
  items: readonly T[],
  compareBetter: (a: T, b: T) => number,
  idOf: (item: T) => string,
): Map<string, number> {
  const sorted = [...items].sort(compareBetter);
  const placements = new Map<string, number>();
  let place = 1;
  sorted.forEach((item, index) => {
    if (index > 0 && compareBetter(sorted[index - 1]!, item) !== 0) {
      place = index + 1;
    }
    placements.set(idOf(item), place);
  });
  return placements;
}

/**
 * Rank every seat, 1 first. Ties share a place (competition ranking, see `competitionRank`) rather
 * than being broken by `setup.seats` order — that order is chassis seating order (`ffaSeats` in
 * `runner.ts` groups by `activeCarIds()`), so breaking ties by it would silently turn "who is
 * listed first" into a per-chassis signal the "Mean placement" column has no business carrying.
 *
 * Deathmatch: `deathmatchOutcome`'s own rule — most kills, then fewest deaths — applied across the
 * whole roster rather than just its winner, so every seat gets a place instead of only the top one.
 * Two seats tied on both counts (commonly 0 kills / 0 deaths, in a short run) now tie in placement
 * too, instead of the lower-indexed seat winning the tie by table position.
 *
 * Last standing: ranked by how long each seat survived — `deathTick` (undefined for a seat that was
 * never eliminated, i.e. the winner, or every seat still alive on a drawn/clock-hit stalemate) —
 * rather than the old elimination-ORDER list, because ORDER alone could not represent two cars
 * dying on the same tick as a tie: it always recorded whichever seat's turn came first that tick,
 * which was again `setup.seats` order. Surviving (or co-surviving, on a stalemate) places first;
 * everyone else places by how late their death tick was, ties included.
 */
function placementsFor(
  setup: MatchSetup,
  state: ArenaState,
  deathmatch: boolean,
  deathTick: ReadonlyMap<string, number>,
): Map<string, number> {
  if (deathmatch) {
    return competitionRank(
      deathmatchPlayers(setup, state),
      (a, b) => b.kills - a.kills || a.deaths - b.deaths,
      (player) => player.sessionId,
    );
  }

  return competitionRank(
    setup.seats,
    (a, b) => {
      const tickA = deathTick.get(a.sessionId);
      const tickB = deathTick.get(b.sessionId);
      if (tickA === tickB) return 0; // both undefined (both survived), or died the same tick
      if (tickA === undefined) return -1; // a survived, b did not: a outranks b
      if (tickB === undefined) return 1; // b survived, a did not: b outranks a
      return tickB - tickA; // later death tick outranks (survived longer)
    },
    (seat) => seat.sessionId,
  );
}
