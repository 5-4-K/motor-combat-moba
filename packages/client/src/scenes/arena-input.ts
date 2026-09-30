/** The one call of `InputScheduler` the scene makes; an interface so a test can spy on it. */
export interface DueTicks {
  due(nowMs: number, frameMs: number, slackTicks: number | undefined): number[];
}

/**
 * The client's input clock (NR20, NR21): which ticks to send a frame for this render frame, with the
 * server's slack report handed to the scheduler exactly ONCE per snapshot.
 *
 * `InputScheduler.due`'s slack integrator runs once per sample it is given, so passing the same
 * snapshot's value on every frame would multiply its gain by the frame rate and limit-cycle the
 * lead. `onSnapshot` therefore only marks a value fresh; the next `due` passes it and clears it, and
 * every other call passes `undefined`. A frame that sends nothing (`discard`) drops the sample
 * rather than holding it for later, so a value never outlives the snapshot that carried it.
 */
export class InputClock {
  private freshSlack: number | undefined;

  constructor(private readonly scheduler: DueTicks) {}

  /** A snapshot was reconciled and carried this `inputSlack`. */
  onSnapshot(slackTicks: number): void {
    this.freshSlack = slackTicks;
  }

  /** The ticks to produce a frame for now, consuming any fresh slack sample. */
  due(nowMs: number, frameMs: number): number[] {
    const slack = this.freshSlack;
    this.freshSlack = undefined;
    return this.scheduler.due(nowMs, frameMs, slack);
  }

  /** A frame that will not send (paused, not driving): the pending sample, if any, is dropped. */
  discard(): void {
    this.freshSlack = undefined;
  }
}

/**
 * One axis of a two-key control as the `-1 | 0 | 1` the wire expects. Both keys down is a
 * deliberate `0` rather than a last-key-wins fight: holding left and right at once should mean "no
 * steering", not an arbitrary direction that depends on keyboard scan order.
 *
 * That rule is also what lets each side be an OR of two key sets — the arrows and WASD both steer,
 * and the free-look camera pans on either — without this function knowing there are two. Holding A
 * and Right is the same situation as holding Left and Right, and it already answers 0.
 */
export function axisOf(negative: boolean, positive: boolean): -1 | 0 | 1 {
  if (negative === positive) return 0;
  return positive ? 1 : -1;
}
