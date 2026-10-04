/**
 * Client prediction vs the authoritative server, across a car-on-car collision.
 *
 * Rubber-banding on contact is the classic complaint in this genre: the client predicts its own car
 * ahead of the server, and whatever it resolves its hull against during a collision is a GUESS about
 * where the other car is on that tick. `resolveWorld` is a hard positional constraint, so a wrong
 * guess is not a small drift, it is a push-out computed against the wrong box.
 *
 * This drives the SAME client the browser runs, headless: the netsim's `TickClient`
 * (`src/netsim/tick-client.ts`) — `ClockSync` earning its offset from `MSG_TIME` pongs, the shared
 * `InputScheduler` sending tick-stamped frames ahead (one per car per tick, `inputRedundancy` older
 * frames riding along), `TickPrediction` predicting and reconciling, and remotes on the shared
 * `RemoteTimeline`: tick-keyed at an adaptive delay for drawing, and dead-reckoned (`RemoteReckoner`,
 * from `lastSteer`/`lastThrottle`, capped at `NET_CONFIG.maxExtrapolateMs`) to the tick each
 * predicted step needs (`remotePoseTickFor`) for the `StepContext` prediction resolves against. Both
 * cars have such a client. The server is the netsim's `ServerWorld` — the real `runPipeline`, fed only
 * through each car's `TickInputBuffer` (a late frame is repeated over, never stepped twice) — run in
 * THIS run's mode bundle. Messages travel over the netsim's in-order `Link`. Nothing client-side is
 * reimplemented here: the probe owns only the clock loop that wires those pieces together, the same
 * loop `src/netsim/run.ts` runs, cut down to two cars and a scripted head-on.
 *
 * Until the netcode redesign (phases A–G) this probe modelled the pre-E3 client — remotes frozen at
 * their newest snapshot pose and interpolated on arrival time — and its P2 asked how STALE that frozen
 * pose was. That question is obsolete: the prediction no longer resolves against a snapshot pose but
 * against a reckoned one. P2 now measures the nearest honest equivalent — how far the reckoned pose
 * the client actually resolved against stood from the server's truth on that tick — beside what the
 * old frozen pose would have been off by on the same ticks.
 */
import {
  DRIVE_CONFIG,
  MS_PER_TICK,
  NET_CONFIG,
  SNAPSHOT_RATE_HZ,
  TICK_RATE_HZ,
  forwardMaxSpeedOf,
  getArena,
  hpOf,
  msToTicks,
  remotePoseTickFor,
  toWorld,
  type InputPacket,
  type RemoteTimeline,
  type TimePong,
} from "@motor-combat-moba/shared";
import { isSnapshotTick } from "../../src/rooms/snapshot-cadence.js";
import { Link, LINKS, type LinkProfile } from "../../src/netsim/link.js";
import { mulberry32 } from "../../src/netsim/rng.js";
import { NETSIM_ARENA_ID, ServerWorld, type Snapshot } from "../../src/netsim/server-world.js";
import { TickClient } from "../../src/netsim/tick-client.js";
import type { DriveKeys, ScriptedDriver } from "../../src/netsim/drivers.js";
import { installPlaytestMode } from "./mode.js";
import { Reporter } from "./reporter.js";

// Mode scope (MC12). `run-all.ts` spawns this file as its own one-shot process (one per probe), so
// there is nothing to restore afterward — `installMode`, not `withMode`, same shape as
// `scripts/build-cars-and-weapons.mjs`'s entry. WHICH bundle is `--mode=<id|name>`, or the
// `PLAYTEST_MODE` a parent run passed down, defaulting to DEFAULT_GAME_MODE (MC41) — see
// `./mode.ts`. The Reporter labels the report with the same resolution, so the page always names
// the mode these numbers came from. The `ServerWorld` below is handed the same mode, so the server
// ticks in that bundle too, not the netsim's own deathmatch.
const MODE = installPlaytestMode();

