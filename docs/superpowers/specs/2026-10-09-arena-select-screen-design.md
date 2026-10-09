# Arena select screen — design

**Date:** 2026-10-09
**Status:** approved in brainstorming, awaiting spec review
**Clauses:** AR1–AR40
**Not to be confused with** [`2026-08-26-arena-selection-and-release-pruning-design.md`](2026-08-26-arena-selection-and-release-pruning-design.md),
which is the build-time arena choice and zip pruning. This spec is the in-game screen.

## 1. Summary

A new screen sits between the lobby's Start and car select. The **host** chooses which of the
mode's arenas the match plays on, everyone else in the roster watches the host's highlight move
live, and once the arena is decided its card is revealed in the centre of every screen before car
select begins. A mode may switch the screen off, in which case the match plays the mode's default
arena exactly as it does today.

Flow, enabled:

```
LOBBY --Start--> ARENA_SELECT (choosing, 10 s) --pick--> ARENA_SELECT (reveal, 3 s [+1.5 s roulette]) --> CAR_SELECT --> REVEAL --> COUNTDOWN --> MATCH
```

Flow, disabled: `LOBBY --Start--> CAR_SELECT --> …` — unchanged from today.

## 2. Arena data

- **AR1.** `ArenaDef` gains a required `displayName: string`. Seed values: `arena-01` → "Arena 01",
  `arena-02` → "Arena 02", `arena-03` → "Arena 03".
- **AR2.** A shared test asserts, over every row of `ARENAS`: every `displayName` is non-empty after
  trimming, and no two display names are equal after `trim().toLowerCase()`. The failure names both
  arena ids and the colliding name.
- **AR3.** The preview image is **not** a field on `ArenaDef`. It is optional art in the existing
  arena art namespace: manifest key `arena.<arenaId>.preview`, file
  `public/art/arenas/<arenaId>/preview.png`, 16:9 (authored at 640 × 360 or larger). Shared stays
  free of client file paths, and the release prune — which already keeps every arena in
  `activeArenaIds()` (`scripts/build-release.mjs`) — carries previews with no change.
- **AR4.** An arena with no `arena.<id>.preview` manifest row is legal. Its card renders blank, with
  the display name only (§6). No shipped arena has a preview in this work; art is authored later.

## 3. Per-mode configuration

- **AR5.** The mode's arena list stays where it is: `ModeTables.arenas`, base
  `["arena-01", "arena-02"]` (`modes/base.ts`), Conquer overriding to `["arena-03"]`. `arenas[0]` is
  the mode's **default arena**. No new list is introduced.
- **AR6.** Four keys join the per-mode `flow` table (`config/flow-config.ts`, `FLOW_CONFIG`), so any
  mode can override them in its own `config.ts`:

  | Key | Base value | Meaning |
  |---|---|---|
  | `arenaSelectEnabled` | `true` | Whether the screen runs at all. |
  | `arenaSelectSeconds` | `10` | The host's choosing countdown. |
  | `arenaRevealSeconds` | `3` | How long the chosen card holds in the centre. |
  | `arenaRouletteSeconds` | `1.5` | Extra reveal time when the pick was random, for the roulette. |

- **AR7.** No shipped mode overrides these in this work. Editing the base `flow` table moves all four
  mode snapshots (`modes/__snapshots__/<slug>.tables.json`); each moved file is accepted by name,
  never with a blanket `-u`.
- **AR8.** `flow` is not hashed into the guide's `balanceStamp`, so this owes no `build:manual`.

## 4. Room flow (server)

- **AR9.** `RoomPhase.ARENA_SELECT = 5`, appended. No existing value moves (invariant 7).
- **AR10.** `FlowState.phase` gains `"arena_select"`; `toFlowPhase`/`fromFlowPhase`
  (`server/src/rooms/flow-map.ts`) map it.
