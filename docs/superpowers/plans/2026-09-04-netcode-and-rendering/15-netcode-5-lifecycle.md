# Netcode Phase 5 — Lifecycle: Reconnect, Silence, Floods and Late Join

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dropped socket stops ending the session. The server holds the seat for a minute while the car brakes to a stop and stays killable; the client retries with backoff and, when it gets back in, takes one full snapshot as a new baseline and is playing again within seconds. Alongside it, the two link conditions the design names but nothing has ever detected — a client whose inputs are all arriving late, and a client sending far more of them than a tick rate can use — become a warning and a throttle. And every row of the spec's failure-mode table gets a defined response instead of an implied one.

**Architecture:** Server-side, `ArenaRoom.onLeave` splits in two: an **unexpected** leave from a live match awaits `allowReconnection(client, NET_CONFIG.reconnectSeconds)` and keeps the seat, and everything that used to happen on a leave moves into `releaseSeat`, which now runs only when the window actually closes. Client-side, a new `net/reconnect.ts` owns the retry loop and `ColyseusTransport` gains a `rebind`, so `MatchClient` survives a socket change without being rebuilt — it is reseeded, which N4 already made a complete reset. `match/link-health.ts` turns `Snapshot.slackTicks` and the stall clock into one banner state, and `net/flood-detector.ts` is the server's rate limit.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), npm workspaces, Colyseus 0.15 (`Room.allowReconnection`, `Client.reconnect`, `Room.reconnectionToken`), vitest in the **node** environment, Playwright for the smoke scripts.

**Spec:** [`2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) — §6.10 in full (N26, N27), §6.12 in full, §7, §8 phase 5 row, §9.
**Ledger:** [`interfaces.md`](interfaces.md) — `NET_CONFIG`'s four lifecycle keys, `MatchTransport`, `SnapshotBroadcaster`, `InputRing`. **Previous phase:** [`14-netcode-4-feel.md`](14-netcode-4-feel.md) — **read its `## Handoff` in full before Task 1**, and its "For N5 specifically" bullet in particular. Phases 3, 2 and 1 are [`13-netcode-3-world.md`](13-netcode-3-world.md), [`12-netcode-2-wire.md`](12-netcode-2-wire.md) and [`11-netcode-1-time.md`](11-netcode-1-time.md). **Runbook:** [`00-execution-guide.md`](00-execution-guide.md) — §3, §5 (the N5 gate), §7.

## The two reconnect numbers, which are not the same number

Spec §8's phase 5 row says **"a pulled cable resumes within 15 s"**. N26 says the server calls **`allowReconnection(client, 60)`**. Both are correct and they measure different things:

| Number | What it is | Where it lives |
|---|---|---|
| **15 s** | how long between the cable going back in and the player driving again — one retry delay, one join round trip, one clock sample, one full snapshot | `RECONNECT_POLICY.maxDelayMs` plus the resume path, measured by `npm run smoke:reconnect` |
| **60 s** (`NET_CONFIG.reconnectSeconds`) | how long the **server** holds the seat before giving up on a client that has not come back at all | `ArenaRoom.onLeave`'s `allowReconnection` |

The 15 s is a promise about *responsiveness* and the 60 s is a promise about *patience*. Confusing them is the one mistake this phase can make that no test would catch, so the derivation of the first is written out in Task 2 and the gate reads both.

## Global Constraints

- **Rebuild shared before testing**: `npm run build -w @motor-combat-moba/shared`. Server and client consume built `dist`.
- **Verify with root `npm test`**, never a per-workspace run alone.
- **`.js` import specifiers** on every local import; shared is imported as `@motor-combat-moba/shared`.
- **Nothing under `packages/client/src/match/` imports Phaser, and no test imports Phaser.** `match/link-health.ts` is pure; `net/reconnect.ts` imports `colyseus.js`, not Phaser, and its test drives a stub client.
- **Do not touch `packages/server/playtest/` except to fix a compile break**, and say loudly in the task's commit step which probe numbers your change moves. Task 5 edits `playtest/netcode.ts` — the one authorised harness — and nothing else.
- **Do not edit `docs/ideas/` or `docs/invariants/`.**
- **Commit after every task** on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch cut off it). `npm install` in a fresh worktree before the first build.
- **"main" means `development/main`.**
- **No balance table is edited**, so `npm run build:manual` and `docs/turn-tuning.md` are not owed an update. `protocolHash()` does not cover `NET_CONFIG`, so the four lifecycle keys move no hash.
- **`PracticeRoom` never gains a reconnect window.** Root `CLAUDE.md` and the practice spec's PR30: a closed tab disposes the room, because a practice session is one player against a bot and there is nobody to hold a seat for. `PlaygroundRoom` is the same. Task 1 touches `ArenaRoom` only, and Task 1 Step 6 is the test that keeps it that way.
- **A held seat is a live car.** N26 is explicit: the car "brakes to a stop and stays where it is, solid and killable — a stopped car is a target, not an invulnerable obstacle, so it needs no despawn". Nothing in this phase may make an absent player's car intangible, invulnerable, or exempt from a win check.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/config/net-config.ts` (modify) | `reconnectSeconds`, `silenceWarnMs`, `floodRateMultiple`, `floodDisconnectMs` |
| `packages/shared/src/schema/PlayerState.ts` (modify) | `connected: boolean`, appended |
| `packages/server/src/net/flood-detector.ts` (create) | `FloodDetector` — N27's throttle and its disconnect clock |
| `packages/server/src/net/input-ring.ts` (modify) | `InputRing.reset()` |
| `packages/server/src/rooms/ArenaRoom.ts` (modify) | `onLeave` splits into the hold and `releaseSeat`; `onResume`; the flood detector per client |
| `packages/server/src/rooms/{PracticeRoom,PlaygroundRoom}.ts` (modify) | the flood detector only; **no** reconnect window |
| `packages/client/src/net/reconnect.ts` (create) | `Reconnector`, `RECONNECT_POLICY` |
| `packages/client/src/net/connection.ts` (modify) | `reconnectArena(token)` |
| `packages/client/src/match/transport.ts` (modify) | `ColyseusTransport.rebind(room)` |
| `packages/client/src/match/clock.ts` (modify) | `ClockSync.reset()` |
| `packages/client/src/match/link-health.ts` (create) | `LinkHealth` — one banner state from the link's own numbers |
| `packages/client/src/scenes/ArenaScene.ts` (modify) | the reconnect wiring and the banner's reason |
| `packages/client/src/scenes/arena/match-banners.ts` (modify) | `setConnectionWarning(state, message)` |
| `packages/client/src/scenes/roster-panel.ts` (modify) | an absent player's row is dimmed |
| `scripts/smoke-reconnect.mjs` (create), `package.json` (modify) | `npm run smoke:reconnect` — two real clients, one real cable pull |
| `packages/server/playtest/netcode.ts` (modify) | the N7 row: silence, floods and the resume path under the link model |
| `docs/networking.md`, `docs/schema-reference.md`, `docs/config-reference.md`, `docs/project-structure.md`, `docs/glossary.md`, `docs/deployment.md`, `packages/client/CLAUDE.md` (modify) | the lifecycle, and what a player sees |

---

### Task 1: The server holds the seat (N26)

**Files:**
- Create: `packages/server/src/net/flood-detector.ts`, `packages/server/src/net/flood-detector.test.ts`
- Modify: `packages/shared/src/config/net-config.ts`, `packages/shared/src/schema/PlayerState.ts`, `packages/server/src/net/input-ring.ts`, `packages/server/src/net/input-ring.test.ts`, `packages/server/src/rooms/ArenaRoom.ts`, `packages/server/src/rooms/PracticeRoom.ts`, `packages/server/src/rooms/PlaygroundRoom.ts`
- Test: `packages/server/src/rooms/arena-reconnect.test.ts` (create)

**Interfaces:**
- Consumes: N1's `InputRing`; N2's `SnapshotBroadcaster` (`sendFull`, `forget`), `rosterMessage()`, `refreshRoster()`, `MSG_ROSTER`; N3's `worldTick`; N4's `pendingEvents`.
- Produces:

```ts
// shared, config/net-config.ts
reconnectSeconds: 60,
silenceWarnMs: 2000,
floodRateMultiple: 3,
floodDisconnectMs: 10000,

// shared, schema/PlayerState.ts — APPENDED, nothing renumbered
@type("boolean") connected = true;

// server, net/flood-detector.ts
export class FloodDetector {
  constructor(cfg: Pick<typeof NET_CONFIG, "floodRateMultiple" | "floodDisconnectMs">, limitPerSecond?: number);
  /** Call once per inbound input message. `false` means "ignore this one" (N6). */
  admit(nowMs: number): boolean;
  /** True once the client has been over the limit continuously for `floodDisconnectMs`. */
  shouldDisconnect(nowMs: number): boolean;
  reset(): void;
  readonly rate: number;              // messages in the last second
  readonly limit: number;             // TICK_RATE_HZ * floodRateMultiple
}

// server, net/input-ring.ts — additive
reset(): void;

// server, rooms/ArenaRoom.ts — private, named here because the tests call them
private releaseSeat(sessionId: string): void;
private onResume(client: Client): void;
```

#### What "holding the seat" actually means, field by field

Nothing is removed and nothing is frozen. The seat stays exactly where it was, and the tick loop keeps running over it:

| Thing | While the seat is held | Why |
|---|---|---|
| `state.players.get(sid)` | **stays**, with `connected = false` | the roster is the match's roster; a car that vanishes for a minute and comes back is a different problem from one that stops |
| `matchRoster` | **stays** | `worldTick` steps it, so the car exists in the world and can be rammed, shot and killed |
| the `InputRing` | **keeps being read** | N6's rule does the work: `repeat` for `repeatMaxTicks` (12 ticks, 200 ms), then `neutral` forever. Neutral throttle is the brake, so the car coasts to a stop over about a second and stays there |
| `isOnField` / `isSolid` | **unchanged** | N26: "solid and killable — a stopped car is a target, not an invulnerable obstacle, so it needs no despawn" |
| the win check | **not run** | it lives in `releaseSeat`, which does not run until the window closes. A player whose cable slipped out must not hand the match to the other side |
| the snapshot baseline | **kept until resume**, then dropped | `broadcaster.forget(sid)` on resume, so the first snapshot after a reconnect is a full one |
| `hostSessionId` | **not reassigned** | host succession is `releaseSeat`'s, for the same reason as the win check |

The one visible change is `connected`, and it is on the schema rather than in the snapshot on purpose: it is a lobby fact that changes twice a match at most, `stepWorld` never reads it, so invariant 8 does not claim it and N24's split puts it on the Colyseus side. It is **appended** to `PlayerState`, so the "never renumber" rule is preserved for every field that was already there.

- [ ] **Step 1: The four config keys**

`packages/shared/src/config/net-config.ts`, appended:

```ts
  /**
   * How long the server holds a seat after an unexpected leave, in seconds (N26). Generous, because
   * under full snapshots a reconnecting client needs exactly what a joining one needs: a roster
   * message and one full snapshot. There is no incremental state to catch up.
   *
   * **This is not the "resumes within 15 s" acceptance number.** That one is how quickly play
   * restarts once the cable is back, and it comes from `RECONNECT_POLICY.maxDelayMs` on the client;
   * this is how long the server waits for a client that may never come back at all.
   */
  reconnectSeconds: 60,
  /**
   * How long every snapshot in a row must report a repeated or neutral input before the player is
   * told their inputs are arriving late (N27). Two seconds is long enough that a single jitter
   * spike says nothing and short enough that a genuinely broken uplink is named before the player
   * concludes the game is at fault.
   */
  silenceWarnMs: 2000,
  /**
   * How many times the tick rate a client may send input messages at before the extras are ignored
   * (N6, N27). Three is deliberate headroom over the one-per-tick a correct client sends: a client
   * catching up after a hitch legitimately sends a burst, and a `maxCatchUpTicks` burst is six.
   */
  floodRateMultiple: 3,
  /**
   * How long a client may stay over that limit before it is disconnected with a reason (N27). Ten
   * seconds is far past any legitimate burst and far short of a whole match.
   */
  floodDisconnectMs: 10000,
```

