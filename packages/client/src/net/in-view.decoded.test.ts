import { beforeEach, describe, expect, it } from "vitest";
import { Encoder, Reflection, StateView } from "@colyseus/schema";
import {
  ArenaState,
  DEFAULT_GAME_MODE,
  NEUTRAL_MODIFIERS,
  PlayerState,
  PlayerStatus,
  RemoteTimeline,
  StatusState,
  VIEW_OWNER,
  buildStepContext,
  getArena,
  installMode,
  localModifiers,
  modeConfigOf,
} from "@motor-combat-moba/shared";
import { fxCarViews } from "../fx/car-views.js";
import { rosterRows } from "../scenes/roster-panel.js";
import { carInView, feedRemoteTimeline, predictionStepContext, remoteSnapshotOf } from "./in-view.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

const arena = getArena("arena-01");

function car(id: string, x: number, y: number, joinedAtTick: number): PlayerState {
  const p = new PlayerState();
  p.sessionId = id;
  p.name = id;
  p.status = PlayerStatus.IN_MATCH;
  p.carId = "mirage";
  p.alive = true;
  p.hp = 100;
  p.joinedAtTick = joinedAtTick;
  p.x = x;
  p.y = y;
  // A status row on every car, as a live match has: the hidden one's array must not decode at all.
  const row = new StatusState();
  row.statusId = "reeling";
  row.startTick = 0;
  row.endsTick = 1;
  p.statuses.push(row);
  return p;
}

/**
 * The server's state as client `a` decodes it under FOV (NR42–NR44): its own car with the owner tag,
 * enemy `b` in its view, enemy `c` out of it. Encoded through a real `StateView`, so `c` arrives
 * exactly as a hidden car does — public fields only, every `@view()` field (pose, hp, statuses,
 * inView) absent.
 */
function decodedTick(tick: number, bx: number): ArenaState {
  const server = new ArenaState();
  server.tick = tick;
  const a = car("a", 300, 300, 1);
  const b = car("b", bx, 300, 2);
  const c = car("c", 1000, 600, 3);
  server.players.set("a", a);
  server.players.set("b", b);
  server.players.set("c", c);
  // The encoder first: a view only sees objects already attached to an encoder's root.
  const encoder = new Encoder(server);
  const view = new StateView();
  view.add(a, VIEW_OWNER);
  view.add(b);
  view.add(server.weapons);
  const decoder = Reflection.decode<ArenaState>(Reflection.encode(encoder));
  const it = { offset: 0 };
  const shared = encoder.encodeAll(it);
  const buf = new Uint8Array(64 * 1024);
  buf.set(shared.slice(0, it.offset));
  decoder.decode(encoder.encodeAllView(view, it.offset, { ...it }, buf));
  return decoder.state;
}

describe("the client's per-patch and per-frame paths with a hidden enemy PRESENT (G4 review C1)", () => {
  it("decodes the hidden enemy the way the paths below must cope with", () => {
    const s = decodedTick(10, 500);
    const c = s.players.get("c")!;
    expect(c.alive).toBe(true);
    expect(c.status).toBe(PlayerStatus.IN_MATCH);
    expect(c.x).toBeUndefined();
    expect(c.statuses).toBeUndefined();
    expect(c.inView).toBeUndefined();
    expect(s.players.get("b")!.inView).toBe(true);
    expect(carInView("c", c, "a")).toBe(false);
    // The trap the review found: any StepContext built over the whole decoded roster throws.
    expect(() => buildStepContext(arena, s, "b", 10, NEUTRAL_MODIFIERS)).toThrow();
  });

  it("feeds the timeline, predicts, derives fx and lists the roster without throwing", () => {
    const timeline = new RemoteTimeline();
    let state = decodedTick(1, 500);
    // Per patch, exactly as `ArenaScene.pushRemoteSnapshots` does it.
    for (let tick = 1; tick <= 6; tick++) {
      state = decodedTick(tick, 500 + tick);
      const s = state;
      expect(() =>
        feedRemoteTimeline(timeline, s.players, "a", tick, (player, sessionId) =>
          remoteSnapshotOf(arena, player, sessionId, tick),
        ),
      ).not.toThrow();
    }

    // Per frame: the remote's drawn pose, the prediction context, the fx world and the roster.
    timeline.beginFrame(undefined, 16);
    expect(timeline.pose("b")!.x).toBe(506);
    expect(timeline.pose("c")).toBeUndefined();

    const ctx = predictionStepContext(arena, state.players, "a", 7, localModifiers(state, "a", 7), (id, at) =>
      timeline.reckonedPose(id, at),
    );
    expect(ctx.others).toHaveLength(1);
    expect(Number.isFinite(ctx.others[0]!.hull.x)).toBe(true);

    const cars = fxCarViews(state.players, "a", (player) => ({ x: player.x, y: player.y, angle: player.angle }));
    expect(cars.map((c) => c.sessionId)).toEqual(["a", "b"]);
    expect(cars.every((c) => Number.isFinite(c.x) && Number.isFinite(c.hp))).toBe(true);

    const rows = rosterRows([...state.players.values()]);
    expect(rows.map((r) => r.sessionId)).toEqual(["a", "b", "c"]);
    expect(rows[2]).toMatchObject({ name: "c", alive: true, kills: 0 });
  });

  it("a remote's snapshot context carries its own chassis and status modifiers, and no other car", () => {
    const s = decodedTick(1, 500);
    const snap = remoteSnapshotOf(arena, s.players.get("b")!, "b", 0);
    expect(snap.ctx.others).toEqual([]);
    expect(snap.ctx.carId).toBe("mirage");
    // `reeling` is live at tick 0 (endsTick 1): its modifiers reach the remote's own reckoning.
    expect(snap.ctx.modifiers).not.toEqual(NEUTRAL_MODIFIERS);
    expect(snap.body.x).toBe(500);
  });
});
