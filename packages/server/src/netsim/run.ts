import {
  MS_PER_TICK,
  getArena,
  isWeaponId,
  msToTicks,
  NET_CONFIG,
  weaponDefOf,
  weaponTicksOf,
  withMode,
  type InputPacket,
  type TimePong,
} from "@motor-combat-moba/shared";
import { isSnapshotTick } from "../rooms/snapshot-cadence.js";
import { makeDriver } from "./drivers.js";
import { Link, type LinkProfile } from "./link.js";
import {
  aliveThrough,
  headingAt,
  headingErrorDeg,
  isHold,
  jumpExcess,
  mean,
  percentile,
  scoreRemoteSample,
  truthAt,
  type NetsimMetrics,
} from "./metrics.js";
import { mulberry32 } from "./rng.js";
import { NETSIM_ARENA_ID, ServerWorld, type Snapshot } from "./server-world.js";
import { TickClient } from "./tick-client.js";

/**
 * The client model a run drives. `"tick"` is the Phase D client (NR17–NR28): clock-synced,
 * tick-stamped frames sent ahead, one input per car per tick on the server. The pre-D `"legacy"`
 * model and its client are deleted with the server path they measured.
 */
export type ClientModel = "tick";

/**
 * Client → server on one WebSocket: input packets, `MSG_TIME` requests and `MSG_PING` echoes share
 * the ordered stream.
 */
type UpMessage = { kind: "input"; packet: InputPacket } | { kind: "time"; c: number } | { kind: "pingEcho"; s: number };
/** Server → client on the same stream: snapshots, `MSG_TIME` pongs and `MSG_PING` probes. */
type DownMessage = { kind: "snapshot"; snap: Snapshot } | { kind: "pong"; pong: TimePong } | { kind: "ping"; s: number };

export interface NetsimOptions {
  link: LinkProfile;
  model: ClientModel;
  seconds: number;
  seed: number;
  cars?: number;
  /**
   * Whether the scripted drivers press fire (F5, default true): an occasional ability press each,
   * from a fire stream seeded beside each driver's. `false` is the pre-F driving-only run.
   */
  fire?: boolean;
}

/** Display refresh of every headless client, Hz. */
const FRAME_HZ = 60;
/** Each client's frame clock is offset by `index * FRAME_PHASE_MS`, so they do not render in step. */
const FRAME_PHASE_MS = 2.7;
/**
 * Each client's own clock reads `index * CLOCK_OFFSET_MS + CLOCK_BASE_MS` ahead of the harness clock,
 * so `ClockSync` has a real offset to earn from its pongs rather than starting on the answer.
 */
const CLOCK_BASE_MS = 12_345.6;
const CLOCK_OFFSET_MS = 1_003.7;
const DEFAULT_CARS = 6;
/** How often the server probes every client's RTT with `MSG_PING`: `NetSessions`' room interval. */
const PING_INTERVAL_MS = 1000;
/** Fire stream seed = driver seed XOR this, so adding the stream draws nothing from the master. */
const FIRE_SEED_SALT = 0x9e3779b9;
/**
 * A server press matches a client press on the same slot no more than this many ticks after it: the
 * pressing frame may arrive late and be repeated over, and the edge then lands on the next frame that
 * still holds the key (`PRESS_HOLD_MIN_MS` in the driver).
 */
const PRESS_MATCH_TICKS = 4;

/**
 * What a run saw beyond the metric table — printed under `NETSIM_REPORT`, never compared as a
 * target, so it stays out of `NetsimMetrics`.
 */
