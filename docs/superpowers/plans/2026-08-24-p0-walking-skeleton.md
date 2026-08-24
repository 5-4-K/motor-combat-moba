# P0 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Companion: `2026-08-24-motor-combat-moba-v1-master-index.md`. Spec: `docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md`.
>
> **After Validation passes:** update the Execution Tracker in the master index (P0 → Done).

**Goal:** A fresh monorepo boots; two browsers join one Colyseus `arena` room and see placeholder squares positioned from server-authoritative state at 30Hz; a LAN zip with `start.bat` that `npm install`s if needed then starts.

**Architecture:** npm workspaces (`@motor-combat-moba/shared` / `server` / `client`). One `ArenaRoom`. Shared consumed as built `dist`. Netcode seams exist but are stubs (identity prediction, empty interpolation, pass-through latency injector). No lobby, cars, or combat.

**Tech Stack:** TypeScript ESM, Colyseus `^0.15`, `@colyseus/schema` `^2.0`, Phaser 3, colyseus.js `^0.15`, Vite 5, tsx, tsup, Vitest 2, Express, concurrently, cross-env, archiver.

**Depends on:** nothing. **Blocks:** all later plans.

---

## File structure (created in this plan)

```
motor-combat-MOBA/
├── .gitignore
├── .nvmrc                          # 20
├── .env.example
├── package.json
├── tsconfig.base.json
├── CLAUDE.md
├── README.md
├── scripts/build-release.mjs
├── docs/architecture.md
├── docs/project-structure.md
├── docs/networking.md
├── docs/deployment.md
├── docs/conventions.md
├── docs/roadmap.md
├── docs/glossary.md
├── docs/schema-reference.md        # stub: "fields land in P1"
├── docs/config-reference.md        # stub: "tables land in P1"
├── packages/shared/package.json
├── packages/shared/tsconfig.json
├── packages/shared/vitest.config.ts
├── packages/shared/CLAUDE.md
├── packages/shared/src/index.ts
├── packages/shared/src/constants.ts
├── packages/shared/src/net/input.ts
├── packages/shared/src/schema/ArenaState.ts
├── packages/shared/src/schema/PlayerState.ts
├── packages/shared/src/schema/schema.test.ts
├── packages/shared/src/sim/step.ts
├── packages/shared/src/sim/step.test.ts
├── packages/server/package.json
├── packages/server/tsconfig.json
├── packages/server/tsup.config.ts
├── packages/server/vitest.config.ts
├── packages/server/CLAUDE.md
├── packages/server/src/index.ts
├── packages/server/src/mode.ts
├── packages/server/src/health.ts
├── packages/server/src/monitor.ts
├── packages/server/src/rooms/ArenaRoom.ts
├── packages/server/src/sim/tick.ts
├── packages/server/src/net/latency-injector.ts
├── packages/server/src/net/latency-injector.test.ts
├── packages/client/package.json
├── packages/client/tsconfig.json
├── packages/client/vite.config.ts
├── packages/client/vitest.config.ts
├── packages/client/index.html
├── packages/client/CLAUDE.md
├── packages/client/src/main.ts
├── packages/client/src/config/client-mode.ts
├── packages/client/src/net/connection.ts
├── packages/client/src/net/prediction.ts
├── packages/client/src/net/interpolation.ts
├── packages/client/src/scenes/BootScene.ts
├── packages/client/src/scenes/JoinScene.ts
└── packages/client/src/scenes/ArenaScene.ts
```

Do **not** copy files from `E:\Work\motor-combat`. Re-type. Do not add racing fields (`trackDistance`, laps, pickups).

---

### Task 1: Monorepo skeleton and tooling

