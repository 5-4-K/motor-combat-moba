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
  truthAt,
  truthWindow,
  type NetsimMetrics,
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

/** One remote car as one client drew it on one frame. */
interface RemoteSample {
  otherId: string;
  now: number;
  x: number;
  y: number;
  prev: RemoteSample | undefined;
}

/**
 * One deterministic run: a `ServerWorld` running the real tick pipeline, `cars` headless clients of
 * the chosen model, each behind its own up and down `Link`, all on one integer-millisecond clock.
 * Every piece of randomness comes from `mulberry32` streams seeded off `seed`.
 */
export function runNetsim(opts: NetsimOptions): NetsimMetrics {
  if (opts.model !== "legacy") throw new Error(`unknown netsim client model: ${String(opts.model)}`);
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
    return {
      id,
      client: new LegacyClient(id, makeDriver(driverRng), arena),
      up: new Link<InputMessage>(opts.link, upRng),
      down: new Link<Snapshot>(opts.link, downRng),
      nextFrameAt: i * FRAME_PHASE_MS,
      /** Per remote, the previous frame's sample (dropped while that remote is dead). */
      prev: new Map<string, RemoteSample>(),
    };
  });

  // Scored after the loop: truth at a frame's own time is interpolated between the tick before and
  // the tick after it, and the tick after has not run yet when the frame is drawn.
  const samples: RemoteSample[] = [];
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
          c.prev.delete(otherId);
          continue;
        }
        const drawn = c.client.drawnRemote(otherId, now);
        if (!drawn) continue;
        const sample: RemoteSample = { otherId, now, x: drawn.x, y: drawn.y, prev: c.prev.get(otherId) };
        samples.push(sample);
        c.prev.set(otherId, { ...sample, prev: undefined });
      }
    }
  }

  const pathErrors: number[] = [];
  const displayDelays: number[] = [];
  let holds = 0;
  for (const s of samples) {
    const path = world.truth.get(s.otherId)!;
    const hit = nearestOnPath(truthWindow(path, s.now - TRUTH_WINDOW_MS, s.now), s.x, s.y);
    pathErrors.push(hit.distance);
    displayDelays.push(s.now - hit.t);
    if (s.prev && isHold(s.prev, s, truthAt(path, s.prev.now), truthAt(path, s.now))) holds++;
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
    remoteHoldRate: samples.length === 0 ? 0 : holds / samples.length,
    reconcileErrorP95: percentile(clients.flatMap((c) => c.client.reconcileErrors), 95),
    inputToServerMs: mean(inputDelays),
  };
}
