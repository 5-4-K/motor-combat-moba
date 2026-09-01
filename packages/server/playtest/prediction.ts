/**
 * Client prediction vs the authoritative server, across a car-on-car collision.
 *
 * Rubber-banding on contact is the classic LAN complaint in this genre, and this architecture has a
 * specific reason to produce it: the client predicts only ITSELF and enters remotes at their
 * last-known *server* pose (see `buildStepContext`). During a collision the thing the local car is
 * resolving against is stale by roughly half the round trip plus a patch interval — and
 * `resolveWorld` is a hard positional constraint, so a stale remote pose is not a small error, it is
 * a push-out computed against the wrong box.
 *
 * This runs the real server pipeline and a real `PredictionBuffer` side by side over a delay line,
 * and reports the correction the local player actually eats.
 */
import {
  DEFAULT_PATCH_RATE_HZ,
  DRIVE_CONFIG,
  MS_PER_TICK,
  NEUTRAL_MODIFIERS,
  TICK_RATE_HZ,
  forwardMaxSpeedOf,
  getArena,
  carHullOf,
  otherCarHulls,
  stepSim,
  type ContextEntry,
  type InputMessage,
  type SimBody,
  type StepContext,
} from "@motor-combat-moba/shared";
import { PredictionBuffer } from "../../client/src/net/prediction.js";
import { PlaytestWorld } from "./world.js";
import { Reporter } from "./reporter.js";

const DT = MS_PER_TICK / 1000;
const ARENA = getArena("arena-01");

interface Snapshot {
  atTick: number;
  self: SimBody;
  lastProcessedInputSeq: number;
  others: { sessionId: string; x: number; y: number; angle: number }[];
}

/**
 * One trial. `latencyTicks` models one-way delay in each direction; patches arrive at
 * `DEFAULT_PATCH_RATE_HZ` rather than every tick, exactly as Colyseus sends them.
 */
function trial(opts: {
  latencyMs: number;
  collide: boolean;
  ticks?: number;
}): { peak: number; mean: number; peakDuringContact: number; contactTicks: number } {
  const latencyTicks = Math.max(0, Math.round((opts.latencyMs / 1000) * TICK_RATE_HZ));
  const patchEvery = Math.round(TICK_RATE_HZ / DEFAULT_PATCH_RATE_HZ);

  // "me" drives right; "them" drives left into me when colliding, or parallel when not.
  const world = new PlaytestWorld([
    { id: "me", carId: "mirage", x: 300, y: 360, angle: 0 },
    {
      id: "them",
      carId: "mirage",
      x: 900,
      y: opts.collide ? 360 : 200,
      angle: Math.PI,
    },
  ]);

  const buffer = new PredictionBuffer();
  let predicted: SimBody = { ...bodyOf(world.get("me")) };
  const snapshots: Snapshot[] = [];
  const inputsInFlight: { arriveAtTick: number; msg: InputMessage }[] = [];

  let seq = 0;
  let peak = 0;
  let sum = 0;
  let samples = 0;
  let peakDuringContact = 0;
  let contactTicks = 0;

  const total = opts.ticks ?? 240;
  for (let t = 1; t <= total; t++) {
    // ---- client frame: sample input, predict locally
    seq += 1;
    const input: InputMessage = { seq, steer: 0, throttle: 1, fireSlots: 0 };
    // The client's own view of the world: remotes at their last-RECEIVED server pose.
    const lastSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1]! : null;
    const ctx = clientContext(lastSnap, predicted);
    predicted = buffer.predict(predicted, { seq, input }, ctx);
    inputsInFlight.push({ arriveAtTick: t + latencyTicks, msg: input });

    // ---- server: accept whatever has arrived, tick
    for (const pending of inputsInFlight.filter((p) => p.arriveAtTick === t)) {
      world.queues.get("me")!.push(pending.msg);
    }
    world.input("them", { throttle: 1 });
    world.tick();

    // ---- server: emit a patch every `patchEvery` ticks; it reaches the client `latencyTicks` later
    if (t % patchEvery === 0) {
      const me = world.get("me");
      const others: Snapshot["others"] = [];
      world.state.players.forEach((p, id) => {
        if (id !== "me") others.push({ sessionId: id, x: p.x, y: p.y, angle: p.angle });
      });
      snapshots.push({
        atTick: t + latencyTicks,
        self: bodyOf(me),
        lastProcessedInputSeq: me.lastProcessedInputSeq,
        others,
      });
    }

    // ---- client: reconcile against any snapshot that has now arrived
    const arrived = snapshots.filter((s) => s.atTick === t);
    for (const snap of arrived) {
      const before = { x: predicted.x, y: predicted.y };
      predicted = buffer.reconcile(snap.self, snap.lastProcessedInputSeq, predicted, clientContext(snap, predicted));
      const correction = Math.hypot(predicted.x - before.x, predicted.y - before.y);
      peak = Math.max(peak, correction);
      sum += correction;
      samples++;
      const gap = Math.hypot(world.get("me").x - world.get("them").x, world.get("me").y - world.get("them").y);
      if (gap < 70) {
        contactTicks++;
        peakDuringContact = Math.max(peakDuringContact, correction);
      }
    }
  }

  return {
    peak,
    mean: samples > 0 ? sum / samples : 0,
    peakDuringContact,
    contactTicks,
  };
}

