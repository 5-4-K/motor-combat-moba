import { MS_PER_TICK } from "../constants.js";
import { stepSim, type SimBody, type StepContext } from "../sim/step.js";
import { blendPose } from "./interpolation.js";
import type { InputKeys } from "./tick-input.js";

export interface ReckonSource {
  tick: number;
  body: SimBody;
  keys: InputKeys;
  ctx: StepContext;
}

const DT = MS_PER_TICK / 1000;

/**
 * Dead reckoning for a remote car with the shared `stepSim` (NR31, NR32). The newest authoritative
 * snapshot is stepped forward with the car's last known input, so walls and obstacles hold because
 * it is the same function the server runs. Poses are cached per snapshot and extended one tick at a
 * time, never recomputed from scratch per frame. Between whole ticks the pose is `blendPose`d, which
 * lerps x/y/angle and carries every other `SimBody` field (velocity, spin, maneuver) from the later
 * step — no half-blended velocity ever reaches a step.
 */
export class RemoteReckoner {
  private readonly cars = new Map<string, { source: ReckonSource; steps: SimBody[] }>();

  constructor(private readonly maxTicks: number) {}

  /** A new authoritative snapshot for this car; drops the cache if tick moved. */
  update(id: string, source: ReckonSource): void {
    const cur = this.cars.get(id);
    if (cur && cur.source.tick === source.tick) return;
    this.cars.set(id, { source, steps: [source.body] });
  }

  private stepTo(id: string, whole: number, limit: number): Readonly<SimBody> | undefined {
    const car = this.cars.get(id);
    if (!car) return undefined;
    const n = Math.max(0, Math.min(limit, whole - car.source.tick));
    while (car.steps.length <= n) {
      car.steps.push(stepSim(car.steps[car.steps.length - 1]!, car.source.keys, DT, car.source.ctx));
    }
    return car.steps[n];
  }

  /**
   * Pose at (fractional) tick, stepped from the newest snapshot, capped at maxTicks past it.
   * `extraTicks` (≥ 0, fractional) moves the cap that much further: the DRAWN contact-blend target
   * only (`RemoteTimeline`, phase E re-review I5), never prediction, which keeps the whole-tick cap.
   */
  poseAt(id: string, tick: number, extraTicks = 0): Readonly<SimBody> | undefined {
    const car = this.cars.get(id);
    if (!car) return undefined;
    const extra = Math.max(0, extraTicks);
    const limit = this.maxTicks + Math.ceil(extra);
    const capped = Math.min(tick, car.source.tick + this.maxTicks + extra);
    const lo = Math.floor(capped);
    const a = this.stepTo(id, lo, limit);
    if (capped === lo) return a;
    const b = this.stepTo(id, lo + 1, limit);
    if (!a || !b) return a;
    return blendPose(a, b, capped - lo);
  }

  /**
   * The last tick this car's reckoning reaches before it holds: its newest snapshot's tick plus
   * `maxTicks`. Undefined for a car with no reckoning.
   */
  reachTick(id: string): number | undefined {
    const car = this.cars.get(id);
    return car ? car.source.tick + this.maxTicks : undefined;
  }

  /** How far past its newest snapshot `tick` is, in ticks (0 when at or before it). */
  overshoot(id: string, tick: number): number {
    const car = this.cars.get(id);
    return car ? Math.max(0, tick - car.source.tick) : 0;
  }

  /**
   * Hand this car's current reckoning (its source and its cached steps) to `to`, replacing whatever
   * `to` held for it, or clearing it there when this reckoner has none. `RemoteTimeline` keeps the
   * reckoning a new snapshot supersedes this way, so it can measure how far that snapshot moved the
   * reckoned path (the contact blend's rebase gap, NR34). The steps array is only ever appended to,
   * so sharing it is safe.
   */
  handOver(id: string, to: RemoteReckoner): void {
    const car = this.cars.get(id);
    if (car) to.cars.set(id, car);
    else to.cars.delete(id);
  }

  forget(id: string): void {
    this.cars.delete(id);
  }
}
