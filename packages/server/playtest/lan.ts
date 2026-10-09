/**
 * A real LAN playtest: the built server on a real port, real `@colyseus/sdk` clients over real
 * WebSockets, driven through the real lobby -> car select -> reveal -> countdown -> match flow.
 *
 * The deterministic probes prove what the sim does. This proves the same thing survives the wire:
 * schema encoding, patch rate (`SNAPSHOT_RATE_HZ` against the `TICK_RATE_HZ` sim), simulated latency,
 * and the room's own scheduling. Run it against a server started with SIM_LATENCY_MS to model a real LAN.
 */
import { Client, type Room } from "@colyseus/sdk";
import {
  ClockSync,
  InputScheduler,
  MS_PER_TICK,
  MSG_PING,
  MSG_TIME,
  NET_CONFIG,
  PROTOCOL_VERSION,
  RoomPhase,
  speedOf,
  type InputFrame,
} from "@motor-combat-moba/shared";

const ENDPOINT = process.env.PLAYTEST_ENDPOINT ?? "ws://127.0.0.1:2567";
/** The driver loop samples once per sim tick (invariant 1: the rate lives once, in shared). */
const TICK_MS = MS_PER_TICK;

interface Bot {
  name: string;
  room: Room;
  /** The same clock sync and input scheduler the browser client runs (NR18, NR20). */
  clock: ClockSync;
  scheduler: InputScheduler;
  /** Sent frames, newest last, for packet redundancy (NR24). */
  frames: InputFrame[];
  lastSendMs: number;
  /** The newest snapshot's `inputSlack`, handed to the scheduler once and then cleared (NR21). */
  freshSlack: number | undefined;
  /** That snapshot's `inputSlackStd`, handed over with it (D5 ruling E). */
  freshSlackStd: number;
  /** The close code if the server dropped this bot mid-run (a rate-limit kick would show here). */
  droppedWith: number | undefined;
  /** Snapshot decoding health: patches seen, and any whose `state.tick` did not advance (NR12, NR56). */
  patches: number;
  tickRegressions: number;
  lastTick: number;
  decodeErrors: string[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function join(name: string): Promise<Bot> {
  const client = new Client(ENDPOINT);
  // `protocol` on every join (NR55): a server refuses a join that does not carry its PROTOCOL_VERSION.
  const room = await client.joinOrCreate("arena", { name, protocol: PROTOCOL_VERSION });
  // The server never allows reconnection; the SDK default would hang on a dropped socket.
  room.reconnection.enabled = false;
  const clock = new ClockSync();
  const bot: Bot = {
    name, room, clock, scheduler: new InputScheduler(clock), frames: [], lastSendMs: performance.now(),
    freshSlack: undefined, freshSlackStd: 0, droppedWith: undefined,
    patches: 0, tickRegressions: 0, lastTick: -1, decodeErrors: [],
  };
  room.onError((code, message) => {
    bot.decodeErrors.push(`${code}: ${message}`);
  });
  room.onLeave((code) => {
    bot.droppedWith = code;
  });
  // Time sync exactly as `ArenaScene.bindTimeSync` runs it: a burst on join, then the steady rate.
  room.onMessage(MSG_TIME, (p) => clock.onPong(performance.now(), p));
  room.onMessage(MSG_PING, (m) => room.send(MSG_PING, m));
  const ping = (): void => room.send(MSG_TIME, { c: performance.now() });
  ping();
  const burst = setInterval(ping, NET_CONFIG.timeSyncBurstMs);
  setTimeout(() => {
    clearInterval(burst);
    setInterval(ping, NET_CONFIG.timeSyncIntervalMs).unref();
  }, NET_CONFIG.timeSyncBurstWindowMs).unref();
  room.onStateChange((state: any) => {
    // Every snapshot is one tick (NR12): a patch whose tick does not move forward was decoded out of
    // order or not at all — what an out-of-order delayed frame would produce.
    bot.patches++;
    if (typeof state.tick === "number") {
      if (state.tick <= bot.lastTick) bot.tickRegressions++;
      bot.lastTick = state.tick;
    }
    const me = state.players?.get(room.sessionId);
    if (me) {
      bot.freshSlack = me.inputSlack;
      bot.freshSlackStd = me.inputSlackStd;
    }
  });
  return bot;
}

/**
 * Hold these keys: one tick-stamped frame for every server tick the scheduler says is due since the
 * last call, sent with the previous frames as redundancy — the browser client's `pumpInput`.
 */
function send(bot: Bot, msg: { steer?: -1 | 0 | 1; throttle?: -1 | 0 | 1; fireSlots?: number }): void {
  const now = performance.now();
  const slack = bot.freshSlack;
  bot.freshSlack = undefined;
  const ticks = bot.scheduler.due(now, now - bot.lastSendMs, slack, bot.freshSlackStd);
  bot.lastSendMs = now;
  for (const tick of ticks) {
    bot.frames.push({ tick, steer: 0, throttle: 0, fireSlots: 0, ...msg });
    if (bot.frames.length > 1 + NET_CONFIG.inputRedundancy) bot.frames.shift();
    bot.room.send("input", { inputs: bot.frames.slice() });
  }
}

/** Poll `state` until `predicate` holds, or give up. */
async function until(bot: Bot, predicate: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main(): Promise<void> {
  console.log(`connecting to ${ENDPOINT}`);
  const alice = await join("Alice");
  const bob = await join("Bob");
  const state = () => alice.room.state as any;

  await until(alice, () => state().players.size === 2, 5000, "both players in the room");
  console.log(`joined: ${[...state().players.values()].map((p: any) => p.name).join(", ")}`);
  console.log(`host is ${state().players.get(state().hostSessionId)?.name}`);

  // FFA so both cars fight each other.
  const host = state().hostSessionId === alice.room.sessionId ? alice : bob;
  host.room.send("set_mode", { mode: 0 });
  await sleep(200);
  host.room.send("start_match");
  // Start opens the arena select screen (AR13): the host picks the mode's default arena at once
  // rather than sitting out the choosing clock, then the reveal holds before car select.
  await until(alice, () => state().phase === RoomPhase.ARENA_SELECT, 5000, "arena select");
  host.room.send("arena_pick", { arenaId: state().arenaHighlightId });
  await until(alice, () => state().phase === RoomPhase.CAR_SELECT, 10000, "car select");
  console.log("phase -> CAR_SELECT");

  // Alice takes the rammer, Bob takes the glass cannon.
  alice.room.send("select_car", { carId: "bastion" });
  bob.room.send("select_car", { carId: "bullseye" });

  // The real `RoomPhase` (constants.ts), not a hand table: the old one numbered REVEAL as 2 and MATCH
  // as 4, so this wait used to release on REVEAL and the trials began before the countdown.
  await until(alice, () => state().phase === RoomPhase.MATCH, 30000, "match start");
  console.log("phase -> MATCH");

  const me = (bot: Bot) => state().players.get(bot.room.sessionId);
  const other = (bot: Bot) => state().players.get(bot === alice ? bob.room.sessionId : alice.room.sessionId);
  console.log(
    `Alice ${me(alice).carId} hp ${me(alice).hp} @ (${me(alice).x.toFixed(0)}, ${me(alice).y.toFixed(0)})  ` +
      `Bob ${me(bob).carId} hp ${me(bob).hp} @ (${me(bob).x.toFixed(0)}, ${me(bob).y.toFixed(0)})`,
  );

  /* ---------------------------------------------------- observation 1: ram over the wire */
  // Alice drives straight at Bob and rams him repeatedly; Bob holds still (steer 0, throttle 0
  // every tick), so any vx/vy Bob's networked state carries is entirely the knock — the direct
  // successor of the old separate `shove` field, same reasoning the resting-victim probes in
  // ram.ts use. `authority` itself is gone for good; it now has a real successor, `reeling`
  // (total control loss under the 2026-09-18 Unity ram port — see `ram.ts`'s R5 for the detail),
  // readable off `state.players.get(...).statuses` on the wire the same as anywhere else. Not
  // measured here: writing that replacement is a scenario change bundled with the same call on
  // `collision.ts`'s probe 9 and `ram.ts`'s R5 — present all three together rather than deciding
  // one in isolation.
  console.log("\n--- ram trial: Alice charges Bob, Bob parked ---");
  let contacts = 0;
  let knocks = 0;
  let wasTouching = false;
  // Seeded from the first sample rather than assumed to be 0: this loop starts mid-match and the
  // car may already be carrying a knock decaying from an earlier hit.
  let lastShove: number | null = null;
  const ramStart = Date.now();
  while (Date.now() - ramStart < 20000) {
    if (state().phase !== RoomPhase.MATCH) break;
    const a = me(alice);
    const b = other(alice);
    if (!a || !b) break;
    // Steer toward Bob.
    const bearing = Math.atan2(b.y - a.y, b.x - a.x);
    let delta = bearing - a.angle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    const steer: -1 | 0 | 1 = delta > 0.08 ? 1 : delta < -0.08 ? -1 : 0;
    const gap = Math.hypot(b.x - a.x, b.y - a.y);
    // Back off and re-charge so each pass is a fresh approach, as a player would.
    const throttle: -1 | 0 | 1 = gap < 70 ? -1 : 1;
    send(alice, { steer, throttle });
    send(bob, {});

    const touching = gap < 56;
    if (touching && !wasTouching) contacts++;
    wasTouching = touching;
    // A knock is counted on a RISE in shove, not on a transition away from exactly 0. Knock only
    // decays between impacts, so any rise is a fresh ram landing — same rise-detection this probe
    // used on `authority` before the rework, now read off the velocity Bob carries instead, since
    // Bob never drives and so never contributes velocity of his own.
    const shove = speedOf(b.vx, b.vy);
    if (lastShove !== null && shove > lastShove + 5) knocks++;
    lastShove = shove;
    await sleep(TICK_MS);
  }
  // Sampled once per sim tick against the room's patch rate, so both counts are approximate — a contact that
  // begins and ends between two samples is invisible to either. The ratio is the signal: it sat
  // near 20% while the ram trigger bug was live and should now track the contact count closely.
  console.log(
    `contacts made: ${contacts}; knocks landed on Bob: ${knocks} ` +
      `(${contacts > 0 ? Math.round((knocks / contacts) * 100) : 0}% of contacts)`,
  );
  console.log(`Bob hp after 20s of being rammed: ${other(alice)?.hp} (a ram deals no damage by design)`);

  /* ------------------------------------------------ observation 2: weapons over the wire */
  console.log("\n--- weapon trial: both fire every slot ---");
  const hpBefore = { alice: me(alice).hp, bob: me(bob).hp };
  const seenWeapons = new Set<string>();
  const fireStart = Date.now();
  while (Date.now() - fireStart < 20000) {
    if (state().phase !== RoomPhase.MATCH) break;
    const a = me(alice);
    const b = me(bob);
    if (!a?.alive || !b?.alive) break;
    // Rotate through the three ABILITY slots (fire slots 1..3; fire slot 0 is the basic attack, which
    // every shipped mode switches off) so every weapon in both kits actually fires.
    const slot = 1 << (1 + (Math.floor((Date.now() - fireStart) / 2500) % 3));
    send(alice, { throttle: 0, fireSlots: slot });
    send(bob, { throttle: 0, fireSlots: slot });
    state().weapons.forEach((w: any) => seenWeapons.add(w.weaponId));
    await sleep(TICK_MS);
  }
  console.log(`weapons observed on the wire: ${[...seenWeapons].sort().join(", ")}`);
  console.log(
    `Alice hp ${hpBefore.alice} -> ${me(alice)?.hp} (alive ${me(alice)?.alive});  ` +
      `Bob hp ${hpBefore.bob} -> ${me(bob)?.hp} (alive ${me(bob)?.alive})`,
  );
  const statusesSeen = new Set<string>();
  state().players.forEach((p: any) => p.statuses.forEach((s: any) => statusesSeen.add(s.statusId)));
  console.log(`statuses on the wire right now: ${[...statusesSeen].join(", ") || "none"}`);
  console.log(`phase now: ${RoomPhase[state().phase as RoomPhase] ?? state().phase}`);
  if (state().winnerSessionId) {
    console.log(`winner: ${state().players.get(state().winnerSessionId)?.name ?? state().winnerSessionId}`);
  }

  for (const b of [alice, bob]) {
    console.log(
      `${b.name}: ${b.patches} patches decoded, state.tick ended at ${b.lastTick}, ` +
        `non-advancing ticks ${b.tickRegressions}, room errors ${b.decodeErrors.join("; ") || "none"}`,
    );
  }
  // NR54: an honest client is never rate-limited or disconnected.
  const dropped = [alice, bob].filter((b) => b.droppedWith !== undefined);
  console.log(
    `server disconnects during the run: ${dropped.map((b) => `${b.name} (code ${b.droppedWith})`).join(", ") || "none"}`,
  );

  await alice.room.leave();
  await bob.room.leave();
  console.log("\ndone");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("LAN playtest failed:", err);
    process.exit(1);
  },
);