- **AR11.** New `ArenaState` fields, all display/room-flow only — `stepSim` reads none of them:

  | Field | Type | Meaning |
  |---|---|---|
  | `arenaHighlightId` | `string` | The arena the host's highlight sits on. |
  | `arenaSelectDeadlineTick` | `uint32` | When choosing ends. |
  | `arenaRevealEndsTick` | `uint32` | 0 while choosing; set when the pick lands. |
  | `arenaPickRandom` | `boolean` | The pick came from Select random (clients play the roulette). |

  The existing `arenaId` is written at the moment of the pick (AR17).
- **AR12.** `PROTOCOL_VERSION` goes 8 → 9: a new phase value and new schema fields; a client of 8
  would route `ARENA_SELECT` to the lobby fallback. The version's doc comment gains a line for 9.
- **AR13.** On `MSG_START_MATCH` (host, LOBBY, `canStart` ok — all unchanged), the room branches on
  the installed mode's `flow().arenaSelectEnabled` and `arenas.length`:
  1. **Disabled** — `arenaId = arenas[0]`, then the existing `start` into `CAR_SELECT`. Today's
     behaviour.
  2. **Enabled, `arenas.length >= 2`** — phase `ARENA_SELECT`, `arenaHighlightId = arenas[0]`,
     `arenaSelectDeadlineTick = now + arenaSelectSeconds·TICK_RATE_HZ`, `arenaRevealEndsTick = 0`,
     `arenaPickRandom = false`.
  3. **Enabled, `arenas.length === 1`** — phase `ARENA_SELECT`, and the pick lands on the same tick
     (AR17) with that one arena, not random. Only the reveal is shown.
- **AR14.** In every branch the roster is formed, car locks cleared, `lockedCarId` cleared and the
  controller's `onStartRequested` called at Start, exactly as today — moving into `ARENA_SELECT`
  rather than `CAR_SELECT` is the only difference. Roster players get `PlayerStatus.IN_MATCH`.
- **AR15.** The reducer's `start` event gains `firstPhase: "arena_select" | "car_select"`. With
  `"car_select"` it behaves exactly as today (stamps `carSelectDeadlineTick`). With
  `"arena_select"` it forms the roster but leaves `carSelectDeadlineTick` alone. A new
  `begin_car_select { nowTick, carSelectTicks }` event moves `arena_select → car_select` and stamps
  `carSelectDeadlineTick` then — the car-select clock starts when car select is shown, not at Start.
  `begin_car_select` outside `arena_select` is a no-op. The arena fields (AR11) are room state, not
  reducer state: the reducer owns phase and roster only.
- **AR16.** Two new messages, in `shared/src/net/lobby-messages.ts`, exported from the shared index:
  - `MSG_ARENA_HIGHLIGHT = "arena_highlight"`, payload `{ arenaId: string }`.
  - `MSG_ARENA_PICK = "arena_pick"`, payload `{ arenaId: string } | { random: true }`.

  Each has a payload guard beside it (`isArenaHighlightPayload`, `isArenaPickPayload`). Both
  messages are refused silently unless: the payload passes its guard; the sender is
  `hostSessionId`; the phase is `ARENA_SELECT`; `arenaRevealEndsTick === 0` (not yet picked); and,
  where an `arenaId` is named, it is in the installed mode's `arenas`. Both ride the room's existing
  `limited(...)` rate limiter and `scoped(this.modeConfig, …)`.
- **AR17.** **The pick.** One room method, `pickArena(arenaId, random)`, used by every route:
  writes `arenaId`, `arenaHighlightId = arenaId`, `arenaPickRandom = random`, and
  `arenaRevealEndsTick = now + ceil((arenaRevealSeconds + (random ? arenaRouletteSeconds : 0))·TICK_RATE_HZ)`.
- **AR18.** `MSG_ARENA_HIGHLIGHT` writes `arenaHighlightId` only. `MSG_ARENA_PICK {arenaId}` calls
  `pickArena(arenaId, false)`. `MSG_ARENA_PICK {random}` draws uniformly from the mode's `arenas` on
  the server and calls `pickArena(drawn, true)`. The draw goes through an injectable
  `arenaRandom: () => number` on the room (default `Math.random`) so a test can pin it.
