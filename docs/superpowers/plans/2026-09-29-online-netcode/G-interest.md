# Phase G — interest management, and the docs close-out

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client receives an enemy's car state and shots only while that enemy is (nearly) in its vision; outside vision it receives scoreboard facts only.

**Architecture:** Field-level `@view()` tags on the existing `PlayerState` (NR42–NR43), an owner tag for private fields, a `@view()` weapons map, and a server `ViewManager` that sets each client's `StateView` membership every tick from shared vision functions with a margin and exit hysteresis.

**Tech Stack:** TypeScript, `@colyseus/schema` 5 `StateView`, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-online-netcode-redesign-design.md` (NR42–NR49, NR68)

## Global Constraints

- `VIEW_OWNER = 1` is the only non-default view tag.
- `NET_CONFIG.visionExitMs: 250`; `visionMarginUnits` is derived (`ceil(max over active chassis of maxSpeed × 0.25)`), never typed.
- With a mode's `fov.enabled` false, every car and instance is in every view — same code path (NR44).
- The server never skips `client.view` for any client in any room: a client with no view receives none of the tagged fields.
- Bots are unaffected (they read server state directly, NR49).

## Review Focus

- A hidden enemy's car fields and its shots are absent from a client's decoded state — pinned by G5's encode test, and must stay pinned by it.
- A spectating wreck in an FOV mode sees exactly its perspective player's view — pinned in G3.
- A teammate is always fully visible (car and slot timers), even behind a wall — pinned in G3.
- An enemy crossing the vision edge back and forth does not flicker in and out every tick — pinned by G3's hysteresis test.
- The lobby and car select still show every player's name, colour, chassis and ready state — pinned by the existing lobby tests running on the tagged schema.

---

### Task 1 (G1): Vision functions move to shared

**Files:**
- Move: `packages/client/src/camera/vision.ts` → `packages/shared/src/vision/vision.ts` (+ test); export from shared index
- Modify: every importer (`ArenaScene.ts` and the camera modules) to import from `@motor-combat-moba/shared`

- [ ] **Step 1:** `git mv` both files; fix its imports to relative shared paths; export; repoint importers.
- [ ] **Step 2:** Add `export function marginShape(shape: VisionShape, margin: number): VisionShape` — the ellipse semi-axes grow by `margin` and the cone apex moves back along −heading by `margin / sin(halfAngle)` (unchanged for `angleDeg ≥ 360`), so the margined cone contains every point within `margin` of the original. Test: for random points within `margin` of an in-vision point, `inShape(marginShape(s, m))` is true.
- [ ] **Step 3:** Tests; commit `refactor(vision): vision geometry in shared, plus a margined shape (NR46)`.

---

### Task 2 (G2): Tag the schema

**Files:**
- Modify: `packages/shared/src/schema/{PlayerState,WeaponSlotState,ArenaState}.ts`
- Create: `packages/shared/src/schema/view-tags.ts` (`export const VIEW_OWNER = 1;`)
- Modify: the three rooms (`onJoin`: `client.view = new StateView()`; add the whole state everyone may see — for this task, add every player and every instance with no filtering, and each player's own with `VIEW_OWNER`)
- Modify: `PROTOCOL_VERSION` + 1
- Test: `packages/shared/src/schema/schema.test.ts`

**Interfaces:** field tags exactly as NR42 lists; `PlayerState.inView: boolean` (`@view()`, always `true` on the server).

- [ ] **Step 1: Test** (pattern proven 2026-09-29 against schema 5.0.34):

```ts
import { Encoder, Reflection, StateView } from "@colyseus/schema";
function decodeFor(state: ArenaState, build: (v: StateView) => void) {
  const enc = new Encoder(state);
  const dec = Reflection.decode<ArenaState>(Reflection.encode(enc));
  const view = new StateView();
  build(view);
  const it = { offset: 0 };
  const shared = enc.encodeAll(it);
  const buf = new Uint8Array(64 * 1024);
  buf.set(shared.slice(0, it.offset));
  dec.decode(enc.encodeAllView(view, it.offset, { ...it }, buf));
  return dec.state;
}