function bodyOf(p: {
  x: number; y: number; angle: number; speed: number; reverseHold: number;
  angVel: number; shoveX: number; shoveY: number; authority: number;
  maneuver: number; maneuverTicksLeft: number; maneuverAngle: number; maneuverSpeed: number;
}): SimBody {
  return {
    x: p.x, y: p.y, angle: p.angle, speed: p.speed, reverseHold: p.reverseHold,
    angVel: p.angVel, shoveX: p.shoveX, shoveY: p.shoveY, authority: p.authority,
    maneuver: p.maneuver, maneuverTicksLeft: p.maneuverTicksLeft,
    maneuverAngle: p.maneuverAngle, maneuverSpeed: p.maneuverSpeed,
  };
}

/** The client's `StepContext`: remotes frozen at the last pose it was told about. */
function clientContext(snap: Snapshot | null, self: SimBody): StepContext {
  const entries: ContextEntry[] = [
    { sessionId: "me", player: { x: self.x, y: self.y, angle: self.angle, status: 3, carId: "mirage", alive: true } },
  ];
  for (const o of snap?.others ?? []) {
    entries.push({
      sessionId: o.sessionId,
      player: { x: o.x, y: o.y, angle: o.angle, status: 3, carId: "mirage", alive: true },
    });
  }
  entries.sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1));
  return {
    carId: "mirage",
    others: otherCarHulls(entries, "me"),
    obstacles: ARENA.obstacles,
    bounds: { width: ARENA.width, height: ARENA.height },
    modifiers: NEUTRAL_MODIFIERS,
  };
}

const reporter = new Reporter(
  "prediction",
  "Client prediction vs the authoritative server across a car-on-car collision, by latency.",
);

/* ------------------------------- P1. correction, free driving vs a head-on car-car collision */
{
  const rows: string[] = [];
  let worstCollision = 0;
  let worstFree = 0;
  for (const latencyMs of [0, 15, 30, 60, 120]) {
    for (const collide of [false, true]) {
      const r = trial({ latencyMs, collide });
      if (collide) worstCollision = Math.max(worstCollision, r.peak);
      else worstFree = Math.max(worstFree, r.peak);
      rows.push(
        `${String(latencyMs).padStart(4)} ms   ${(collide ? "COLLISION" : "free driving").padEnd(14)}  ` +
          `mean ${r.mean.toFixed(2).padStart(6)}u   peak ${r.peak.toFixed(2).padStart(7)}u   ` +
          `${collide ? `peak in contact ${r.peakDuringContact.toFixed(2)}u` : ""}`,
      );
    }
  }
  reporter.report(
    "P1. Reconciliation correction, free driving vs a head-on collision",
    // A correction past a car length is a snap the player sees; free driving must stay at zero.
    worstCollision > DRIVE_CONFIG.carWidth || worstFree > 1 ? "FINDING" : "OK",
    `sim ${TICK_RATE_HZ} Hz, patches ${DEFAULT_PATCH_RATE_HZ} Hz. "correction" is how far one\n` +
      `reconcile moves the local car — what the player sees as a snap. A mirage covers 19.2 u/tick\n` +
      `and its hull is ${DRIVE_CONFIG.carWidth} x ${DRIVE_CONFIG.carHeight}.\n` +
      rows.join("\n") +
      `\nworst free-driving correction ${worstFree.toFixed(2)}u; worst collision correction ` +
      `${worstCollision.toFixed(2)}u.`,
  );
}

/* -------------------------------------- P2. where the error comes from: remote pose staleness */
{
  const rows: string[] = [];
  const patchEvery = Math.round(TICK_RATE_HZ / DEFAULT_PATCH_RATE_HZ);
  const mirageTopSpeed = forwardMaxSpeedOf("mirage"); // 576 u/s after T8's restat (was 540)
  for (const latencyMs of [0, 15, 30, 60, 120]) {
    const latencyTicks = Math.round((latencyMs / 1000) * TICK_RATE_HZ);
    const staleTicks = latencyTicks + patchEvery;
    rows.push(
      `${String(latencyMs).padStart(4)} ms one-way: remote pose up to ${staleTicks} ticks old ` +
        `(${(staleTicks * MS_PER_TICK).toFixed(0)} ms) = ` +
        `${(staleTicks * (mirageTopSpeed / TICK_RATE_HZ)).toFixed(0)}u of travel at Mirage's top speed`,
    );
  }
  reporter.report(
    "P2. Why: how stale is the remote car the client resolves against?",
    "KNOWN-BY-DESIGN",
    rows.join("\n") +
      `\nThe client predicts only itself and enters remotes at their last-known server pose, so\n` +
      `during contact it resolves its hull against a box that far behind. resolveWorld is a hard\n` +
      `positional constraint, not a soft force, so the disagreement lands as a push-out in the\n` +
      `wrong place rather than as a small drift.`,
  );
}

reporter.finish();
