import { DEFAULT_PATCH_RATE_HZ, MS_PER_TICK, getArena, withMode, type InputMessage } from "@motor-combat-moba/shared";
import { makeDriver } from "./drivers.js";
import { LegacyClient } from "./legacy-client.js";
import { Link, type LinkProfile } from "./link.js";
import {
  TRUTH_WINDOW_MS,
  isHold,
  mean,
  nearestOnPath,
  percentile,
  type NetsimMetrics,
  type PathPoint,
} from "./metrics.js";
import { mulberry32 } from "./rng.js";
import { NETSIM_ARENA_ID, ServerWorld, type Snapshot } from "./server-world.js";

export type ClientModel = "legacy";

export interface NetsimOptions {
  link: LinkProfile;
  model: ClientModel;
  seconds: number;
  seed: number;
  cars?: number;
}

/** Display refresh of every headless client, Hz. */
const FRAME_HZ = 60;
/** Each client's frame clock is offset by `index * FRAME_PHASE_MS`, so they do not render in step. */
const FRAME_PHASE_MS = 2.7;
const DEFAULT_CARS = 6;

/** First index in `path` (sorted by t) whose t is >= `t`. */
function lowerBound(path: readonly PathPoint[], t: number): number {
  let lo = 0;
  let hi = path.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (path[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The truth the server holds at `nowMs`: the pose after the last tick completed by then. */
function truthAt(path: readonly PathPoint[], nowMs: number): PathPoint {
  const i = lowerBound(path, nowMs + 1e-9);
  return path[Math.max(0, i - 1)]!;
}

/**
 * One deterministic run: a `ServerWorld` running the real tick pipeline, `cars` headless clients of
 * the chosen model, each behind its own up and down `Link`, all on one integer-millisecond clock.
 * Every piece of randomness comes from `mulberry32` streams seeded off `seed`.
 */
export function runNetsim(opts: NetsimOptions): NetsimMetrics {
  const world = new ServerWorld(opts.cars ?? DEFAULT_CARS);
  return withMode(world.modeConfig, () => runIn(world, opts));
}

function runIn(world: ServerWorld, opts: NetsimOptions): NetsimMetrics {
  const master = mulberry32(opts.seed);
  const nextSeed = (): number => Math.floor(master() * 0x1_0000_0000);
  const arena = getArena(NETSIM_ARENA_ID);
  const frameMs = 1000 / FRAME_HZ;
  const patchMs = 1000 / DEFAULT_PATCH_RATE_HZ;

  const clients = world.ids.map((id, i) => {
    // Drawn in a fixed order per client, so each stream is a pure function of (seed, index).
    const driverRng = mulberry32(nextSeed());
    const upRng = mulberry32(nextSeed());
    const downRng = mulberry32(nextSeed());
    if (opts.model !== "legacy") throw new Error(`unknown netsim client model: ${String(opts.model)}`);
    return {
      id,
      client: new LegacyClient(id, makeDriver(driverRng), arena),
      up: new Link<InputMessage>(opts.link, upRng),
      down: new Link<Snapshot>(opts.link, downRng),
      nextFrameAt: i * FRAME_PHASE_MS,
      prevDrawn: new Map<string, { x: number; y: number }>(),
      prevTruth: new Map<string, { x: number; y: number }>(),
    };
  });

  const pathErrors: number[] = [];
  const displayDelays: number[] = [];
  let holds = 0;
  let samples = 0;
  let stepsPerTickMax = 0;

  const endMs = opts.seconds * 1000;
  let nextTickAt = MS_PER_TICK;
  let nextPatchAt = patchMs;

  for (let now = 0; now <= endMs; now++) {
    // 1. Server: every tick due by now, then any patch due (a patch carries the last completed tick).
    while (now >= nextTickAt) {
      world.tick();
      stepsPerTickMax = Math.max(stepsPerTickMax, world.lastTickMaxSteps);
      nextTickAt += MS_PER_TICK;
    }
    if (now >= nextPatchAt) {
      const snap = world.snapshot();
      for (const c of clients) c.down.send(now, snap);
      while (nextPatchAt <= now) nextPatchAt += patchMs;
    }

    // 2. Deliver what the links hand over by now.
    for (const c of clients) {
      const queue = world.inputQueues.get(c.id)!;
      for (const msg of c.up.receive(now)) queue.push(msg);
      for (const snap of c.down.receive(now)) c.client.onSnapshot(now, snap);
    }

    // 3. Clients: a frame each whenever its own frame clock comes due.
    for (const c of clients) {
      if (now < c.nextFrameAt) continue;
      c.nextFrameAt += frameMs;
      for (const msg of c.client.frame(now, frameMs)) c.up.send(now, msg);

      // 4. Sample every other live car this client draws.
      for (const otherId of world.ids) {
        if (otherId === c.id) continue;
        if (!world.state.players.get(otherId)!.alive) {
          c.prevDrawn.delete(otherId);
          c.prevTruth.delete(otherId);
          continue;
        }
        const drawn = c.client.drawnRemote(otherId, now);
        if (!drawn) continue;
        const path = world.truth.get(otherId)!;
        const from = lowerBound(path, now - TRUTH_WINDOW_MS);
        const to = lowerBound(path, now + 1e-9);
        const window = path.slice(from, Math.max(to, from + 1));
        const hit = nearestOnPath(window, drawn.x, drawn.y);
        pathErrors.push(hit.distance);
        displayDelays.push(now - hit.t);
        samples++;

        const truth = truthAt(path, now);
        const prevDrawn = c.prevDrawn.get(otherId);
        const prevTruth = c.prevTruth.get(otherId);
        if (prevDrawn && prevTruth && isHold(prevDrawn, drawn, prevTruth, truth)) holds++;
        c.prevDrawn.set(otherId, drawn);
        c.prevTruth.set(otherId, { x: truth.x, y: truth.y });
      }
    }
  }

  const inputDelays: number[] = [];
  for (const c of clients) {
    const applied = world.appliedAt.get(c.id)!;
    for (const [seq, producedMs] of c.client.producedAt) {
      const appliedMs = applied.get(seq);
      if (appliedMs !== undefined) inputDelays.push(appliedMs - producedMs);
    }
  }

  return {
    stepsPerTickMax,
    repeatedInputRate: null,
    remotePathErrorP95: percentile(pathErrors, 95),
    remoteDisplayDelayMs: mean(displayDelays),
    remoteHoldRate: samples === 0 ? 0 : holds / samples,
    reconcileErrorP95: percentile(clients.flatMap((c) => c.client.reconcileErrors), 95),
    inputToServerMs: mean(inputDelays),
  };
}
