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
   `README.md`, `.env.example`. `packages/` is removed wholesale rather than merged, because Vite
   emits content-hashed filenames and copying over the top would accumulate every past build's
   assets forever.
5. **`npm install --omit=dev`** in the target.

Everything else in the folder survives — `node_modules`, your `.env`, logs, and the
`package-lock.json` npm itself writes there on the first install.

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
