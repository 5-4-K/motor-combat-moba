# Motor Arena

LAN-hosted top-down 2D multiplayer car combat (last player/team standing, max 6). npm workspaces (`@motor-arena/shared`, `@motor-arena/server`, `@motor-arena/client`), one Colyseus `arena` room (`ArenaRoom`), shared `stepSim` as the lockstep, Phaser 3 client. v1 is complete: lobby, car select, countdown, arcade driving with prediction, projectiles, ram damage, elimination, spectate, last standing.

## Hard invariants

1. `TICK_RATE_HZ` lives once in `@motor-arena/shared`.
2. No magic numbers in logic — balance from shared/config (tables land in P1).
3. Clients send inputs (and later lobby intents), never authoritative sim state.
4. `stepSim` is the lockstep; server and client import the same function.
5. Sim rate ≠ patch rate (`TICK_RATE_HZ` 30 vs `DEFAULT_PATCH_RATE_HZ` 20).
6. `{x, y, angle}` is canonical world state.
7. Enum uint8 values are explicit and stable; never renumber.
8. If `stepSim` reads it, it is a networked schema field.
9. Shared is consumed as built `dist`.
10. Max 6 players.

## Read the right doc

| Topic | Doc |
|---|---|
| Walking skeleton | [`docs/architecture.md`](docs/architecture.md) |
| Source tree | [`docs/project-structure.md`](docs/project-structure.md) |
| Input / prediction seams | [`docs/networking.md`](docs/networking.md) |
| Schema fields | [`docs/schema-reference.md`](docs/schema-reference.md) |
| Env knobs / balance tables | [`docs/config-reference.md`](docs/config-reference.md) |
| LAN zip / `start.bat` | [`docs/deployment.md`](docs/deployment.md) |
| Language / import rules | [`docs/conventions.md`](docs/conventions.md) |
| Plan sequence | [`docs/roadmap.md`](docs/roadmap.md) |
| Weapon, ram, elimination rules | [`docs/combat-model.md`](docs/combat-model.md) |
| Terms | [`docs/glossary.md`](docs/glossary.md) |
| Package local rules | `packages/shared/CLAUDE.md`, `packages/server/CLAUDE.md`, `packages/client/CLAUDE.md` |
| Spec + tracker | [`docs/superpowers/specs/2026-08-24-motor-arena-v1-design.md`](docs/superpowers/specs/2026-08-24-motor-arena-v1-design.md), [`docs/superpowers/plans/2026-08-24-motor-arena-v1-master-index.md`](docs/superpowers/plans/2026-08-24-motor-arena-v1-master-index.md) |

## Stop and ask before

Changing the drive model, hitbox model (OBB), collision-damage rules, friendly-fire, adding cloud hosting, or adding a physics engine.

## Shared `dist` gotcha

`@motor-arena/shared` `"import"` points at `./dist/index.js`. Server and client consume **built** shared, not `src`. After editing shared, rebuild it (`npm run build -w @motor-arena/shared`, or rely on `npm run dev` which builds then watches). Stale `dist` looks like “I changed constants but nothing happened.”

**Build with root `npm run build`, never `npm run build --workspaces`.** The server's tsup step *inlines* shared's `dist` into `packages/server/dist/index.js`, so shared must be built first. The root script enforces that order (shared → server → client); the `--workspaces` form does not, and has been observed building the server one second *before* shared — producing a server bundle silently running the previous version of the sim while every unit test passes, because tests import `src`. If a rule works in the tests but not in a live room, check this first: `grep` the server bundle for the code you just wrote.

## Commands

```bash
npm run dev            # shared watch + server :2567 + Vite client :5173
npm run build:release  # dist-release/motor-arena/ + motor-arena-release.zip
```

`npm run dev` sets `DEPLOY_MODE=lan` and `CLIENT_ORIGIN=http://localhost:5173` so Vite can talk to the server. Open `http://localhost:5173`, click Join.
