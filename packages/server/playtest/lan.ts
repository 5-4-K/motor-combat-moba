/**
 * A real LAN playtest: the built server on a real port, real `colyseus.js` clients over real
 * WebSockets, driven through the real lobby -> car select -> reveal -> countdown -> match flow.
 *
 * The deterministic probes prove what the sim does. This proves the same thing survives the wire:
 * schema encoding, patch rate (20 Hz against a 30 Hz sim), simulated latency, and the room's own
 * scheduling. Run it against a server started with SIM_LATENCY_MS to model a real LAN.
 */
import { Client, type Room } from "colyseus.js";

const ENDPOINT = process.env.PLAYTEST_ENDPOINT ?? "ws://127.0.0.1:2567";
const TICK_MS = 1000 / 30;

interface Bot {
  name: string;
  room: Room;
  seq: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function join(name: string): Promise<Bot> {
  const client = new Client(ENDPOINT);
  const room = await client.joinOrCreate("arena", { name });
  return { name, room, seq: 0 };
}

function send(bot: Bot, msg: { steer?: -1 | 0 | 1; throttle?: -1 | 0 | 1; fireSlots?: number }): void {
  bot.seq += 1;
  bot.room.send("input", { seq: bot.seq, steer: 0, throttle: 0, fireSlots: 0, ...msg });
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

const PHASE = { LOBBY: 0, CAR_SELECT: 1, REVEAL: 2, COUNTDOWN: 3, MATCH: 4, POST_MATCH: 5 } as const;

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
  await until(alice, () => state().phase === PHASE.CAR_SELECT, 5000, "car select");
  console.log("phase -> CAR_SELECT");

  // Alice takes the rammer, Bob takes the glass cannon.
  alice.room.send("select_car", { carId: "bastion" });
  bob.room.send("select_car", { carId: "bullseye" });

  await until(alice, () => state().phase === PHASE.MATCH, 30000, "match start");
  console.log("phase -> MATCH");

  const me = (bot: Bot) => state().players.get(bot.room.sessionId);
  const other = (bot: Bot) => state().players.get(bot === alice ? bob.room.sessionId : alice.room.sessionId);
  console.log(
    `Alice ${me(alice).carId} hp ${me(alice).hp} @ (${me(alice).x.toFixed(0)}, ${me(alice).y.toFixed(0)})  ` +
      `Bob ${me(bob).carId} hp ${me(bob).hp} @ (${me(bob).x.toFixed(0)}, ${me(bob).y.toFixed(0)})`,
  );

  /* ---------------------------------------------------- observation 1: ram over the wire */
  // Alice drives straight at Bob and rams him repeatedly; Bob holds still. Count how many
  // contacts produce a visible knock (shove/spin/authority) on Bob's networked state.
  console.log("\n--- ram trial: Alice charges Bob, Bob parked ---");
  let contacts = 0;
  let knocks = 0;
  let wasTouching = false;
  // Seeded from the first sample rather than assumed to be 1: this loop starts mid-match and the
  // car may already be carrying a knock.
  let lastAuthority: number | null = null;
  const ramStart = Date.now();
  while (Date.now() - ramStart < 20000) {
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
    // A knock is counted on a DROP in authority, not on a transition away from exactly 1.
    //
    // `authority` decays monotonically back UP toward 1 and a fresh knock is the only thing that can
    // lower it, so a drop is an unambiguous knock event. The transition test this replaced required
    // authority to have returned to exactly 1 first — which made it undercount precisely when rams
    // land reliably, since a car under repeated attack never gets back to 1 between hits. It read
    // 12% against an offline trigger rate of 100%, which is a broken counter, not a broken sim.
    if (lastAuthority !== null && b.authority < lastAuthority - 0.001) knocks++;
    lastAuthority = b.authority;
    await sleep(TICK_MS);
  }
  // Sampled at ~30 Hz against a 20 Hz patch rate, so both counts are approximate — a contact that
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
    const a = me(alice);
    const b = me(bob);
    if (!a?.alive || !b?.alive) break;
    // Rotate through the three slots so every weapon in both kits actually fires.
    const slot = 1 << (Math.floor((Date.now() - fireStart) / 2500) % 3);
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
  console.log(`phase now: ${Object.entries(PHASE).find(([, v]) => v === state().phase)?.[0]}`);
  if (state().winnerSessionId) {
    console.log(`winner: ${state().players.get(state().winnerSessionId)?.name ?? state().winnerSessionId}`);
  }

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