- **AR19.** In `step()`: while `ARENA_SELECT` and `arenaRevealEndsTick === 0`, at
  `tick >= arenaSelectDeadlineTick` the room calls `pickArena(arenaHighlightId, false)`. While
  `ARENA_SELECT` and `arenaRevealEndsTick > 0`, at `tick >= arenaRevealEndsTick` it reduces
  `begin_car_select` with `getCarSelectSeconds(flow().carSelectSeconds)·TICK_RATE_HZ`. Both sit
  beside the existing `CAR_SELECT` / `REVEAL` / `COUNTDOWN` branches.
- **AR20.** **Host leaves mid-pick.** The existing `selectNextHost` reassigns `hostSessionId` as
  today. If the new host is on the roster they may highlight and pick with the same clock. If the
  new host is not on the roster (a lobby player), no one can pick and the deadline decides. The
  clock is never reset.
- **AR21.** **A roster player leaves mid-pick.** No new code: `onLeave` already runs
  `controllerOf(mode).afterLeave(...)` for any roster leaver in every phase but `LOBBY`, and ends
  the match through `endMatch` when the controller says so — exactly what it does during
  `CAR_SELECT` today. `ARENA_SELECT` inherits it. A test holds it (a two-player FFA where one
  leaves mid-pick ends back in the lobby, as it does mid car-select).
- **AR22.** A player who joins during `ARENA_SELECT` is `READY` and sees the lobby, as during car
  select today.
- **AR23.** **Back to the lobby.** After a match `arenaId` keeps the arena last played, exactly as
  today; `MSG_SET_MODE` still resets it to the new mode's `arenas[0]`. The next Start always opens
  with the highlight on `arenas[0]`.
- **AR24.** `PracticeRoom` and the playground are untouched: neither has a lobby or a Start.

## 5. Client: routing and layers

- **AR25.** `viewFor(IN_MATCH, ARENA_SELECT)` (`shared/src/lobby/status.ts`) returns a new `ViewId`
  `"arena_select"`; `VIEW_TO_SCENE.arena_select = "arena_select"` (`client/src/net/view.ts`). A
  `READY` or `POST_MATCH` player is routed as today.
- **AR26.** **The screen knows nothing about arenas.** Its only input type is

  ```ts
  interface ArenaCard { id: string; name: string; previewUrl: string | null }
  ```

  Four units, each with one job:
  - `ui/arena-cards.ts` — the **adapter**, and the only client file that touches arena data. Maps
    the room's mode's `arenas` — `modeConfigOrDefault(state.mode).arenas`, not whatever bundle the
    client happens to have installed, since the host can change mode in the lobby — to
    `ArenaCard[]`: `getArena(id).displayName` for `name`, the art
    manifest's `arena.<id>.preview` row resolved to a URL for `previewUrl`, else `null`.
  - `ui/arena-select-view.ts` — a pure view model: `(cards, state) → ArenaSelectView`, where state
    is `{ highlightId, chosenId, isHost, secondsLeft, stage }` and `stage` is
    `"choosing" | "roulette" | "revealed"`. No Phaser, no DOM.
  - `ui/screens/arena-select.ts` — the DOM renderer, built like `screens/car-select.ts` on
    `ScreenOverlay` and the `organic.css` tokens.
  - `scenes/ArenaSelectScene.ts` — binds room state, derives `stage`, re-renders on change, sends
    `MSG_ARENA_HIGHLIGHT` on a card click and `MSG_ARENA_PICK` on the buttons, and binds the view
    router. Registered in the Phaser game config beside `CarSelectScene`.
- **AR27.** Preview images are drawn as DOM `<img>` elements from the manifest file URL. They need no
  Phaser texture preload.

## 6. Client: the screen

Matches the approved mockup.

- **AR28.** Header: "Choose the arena", the mode tag, and a clock (`m:ss`) labelled "Picks in",
  turning to the accent colour in the last 3 s.
- **AR29.** **Grid.** Cards wrap at **3 per row max**. The block is centred horizontally and
  vertically in the space between header and footer, for any count: 1 card sits dead centre, 2 sit
  side by side centred, 5 lay out 3 over 2 with the 2 centred. Card width ≈ 340 px at 1280 × 720,
  preview 16:9 above the name.
