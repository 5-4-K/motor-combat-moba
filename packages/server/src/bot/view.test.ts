import { describe, expect, it } from "vitest";
import {
  ArenaState,
  PlayerState,
  applyStatus,
  hpOf,
  newStatusState,
  type WeaponInstance,
} from "@motor-combat-moba/shared";
import { newCombatMemory, toCombatPlayers, type CombatMemory } from "../sim/combat-bridge.js";
import { writeStatuses } from "../sim/status-bridge.js";
import { makeRng } from "./rng.js";
import { buildBotView, snapshotWorld } from "./view.js";
import { ViewRing } from "./view-ring.js";

// Copied from `combat-bridge.test.ts` rather than invented: it is the same shape a real room
// produces, and `buildBotView` must be tested against exactly that, not a hand-rolled stand-in.
function playerIn(state: ArenaState, sessionId: string, over: Partial<PlayerState> = {}): PlayerState {
  const player = new PlayerState();
  player.sessionId = sessionId;
  player.x = 400;
  player.y = 150;
  player.angle = 0;
  player.carId = "mirage";
  player.hp = hpOf("mirage");
  player.alive = true;
  player.level = 1;
  Object.assign(player, over);
  state.players.set(sessionId, player);
  return player;
}

interface Fixture {
  state: ArenaState;
  selfSessionId: string;
  combat: CombatMemory;
  rng: ReturnType<typeof makeRng>;
}

function fixture(): Fixture {
  const state = new ArenaState();
  playerIn(state, "bot", { carId: "mirage", x: 300 });
  playerIn(state, "p2", { carId: "bastion", x: 600 });
  const combat = newCombatMemory();
  // Runs the real fire-state build (`toCombatPlayers`) so `self.slots` carries a genuine loadout —
  // exactly what `ArenaRoom.tick` would have on hand when it asks the bot to decide.
  toCombatPlayers(state, new Set(["bot", "p2"]), new Map(), combat);
  return { state, selfSessionId: "bot", combat, rng: makeRng(1) };
}

function fixtureWithPhasedOpponent(): Fixture {
  const f = fixture();
  const p2 = f.state.players.get("p2")!;
  writeStatuses(p2, applyStatus(newStatusState(), "phased", f.state.tick, 90));
  return f;
}

describe("buildBotView fairness (B15, B16, B18)", () => {
  it("gives the bot its own slot state in full", () => {
    const view = buildBotView(fixture())!;
    expect(view.self.slots.length).toBeGreaterThan(0);
    expect(view.self.slots[0]).toHaveProperty("rechargeEndsTick");
    expect(view.self.slots[0]).toHaveProperty("range");
  });

  it("never exposes another car's slot state", () => {
    const view = buildBotView(fixture())!;
    for (const other of view.others) {
      expect(other).not.toHaveProperty("slots");
      expect(other).not.toHaveProperty("stocks");
      expect(other).not.toHaveProperty("rechargeEndsTick");
    }
  });

  it("carries no route back to keypresses", () => {
    const view = buildBotView(fixture())!;
    const json = JSON.stringify({ ...view, rng: undefined });
    expect(json).not.toContain("inputQueues");
    expect(json).not.toContain("prevFireMasks");
    expect(json).not.toContain("fireMask");
    expect(json).not.toContain("lastDamagerSessionId");
  });

  it("marks a phased car as phased, since a human sees it translucent", () => {
    const view = buildBotView(fixtureWithPhasedOpponent())!;
    expect(view.others.find((o) => o.sessionId === "p2")?.phased).toBe(true);
  });

  it("excludes the bot itself from others", () => {
    const view = buildBotView(fixture())!;
    expect(view.others.map((o) => o.sessionId)).not.toContain("bot");
  });

  it("passes observed fires through, and defaults them to empty", () => {
    expect(buildBotView(fixture())!.observedFires).toEqual([]);
    const fires = [
      { tick: 1, shooterSessionId: "p2", carId: "mirage", weaponId: "magmablast", slot: 0, pressId: "p2#1#0" },
    ] as const;
    expect(buildBotView({ ...fixture(), observedFires: fires })!.observedFires).toEqual(fires);
  });

  it("returns null when the bot's own car is gone", () => {
    expect(buildBotView({ ...fixture(), selfSessionId: "nobody" })).toBeNull();
  });
});

