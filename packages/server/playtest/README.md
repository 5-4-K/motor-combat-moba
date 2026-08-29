# Playtest harnesses

Headless playtesting for the sim. Not part of the test suite and not built — these are probes you
run by hand when you want to know what the game *does*, at scale and at exact poses, rather than
whether one function returns the right number.

The findings from the first run are written up in
[`docs/playtest/2026-08-29-lan-collision-weapons-playtest.md`](../../../docs/playtest/2026-08-29-lan-collision-weapons-playtest.md).

## The two harnesses

**`world.ts` — offline.** `PlaytestWorld` drives the exact pipeline `ArenaRoom.tick` runs —
`statusTick` → `serverTick` → `ramTick` → `runCombat`, through the real bridges — with no Colyseus
room, no sockets and no wall clock. It lets a scenario be *placed*: cars at exact poses, at exact
speeds, on an exact tick. Driving a car into a corner case through the lobby and three seconds of
countdown is not a test, it is a coincidence waiting to not happen.

Because it imports the server's `src` (which consumes shared's built `dist`, as the LAN bundle
does), anything a probe reproduces here a real room reproduces. **Rebuild shared after editing it**
— the usual `dist` gotcha applies.

**`lan.ts` — over the wire.** Two real `colyseus.js` clients against the built server on a real
port, driven through the real lobby → car select → reveal → countdown → match flow. This is what
proves a finding survives schema encoding, the 20 Hz patch rate against the 30 Hz sim, and simulated
latency. Slower and noisier than the offline probes; use it to confirm, not to explore.

## Running

```bash
npm install && npm run build     # from the repo root; shared must build before server
cd packages/server

npx tsx playtest/collision.ts    # car-on-car: tunneling, crush, pile-up, resolve order, energy
npx tsx playtest/ram.ts          # ram trigger rate as a function of sub-tick impact phase
npx tsx playtest/weapons.ts      # all 9 weapons: damage, friendly fire, death, cooldowns, statuses
npx tsx playtest/weapons2.ts     # pellet spread, tunneling, crossing targets, point-blank angles
npx tsx playtest/geometry.ts     # arena-02: wedging, concave corners, walls, locks, spawn seats
npx tsx playtest/prediction.ts   # client prediction vs server across a collision, by latency
```

For `lan.ts`, start a server first:

```bash
DEPLOY_MODE=lan PORT=2567 CAR_SELECT_SECONDS=1 REVEAL_SECONDS=1 \
  SIM_LATENCY_MS=25 SIM_JITTER_MS=8 node packages/server/dist/index.js

npx tsx playtest/lan.ts          # PLAYTEST_ENDPOINT overrides ws://127.0.0.1:2567
```

`CAR_SELECT_SECONDS` and `REVEAL_SECONDS` are what keep the flow from costing 30 seconds per run.

## Writing a probe

Each probe prints a measurement and a verdict rather than asserting. That is deliberate: a playtest
is for finding out what happens, and a probe that throws on the first surprise stops measuring the
other twenty scenarios. Verdicts are `OK`, `FINDING`, and `KNOWN-BY-DESIGN` — the last for behaviour
the code documents as intentional but which a player would still report as a bug.

Sweep the *sub-tick phase* of anything involving contact. A single placement tests one point on the
tick grid; a car covers 10–18 units per tick, so a probe that does not sweep the approach distance
will report whatever that one phase happened to do. The ram finding is exactly this — it looks
either fine or completely broken depending on which starting gap you pick.
