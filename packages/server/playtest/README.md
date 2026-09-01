# Playtest harnesses

Headless playtesting for the sim. **Not part of the test suite and not part of the release build** —
`tsup` bundles only `src/index.ts`, and `scripts/build-release.mjs` copies only the built `dist`
folders, so nothing here can reach a player.

These are probes you run by hand when you want to know what the game *does*, at scale and at exact
poses, rather than whether one function returns the right number. They print measurements and
verdicts; they do not assert.

The findings from the first run are written up in
[`docs/playtest/2026-08-29-lan-collision-weapons-playtest.md`](../../../docs/playtest/2026-08-29-lan-collision-weapons-playtest.md).

---

## Step by step: running the offline playtest

Everything here is offline — no server, no network, no browser.

### 1. Install, once per checkout

```bash
cd <repo root>
npm install
```

In a **fresh git worktree this is not optional**. Without it Node walks up to the main checkout's
`node_modules`, where `@motor-combat-moba/shared` symlinks back to the main checkout — so every probe
would silently measure master's sim instead of yours. See the root `CLAUDE.md`.

### 2. Build shared

```bash
npm run build -w @motor-combat-moba/shared
```

The probes import the server's `src`, which consumes shared's built **`dist`** — exactly as the LAN
server bundle does. **A stale `dist` means you are measuring the previous sim.** If you have just
edited anything under `packages/shared/src`, this step is mandatory, and it is the single most common
way to get a confusing playtest result.

`npm run playtest` from the repo root does this step for you. Running a probe directly does not.

### 3. Run

From the **repo root**, the whole suite:

```bash
npm run playtest
```

That builds shared, runs all six probe files into one report folder, and prints a summary. It takes
about 7 seconds.

Or from `packages/server`, one probe at a time while you are iterating:

```bash
cd packages/server

npx tsx playtest/collision.ts    # car-on-car: tunneling, crush, pile-up, resolve order, energy, ram chaining
npx tsx playtest/ram.ts          # ram trigger rate vs the sub-tick phase of the impact
npx tsx playtest/geometry.ts     # arena-02: wedging, concave corners, walls, aim-assist LOS, spawn seats
npx tsx playtest/weapons.ts      # all 9 weapons: damage, friendly fire, death, cooldowns, statuses, leaks, pierce
npx tsx playtest/weapons2.ts     # pellet spread, tunneling, crossing targets, point-blank angles, spin, wrecks
npx tsx playtest/prediction.ts   # client prediction vs server across a collision, by latency
```

### 4. Read the report

Each run writes to `packages/server/playtest/reports/<yyyy-MM-dd-NN>/`:

```
reports/2026-08-29-01/
  summary.md      <- start here: every verdict from every probe, and which probes failed to run
  collision.md
  ram.md
  geometry.md
  weapons.md
  weapons2.md
  prediction.md
```

`NN` counts up per day, from what is already on disk — so `-01`, `-02`, `-03`. **The folder is
gitignored.** A report is a record of one run on one machine, never source.

`npm run playtest` puts all six probes in **one** folder by creating it up front and passing it down
through `PLAYTEST_RUN_DIR`. A probe run on its own mints its own folder, so a day of iterating on one
probe leaves a numbered trail of them — that is intended, and they are yours to delete.

### 5. Interpret the verdicts

| Verdict | Means |
|---|---|
| `OK` | Nothing surprising. |
| `FINDING` | A real problem: unintended, and a player would notice. |
| `KNOWN-BY-DESIGN` | Intentional and documented, but worth re-reading with fresh eyes. |

`npm run playtest` exits non-zero only when a **probe crashed** — a broken harness. A `FINDING` is
not a failure; surfacing them is the entire point, and a run that reports six of them still exits 0.

---

## Step by step: running the LAN playtest

This one needs a built server actually listening on a port, and drives it with two real
`colyseus.js` clients over WebSockets. Use it to confirm a finding survives the wire — schema
encoding, the 20 Hz patch rate against the 30 Hz sim, and latency. It is slower and noisier than the
offline probes, so explore offline and confirm here.

### 1. Build everything, in order

```bash
cd <repo root>
npm run build
```

Root `npm run build` only — **never `npm run build --workspaces`.** The server's `tsup` step inlines
shared's `dist`, so shared must build first, and only the root script guarantees that order.

### 2. Start a server, in its own terminal

```bash
DEPLOY_MODE=lan PORT=2567 CAR_SELECT_SECONDS=1 REVEAL_SECONDS=1 \
  SIM_LATENCY_MS=25 SIM_JITTER_MS=8 \
  node packages/server/dist/index.js
```

- `CAR_SELECT_SECONDS` / `REVEAL_SECONDS` cut the lobby flow from ~30 seconds per run to ~2.
- `SIM_LATENCY_MS` / `SIM_JITTER_MS` model the network. Leave them off for a clean baseline; 25±8 is
  roughly LAN Wi-Fi. This is the knob that makes prediction findings visible.

Check it is up: `curl http://127.0.0.1:2567/health` should return `{"ok":true}`.

### 3. Run the bots, in a second terminal

```bash
npm run playtest:lan
```

Or from `packages/server`, `npx tsx playtest/lan.ts`. Point it elsewhere with
`PLAYTEST_ENDPOINT=ws://192.168.1.20:2567`.

### 4. Stop the server

`Ctrl-C` in its terminal.

---

## The two harnesses

**`world.ts` — offline.** `PlaytestWorld` drives the exact pipeline `ArenaRoom.tick` runs —
`statusTick` → `serverTick` → `contactTick` (ram/slam/dash) → `runCombat`, through the real bridges — with no Colyseus
room, no sockets and no wall clock. It lets a scenario be *placed*: cars at exact poses, at exact
speeds, on an exact tick. Driving a car into a corner case through the lobby and three seconds of
countdown is not a test, it is a coincidence waiting to not happen.

**`lan.ts` — over the wire.** Two real `colyseus.js` clients against the built server, through the
real lobby → car select → reveal → countdown → match flow.

**`reporter.ts`** owns the run folder and the Markdown. **`run-all.ts`** spawns each probe as its own
process — probes are top-level scripts that execute on import, so separate processes mean one can
never leave state behind that changes the next one's numbers.

---

## Editing a probe

Probes are updated when the sim changes; **new scenarios are added only when explicitly asked for.**
See the Playtest section in the root `CLAUDE.md`.

Two things to keep doing:

**Report, do not assert.** A probe that throws on the first surprise stops measuring the other twenty
scenarios. Return a verdict and the numbers behind it, and let the reader judge.

**Sweep the sub-tick phase of anything involving contact.** A single placement tests one point on the
tick grid; a car covers 10–18 units per tick, so a probe that does not sweep the approach distance
reports whatever that one phase happened to do. The ram finding is exactly this — it looks either
fine or completely broken depending on which starting gap you pick. `ram.ts`'s `startGap` sweep and
`weapons2.ts`'s distance sweeps are the pattern to copy.

The harness is typechecked by `npm run typecheck -w @motor-combat-moba/server`, which runs
`playtest/tsconfig.json` as its second step, so it cannot rot silently.
