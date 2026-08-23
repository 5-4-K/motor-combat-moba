# Motor Arena v1 — Design Spec

**Date:** 2026-08-24
**Status:** Approved (brainstorming session)
**Product name:** Motor Arena
**Repo:** `E:\Work\motor-combat-MOBA`

A LAN-hosted top-down 2D multiplayer car-combat arena (last player/team standing). Same *netcode architecture* as `E:\Work\motor-combat` (Colyseus, 30Hz server-authoritative tick, shared lockstep sim, prediction / reconciliation / interpolation). State, sim, and visuals are new: world `{x, y, angle}` is canonical, not track distance.

This spec is the source of truth for v1. Implementation is split across the plans in `docs/superpowers/plans/`. Execution order and completion tracking live in `docs/superpowers/plans/2026-08-24-motor-arena-v1-master-index.md`.

---

## 1. Concept (v1)

- Closed rectangular arena with a handful of axis-aligned 2D obstacles.
- Cars are top-down shapes (not image sprites). Three cars: **Rectangle**, **Oval**, **Hexagon**. Visual shape is cosmetic; every car uses the **same-size rotating rectangle (OBB)** hitbox.
- Modes: **FFA** (all-for-himself) and **Team** (equal sides: 1v1 / 2v2 / 3v3). Max 6 players in a room.
- Damage: one shared projectile weapon + car-vs-car collision damage from **strength**. 0 HP = eliminated. Last living player (FFA) or last team with a living member (Team) wins.
- Lobby owner hosts on LAN. Others join `http://HOST_IP:PORT` with unique names.

**Explicitly out of v1:** cloud hosting, accounts, extra cars/powers/buffs/nerfs, unique-car restriction, quit-match button, match time limit, lag-compensated rewind hits, image sprites, minimap, mid-match team switch.

**Designed for growth:** cars, attributes, weapons, and later buffs/nerfs are data tables in `shared/config` plus effect hooks. Adding a car or power should not require rewriting the sim loop.

---

## 2. Tech stack (locked)

Same family as motor-combat, **fresh scaffold** (patterns ported by hand, no racing code copied in).

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces: `packages/shared`, `packages/server`, `packages/client` |
| Language | TypeScript ESM, Node >= 20 |
| Shared | constants, config tables, Colyseus schemas, input types, lockstep sim |
| Server | Colyseus `^0.15`, `@colyseus/schema` `^2.0`, `@colyseus/monitor`, Express, tsx (dev), tsup (build) |
| Client | Phaser 3, colyseus.js `^0.15`, Vite |
| Tests | Vitest per package |
| Product deploy | **LAN only** |

Package names: `@motor-arena/shared`, `@motor-arena/server`, `@motor-arena/client`.
Colyseus room name: `arena`.
Root room class: `ArenaRoom`.

