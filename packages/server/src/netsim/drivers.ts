import { TICK_RATE_HZ } from "@motor-combat-moba/shared";

export interface DriveKeys {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fireSlots: number;
}

export interface ScriptedDriver {
  inputFor(tick: number): DriveKeys;
}

/**
 * How long one set of keys is held, in wall-clock ms: the 10-50-tick span the baseline was recorded
 * with at 30 Hz. Authored in ms and converted with `TICK_RATE_HZ` so the scripted driving is the
 * same wall-clock behaviour at any tick rate — a tick count would halve every hold at 60 Hz.
 */
const HOLD_MIN_MS = 1000 / 3;
const HOLD_MAX_MS = 5000 / 3;

/**
 * Weaving, mostly full throttle, a short reverse now and then — enough turning and contact to make
 * prediction and interpolation earn their keep. No firing in the baseline: combat is Phase F's.
 */
export function makeDriver(rng: () => number): ScriptedDriver {
  let until = 0;
  let keys: DriveKeys = { steer: 0, throttle: 1, fireSlots: 0 };
  return {
    inputFor(tick: number): DriveKeys {
      if (tick >= until) {
        const r = rng();
        const steer = r < 0.33 ? -1 : r < 0.66 ? 0 : 1;
        const throttle = rng() < 0.1 ? -1 : 1;
        keys = { steer, throttle, fireSlots: 0 };
        const holdMs = HOLD_MIN_MS + rng() * (HOLD_MAX_MS - HOLD_MIN_MS);
        until = tick + Math.round((holdMs * TICK_RATE_HZ) / 1000);
      }
      return keys;
    },
  };
}