const ME = "p0";
const THEM = "p1";
/** A frame's display refresh (each client's own clock runs on this, phase-offset per car). */
const FRAME_MS = 1000 / 60;
/** Each client's clock reads this far off the harness clock, so `ClockSync` has an offset to earn. */
const CLOCK_BASE_MS = 12_345.6;
const CLOCK_STEP_MS = 1_003.7;
/** `NetSessions`' room interval for the `MSG_PING` probe that prices shot compensation. */
const PING_INTERVAL_MS = 1000;
/** Harness time a trial runs: the clock sync takes a few hundred ms before either car moves. */
const TRIAL_MS = 5000;
/** Centre-to-centre distance under which the two cars count as in contact (one hull plus 10 u). */
const CONTACT_GAP = (): number => DRIVE_CONFIG.carWidth + 10;

type UpMessage = { kind: "input"; packet: InputPacket } | { kind: "time"; c: number } | { kind: "pingEcho"; s: number };
type DownMessage = { kind: "snapshot"; snap: Snapshot } | { kind: "pong"; pong: TimePong } | { kind: "ping"; s: number };

const hold = (keys: DriveKeys): ScriptedDriver => ({ inputFor: () => keys });

interface Pose {
  x: number;
  y: number;
}

interface TrialResult {
  /** Every reconcile of the local car: replay error (|target − predicted|) and the applied move. */
  reconciles: { error: number; snap: number; contact: boolean }[];
  /** Per predicted tick: the remote pose prediction resolved against, and the newest snapshot pose. */
  remoteSamples: { reckonedError: number; frozenError: number; aheadTicks: number; contact: boolean }[];
  contactTicks: number;
}