**Files:** root tooling + three package manifests + tsconfigs.

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
.pnp/
.pnp.js
dist/
build/
*.tsbuildinfo
packages/*/dist/
dist-release/
.env
.env.local
.env.*.local
*.log
npm-debug.log*
.vscode/*
!.vscode/extensions.json
.idea/
.DS_Store
Thumbs.db
coverage/
.vitest/
packages/client/.vite/
```

- [ ] **Step 2: Create `.nvmrc`** containing `20` and `.env.example`:

```
DEPLOY_MODE=lan
PORT=2567
TICK_RATE_HZ=
SIM_LATENCY_MS=
SIM_JITTER_MS=
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "declaration": true
  }
}
```

- [ ] **Step 4: Create root `package.json`**

```json
{
  "name": "motor-combat-moba",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "npm run build -w @motor-combat-moba/shared && npm run build -w @motor-combat-moba/server && npm run build -w @motor-combat-moba/client",
    "test": "npm run build -w @motor-combat-moba/shared && npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "dev:shared": "npm run dev -w @motor-combat-moba/shared",
    "dev:server": "cross-env DEPLOY_MODE=lan CLIENT_ORIGIN=http://localhost:5173 npm run dev -w @motor-combat-moba/server",
    "dev:client": "npm run dev -w @motor-combat-moba/client",
    "dev": "npm run build -w @motor-combat-moba/shared && concurrently -n shared,server,client -c blue.bold,green.bold,magenta.bold \"npm:dev:shared\" \"npm:dev:server\" \"npm:dev:client\"",
    "build:release": "npm run build && node scripts/build-release.mjs"
  },
  "devDependencies": {
    "archiver": "^7.0.1",
    "concurrently": "^9.0.0",
    "cross-env": "^7.0.3"
  }
}
```

Dev server uses `DEPLOY_MODE=lan` plus `CLIENT_ORIGIN` so Vite (`:5173`) can still call the server. In `packages/server/src/index.ts` (Task 5) enable CORS when `CLIENT_ORIGIN` is set, even in lan, so `npm run dev` works. Release/default (no `CLIENT_ORIGIN`) is same-origin LAN.

- [ ] **Step 5: Create package manifests**

`packages/shared/package.json`:

```json
{
  "name": "@motor-combat-moba/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch --preserveWatchOutput",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "@colyseus/schema": "^2.0.0" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "dist"]
}
```

`packages/server/package.json`:

```json
{
  "name": "@motor-combat-moba/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@motor-combat-moba/shared": "*",
    "@colyseus/core": "^0.15.0",
    "@colyseus/monitor": "^0.15.0",
    "@colyseus/schema": "^2.0.0",
    "@colyseus/ws-transport": "^0.15.0",
    "colyseus": "^0.15.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "tsup": "^8.0.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`packages/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "noEmit": true },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts"]
}
```

`packages/server/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  sourcemap: true,
  clean: true,
  noExternal: ["@motor-combat-moba/shared"],
});
```

`packages/client/package.json`:

```json
{
  "name": "@motor-combat-moba/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@motor-combat-moba/shared": "*",
    "colyseus.js": "^0.15.0",
    "phaser": "^3.80.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

`packages/client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*"]
}
```

`packages/client/vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  build: { outDir: "dist" },
});
```

Add `vitest.config.ts` in each package:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 6: `npm install` at repo root.** Expected: workspaces link, lockfile created.

- [ ] **Step 7: Commit** `chore: monorepo skeleton and tooling`

---

### Task 2: Shared constants, input type, stub schema, stub sim

**Files:** everything under `packages/shared/src/`.

- [ ] **Step 1: Write the failing schema test** `packages/shared/src/schema/schema.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ArenaState, PlayerState } from "./ArenaState.js";

describe("ArenaState", () => {
  it("constructs with tick 0 and empty players", () => {
    const s = new ArenaState();
    expect(s.tick).toBe(0);
    expect(s.hostSessionId).toBe("");
    expect(s.players.size).toBe(0);
  });

  it("stores a PlayerState in the map", () => {
    const s = new ArenaState();
    const p = new PlayerState();
    p.sessionId = "abc";
    p.x = 100;
    p.y = 80;
    s.players.set("abc", p);
    expect(s.players.get("abc")?.x).toBe(100);
  });
});
```

Export `PlayerState` from `ArenaState.ts` **or** from `PlayerState.ts` and re-export. The test import above assumes `PlayerState` is re-exported from `ArenaState.ts` — instead import from `./PlayerState.js` and `./ArenaState.js` if you split files (preferred).

Adjust the test to:

```ts
import { ArenaState } from "./ArenaState.js";
import { PlayerState } from "./PlayerState.js";
```

- [ ] **Step 2: Run the test — it must fail** (`ArenaState` missing).

```
npm run test -w @motor-combat-moba/shared
```

Expected: fail, cannot find module.

- [ ] **Step 3: Implement shared sources**

`packages/shared/src/constants.ts`:

```ts
export const TICK_RATE_HZ = 30;
export const MS_PER_TICK = 1000 / TICK_RATE_HZ;
export const MAX_PLAYERS = 6;
export const DEFAULT_PATCH_RATE_HZ = 20;
export const ROOM_NAME = "arena";

export enum RoomPhase {
  LOBBY = 0,
  CAR_SELECT = 1,
  COUNTDOWN = 2,
  MATCH = 3,
}

export enum GameMode {
  FFA = 0,
  TEAM = 1,
}

export enum PlayerStatus {
  READY = 0,
  IN_MATCH = 1,
  POST_MATCH = 2,
}

export type DeployMode = "lan" | "cloud";
```

`packages/shared/src/net/input.ts`:

```ts
export const INPUT_MESSAGE = "input";

export interface InputMessage {
  seq: number;
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  fire: boolean;
}
```

`packages/shared/src/schema/PlayerState.ts`:

```ts
import { Schema, type } from "@colyseus/schema";
import { PlayerStatus } from "../constants.js";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") angle = 0;
  @type("uint8") status: PlayerStatus = PlayerStatus.READY;
  @type("uint32") lastProcessedInputSeq = 0;
}
```

`packages/shared/src/schema/ArenaState.ts`:

```ts
import { Schema, MapSchema, type } from "@colyseus/schema";
import { RoomPhase, GameMode } from "../constants.js";
import { PlayerState } from "./PlayerState.js";

export class ArenaState extends Schema {
  @type("uint8") phase: RoomPhase = RoomPhase.LOBBY;
  @type("uint32") tick = 0;
  @type("string") hostSessionId = "";
  @type("uint8") mode: GameMode = GameMode.FFA;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
```

`packages/shared/src/sim/step.ts` (identity stub — P4 replaces the body):

```ts
import type { InputMessage } from "../net/input.js";

export interface SimBody {
  x: number;
  y: number;
  angle: number;
}

export function stepSim(body: SimBody, _input: InputMessage, _dt: number): SimBody {
  return { x: body.x, y: body.y, angle: body.angle };
}
```

`packages/shared/src/sim/step.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stepSim } from "./step.js";

describe("stepSim (P0 stub)", () => {
  it("returns the same pose", () => {
    const out = stepSim({ x: 1, y: 2, angle: 0.5 }, { seq: 1, steer: 0, throttle: 0, fire: false }, 1 / 30);
    expect(out).toEqual({ x: 1, y: 2, angle: 0.5 });
  });
});
```

`packages/shared/src/index.ts` — export constants, input, schemas, `stepSim`.

- [ ] **Step 4: Run tests.**

```
npm run build -w @motor-combat-moba/shared
npm run test -w @motor-combat-moba/shared
```

Expected: pass.

- [ ] **Step 5: Commit** `feat: shared constants, stub schema, identity stepSim`

---

### Task 3: Server — LAN listen, ArenaRoom, 30Hz tick

**Files:** `packages/server/src/**`.

- [ ] **Step 1: `mode.ts`**

```ts
import type { DeployMode } from "@motor-combat-moba/shared";

export function getDeployMode(): DeployMode {
  return process.env.DEPLOY_MODE === "cloud" ? "cloud" : "lan";
}

export function getPort(): number {
  const n = Number(process.env.PORT);
  return Number.isFinite(n) && n > 0 ? n : 2567;
}

export function getTickRateHz(fallback: number): number {
  const n = Number(process.env.TICK_RATE_HZ);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
```

- [ ] **Step 2: `health.ts`** — `app.get("/health", (_req, res) => res.json({ ok: true }))`.

- [ ] **Step 3: `monitor.ts`** — mount `@colyseus/monitor` at `/colyseus`.

- [ ] **Step 4: `net/latency-injector.ts`**

```ts
export interface LatencyConfig { latencyMs: number; jitterMs: number }

export function withSimulatedLatency<T>(
  deliver: (msg: T) => void,
  cfg: LatencyConfig,
): (msg: T) => void {
  if (cfg.latencyMs <= 0 && cfg.jitterMs <= 0) return deliver;
  return (msg: T) => {
    const jitter = cfg.jitterMs ? (Math.random() * 2 - 1) * cfg.jitterMs : 0;
    const delay = Math.max(0, cfg.latencyMs + jitter);
    setTimeout(() => deliver(msg), delay);
  };
}
```

Test: `latencyMs: 0` returns the same function reference; `latencyMs: 20` delays delivery (use fake timers).

- [ ] **Step 5: `sim/tick.ts`**

```ts
import { ArenaState, INPUT_MESSAGE, stepSim, MS_PER_TICK, type InputMessage } from "@motor-combat-moba/shared";

export function serverTick(state: ArenaState, queues: Map<string, InputMessage[]>): void {
  for (const [id, player] of state.players) {
    const q = queues.get(id);
    if (!q || q.length === 0) continue;
    while (q.length) {
      const msg = q.shift()!;
      const next = stepSim({ x: player.x, y: player.y, angle: player.angle }, msg, MS_PER_TICK / 1000);
      player.x = next.x;
      player.y = next.y;
      player.angle = next.angle;
      player.lastProcessedInputSeq = msg.seq;
    }
  }
}
```

- [ ] **Step 6: `rooms/ArenaRoom.ts`**

- `maxClients = MAX_PLAYERS`
- `onCreate`: new `ArenaState`, `setPatchRate(1000 / DEFAULT_PATCH_RATE_HZ)`, `setSimulationInterval` at `TICK_RATE_HZ`
- `onMessage(INPUT_MESSAGE)` → enqueue via latency injector (env `SIM_LATENCY_MS` / `SIM_JITTER_MS`, default 0)
- `onJoin`: create `PlayerState`, `sessionId`, place at `(400 + 80 * index, 300)`, first joiner → `hostSessionId`
- `onLeave`: delete player; if host left, next host = remaining player with smallest `sessionId` for P0 (P2 replaces this with `joinedAtTick`)
- private `tick()`: `state.tick += 1`; `serverTick(...)`

- [ ] **Step 7: `index.ts`**

Match motor-combat’s listen shape: Express, health, monitor, CORS if `CLIENT_ORIGIN` is set **or** mode is `cloud`, `express.static` of `../../client/dist` when mode is `lan`, Colyseus `WebSocketTransport` on the HTTP server, `gameServer.define(ROOM_NAME, ArenaRoom)`, listen `getPort()`.

Use `.js` extensions on relative imports.

- [ ] **Step 8: Commit** `feat: Colyseus ArenaRoom and 30Hz tick`

---

### Task 4: Client — connect and render placeholders

**Files:** `packages/client/src/**`, `index.html`.

- [ ] **Step 1: `index.html`** — root `#game`, dark background, script `/src/main.ts`.

- [ ] **Step 2: `config/client-mode.ts`**

```ts
export function detectServerEndpoint(): string {
  const { protocol, hostname, port } = window.location;
  if (port === "5173") return "ws://localhost:2567";
  const ws = protocol === "https:" ? "wss" : "ws";
  return `${ws}://${hostname}${port ? `:${port}` : ""}`;
}
```

- [ ] **Step 3: `net/connection.ts`** — `joinArena()`: `new Client(detectServerEndpoint())`, `joinOrCreate(ROOM_NAME)`.

- [ ] **Step 4: Stub `prediction.ts` / `interpolation.ts`**

Prediction: `predict` returns `stepSim` of current pose; `reconcile` returns the authoritative pose (no ease). Interpolation: `push` snapshots, `sample(time)` returns the latest pose (no lerp yet). P4 replaces both. Export empty-safe classes so ArenaScene can call them.

- [ ] **Step 5: Scenes**

`BootScene`: immediately `this.scene.start("join")`.

`JoinScene` (minimal for P0): a "Join" text/button that calls `joinArena()`, stores `room` on `this.registry`, starts `arena`. No name prompt yet (P2). If join fails, show the error string.

`ArenaScene`: each frame, for every `room.state.players` entry, draw a 32×32 rectangle at `(player.x, player.y)`. Local player (`room.sessionId`) fill `0x2ecc71`, others `0xe74c3c`. Camera centered on local player (even if static). Expose `window.game` from `main.ts` for debugging.

`main.ts`: Phaser game, 1280×720, scenes Boot/Join/Arena, `pixelArt: false`.

- [ ] **Step 6: Commit** `feat: client joins arena and renders placeholder cars`

---

### Task 5: LAN release zip

**Files:** `scripts/build-release.mjs`.

Mirror motor-combat’s assembler, with these differences:

- Output folder `dist-release/motor-combat-moba/`
- Zip `dist-release/motor-combat-moba-release.zip`
- Slim `package.json` `name`: `"motor-combat-moba"`
- `start` script: `node packages/server/dist/index.js`
- Strip `@motor-combat-moba/shared` from runtime deps
- **`start.bat`:**

```bat
@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Install Node.js 20+ and try again.
    pause
    exit /b 1
  )
)
node packages\server\dist\index.js
pause
```

- **`start.sh`:**

```bash
#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install || exit 1
fi
node packages/server/dist/index.js
```

`chmod` the shell script `0o755`.

README in the release folder: Node 20+, double-click `start.bat`, open `http://localhost:2567`, share `http://<LAN-IP>:2567`.

- [ ] **Step 1: Implement `scripts/build-release.mjs`.**
- [ ] **Step 2: Run `npm run build:release`.** Expected: folder + zip exist; `start.bat` contains `npm install`.
- [ ] **Step 3: Commit** `feat: LAN release zip with start.bat npm install`

---

### Task 6: Docs

Write brief docs listed in the master index (P0 column). Root `CLAUDE.md`: one-paragraph summary, hard invariants from the spec §13, "read the right doc" table, **stop and ask** list, shared-`dist` gotcha, `npm run dev` / `npm run build:release`.

Per-package `CLAUDE.md`: responsibility + local invariants (`shared`: lockstep only; `server`: authority + rooms; `client`: render + prediction).

`docs/roadmap.md` points at the master index and says current plan is P0.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Commit** `docs: P0 reference set and CLAUDE.md`

---

## Validation (required before marking P0 Done)

Run all of these. Paste outcomes into the tracker Notes.

1. `npm run test --workspaces` exits 0.
2. `npm run build --workspaces` exits 0.
3. `npm run dev`, open `http://localhost:5173`, Join, open a second tab, Join. Two squares visible (green self, red other). Positions come from the server (they stay put; `stepSim` is identity).
4. `npm run build:release`. Unzip to a temp dir **outside** the repo. Double-click `start.bat` (or run it). First run must print `Installing dependencies...` then listen. Browser `http://localhost:2567` shows the same Join + two-tab squares.
5. `/health` returns `{ ok: true }`.

Then update `docs/superpowers/plans/2026-08-24-motor-combat-moba-v1-master-index.md` tracker: P0 Done.
