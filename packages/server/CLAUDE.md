# `@motor-combat-moba/server`

Authority: Express + Colyseus, three rooms (`ArenaRoom`, shipped `PracticeRoom`, dev-only
`PlaygroundRoom`), a 60 Hz tick that takes one buffered input per car per tick into shared `stepSim`,
and snapshots at `SNAPSHOT_RATE_HZ`. Serves client `dist` in LAN mode. Health `GET /health`, monitor
`/colyseus`.

**Local invariant:** never trust client poses. Apply validated `InputPacket`s only, one input per car
per tick through `TickInputBuffer`; write `{x, y, angle}` from `stepSim`.

## The tick pipeline

`rooms/tick-pipeline.ts`'s `runPipeline` (shared by all three rooms) runs, in order:

1. `statusTick` — sweeps expired statuses, returns the tick's per-player `Modifiers`. Statuses go
   first so no two phases disagree about whether a car is slowed.
2. `serverTick` — drives every car, returns each session's `fireSlots` bitmask.
3. `contactTick` (`sim/ram-bridge.ts`) — the ordinary ram, a dash resolved into a `ContactHit`, a
   charge into a slam; applies `reeling`/`ramLock` and hands `contactHits`/`statusRequests` to combat.
   See [`docs/combat-model.md`](../../docs/combat-model.md#maneuvers-and-the-contact-pass).
4. `combatTick` — shared `runCombat`.

The bridges hold no rules: `sim/status-bridge.ts` maps `PlayerState.statuses` onto the sim and back
(it owns no room memory — a status has no server-only half, because the client predicts through the
same modifiers); `sim/combat-bridge.ts` maps `ArenaState` onto `runCombat` and back. Per-player
`FireState`, the weapon-instance id counter and `damageClock`/`pierceLeft` bookkeeping are
deliberately **server-only** state, never schema fields (`CombatMemory` in `combat-bridge.ts`), as is
the ram falloff stack.

## No room may call `installMode`

Every room holds its own `ModeConfig` (`this.modeConfig`) and enters it with
`scoped(this.modeConfig, fn)` (`rooms/mode-scope.ts`) at every entry point: each message handler, the
simulation interval, and the synchronous tail of `onCreate`. `installMode` writes one bundle per
PROCESS and restores nothing, so a room that called it would hand its numbers to every other room,
a live match included. `practice-room.test.ts` keeps a source-text guard.

- `ArenaRoom` resolves from `state.mode` in `onCreate` and re-resolves when the host changes mode
  (`MSG_SET_MODE`).
- `PracticeRoom` pins `FFA_DEATHMATCH`; `PlaygroundRoom` pins `DEFAULT_GAME_MODE`, each for life.
- All three resolve through `modeConfigOrDefault`, never the throwing `modeConfigOf`, since
  `state.mode` is a wire `uint8`.
- The playground retunes without installing: `applyOverrides(base, overrides)` (`modes/overlay.ts`)
  returns a tuned sibling bundle, rebuilt from the room's pristine base on each message so blobs
  replace rather than accumulate.

## Every room filters what each client receives

Each client gets a `StateView` on join (`ensureView`), and `net/view-manager.ts`'s
`ViewManager.update` recomputes every view once per snapshot, immediately before `broadcastPatch`, in
all three rooms; a client with no view receives no tagged field. Viewers' swept-cone leads come only
through `viewerLeadMs`, the one place its cap is enforced. A new schema field a client may not always
see needs a `@view` tag (invariant 8); see
[`docs/networking.md`](../../docs/networking.md#what-a-client-may-know-nr42nr49).

## Build order matters here

`tsup` inlines `@motor-combat-moba/shared`'s built `dist` into `dist/index.js`, so shared must be
built first. Use root `npm run build` (shared → server → client), never `npm run build --workspaces`.
A stale bundle runs the previous sim while every unit test passes, because tests import `src`.
