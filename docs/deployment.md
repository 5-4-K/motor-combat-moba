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

## Installing to a folder: `npm run install-build`

```bash
npm run install-build          # asks before touching anything
npm run install-build -- --yes # skip the prompt (scripted runs)
```

Builds a release and installs it into a folder you name once, in `.install-target` at the repo root —
one line, gitignored, machine-specific. `.install-target.example` documents the format; blank lines
and `#` comments are ignored, and exactly one path may be left uncommented (two is an error, not
"first one wins" — a half-finished edit must not install somewhere quietly).

It runs in this order, and the order is the point:

1. **Read and validate the target**, then **probe it for writability** by writing and deleting a file.
   Both happen *before* the prompt, so a bad path fails in a second rather than after a build.
2. **Confirm.** Prints the resolved absolute path, what will be replaced, and what will be kept, then
   waits for a typed `yes`. Anything else cancels with nothing changed.
3. **Build the release** — after the prompt, but before the target is touched, so a failed build
   costs a rebuild rather than a working install.
4. **Replace** only what the release produces: `packages/`, `package.json`, `start.bat`, `start.sh`,
   `README.md`. `packages/` is removed wholesale rather than merged, because Vite emits
   content-hashed filenames and copying over the top would accumulate every past build's assets
   forever.
5. **Seed `.env`** — copied in only if the target does not already have one.
6. **`npm install --omit=dev`** in the target.

Everything else in the folder survives — `node_modules`, logs, and the `package-lock.json` npm
itself writes there on the first install.

`.env` is seeded, not managed, and that split is deliberate. A first install into an empty folder
must arrive configured, or the shipped `PORT=80` silently does not apply and the server comes up on
2567. But a folder that already has a `.env` has a host's own edits in it, and an install is not the
moment to discard them — so an existing one is never overwritten, and the run says it kept it. To
take a changed `.env.release` into an existing install, delete the target's `.env` and re-run, or
edit it in place.

### Why `npm install` and not `npm ci`

`npm ci` needs a `package-lock.json`, and the release ships none (`releasePackageJson` writes only
the server's runtime dependencies), so `npm ci` would fail outright. `npm install` also reuses an
existing `node_modules` instead of deleting it, which is what makes a re-install take a second.

**Do not add `--prefer-offline`.** It looks right for a LAN box and is a trap: it resolves version
ranges against whatever packument is already cached, so a stale cache fails the *first* install with
`ETARGET` (observed: `No matching version found for qs@~6.15.1`, on a tree that installed fine
without it). It also buys nothing — the first install leaves a `package-lock.json` in the target, and
with that plus a complete `node_modules` a repeat install needs no registry at all.

### Failure cases

| Case | What happens |
|---|---|
| No `.install-target`, empty, or comments only | Error naming the file to create, with the format |
| Two uncommented paths | Error listing both; nothing is guessed |
| Path missing | Error. The folder is never created — a typo that makes a new folder is how a build lands where nobody looks |
| Path is a file, or the repo, or an ancestor of the repo, or `$HOME`, or a filesystem root | Refused. The script deletes `packages/` inside the target; pointed at the checkout it would delete the source tree |
| No write permission, or a read-only mount | Caught by the probe, before the build, naming `EACCES`/`EROFS` |
| A file is locked (`EBUSY`/`EPERM`) | `fs.rmSync` retries 5× over a second — enough for an antivirus scan. A server actually running from the folder outlives that and gets an error naming it as the likely cause. **Windows only in practice**: on Linux and macOS a running server does not block replacing its own files |
| Build fails | Target left exactly as it was; nothing was copied |
| Disk fills mid-copy (`ENOSPC`) | Error says the install is now incomplete and must be re-run |
| `npm install` fails (usually no registry) | Says the build *was* copied but deps were not, and gives the command to retry in that folder |
| stdin is not a terminal | Refuses rather than hanging or assuming yes. `--yes` is the deliberate opt-in |
