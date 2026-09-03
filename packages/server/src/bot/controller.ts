import type { BotDifficulty } from "@motor-combat-moba/shared";
import { BOT_PROFILES, type BotProfile } from "../config/bot-profiles.js";
import { botInput, pulsedFireSlots, shouldRecomputeIntent } from "./input.js";
import type { BotController, BotIntent, BotView } from "./types.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

/**
 * Today's chaser, statefully (B22).
 *
 * This is the ONLY controller this work ships, and it is deliberately not an improvement: it
 * reproduces the bot that both rooms already run, so their existing tests are what prove the
 * migration in the next two tasks changed nothing. Bot intelligence is a separate session's work
 * (B2) — replacing `decide` is the whole of it.
 *
 * ONE exception to "reproduces the bot that shipped", added 2026-09-04: `triggerRangeOf` in
 * `input.ts` lets a `range: 0` weapon be pressed at all. `wildcharge` was gated on
 * `distance < 0` and so had never been pressed by any bot, in any room, since it shipped — Bastion
 * fought with two thirds of its kit. That is a defect, not a behaviour worth reproducing, and it is
 * the only divergence: every weapon with a real range is gated exactly as before.
 *
 * What moved INTO the bot here is the cadence and the fire pulse, which lived in each room. That
 * overturns `PlaygroundRoom`'s comment calling the pulse "the room's decision... exactly as a real
 * client's key state does" — under an instance model the bot IS the client, and holds its own key
 * state (B11).
 */
export class LegacyController implements BotController {
  readonly profileId: BotDifficulty;
  private readonly profile: BotProfile;
  private held: BotIntent | undefined;
  private fixedTarget: string | undefined;
  private target: string | undefined;
  // Reaction delay (B19): a FIFO of intents already decided but not yet "felt" by the bot's hands.
  // Untouched — never pushed to, never read — while `reactionDelayTicks` is 0, which is every
  // profile in this work; see `applyReactionDelay`.
  private readonly delayLine: BotIntent[] = [];

  constructor(
    profileId: BotDifficulty,
    options: { targetSessionId?: string; profile?: BotProfile } = {},
  ) {
    this.profileId = profileId;
    // `profile` override exists for tests that need a profile shape `BOT_PROFILES` cannot express
    // (e.g. B19's two knobs genuinely absent, not merely 0) without reaching past this class's own
    // constructor. No production caller passes it — both rooms and the harness look a difficulty up
    // through `profileId` exactly as before.
    this.profile = options.profile ?? BOT_PROFILES[profileId];
    this.fixedTarget = options.targetSessionId;
  }

  /** Who this bot is shooting at, for a report's diagnostics. `undefined` when it has no target. */
  get currentTargetSessionId(): string | undefined {
    return this.target;
  }

  /** Point the bot at one specific car, or `undefined` to pick the nearest living solid enemy. */
  setTarget(sessionId: string | undefined): void {
    this.fixedTarget = sessionId;
  }

  decide(view: BotView): BotIntent {
    const target = this.pickTarget(view);
    this.target = target?.sessionId;

    // A dead or absent target clears the hold but does NOT skip the recompute below: `botInput`
    // answers a null target with all-zeros, so the tick still ENDS with a defined, zero-valued
    // intent — that is what the old room code did, and it matters on the tick a target returns.
    // A defined hold means `shouldRecomputeIntent` applies the cadence gate below, so the bot
    // takes up to `reactionTicks - 1` ticks to re-engage instead of pouncing the instant a target
    // respawns (which fires on every Deathmatch/Practice respawn, not rarely).
    if (!target) this.held = undefined;

    if (shouldRecomputeIntent(view.tick, this.profile.reactionTicks, this.held !== undefined)) {
      const raw = botInput(
        0, // `seq` belongs to the host; `botInput` only echoes it, and the controller discards it
        { x: view.self.x, y: view.self.y, angle: view.self.angle },
        target ? { x: target.x, y: target.y, angle: target.angle } : null,
        view.self.slots.map((slot) => slot.range),
        this.profile,
      );
      this.held = { steer: raw.steer, throttle: raw.throttle, fireSlots: raw.fireSlots };
    }

    const intent = this.held ?? COAST;
    const pulsed = {
      ...intent,
      fireSlots: pulsedFireSlots(view.tick, this.profile.firePeriodTicks, intent.fireSlots),
    };
    return this.applyReactionDelay(pulsed);
  }

  /**
   * Reaction delay (B19): the gap between SEEING something and the bot's hands moving, distinct
   * from `reactionTicks`'s recompute cadence above. The intent returned this call is the one
   * computed `reactionDelayTicks` calls ago, not this call's own — a delay on the decision itself.
   *
   * At `reactionDelayTicks` 0 (every profile today) this returns `intent` untouched: the queue is
   * never pushed to and never read, so behaviour is bit-identical to the controller before this
   * knob existed (B19's own requirement).
   */
  private applyReactionDelay(intent: BotIntent): BotIntent {
    const delay = this.profile.reactionDelayTicks ?? 0;
    if (delay === 0) return intent;
    this.delayLine.push(intent);
    if (this.delayLine.length > delay) return this.delayLine.shift()!;
    // Fewer than `delay` calls have happened since this controller was constructed: the reaction to
    // anything seen so far has not reached the bot's hands yet, same as a human's first instant in
    // a match. Zero-valued rather than the earliest queued intent, so a mid-fill bot does not act on
    // a decision it has not "felt" arrive.
    return COAST;
  }

  /**
   * A fixed opponent when the host named one — which is both rooms, unchanged — otherwise the
   * nearest living, non-phased enemy.
   *
   * Nearest-first is harness scaffolding, not bot intelligence: something has to choose among five
   * cars in a free-for-all, and who bots focus is a real influence on kill distribution that the bot
   * session will own. Phased cars are skipped because they cannot be hit at all, and shooting at one
   * would register as a miss in exactly the accuracy numbers this rig exists to produce (B28a).
   */
  private pickTarget(view: BotView): BotView["others"][number] | undefined {
    if (this.fixedTarget !== undefined) {
      const fixed = view.others.find((o) => o.sessionId === this.fixedTarget);
      return fixed?.alive ? fixed : undefined;
    }
    let best: BotView["others"][number] | undefined;
    let bestDistance = Infinity;
    for (const other of view.others) {
      if (!other.alive || other.phased) continue;
      // Skip a teammate, but only when an enemy actually exists to fall back to. Every car in
      // free-for-all carries `team: 0`, so without the second half of this clause the bot would
      // read every other car as a teammate and refuse to target anyone.
      if (other.team === view.self.team && view.others.some((o) => o.team !== view.self.team)) continue;
      const distance = Math.hypot(other.x - view.self.x, other.y - view.self.y);
      // `others` arrives sorted by sessionId (`buildBotView`), so a distance tie resolves
      // identically every replay of the same seed.
      if (distance < bestDistance) {
        bestDistance = distance;
        best = other;
      }
    }
    return best;
  }
}