/** One trial: both cars driving at full throttle, head-on (`collide`) or on parallel lanes. */
function trial(link: LinkProfile, collide: boolean, seed: number): TrialResult {
  const world = new ServerWorld(2, { mode: MODE });
  // Re-place the two cars the netsim seated at its spawns: both Mirage, as this probe always was;
  // opposite teams so a team mode's contact rules treat them as enemies.
  const place = (id: string, x: number, y: number, angle: number, team: number): void => {
    const p = world.state.players.get(id)!;
    p.carId = "mirage";
    p.hp = hpOf("mirage");
    p.team = team;
    p.x = x;
    p.y = y;
    p.angle = angle;
    const v = toWorld(angle, 0, 0);
    p.vx = v.vx;
    p.vy = v.vy;
    world.truth.set(id, [{ t: 0, x, y, angle, alive: true }]);
  };
  place(ME, 300, 360, 0, 0);
  place(THEM, 900, collide ? 360 : 200, Math.PI, 1);

  const arena = getArena(NETSIM_ARENA_ID);
  const rng = mulberry32(seed);
  const throttle: DriveKeys = { steer: 0, throttle: 1, fireSlots: 0 };
  const clients = [ME, THEM].map((id, i) => ({
    id,
    client: new TickClient(id, hold(throttle), arena, CLOCK_BASE_MS + i * CLOCK_STEP_MS, 0),
    up: new Link<UpMessage>(link, mulberry32(Math.floor(rng() * 0x1_0000_0000))),
    down: new Link<DownMessage>(link, mulberry32(Math.floor(rng() * 0x1_0000_0000))),
    nextFrameAt: (i + 0.37) * (FRAME_MS / 2),
  }));
  const me = clients[0]!.client;
  // The one read the client does not expose: the timeline its prediction asks for each remote's
  // reckoned pose (`TickClient.stepContext` passes `remotes.reckonedPose` to `buildStepContext`).
  // Read-only, after the frame that used it.
  const timeline = (me as unknown as { remotes: RemoteTimeline }).remotes;

  const result: TrialResult = { reconciles: [], remoteSamples: [], contactTicks: 0 };
  /** Per produced tick of the local car: the reckoned and frozen remote poses it stepped against. */
  const pending: { tick: number; at: number; reckoned: Pose | undefined; frozen: Pose | undefined }[] = [];
  let newestSnapToMe: Snapshot | undefined;
  let lastProduced = 0;
  let nextTickAt = MS_PER_TICK;
  let nextPingAt = PING_INTERVAL_MS;

  for (let now = 0; now <= TRIAL_MS; now++) {
    while (now >= nextTickAt) {
      world.tick();
      if (isSnapshotTick(world.state.tick)) {
        const snaps = world.snapshots();
        for (const c of clients) c.down.send(now, { kind: "snapshot", snap: snaps.get(c.id)! });
      }
      nextTickAt += MS_PER_TICK;
    }
    if (now >= nextPingAt) {
      for (const c of clients) c.down.send(now, { kind: "ping", s: world.sessions.pingPayload(c.id, now).s });
      nextPingAt += PING_INTERVAL_MS;
    }
    for (const c of clients) {
      for (const msg of c.up.receive(now)) {
        if (msg.kind === "input") world.receiveInput(c.id, msg.packet);
        else if (msg.kind === "pingEcho") world.sessions.onPingEcho(c.id, msg.s, now);
        else c.down.send(now, { kind: "pong", pong: world.sessions.pong(msg.c, now) });
      }
      for (const msg of c.down.receive(now)) {
        if (msg.kind === "snapshot") {
          if (c.client !== me) {
            c.client.onSnapshot(now, msg.snap);
            continue;
          }
          const before = me.predictedPose;
          const errorsBefore = me.reconcileErrors.length;
          me.onSnapshot(now, msg.snap);
          newestSnapToMe = msg.snap;
          const after = me.predictedPose;
          if (before && after && me.reconcileErrors.length > errorsBefore) {
            const truth = world.truth;
            const a = truth.get(ME)![msg.snap.tick];
            const b = truth.get(THEM)![msg.snap.tick];
            result.reconciles.push({
              error: me.reconcileErrors[me.reconcileErrors.length - 1]!,
              snap: Math.hypot(after.x - before.x, after.y - before.y),
              contact: a !== undefined && b !== undefined && Math.hypot(a.x - b.x, a.y - b.y) < CONTACT_GAP(),
            });
          }
        } else if (msg.kind === "ping") c.up.send(now, { kind: "pingEcho", s: msg.s });
        else c.client.onPong(now, msg.pong);
      }
      const request = c.client.timeRequest(now);
      if (request) c.up.send(now, { kind: "time", c: request.c });
    }
    for (const c of clients) {
      if (now < c.nextFrameAt) continue;
      c.nextFrameAt += FRAME_MS;
      for (const packet of c.client.frame(now, FRAME_MS)) c.up.send(now, { kind: "input", packet });
      if (c.client !== me) continue;
      // Every tick the local car was just predicted for: the remote pose that step resolved against.
      for (const tick of me.producedAt.keys()) {
        if (tick <= lastProduced) continue;
        lastProduced = tick;
        const at = remotePoseTickFor(THEM, ME, tick);
        const reckoned = timeline.reckonedPose(THEM, at);
        const frozen = newestSnapToMe?.cars.find((car) => car.id === THEM)?.body;
        pending.push({
          tick: at,
          at: newestSnapToMe?.tick ?? 0,
          reckoned: reckoned ? { x: reckoned.x, y: reckoned.y } : undefined,
          frozen: frozen ? { x: frozen.x, y: frozen.y } : undefined,
        });
      }
    }
  }

  const truthMe = world.truth.get(ME)!;
  const truthThem = world.truth.get(THEM)!;
  for (let t = 1; t < truthMe.length; t++) {
    const a = truthMe[t]!;
    const b = truthThem[t]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) < CONTACT_GAP()) result.contactTicks++;
  }
  for (const s of pending) {
    const truth = truthThem[s.tick];
    const mine = truthMe[s.tick];
    if (!truth || !mine || !s.reckoned || !s.frozen) continue;
    result.remoteSamples.push({
      reckonedError: Math.hypot(s.reckoned.x - truth.x, s.reckoned.y - truth.y),
      frozenError: Math.hypot(s.frozen.x - truth.x, s.frozen.y - truth.y),
      aheadTicks: s.tick - s.at,
      contact: Math.hypot(mine.x - truth.x, mine.y - truth.y) < CONTACT_GAP(),
    });
  }
  return result;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}
