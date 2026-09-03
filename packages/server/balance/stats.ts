/**
 * Turns a batch of `MatchOutcome`s (Task 15) into the per-car and per-weapon numbers a human reads
 * and acts on. Everything here is derived, in one pass, from data the harness already collected —
 * no I/O, no new sim call, nothing that could disagree with the match that actually ran.
 *
 * Two design choices decide whether these numbers are honest:
 *
 * 1. **The press is the unit, not the hit.** The roster is not uniform — `pepperbox` fans three
 *    pellets from four muzzles, `lance` is a beam that can damage across many ticks, `wildcharge`
 *    lands its 250 through a single contact hit. Counting raw damage events would make a fan gun
 *    look many times more "accurate" than a beam that landed the same one decision to fire. A press
 *    (`FiredEvent.pressId`) is the one thing every weapon kind produces exactly once per trigger
 *    pull, so it is the only unit that makes hit rate comparable across weapon kinds (B30).
 * 2. **Every rate is an interval, never a bare percentage.** At the fixed 2/2/2 FFA composition
 *    (B27) the null win rate is exactly 33.3%, and over 100 matches the width of a 95% Wilson
 *    interval around that null is roughly ±9 points — so a chassis reading 38% win rate is not, by
 *    itself, evidence of anything. Printing `wilson()`'s interval alongside every rate is what stops
 *    this harness from being a generator of confident, wrong tuning advice (B35).
 */
import {
  CAR_TABLE,
  TICK_RATE_HZ,
  slotsOf,
  type CarId,
  type DamagedEvent,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { attributeSource, buildApplierMap } from "./attribution.js";
import type { MatchOutcome } from "./match.js";

export interface Interval {
  rate: number;
  low: number;
  high: number;
  n: number;
}

// 95% confidence — the level B35 is written against ("over 100 matches the interval is roughly ±9
// points"). Named rather than inlined so the confidence level this harness reports at is a single,
// greppable fact, not a number that means nothing without the derivation beside it.
const WILSON_Z_95 = 1.959964;

/**
 * A Wilson score interval for `successes` out of `n` trials, at the confidence level named by
 * `WILSON_Z_95` (95%). Preferred over a normal (Wald) approximation because Wald collapses to a
 * zero-width interval at p=0 or p=1 — exactly the small-`n`, extreme-rate case a rarely-pressed
 * weapon or an early playtest run produces — while Wilson stays honest there.
 *
 * `n = 0` has no data to bracket: returning a computed interval would print confidence about a rate
 * nobody observed, so it short-circuits to the origin instead of dividing by zero.
 */
export function wilson(successes: number, n: number): Interval {
  if (n === 0) return { rate: 0, low: 0, high: 0, n: 0 };

  const z = WILSON_Z_95;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const halfWidth = (z / denom) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));

  const clamp = (x: number): number => Math.min(1, Math.max(0, x));
  return {
    rate: clamp(p),
    low: clamp(centre - halfWidth),
    high: clamp(centre + halfWidth),
    n,
  };
}

export interface CarStats {
  carId: CarId;
  matches: number;
  wins: number;
  winRate: Interval;
  meanPlacement: number;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  meanAliveSeconds: number;
  phasedFraction: number;
}

export interface WeaponStats {
  weaponId: WeaponId;
  carId: CarId;
  presses: number;
  connectingPresses: number;
  hitRate: Interval;
  damage: number;
  derivedDamage: number;
  kills: number;
  damagePerPress: number;
  kitDamageShare: number;
  pressesPerMinute: number;
  meanFirstUseSeconds: number | null;
}

export interface MatchupCell {
  attacker: CarId;
  defender: CarId;
  winRate: Interval;
  meanTicks: number;
  meanWinnerHp: number;
}

