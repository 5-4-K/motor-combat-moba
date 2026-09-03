import type { BotCarView, BotInstanceView } from "./types.js";

/**
 * One tick's world, exactly the two pieces `buildBotView` computes fresh from `ArenaState` every
 * call: every car (the viewing bot's own included — `buildBotView` filters `self` out at read time,
 * because who is "other" depends on who is asking, but the world itself does not) and every live
 * weapon instance. Plain POJOs, not a copy of the schema — `buildBotView` already turns `ArenaState`
 * into exactly this shape, so a snapshot is cheap to hold onto.
 */
export interface WorldSnapshot {
  readonly tick: number;
  readonly cars: readonly BotCarView[];
  readonly instances: readonly BotInstanceView[];
}

/**
 * A fixed-capacity ring of `WorldSnapshot`s, indexed by tick (B19 view staleness).
 *
 * Owned by the HOST, never by a bot or `buildBotView` itself — one ring per match/room, pushed once
 * per tick and shared across every bot deciding that tick, because "the world N ticks ago" does not
 * depend on which bot is asking. A host that only ever runs profiles at `viewStalenessTicks: 0`
 * (every profile, today) never has to construct one at all: `buildBotView`'s `stalenessTicks`
 * defaults to 0, which never touches this class or the ring it would otherwise read.
 *
 * `capacity` only needs to cover the largest `viewStalenessTicks` in play, plus one.
 */
export class ViewRing {
  private readonly buf: (WorldSnapshot | undefined)[];

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`ViewRing capacity must be a positive integer, got ${capacity}`);
    }
    this.buf = new Array(capacity);
  }

  /** Record this tick's world. Call once per tick — not once per bot deciding that tick. */
  push(snapshot: WorldSnapshot): void {
    this.buf[snapshot.tick % this.buf.length] = snapshot;
  }

  /**
   * The snapshot recorded for exactly this tick, or `undefined` when it has either aged out of the
   * ring (older than `capacity` ticks back) or never arrived (before the match's first push, or a
   * negative tick). Never returns a snapshot for the WRONG tick — the stored tick is checked, not
   * just the slot — so a ring that has not wrapped far enough yet reports "nothing" rather than a
   * stale answer from a stale slot.
   */
  at(tick: number): WorldSnapshot | undefined {
    if (tick < 0) return undefined;
    const slot = this.buf[tick % this.buf.length];
    return slot && slot.tick === tick ? slot : undefined;
  }
}