`packages/shared/src/schema/PlayerState.ts`, appended after the last field:

```ts
  /**
   * Is this player's socket currently attached?
   *
   * `false` while the server is holding their seat through `allowReconnection` (N26). The car is
   * still in the world, still solid and still killable; this only says nobody is driving it. The
   * roster panel dims the row, and nothing else in the game reads it.
   *
   * Schema rather than snapshot: `stepWorld` never reads it, so invariant 8 does not claim it, and
   * it changes at most twice in a match. APPENDED — no existing field's position moved.
   */
  @type("boolean") connected = true;
```

- [ ] **Step 2: Write the failing flood-detector test**

```ts
// packages/server/src/net/flood-detector.test.ts
import { describe, expect, it } from "vitest";
import { NET_CONFIG, TICK_RATE_HZ } from "@motor-combat-moba/shared";
import { FloodDetector } from "./flood-detector.js";

const limit = TICK_RATE_HZ * NET_CONFIG.floodRateMultiple;

describe("FloodDetector", () => {
  it("admits a correct client sending one message per tick, forever", () => {
    const flood = new FloodDetector(NET_CONFIG);
    let now = 0;
    for (let i = 0; i < TICK_RATE_HZ * 30; i++) {
      now += 1000 / TICK_RATE_HZ;
      expect(flood.admit(now)).toBe(true);
    }
    expect(flood.shouldDisconnect(now)).toBe(false);
  });

  it("admits a catch-up burst of maxCatchUpTicks and stays under the limit", () => {
    const flood = new FloodDetector(NET_CONFIG);
    let now = 1000;
    for (let i = 0; i < NET_CONFIG.maxCatchUpTicks; i++) expect(flood.admit(now)).toBe(true);
    now += 1000;
    expect(flood.shouldDisconnect(now)).toBe(false);
  });

  it("ignores the extras past the limit and reports the rate", () => {
    const flood = new FloodDetector(NET_CONFIG);
    expect(flood.limit).toBe(limit);
    let admitted = 0;
    for (let i = 0; i < limit * 2; i++) if (flood.admit(1000)) admitted += 1;
    expect(admitted).toBe(limit);
    expect(flood.rate).toBe(limit * 2);
  });

  it("disconnects only after floodDisconnectMs of being continuously over", () => {
    const flood = new FloodDetector(NET_CONFIG);
    const flood1s = (at: number) => { for (let i = 0; i < limit * 2; i++) flood.admit(at); };
    for (let t = 0; t < NET_CONFIG.floodDisconnectMs; t += 200) {
      flood1s(t);
      expect(flood.shouldDisconnect(t)).toBe(false);
    }
    flood1s(NET_CONFIG.floodDisconnectMs + 1);
    expect(flood.shouldDisconnect(NET_CONFIG.floodDisconnectMs + 1)).toBe(true);
  });

  it("forgives a client that drops back under the limit", () => {
    const flood = new FloodDetector(NET_CONFIG);
    for (let i = 0; i < limit * 2; i++) flood.admit(0);
    // A whole second later at a legal rate: the window has rolled and the over-limit clock resets.
    for (let i = 0; i < 10; i++) flood.admit(2000 + i);
    expect(flood.shouldDisconnect(2000 + NET_CONFIG.floodDisconnectMs)).toBe(false);
  });

  it("is clean after a reset, which is what a resumed seat gets", () => {
    const flood = new FloodDetector(NET_CONFIG);
    for (let i = 0; i < limit * 2; i++) flood.admit(0);
    flood.reset();
    expect(flood.rate).toBe(0);
    expect(flood.admit(0)).toBe(true);
  });
});
```

- [ ] **Step 3: Write `net/flood-detector.ts`**

```ts
// packages/server/src/net/flood-detector.ts
import { NET_CONFIG, TICK_RATE_HZ } from "@motor-combat-moba/shared";

/**
 * N27's half of the input pipeline the ring does not cover: a client sending far more messages than
 * a tick rate can consume.
 *
 * The ring already discards what it cannot use — extras are ignored, late ones dropped (N6) — so
 * this is not about correctness of the sim. It is about the server's own time: decoding, validating
 * and ring-writing a thousand messages a second per client is work a malicious or broken client can
 * ask for and a correct one never does.
 *
 * Two clocks, deliberately separate. The **rate** is a rolling one-second count, which is what
 * decides whether a message is admitted. The **over-limit clock** starts the first time the rate
 * exceeds the limit and is cleared the moment it does not, so a legitimate catch-up burst never
 * accumulates toward a disconnect.
 *
 * Wall-clock rather than tick-based on purpose: this measures a client's *sending* behaviour, which
 * is not on the sim's clock and must keep working during a phase where the room is not ticking.
 */
export class FloodDetector {
  /** Arrival times inside the rolling window, oldest first. */
  private readonly window: number[] = [];
  private overSinceMs = -1;
  readonly limit: number;

  constructor(
    private readonly cfg: Pick<typeof NET_CONFIG, "floodRateMultiple" | "floodDisconnectMs">,
    limitPerSecond = TICK_RATE_HZ * cfg.floodRateMultiple,
  ) {
    this.limit = limitPerSecond;
  }

  admit(nowMs: number): boolean {
    this.roll(nowMs);
    this.window.push(nowMs);
    const over = this.window.length > this.limit;
    if (over) {
      if (this.overSinceMs < 0) this.overSinceMs = nowMs;
    } else {
      this.overSinceMs = -1;
    }
    return !over;
  }

  shouldDisconnect(nowMs: number): boolean {
    this.roll(nowMs);
    if (this.window.length <= this.limit) this.overSinceMs = -1;
    if (this.overSinceMs < 0) return false;
    return nowMs - this.overSinceMs >= this.cfg.floodDisconnectMs;
  }

  reset(): void {
    this.window.length = 0;
    this.overSinceMs = -1;
  }

  get rate(): number {
    return this.window.length;
  }

  /** Drop everything older than a second. The window is bounded by the flood itself. */
  private roll(nowMs: number): void {
    const floor = nowMs - 1000;
    let drop = 0;
    while (drop < this.window.length && this.window[drop]! <= floor) drop += 1;
    if (drop > 0) this.window.splice(0, drop);
  }
}
```

`InputRing` gains one method beside it, in `packages/server/src/net/input-ring.ts`:

```ts
  /**
   * Forget everything: the slots, the repeat source and the stats.
   *
   * Called when a held seat resumes (N26). The ring is `NET_CONFIG.ringSize` ticks — a little over
   * two seconds at 60 Hz — and a seat can be held for sixty, so every slot in it is stale by orders
   * of magnitude and the repeat source is a minute-old steering input. A resumed client's first
   * messages arrive stamped at the *current* tick plus its freshly-derived lead, so nothing in the
   * old contents could ever be correct.
   */
  reset(): void {
    this.slots.fill(undefined);
    this.lastAccepted = undefined;
    this.lastAcceptedTick = -1;
    this.stats.late = 0;
    this.stats.duplicate = 0;
    this.stats.future = 0;
    this.stats.repeated = 0;
    this.stats.neutral = 0;
  }
```

(Field names follow phase 1's implementation; if it stored its slots differently, reset whatever it stored, and keep the stats zeroed — the netgraph's rates are per-connection, and a resumed connection starts a new one.) One test appended to `input-ring.test.ts`:

```ts
  it("serves neutral after a reset, not the input from before it", () => {
    const ring = new InputRing();
    ring.accept({ tick: 100, steer: -1, throttle: 1, fireSlots: 0 }, 99);
    expect(ring.inputFor(100).source).toBe("fresh");
    ring.reset();
    expect(ring.inputFor(101)).toEqual({ input: NEUTRAL_INPUT, source: "neutral", slackTicks: -1 });
  });
```

- [ ] **Step 4: Write the failing room test**

```ts
// packages/server/src/rooms/arena-reconnect.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NET_CONFIG, PlayerStatus, RoomPhase } from "@motor-combat-moba/shared";
import { ArenaRoom } from "./ArenaRoom.js";

/**
 * A stub `Client`, which is all `allowReconnection` and `client.send` need. The room is driven
 * directly rather than through a Colyseus transport — the same way every other room test in this
 * package works.
 */
function client(sessionId: string) {
  return { sessionId, send: vi.fn(), leave: vi.fn(), error: vi.fn() } as never;
}

/** Puts a two-player room into a running match. The helpers phase 1-4's room tests already use. */
function matchRoom(): ArenaRoom { /* …the shared `startedMatch()` helper… */ }

describe("ArenaRoom reconnect (N26)", () => {
  let room: ArenaRoom;

  beforeEach(() => {
    room = matchRoom();
  });

  it("keeps the seat, the roster place and the car when a match player drops unexpectedly", async () => {
    const allow = vi.spyOn(room, "allowReconnection").mockReturnValue(new Promise(() => {}) as never);
    const leaving = room.state.players.get("a")!;
    const wasAt = { x: leaving.x, y: leaving.y };
    void room.onLeave(client("a"), false);
    await Promise.resolve();

    expect(allow).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "a" }), NET_CONFIG.reconnectSeconds);
    expect(room.state.players.has("a")).toBe(true);
    expect(room.state.players.get("a")!.connected).toBe(false);
    expect(room.state.players.get("a")!.status).toBe(PlayerStatus.IN_MATCH);
    expect(room.state.players.get("a")!.alive).toBe(true);
    expect(room.state.players.get("a")!.x).toBeCloseTo(wasAt.x, 6);
  });

  it("brakes the held car to a stop and leaves it solid", () => {
    void room.onLeave(client("a"), false);
    const player = room.state.players.get("a")!;
    player.speed = 400;
    // A second of ticks with nobody sending input: repeat for repeatMaxTicks, then neutral.
    for (let i = 0; i < 120; i++) room.tick();
    expect(room.state.players.get("a")!.speed).toBeLessThan(1);
    expect(room.state.players.get("a")!.alive).toBe(true);
    expect(room.matchRosterForTest.has("a")).toBe(true);
  });

  it("does not end the match while a seat is held", () => {
    void room.onLeave(client("a"), false);
    for (let i = 0; i < 120; i++) room.tick();
    expect(room.state.phase).toBe(RoomPhase.MATCH);
    expect(room.state.winnerSessionId).toBe("");
  });

  it("releases the seat, and only then runs the win check, when the window closes", async () => {
    let reject: (e: unknown) => void = () => {};
    vi.spyOn(room, "allowReconnection").mockReturnValue(
      new Promise((_, r) => { reject = r; }) as never,
    );
    const leaving = room.onLeave(client("a"), false);
    reject(new Error("timed out"));
    await leaving;
    expect(room.state.players.has("a")).toBe(false);
    expect(room.state.phase).not.toBe(RoomPhase.MATCH);
  });

  it("resumes: fresh ring, a roster message and a full snapshot", async () => {
    const back = client("a");
    vi.spyOn(room, "allowReconnection").mockResolvedValue(back);
    const sendFull = vi.spyOn(room.broadcasterForTest, "sendFull");
    const forget = vi.spyOn(room.broadcasterForTest, "forget");
    await room.onLeave(client("a"), false);
    expect(room.state.players.get("a")!.connected).toBe(true);
    expect(back.send).toHaveBeenCalledWith("roster", expect.objectContaining({ cars: expect.any(Array) }));
    expect(forget).toHaveBeenCalledWith("a");
    expect(sendFull).toHaveBeenCalledWith("a");
    expect(room.ringForTest("a")!.stats.repeated).toBe(0);
  });

  it("does not hold a seat for a consented leave", async () => {
    const allow = vi.spyOn(room, "allowReconnection");
    await room.onLeave(client("a"), true);
    expect(allow).not.toHaveBeenCalled();
    expect(room.state.players.has("a")).toBe(false);
  });

  it("does not hold a seat for someone who left the lobby", async () => {
    const lobby = lobbyRoom();
    const allow = vi.spyOn(lobby, "allowReconnection");
    await lobby.onLeave(client("a"), false);
    expect(allow).not.toHaveBeenCalled();
    expect(lobby.state.players.has("a")).toBe(false);
  });
});
```

