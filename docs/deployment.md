# Deployment (LAN)

Requires **Node.js 20+**.

```bash
npm run build:release
```

Writes `dist-release/motor-combat-moba/` and `dist-release/motor-combat-moba-release.zip`. `start.bat` / `start.sh` `npm install` if `node_modules` is missing, then `node packages/server/dist/index.js`.

The release build prints the arena it shipped (`Arena: arena-01`), the port it configured
(`Port: 80 (from .env.release)`) and, when it removed any, the
arenas whose art it pruned and how much that saved. `assertOnlyActiveArenaShipped` then re-walks the
copied client dist and fails the build if any non-active arena's directory or manifest key survived.

Pruning operates on the copy inside `dist-release/`, so `packages/client/dist` keeps every arena and
running a release twice does not compound.

- This machine: `http://localhost`
- Others on the LAN: `http://<LAN-IP>`, or `http://<hostname>` once players can resolve the name
- Health: `GET /health` → `{ ok: true }`
- Monitor: `/colyseus`

Default `DEPLOY_MODE=lan` serves the built client from Express. Do not add cloud hosting without asking.

Optional `CAR_SELECT_SECONDS` (positive number) overrides car-select length on the server; default remains `FLOW_CONFIG.carSelectSeconds` (60).

## The release ships a real `.env`, built from `.env.release`

`.env.release` (committed, repo root) is the configuration the zip runs on. `build-release.mjs`
merges it with an optional `.env.release.local` and writes the result to `.env` beside `start.bat`,
where the server's `dotenv/config` reads it — `start.bat` / `start.sh` `cd` to that folder first, so
cwd is the app root. Nothing has to be renamed after unzipping.

`.env.example` is **not** copied into the release. Two env files disagreeing about `PORT` in one
folder is how someone edits the one dotenv never reads; `.env.release` carries the same
documentation as comments, and comments survive the merge.

- **Change the shipped default for everyone**: edit `.env.release` and commit it.
- **Change it for your machine only**: create `.env.release.local` (gitignored by the existing
  `.env.*.local` rule) with just the keys you want. It is overlaid key by key — an overridden key is
  rewritten in place so it keeps its comment, and a new key is appended.
- **Change it after unzipping**: edit `.env` in the release folder and restart. No rebuild.

`releasePort` parses `PORT` back out of the generated `.env` so `README.md` prints URLs that work:
`http://localhost` on port 80, `http://localhost:2567` anywhere else. Its fallback (2567) must stay
in step with `getPort()` in `packages/server/src/mode.ts`, and `build-release.test.mjs` pins both.

### Port 80

The shipped default is `PORT=80`, so players reach the game by name alone — `http://gamepc` — with
no port to memorise. Resolution is theirs to arrange; mDNS (`http://gamepc.local`) needs nothing
installed on Windows 10+, macOS or most Linux desktops, and beats a hosts-file entry that every
player must edit as admin and that breaks on the next DHCP lease.

Binding it is the part that varies:

- **Windows**: no admin rights needed — Windows has no privileged-port restriction. Port 80 is often
  already held, though: `netstat -ano | findstr :80`, then `tasklist /fi "pid eq <pid>"`. PID 4
  (`System`) is an `http.sys` reservation, usually IIS — `net stop http /y`, or disable `W3SVC`.
- **macOS / Linux**: ports below 1024 are privileged. `sudo setcap 'cap_net_bind_service=+ep'
  $(which node)` on a dedicated LAN box, or redirect at the firewall
  (`iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 2567`) and leave the
  server on 2567. Do not run the server as root, and do not add a reverse proxy — it needs explicit
  WebSocket upgrade config and adds a failure mode mid-match.

The client needs no change for any of this: `detectServerEndpoint` derives the WebSocket URL from
`window.location` and omits the port when the page was served without one, and the Colyseus
transport rides on the same HTTP server that serves the client — there is only ever one port.