describe("buildBotView view staleness (B19)", () => {
  it("stalenessTicks 0, absent, and 0-with-a-ring-present all produce the identical others/instances", () => {
    const f = fixture();
    const noKnob = buildBotView(f)!;
    const explicitZero = buildBotView({ ...f, stalenessTicks: 0 })!;
    const zeroWithRing = buildBotView({ ...f, stalenessTicks: 0, ring: new ViewRing(4) })!;
    expect(explicitZero.others).toEqual(noKnob.others);
    expect(explicitZero.instances).toEqual(noKnob.instances);
    expect(zeroWithRing.others).toEqual(noKnob.others);
    expect(zeroWithRing.instances).toEqual(noKnob.instances);
  });

  it("nonzero stalenessTicks reads a past snapshot from the ring, not the live state", () => {
    const f = fixture();
    const ring = new ViewRing(8);
    ring.push(snapshotWorld(f.state, f.combat)); // tick 0: p2 at x=600 (fixture default)

    f.state.players.get("p2")!.x = 999; // world moves on...
    f.state.tick = 3; // ...three ticks pass with no new snapshot pushed for them

    const stale = buildBotView({ ...f, stalenessTicks: 3, ring })!;
    expect(stale.others.find((o) => o.sessionId === "p2")?.x).toBe(600);

    const live = buildBotView({ ...f, stalenessTicks: 0 })!;
    expect(live.others.find((o) => o.sessionId === "p2")?.x).toBe(999);
  });

  it("falls back to the live world when the ring has nothing that old yet", () => {
    const f = fixture();
    f.state.tick = 2; // a fresh ring: nothing has ever been pushed
    const view = buildBotView({ ...f, stalenessTicks: 5, ring: new ViewRing(8) })!;
    expect(view.others.find((o) => o.sessionId === "p2")?.x).toBe(600); // live fixture position
  });
});

/** A minimal, valid `WeaponInstance` — only `id`/`ownerSessionId`/`weaponId`/`x`/`y`/`angle` matter
 * to `buildBotView`, but the type demands the rest of the sim-only bookkeeping fields too. */
function fakeInstance(over: Partial<WeaponInstance> & { id: string; x: number; y: number }): WeaponInstance {
  return {
    ownerSessionId: "p2",
    finalWave: true,
    ownerTeam: 0,
    damage: 0,
    weaponId: "predator",
    kind: "projectile",
    angle: 0,
    extent: 0,
    spawnTick: 0,
    distance: 0,
    pierceLeft: 0,
    attached: false,
    damageClock: new Map(),
    alive: true,
    muzzleDir: 0,
    homingTargetId: "",
    homingUntilTick: 0,
    expiresAtTick: 0,
    isExplosion: false,
    pressId: "p2#0#0",
    ...over,
  };
}

describe("buildBotView viewport fairness (B17)", () => {
  it("arena-01 (the shipped arena) shows every car regardless of distance — it always fits", () => {
    const f = fixture();
    f.state.arenaId = "arena-01";
    // Opposite corners of the 1280x720 arena: farther apart than the 1280x720 viewport rectangle
    // would allow if a limit were (wrongly) applied here.
    f.state.players.get("bot")!.x = 40; f.state.players.get("bot")!.y = 40;
    f.state.players.get("p2")!.x = 1240; f.state.players.get("p2")!.y = 680;
    const view = buildBotView(f)!;
    expect(view.others.map((o) => o.sessionId)).toContain("p2");
  });

  it("a larger arena (arena-02) hides a car outside the viewport rectangle centred on self", () => {
    const f = fixture();
    f.state.arenaId = "arena-02"; // 2000x2000 — does not fit the 1280x720 viewport
    f.state.players.get("bot")!.x = 100; f.state.players.get("bot")!.y = 100;
    f.state.players.get("p2")!.x = 1900; f.state.players.get("p2")!.y = 1900; // far outside
    const view = buildBotView(f)!;
    expect(view.others.map((o) => o.sessionId)).not.toContain("p2");
  });

  it("a larger arena still shows a car that IS inside the viewport rectangle", () => {
    const f = fixture();
    f.state.arenaId = "arena-02";
    f.state.players.get("bot")!.x = 1000; f.state.players.get("bot")!.y = 1000;
    f.state.players.get("p2")!.x = 1100; f.state.players.get("p2")!.y = 1000; // 100u away, well inside
    const view = buildBotView(f)!;
    expect(view.others.map((o) => o.sessionId)).toContain("p2");
  });

  it("on a larger arena, a live instance outside the viewport is filtered out of `instances`", () => {
    const f = fixture();
    f.state.arenaId = "arena-02";
    f.state.players.get("bot")!.x = 100; f.state.players.get("bot")!.y = 100;
    f.combat.instances.set("far", fakeInstance({ id: "far", x: 1900, y: 1900 }));
    f.combat.instances.set("near", fakeInstance({ id: "near", x: 150, y: 150 }));
    const view = buildBotView(f)!;
    const ids = view.instances.map((i) => i.id);
    expect(ids).toContain("near");
    expect(ids).not.toContain("far");
  });

  it("on the fitting arena, an instance is visible from any distance within the arena", () => {
    const f = fixture();
    f.state.arenaId = "arena-01";
    f.combat.instances.set("corner", fakeInstance({ id: "corner", x: 1240, y: 680 }));
    const view = buildBotView(f)!;
    expect(view.instances.map((i) => i.id)).toContain("corner");
  });
});