`matchRosterForTest`, `broadcasterForTest` and `ringForTest` are the three read-only accessors this test needs; add them to `ArenaRoom` beside the ones phases 1–4 already added for their own tests, each commented as test-only. `lobbyRoom()` is the existing helper for a room in `LOBBY`.

- [ ] **Step 5: Split `onLeave`**

`packages/server/src/rooms/ArenaRoom.ts:256-300` (the current `onLeave`) becomes three members. **The body of `releaseSeat` is today's `onLeave` verbatim**, with `client.sessionId` replaced by the `sessionId` parameter — no rule inside it changes, and that is the point: a seat that is genuinely given up is given up exactly as it always was.

```ts
  /**
   * A socket closed. Two very different situations, and they have to be told apart before anything
   * else happens (N26).
   *
   * An **unexpected** leave from a live match is almost always a network event — a cable, a sleep, a
   * carrier hiccup — and the player intends to keep playing. The seat is held for
   * `NET_CONFIG.reconnectSeconds` while the car brakes to a stop and stays solid and killable, and
   * `releaseSeat` does not run at all unless the window closes. That is what stops a slipped cable
   * from handing the other side the match.
   *
   * Everything else — a consented leave, a lobby leave, a leave after the match ended — releases the
   * seat immediately, exactly as it always did.
   *
   * `async` because `allowReconnection` returns a deferred. Colyseus awaits `onLeave`, so the room
   * is not disposed underneath a held seat.
   */
  async onLeave(client: Client, consented?: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    const holdSeat =
      consented !== true &&
      player !== undefined &&
      this.state.phase === RoomPhase.MATCH &&
      this.matchRoster.has(client.sessionId);

    if (holdSeat) {
      player.connected = false;
      try {
        const back = await this.allowReconnection(client, NET_CONFIG.reconnectSeconds);
        this.onResume(back);
        return;
      } catch {
        // The window closed. Fall through and give the seat up, sixty seconds late.
      }
    }
    this.releaseSeat(client.sessionId);
  }

  /**
   * A client came back inside the window (N26).
   *
   * A reconnecting client needs **exactly what a joining one needs** — the roster and one full
   * snapshot — which is the whole reason the window can be a generous sixty seconds: there is no
   * incremental state to replay, no input backlog to reconcile, and nothing on either side that
   * knows how long the gap was.
   *
   * Three things are thrown away rather than kept. The **ring**, because every slot in it is older
   * than the ring is long and its repeat source is a minute-old steering input. The **snapshot
   * baseline**, so the first snapshot after this is a full one rather than a delta against a world
   * that has moved on. And the **flood window**, so a client that was mid-burst when the socket
   * died does not resume already over the limit.
   */
  private onResume(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    this.rings.get(client.sessionId)?.reset();
    this.floods.get(client.sessionId)?.reset();
    this.broadcaster.forget(client.sessionId);
    client.send(MSG_ROSTER, this.rosterMessage());
    this.broadcaster.sendFull(client.sessionId);
  }

  /** Today's `onLeave` body, unchanged, now reached only when the seat is actually given up. */
  private releaseSeat(sessionId: string): void {
    // …lines 257-300 verbatim, with `client.sessionId` -> `sessionId`…
  }
```

Two supporting edits in the same file:

