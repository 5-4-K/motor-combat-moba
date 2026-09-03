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

  constructor(profileId: BotDifficulty, options: { targetSessionId?: string } = {}) {
    this.profileId = profileId;
    this.profile = BOT_PROFILES[profileId];
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

    // A dead or absent target is no target: coast rather than chase a wreck's last pose, and drop
    // the hold so the bot reacts the instant one reappears instead of waiting out its cadence.
    if (!target) {
      this.held = undefined;
      return COAST;
    }

    if (shouldRecomputeIntent(view.tick, this.profile.reactionTicks, this.held !== undefined)) {
      const raw = botInput(
        0, // `seq` belongs to the host; `botInput` only echoes it, and the controller discards it
        { x: view.self.x, y: view.self.y, angle: view.self.angle },
        { x: target.x, y: target.y, angle: target.angle },
        view.self.slots.map((slot) => slot.range),
        this.profile,
      );
      this.held = { steer: raw.steer, throttle: raw.throttle, fireSlots: raw.fireSlots };
    }

    const intent = this.held ?? COAST;
    return {
      ...intent,
      fireSlots: pulsedFireSlots(view.tick, this.profile.firePeriodTicks, intent.fireSlots),
    };
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
