import { describe, expect, it } from "vitest";
import {
  ACTIVE_ARENA_ID,
  MS_PER_TICK,
  NEUTRAL_MODIFIERS,
  NET_CONFIG,
  getArena,
  stepSim,
  type InputMessage,
  type SimBody,
  type StepContext,
} from "@motor-combat-moba/shared";
import { PredictionBuffer } from "./prediction.js";

const arena = getArena(ACTIVE_ARENA_ID);
const ctx: StepContext = {
  carId: "rectangle",
  others: [],
  obstacles: arena.obstacles,
  bounds: { width: arena.width, height: arena.height },
  // Unbuffed: every expectation here is the plain drive model.
  modifiers: NEUTRAL_MODIFIERS,
};

const DT = MS_PER_TICK / 1000;
const START: SimBody = {
  x: 200,
  y: 200,
  angle: 0,
  speed: 0,
  reverseHold: 0,
  angVel: 0,
  shoveX: 0,
  shoveY: 0,
  authority: 1,
};

function up(seq: number): InputMessage {
  return { seq, steer: 0, throttle: 1, fireSlots: 0 };
}

/** The pose a lone client reaches by driving `count` Up ticks from `from` — the local double-step. */
function replay(from: SimBody, seqs: readonly number[]): SimBody {
  let body = from;
  for (const seq of seqs) body = stepSim(body, up(seq), DT, ctx);
  return body;
}

/**
 * A predicted pose deliberately far enough from the replayed target to force the snap branch, so a
 * test can read the replay target back out of `reconcile` verbatim instead of through the ease.
 */
function farFrom(body: SimBody): SimBody {
  return { ...body, x: body.x + NET_CONFIG.reconcileSnapPos * 10 };
}

describe("PredictionBuffer.predict", () => {
  it("runs the shared stepSim, so Up from rest moves the pose forward", () => {
    const buf = new PredictionBuffer();
    const out = buf.predict(START, { seq: 1, input: up(1) }, ctx);
    expect(out).toEqual(stepSim(START, up(1), DT, ctx));
    expect(out.x).toBeGreaterThan(START.x);
    expect(out.speed).toBeGreaterThan(0);
  });

  it("caps the pending buffer at NET_CONFIG.pendingInputCap, dropping the oldest", () => {
    const buf = new PredictionBuffer();
    const overflow = NET_CONFIG.pendingInputCap + 1;
    let predicted = START;
    for (let seq = 1; seq <= overflow; seq++) {
      predicted = buf.predict(predicted, { seq, input: up(seq) }, ctx);
    }

    // Nothing acked, so every *retained* input replays. Seq 1 was evicted to make room for the last.
    const kept = Array.from({ length: NET_CONFIG.pendingInputCap }, (_, i) => i + 2);
    const out = buf.reconcile(START, 0, farFrom(replay(START, kept)), ctx);

    expect(out).toEqual(replay(START, kept));
    expect(out).not.toEqual(replay(START, [1, ...kept]));
  });

  it("still drops by predicate after an eviction, so a live ack cannot strand survivors", () => {
    // Eviction and a nonzero ack have to meet in one test. A cursor that splices off
    // `ack - previousAck` entries agrees with the predicate right up until the cap has thrown the
    // head away: the count is then measured against seqs that are no longer in the buffer, and it
    // eats live inputs off the front.
    const buf = new PredictionBuffer();
    const sent = NET_CONFIG.pendingInputCap + 6;
    let predicted = START;
    for (let seq = 1; seq <= sent; seq++) {
      predicted = buf.predict(predicted, { seq, input: up(seq) }, ctx);
    }

    // The buffer holds seqs 7..30; the server has acked through 10, so 11..30 must replay.
    const oldestKept = sent - NET_CONFIG.pendingInputCap + 1;
    const ack = oldestKept + 3;
    const survivors: number[] = [];
    for (let seq = ack + 1; seq <= sent; seq++) survivors.push(seq);

    const authoritative = replay(START, [1]);
    const expected = replay(authoritative, survivors);
    expect(buf.reconcile(authoritative, ack, farFrom(expected), ctx)).toEqual(expected);
  });
});