export interface NetsimDiagnostics {
  /** Input frames the clients produced (one per tick each client sent for), all cars. */
  producedInputs: number;
  /**
   * Produced for a tick the server has already run, but not simulated as that tick's input: it
   * arrived late (the tick ran on a repeat), or the car was not on the field that tick.
   */
  droppedInputs: number;
  /** Produced for a tick the server had not run yet when the run ended: still in flight. */
  unackedAtEnd: number;
  /** Car-ticks stepped over the run, all cars — the `repeatedInputRate` denominator. */
  steppedCarTicks: number;
  /** Remote samples scored (client frames × live remotes drawn live). */
  remoteSamples: number;
  /** Of those, drawn within `contactBlendRangeCars` car lengths of the local car (the blend's reach). */
  blendSamples: number;
  /** Server-side deaths over the run, all cars. */
  deaths: number;
  /** Fire presses the drivers made (a rising bit in a produced frame), all cars. */
  presses: number;
  /** Of those, presses the server committed (a `fired` event on the same slot within a few ticks). */
  firedPresses: number;
  /**
   * Of those, presses of a projectile or beam weapon (a maneuver draws no shot) never drawn at all,
   * and how many of THOSE `LocalFire` had predicted (a provisional that was hidden from its birth:
   * past its range or wall end on its first drawn tick).
   */
  firedUndrawn: number;
  firedUndrawnPredicted: number;
  /** Provisional shots added (one per pellet), all cars. */
  provisionals: number;
  /** Own instances (not bursts) that confirmed no provisional, live or expired: presses `LocalFire` did not predict. */
  unpredictedShots: number;
  /** Server presses with a shot compensation above 0, and all server presses. */
  compensatedPresses: number;
  serverPresses: number;
}

export interface NetsimRun {
  metrics: NetsimMetrics;
  diagnostics: NetsimDiagnostics;
}

/** One remote car as one client drew it on one frame. */
interface RemoteSample {
  otherId: string;
  now: number;
  x: number;
  y: number;
  angle: number;
  inBlendRange: boolean;
  intended: { x: number; y: number; angle: number } | undefined;
  prev: RemoteSample | undefined;
}

/**
 * One deterministic run: a `ServerWorld` running the real tick pipeline, `cars` headless clients of
 * the chosen model, each behind its own up and down `Link`, all on one integer-millisecond clock.
 * Every piece of randomness comes from `mulberry32` streams seeded off `seed`.
 */
export function runNetsim(opts: NetsimOptions): NetsimMetrics {
  return runNetsimDetailed(opts).metrics;
}

/** `runNetsim`, plus the run's `NetsimDiagnostics`. */
export function runNetsimDetailed(opts: NetsimOptions): NetsimRun {
  if (opts.model !== "tick") throw new Error(`unknown netsim client model: ${String(opts.model)}`);
  const world = new ServerWorld(opts.cars ?? DEFAULT_CARS);
  return withMode(world.modeConfig, () => runIn(world, opts));
}

