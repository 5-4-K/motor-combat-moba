export interface DriveKeys {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fireSlots: number;
}

export interface ScriptedDriver {
  inputFor(tick: number): DriveKeys;
}

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
        until = tick + 10 + Math.floor(rng() * 40);
      }
      return keys;
    },
  };
}
