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

/** Wall-clock gap between one fire press and the next, ms (Phase F, F5): "occasional". */
const PRESS_GAP_MIN_MS = 1000;
const PRESS_GAP_MAX_MS = 3000;
/** How long a fire key is held once pressed, ms. Only the press edge fires (the server finds it). */
const PRESS_HOLD_MIN_MS = 80;
const PRESS_HOLD_MAX_MS = 250;
/**
 * The fire slots a press picks from: the three ability slots. Fire slot 0, the basic attack, is
 * switched off in every shipped mode (`slots.basicAttackEnabled`), so pressing it would only ever
 * measure a refusal.
 */
const PRESS_SLOTS = [1, 2, 3] as const;

const toTicks = (ms: number): number => Math.max(1, Math.round((ms * TICK_RATE_HZ) / 1000));

/**
 * Weaving, mostly full throttle, a short reverse now and then — enough turning and contact to make
 * prediction and interpolation earn their keep.
 *
 * With `fireRng` (Phase F, F5), an occasional press of one ability slot every 1–3 s, held 80–250 ms:
 * the shooter's own shots, their compensation and their hand-over are then measured on every link.
 * The fire stream is its own seeded generator, so the driving keys are the same draws with or
 * without it (the world they drive in is not: shots hit, stun, dash and kill).
 */
export function makeDriver(rng: () => number, fireRng?: () => number): ScriptedDriver {
  let until = 0;
  let keys: DriveKeys = { steer: 0, throttle: 1, fireSlots: 0 };
  // The first press waits a full gap, so the clock has synced and the RTT been measured.
  let nextPressAt = fireRng ? toTicks(PRESS_GAP_MIN_MS + fireRng() * (PRESS_GAP_MAX_MS - PRESS_GAP_MIN_MS)) : Infinity;
  let releaseAt = 0;
  let held = 0;
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
      if (fireRng) {
        if (held !== 0 && tick >= releaseAt) held = 0;
        if (held === 0 && tick >= nextPressAt) {
          held = 1 << PRESS_SLOTS[Math.floor(fireRng() * PRESS_SLOTS.length)]!;
          releaseAt = tick + toTicks(PRESS_HOLD_MIN_MS + fireRng() * (PRESS_HOLD_MAX_MS - PRESS_HOLD_MIN_MS));
          nextPressAt = tick + toTicks(PRESS_GAP_MIN_MS + fireRng() * (PRESS_GAP_MAX_MS - PRESS_GAP_MIN_MS));
        }
      }
      return held === 0 ? keys : { ...keys, fireSlots: held };
    },
  };
}