function runIn(world: ServerWorld, opts: NetsimOptions): NetsimRun {
  const master = mulberry32(opts.seed);
  const nextSeed = (): number => Math.floor(master() * 0x1_0000_0000);
  const arena = getArena(NETSIM_ARENA_ID);
  const frameMs = 1000 / FRAME_HZ;

  const clients = world.ids.map((id, i) => {
    // Drawn in a fixed order per client, so each stream is a pure function of (seed, index).
    const driverSeed = nextSeed();
    const driverRng = mulberry32(driverSeed);
    const upRng = mulberry32(nextSeed());
    const downRng = mulberry32(nextSeed());
    const fireRng = opts.fire === false ? undefined : mulberry32((driverSeed ^ FIRE_SEED_SALT) >>> 0);
    return {
      id,
      client: new TickClient(id, makeDriver(driverRng, fireRng), arena, CLOCK_BASE_MS + i * CLOCK_OFFSET_MS, 0),
      up: new Link<UpMessage>(opts.link, upRng),
      down: new Link<DownMessage>(opts.link, downRng),
      nextFrameAt: i * FRAME_PHASE_MS,
      /** Per remote, the previous frame's sample (dropped while that remote is dead). */
      prev: new Map<string, RemoteSample>(),
    };
  });

  // Scored after the loop: truth at a frame's own time is interpolated between the tick before and
  // the tick after it, and the tick after has not run yet when the frame is drawn.
  const samples: RemoteSample[] = [];
  let stepsPerTickMax = 0;
  let deaths = 0;
  const wasAlive = new Map(world.ids.map((id) => [id, true]));

  const endMs = opts.seconds * 1000;
  let nextTickAt = MS_PER_TICK;
  let nextPingAt = PING_INTERVAL_MS;

  for (let now = 0; now <= endMs; now++) {
    // 1. Server: every tick due by now, each followed by its snapshot when it is a snapshot tick —
    // exactly as the rooms broadcast (NR12), so a snapshot is always the state of one tick.
    while (now >= nextTickAt) {
      world.tick();
      stepsPerTickMax = Math.max(stepsPerTickMax, world.lastTickMaxSteps);
      for (const id of world.ids) {
        const alive = world.state.players.get(id)!.alive;
        if (wasAlive.get(id) && !alive) deaths++;
        wasAlive.set(id, alive);
      }
      if (isSnapshotTick(world.state.tick)) {
        const snap = world.snapshot();
        for (const c of clients) c.down.send(now, { kind: "snapshot", snap });
      }
      nextTickAt += MS_PER_TICK;
    }
    // The room's 1 s `MSG_PING` probe (NR19), whose echoes price shot compensation (NR36).
    if (now >= nextPingAt) {
      for (const c of clients) c.down.send(now, { kind: "ping", s: world.sessions.pingPayload(c.id, now).s });
      nextPingAt += PING_INTERVAL_MS;
    }

    // 2. Deliver what the links hand over by now. A time request is answered on arrival, from the
    // same `NetSessions.pong` the rooms answer with.
    for (const c of clients) {
      for (const msg of c.up.receive(now)) {
        if (msg.kind === "input") world.receiveInput(c.id, msg.packet);
        else if (msg.kind === "pingEcho") world.sessions.onPingEcho(c.id, msg.s, now);
        else c.down.send(now, { kind: "pong", pong: world.sessions.pong(msg.c, now) });
      }
      for (const msg of c.down.receive(now)) {
        if (msg.kind === "snapshot") c.client.onSnapshot(now, msg.snap);
        else if (msg.kind === "ping") c.up.send(now, { kind: "pingEcho", s: msg.s });
        else c.client.onPong(now, msg.pong);
      }
      const timeRequest = c.client.timeRequest(now);
      if (timeRequest) c.up.send(now, { kind: "time", c: timeRequest.c });
    }

    // 3. Clients: a frame each whenever its own frame clock comes due.
    for (const c of clients) {
      if (now < c.nextFrameAt) continue;
      c.nextFrameAt += frameMs;
      for (const packet of c.client.frame(now, frameMs)) c.up.send(now, { kind: "input", packet });
      c.client.drawShots(now);

      // 4. Sample every other car that is alive on the server AND drawn alive by this client: a car
      // the client still draws as a wreck (or not at all) is skipped, and its hold history reset.
      for (const otherId of world.ids) {
        if (otherId === c.id) continue;
        const liveOnServer = world.state.players.get(otherId)!.alive;
        const drawn = liveOnServer ? c.client.drawnRemote(otherId, now) : undefined;
        if (!drawn || drawn.wreck) {
          c.prev.delete(otherId);
          continue;
        }
        const sample: RemoteSample = {
          otherId,
          now,
          x: drawn.x,
          y: drawn.y,
          angle: drawn.angle,
          inBlendRange: drawn.inBlendRange,
          intended: drawn.intended,
          prev: c.prev.get(otherId),
        };
        samples.push(sample);
        c.prev.set(otherId, { ...sample, prev: undefined });
      }
    }
  }

  const pathErrors: number[] = [];
  const displayDelays: number[] = [];
  const headingErrors: number[] = [];
  const jumpExcesses: number[] = [];
  const blendPathErrors: number[] = [];
  const blendHeadingErrors: number[] = [];
  const blendIntendedErrors: number[] = [];
  const blendIntendedHeadingErrors: number[] = [];
  let holds = 0;
  for (const s of samples) {
    const path = world.truth.get(s.otherId)!;
    const scored = scoreRemoteSample(path, s.now, s.x, s.y);
    pathErrors.push(scored.distance);
    displayDelays.push(scored.delayMs);
    // Heading judged at the same true point the path error found, so display delay is not error.
    const heading = headingErrorDeg(s.angle, headingAt(path, s.now - scored.delayMs));
    headingErrors.push(heading);
    if (s.inBlendRange) {
      blendPathErrors.push(scored.distance);
      blendHeadingErrors.push(heading);
      if (s.intended) {
        blendIntendedErrors.push(Math.hypot(s.x - s.intended.x, s.y - s.intended.y));
        blendIntendedHeadingErrors.push(headingErrorDeg(s.angle, s.intended.angle));
      }
    }
    if (s.prev) {
      if (isHold(s.prev, s, truthAt(path, s.prev.now), truthAt(path, s.now))) holds++;
      // The car's own motion over this frame at the moment being DRAWN (this sample's display delay
      // back), so a remote drawn a delay behind a car that just braked is not scored as jumping.
      const drawnAt = s.now - scored.delayMs;
      const span = s.now - s.prev.now;
      // Skips spans touching a death or respawn, so a broken respawn reset is invisible here: the
      // shared test "resets on death and respawn: no slide…" (net/tick-interpolation.test.ts) is
      // what catches that, not this metric.
      if (aliveThrough(path, drawnAt - span, drawnAt)) {
        jumpExcesses.push(jumpExcess(s.prev, s, truthAt(path, drawnAt - span), truthAt(path, drawnAt)));
      }
    }
  }

  const inputDelays: number[] = [];
  let producedInputs = 0;
  let droppedInputs = 0;
  let unackedAtEnd = 0;
  const lastTick = world.state.tick;
  for (const c of clients) {
    const applied = world.appliedAt.get(c.id)!;
    for (const [tick, producedMs] of c.client.producedAt) {
      producedInputs++;
      const appliedMs = applied.get(tick);
      if (appliedMs !== undefined) inputDelays.push(appliedMs - producedMs);
      else if (tick <= lastTick) droppedInputs++;
      else unackedAtEnd++;
    }
  }

  const staleness = clients.flatMap((c) => c.client.staleness);

  // F5: each client press against the presses the server committed; the delay is press to first
  // drawn frame of its shot, less the weapon's own wind-up (the release is the weapon's design).
  const serverPresses = new Map<string, number[]>();
  for (const p of world.presses) {
    const key = `${p.sessionId}:${p.slot}`;
    const ticks = serverPresses.get(key) ?? [];
    ticks.push(p.tick);
    serverPresses.set(key, ticks);
  }
  const shotDelays: number[] = [];
  let presses = 0;
  let firedPresses = 0;
  let firedUndrawn = 0;
  let firedUndrawnPredicted = 0;
  for (const c of clients) {
    for (const press of c.client.presses) {
      presses++;
      const fired = serverPresses.get(`${c.id}:${press.slot}`)?.some((t) => t >= press.tick && t <= press.tick + PRESS_MATCH_TICKS);
      if (!fired) continue;
      firedPresses++;
      if (!isWeaponId(press.weaponId) || weaponDefOf(press.weaponId).kind === "maneuver") continue;
      if (press.drawnMs === undefined) {
        firedUndrawn++;
        if (press.predicted) firedUndrawnPredicted++;
        continue;
      }
      shotDelays.push(press.drawnMs - press.pressMs - weaponTicksOf(press.weaponId).startUp * MS_PER_TICK);
    }
  }
  const comp = world.presses.map((p) => p.k);
  const capTicks = msToTicks(NET_CONFIG.shotCompCapMs);
  const provisionals = clients.reduce((n, c) => n + c.client.provisionalsMade, 0);
  const expired = clients.reduce((n, c) => n + c.client.provisionalsExpired, 0);
  const late = clients.reduce((n, c) => n + c.client.lateConfirms, 0);
  // An expired provisional never confirmed: did the server commit its press (same slot, pressed
  // between its wind-up before the spawn tick and the spawn tick)? Then the server's instance ended
  // before any snapshot carried it — a hit or a wall inside its own fast-forward, or a pellet
  // stopped on its first ticks. Otherwise the server refused the press `LocalFire` let through.
  let unseen = 0;
  let refused = 0;
  for (const c of clients) {
    for (const e of c.client.expiredProvisionals) {
      if (e.confirmedLate) continue;
      const startUp = isWeaponId(e.weaponId) ? weaponTicksOf(e.weaponId).startUp : 0;
      const from = e.spawnTick - startUp - NET_CONFIG.provisionalShotMatchTicks;
      const to = e.spawnTick + NET_CONFIG.provisionalShotMatchTicks;
      if (serverPresses.get(`${c.id}:${e.slot}`)?.some((t) => t >= from && t <= to)) unseen++;
      else refused++;
    }
  }
  const metrics: NetsimMetrics = {
    stepsPerTickMax,
    repeatedInputRate: world.steppedCarTicks === 0 ? 0 : world.repeatedCarTicks / world.steppedCarTicks,
    remotePathErrorP95: percentile(pathErrors, 95),
    remoteDisplayDelayMs: mean(displayDelays),
    remoteHoldRate: samples.length === 0 ? 0 : holds / samples.length,
    reconcileErrorP95: percentile(clients.flatMap((c) => c.client.reconcileErrors), 95),
    inputToServerMs: mean(inputDelays),
    remoteHeadingErrorP95Deg: percentile(headingErrors, 95),
    remoteJumpExcessMax: jumpExcesses.reduce((m, v) => Math.max(m, v), 0),
    remoteJumpExcessP99: percentile(jumpExcesses, 99),
    remoteBlendPathErrorP95: percentile(blendPathErrors, 95),
    remoteBlendHeadingErrorP95Deg: percentile(blendHeadingErrors, 95),
    remoteBlendLagP95: percentile(blendIntendedErrors, 95),
    remoteBlendLagHeadingP95Deg: percentile(blendIntendedHeadingErrors, 95),
    shotStalenessP50Ticks: percentile(staleness, 50),
    shotStalenessP95Ticks: percentile(staleness, 95),
    shotStalenessMaxTicks: staleness.reduce((m, v) => Math.max(m, v), 0),
    ownShotDelayMs: mean(shotDelays),
    ownShotDelayP95Ms: percentile(shotDelays, 95),
    shotConfirmJumpP95: percentile(clients.flatMap((c) => c.client.confirmJumps), 95),
    shotConfirmJumpHomingP95: percentile(clients.flatMap((c) => c.client.confirmJumpsHoming), 95),
    provisionalExpiredRate: provisionals === 0 ? 0 : expired / provisionals,
    lateConfirmRate: provisionals === 0 ? 0 : late / provisionals,
    provisionalUnseenRate: provisionals === 0 ? 0 : unseen / provisionals,
    provisionalRefusedRate: provisionals === 0 ? 0 : refused / provisionals,
    shotCompMeanTicks: mean(comp),
    shotCompP50Ticks: percentile(comp, 50),
    shotCompP95Ticks: percentile(comp, 95),
    shotCompMaxTicks: comp.reduce((m, v) => Math.max(m, v), 0),
    shotCompAtCapRate: comp.length === 0 ? 0 : comp.filter((k) => k >= capTicks).length / comp.length,
  };
  return {
    metrics,
    diagnostics: {
      producedInputs,
      droppedInputs,
      unackedAtEnd,
      steppedCarTicks: world.steppedCarTicks,
      remoteSamples: samples.length,
      blendSamples: blendPathErrors.length,
      deaths,
      presses,
      firedPresses,
      firedUndrawn,
      firedUndrawnPredicted,
      provisionals,
      unpredictedShots: clients.reduce((n, c) => n + c.client.unpredictedShots, 0),
      compensatedPresses: comp.filter((k) => k > 0).length,
      serverPresses: comp.length,
    },
  };
}
