# Deployment (LAN)

Requires **Node.js 20+**.

```bash
npm run build:release
```

Writes `dist-release/motor-combat-moba/` and `dist-release/motor-combat-moba-release.zip`. `start.bat` / `start.sh` `npm install` if `node_modules` is missing, then `node packages/server/dist/index.js`.

The release build prints the arena it shipped (`Arena: arena-01`), the port it configured
(`Port: 2567 (default; pass --port <n> to change)`) and, when it removed any, the
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

## The release ships a real `.env`, and `--port` sets what is in it

`build-release.mjs` generates a `.env` beside `start.bat`, where the server's `dotenv/config` reads
it — `start.bat` / `start.sh` `cd` to that folder first, so cwd is the app root. Nothing has to be
renamed after unzipping, and the file can be edited in place afterwards with no rebuild.

`.env.example` is **not** copied alongside it. Two env files disagreeing about `PORT` in one folder
is how someone edits the one dotenv never reads; the generated file carries the same documentation
as comments.

With no argument, `PORT` is `DEFAULT_RELEASE_PORT` — 2567, the same fallback `getPort()` uses in
`packages/server/src/mode.ts`. A release is therefore boring by default: no privileged port, no
platform where it fails to start out of the box. A different port is asked for per build:

```bash
npm run build:release                  # PORT=2567
npm run build:release -- --port 80     # PORT=80
npm run build:release -- --port=8080   # same thing
```

`--port` is validated (a whole number, 1–65535) and the build prints what it configured. `releasePort`
reads the value back out of the generated file so `README.md` prints URLs that work — `http://localhost`
on 80, `http://localhost:2567` otherwise — and adds a privileged-port note only below 1024.

There is no committed template the port comes from. That is deliberate: a port baked into the repo
is a decision every future release inherits silently, and the one worth having (80) is exactly the
one that breaks on two of three platforms. Asking for it per build keeps the intent in the command
that produced the artifact.

One rough edge: `build:release` runs `npm run build` before the script, so `--port abc` fails after
the compile rather than before it. The error is clear, it just costs one build. `install-build`
validates first and does not have this problem.

### Port 80

`--port 80` lets players reach the game by name alone — `http://gamepc` — with no port to memorise.
Resolution is theirs to arrange; mDNS (`http://gamepc.local`) needs nothing installed on Windows 10+,
macOS or most Linux desktops, and beats a hosts-file entry that every player must edit as admin and
that breaks on the next DHCP lease.

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
npm run install-build              # asks before touching anything
npm run install-build -- --yes     # skip the prompt (scripted runs)
npm run install-build -- --port 80 # build with PORT=80 and install that
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
5. **Seed `.env`** — copied in only if the target does not already have one. Then, if `--port` was
   given and an existing `.env` was kept, rewrite just its `PORT` line.
6. **`npm install --omit=dev`** in the target.

Everything else in the folder survives — `node_modules`, logs, and the `package-lock.json` npm
itself writes there on the first install.

`.env` is seeded, not managed, and that split is deliberate. A first install into an empty folder
must arrive configured. But a folder that already has a `.env` has a host's own edits in it, and a
routine reinstall is not the moment to discard them — so an existing one is never overwritten, and
the run says it kept it.

`--port` is the exception, and it wins: you only type it when you mean it, and a flag that silently
did nothing on every install after the first would be the worse surprise. It rewrites **only** the
`PORT` line of the kept file — every other key and comment survives — and the run says so
(`Updated PORT=80 in the existing .env (other keys kept)`). `--port` is passed straight through to
the release build too, so the zip in `dist-release/` and the installed folder agree.

To take a whole freshly generated `.env` into an existing install, delete the target's `.env` and
re-run.

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
