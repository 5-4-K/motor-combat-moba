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
import {
  CAR_TABLE,
  MAX_PLAYERS,
  TICK_RATE_HZ,
  activeCarIds,
  slotsOf,
  type BotDifficulty,
  type CarId,
  type GameMode,
} from "@motor-combat-moba/shared";
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
  /**
   * `--include-inactive`: also seat chassis whose `CarDef.isActive` is false, so a car still in
   * development can be measured before it is published.
   *
   * A fatal `--baseline` mismatch (see `baseline.ts`), not a cosmetic one: a run over seven chassis
   * and a run over three did not measure the same game, and every win rate in a Deltas table across
   * that boundary would be a roster change wearing a balance change's clothes.
   */
  includeInactive: boolean;
}

/**
 * The chassis roster for a run, read from `CAR_TABLE` rather than a hardcoded literal (per the task
 * brief) — a fourth chassis (or a retired one) changes this list, and both shapes below follow it
 * with no edit here.
 *
 * Default: `activeCarIds()`, which respects `CarDef.isActive`. With `--include-inactive`, unreleased
 * chassis join them — otherwise the one harness that answers "is this car too strong" is the one
 * harness that refuses to run it, which makes the flag it is gated behind useless for the job that
 * flag exists to do.
 *
 * **A chassis carrying no weapons is excluded either way.** An inactive car is allowed an empty kit
 * (that is how a chassis is prototyped before its weapons exist — see `weapon-slots.test.ts`), and
 * a car that cannot fire cannot win a match, cannot deal damage, and cannot lose a duel for any
 * reason a balance reader could act on. Seating one would not produce a weak result, it would
 * produce a meaningless one: a guaranteed 0% win rate that says nothing about the chassis and drags
 * every other car's number up around it. `isActive` cars always pass this filter — the shared suite
 * requires them to carry at least one weapon.
 */
export function chassisRoster(includeInactive: boolean): CarId[] {
  const ids = includeInactive ? (Object.keys(CAR_TABLE) as CarId[]) : activeCarIds();
  return ids.filter((id) => slotsOf(id).length > 0);
}

/**
 * The `MAX_PLAYERS` chassis that play FFA match `matchIndex`, when the roster is too big to seat at
 * once — a window of consecutive ids starting at `matchIndex % n` and wrapping.
 *
 * The offset steps by ONE per match, not by `MAX_PLAYERS`. Stepping by the window width looks
 * tidier and is subtly worse: the offsets it reaches are the multiples of `gcd(MAX_PLAYERS, n)`, so
 * at n=8 it visits only the even offsets and the run silently explores half the compositions it
 * could have. Stepping by one visits every offset, which makes the fairness claim trivial to state
 * and to check: over any `n` consecutive matches each chassis sits in exactly `MAX_PLAYERS` of them.
 */
function ffaWindow(chassis: readonly CarId[], matchIndex: number): CarId[] {
  const n = chassis.length;
  const start = ((matchIndex % n) + n) % n;
  return Array.from({ length: MAX_PLAYERS }, (_, k) => chassis[(start + k) % n]!);
}

/**
 * The FFA composition: as even a split of `MAX_PLAYERS` seats across the roster as division allows.
 * At today's three-chassis roster that is 2/2/2 (six seats, B27's exact-1/3 null).
 *
 * A roster that does not divide evenly floors to the largest even split rather than throwing or
 * padding one chassis unevenly — a 4-chassis roster seats 1 of each (four seats, not six) instead of
 * a lopsided 2/2/1/1 that would need its own null-hypothesis math.
 *
 * **Past `MAX_PLAYERS` chassis the roster stops fitting in a match at all**, and this used to be an
 * unhandled case rather than a designed one: `Math.max(1, ...)` produced one seat each, so seven
 * chassis built seven seats and `assignFfaSpawns` threw `"Not enough FFA spawns for roster"` — both
 * arenas author exactly six `ffaSpawns`. Unreachable while the roster was three cars; reachable the
 * moment `--include-inactive` exists. So the composition ROTATES instead (see `ffaWindow`): each
 * match seats a different six, one seat each, and every chassis gets identical seat-time over each
 * lap of `n` matches.
 *
 * Two consequences a reader of the report has to know, and `README.md` says both:
 *
 * - The null hypothesis is no longer `1 / n`. It is `1 / MAX_PLAYERS` — one seat in a six-car melee
 *   — for every chassis, which is what equal seat-time buys. `stats.ts` already divides wins by
 *   `carMatches` (matches the chassis APPEARED in, not matches run), so the win rates themselves
 *   need no correction; only the number you compare them against moves.
 * - Run `--matches` as a multiple of `n`, or the last partial lap gives some chassis one match more
 *   than others and the intervals stop being directly comparable.
 */
function ffaSeats(
  chassis: readonly CarId[],
  matchIndex: number,
): { seats: MatchSetup["seats"]; label: string } {
  const rotating = chassis.length > MAX_PLAYERS;
  const seated = rotating ? ffaWindow(chassis, matchIndex) : chassis;
  const seatsPerCar = rotating ? 1 : Math.max(1, Math.floor(MAX_PLAYERS / seated.length));
  const seats = seated.flatMap((carId, carIndex) =>
    Array.from({ length: seatsPerCar }, (_, seatIndex) => ({
      sessionId: `${carId}-${carIndex}-${seatIndex}`,
      carId,
      team: 0 as const,
    })),
  );
  const split = seated.map(() => seatsPerCar).join("/");
  return {
    seats,
    label: rotating ? `ffa ${split} (${seated.join(",")} of ${chassis.length})` : `ffa ${split}`,
  };
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
 * decidable from `(shape, matchIndex, chassis)` alone, with nothing to seed.
 *
 * `chassis` defaults to the published roster, which is what this function always used and what every
 * caller outside `runAll` still wants. `runAll` passes its own list so one run resolves the roster
 * once rather than per match.
 */
export function seatsFor(
  shape: Shape,
  matchIndex: number,
  chassis: readonly CarId[] = chassisRoster(false),
): { seats: MatchSetup["seats"]; label: string } {
  return shape === "ffa" ? ffaSeats(chassis, matchIndex) : duelSeats(chassis, matchIndex);
}

/**
 * Run a whole `RunConfig` to completion, one `runMatch` call per match.
 *
 * `ffa`: `config.matches` matches, each the same 2/2/2 composition (B27) but a different seed, so
 * spawn placement and every bot's draws still vary match to match. Past `MAX_PLAYERS` chassis the
 * composition rotates per match instead of staying fixed — see `ffaSeats`.
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
  const chassis = chassisRoster(config.includeInactive);
  const pairCount = chassis.length * chassis.length;
  const totalMatches = config.shape === "duel" ? config.matches * pairCount : config.matches;
  const maxTicks = config.matchSeconds * TICK_RATE_HZ;

  const outcomes: MatchOutcome[] = [];
  for (let i = 0; i < totalMatches; i++) {
    const { seats } = seatsFor(config.shape, i, chassis);
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
