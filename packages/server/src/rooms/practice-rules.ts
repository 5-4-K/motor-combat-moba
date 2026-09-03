import { activeCarIds, type CarId, type PracticeOpponent } from "@motor-combat-moba/shared";

/**
 * May another practice room open right now (spec PR29)?
 *
 * Pure, and takes only the count it reads, so the rule is testable without a matchmaker. Refuses AT
 * the cap: a cap of 6 means six rooms exist, not seven.
 *
 * Known and accepted (PR29): two simultaneous `onCreate` calls can both pass this, the same race
 * `shouldRefusePlayground` already carries. Closing it needs a lock the rest of the server does not
 * have, for a failure mode requiring two people to press Start in the same millisecond.
 */
export function shouldRefusePractice(listings: readonly unknown[], cap: number): boolean {
  return listings.length >= cap;
}

/**
 * The bot's chassis, resolved ONCE at room creation and never re-rolled — not on respawn (PR15).
 * Cars do not change chassis mid-match, and neither does the bot.
 *
 * Draws only from ACTIVE chassis, so a car hidden from car select cannot appear in practice either.
 * `Math.min` guards a roll of exactly 1, which `Math.random` never returns but an injected rng in a
 * test does.
 */
export function resolveOpponentCar(opponent: PracticeOpponent, rng: () => number): CarId {
  if (opponent !== "random") return opponent;
  const active = activeCarIds();
  const index = Math.min(active.length - 1, Math.floor(rng() * active.length));
  return active[index]!;
}

/**
 * Has this session gone quiet long enough to close (PR27)?
 *
 * Wall clock, deliberately, and NOT sim ticks: pause freezes `state.tick`, so a tick-based counter
 * would never advance for a paused room — the exact case most worth reaping.
 */
export function isPracticeIdle(
  lastInputAtMs: number,
  nowMs: number,
  timeoutSeconds: number,
): boolean {
  return nowMs - lastInputAtMs >= timeoutSeconds * 1000;
}

/**
 * Is the player inside the warning window (PR28)? Stays true all the way to the close rather than
 * firing on one exact millisecond, so a tick that lands late cannot skip the warning entirely; the
 * room sends it once and latches (see `PracticeRoom.warnedOfIdle`).
 */
export function isIdleWarningDue(
  lastInputAtMs: number,
  nowMs: number,
  timeoutSeconds: number,
  warningSeconds: number,
): boolean {
  return nowMs - lastInputAtMs >= (timeoutSeconds - warningSeconds) * 1000;
}
