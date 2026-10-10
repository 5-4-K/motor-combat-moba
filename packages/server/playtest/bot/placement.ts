/**
 * Deathmatch placement across a spread of seeds: hard Mirage vs Bastion on arena-01, 30 s, the
 * eight seeds `balance/match.test.ts` used to assert over (removed there 2026-10-10, TS11–TS14).
 *
 * The ranking RULE — more kills places ahead; equal kills, fewer deaths places ahead; equal on both
 * places equal — is now a seed-free unit test (`rankDeathmatch` in `balance/match.test.ts`). What is
 * left here is calibration: whether these particular seeds still produce at least one decisive
 * match, so the rule is exercised end to end on real outcomes rather than only on hand-built ones.
 * The seed history (1, 2, 3 and 4 decisive and 22, 41, 42 and 43 drawn as of the 2026-09-07 merge;
 * repinned after every brain or physics change that moved them) lives in that file's git history.
 *
 * `OK` when the rule holds on every outcome and at least one outcome was decisive; `FINDING` naming
 * which part failed otherwise.
 */
import { DEFAULT_GAME_MODE, GameMode, installMode, modeConfigOf } from "@motor-combat-moba/shared";
import { runMatch, type MatchOutcome } from "../../balance/match.js";
import { VERDICT } from "../common/reporter.js";

type Report = (probe: string, verdict: string, detail: string) => void;

/** `balance/match.test.ts`'s `SETUP`, run as a deathmatch. */
const SETUP = {
  seats: [
    { sessionId: "a", carId: "mirage", team: 0 },
    { sessionId: "b", carId: "bastion", team: 0 },
  ],
  mode: GameMode.FFA_DEATHMATCH,
  arenaId: "arena-01",
  difficulty: "hard",
  seed: 1,
  maxTicks: 30 * 60,
} as const;

const SEEDS = [1, 2, 3, 4, 22, 41, 42, 43] as const;

/** Every pair the ranking rule places wrongly in one outcome, as readable lines (empty when it holds). */
function ruleBreaches(out: MatchOutcome): string[] {
  const breaches: string[] = [];
  for (const a of out.seats) {
    for (const b of out.seats) {
      if (a.sessionId === b.sessionId) continue;
      const label = `${a.sessionId} (${a.kills}k/${a.deaths}d, #${a.placement}) vs ` +
        `${b.sessionId} (${b.kills}k/${b.deaths}d, #${b.placement})`;
      if (a.kills !== b.kills) {
        // More kills always places ahead, whatever the deaths say.
        const [ahead, behind] = a.kills > b.kills ? [a, b] : [b, a];
        if (!(ahead.placement < behind.placement)) breaches.push(`${label}: more kills did not place ahead`);
      } else if (a.deaths !== b.deaths) {
        const [ahead, behind] = a.deaths < b.deaths ? [a, b] : [b, a];
        if (!(ahead.placement < behind.placement)) breaches.push(`${label}: equal kills, fewer deaths did not place ahead`);
      } else if (a.placement !== b.placement) {
        // Tied on both counts is one result, not two adjacent ones — and in particular is never
        // broken by seat order, which is chassis order (`competitionRank`'s own doc).
        breaches.push(`${label}: tied on both counts but placed differently`);
      }
    }
  }
  return breaches;
}

export function run(report: Report): void {
  // `balance/match.test.ts` ran this under its `beforeEach` install of the default mode.
  installMode(modeConfigOf(DEFAULT_GAME_MODE));
  const lines: string[] = [];
  const breaches: string[] = [];
  let decisive = 0;
  for (const seed of SEEDS) {
    const out = runMatch({ ...SETUP, seed });
    const isDecisive = new Set(out.seats.map((s) => s.placement)).size > 1;
    if (isDecisive) decisive += 1;
    const seats = out.seats.map((s) => `${s.sessionId}/${s.carId} ${s.kills}k/${s.deaths}d #${s.placement}`).join(", ");
    lines.push(`seed ${seed}: ${seats}${isDecisive ? " (decisive)" : " (tie)"}`);
    for (const b of ruleBreaches(out)) breaches.push(`seed ${seed}: ${b}`);
  }

  const failures: string[] = [];
  if (breaches.length > 0) failures.push(`ranking rule broken on ${breaches.length} pair(s)`);
  if (decisive === 0) failures.push("no outcome was decisive, so the ordering branches never ran");
  report(
    `ranks placement by kills then fewest deaths in deathmatch (hard Mirage vs Bastion, arena-01, 30 s, ${SEEDS.length} seeds)`,
    failures.length === 0 ? VERDICT.OK : VERDICT.FINDING,
    [
      `decisive ${decisive}/${SEEDS.length}`,
      ...lines,
      ...breaches.map((b) => `BREACH: ${b}`),
      ...failures.map((f) => `FAILED: ${f}`),
    ].join("\n"),
  );
}
