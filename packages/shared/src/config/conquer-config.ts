import { TICK_RATE_HZ } from "../constants.js";

/**
 * Conquer's zone-control tuning (spec CQ25). Every mode carries a copy (CQ26), the way every mode
 * carries a `deathmatch` table, but only a mode whose `winRuleOf` is `"conquer"` reads any of it:
 * `teamSize` and `uniqueChassisPerTeam` are inert everywhere else, which is how Team brawl keeps its
 * 1v1-to-3v3 start rule.
 *
 * The match clock, respawn delay and spawn-protection windows are NOT here. Conquer reads them from
 * its own `deathmatch` table (CQ22), which is the "clock and respawn" table, named for its first user.
 */
export interface ConquerConfig {
  /** Uncontested presence needed before a team is "in control" and its bar starts to fill. */
  readonly captureDelaySeconds: number;
  /** Accumulated control that fills a bar to 100 % and wins outright. */
  readonly controlTargetSeconds: number;
  /** The exact number of ready players each team must have to start (CQ28). */
  readonly teamSize: number;
  /** A chassis a teammate has locked is refused (CQ4, CQ30). */
  readonly uniqueChassisPerTeam: boolean;
}

export const CONQUER_CONFIG: ConquerConfig = Object.freeze({
  captureDelaySeconds: 5,
  controlTargetSeconds: 60,
  teamSize: 3,
  uniqueChassisPerTeam: true,
});

/** The two durations in the whole ticks the room counts. */
export interface ConquerTicks {
  readonly captureDelay: number;
  readonly controlTarget: number;
}

export function resolveConquerTicks(conquer: ConquerConfig = CONQUER_CONFIG): ConquerTicks {
  return {
    captureDelay: Math.round(conquer.captureDelaySeconds * TICK_RATE_HZ),
    controlTarget: Math.round(conquer.controlTargetSeconds * TICK_RATE_HZ),
  };
}