describe("PredictionBuffer.reconcile", () => {
  it("replays the inputs the server has not acked yet", () => {
    const buf = new PredictionBuffer();
    const afterOne = buf.predict(START, { seq: 1, input: up(1) }, ctx);
    const afterTwo = buf.predict(afterOne, { seq: 2, input: up(2) }, ctx);

    // Server has applied seq 1 only; its pose is therefore the client's own single step.
    const authoritative = replay(START, [1]);
    const out = buf.reconcile(authoritative, 1, afterTwo, ctx);

    // Replaying seq 2 on top of the ack lands exactly where local prediction already was.
    expect(out).toEqual(replay(START, [1, 2]));
    expect(out).toEqual(afterTwo);
  });

  it("drops acked inputs by predicate, so a backwards-walking ack is a no-op", () => {
    // `withSimulatedLatency` delays each message independently, so the server's ack can legitimately
    // report a *lower* seq on a later tick. The still-unacked tail must survive that.
    const buf = new PredictionBuffer();
    let predicted = START;
    for (let seq = 1; seq <= 5; seq++) {
      predicted = buf.predict(predicted, { seq, input: up(seq) }, ctx);
    }

    const authoritative = replay(START, [1, 2, 3]);
    const expected = replay(authoritative, [4, 5]);

    const first = buf.reconcile(authoritative, 3, farFrom(expected), ctx);
    expect(first).toEqual(expected);

    const stale = buf.reconcile(authoritative, 1, farFrom(expected), ctx);
    expect(stale).toEqual(expected);
    // The tail must still be pending — landing on the bare authoritative pose is the rubber-band bug.
    expect(stale).not.toEqual(authoritative);
  });

  it("snaps to the replayed target when the position error exceeds reconcileSnapPos", () => {
    const buf = new PredictionBuffer();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0.2,
      speed: 30,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const wayOff: SimBody = {
      ...authoritative,
      x: authoritative.x + NET_CONFIG.reconcileSnapPos + 1,
    };

    expect(buf.reconcile(authoritative, 0, wayOff, ctx)).toEqual(authoritative);
  });

  it("snaps when the angle error exceeds reconcileSnapAngle even with position in tolerance", () => {
    const buf = new PredictionBuffer();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const twisted: SimBody = { ...authoritative, angle: NET_CONFIG.reconcileSnapAngle + 0.1 };

    expect(buf.reconcile(authoritative, 0, twisted, ctx)).toEqual(authoritative);
  });

  it("eases x/y toward the target inside the snap threshold", () => {
    const buf = new PredictionBuffer();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const nearby: SimBody = { ...authoritative, x: 410, y: 406 };

    const out = buf.reconcile(authoritative, 0, nearby, ctx);
    const rate = NET_CONFIG.reconcileEaseRate;
    expect(out.x).toBeCloseTo(410 + rate * (400 - 410), 10);
    expect(out.y).toBeCloseTo(406 + rate * (400 - 406), 10);
  });

  it("snaps speed and reverseHold to the replayed target instead of easing them", () => {
    // Derived sim fields are inputs to the next step, so a half-eased speed would feed a wrong
    // integration next tick and never converge.
    const buf = new PredictionBuffer();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0,
      speed: 50,
      reverseHold: 6,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const nearby: SimBody = {
      x: 410,
      y: 400,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };

    const out = buf.reconcile(authoritative, 0, nearby, ctx);
    expect(out.speed).toBe(50);
    expect(out.reverseHold).toBe(6);
    expect(out.x).not.toBe(400);
  });

  it("measures angle error as a wrapped delta, so an accumulated angle does not force a snap", () => {
    // `stepDrive` never normalises `angle`, so after minutes of turning it is thousands of radians.
    // A raw subtraction here would read a ~628 rad error and snap every single tick.
    const buf = new PredictionBuffer();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0.1,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const wound = 0.1 + 100 * 2 * Math.PI;
    const spun: SimBody = { ...authoritative, angle: wound };

    const out = buf.reconcile(authoritative, 0, spun, ctx);
    expect(out.angle).toBeCloseTo(wound, 6);
    expect(out.angle).not.toBeCloseTo(authoritative.angle, 6);
  });

  it("snaps all four knock fields to the authoritative value on the EASE path, never eases them", () => {
    // The dangerous mistake here is changing `angVel`/`shoveX`/`shoveY`/`authority` in `reconcile`
    // from a snap to a `lerp` — per R16 that would break the "unpredicted ram" feature outright, and
    // every OTHER test in this suite uses neutral knock values (0, 0, 0, 1) on both sides, so such a
    // change would pass the whole file undetected. Exercising it specifically on the EASE branch
    // (small positional error, so x/y visibly lerp) is what makes this test able to catch a `lerp`
    // slipped in beside the position/angle easing, rather than only a wholesale drop of the fields.
    const buf = new PredictionBuffer();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 2.5,
      shoveX: 120,
      shoveY: -60,
      authority: 0.4,
    };
    const nearby: SimBody = {
      x: 405,
      y: 402,
      angle: 0,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };

    const out = buf.reconcile(authoritative, 0, nearby, ctx);

    // Precondition: this really is the ease path, not the snap path.
    expect(out.x).not.toBe(authoritative.x);
    expect(out.y).not.toBe(authoritative.y);

    expect(out.angVel).toBe(2.5);
    expect(out.shoveX).toBe(120);
    expect(out.shoveY).toBe(-60);
    expect(out.authority).toBe(0.4);
  });

  it("eases angle the short way round the wrap", () => {
    const buf = new PredictionBuffer();
    const authoritative: SimBody = {
      x: 400,
      y: 400,
      angle: -3,
      speed: 0,
      reverseHold: 0,
      angVel: 0,
      shoveX: 0,
      shoveY: 0,
      authority: 1,
    };
    const nearWrap: SimBody = { ...authoritative, angle: 3 };

    const out = buf.reconcile(authoritative, 0, nearWrap, ctx);
    // Short way is +0.283 rad across the seam, not the -6 rad the raw difference suggests.
    const shortWay = -3 - 3 + 2 * Math.PI;
    expect(out.angle).toBeCloseTo(3 + NET_CONFIG.reconcileEaseRate * shortWay, 10);
    expect(out.angle).toBeGreaterThan(3);
  });
});
