# Motor Combat MOBA

LAN-hosted top-down 2D multiplayer car combat (last player/team standing, max 6). npm workspaces (`@motor-combat-moba/shared`, `@motor-combat-moba/server`, `@motor-combat-moba/client`), one Colyseus `arena` room (`ArenaRoom`), shared `stepSim` as the lockstep, Phaser 3 client. v1 is complete: lobby, car select, countdown, arcade driving with prediction, projectiles, ram damage, elimination, spectate, last standing.

## Hard invariants

1. `TICK_RATE_HZ` lives once in `@motor-combat-moba/shared`.
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
| Art, manifest, asset swapping | [`docs/asset-pipeline.md`](docs/asset-pipeline.md) |
| Code graph / MCP setup on a new machine | [`docs/code-review-graph.md`](docs/code-review-graph.md) |
| Terms | [`docs/glossary.md`](docs/glossary.md) |
| Package local rules | `packages/shared/CLAUDE.md`, `packages/server/CLAUDE.md`, `packages/client/CLAUDE.md` |
| Spec + tracker | [`docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md`](docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md), [`docs/superpowers/plans/2026-08-24-motor-combat-moba-v1-master-index.md`](docs/superpowers/plans/2026-08-24-motor-combat-moba-v1-master-index.md) |
| Weapon system decisions (D1–D22), aim assist and target lock (A1–A14), online-play review, future work | [`docs/superpowers/specs/2026-08-27-weapon-system-design.md`](docs/superpowers/specs/2026-08-27-weapon-system-design.md), [`docs/superpowers/specs/2026-08-27-aim-assist-target-lock-design.md`](docs/superpowers/specs/2026-08-27-aim-assist-target-lock-design.md), [`docs/superpowers/plans/2026-08-27-weapon-system.md`](docs/superpowers/plans/2026-08-27-weapon-system.md) |

## Stop and ask before

Changing the drive model, hitbox model (OBB), collision-damage rules, friendly-fire, adding cloud hosting, or adding a physics engine.

## Shared `dist` gotcha

`@motor-combat-moba/shared` `"import"` points at `./dist/index.js`. Server and client consume **built** shared, not `src`. After editing shared, rebuild it (`npm run build -w @motor-combat-moba/shared`, or rely on `npm run dev` which builds then watches). Stale `dist` looks like “I changed constants but nothing happened.”

**Build with root `npm run build`, never `npm run build --workspaces`.** The server's tsup step *inlines* shared's `dist` into `packages/server/dist/index.js`, so shared must be built first. The root script enforces that order (shared → server → client); the `--workspaces` form does not, and has been observed building the server one second *before* shared — producing a server bundle silently running the previous version of the sim while every unit test passes, because tests import `src`. If a rule works in the tests but not in a live room, check this first: `grep` the server bundle for the code you just wrote.

**In a worktree, run `npm install` before the first build.** A fresh worktree has no
`node_modules`, and Node then walks *up* to the main checkout's — where
`node_modules/@motor-combat-moba/shared` symlinks to `<main checkout>/packages/shared`. Every build
in that worktree inlines the **main checkout's** shared `dist`, not the one you just edited, so the
server bundle silently runs master's sim while all three suites pass on your `src`. Same symptom as
the stale `dist` above, but rebuilding shared never fixes it: it is the wrong checkout, not an old
build. Tell the two apart by the inlined path in `packages/server/dist/index.js` — a comment reads
`// ../shared/dist/…` when it is correct and `// ../../../../../packages/shared/dist/…` when it has
escaped the worktree. `npm install` in the worktree root repoints the links and leaves
`package-lock.json` untouched.

The arena-specific symptom: if the arena screen shows "Arena mismatch. The server is running
"arena-0N", but this build only knows: …", the server and client are running different builds of
shared. Rebuild shared and hard-refresh the browser. The release zip cannot produce this — it ships
one build of both.

## Code graph

`code-review-graph` runs as a project-scoped MCP server (`.mcp.json`) and answers blast-radius
questions — what a change to `stepSim` actually reaches — from a local Tree-sitter graph of `src`.
It is committed config, launched through `uvx`, so `uv` is the only per-machine prerequisite.

New machine or fresh worktree: use the `code-graph-install` skill, or `uvx code-review-graph@2.3.8
build` from the checkout root. **Each worktree needs its own build** — the repo root is auto-detected
from the working directory, and `.mcp.json` deliberately passes no `--repo` so a worktree resolves to
itself. The graph lives in gitignored `.code-review-graph/`; the version pin in `.mcp.json` is what
keeps every machine on the same parser.

A stale graph reports on old code without saying so. `code-review-graph status` prints the commit it
was built from — check that before trusting an impact query, the same reflex as checking `dist` above.

## Commands

```bash
npm run dev            # shared watch + server :2567 + Vite client :5173
npm run build:release  # dist-release/motor-combat-moba/ + motor-combat-moba-release.zip
```

`npm run dev` sets `DEPLOY_MODE=lan` and `CLIENT_ORIGIN=http://localhost:5173` so Vite can talk to the server. Open `http://localhost:5173`, click Join.