- **AR30.** A card with no preview shows a blank panel (`--color-neutral-200`) of the same 16:9 size
  above the name — the card never changes height for lack of art.
- **AR31.** The highlighted card carries a 2 px accent border. Every client renders
  `arenaHighlightId`, so non-hosts watch the host's highlight move.
- **AR32.** Footer: a status line ("Choose an arena, then Select." for the host; "The host is
  choosing the arena." otherwise), then **Select random** (secondary) and **Select** (primary),
  right-aligned. For a non-host, or once picked, both are disabled.
- **AR33.** Host interactions: clicking a card sends `MSG_ARENA_HIGHLIGHT`; the highlight is drawn
  from server state, not optimistically. **Select** sends `MSG_ARENA_PICK` with
  `arenaHighlightId`. **Select random** sends `MSG_ARENA_PICK {random: true}`.
- **AR34.** **Roulette.** The roulette window is the ticks before
  `arenaRevealEndsTick − arenaRevealSeconds·TICK_RATE_HZ`. When `arenaPickRandom` is true and the
  client first sees the pick inside that window, it plays `rouletteFrames(count, fromIndex,
  targetIndex)` — a pure function returning `{ index, holdMs }[]`: at least two full laps when
  `count ≥ 2`, each hold no shorter than the one before, total ≤ `arenaRouletteSeconds·1000`, and
  **last step always `targetIndex`**. `fromIndex` is the highlight before the pick. Then the reveal
  plays. A client that first sees the pick after the window skips straight to the reveal.
- **AR35.** **Reveal.** The unchosen cards fade and shrink away; the chosen card scales up into the
  centre over a dimmed backdrop, under an "Arena selected" heading, with "Car select in N" beneath
  counting down to `arenaRevealEndsTick`. CSS transitions only. When the phase moves to
  `CAR_SELECT` the router switches scenes.
- **AR36.** With a one-arena mode the screen opens already revealed.

## 7. Testing

- **AR37.** Shared: display-name uniqueness and non-empty (AR2); reducer — `start` with each
  `firstPhase`, `begin_car_select` stamps the car-select deadline, `begin_car_select` out of phase is
  a no-op; `viewFor` routes `ARENA_SELECT`; payload guards; the four snapshots re-accepted by name.
- **AR38.** Server room tests: the three Start branches (AR13); highlight and pick refused from a
  non-host, outside `ARENA_SELECT`, after the pick, for an arena outside the mode's list, and for a
  malformed payload; deadline picks the highlight; random always lands inside the list (injected
  RNG); reveal duration with and without roulette; reveal end enters `CAR_SELECT` with a fresh
  car-select deadline; `toFlowPhase`/`fromFlowPhase` round-trip; host leaves mid-pick (roster and
  non-roster successor); roster empties mid-pick.
- **AR39.** Client: `arena-cards` (name from the def, `null` preview without a manifest row);
  `arena-select-view` (buttons disabled for non-host and after pick, urgent clock); `rouletteFrames`
  (ends on target for every from/target pair up to 5 cards, total within budget, monotone holds);
  `sceneKeyFor` routes `ARENA_SELECT`.
- **AR40.** Scope owed: full — `npm test`, `npm run playtest -- --scope=all`, and `npm run test:slow`
  (the diff touches `rooms/` and `modes/`). **Playtest:** `packages/server/playtest/lan.ts` sends
  `MSG_START_MATCH` and will now pass through a 10 s `ARENA_SELECT` that the deadline resolves; flag
  it to the user, do not edit it unasked.

## 8. Docs touched

- `docs/config-reference.md#arena-selection` — rewritten: it already names the wrong file for the
  list and says "both shipped modes". Documents the four `flow` keys and the preview art key.
- `docs/schema-reference.md` — the four `ArenaState` fields and `RoomPhase.ARENA_SELECT`.
- `docs/asset-pipeline.md` — the `arena.<id>.preview` slot.
- `CLAUDE.md` — one paragraph and a "Read the right doc" row pointing at this spec.