it("a player outside the view shows scoreboard facts only", () => {
  const s = new ArenaState();
  const a = player("a"); const b = player("b"); b.x = 500; b.hp = 77;
  s.players.set("a", a); s.players.set("b", b);
  const seen = decodeFor(s, (v) => v.add(a, VIEW_OWNER));
  expect(seen.players.get("b")!.name).toBe("b");
  expect(seen.players.get("b")!.x).toBeUndefined();
  expect(seen.players.get("b")!.hp).toBeUndefined();
  expect(seen.players.get("b")!.inView).toBeUndefined();
  expect(seen.players.get("a")!.inView).toBe(true);
});

it("slot timers reach only the owner tag", () => {
  // a has one slot with stocks 3; view adds b (default tag) and a (VIEW_OWNER): a's stocks visible, b's undefined; both weaponIds visible.
});
```

- [ ] **Step 2: Tag and quantize** — `@view() @type("float32") x = 0;` etc. per NR42; pose (`x`, `y`, `angle`), velocity (`vx`, `vy`, `angVel`), `maneuverAngle`, `maneuverSpeed` and `turretAngle` become `float32` on the wire (NR52) — the server's in-memory values stay full-precision JS numbers, only the encoding narrows, and the client reconciles from the decoded values; slot timers and the other owner-only fields `@view(VIEW_OWNER)`; `ArenaState.weapons` `@view() @type({ map: WeaponInstanceState })`.
- [ ] **Step 3: Rooms** — full-visibility views as described, maintained on join, on car/instance creation (instances: add each new `WeaponInstanceState` to every client's view when it is created; remove happens by deletion). Everything must behave exactly as before; run the full suite and the A2 smoke.
- [ ] **Step 4: Commit** `feat(schema): view tags for car state and owner-only fields (NR42, NR43)`.

---

### Task 3 (G3): `ViewManager`

**Files:**
- Create: `packages/server/src/net/view-manager.ts` (+ test)
- Modify: the three rooms (replace G2's full-visibility bookkeeping with `viewManager.update(state, clients, tick)` at the end of every tick, before the broadcast)

**Interfaces:**
```ts
export interface Viewer { sessionId: string; view: StateView }
export class ViewManager {
  constructor(opts: { exitTicks: number; marginUnits: number });
  /** Recompute every viewer's membership for this tick and apply adds/removes to their StateViews. */
  update(state: ArenaState, viewers: readonly Viewer[], tick: number): void;
  /** For tests: the session ids of cars this viewer currently has in view. */
  carsIn(viewerId: string): ReadonlySet<string>;
  forget(viewerId: string): void;
}
```

Rules (NR44–NR47), per viewer:
1. Own player: added with `VIEW_OWNER`. Teammates (`allegianceOf(...) !== "enemy"` in team modes): added with `VIEW_OWNER`.
2. `camera().fov.enabled` false, or phase ≠ MATCH: every player and every instance added.
3. Otherwise perspective = the viewer, or its spectate target per `camera().spectate` (reuse `resolveSpectateTarget`'s rule; move it to shared with G1 if it lives in the client), with the CB26 no-target rules. Vision shapes = `visionShapeOf` of the perspective's (and, with `sharedVision`, living teammates') authoritative poses, each through `marginShape(…, marginUnits)`. An enemy car is visible when `carVisible` says so against those shapes (obstacles blocking per `fov.blockedByObstacles`); an instance when `inVision` holds for any of its `shotSamplePoints`, or its owner is the viewer or a teammate.
4. Hysteresis: an enemy car/instance that was visible stays in the view until it has been outside for `exitTicks` consecutive ticks.

- [ ] **Step 1: Tests** — FFA with FOV on: an enemy in front is in, behind a wall is out; enemy crosses the edge every other tick → stays in until `exitTicks` pass; teammate behind a wall is in (team mode); spectator sees its target's set; FOV off → everyone in. Build states with the playtest `World`-style helpers and a mode bundle whose `camera.fov.enabled` is overridden `true` via `applyOverrides`.
- [ ] **Step 2: Implement.** Instances added on creation go through the same rule the next `update` (call `update` at the end of the tick that created them, before the broadcast — already the case).
- [ ] **Step 3: Wire** in all three rooms; `forget` on leave.
- [ ] **Step 4: Commit** `feat(net): server-side vision decides what each client receives (NR44-NR47)`.

---

### Task 4 (G4): The client copes with hidden cars

**Files:**
- Modify: `packages/client/src/scenes/ArenaScene.ts` (draw only `inView === true` cars; on a car turning hidden: hide sprites, `RemoteTimeline.forget(id)` (the old `interp.reset()` was deleted in E2), `reckoner.forget`, `shotView.forget` for its instances), HUD readers of remote `hp`/statuses, the roster panels (`packages/client/src/modes/*/gutter.ts` and the last-standing/deathmatch equivalents): HP shows `?` when `inView !== true` (NR48)
- Modify: `packages/client/src/fx/events.ts` callers — derive events only for visible cars/instances (absence already gives this; add a test that a car turning hidden emits no `died`/`damaged`)
- Test: the gutter/hud tests for `?`

- [ ] **Step 1: Tests** for the roster `?` and for "hidden car draws nothing and yields no fx event".
- [ ] **Step 2: Implement.** The client-side FOV overlay and culling from the camera spec keep working unchanged on top (they now just rarely have anything to hide).
- [ ] **Step 3: Commit** `feat(client): hidden enemies read as scoreboard facts only (NR48)`.

---

### Task 5 (G5): Leak test through a real room

**Files:**
- Create: `packages/server/src/rooms/view-leak.test.ts`

- [ ] **Step 1:** Build an `ArenaRoom`-equivalent state with an FOV-enabled bundle, two viewers facing away from each other behind a wall, run `ViewManager.update`, then encode for each viewer with `encodeAllView` and a subsequent `encodeView` patch after both move (the G2 `decodeFor` helper, extended for patches). Assert: neither decoded state has the other's `x`, `hp`, `statuses`, `inView`, nor any of the other's weapon instances; each has the other's `name`, `kills`, `alive`.
- [ ] **Step 2:** netsim metric `hiddenLeaks` (count of client frames where a car outside the viewer's margined vision has a defined pose in the client's decoded state) — run the netsim with an FOV-enabled bundle and record it (must be 0) in EXECUTION.md.
- [ ] **Step 3: Commit** `test(net): hidden enemies never reach a client's decoded state`.

---

### Task 6 (G6): Docs close-out

**Files:**
- Modify: `docs/networking.md` (new "What a client may know" section), `docs/schema-reference.md` (tags per field), `docs/config-reference.md` (every new `NET_CONFIG` knob, `SNAPSHOT_RATE_HZ`, `PROTOCOL_VERSION`), `docs/deployment.md` (dedicated-server notes: `MONITOR_PASSWORD`, Node 22), `docs/superpowers/specs/2026-09-28-camera-behaviors-design.md` (one line under CB6 pointing to NR44 — the spec's record is not rewritten), `CLAUDE.md` (a short "Online netcode" paragraph pointing at the spec and this EXECUTION.md; hard invariant 8 gains "…and a field a client may not always see carries a `@view` tag")

- [ ] **Step 1:** Write the docs, including in `docs/networking.md` a "What remains unfair" section carrying NR60–NR61 and the NR41 note that rams are not compensated.
- [ ] **Step 2:** `npm test`, `npm run build`, smoke; fill EXECUTION.md's last column; all phases `Landed`.
- [ ] **Step 3: Commit** `docs(net): online netcode redesign landed`.