const max = (values: number[]): number => values.reduce((m, v) => Math.max(m, v), 0);
const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);

/** One-way delay rows (jitter- and loss-free, so the delay is the only variable), then a real link. */
const PROFILES: LinkProfile[] = [
  ...[0, 15, 30, 60, 120].map((oneWayMs) => ({ name: `${oneWayMs} ms`, oneWayMs, jitterMs: 0, lossPct: 0 })),
  LINKS.net80,
];

const runs = PROFILES.map((link, i) => ({
  link,
  free: trial(link, false, 1000 + i),
  collide: trial(link, true, 2000 + i),
}));

const reporter = new Reporter(
  "prediction",
  "Client prediction vs the authoritative server across a car-on-car collision, by latency — through the netsim's TickClient.",
);

/* ------------------------------- P1. correction, free driving vs a head-on car-car collision */
{
  const rows: string[] = [];
  let worstCollisionSnap = 0;
  let worstCollisionError = 0;
  let worstFreeError = 0;
  for (const { link, free, collide } of runs) {
    for (const [label, r] of [["free driving", free], ["COLLISION", collide]] as const) {
      const errors = r.reconciles.map((c) => c.error);
      const snaps = r.reconciles.map((c) => c.snap);
      const inContact = r.reconciles.filter((c) => c.contact);
      if (label === "COLLISION") {
        worstCollisionSnap = Math.max(worstCollisionSnap, max(snaps));
        worstCollisionError = Math.max(worstCollisionError, max(errors));
      }
      else worstFreeError = Math.max(worstFreeError, max(errors));
      rows.push(
        `${link.name.padStart(10)}  ${label.padEnd(13)} ` +
          `error p95 ${percentile(errors, 95).toFixed(2).padStart(6)}u max ${max(errors).toFixed(2).padStart(6)}u   ` +
          `snap mean ${mean(snaps).toFixed(2).padStart(5)}u max ${max(snaps).toFixed(2).padStart(6)}u` +
          (label === "COLLISION"
            ? `   in contact: ${inContact.length} reconciles, error max ${max(inContact.map((c) => c.error)).toFixed(2)}u, ` +
              `snap max ${max(inContact.map((c) => c.snap)).toFixed(2)}u (${r.contactTicks} contact ticks)`
            : ""),
      );
    }
  }
  reporter.report(
    "P1. Reconciliation correction, free driving vs a head-on collision",
    // A move past a car width is a snap the player sees, and a replay error that size is a slide they
    // watch even through the ease; free driving must agree exactly (the float32 wire narrowing, NR52,
    // leaves well under a unit).
    worstCollisionSnap > DRIVE_CONFIG.carWidth || worstCollisionError > DRIVE_CONFIG.carWidth || worstFreeError > 1
      ? "FINDING"
      : "OK",
    `sim ${TICK_RATE_HZ} Hz, snapshots ${SNAPSHOT_RATE_HZ} Hz, two Mirages at full throttle, ${TRIAL_MS / 1000} s per trial.\n` +
      `"error" is |replay target - predicted| at each reconcile (TickPrediction.replayTarget, the netsim's\n` +
      `reconcileErrorP95); "snap" is how far that reconcile actually moved the local car — reconcile eases\n` +
      `toward the target, so the snap is what the player sees. A mirage covers ` +
      `${(forwardMaxSpeedOf("mirage") / TICK_RATE_HZ).toFixed(1)} u/tick and its hull is ` +
      `${DRIVE_CONFIG.carWidth} x ${DRIVE_CONFIG.carHeight}.\nRows are one-way delays (no jitter, no loss), ` +
      `then the netsim's net80 link (40 ms one-way, 10 ms jitter, 1% loss).\n` +
      rows.join("\n") +
      `\nworst free-driving error ${worstFreeError.toFixed(2)}u; worst collision error ${worstCollisionError.toFixed(2)}u, ` +
      `snap ${worstCollisionSnap.toFixed(2)}u (FINDING above ${DRIVE_CONFIG.carWidth}u, one car width, for either).\n` +
      `Before the netcode redesign this probe's frozen-remote client peaked at ~56u in contact at 120 ms one-way.`,
  );
}

