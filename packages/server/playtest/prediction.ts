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
  MS_PER_TICK,
  NEUTRAL_MODIFIERS,
  TICK_RATE_HZ,
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
    { id: "me", carId: "rectangle", x: 300, y: 360, angle: 0 },
    {
      id: "them",
      carId: "rectangle",
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
}): SimBody {
  return {
    x: p.x, y: p.y, angle: p.angle, speed: p.speed, reverseHold: p.reverseHold,
    angVel: p.angVel, shoveX: p.shoveX, shoveY: p.shoveY, authority: p.authority,
  };
}

/** The client's `StepContext`: remotes frozen at the last pose it was told about. */
function clientContext(snap: Snapshot | null, self: SimBody): StepContext {
  const entries: ContextEntry[] = [
    { sessionId: "me", player: { x: self.x, y: self.y, angle: self.angle, status: 3, carId: "rectangle" } },
  ];
  for (const o of snap?.others ?? []) {
    entries.push({
      sessionId: o.sessionId,
      player: { x: o.x, y: o.y, angle: o.angle, status: 3, carId: "rectangle" },
    });
  }
  entries.sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1));
  return {
    carId: "rectangle",
    others: otherCarHulls(entries, "me"),
    obstacles: ARENA.obstacles,
    bounds: { width: ARENA.width, height: ARENA.height },
    modifiers: NEUTRAL_MODIFIERS,
  };
}

console.log("=".repeat(80));
console.log("P1 — reconciliation correction, free driving vs a head-on car-car collision");
console.log("=".repeat(80));
console.log(
  `sim ${TICK_RATE_HZ} Hz, patches ${DEFAULT_PATCH_RATE_HZ} Hz. "correction" is how far the local\n` +
    `car is moved by one reconcile — what the player sees as a snap. A rectangle covers 18 u/tick\n` +
    `and its hull is 48 x 32, so a correction near 20u is already a visible jump.\n`,
);
console.log(
  "latency   scenario        mean correction   peak correction   peak while in contact",
);
for (const latencyMs of [0, 15, 30, 60, 120]) {
  for (const collide of [false, true]) {
    const r = trial({ latencyMs, collide });
    console.log(
      `${String(latencyMs).padStart(4)} ms   ${(collide ? "COLLISION" : "free driving").padEnd(14)}  ` +
        `${r.mean.toFixed(2).padStart(10)} u   ${r.peak.toFixed(2).padStart(13)} u   ` +
        `${collide ? `${r.peakDuringContact.toFixed(2).padStart(14)} u` : "".padStart(16)}`,
    );
  }
}

console.log(`\n${"=".repeat(80)}`);
console.log("P2 — where the error comes from: how stale is the remote car the client resolves against?");
console.log("=".repeat(80));
const patchEvery = Math.round(TICK_RATE_HZ / DEFAULT_PATCH_RATE_HZ);
for (const latencyMs of [0, 15, 30, 60, 120]) {
  const latencyTicks = Math.round((latencyMs / 1000) * TICK_RATE_HZ);
  const staleTicks = latencyTicks + patchEvery;
  console.log(
    `${String(latencyMs).padStart(4)} ms one-way: remote pose is up to ${staleTicks} ticks old ` +
      `(${(staleTicks * MS_PER_TICK).toFixed(0)} ms) = ${(staleTicks * (540 / TICK_RATE_HZ)).toFixed(0)}u ` +
      `of travel for a car at Rectangle's top speed`,
  );
}
console.log(
  `\nThe client predicts only itself and enters remotes at their last-known server pose, so during\n` +
    `contact it is resolving its hull against a box that is that far behind. resolveWorld is a hard\n` +
    `positional constraint, not a soft force, so the disagreement lands as a push-out in the wrong\n` +
    `place rather than as a small drift.`,
);
