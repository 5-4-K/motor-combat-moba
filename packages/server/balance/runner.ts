/**
 * The two shapes, because one experiment cannot answer both questions (B26).
 *
 * `ffa` seats a fixed 2/2/2 six-car match: equal representation makes the null hypothesis exactly
 * 33.3% and removes any need to normalize a win rate by how often a chassis appeared (B27).
 *
 * `duel` cycles all nine ordered chassis pairs. A six-way melee cannot answer "does Mirage beat
 * Bastion" — with five cars shooting each other every pairwise claim is confounded. The three
 * mirrors are kept deliberately: they MUST converge on 50%, so a mirror that does not is proof of
 * positional bias in the rig itself, not a finding about the game (B26a).
 */
import { activeCarIds, MAX_PLAYERS, TICK_RATE_HZ, type BotDifficulty, type CarId, type GameMode } from "@motor-combat-moba/shared";
import { deriveSeed } from "../src/bot/rng.js";
import { runMatch, type MatchOutcome, type MatchSetup } from "./match.js";

export type Shape = "ffa" | "duel";

export interface RunConfig {
  shape: Shape;
  matches: number;
  mode: GameMode;
  difficulty: BotDifficulty;
  seed: number;
  arenaId: string;
  matchSeconds: number;
}

/**
 * The active chassis roster, read from `CAR_TABLE` rather than a hardcoded literal (per the task
 * brief) — a fourth chassis (or a retired one) changes this list, and both shapes below follow it
 * with no edit here. `activeCarIds()` already respects `CarDef.isActive`.
 */
function chassisRoster(): CarId[] {
  return activeCarIds();
}

/**
 * The fixed FFA composition: as even a split of `MAX_PLAYERS` seats across the active roster as
 * division allows. At today's three-chassis roster that is 2/2/2 (six seats, B27's exact-1/3 null).
 *
 * If the roster ever stops dividing evenly into `MAX_PLAYERS`, this floors to the largest even split
 * rather than throwing or padding one chassis unevenly — a 4-chassis roster would seat 1 of each
 * (four seats, not six) instead of a lopsided 2/2/1/1 that would need its own null-hypothesis math.
 * That is a future call for whoever adds the fourth chassis, not a crash today.
 */
function ffaSeats(chassis: readonly CarId[]): { seats: MatchSetup["seats"]; label: string } {
  const seatsPerCar = Math.max(1, Math.floor(MAX_PLAYERS / chassis.length));
  const seats = chassis.flatMap((carId, carIndex) =>
    Array.from({ length: seatsPerCar }, (_, seatIndex) => ({
      sessionId: `${carId}-${carIndex}-${seatIndex}`,
      carId,
      team: 0 as const,
    })),
  );
  return { seats, label: `ffa ${chassis.map(() => seatsPerCar).join("/")}` };
}

/**
 * One ordered pair (attacker, defender) out of the `chassis.length ** 2` ordered pairs, selected by
 * `matchIndex mod chassis.length ** 2` — pure and cyclical, so a caller can hand any match index (not
 * just 0..8) and still land on a valid pair. At today's three-chassis roster this is the nine pairs
 * B26/B26a describe, mirrors included: index 0 is (a,a), and every `k`-th step where
 * `k = chassis.length` lands back on a mirror (0, 4, 8 at n=3).
 */
function duelSeats(chassis: readonly CarId[], matchIndex: number): { seats: MatchSetup["seats"]; label: string } {
  const n = chassis.length;
  const pairCount = n * n;
  const pairIndex = ((matchIndex % pairCount) + pairCount) % pairCount;
  const attacker = chassis[Math.floor(pairIndex / n)]!;
  const defender = chassis[pairIndex % n]!;
  return {
    seats: [
      { sessionId: "attacker", carId: attacker, team: 0 as const },
      { sessionId: "defender", carId: defender, team: 1 as const },
    ],
    label: `${attacker}-vs-${defender}`,
  };
}

/**
 * Deterministic seat assignment for one match of a shape, given only its position in the run.
 *
 * Pure and RNG-free by design (B26/B43): the seeded randomness this harness relies on for replay
 * lives entirely in `runMatch` (spawn shuffle, bot decisions), never here — who plays whom must be
 * decidable from `(shape, matchIndex)` alone, with nothing to seed.
 */
export function seatsFor(shape: Shape, matchIndex: number): { seats: MatchSetup["seats"]; label: string } {
  const chassis = chassisRoster();
  return shape === "ffa" ? ffaSeats(chassis) : duelSeats(chassis, matchIndex);
}

/**
 * Run a whole `RunConfig` to completion, one `runMatch` call per match.
 *
 * `ffa`: `config.matches` matches, each the same 2/2/2 composition (B27) but a different seed, so
 * spawn placement and every bot's draws still vary match to match.
 *
 * `duel`: `config.matches` matches PER ORDERED PAIR — the outer loop is `matches`, the inner is the
 * `chassis.length ** 2` pairs (nine at today's roster), so `totalMatches = matches * pairCount`, a
 * factor-of-nine surprise if you forget it (per the task brief). `seatsFor`'s own mod-`pairCount`
 * cycling means the flat, single running index `i` used below sweeps every pair once per `matches`
 * lap without the runner having to nest two loops itself.
 *
 * Every match gets its own seed via `deriveSeed(config.seed, "match", i)` off the single running
 * index `i` (not a per-shape counter), so no two matches in one run — `ffa` or `duel` — ever share a
 * seed. The same `RunConfig` replays identically (B43): `i` and everything derived from it are pure
 * functions of `config` alone.
 */
export function runAll(
  config: RunConfig,
  onMatch?: (i: number, total: number) => void,
): { outcomes: MatchOutcome[]; totalMatches: number } {
  const chassis = chassisRoster();
  const pairCount = chassis.length * chassis.length;
  const totalMatches = config.shape === "duel" ? config.matches * pairCount : config.matches;
  const maxTicks = config.matchSeconds * TICK_RATE_HZ;

  const outcomes: MatchOutcome[] = [];
  for (let i = 0; i < totalMatches; i++) {
    const { seats } = seatsFor(config.shape, i);
    const setup: MatchSetup = {
      seats,
      mode: config.mode,
      arenaId: config.arenaId,
      difficulty: config.difficulty,
      seed: deriveSeed(config.seed, "match", i),
      maxTicks,
    };
    outcomes.push(runMatch(setup));
    onMatch?.(i + 1, totalMatches);
  }

  return { outcomes, totalMatches };
}