/* ------------------------------- P2. where the error comes from: the remote pose resolved against */
{
  const rows: string[] = [];
  const capTicks = msToTicks(NET_CONFIG.maxExtrapolateMs);
  let worstContactReckoned = 0;
  for (const { link, collide } of runs) {
    const all = collide.remoteSamples;
    const contact = all.filter((s) => s.contact);
    const free = all.filter((s) => !s.contact);
    const beyondCap = all.filter((s) => s.aheadTicks > capTicks).length;
    worstContactReckoned = Math.max(worstContactReckoned, max(contact.map((s) => s.reckonedError)));
    rows.push(
      `${link.name.padStart(10)}  predicted p50 ${percentile(all.map((s) => s.aheadTicks), 50)}, ` +
        `max ${max(all.map((s) => s.aheadTicks))} ticks past the newest snapshot ` +
        `(${((beyondCap / Math.max(1, all.length)) * 100).toFixed(0)}% beyond the ${capTicks}-tick reckoning cap)\n` +
        `            approach: reckoned p95 ${percentile(free.map((s) => s.reckonedError), 95).toFixed(2).padStart(6)}u ` +
        `(frozen snapshot pose would be ${percentile(free.map((s) => s.frozenError), 95).toFixed(2)}u)\n` +
        `            contact:  reckoned p95 ${percentile(contact.map((s) => s.reckonedError), 95).toFixed(2).padStart(6)}u ` +
        `max ${max(contact.map((s) => s.reckonedError)).toFixed(2).padStart(6)}u ` +
        `(frozen p95 ${percentile(contact.map((s) => s.frozenError), 95).toFixed(2)}u)  [${contact.length} ticks]`,
    );
  }
  reporter.report(
    "P2. Why: how far is the remote car the client resolves against from where the server has it?",
    "KNOWN-BY-DESIGN",
    `The question this used to ask — how STALE is the frozen snapshot pose of the remote — is obsolete:\n` +
      `prediction now resolves against the remote dead-reckoned (shared stepSim, its last networked\n` +
      `lastSteer/lastThrottle) to the tick each predicted step needs (remotePoseTickFor), capped at\n` +
      `maxExtrapolateMs (${NET_CONFIG.maxExtrapolateMs} ms = ${capTicks} ticks) past its newest snapshot and held there.\n` +
      `So this measures the honest equivalent: the distance from that reckoned pose to the server's truth for\n` +
      `the same tick, on every tick the local car was predicted, in the head-on trial. "frozen" is what the\n` +
      `pre-E3 client's last-snapshot pose would have been off by on those same ticks.\n` +
      rows.join("\n") +
      `\nReckoning is exact while the remote's input holds and nothing touches it; a contact is exactly what\n` +
      `it cannot foresee (the contact itself, and the remote's own reaction), and past the cap it holds.\n` +
      `Rams are never compensated (NR41, docs/networking.md "What remains unfair"); worst contact error ` +
      `${worstContactReckoned.toFixed(2)}u.`,
  );
}

reporter.finish();
