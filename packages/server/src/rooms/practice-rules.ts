import {
  activeCarIds,
  type CarId,
  type InputMessage,
  type PracticeOpponent,
} from "@motor-combat-moba/shared";

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
 * May a practice room open right now? No, while a playground room is live — the mirror of
 * `shouldRefusePlayground`'s own guard (spec PR10). The tuning store the playground writes through
 * is a module-level singleton, one per server process rather than one per room, so a practice room
 * born while overrides are active would run its whole session on tables no arena is using.
 *
 * Only reachable on a `DEV_TOOLS=1` process: a release server never registers `PlaygroundRoom` (see
 * `index.ts`), so a release practice room can never be refused for this reason.
 *
 * Pure, and takes only the field it reads, so the rule is testable without a matchmaker.
 */
export function shouldRefusePracticeForPlayground(
  playgroundListings: readonly { clients: number }[],
): boolean {
  return playgroundListings.some((listing) => listing.clients > 0);
}

/**
 * The bot's chassis, resolved ONCE — from `onJoin`, the room's only join and so functionally its
 * creation (`maxClients = 1`, no reconnection) — and never re-rolled, not on respawn (PR15). Cars do
 * not change chassis mid-match, and neither does the bot.
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
 * Did the player actually do something with this input (PR27)?
 *
 * `ArenaScene.sendInputTick` sends one `InputMessage` per sim tick unconditionally — a parked car
 * with no key held still emits 30 neutral inputs a second. So "an input arrived" is not evidence of
 * presence; the room would never age while the tab sits open and focused. Only a non-neutral one —
 * the player actually steered, throttled, or fired — counts as "still here".
 */
export function isActiveInput(msg: InputMessage): boolean {
  return msg.steer !== 0 || msg.throttle !== 0 || msg.fireSlots !== 0;
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
