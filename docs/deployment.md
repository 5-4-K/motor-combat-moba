# Deployment (LAN)

Requires **Node.js 20+**.

```bash
npm run build:release
```

Writes `dist-release/motor-combat-moba/` and `dist-release/motor-combat-moba-release.zip`. `start.bat` / `start.sh` `npm install` if `node_modules` is missing, then `node packages/server/dist/index.js`.

The release build prints the arena it shipped (`Arena: arena-01`) and, when it removed any, the
arenas whose art it pruned and how much that saved. `assertOnlyActiveArenaShipped` then re-walks the
copied client dist and fails the build if any non-active arena's directory or manifest key survived.

Pruning operates on the copy inside `dist-release/`, so `packages/client/dist` keeps every arena and
running a release twice does not compound.

- This machine: `http://localhost:2567`
- Others on the LAN: `http://<LAN-IP>:2567`
- Health: `GET /health` → `{ ok: true }`
- Monitor: `/colyseus`

Default `DEPLOY_MODE=lan` serves the built client from Express. Do not add cloud hosting without asking.

Optional `CAR_SELECT_SECONDS` (positive number) overrides car-select length on the server; default remains `FLOW_CONFIG.carSelectSeconds` (60).