| Where | Change |
|---|---|
| the fields | `private readonly floods = new Map<string, FloodDetector>();` beside `rings` |
| `onJoin`'s tail | `this.floods.set(client.sessionId, new FloodDetector(NET_CONFIG));` beside the ring's creation |
| `releaseSeat`'s body | `this.floods.delete(sessionId);` beside `this.rings.delete(sessionId)` |
| the input message handler (N2's `decodeInputMessages` call site) | the guard below |

```ts
      // N27's throttle. The extras are IGNORED rather than errored, which is N6's rule for anything
      // the ring cannot use; a client over the limit for `floodDisconnectMs` is disconnected with a
      // reason so the player can see what happened instead of guessing.
      const flood = this.floods.get(client.sessionId);
      if (flood) {
        const nowMs = Date.now();
        if (!flood.admit(nowMs)) {
          if (flood.shouldDisconnect(nowMs)) {
            client.leave(4002, "Too many input messages");
          }
          return;
        }
      }
```

- [ ] **Step 6: `PracticeRoom` and `PlaygroundRoom` get the throttle and nothing else**

Both rooms gain the same `floods` map, the same `onJoin` creation and the same handler guard — a flood is a flood in any room — and **neither gains a reconnect window**. `PracticeRoom.onLeave`'s existing comment already says why (PR30: a closed tab disposes the room); extend it by one sentence rather than replacing it:

```ts
  /**
   * …the existing PR30 paragraph, unchanged…
   *
   * Phase 5's `allowReconnection` window is `ArenaRoom`'s alone, for the same reason: there is
   * nobody to hold the seat *for*. A practice session is one player against a bot, and a room with
   * no player in it is a room with nothing to simulate.
   */
```

and one test in each room's existing suite:

```ts
  it("never holds a seat", async () => {
    const allow = vi.spyOn(room, "allowReconnection");
    await room.onLeave(client("a"), false);
    expect(allow).not.toHaveBeenCalled();
  });
```

- [ ] **Step 7: Run the suites**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck
```

Expected: PASS, including `schema.test.ts` — `connected` is appended, so every existing field's position is unchanged and that test's numbering assertions are untouched.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/config/net-config.ts packages/shared/src/schema/PlayerState.ts packages/server/src/net packages/server/src/rooms
git commit -m "feat(server): hold a seat through allowReconnection, and throttle an input flood (N26, N27)"
```

**Probe note.** `ArenaRoom.onLeave` is now `async`, and `packages/server/playtest/` drives rooms directly. Any probe that calls `onLeave` and ignores the returned promise still behaves identically — the hold path is only reached for an in-match, non-consented leave — but **run the probes rather than assuming it**: `cd packages/server && npx tsx playtest/world.ts && npx tsx playtest/weapons.ts`. The flood detector is per-message and no probe sends messages through a socket, so nothing there should move.

---
### Task 2: The client comes back (N26)

**Files:**
- Create: `packages/client/src/net/reconnect.ts`, `packages/client/src/net/reconnect.test.ts`
- Modify: `packages/client/src/net/connection.ts`, `packages/client/src/match/transport.ts`, `packages/client/src/match/transport.test.ts`, `packages/client/src/match/clock.ts`, `packages/client/src/match/clock.test.ts`, `packages/client/src/scenes/ArenaScene.ts`

**Interfaces:**
- Consumes: `colyseus.js`'s `Client.reconnect(token)` and `Room.reconnectionToken` (verified in `node_modules/colyseus.js/lib/{Client,Room}.d.ts` at 0.15); N2's `ColyseusTransport`, `MSG_ROSTER`, `isRosterMessage`; N3's `MatchClient.seed`/`attachLobby`; N0's `ClockSync`; N4's `MatchClient` reset behaviour.
- Produces:

```ts
// client, net/reconnect.ts
export interface ReconnectPolicy {
  readonly attempts: number;
  readonly firstDelayMs: number;
  readonly maxDelayMs: number;
}
export const RECONNECT_POLICY: ReconnectPolicy;
export function reconnectDelayMs(attempt: number, policy?: ReconnectPolicy): number;
export type ReconnectState = "idle" | "retrying" | "resumed" | "gave-up";
export class Reconnector {
  constructor(reconnect: (token: string) => Promise<Room<ArenaState>>, opts?: { policy?: ReconnectPolicy; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout });
  start(token: string, onRoom: (room: Room<ArenaState>) => void): void;
  stop(): void;
  readonly state: ReconnectState;
  readonly attempt: number;
}

// client, net/connection.ts
export function reconnectArena(token: string): Promise<Room<ArenaState>>;

// client, match/transport.ts — additive
rebind(room: Room<ArenaState>): void;

// client, match/clock.ts — additive
reset(): void;
```

#### Where the 15 seconds comes from

Spec §8's acceptance for this phase is "a pulled cable resumes within 15 s". That is a budget, and every term of it is a number in this plan:

| Term | Worst case | From |
|---|---|---|
| waiting for the next retry after the link is back | `RECONNECT_POLICY.maxDelayMs` = **4000 ms** | the backoff below |
| `client.reconnect(token)` — one HTTP handshake plus one WebSocket open | ~**500 ms** at the design point's 90 ms RTT | Colyseus's join path |
| the roster message and the full snapshot | one server tick plus one trip, ~**110 ms** | `onResume` sends both immediately |
| `ClockSync.ready` — **one** pong is enough, and the ping interval is `NET_CONFIG.pingIntervalMs` | **500 ms** | `ClockSync`'s own rule: `ready` is "at least one sample" |
| `MatchClient.seed` plus the first `pumpInput` | **one tick**, 17 ms | N4's Handoff: `seed` is a complete reset |
| **total** | **≈ 5.2 s** | |

Nearly three times the headroom, and the term that dominates is the retry delay — which is why the backoff caps at four seconds rather than climbing. **The cap is the acceptance number's controlling term**; if it is ever raised, this table is what says by how much it may be.

The backoff itself: `firstDelayMs` 500, doubling, capped at `maxDelayMs` 4000 — 0.5, 1, 2, 4, 4, 4, … Sixteen attempts spans 0.5 + 1 + 2 + 4 × 13 = **55.5 s**, just inside `NET_CONFIG.reconnectSeconds`, so the client gives up at almost exactly the moment the server does rather than either side waiting alone. `reconnect.test.ts` pins that relationship rather than the two numbers separately, so moving one moves the other.

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/net/reconnect.test.ts
import { describe, expect, it, vi } from "vitest";
import { NET_CONFIG } from "@motor-combat-moba/shared";
import { RECONNECT_POLICY, Reconnector, reconnectDelayMs } from "./reconnect.js";

/** A fake timer that runs queued callbacks on demand, so no test waits in real time. */
function fakeTimers() {
  const queue: { at: number; fn: () => void; id: number }[] = [];
  let now = 0;
  let nextId = 1;
  return {
    now: () => now,
    setTimeout: ((fn: () => void, ms: number) => {
      const id = nextId++;
      queue.push({ at: now + ms, fn, id });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: ((id: unknown) => {
      const at = queue.findIndex((t) => t.id === id);
      if (at >= 0) queue.splice(at, 1);
    }) as typeof clearTimeout,
    async advance(ms: number) {
      now += ms;
      for (const timer of queue.filter((t) => t.at <= now)) {
        queue.splice(queue.indexOf(timer), 1);
        timer.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

describe("reconnectDelayMs", () => {
  it("doubles from firstDelayMs and caps at maxDelayMs", () => {
    expect(reconnectDelayMs(0)).toBe(RECONNECT_POLICY.firstDelayMs);
    expect(reconnectDelayMs(1)).toBe(RECONNECT_POLICY.firstDelayMs * 2);
    expect(reconnectDelayMs(2)).toBe(RECONNECT_POLICY.firstDelayMs * 4);
    expect(reconnectDelayMs(20)).toBe(RECONNECT_POLICY.maxDelayMs);
  });

  it("gives up at roughly the moment the server does, never long after it", () => {
    let total = 0;
    for (let i = 0; i < RECONNECT_POLICY.attempts; i++) total += reconnectDelayMs(i);
    expect(total).toBeLessThanOrEqual(NET_CONFIG.reconnectSeconds * 1000);
    // …and not so far inside it that the client quits while the seat is still being held.
    expect(total).toBeGreaterThan(NET_CONFIG.reconnectSeconds * 1000 * 0.85);
  });

  it("resumes well inside the 15 s acceptance once the link is back", () => {
    // The controlling term: after the link returns, the wait is at most one capped delay.
    expect(RECONNECT_POLICY.maxDelayMs).toBeLessThan(15_000 / 2);
  });
});

describe("Reconnector", () => {
  it("retries on the backoff and hands the room over on success", async () => {
    const timers = fakeTimers();
    const room = { name: "arena" } as never;
    const reconnect = vi.fn()
      .mockRejectedValueOnce(new Error("no"))
      .mockRejectedValueOnce(new Error("no"))
      .mockResolvedValueOnce(room);
    const got: unknown[] = [];
    const r = new Reconnector(reconnect, timers);
    r.start("tok", (x) => got.push(x));

    expect(r.state).toBe("retrying");
    await timers.advance(RECONNECT_POLICY.firstDelayMs);
    expect(reconnect).toHaveBeenCalledWith("tok");
    await timers.advance(RECONNECT_POLICY.firstDelayMs * 2);
    await timers.advance(RECONNECT_POLICY.firstDelayMs * 4);
    expect(got).toEqual([room]);
    expect(r.state).toBe("resumed");
    expect(reconnect).toHaveBeenCalledTimes(3);
  });

  it("gives up after `attempts` and stops trying", async () => {
    const timers = fakeTimers();
    const reconnect = vi.fn().mockRejectedValue(new Error("no"));
    const r = new Reconnector(reconnect, timers);
    r.start("tok", () => {});
    for (let i = 0; i < RECONNECT_POLICY.attempts + 2; i++) await timers.advance(RECONNECT_POLICY.maxDelayMs);
    expect(r.state).toBe("gave-up");
    expect(reconnect).toHaveBeenCalledTimes(RECONNECT_POLICY.attempts);
  });

  it("stops on request, so leaving the arena does not keep dialling", async () => {
    const timers = fakeTimers();
    const reconnect = vi.fn().mockRejectedValue(new Error("no"));
    const r = new Reconnector(reconnect, timers);
    r.start("tok", () => {});
    r.stop();
    await timers.advance(RECONNECT_POLICY.maxDelayMs * 4);
    expect(reconnect).not.toHaveBeenCalled();
    expect(r.state).toBe("idle");
  });

  it("never overlaps two attempts", async () => {
    const timers = fakeTimers();
    let live = 0;
    let peak = 0;
    const reconnect = vi.fn(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      live -= 1;
      throw new Error("no");
    });
    const r = new Reconnector(reconnect, timers);
    r.start("tok", () => {});
    for (let i = 0; i < 5; i++) await timers.advance(RECONNECT_POLICY.maxDelayMs);
    expect(peak).toBe(1);
  });
});
```

- [ ] **Step 2: Write `net/reconnect.ts`**

```ts
// packages/client/src/net/reconnect.ts
import type { Room } from "colyseus.js";
import type { ArenaState } from "@motor-combat-moba/shared";

/**
 * How hard, and for how long, the client dials back in after an unexpected disconnect (N26).
 *
 * Two properties this table has to hold at once, and the tests hold both rather than the numbers:
 *
 * 1. **`maxDelayMs` is the acceptance number's controlling term.** Spec §8 asks for a pulled cable
 *    to resume within 15 s, and the dominant term in that budget is how long the client waits
 *    before the attempt that finally succeeds. Four seconds leaves nearly three times the headroom.
 * 2. **The total spans `NET_CONFIG.reconnectSeconds`, and not much more.** A client that gives up
 *    early abandons a seat the server is still holding; one that keeps dialling long after the
 *    window has closed is talking to nobody.
 */
export interface ReconnectPolicy {
  readonly attempts: number;
  readonly firstDelayMs: number;
  readonly maxDelayMs: number;
}

export const RECONNECT_POLICY: ReconnectPolicy = {
  attempts: 16,
  firstDelayMs: 500,
  maxDelayMs: 4000,
};

/** Exponential from `firstDelayMs`, capped. Attempt 0 is the first wait, not an immediate try. */
export function reconnectDelayMs(attempt: number, policy: ReconnectPolicy = RECONNECT_POLICY): number {
  return Math.min(policy.maxDelayMs, policy.firstDelayMs * 2 ** Math.max(0, attempt));
}

export type ReconnectState = "idle" | "retrying" | "resumed" | "gave-up";

/**
 * The retry loop, with the timer injected so it is testable without waiting a minute.
 *
 * Deliberately **not** a `MatchClient` concern: this is about sockets, and `MatchClient` is a match
 * state machine that does not know one exists. The scene owns both and wires them together.
 *
 * One attempt at a time, always. A room that resolves after the loop was stopped is left to be
 * garbage-collected rather than handed over, which is what stops a stale room from replacing a live
 * one when a player reconnects and then immediately leaves.
 */
export class Reconnector {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private status: ReconnectState = "idle";
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly policy: ReconnectPolicy;

  constructor(
    private readonly reconnect: (token: string) => Promise<Room<ArenaState>>,
    opts?: { policy?: ReconnectPolicy; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout },
  ) {
    this.policy = opts?.policy ?? RECONNECT_POLICY;
    this.setTimer = opts?.setTimeout ?? setTimeout;
    this.clearTimer = opts?.clearTimeout ?? clearTimeout;
  }

  start(token: string, onRoom: (room: Room<ArenaState>) => void): void {
    if (this.status === "retrying") return;
    this.attempts = 0;
    this.status = "retrying";
    this.schedule(token, onRoom);
  }

  stop(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    this.status = "idle";
  }

  get state(): ReconnectState {
    return this.status;
  }

  get attempt(): number {
    return this.attempts;
  }

  private schedule(token: string, onRoom: (room: Room<ArenaState>) => void): void {
    if (this.attempts >= this.policy.attempts) {
      this.status = "gave-up";
      return;
    }
    const delay = reconnectDelayMs(this.attempts, this.policy);
    this.attempts += 1;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      void this.reconnect(token)
        .then((room) => {
          if (this.status !== "retrying") return;
          this.status = "resumed";
          onRoom(room);
        })
        .catch(() => {
          if (this.status !== "retrying") return;
          this.schedule(token, onRoom);
        });
    }, delay);
  }
}
```

`packages/client/src/net/connection.ts` gains the one function that knows the token is a Colyseus thing:

```ts
/**
 * Rejoin the seat the server is holding (N26). The token comes from `Room.reconnectionToken` on the
 * room that just closed; it is opaque and single-use, and the room the promise resolves to carries a
 * fresh one for the next time.
 *
 * Same client construction as `joinArena`, deliberately: the endpoint is re-detected, so a client
 * whose network came back on a different interface reaches the same server the same way a fresh
 * join would.
 */
export async function reconnectArena(token: string): Promise<Room<ArenaState>> {
  const client = new Client(detectServerEndpoint());
  return client.reconnect<ArenaState>(token);
}
```

- [ ] **Step 3: `ColyseusTransport.rebind` and `ClockSync.reset`**

`MatchClient` is constructed once with a transport and a clock. On a resume the **room** changes; the match client must not. Two additive methods, and the reason each exists:

```ts
// packages/client/src/match/transport.ts, on ColyseusTransport
  /**
   * Point this transport at a new room, keeping every callback already registered on it.
   *
   * `MatchClient` subscribes to snapshots, pongs and rosters once, at construction, and holds the
   * unsubscribe functions; rebuilding the transport on a reconnect would strand those. Rebinding
   * detaches the listeners from the old room, attaches the same ones to the new one, and leaves the
   * subscriber list untouched — so from `MatchClient`'s side a reconnect is indistinguishable from a
   * quiet link, which is exactly the property that lets N4's `seed` be the whole of the resume.
   */
  rebind(room: Room<ArenaState>): void {
    this.detach?.();
    this.room = room;
    this.detach = this.attachTo(room);
  }
```

with `attachTo(room)` being the constructor's existing listener registration, extracted, and `detach` the disposer it now returns. One test:

```ts
  it("keeps its subscribers across a rebind", () => {
    const first = fakeRoom();
    const transport = new ColyseusTransport(first);
    const seen: Uint8Array[] = [];
    transport.onSnapshot((bytes) => seen.push(bytes));
    const second = fakeRoom();
    transport.rebind(second);
    second.emitSnapshot(new Uint8Array([1, 2, 3]));
    expect(seen).toHaveLength(1);
    first.emitSnapshot(new Uint8Array([9]));
    expect(seen).toHaveLength(1);   // the old room is detached, not merely ignored
  });
```

```ts
// packages/client/src/match/clock.ts, on ClockSync
  /**
   * Forget every sample. The server's tick is estimated from `serverTick + msIntoTick + rtt / 2`
   * against a local `performance.now()`, and after a minute offline both terms of that comparison
   * have moved by an unknown amount — a sample from before the gap would place the server's clock
   * anywhere. `ready` goes false, and the first pong after the resume makes it true again.
   */
  reset(): void {
    this.samples.length = 0;
  }
```

- [ ] **Step 4: Wire it in `ArenaScene`**

`ArenaScene` gained `MatchClient` in phase 3 and the connection banner with it. Four additions, all in the room-binding region:

| Add | Detail |
|---|---|
| a field | `private readonly reconnector = new Reconnector(reconnectArena);` |
| a field | `private reconnectToken = "";`, refreshed every frame from `this.room.reconnectionToken` — **it changes on every reconnect, so it cannot be captured once** |
| the room's `onLeave` handler | the block below |
| `shutdown`/`destroy` | `this.reconnector.stop();` |

```ts
    // Colyseus reports a normal close as code 1000 (and a consented `room.leave()` as 4000-range).
    // Anything else is the case N26 exists for: the socket died and the player did not ask it to.
    this.room.onLeave((code) => {
      if (code === 1000 || this.leaving) return;
      this.link.setReconnecting(true);
      this.banners?.setConnectionWarning(this.link.state, this.link.message);
      this.reconnector.start(this.reconnectToken, (room) => this.resumeOn(room));
    });
```

```ts
  /**
   * The whole of the client's resume (N26): re-point the transport, re-attach the lobby state, and
   * wait for the roster and the first full snapshot the server sends unprompted.
   *
   * There is no partial path and no catch-up. `MatchClient.seed` clears the predictor, the offsets,
   * the fire prediction, the event feed, the hp ease and the reveal map (N4's Handoff), and the lead
   * controller re-derives itself from the first slack it sees — so what comes back is a client in
   * exactly the state a fresh joiner is in, which is what makes a sixty-second window affordable.
   */
  private resumeOn(room: Room<ArenaState>): void {
    this.room = room;
    this.transport.rebind(room);
    this.clock.reset();
    this.net.attachLobby(room.state);
    this.bindRoomHandlers(room);          // the same handlers the first bind installed
    this.link.setReconnecting(false);
  }
```

The roster and the snapshot need no special handling at all: `onResume` on the server sends `MSG_ROSTER` and then a full snapshot, and the transport's existing `onRoster`/`onSnapshot` subscribers — the ones `rebind` kept — are what `MatchClient.seed` already hangs off. **That is the payoff of rebinding rather than rebuilding**, and it is worth stating in the commit message.

`bindRoomHandlers(room)` is the extraction of whatever `create()` currently attaches to `this.room` (the state listeners, the lobby message handlers, the `onLeave` above). Extract it in this step and call it from both places, so a resumed room is bound identically to a joined one rather than nearly identically.

- [ ] **Step 5: Run the suites**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena`
Expected: PASS. `smoke:arena` is unchanged and still uses practice, which has no reconnect window — the reconnect path's own smoke test is Task 5's.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/net packages/client/src/match/transport.ts packages/client/src/match/transport.test.ts packages/client/src/match/clock.ts packages/client/src/match/clock.test.ts packages/client/src/scenes/ArenaScene.ts
git commit -m "feat(client): reconnect with backoff; the transport rebinds and MatchClient reseeds (N26)"
```

---

### Task 3: Silence, and what the player is told (N27)

**Files:**
- Create: `packages/client/src/match/link-health.ts`, `packages/client/src/match/link-health.test.ts`
- Modify: `packages/client/src/scenes/arena/match-banners.ts`, `packages/client/src/scenes/ArenaScene.ts`, `packages/client/src/scenes/roster-panel.ts`, `packages/client/src/match/netgraph.ts`

**Interfaces:**
- Consumes: `Snapshot.slackTicks` (N1/N2), `MatchClient.stalled` and `sinceLastSnapshotMs` (N3), `NET_CONFIG.silenceWarnMs`, `MS_PER_TICK`.
- Produces:

```ts
// client, match/link-health.ts
export type LinkState = "ok" | "silent" | "stalled" | "reconnecting" | "lost";
export class LinkHealth {
  constructor(cfg: Pick<typeof NET_CONFIG, "silenceWarnMs">);
  /** Every applied snapshot. `slackTicks < 0` means the server had to repeat or go neutral. */
  observeSnapshot(slackTicks: number, nowMs: number): void;
  /** Every frame. `stalled` is `MatchClient.stalled` — the predict-through cap was hit. */
  observeFrame(stalled: boolean, nowMs: number): void;
  setReconnecting(on: boolean): void;
  setLost(): void;
  reset(): void;
  readonly state: LinkState;
  readonly message: string;
}
```

#### Why the silence detector is on the client and needs no new message

N27 says "a client whose inputs are all late for 2 s is shown a warning". The server is the one that *knows* — it is the one repeating — but it already tells the client, every tick, in a field that has been on the wire since phase 1: **`Snapshot.slackTicks`, which is negative exactly when the server used a repeat or a neutral instead of a fresh input**. N1 put it there for the lead controller; N27 needs the same number for a different question.

So there is no new message, no new server state and no round trip in the warning. Two seconds of consecutive negative slack is the condition, and it is measured on the client's own clock. The netgraph's late/repeat rates are the quantitative version of the same fact and are already drawn (N0, N1).

The four states above the healthy one are ordered by severity, and the more severe one always wins:

| State | Condition | What the player reads |
|---|---|---|
| `silent` | every snapshot for `NET_CONFIG.silenceWarnMs` reported `slackTicks < 0` | "Your inputs are arriving late" |
| `stalled` | `MatchClient.stalled` — no snapshot for `maxPredictionTicks`, the world is frozen (N18) | "Connection interrupted" |
| `reconnecting` | the socket closed and `Reconnector` is dialling | "Reconnecting…" |
| `lost` | `Reconnector` gave up, or the server closed the seat | "Disconnected" |

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/match/link-health.test.ts
import { describe, expect, it } from "vitest";
import { NET_CONFIG } from "@motor-combat-moba/shared";
import { LinkHealth } from "./link-health.js";

describe("LinkHealth", () => {
  it("is ok on a healthy link", () => {
    const link = new LinkHealth(NET_CONFIG);
    link.observeSnapshot(2, 1000);
    link.observeFrame(false, 1000);
    expect(link.state).toBe("ok");
    expect(link.message).toBe("");
  });

  it("warns after silenceWarnMs of consecutive repeats, and not before", () => {
    const link = new LinkHealth(NET_CONFIG);
    link.observeSnapshot(-1, 0);
    link.observeFrame(false, NET_CONFIG.silenceWarnMs - 1);
    expect(link.state).toBe("ok");
    link.observeFrame(false, NET_CONFIG.silenceWarnMs);
    expect(link.state).toBe("silent");
    expect(link.message).toMatch(/late/i);
  });

  it("clears the moment one fresh input lands", () => {
    const link = new LinkHealth(NET_CONFIG);
    link.observeSnapshot(-1, 0);
    link.observeFrame(false, NET_CONFIG.silenceWarnMs);
    expect(link.state).toBe("silent");
    link.observeSnapshot(1, NET_CONFIG.silenceWarnMs + 10);
    expect(link.state).toBe("ok");
  });

  it("a stall outranks a silence, and reconnecting outranks a stall", () => {
    const link = new LinkHealth(NET_CONFIG);
    link.observeSnapshot(-1, 0);
    link.observeFrame(true, NET_CONFIG.silenceWarnMs);
    expect(link.state).toBe("stalled");
    link.setReconnecting(true);
    expect(link.state).toBe("reconnecting");
    link.setLost();
    expect(link.state).toBe("lost");
  });

  it("comes all the way back after a resume", () => {
    const link = new LinkHealth(NET_CONFIG);
    link.setReconnecting(true);
    link.setReconnecting(false);
    link.reset();
    link.observeSnapshot(2, 10_000);
    link.observeFrame(false, 10_000);
    expect(link.state).toBe("ok");
  });
});
```

- [ ] **Step 2: Write `match/link-health.ts`**

```ts
// packages/client/src/match/link-health.ts
import type { NET_CONFIG } from "@motor-combat-moba/shared";

/**
 * One banner state for the whole link (netcode spec N27 and §6.12).
 *
 * Pure and Phaser-free, like everything else under `match/`: the scene asks for a state and a
 * string and draws them, and this file owns the whole of *when* to say something. That split is
 * what makes the four conditions testable at all — three of them are timing, and none of them can
 * be reproduced in a browser on demand.
 *
 * **The silence detector needs no new message.** `Snapshot.slackTicks` is negative exactly when the
 * server used a repeated or neutral input instead of a fresh one (N1, N6), so "my inputs are all
 * arriving late" is already on the wire, every tick, in a field the lead controller was reading
 * anyway.
 */
export type LinkState = "ok" | "silent" | "stalled" | "reconnecting" | "lost";

const MESSAGES: Record<LinkState, string> = {
  ok: "",
  silent: "Your inputs are arriving late",
  stalled: "Connection interrupted",
  reconnecting: "Reconnecting…",
  lost: "Disconnected",
};

export class LinkHealth {
  /** When the current run of negative slack began, or -1 for none. */
  private silentSinceMs = -1;
  private silent = false;
  private stalled = false;
  private reconnecting = false;
  private lost = false;

  constructor(private readonly cfg: Pick<typeof NET_CONFIG, "silenceWarnMs">) {}

  observeSnapshot(slackTicks: number, nowMs: number): void {
    if (slackTicks >= 0) {
      this.silentSinceMs = -1;
      this.silent = false;
      return;
    }
    if (this.silentSinceMs < 0) this.silentSinceMs = nowMs;
    this.promote(nowMs);
  }

  observeFrame(stalled: boolean, nowMs: number): void {
    this.stalled = stalled;
    this.promote(nowMs);
  }

  setReconnecting(on: boolean): void {
    this.reconnecting = on;
    if (on) this.lost = false;
  }

  setLost(): void {
    this.lost = true;
    this.reconnecting = false;
  }

  reset(): void {
    this.silentSinceMs = -1;
    this.silent = false;
    this.stalled = false;
    this.reconnecting = false;
    this.lost = false;
  }

  /** Most severe wins, which is why this is an ordered chain rather than a set of flags. */
  get state(): LinkState {
    if (this.lost) return "lost";
    if (this.reconnecting) return "reconnecting";
    if (this.stalled) return "stalled";
    if (this.silent) return "silent";
    return "ok";
  }

  get message(): string {
    return MESSAGES[this.state];
  }

  private promote(nowMs: number): void {
    this.silent =
      this.silentSinceMs >= 0 && nowMs - this.silentSinceMs >= this.cfg.silenceWarnMs;
  }
}
```

- [ ] **Step 3: The banner carries a reason**

`packages/client/src/scenes/arena/match-banners.ts`: phase 3's `setConnectionWarning(on: boolean)` becomes `setConnectionWarning(state: LinkState, message: string)`. The `Text` object, its position and its style are unchanged; what changes is that it is hidden on `"ok"` and shows `message` otherwise. Keeping one banner rather than four is deliberate — they are mutually exclusive by construction, and a second overlapping banner is how a player ends up reading neither.

`ArenaScene`'s `update` replaces phase 3's line:

```ts
    this.link.observeFrame(net.stalled, nowMs);
    this.banners?.setConnectionWarning(this.link.state, this.link.message);
```

and `MatchClient` needs one hook for the snapshot side. Rather than reaching into the client, the scene reads what the frame already carries — but `slackTicks` is not on `RenderFrame`, so **`MatchClient` gains one accessor** (additive, `## Handoff`):

```ts
  /** The slack the newest applied snapshot reported. Negative means a repeat or a neutral (N6). */
  get lastSlackTicks(): number {
    return this.baseline?.slackTicks ?? 0;
  }
```

and the scene calls `this.link.observeSnapshot(net.lastSlackTicks, nowMs)` in the same place. It observes once per frame rather than once per snapshot, which is the same thing at `snapshotEvery: 1` and is conservative at 2 — a repeat seen twice is still a repeat.

- [ ] **Step 4: An absent player's row is dimmed**

`packages/client/src/scenes/roster-panel.ts` derives its rows from `frame.cars`. `RenderCar` has no `connected` field, and it should: it is a lobby fact, and `SnapshotView` already merges the lobby schema into the frame's players. Three one-line additions:

| File | Change |
|---|---|
| `packages/client/src/match/render-frame.ts` | `RenderCar.connected: boolean` — "`false` while the server is holding this seat through `allowReconnection` (N26). The car is still in the world and still killable; nobody is driving it." |
| `packages/client/src/match/frame-builder.ts` | `connected: player.connected` in the `cars.push` block; `FramePlayer.connected` beside it |
| `packages/client/src/match/snapshot-view.ts` | the lobby half already copies `name`, `colorId` and `team`; `connected` joins them |

and in `roster-panel.ts`'s row derivation, a disconnected player's row is drawn at the existing dim alpha the panel already uses for a dead player, with the same rule stated in one comment: **a held seat reads as "not here", not as "gone"**, because the car is still on the field and can still be killed.

- [ ] **Step 5: The netgraph line**

`NetStats` already counts `lateInputs` and `repeatedInputs` (N0, N1). Add nothing; `netgraph-overlay.ts` gains `link ${view.linkState}` on the line that already carries `lead` and `slack`, fed from `LinkHealth.state` through the same `attachStats` path the scene uses. One field on `NetStatsView`: `linkState: string`.

- [ ] **Step 6: Run the suites and commit**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck`

```bash
git add packages/client/src/match packages/client/src/scenes
git commit -m "feat(client): one link-health banner for silence, stalls, reconnects and loss (N27)"
```

---
### Task 4: Late join, the decode-error path, and §6.12 made real

**Files:**
- Modify: `packages/client/src/match/match-client.ts`, `packages/client/src/match/match-client.test.ts`, `packages/client/src/scenes/ArenaScene.ts`
- Test: `packages/server/src/rooms/arena-late-join.test.ts` (create)

**Interfaces:**
- Consumes: N2's `buildSnapshot`, `SnapshotBroadcaster.sendFull`, `decodeSnapshot`, `rosterMessage()`; N3's `MatchClient.seed`; Task 2's `Reconnector`.
- Produces:

```ts
// client, match/match-client.ts — additive
/** Called when a snapshot cannot be decoded (§6.12). The scene turns it into a reconnect. */
onFatal(cb: (reason: string) => void): void;
/** The slack the newest applied snapshot reported. Added in Task 3. */
readonly lastSlackTicks: number;
```

#### Late join is already built; this task is what proves it

Phase 2 ends `onJoin` with `assignCarIndex`, `refreshRoster` and `broadcaster.sendFull(sessionId)`, and phase 3's `MatchClient.seed(roster, first)` takes a full snapshot from any tick as a new baseline. So a client joining at tick 40,000 of a running match already receives everything it needs. What has never been exercised is a joiner arriving **while the match is running**, with cars mid-status, mid-maneuver and mid-contact — which is exactly the case N26 says a reconnect and a late joiner share ("A late joiner or a spectator uses the same path").

Two tests, one per side, and no production change if they pass — which is the honest outcome to plan for.

- [ ] **Step 1: The server-side late-join test**

```ts
// packages/server/src/rooms/arena-late-join.test.ts
import { describe, expect, it, vi } from "vitest";
import { PlayerStatus, RoomPhase, decodeSnapshot } from "@motor-combat-moba/shared";

describe("joining a running match (N26)", () => {
  it("sends the joiner a roster and a full snapshot of the match in progress", () => {
    const room = startedMatch();                       // the shared helper Task 1 uses
    for (let i = 0; i < 300; i++) room.tick();         // five seconds in
    const joiner = client("c");
    const sent: { type: unknown; payload: unknown }[] = [];
    joiner.send = vi.fn((type, payload) => sent.push({ type, payload }));

    room.onJoin(joiner, { name: "Cee" });
    room.tick();

    // The roster names every car including the new one, and the first snapshot is FULL.
    const roster = sent.find((m) => m.type === "roster")!.payload as { cars: unknown[] };
    expect(roster.cars).toHaveLength(3);
    const bytes = room.broadcasterForTest.lastBytesFor("c")!;
    const snap = decodeSnapshot(bytes, undefined, room.rosterForTest);
    expect(snap.full).toBe(true);
    expect(snap.tick).toBeGreaterThan(300);
    expect(snap.cars).toHaveLength(3);
  });

  it("puts the joiner in the lobby half, not in the match", () => {
    const room = startedMatch();
    for (let i = 0; i < 300; i++) room.tick();
    room.onJoin(client("c"), { name: "Cee" });
    expect(room.state.players.get("c")!.status).toBe(PlayerStatus.READY);
    expect(room.matchRosterForTest.has("c")).toBe(false);
    expect(room.state.phase).toBe(RoomPhase.MATCH);
  });

  it("carries a car's running statuses and maneuver into the joiner's snapshot", () => {
    const room = startedMatch();
    applyStatusForTest(room, "a", "overheated", 120);   // the helper the status tests use
    for (let i = 0; i < 10; i++) room.tick();
    room.onJoin(client("c"), { name: "Cee" });
    room.tick();
    const snap = decodeSnapshot(room.broadcasterForTest.lastBytesFor("c")!, undefined, room.rosterForTest);
    const a = snap.cars.find((car) => car.index === room.state.players.get("a")!.carIndex)!;
    expect(a.statuses.map((s) => s.statusId)).toContain("overheated");
  });
});
```

`lastBytesFor(sessionId)` is a test-only accessor on `SnapshotBroadcaster` recording the last payload it sent to each client; add it beside the ones phase 2's tests already use. `rosterForTest` exposes the room's `Roster`.

- [ ] **Step 2: The client-side late-join test**

Appended to `packages/client/src/match/match-client.test.ts`:

```ts
  it("seeds from a mid-match snapshot at an arbitrary tick", () => {
    const late = new MatchClient(ARENA, "watcher", transport, clock, stats);
    late.attachLobby(state);
    // Ticks 1000 and 40000 are equally valid baselines: nothing counts from zero.
    late.seed(ROSTER_MSG, snapshot(40_000));
    const frame = late.frame(now);
    expect(frame.tick).toBeGreaterThan(0);
    expect(frame.cars).toHaveLength(2);
    expect(late.canDrive()).toBe(false);      // not in the match roster
  });

  it("drives nothing and predicts nothing for a session with no car", () => {
    const late = new MatchClient(ARENA, "watcher", transport, clock, stats);
    late.attachLobby(state);
    late.seed(ROSTER_MSG, snapshot(40_000));
    const result = late.pumpInput(MS_PER_TICK * 4, () => FORWARD, now + MS_PER_TICK * 4);
    expect(result.ticks).toBe(0);
    expect(sent).toHaveLength(0);
    expect(late.predictedPose).toBeUndefined();
  });
```

The second is the one that matters: a spectator's key presses must not reach the wire. `canDrive()` is already the gate (phase 3), and this is what says so.

- [ ] **Step 3: The decode-error path**

Spec §6.12's ninth row: "Snapshot decode error → connection dropped, logged with the buffer → reconnect path". Phase 2 left `decodeSnapshot` throwing out of `MatchClient.onSnapshot`, which today reaches whatever the scene's error boundary is. Now that there **is** a reconnect path, that row can be honoured:

```ts
  /**
   * A snapshot the codec cannot read is unrecoverable *for this connection* and recoverable for the
   * player: the state machine has no way to continue from a half-decoded world, but a fresh socket
   * gets a fresh full snapshot and the seat is still being held.
   *
   * The buffer is logged, in hex and truncated, because a decode error is the one failure in the
   * wire format that leaves evidence — and §6.12 asks for it by name. It is a `console.error` rather
   * than a report to the server: the server is the party that produced the bytes and cannot be
   * trusted to describe them.
   */
  onSnapshot(bytes: Uint8Array, nowMs: number): void {
    let snap: Snapshot;
    try {
      snap = decodeSnapshot(bytes, this.decoded, this.roster);
    } catch (error) {
      const head = [...bytes.slice(0, 48)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
      console.error(`[net] snapshot decode failed (${bytes.length} B): ${String(error)}\n  ${head}`);
      this.fatal?.("Bad data from the server");
      return;
    }
    // …the rest of phase 3's body, unchanged…
  }

  /** The scene's hook for §6.12's unrecoverable rows. Set once, at wiring time. */
  onFatal(cb: (reason: string) => void): void {
    this.fatal = cb;
  }
```

and in `ArenaScene`'s wiring:

```ts
    this.net.onFatal(() => {
      // A non-consented leave, so the server holds the seat exactly as it does for a pulled cable
      // (N26) — the two failures are indistinguishable from the server's side and want the same
      // response. `room.onLeave` starts the reconnector.
      void this.room.leave(false);
    });
```

Two tests appended to `match-client.test.ts`:

```ts
  it("reports a decode failure instead of throwing, and stops applying that snapshot", () => {
    const reasons: string[] = [];
    client.onFatal((reason) => reasons.push(reason));
    const before = client.latestSnapshot;
    expect(() => client.onSnapshot(new Uint8Array([0xff, 0xff, 0xff]), now)).not.toThrow();
    expect(reasons).toHaveLength(1);
    expect(client.latestSnapshot).toBe(before);
  });

  it("keeps predicting after a bad snapshot, so the world does not vanish mid-frame", () => {
    client.onFatal(() => {});
    client.onSnapshot(new Uint8Array([0xff, 0xff, 0xff]), now);
    expect(pump(MS_PER_TICK).ticks).toBe(1);
    expect(client.frame(now).cars).toHaveLength(2);
  });
```

- [ ] **Step 4: §6.12, and where each row now lives**

This is documentation, and it is the deliverable that says the phase is finished. Every row of spec §6.12 has a defined response and a module that owns it:

| Situation | The response, and where it is | Since |
|---|---|---|
| Jitter spike inside the buffer | `MatchClient.drain`'s `bufferTicks` — the snapshot is applied on time | N3 |
| Jitter spike past the buffer | predict on; the late snapshot resims; `RenderOffsets` decays the difference over `correctionMs` | N3 |
| TCP stall of one RTT | the same path; the lead absorbs the input side (`LeadController`) | N1, N3 |
| Stall over 500 ms | `WorldPredictor` freezes at `maxPredictionTicks`; `LinkHealth` reads `MatchClient.stalled` and shows **"Connection interrupted"**; the snapshot that ends it re-anchors the clock and costs one correction | N3 + **N5's banner text** |
| Client alt-tabs | inputs stop; the ring repeats for `repeatMaxTicks` then goes neutral; the car brakes. **The socket is still open, so the seat is not held and `connected` stays true** — an alt-tab is not a disconnect | N1 + **N5's distinction** |
| Server hitch over a tick | `TickScheduler`'s catch-up, capped at `maxCatchUpTicks`, with a snapshot per tick | N1 |
| RTT changes by more than four ticks | `TickLoop.reanchor` past `reanchorTicks`; the lead re-derives | N1 |
| Build or tuning mismatch | the join is refused with `PROTOCOL_MISMATCH_ERROR` and a message naming the mismatch | N2 |
| Snapshot decode error | **N5**: logged with the buffer, `onFatal`, a non-consented leave, and the reconnect path | **N5** |
| Ghost shot never confirmed | the ghost expires after `lead + RTT + ghostGraceTicks` and the HUD resims; a `refused` event says why | N4 |
| **Socket dies (new row)** | **N5**: the seat is held for `reconnectSeconds`, the car brakes and stays killable, the client retries on the backoff, and a resume is a reseed | **N5** |
| **Inputs all late for 2 s (new row)** | **N5**: `LinkHealth` shows "Your inputs are arriving late"; the netgraph shows the rate | **N5** |
| **Input flood (new row)** | **N5**: extras ignored; disconnected with a reason after `floodDisconnectMs` | **N5** |

The last three are the rows §6.12 did not have because nothing could produce them. Add all thirteen to `docs/networking.md` in Task 5.

- [ ] **Step 5: Run the suites and commit**

Run: `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build`

```bash
git add packages/client/src/match packages/client/src/scenes/ArenaScene.ts packages/server/src/rooms
git commit -m "feat(net): late join from a mid-match snapshot, and a decode error routed to the reconnect path (§6.12)"
```

---

### Task 5: Measure it, and the pages

**Files:**
- Create: `scripts/smoke-reconnect.mjs`
- Modify: `package.json`, `packages/server/playtest/netcode.ts`, `packages/server/playtest/README.md`, `docs/networking.md`, `docs/schema-reference.md`, `docs/config-reference.md`, `docs/project-structure.md`, `docs/glossary.md`, `docs/deployment.md`, `packages/client/CLAUDE.md`

**Interfaces:**
- Consumes: the preparation plan's `scripts/smoke-arena.mjs` as the model; `MatchClient`, `LoopbackTransport`, `NetStats` in the harness.
- Produces: `npm run smoke:reconnect`; the harness's **N7** row.

#### What can be measured where, stated honestly

A reconnect crosses a real socket, and the harness's `LoopbackTransport` has no socket to cross. So the acceptance is measured in two places and neither is asked to prove the other's half:

| Half | Measured by | What it proves |
|---|---|---|
| the server holds the seat, the car brakes, the win check waits, the resume reseeds | `arena-reconnect.test.ts` (Task 1) | every rule of N26, deterministically, with `allowReconnection` stubbed |
| **a pulled cable resumes within 15 s**, end to end, through real Colyseus | **`npm run smoke:reconnect`** | the acceptance number itself |
| the client's behaviour through a silence and a stall, under latency and loss | `playtest/netcode.ts`'s N7 row | the banner states fire when they should, and the resume-from-snapshot path costs one correction |

- [ ] **Step 1: `scripts/smoke-reconnect.mjs`**

The arena needs two ready players to start (`lobby/start-rules.ts`: "Need at least 2 ready players"), so this drives **two** pages. That is also what makes it a real test: page B keeps playing while page A's network is cut, so the match is genuinely running when A comes back.

```js
// scripts/smoke-reconnect.mjs
// Boots the built server, opens TWO built clients in headless Chromium, starts an arena match,
// cuts one client's network at the browser level (a real socket death, not a simulated one), waits
// past the point where the predicted world has frozen, restores the network, and asserts that the
// client is driving again inside the spec's 15 s.
//
// This is the only automated check of the reconnect path end to end: `smoke:arena` uses Practice,
// which deliberately has no reconnect window (PR30). Run with `npm run smoke:reconnect`.
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 2598;
const ORIGIN = `http://127.0.0.1:${PORT}`;
/** Spec §8's phase 5 acceptance: a pulled cable resumes within this. */
const RESUME_BUDGET_MS = 15_000;
/** How long the cable stays out. Well past `maxPredictionTicks` (500 ms) and well inside the
 *  server's `reconnectSeconds` (60 s), which is the window this is checking exists. */
const OUTAGE_MS = 8_000;

function fail(message) {
  console.error(`[smoke-reconnect] ${message}`);
  process.exitCode = 1;
}

const server = spawn(process.execPath, ["packages/server/dist/index.js"], {
  env: { ...process.env, DEPLOY_MODE: "lan", PORT: String(PORT), CLIENT_ORIGIN: ORIGIN },
  stdio: ["ignore", "inherit", "inherit"],
});

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${ORIGIN}/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not answer /health within 10 s");
}

/** Join the arena from a fresh page and stop in the lobby. */
async function joinArena(browser, name) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.getByRole("textbox").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await page.waitForFunction(() => window.game?.scene.isActive("lobby") === true, null, { timeout: 30_000 });
  return { context, page };
}

const poseOf = (page) =>
  page.evaluate(() => {
    const scene = window.game.scene.getScene("arena");
    const pose = scene.net?.predictedPose;
    return pose ? { x: pose.x, y: pose.y } : null;
  });

const linkStateOf = (page) =>
  page.evaluate(() => window.game.scene.getScene("arena")?.link?.state ?? "unknown");

try {
  await waitForHealth();
  const browser = await chromium.launch({
    executablePath: process.env.SMOKE_CHROMIUM,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });

  const a = await joinArena(browser, "Alpha");
  const b = await joinArena(browser, "Bravo");

  // Alpha is the host (it joined first) and starts the match; both pick a car and roll through the
  // reveal and the countdown.
  await a.page.getByRole("button", { name: "Start" }).click();
  for (const p of [a.page, b.page]) {
    await p.waitForFunction(() => window.game?.scene.isActive("car-select") === true, null, { timeout: 30_000 });
    await p.getByRole("button", { name: "Lock in" }).click();
  }
  for (const p of [a.page, b.page]) {
    await p.waitForFunction(() => window.game?.scene.isActive("arena") === true, null, { timeout: 60_000 });
  }
  await a.page.waitForTimeout(1_500);

  const before = await poseOf(a.page);
  if (!before) throw new Error("Alpha had no predicted pose before the outage");

  // Pull the cable. Playwright's offline mode kills the WebSocket for real.
  console.log("[smoke-reconnect] cutting Alpha's network");
  await a.context.setOffline(true);
  await a.page.waitForTimeout(OUTAGE_MS);

  const duringState = await linkStateOf(a.page);
  if (duringState === "ok") fail(`Alpha's link read "ok" ${OUTAGE_MS} ms into an outage`);
  else console.log(`[smoke-reconnect] Alpha's link read "${duringState}" during the outage`);

  // Bravo must still be playing: the match does not end because someone's cable came out.
  const bravoPlaying = await b.page.evaluate(() => window.game.scene.isActive("arena"));
  if (!bravoPlaying) fail("Bravo left the arena while Alpha was offline — the match ended early");

  // Plug it back in and time the resume.
  const restoredAt = Date.now();
  await a.context.setOffline(false);
  await a.page.waitForFunction(
    () => window.game.scene.getScene("arena")?.link?.state === "ok",
    null,
    { timeout: RESUME_BUDGET_MS },
  );
  const resumeMs = Date.now() - restoredAt;
  console.log(`[smoke-reconnect] Alpha resumed in ${resumeMs} ms (budget ${RESUME_BUDGET_MS} ms)`);
  if (resumeMs > RESUME_BUDGET_MS) fail(`resume took ${resumeMs} ms, over the ${RESUME_BUDGET_MS} ms budget`);

  // And it is really driving, not merely connected.
  await a.page.keyboard.down("ArrowUp");
  await a.page.waitForTimeout(1_000);
  await a.page.keyboard.up("ArrowUp");
  const after = await poseOf(a.page);
  const moved = after ? Math.hypot(after.x - before.x, after.y - before.y) : 0;
  if (moved < 20) fail(`Alpha moved only ${moved.toFixed(1)} u after the resume`);
  else console.log(`[smoke-reconnect] Alpha moved ${moved.toFixed(1)} u after the resume`);

  await browser.close();
} catch (error) {
  fail(String(error));
} finally {
  server.kill();
}
```

`package.json` gains `"smoke:reconnect": "npm run build && node scripts/smoke-reconnect.mjs"`. The script reads `scene.link.state`, so `ArenaScene` must expose its `LinkHealth` as a public field named `link` — the same way phase 3 exposed `net` for `smoke-arena.mjs`. Do that in Task 3 rather than here.

**The two selectors this script guesses at** — the join screen's textbox and the car-select "Lock in" button — must be read off `packages/client/src/ui/screens/join.ts` and `car-select.ts` before the script is written, exactly as the preparation plan read the practice buttons. If a control has no accessible name, give it one rather than reaching for a CSS selector; a smoke script that breaks on a class rename is a smoke script nobody runs.

- [ ] **Step 2: The harness's N7 row**

`playtest/netcode.ts` gains one row and `TrialResult` three fields. The link model already supports latency, jitter and loss; N7 needs one more knob — a **blackout**, a window in which the link delivers nothing in either direction — which is two lines in the existing model rather than a new one:

```ts
interface TrialResult {
  // …existing fields…
  /** Frames the client spent with LinkHealth in each state. */
  linkStates: Record<LinkState, number>;
  /** Corrections applied on the first snapshot after a blackout ended. */
  resumeCorrectionU: number;
  /** Ticks between the blackout ending and the client applying a snapshot again. */
  resumeTicks: number;
}
```

```ts
/* N7. Phase 5: what a silence and a blackout actually do (spec §6.10, §6.12, §8 phase 5) */
{
  const r = trial({
    latencyMs: 45, jitterMs: 10, lossRate: 0.01, ticks: 1800, seed: 31,
    blackout: { fromTick: 600, ticks: 300 },   // five seconds of nothing at all
  });
  const resumeMs = r.resumeTicks * MS_PER_TICK;
  reporter.report(
    "N7. Silence and blackout: does the client say so, and does it come back cleanly?",
    r.linkStates.silent === 0 || r.resumeCorrectionU > NET_CONFIG.snapUnits ? VERDICT.FINDING : VERDICT.OK,
    `A five-second blackout at the design point (90 ms RTT +/- 20 ms, 1 % loss).\n` +
      `  frames "silent"       ${String(r.linkStates.silent).padStart(6)}   (spec N27: the warning must fire)\n` +
      `  frames "stalled"      ${String(r.linkStates.stalled).padStart(6)}   (spec N18: the world freezes past maxPredictionTicks)\n` +
      `  resume after          ${String(r.resumeTicks).padStart(6)} ticks (${resumeMs.toFixed(0)} ms)\n` +
      `  correction on resume  ${f2(r.resumeCorrectionU)} u  (line: under ${NET_CONFIG.snapUnits} u — one correction, not a snap)\n` +
      `This row measures the SNAPSHOT half of a resume, not the socket half: the loopback transport\n` +
      `has no socket to die, so \`allowReconnection\` and the retry backoff are covered by\n` +
      `arena-reconnect.test.ts and by \`npm run smoke:reconnect\` instead. What it does measure is\n` +
      `that a client which hears nothing for five seconds says so, freezes rather than drifting, and\n` +
      `costs exactly one correction when the world comes back — which is the same path a real\n` +
      `reconnect takes once the roster and the full snapshot arrive.`,
  );
}
```

The harness's client half also gains the `LinkHealth` it is now measuring: `const link = new LinkHealth(NET_CONFIG);`, `link.observeSnapshot(snap.slackTicks, nowMs)` where the trial already reads the decoded snapshot, and `link.observeFrame(net.stalled, nowMs)` in the frame loop.

- [ ] **Step 3: The README's paragraph**

`packages/server/playtest/README.md`, the `netcode.ts` paragraph's list of what the probe reports gains: "and the blackout row (N7): how long the client spends warning about late inputs, how long it spends frozen, and what a resume costs in correction". No scenario is added and no other probe's description changes.

- [ ] **Step 4: The pages**

`docs/networking.md` — a new "Connection lifecycle" section carrying Task 4 Step 4's thirteen-row table verbatim, preceded by:

```
**A dropped socket no longer ends the session.** An unexpected leave from a live match holds the
seat for `NET_CONFIG.reconnectSeconds` (60) through Colyseus's `allowReconnection`. The car stays in
the world: the input ring repeats the last input for `repeatMaxTicks` and then goes neutral, so it
brakes to a stop and sits there — solid, targetable and killable, because a stopped car is a target
and not an obstacle. The win check and host succession do **not** run while a seat is held; they are
`releaseSeat`'s, and `releaseSeat` runs only when the window actually closes.

The client retries on an exponential backoff capped at `RECONNECT_POLICY.maxDelayMs` (4 s), sixteen
attempts spanning about 55 s — just inside the server's own window, so neither side waits alone. A
successful retry re-points the transport at the new room and reseeds `MatchClient`, which is a
complete reset: predictor, render offsets, fire prediction, event feed, hp ease. **A reconnecting
client needs exactly what a joining one needs** — a roster message and one full snapshot — which is
why the window can be generous and why late join and reconnect are one path.

**The two reconnect numbers are different quantities.** 60 s is how long the server holds the seat;
**15 s** is how long the player waits between the cable going back in and driving again, and it is
dominated by one capped retry delay. `npm run smoke:reconnect` measures the second with two real
clients and a real cable pull.
```

`docs/schema-reference.md` — `PlayerState.connected`, appended to the table, noted as the last field and as lobby-half (N24).

`docs/config-reference.md`, the `NET_CONFIG` table — the four keys with their comments as notes, and one sentence under it: "`reconnectSeconds` is the server's patience and has nothing to do with the phase-5 acceptance number; that one is `RECONNECT_POLICY.maxDelayMs` on the client, and `docs/networking.md` derives it."

`docs/project-structure.md` — `net/flood-detector.ts` under server `net/`; `net/reconnect.ts` and `match/link-health.ts` under client.

`docs/glossary.md` — **Held seat**: "a player's place in a running match, kept by the server for `NET_CONFIG.reconnectSeconds` after an unexpected disconnect. The car brakes to a stop and stays solid and killable; the win check does not run until the window closes." **Link health**: "the client's one banner state — ok, silent, stalled, reconnecting, lost — derived from `Snapshot.slackTicks` and the predict-through cap, never from a message of its own."

`docs/deployment.md` — one sentence in the LAN section: "A player whose Wi-Fi drops mid-match now keeps their car and their score for a minute; they rejoin by themselves and need no host action."

`packages/client/CLAUDE.md` — one paragraph after the prediction one:

```markdown
**A dropped socket is recoverable.** `net/reconnect.ts` retries with backoff while
`match/link-health.ts` decides what the banner says; on success `ColyseusTransport.rebind` points
the existing transport at the new room and `MatchClient.seed` starts over from one full snapshot.
Nothing is carried across the gap on purpose — a resume is a fresh join that happens to keep your
seat. `scene.link` is public so `scripts/smoke-reconnect.mjs` can read it.
```

- [ ] **Step 5: Run everything, for real**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build
npm run smoke:arena && npm run smoke:reconnect
node --test scripts/turn-tuning-doc.test.mjs scripts/manual-page.test.mjs
cd packages/server && npx tsx playtest/netcode.ts && npx tsx playtest/world.ts && npx tsx playtest/weapons.ts && cd ../..
```

Expected: all green. `smoke:reconnect` prints a resume time under 15,000 ms. `netcode.md`'s **N7** row reads `OK`. `turn-tuning-doc.test.mjs` and `manual-page.test.mjs` pass untouched — no balance table moved, so neither page is owed a rebuild and `npm run build:manual` is **not** run.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-reconnect.mjs package.json packages/server/playtest/netcode.ts packages/server/playtest/README.md docs packages/client/CLAUDE.md
git commit -m "test: smoke the reconnect path end to end; harness row N7; the lifecycle documented"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Probe note — say it loudly.**

- **`playtest/netcode.ts`** — a **blackout** knob is added to the link model and a new **N7** row uses it. The existing rows' link parameters are untouched, so N1, N2, N3, N5 and N6 should report exactly what they reported before this phase; **verify by comparing the report folders rather than assuming it**, because a change to the link model is precisely the kind that moves everything quietly.
- **`playtest/world.ts`, `weapons.ts`, `weapons2.ts`, `collision.ts`, `ram.ts`** — untouched files. `ArenaRoom.onLeave` is now `async` and the input handler has a rate guard in front of it; neither is on any probe's path, and both are expected to change nothing. Run them.
- **`playtest/prediction.ts`** — untouched, and unaffected: nothing about prediction moved.
- **`playtest/lan.ts`** — still speaks the pre-phase-1 message shapes, stale since phase 1, and **not** touched here. Flag it for the user again; it is now the one probe that would actually exercise a real socket, which makes it more worth repointing than it was.

---
## Acceptance

Spec §8, phase 5 row: **Ships** — "reconnect, silence handling, late join". **Fixes** — "F12". **Acceptance** — "a pulled cable resumes within 15 s". Execution guide §5 states the gate in full: *"a pulled cable resumes within 15 s of being plugged back in (the seat itself is held for `reconnectSeconds` = 60 s — two different quantities, spec §8 phase 5 and N26); silence and flood detectors unit-tested; late join works"*.

| Requirement | Demonstrated by |
|---|---|
| **A pulled cable resumes within 15 s** | `npm run smoke:reconnect` — two real clients in headless Chromium, `context.setOffline(true)` for eight seconds, then the timed wait for `scene.link.state === "ok"`, which fails the script past 15,000 ms; and the derivation in Task 2, whose controlling term is `RECONNECT_POLICY.maxDelayMs` (4 s) against a ≈ 5.2 s worst case |
| **The seat is held for 60 s, which is a different number** | `cd packages/server && npx vitest run src/rooms/arena-reconnect.test.ts` — `allowReconnection` is called with `NET_CONFIG.reconnectSeconds`, the seat and the roster place survive, and `releaseSeat` runs only when the window rejects |
| The held car brakes to a stop and stays killable | the same suite's "brakes the held car to a stop and leaves it solid": speed under 1 u/s after a second of ticks, `alive` true, still in `matchRoster` |
| The match does not end because someone's cable came out | the same suite's "does not end the match while a seat is held"; and `smoke:reconnect`'s Bravo check, which fails if the second client leaves the arena while the first is offline |
| Silence detector unit-tested | `cd packages/client && npx vitest run src/match/link-health.test.ts` (5 tests) — fires at exactly `NET_CONFIG.silenceWarnMs` of consecutive negative slack, clears on one fresh input, and is outranked by a stall |
| Flood detector unit-tested | `cd packages/server && npx vitest run src/net/flood-detector.test.ts` (6 tests) — a correct client at one message per tick is never throttled, a `maxCatchUpTicks` burst is never throttled, extras past `TICK_RATE_HZ × floodRateMultiple` are ignored, and the disconnect needs `floodDisconnectMs` of *continuous* excess |
| Late join works | `cd packages/server && npx vitest run src/rooms/arena-late-join.test.ts` (3 tests) — a joiner five seconds into a match gets a roster naming every car and a **full** snapshot carrying running statuses; and `cd packages/client && npx vitest run src/match/match-client.test.ts`, whose two appended cases seed from tick 40,000 and prove a spectator sends nothing |
| Every §6.12 row has a defined response | the thirteen-row table in Task 4 Step 4, reproduced in `docs/networking.md`; the three rows this phase adds are the socket death, the two-second silence and the flood |
| A decode error reaches the reconnect path rather than the console | `match-client.test.ts`'s two appended cases: `onSnapshot` does not throw, the baseline is unchanged, and prediction keeps running |
| F12 — a dropped socket no longer ends the session | `smoke:reconnect` end to end, plus the two suites above |
| The client's warning costs no new message | `grep -rn "silen" packages/shared/src/net/` prints nothing — `LinkHealth` reads `Snapshot.slackTicks`, which has been on the wire since phase 1 |
| Practice and the playground never hold a seat | the one appended test in each room's suite; `grep -rn "allowReconnection" packages/server/src/rooms/` shows one call site, in `ArenaRoom.ts` |
| `connected` is appended, not inserted | `cd packages/shared && npx vitest run src/schema/schema.test.ts` passes unchanged; `git diff development/main -- packages/shared/src/schema/PlayerState.ts` shows one added field and no reordering |
| No balance table moved | `node --test scripts/turn-tuning-doc.test.mjs scripts/manual-page.test.mjs` passes with neither page edited and `npm run build:manual` never run |
| Nothing under `match/` imports Phaser, and no test does | `grep -rin "phaser" packages/client/src/match/` prints nothing |
| The client's behaviour through a blackout | `cd packages/server && npx tsx playtest/netcode.ts` — the **N7** row reads `OK`: the silent warning fires, the world freezes rather than drifting, and the resume costs one correction under `NET_CONFIG.snapUnits` |
| Everything else still green | `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena` |
| The probes, read rather than assumed | `npx tsx playtest/netcode.ts`, `world.ts` and `weapons.ts`, with the before/after report folders quoted in the merge commit |

Record the measured resume time here, with the date and the machine, when the phase is run.

## Handoff

Exports and behaviour this plan produces **beyond** the ledger, for N6 and later to consume:

- **Shared.** `NET_CONFIG` gains `reconnectSeconds` (60), `silenceWarnMs` (2000), `floodRateMultiple` (3) and `floodDisconnectMs` (10000) — all four are the ledger's, at the ledger's values. `PlayerState.connected: boolean` is **appended** to the schema; nothing was renumbered, and `stepWorld` never reads it, so invariant 8 does not claim it. `protocolHash()` does not cover `NET_CONFIG`, so no client is refused for any of this.
- **Server.** `net/flood-detector.ts`: `FloodDetector` with `admit`, `shouldDisconnect`, `reset`, `rate` and `limit`. `net/input-ring.ts`: `InputRing.reset()`. On `ArenaRoom`: `onLeave` is now `async (client, consented?)`, and the two private members the tests name — `releaseSeat(sessionId)` (today's `onLeave` body, verbatim) and `onResume(client)`. All three rooms carry a `floods` map and the throttle guard; **only `ArenaRoom` calls `allowReconnection`.** Test-only accessors added: `matchRosterForTest`, `broadcasterForTest`, `rosterForTest`, `ringForTest(sessionId)`, and `SnapshotBroadcaster.lastBytesFor(sessionId)`.
- **Client.** `net/reconnect.ts`: `RECONNECT_POLICY`, `reconnectDelayMs`, `Reconnector`, `ReconnectPolicy`, `ReconnectState`. `net/connection.ts`: `reconnectArena(token)`. `match/transport.ts`: `ColyseusTransport.rebind(room)` — the reason `MatchClient` survives a socket change untouched. `match/clock.ts`: `ClockSync.reset()`. `match/link-health.ts`: `LinkHealth`, `LinkState`. On `MatchClient`: `onFatal(cb)` and `lastSlackTicks`. On `RenderCar`/`FramePlayer`: `connected`. On `MatchBanners`: `setConnectionWarning(state, message)` replaces the boolean. On `ArenaScene`: the public `link` field (`smoke-reconnect.mjs` reads it) and the extracted `bindRoomHandlers(room)`.
- **Scripts.** `scripts/smoke-reconnect.mjs` and `npm run smoke:reconnect`. It is the only automated check of the reconnect path end to end, and it needs two accessible-named controls on the join and car-select screens; if either is renamed, this is what breaks.
- **For N6 specifically.** `MatchTransport` is now proven swappable at runtime — `rebind` changes the room under a live `MatchClient` without disturbing a subscriber — which is the property N12's WebTransport task needs and which nothing had exercised before. A transport swap is `rebind`'s problem shape with a different constructor. The harness's **blackout** knob is also new and is what an N6 task measuring `remoteSteerHoldTicks` over a lossy link would extend rather than re-invent.
- **Known, bounded, and deliberately left.** A held seat's car is stepped with neutral input, so it drifts to a stop and then sits perfectly still; it does not despawn, it can be rammed, shot and killed, and its kills and deaths keep counting. That is N26's rule, not an oversight. A player who reconnects after their car was killed comes back as a spectator with their score intact, because `releaseSeat` never ran. A client that gives up (`Reconnector` state `"gave-up"`) shows "Disconnected" and stays on the arena screen rather than routing back to the join screen — routing is the view router's and is out of this phase's scope.
- **Not done here, on purpose.** `playtest/lan.ts` still speaks the pre-phase-1 message shapes and is now the one probe that would exercise a real socket; flag it for the user. The **spectator** experience of a late joiner is unchanged beyond "the snapshot arrives and the frame draws" — camera, roster placement and the option to join the next match are the flow layer's, which this phase does not touch. Nothing about `PracticeRoom`'s or `PlaygroundRoom`'s lifecycle changed except the flood guard.

## Self-review

**Spec coverage.** N26 in full: the 60-second window (Task 1), the car's behaviour while the seat is held — brakes, stays solid and killable, no despawn (Task 1's table and its second test), the client's token, backoff and resume (Task 2), "a reconnecting client needs exactly what a joining one needs" made literal by `onResume` sending a roster and a full snapshot and by `seed` being a complete reset, and "a late joiner or a spectator uses the same path" proved by Task 4's two suites. N27 in full: the two-second silence warning (Task 3, on the client, off `slackTicks`, with no new message) and the flood throttle with its ten-second disconnect (Task 1, `FloodDetector`), both unit-tested as the gate requires. §6.12 in full: Task 4 Step 4's table names the module that owns every one of the ten original rows plus the three this phase adds, and the two rows that were not yet honoured — the decode error and the socket death — are implemented here. §7: Task 5's N7 harness row and the two smoke scripts, with the split between what each can prove stated rather than blurred. §8 phase 5 and execution guide §5: the Acceptance table, which reads both reconnect numbers separately and says which command measures which. §9: N26 and N27 each have a task.

**The two numbers.** The guide warns that 15 s and 60 s are different quantities and easy to confuse. They are separated in the header, in `NET_CONFIG.reconnectSeconds`' own comment, in `RECONNECT_POLICY`'s comment, in Task 2's derivation table, in the Acceptance table's first two rows, and in `docs/config-reference.md`'s sentence under the `NET_CONFIG` table. The one place they meet is `reconnect.test.ts`'s "gives up at roughly the moment the server does", which pins the *relationship* rather than either number, so moving one moves the other.

**Placeholder scan.** Every new module — `net/flood-detector.ts`, `net/reconnect.ts`, `match/link-health.ts`, `scripts/smoke-reconnect.mjs` — is printed in full. Every edit to an existing file is a named substitution table or a printed block with the statement it follows named. `releaseSeat`'s body is the one thing not reprinted, and it is deliberately not reprinted: it is `ArenaRoom.ts:257-300` moved verbatim with one identifier substituted, and reprinting forty lines of unchanged code is the noise the preparation plan's substitution-table convention exists to avoid. Every test is real code with values computed from the config — `NET_CONFIG.silenceWarnMs`, `floodDisconnectMs`, `maxCatchUpTicks`, `reconnectSeconds`, `TICK_RATE_HZ × floodRateMultiple`, `RECONNECT_POLICY`'s three fields — and the two figures quoted in prose (≈ 5.2 s and 55.5 s) are each derived in the table above them.

**Type consistency.** `FloodDetector`'s constructor takes the same `Pick<typeof NET_CONFIG, …>` slice shape every other class in this codebase takes, so a room passes `NET_CONFIG` whole and the test passes the same object. `LinkState` is produced by `LinkHealth.state`, consumed by `MatchBanners.setConnectionWarning`, carried on `NetStatsView.linkState`, and counted by the harness's `TrialResult.linkStates` — one union, four consumers. `Reconnector`'s injected `reconnect` is exactly `reconnectArena`'s signature, `(token: string) => Promise<Room<ArenaState>>`, which is what lets the test pass a `vi.fn()` with no cast. `ColyseusTransport.rebind` takes the same `Room<ArenaState>` the constructor takes, so the scene's `resumeOn` hands it what `reconnectArena` resolved without a conversion. `RenderCar.connected` is filled from `FramePlayer.connected`, which `SnapshotView` copies from the lobby schema's `PlayerState.connected` — one boolean, three hops, no derivation anywhere in the middle.
