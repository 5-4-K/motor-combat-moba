# Motor Combat MOBA

LAN-hosted top-down 2D multiplayer car combat (last player/team standing, max 6).

**P0 walking skeleton is in the repo.** npm workspaces, one Colyseus `arena` room, identity `stepSim`, Phaser placeholders. Two browsers can Join and see squares. Lobby, driving, and combat are later plans.

```bash
npm install
npm run dev          # Vite :5173, server :2567
```

Open `http://localhost:5173` and click Join. LAN zip: `npm run build:release` → `dist-release/motor-combat-moba/` (see [`docs/deployment.md`](docs/deployment.md)).

- Design spec: [`docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md`](docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md)
- Execution strategy + tracker: [`docs/superpowers/plans/2026-08-24-motor-combat-moba-v1-master-index.md`](docs/superpowers/plans/2026-08-24-motor-combat-moba-v1-master-index.md)
- Agent / invariant notes: [`CLAUDE.md`](CLAUDE.md)

Do not start implementing a later plan unless asked. When a plan’s Validation section passes, update the tracker in the master index.