**Dev vs product:** v1 *product* is LAN (one origin). `npm run dev` still uses Vite on `:5173` plus the server with CORS (motor-combat's DX path) so HMR works. Release/default is LAN: server `express.static`s `packages/client/dist`.

**Shared-package build gotcha (same as motor-combat):** server and client consume `packages/shared/dist` (built JS). `@colyseus/schema` needs `experimentalDecorators`. After any `shared/src` edit, rebuild shared or run it in watch.

---

## 3. Deploy (v1)

- `npm run build:release` builds shared → server → client, then assembles `dist-release/motor-arena/` and `dist-release/motor-arena-release.zip`.
- Release folder contains: bundled server, built client, slim `package.json` (runtime deps only; `@motor-arena/shared` inlined by tsup), `.env.example`, README, `start.bat`, `start.sh`.
- **Host experience:** unzip, double-click `start.bat` (or run `start.sh`). The script `cd`s to its own directory, runs `npm install` **if `node_modules` is missing**, then starts the server. No separate install step.
- Default `DEPLOY_MODE=lan`, default `PORT=2567`.
- Players open `http://HOST_LAN_IP:2567`.
- Endpoints: `/health`, `/colyseus` (monitor).
- Cloud/CORS product path is **not shipped**. A `DeployMode` type may exist as `"lan"` only (or `"lan" | "cloud"` with cloud unused) so a later cloud plan is not blocked.

---

## 4. Netcode (ported logic, new state)

- Server-authoritative. Clients send **inputs**, never state.
- `TICK_RATE_HZ = 30` lives once in `shared`. Server tick and client prediction both import it. Patch rate (`setPatchRate`) is an independent server-only knob.
- Sequence-numbered `InputMessage` per tick. Server drains the per-session queue each tick.
- Shared `stepSim` (movement + weapon cooldown + projectile motion) is imported by the server (authority) and the client (prediction). Same function, or they desync.
- Client: predict local car immediately; reconcile by replaying unacked inputs from the authoritative snapshot; snap vs ease by config thresholds on `{x, y, angle}`.
- Remote cars (and remote projectiles): interpolation buffer, render `interpolationDelayMs` in the past. Never applied to the local player.
- Latency injector wraps inbound input enqueue (off by default; env-overridable for LAN testing).
- **v1 hit detection is current-tick** (no rewind / lag-comp). Leave a documented seam. LAN makes this acceptable.
- Invariant: if `stepSim` reads a value, that value is a networked schema field.

Canonical play space: **`{x, y, angle, speed}`** in world units. There is no track.

---

## 5. Movement, collision, combat

### 5.1 Drive model

Arcade car, keyboard only in v1:

| Key | Action |
|---|---|
| Left / Right | Steer: rotate `angle` (turn rate from config; may scale with speed) |
| Up | Accelerate forward up to `forwardMaxSpeed` derived from the car's speed rating |
| Down | Brake first; once stopped, reverse-accelerate up to `reverseMaxSpeed = forwardMaxSpeed * reverseSpeedRatio` (default `0.5`) |
| Space | Fire the shared projectile if cooldown is ready |

Input payload (one per tick):

```ts
interface InputMessage {
  seq: number;
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1; // +1 Up, -1 Down (brake / reverse intent), 0 coast
  fire: boolean;
}
```

Coast: speed decays by a configurable drag each tick. All accel/brake/turn/drag numbers live in `shared/config`, derived from the 0–10 speed rating.

### 5.2 Hitboxes and bounce

- Car collider: **oriented rectangle**, identical `carWidth` × `carHeight` for all three cars.
- Obstacles and arena bounds: axis-aligned rectangles.
- On overlap with wall, obstacle, or another car: separate along the contact normal and apply configurable restitution (bounce). No HP from walls/obstacles.

### 5.3 Collision damage (car vs car only)

A car is **ramming** iff `dot(forward, normalize(other.pos - self.pos)) >= ramDotThreshold` (default `0.5`, ≈ 60° cone).

| Situation | Damage |
|---|---|
| Both ramming (head-on) | Both take damage |
| A ramming, B not (side / rear) | Only B takes `damageFrom(A)` |
| Neither (glancing / sideswipe) | None |

```
damageFrom(attacker) = attacker.strength * collisionDamagePerStrength
```

Default `collisionDamagePerStrength = 1`.

**Once per contact, not per overlap tick.** After a pair resolves collision damage, they cannot damage each other again until `collisionDamageCooldownTicks` (default `15` ≈ 0.5s at 30Hz).

### 5.4 Weapon (all cars, v1)

One projectile weapon, same table for every car:

| Knob | Default | Notes |
|---|---|---|
| `damage` | 8 | HP subtracted on enemy hit |
| `fireRateHz` | 2 | Cooldown = `TICK_RATE_HZ / fireRateHz` ticks |
| `projectileSpeed` | 900 | World units / second (faster than any car) |
| `lifetimeTicks` | 30 | 1 second backup range |

Behavior: fires along the car's facing. Dies on first wall, obstacle, or **enemy** car. Ignores teammates and the shooter (no friendly fire, no self-hit). Lifetime expiry also removes it.

### 5.5 HP and death

Attribute ratings are 0–10. Actual HP = `hpRating * hpPerRating` (default `hpPerRating = 10`).

HP ≤ 0 → eliminated: `alive = false`, collider gone, car stays as a dimmed wreck at the death pose (cosmetic only). Player spectates (cycle remaining living cars, or free roam). No respawn. No quit button. Mid-match disconnect = eliminated.

### 5.6 Win

No time limit. The match ends the instant:

Keep it simple and testable. After deaths/disconnects each tick, count living players (`alive === true` and still in the match roster):

- **FFA:** each living player is a side. If exactly one living player remains, that player wins (`winnerSessionId`). If zero remain, draw.
- **Team:** a side is a team with ≥ 1 living member. If exactly one team remains, that team wins (`winnerTeam`). If zero remain, draw.

Then: every player who was **In match** (including spectators / the disconnected slot if still in state — disconnected clients leave the room; they do **not** linger on results on that machine). Remaining connected participants who were In match go **Post-match** and see results. Room phase returns to **lobby**.

---

## 6. Cars, colors, config tables

### 6.1 Cars (v1)

| `carId` | Name | Visual | Speed | Strength | HP rating | Actual HP |
|---|---|---|---|---|---|---|
| `rectangle` | Rectangle | filled rectangle | 8 | 3 | 5 | 50 |
| `oval` | Oval | filled ellipse | 5 | 8 | 3 | 30 |
| `hexagon` | Hexagon | filled hexagon | 3 | 5 | 8 | 80 |

All three share the same OBB size. Duplicates allowed in a match. Adding a car later = a new row in `CAR_TABLE` + a visual factory key.

### 6.2 Colors

Six configurable hex colors, assigned on join, unique in the room (6 players consume all 6):

| `colorId` | Hex | Name |
|---|---|---|
| 0 | `#E74C3C` | Crimson |
| 1 | `#3498DB` | Azure |
| 2 | `#2ECC71` | Emerald |
| 3 | `#F1C40F` | Gold |
| 4 | `#9B59B6` | Violet |
| 5 | `#E67E22` | Orange |

Color is a session cosmetic (shape fill). It is independent of team panel.

### 6.3 Growth hooks (do not implement in v1)

- `CAR_TABLE` may later add more attributes and a `powerIds: string[]`.
- `POWER_TABLE` / `EFFECT_TABLE` (buffs, nerfs, beams) are not present in v1. The combat apply path is a single `applyDamage(state, targetId, amount, source)` chokepoint so later effects can wrap it.
- Do not hardcode car names or numbers in the sim — always look up `carId` in the table.

---

## 7. Arena

One hand-crafted arena (`arena-01`), used every match.

- World size (config): **2400 × 1600** units. Origin at centre or top-left — pick **top-left origin**, `x ∈ [0, width]`, `y ∈ [0, height]`, to keep tests obvious.
- Outer walls = the rectangle bounds (cars bounce, projectiles die).
- **6** axis-aligned obstacle rects, medium density (break sightlines, not a maze). Exact rects are authored in `packages/shared/src/arena/arena-01.ts` during the arena plan; they must leave spawn pockets clear (see §9).
- Follow camera is smooth and wide enough that nearby fights are visible. No minimap in v1.

---

## 8. Room model and lobby

### 8.1 One room, derived per-player view

One Colyseus `ArenaRoom`, `maxClients = 6`. First joiner is host. On host leave, host transfers to the **longest-present** remaining player (`joinedAtTick`, then `sessionId` as tiebreak).

Room phase is global: `lobby | car_select | countdown | match`.
Member status is **derived per player** (TypeFury pattern, v1 names):

| Status | Badge color | When |
|---|---|---|
| Ready | green `#2ECC71` | In the room, not in the current match roster, not in `postMatchIds` |
| In match | yellow `#F1C40F` | In the current match roster (includes car-select, countdown, fighting, spectating after death) |
| Post-match | red `#E74C3C` | In `postMatchIds` (reading results) |

What the client shows (`viewFor`):

- Post-match → Results scene
- In match + phase `car_select` → Car select
- In match + phase `countdown` or `match` → Match scene
- Ready → Lobby

The host can start the **next** match while others linger on results.

### 8.2 Join

- Name: trim, length 1–16, **case-insensitive unique** in the room. Invalid or taken → join rejected with an error string; client stays on the name prompt.
- Color: random among colors not currently used.
- Team: the panel with fewer members (Ready + In match + Post-match all count). If equal, random.
- Mid-match join is allowed if `members < 6`. Newcomer is **Ready** and waits.

### 8.3 Teams and mode

Two panels always (Team A = 0, Team B = 1), including FFA.

- **FFA:** panels are cosmetic seating only. Everyone is an enemy. Spawns are mixed.
- **Team:** panels are real sides. No friendly fire. Spawns: Team A left half, Team B right half.

Ready players may switch teams at will (message `switch_team`). Host may flip FFA ↔ Team (`set_mode`) only when **nobody is In match**.

Host Start (`start_match`) includes **only Ready** players:

- FFA: ≥ 2 Ready, else error.
- Team: equal Ready counts on both panels (1v1 / 2v2 / 3v3), else error.

Post-match people are not pulled in.

### 8.4 Kick

Host may kick a player who is Ready or Post-match (`kick`, target sessionId). In-match kick is rejected. Kicked client is dropped from the room.

### 8.5 Disconnect

- Lobby / Ready / Post-match: remove from roster; rebalance is not automatic (players may switch).
- In match: treat as eliminated, then remove from the room. If that leaves one living side, the match ends.
- Host disconnect: transfer host, then apply the above.

No quit-match button in v1.

---

## 9. Match flow

1. Host Start succeeds → Ready players become the match roster (status In match). Phase `car_select`. `carSelectDeadlineTick = tick + CAR_SELECT_SECONDS * TICK_RATE_HZ` (default 60s).
2. Each roster player sends `select_car` once. Lock-in is final. Picks are **hidden** until all locked or the deadline fires.
3. Deadline or last lock: any player without a car gets a **random** car. Picks revealed (carId written on each player). Phase `countdown`.
4. Spawn:
   - FFA: shuffle roster onto a list of spawn points spread around the arena (not inside obstacles).
   - Team: Team A spawn points on the left half, Team B on the right.
   Cars visible. **Inputs ignored** until GO.
5. Countdown 3-2-1-GO (default 3 seconds, configurable). Phase `match`. **No spawn protection.**
6. Fight until win/draw rule (§5.6).
7. Phase `lobby`. Match roster ∪ anyone still spectating from that match → `postMatchIds`. Standings snapshot stored on the room **and** each client that is Post-match copies standings locally (so a next match cannot wipe their results screen).
8. **Back to lobby** (`return_to_lobby`) removes that player from `postMatchIds` → Ready.

---

## 10. Schema sketch

Root `ArenaState`:

| Field | Type | Meaning |
|---|---|---|
| `phase` | uint8 | `RoomPhase` |
| `tick` | uint32 | sim tick |
| `hostSessionId` | string | current host |
| `mode` | uint8 | `GameMode.FFA` / `TEAM` |
| `arenaId` | string | `"arena-01"` |
| `carSelectDeadlineTick` | uint32 | 0 if not selecting |
| `countdownEndsTick` | uint32 | 0 if not counting down |
| `winnerTeam` | int8 | `-1` none/draw, `0` A, `1` B; FFA winner uses `winnerSessionId` |
| `winnerSessionId` | string | FFA winner, else `""` |
| `players` | MapSchema\<PlayerState\> | all connected members |
| `projectiles` | MapSchema\<ProjectileState\> | live shots |

`PlayerState` (connected members):

| Field | Meaning |
|---|---|
| `sessionId`, `name`, `colorId`, `team` | identity / seating |
| `joinedAtTick` | host-succession order |
| `status` | Ready / InMatch / PostMatch (authoritative copy of the derived status, so clients don't reimplement) |
| `carId` | `""` until revealed |
| `x`, `y`, `angle`, `speed`, `reverseHold` | movement (only meaningful In match after spawn) |
| `hp` | actual HP |
| `alive` | false when eliminated |
| `weaponCooldown` | ticks remaining |
| `lastProcessedInputSeq` | reconciliation |
| `selectLocked` | car-select lock flag (carId still hidden to others until reveal — server may keep `pendingCarId` server-only) |

Hidden picks: **do not** put the unrevealed `carId` on the synced schema. Store `pendingCarId` in a server-only `Map<sessionId, carId>`. On reveal, write `carId` onto `PlayerState`.

`ProjectileState`: `id`, `ownerSessionId`, `x`, `y`, `angle`, `speed`, `spawnTick`, `alive`.

Enums are explicit stable uint8; never renumber, only append.

---

## 11. Client scenes

All Phaser (no HTML lobby):

1. **BootScene** — load nothing heavy in v1; hand off.
2. **JoinScene** — name field, Join, error text (taken / invalid / room full).
3. **LobbyScene** — two team panels, roster (color swatch, name, status badge), Switch team (if Ready), host FFA/Team toggle + Start + Kick (Ready/Post-match only). Start errors shown in-place.
4. **CarSelectScene** — three cards with name + speed/strength/HP. Timer. Lock is final. Other picks hidden ("choosing…").
5. **MatchScene** — follow-cam on local car; obstacles; colored shapes; HP bar; projectiles. After death: spectate cycle / free roam. 3-2-1 overlay during countdown.
6. **ResultsScene** — winner / winning team / draw; roster + car; Back to lobby. Standings held locally.

---

## 12. Testing and validation

Pure logic is TDD (Vitest):

- Config table invariants (3 cars, 6 unique colors, hp = rating × multiplier, reverse ratio).
- Name validation / uniqueness.
- Lobby start-rule function (FFA ≥ 2 Ready; Team equal Ready per panel).
- Team assignment (smaller side / random when equal — random injected).
- Status / view derivation.
- Match-end living-sides rule.
- `stepSim` movement (accel, brake-then-reverse, steer, drag, wall bounce).
- Collision damage cases (head-on, side/rear, glancing, cooldown).
- Projectile spawn / travel / first-hit / FF ignore / lifetime.
- Prediction buffer reconcile (same idea as motor-combat).

Infra (room boot, two-browser, zip/`start.bat`) is a **manual done-check** per plan, not a unit test.

Never claim a plan complete without running that plan's Validation section and updating the execution tracker.

---

## 13. Hard invariants

1. `TICK_RATE_HZ` lives once in `shared`.
2. No magic numbers in logic — all balance/feel values come from `shared/config`.
3. Clients send inputs (and lobby intents), never authoritative sim state.
4. `stepSim` is the lockstep; server and client import the same function.
5. Sim rate ≠ patch rate.
6. `{x, y, angle}` is canonical world state.
7. Enum uint8 values are explicit and stable; never renumber.
8. If `stepSim` reads it, it is a networked `PlayerState` / `ProjectileState` field.
9. Shared is consumed as built `dist`.
10. Max 6 players.

**Stop and ask before:** changing the drive model, hitbox model (OBB), collision-damage rules, friendly-fire, adding cloud hosting, or adding a physics engine.

---

## 14. Plan split

v1 is implemented as six plans. Do not execute them from this spec. See:

- Strategy + tracker: `docs/superpowers/plans/2026-08-24-motor-arena-v1-master-index.md`
- P0 `2026-08-24-p0-walking-skeleton.md`
- P1 `2026-08-24-p1-data-model.md`
- P2 `2026-08-24-p2-lobby.md`
- P3 `2026-08-24-p3-match-flow.md`
- P4 `2026-08-24-p4-driving-netcode.md`
- P5 `2026-08-24-p5-combat.md`
