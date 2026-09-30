import { MS_PER_TICK, NET_CONFIG } from "@motor-combat-moba/shared";

/**
 * Turns the room's wall-clock frames into a whole number of fixed sim steps.
 *
 * The rooms cannot ask `setInterval` for 16.67 ms: Node truncates the delay to 16 ms, so a room that
 * ran one tick per callback ticked ~3 % fast (measured 61.7/s against `TICK_RATE_HZ` 60), and every
 * wall-clock figure the sim resolves to ticks — cooldowns, respawn delays, the match clock — ran
 * short by the same amount. The stepper instead banks the MEASURED elapsed time each callback hands
 * it and runs one step per whole `stepMs` banked, so the long-run rate is exactly `1000 / stepMs`
 * whatever the timer's granularity.
 *
 * A stall (a GC pause, a blocked event loop) must not become a spiral of death, where catching up
 * takes longer than the stall did: one call runs at most `maxCatchUp` steps, and whatever whole steps
 * are still owed after that are dropped — counted in `droppedMs`, never run. The fraction of a step
 * is kept, so the drop never shifts the phase of the tick grid.
 *
 * Pure and clock-free: the caller supplies the elapsed time, so this is testable without a room.
 */
export class FixedStepper {
  private accMs = 0;
  private dropped = 0;
  private readonly epsMs: number;

  constructor(
    private readonly stepMs: number,
    private readonly maxCatchUp: number,
  ) {
    if (!(stepMs > 0)) throw new Error(`FixedStepper: stepMs must be positive, got ${stepMs}`);
    if (!(maxCatchUp >= 1)) {
      throw new Error(`FixedStepper: maxCatchUp must be at least 1, got ${maxCatchUp}`);
    }
    this.epsMs = stepMs * 1e-9;
  }

  /**
   * The banked fraction of a step, in ms, in [0, stepMs): how far past the last step's due time the
   * caller's clock has run. A room subtracts it from its wall clock to date the last tick to the
   * steady tick grid rather than to whenever the interval callback happened to fire.
   */
  get remainderMs(): number {
    return this.accMs;
  }

  /** Total wall-clock time, in ms, that a stall cost the sim — owed steps dropped rather than run. */
  get droppedMs(): number {
    return this.dropped;
  }

  /**
   * Banks `elapsedMs` and runs `step` once per whole `stepMs` banked, up to `maxCatchUp` times.
   * A zero, negative or non-finite elapsed runs nothing and banks nothing. Returns the steps run.
   */
  advance(elapsedMs: number, step: () => void): number {
    if (!(elapsedMs > 0) || !Number.isFinite(elapsedMs)) return 0;
    this.accMs += elapsedMs;
    let ran = 0;
    // `stepMs` is rarely exact in binary (1000 / 60), so a bank that is a whole number of steps in
    // decimal can read a hair short of it after subtracting; the epsilon counts that as whole.
    const due = this.stepMs - this.epsMs;
    while (this.accMs >= due && ran < this.maxCatchUp) {
      this.accMs -= this.stepMs;
      ran += 1;
      step();
    }
    if (this.accMs >= due) {
      // Not `%`, for the same float reason: 500 ms of 16.67 ms steps would leave almost a whole
      // step as the "fraction", keeping a step `droppedMs` claims was dropped.
      const owed = Math.floor((this.accMs + this.epsMs) / this.stepMs);
      const keep = Math.max(0, this.accMs - owed * this.stepMs);
      this.dropped += this.accMs - keep;
      this.accMs = keep;
    }
    return ran;
  }
}

/**
 * The stepper every room drives its simulation interval through: one step per `MS_PER_TICK`, at
 * most `NET_CONFIG.maxCatchUpTicks` per frame. Both inputs are global, never per-mode.
 */
export function newRoomStepper(): FixedStepper {
  return new FixedStepper(MS_PER_TICK, NET_CONFIG.maxCatchUpTicks);
}