export interface PaceStats {
  meanMatchSeconds: number;
  meanFirstBloodSeconds: number | null;
  killsPerMinute: number;
  clockFraction: number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The `pressId` on a `DamagedEvent`'s source, when it has one. Only `weapon`/`contact` sources do —
 * a `pulse` source (B5a's derived credit) never carries a `pressId`, because nothing about a status
 * pulse ties back to the one press that applied it. */
function pressIdOf(event: DamagedEvent): string | undefined {
  return event.source.kind === "weapon" || event.source.kind === "contact"
    ? event.source.pressId
    : undefined;
}

export function aggregate(outcomes: readonly MatchOutcome[]): {
  cars: CarStats[];
  weapons: WeaponStats[];
  matchups: MatchupCell[];
  pace: PaceStats;
} {
  const appliers = buildApplierMap(); // built once, passed down — not per event, not per match.

  // ---- per-car accumulators -------------------------------------------------------------------
  const carIds = Object.keys(CAR_TABLE) as CarId[];
  // `carMatches` counts a MATCH the chassis appeared in — once per outcome, however many of its
  // seats that chassis filled. Win rate's denominator has to be this, not seat count: at the fixed
  // 2/2/2 composition (B27) a chassis holds two of six seats but can still only WIN a given match
  // once, so counting seats would divide every win rate in half and silently move the null win
  // rate this file's own header argues for (33.3%) down to 16.7% while the report kept the old
  // label — the worst kind of wrong, because the printed number would look plausible.
  const carMatches = new Map<CarId, number>();
  // `carAppearances` counts a SEAT the chassis filled — the per-car-instance denominator for
  // `meanAliveSeconds` below. Deliberately different from `carMatches`: "how long did a life last,
  // on average" is a per-instance question (a mirror matchup fills two seats with the same chassis
  // in one match, and both lives count), unlike "did the chassis win the match," which cannot
  // happen twice no matter how many seats it holds.
  const carAppearances = new Map<CarId, number>();
  const carWins = new Map<CarId, number>();
  const carPlacements = new Map<CarId, number[]>();
  const carKills = new Map<CarId, number>();
  const carDeaths = new Map<CarId, number>();
  const carDamageDealt = new Map<CarId, number>();
  const carDamageTaken = new Map<CarId, number>();
  const carAliveTicks = new Map<CarId, number>();
  const carPhasedTicks = new Map<CarId, number>();
  for (const carId of carIds) {
    carMatches.set(carId, 0);
    carAppearances.set(carId, 0);
    carWins.set(carId, 0);
    carPlacements.set(carId, []);
    carKills.set(carId, 0);
    carDeaths.set(carId, 0);
    carDamageDealt.set(carId, 0);
    carDamageTaken.set(carId, 0);
    carAliveTicks.set(carId, 0);
    carPhasedTicks.set(carId, 0);
  }

  // ---- per-weapon accumulators, seeded from CAR_TABLE, not from the events (B31) ---------------
  // Every slot of every chassis gets a row up front so a weapon nobody ever pressed still shows up
  // in the output with `presses: 0` — the ONLY way an ignored weapon becomes visible, since no
  // damage figure will ever reveal it.
  const weaponCarOf = new Map<WeaponId, CarId>();
  const weaponPresses = new Map<WeaponId, number>();
  const weaponConnecting = new Map<WeaponId, number>();
  const weaponDamage = new Map<WeaponId, number>();
  const weaponDerivedDamage = new Map<WeaponId, number>();
  const weaponKills = new Map<WeaponId, number>();
  const weaponFirstUseSeconds = new Map<WeaponId, number[]>();
  for (const carId of carIds) {
    for (const weaponId of slotsOf(carId)) {
      weaponCarOf.set(weaponId, carId);
      weaponPresses.set(weaponId, 0);
      weaponConnecting.set(weaponId, 0);
      weaponDamage.set(weaponId, 0);
      weaponDerivedDamage.set(weaponId, 0);
      weaponKills.set(weaponId, 0);
      weaponFirstUseSeconds.set(weaponId, []);
    }
  }

  // ---- matchup accumulators (2-seat matches only — an ordered-pair concept has no meaning with
  // three or more cars shooting each other, per B26/B33's "duel shape") ---------------------------
  const matchupN = new Map<string, number>();
  const matchupWins = new Map<string, number>();
  const matchupTicks = new Map<string, number[]>();
  const matchupWinnerHp = new Map<string, number[]>();
  // `\x00` as an ESCAPE, never a literal NUL byte in the source: a raw control character makes git
  // treat this whole file as binary, which kills `git diff` on it forever. The runtime string is
  // the same. NUL is used rather than a printable separator because no `CarId` can contain it, so
  // the key cannot collide however the roster grows.
  const matchupKey = (attacker: CarId, defender: CarId): string => `${attacker}\x00${defender}`;

  // ---- pace accumulators -----------------------------------------------------------------------
  const matchSeconds: number[] = [];
  const firstBloodSeconds: number[] = [];
  let totalKills = 0;
  let hitClockCount = 0;

  for (const outcome of outcomes) {
    matchSeconds.push(outcome.ticks / TICK_RATE_HZ);
    if (outcome.hitClock) hitClockCount += 1;

    // ---- per-car bookkeeping, one seat at a time -------------------------------------------
    for (const seat of outcome.seats) {
      const carId = seat.carId;
      carAppearances.set(carId, (carAppearances.get(carId) ?? 0) + 1);
      // A draw (`winnerSessionId === ""`, whether from `livingSides`'/`deathmatchOutcome`'s own DRAW
      // or from `runMatch` hitting `maxTicks` with more than one side still standing — the
      // multi-survivor stalemate Task 15 flagged) never matches any real sessionId, so no seat is
      // ever credited a win for it. That is deliberate, not an oversight: a stalemate is a real
      // outcome for a balance harness (it says the matchup does not resolve), and crediting one side
      // a win it did not earn would hide exactly that signal.
      if (outcome.winnerSessionId !== "" && seat.sessionId === outcome.winnerSessionId) {
        carWins.set(carId, (carWins.get(carId) ?? 0) + 1);
      }
      carPlacements.get(carId)?.push(seat.placement);
      carKills.set(carId, (carKills.get(carId) ?? 0) + seat.kills);
      carDeaths.set(carId, (carDeaths.get(carId) ?? 0) + seat.deaths);
      carAliveTicks.set(carId, (carAliveTicks.get(carId) ?? 0) + seat.aliveTicks);
      carPhasedTicks.set(carId, (carPhasedTicks.get(carId) ?? 0) + seat.phasedTicks);
    }

    // `carMatches` increments once per DISTINCT chassis this outcome fielded, outside the per-seat
    // loop above — a mirror matchup (two seats, same carId) must still only count as one match for
    // that chassis's win-rate denominator, exactly like every other 2/2/2 match does.
    for (const carId of new Set(outcome.seats.map((s) => s.carId))) {
      carMatches.set(carId, (carMatches.get(carId) ?? 0) + 1);
    }

    // ---- damage dealt/taken per car, read straight off the events' own CarId fields --------
    // `DamagedEvent.attackerCarId`/`victimCarId` already name a chassis directly — no join through
    // a session needed, and this stays correct even in a mirror matchup where two seats share a
    // `carId`: both chassis performances pool into the same row, which is the point of a per-car
    // (not per-seat) stat.
    for (const event of outcome.events.damaged) {
      if (event.attackerCarId) {
        carDamageDealt.set(event.attackerCarId, (carDamageDealt.get(event.attackerCarId) ?? 0) + event.amount);
      }
      carDamageTaken.set(event.victimCarId, (carDamageTaken.get(event.victimCarId) ?? 0) + event.amount);
    }

    // ---- press connection: build the set of pressIds that landed at least one damage event once
    // per match (B30), then intersect it with this match's `fired` events per weapon. ------------
    const connectedPressIds = new Set<string>();
    for (const event of outcome.events.damaged) {
      const pressId = pressIdOf(event);
      if (pressId !== undefined) connectedPressIds.add(pressId);
    }

    for (const fired of outcome.events.fired) {
      weaponPresses.set(fired.weaponId, (weaponPresses.get(fired.weaponId) ?? 0) + 1);
      if (connectedPressIds.has(fired.pressId)) {
        weaponConnecting.set(fired.weaponId, (weaponConnecting.get(fired.weaponId) ?? 0) + 1);
      }
    }

    // First-use time per weapon: the earliest `fired.tick` for that weapon in this match, if any.
    const firstUseTick = new Map<WeaponId, number>();
    for (const fired of outcome.events.fired) {
      const existing = firstUseTick.get(fired.weaponId);
      if (existing === undefined || fired.tick < existing) firstUseTick.set(fired.weaponId, fired.tick);
    }
    for (const [weaponId, tick] of firstUseTick) {
      weaponFirstUseSeconds.get(weaponId)?.push(tick / TICK_RATE_HZ);
    }

    // ---- damage/derived-damage/kills per weapon, via attribution (B5a) ----------------------
    for (const event of outcome.events.damaged) {
      const { weaponId, derived } = attributeSource(event.source, appliers);
      if (weaponId === null) continue; // ambiguous or self/ownerInside-only source — bank nowhere.
      weaponDamage.set(weaponId, (weaponDamage.get(weaponId) ?? 0) + event.amount);
      if (derived) weaponDerivedDamage.set(weaponId, (weaponDerivedDamage.get(weaponId) ?? 0) + event.amount);
    }
    for (const event of outcome.events.killed) {
      // `totalKills` feeds `pace.killsPerMinute` — the headline pace number, and deliberately a
      // count of every kill the match RECORDED, not just the ones a weapon could be pinned on.
      // `weaponKills` is a different, narrower count (kills attributable to a specific weapon for
      // the per-weapon table) and correctly skips an unattributable kill. Today the only way a kill
      // reaches here with `weaponId === null` is a damaging status pulse with zero or more-than-one
      // applier (`overheated` currently has exactly one, `afterburner` — see attribution.ts's
      // header), but that is a fact about today's STATUS_TABLE, not a guarantee: a future damaging
      // pulse with a different applier count would silently vanish from `killsPerMinute` if this
      // counter lived inside the same `if` as `weaponKills`. Counting here, before the
      // attribution-only `continue`, keeps the two counters' denominators deliberately different: one
      // counts kills, the other counts kills a weapon can claim credit for.
      totalKills += 1;
      const { weaponId } = attributeSource(event.source, appliers);
      if (weaponId === null) continue;
      weaponKills.set(weaponId, (weaponKills.get(weaponId) ?? 0) + 1);
    }

    // Pace: first blood is the earliest kill tick in the match, if any car died at all.
    if (outcome.events.killed.length > 0) {
      const first = outcome.events.killed.reduce((min, k) => Math.min(min, k.tick), Infinity);
      firstBloodSeconds.push(first / TICK_RATE_HZ);
    }

    // ---- matchup matrix: only meaningful for a 2-seat match (a duel) — see B26/B33. Each seat
    // takes a turn as "attacker" against the other seat as "defender", so both ordered cells for
    // this pair get their `n` incremented once per match, symmetric by construction. -------------
    if (outcome.seats.length === 2) {
      const [s0, s1] = outcome.seats;
      if (s0 && s1) {
        for (const [self, other] of [
          [s0, s1],
          [s1, s0],
        ] as const) {
          const key = matchupKey(self.carId, other.carId);
          matchupN.set(key, (matchupN.get(key) ?? 0) + 1);
          if (outcome.winnerSessionId !== "" && self.sessionId === outcome.winnerSessionId) {
            matchupWins.set(key, (matchupWins.get(key) ?? 0) + 1);
          }
          const ticks = matchupTicks.get(key) ?? [];
          ticks.push(outcome.ticks);
          matchupTicks.set(key, ticks);
          // "Winner hp" is only meaningful when there was one — a draw contributes no sample rather
          // than a fabricated 0, which would understate every drawn pair's margin.
          if (outcome.winnerSessionId !== "") {
            const winnerSeat = outcome.winnerSessionId === s0.sessionId ? s0 : outcome.winnerSessionId === s1.sessionId ? s1 : undefined;
            if (winnerSeat) {
              const hps = matchupWinnerHp.get(key) ?? [];
              hps.push(winnerSeat.hp);
              matchupWinnerHp.set(key, hps);
            }
          }
        }
      }
    }
  }

  // ---- assemble CarStats -------------------------------------------------------------------
  const cars: CarStats[] = carIds.map((carId) => {
    const matches = carMatches.get(carId) ?? 0;
    const appearances = carAppearances.get(carId) ?? 0;
    const wins = carWins.get(carId) ?? 0;
    const aliveTicks = carAliveTicks.get(carId) ?? 0;
    const phasedTicks = carPhasedTicks.get(carId) ?? 0;
    return {
      carId,
      matches,
      wins,
      winRate: wilson(wins, matches),
      meanPlacement: mean(carPlacements.get(carId) ?? []),
      kills: carKills.get(carId) ?? 0,
      deaths: carDeaths.get(carId) ?? 0,
      damageDealt: carDamageDealt.get(carId) ?? 0,
      damageTaken: carDamageTaken.get(carId) ?? 0,
      // Denominator is `appearances` (seats filled), not `matches` (distinct matches) — a mean
      // SURVIVAL TIME is a per-life question. A mirror matchup fills two seats with this chassis in
      // one match and produces two independent lives to average over; dividing by `matches` instead
      // would silently double this number whenever a mirror matchup is in the sample.
      meanAliveSeconds: appearances > 0 ? aliveTicks / TICK_RATE_HZ / appearances : 0,
      // Per-car phased ticks over alive ticks (B28a) — not over match count, since a phased car is
      // still alive; the question this answers is "of the time this car COULD have been shot, what
      // share was it untargetable."
      phasedFraction: aliveTicks > 0 ? phasedTicks / aliveTicks : 0,
    };
  });
  const carById = new Map(cars.map((c) => [c.carId, c]));

  // ---- assemble WeaponStats ----------------------------------------------------------------
  const weapons: WeaponStats[] = [...weaponCarOf.entries()].map(([weaponId, carId]) => {
    const presses = weaponPresses.get(weaponId) ?? 0;
    const connecting = weaponConnecting.get(weaponId) ?? 0;
    const damage = weaponDamage.get(weaponId) ?? 0;
    const carTotalDamage = carById.get(carId)?.damageDealt ?? 0;
    const firstUses = weaponFirstUseSeconds.get(weaponId) ?? [];
    const carAlive = carAliveTicks.get(carId) ?? 0;
    return {
      weaponId,
      carId,
      presses,
      connectingPresses: connecting,
      hitRate: wilson(connecting, presses),
      damage,
      derivedDamage: weaponDerivedDamage.get(weaponId) ?? 0,
      kills: weaponKills.get(weaponId) ?? 0,
      damagePerPress: presses > 0 ? damage / presses : 0,
      // Within-kit share (B31's sibling concern): this weapon's damage over the TOTAL damage its
      // own chassis dealt, never over the whole roster's damage — a roster-wide share would move
      // every weapon's number whenever an unrelated chassis got buffed.
      kitDamageShare: carTotalDamage > 0 ? damage / carTotalDamage : 0,
      // Normalized by the chassis's own alive-time across every match it appeared in, since a
      // weapon can only be pressed while its car is alive and on the field.
      pressesPerMinute: carAlive > 0 ? presses / (carAlive / TICK_RATE_HZ / 60) : 0,
      meanFirstUseSeconds: firstUses.length > 0 ? mean(firstUses) : null,
    };
  });

  // ---- assemble MatchupCell rows -----------------------------------------------------------
  const matchups: MatchupCell[] = [];
  for (const attacker of carIds) {
    for (const defender of carIds) {
      const key = matchupKey(attacker, defender);
      const n = matchupN.get(key) ?? 0;
      const wins = matchupWins.get(key) ?? 0;
      matchups.push({
        attacker,
        defender,
        winRate: wilson(wins, n),
        meanTicks: mean(matchupTicks.get(key) ?? []),
        meanWinnerHp: mean(matchupWinnerHp.get(key) ?? []),
      });
    }
  }

  // ---- assemble PaceStats -------------------------------------------------------------------
  const totalMinutes = outcomes.length > 0 ? mean(matchSeconds) * outcomes.length / 60 : 0;
  const pace: PaceStats = {
    meanMatchSeconds: mean(matchSeconds),
    meanFirstBloodSeconds: firstBloodSeconds.length > 0 ? mean(firstBloodSeconds) : null,
    killsPerMinute: totalMinutes > 0 ? totalKills / totalMinutes : 0,
    clockFraction: outcomes.length > 0 ? hitClockCount / outcomes.length : 0,
  };

  return { cars, weapons, matchups, pace };
}
