# Mouse aim, the turret muzzle, and one control layout

**Date:** 2026-09-21
**Status:** approved design (brainstorm 2026-09-21), awaiting implementation plan
**Clauses:** TR1–TR52

## 1. What this is

Four changes that ship together because each needs the others to make sense:

1. **A sixth kind of muzzle, the turret.** Besides the four fixed muzzles and the aura's centre origin,
   a weapon may now fire from a turret mounted on the car, along a bearing the player chose with the
   mouse. The turret turns to that bearing before the weapon's wind-up starts.
2. **Turret art.** Every car draws a turret on top of its hull, tinted in the car's colour, with a
   per-car image that falls back to one default image.
3. **Pointer lock and a crosshair**, plus a menu reachable from every room kind — including a
   non-pausing overlay menu in a multiplayer match, which has none today.
4. **One control layout.** LMB for the basic attack, RMB / Q / E / Space for ability slots 1–4. The
   basic attack is switched **on**; `N` stays 3.

## 2. Decisions taken in the brainstorm

| # | Question | Decision |
|---|---|---|
| D1 | Which weapons fire from the turret | A per-weapon field any row can opt into. Ships set on the nine basic attacks, `predator`, `magmablast` and `thumper`. `roadblock`, `pepperbox`, `afterburner`, `lance`, `tremor` and the two maneuvers keep their fixed muzzles. |
| D2 | Turret between shots | Holds its angle **relative to the car** — bolted on, turns with the hull. |
| D3 | Point the line of fire is measured from | The **turret mount point**, not the car centre. The mount offset is therefore shared sim config. |
| D4 | Multiplayer menu Exit | Disconnects (`room.leave()`) and lands on the **join screen**, exactly as today's disconnect. No reconnect. |
| D5 | What the turret aims at during turn + wind-up | The **world bearing** frozen at the click. The car may move and turn; the shot leaves along that bearing from wherever the mount is at release. |
| D6 | Turret size | A tuning knob, not a design decision. Starts at ~36 u long. |
| D7 | Architecture | **Approach A**: the turret is sim state. Its turn is part of the fire state machine, its angle crosses the wire, and bots aim it through the same seam. |

## 3. The sim

### 3.1 Config

- **TR1** `packages/shared/src/config/turret-config.ts` exports
  `TURRET_CONFIG = { turnRateDegPerSec: 540, defaultOffset: 25 }` and a derived
  `TURRET_TICKS.turnPerTick` (radians per tick, from `TICK_RATE_HZ`). `defaultOffset` is world units
  from the turret **pivot** to the barrel tip at the shipped turret size (§6). Both are exported from
  the package index.
- **TR2** `WeaponBase` gains an optional `turret?: TurretDef`, where
  `TurretDef = { additionalOffset: number }` (world units, ≥ 0). **Presence is the flag**: a row with
  `turret` fires from the turret; a row without it behaves exactly as today.
- **TR3** A config test holds `turret` to rows that are `kind: "projectile"` **and** author no
  `muzzles` (a single forward muzzle), with a finite `additionalOffset ≥ 0`. A beam, a maneuver or a
  multi-muzzle row carrying `turret` fails the suite by name. (Beams are left out on purpose: an
  attached beam re-anchors through `muzzleDir` every tick, and a turret beam would need its own
  anchor rule — YAGNI until a row wants one.)
- **TR4** `BASIC_ATTACK_BASE`, `predator`, `magmablast` and `thumper` carry
  `turret: { additionalOffset: 0 }`. A test pins exactly this set of row ids (the nine basic attacks
  plus the three abilities), listing ids rather than a count.
- **TR5** `CarDef` gains `turretMount: { x: number; y: number }` — car-local world units, `x` along
  the heading, `y` along the car's +y axis in the sim frame (the same frame `angle` rotates). Every
  `CAR_TABLE` row ships `{ x: 0, y: 0 }`. `turretMountOf(carId)` resolves it; an unknown id resolves to
  `{ x: 0, y: 0 }`.
- **TR6** `turretPivotOf(pose, carId)` in `sim/weapons/turret.ts` returns the mount's world point
  for a pose. It is the **only** place the car-local→world rotation of the mount is written; the
  client's turret drawing and crosshair bearing call it too.

### 3.2 State

- **TR7** `FireState` gains `turretAngle: number` — radians **relative to the car's heading**,
  normalised to (−π, π]. `newFireState` sets it to 0, so a respawn faces the turret forward.
- **TR8** `PendingFire` gains `bearing: number | null` (world radians, `null` for a non-turret
  weapon) and `aligned: boolean` (`true` for a non-turret weapon).
- **TR9** `ShotOrder` gains `bearing: number | null`, copied from the pending press. It is what
  `spawnInstances` reads; nothing else carries the bearing.
- **TR10** `PlayerState` gains `@type("number") turretAngle = 0`, mirrored from
  `FireState.turretAngle` by `combat-bridge.ts` beside `switchLockUntilTick`. **Render-only**:
  `stepSim` never reads it, so invariant 8 does not apply and the client does not predict it.
  `docs/schema-reference.md` gains the row.

### 3.3 The fire state machine

- **TR11** The per-tick order becomes `tickRecharge → beginFire → turnTurret → releaseShots`. The
  module comment in `fire.ts` and `runCombat` are updated to match.
- **TR12** `beginFire` takes two new trailing parameters, `aimBearing: number | null = null` and
  `carAngle = 0`. When it commits a turret weapon it sets
  `bearing = aimBearing ?? carAngle + state.turretAngle` (no aim on the wire means "fire where the
  turret already points"), `aligned = false`, and `nextShotTick = Number.POSITIVE_INFINITY` until the
  turret arrives. A non-turret commit is unchanged, with `bearing: null, aligned: true`. The stock is
  still spent at press time: a press is a commitment.
- **TR13** `turnTurret(state, carAngle, tick)` (in `sim/weapons/turret.ts`) is pure:
  - With a pending turret press, it turns `turretAngle` toward `bearing − carAngle` along the
    **shortest arc**, at most `TURRET_TICKS.turnPerTick` per tick. If the remaining arc is within one
    tick's step, it snaps to the target.
  - The **first** tick it is on target while `aligned` is false, it sets `aligned = true` and
    `nextShotTick = tick + weaponTicksOf(id).startUp`. So a turret that already points the right way
    fires on the press tick when the weapon has no wind-up, as every weapon does today.
  - After alignment, it keeps tracking `bearing − carAngle` at the same rate through wind-up and any
    later volleys, so the drawn barrel follows the frozen bearing while the car turns beneath it.
  - With nothing pending, or a non-turret press pending, `turretAngle` is left alone (D2).
- **TR14** `releaseShots` never releases a press whose `aligned` is false. That is the only change to
  it besides copying `bearing` onto the order.
- **TR15** The turn cannot be cancelled by the player, but it is dropped with everything else when a
  wreck clears `pending` (`cancelPending`). `disarmed` still blocks new presses only; a turn in
  progress finishes.
- **TR16** Stock recharge's "a committed press is still resolving" guard in `tickRecharge` already
  keys on `pending.slot`, so the turn window is covered by it with no change. A test pins that a
  turret press on a stock weapon does not start its recharge while turning.
- **TR17** The HUD reads a mid-press car as `tick < pendingUntilTick`. While a turret press is
  turning, the bridge writes `pendingUntilTick = tick + 1`, so the turn reads as mid-press;
  afterwards it writes `nextShotTick` exactly as today.

### 3.4 Spawning

- **TR18** For an order whose `bearing` is not null, `spawnInstances` spawns every pellet from
  `pivot + dir(bearing) × d`, where `pivot = turretPivotOf(pose at release, carId)` and
  `d = TURRET_CONFIG.defaultOffset + def.turret.additionalOffset`. The pellet fan's axis is
  `bearing`, and `muzzleDir` on the instance is `bearing − owner.angle`. The pose is the one at
  release (D5: the bearing is frozen, the pivot is not).
- **TR19** **No shot is born through a wall.** `d` is clamped to
  `wallClipDistance(pivot, bearing, d, obstacles, bounds)`, so a car hugging a wall and aiming out
  spawns its shot at the wall face. There it dies (or detonates) on its first step, exactly as a
  shot that runs into that wall in flight would. `spawnInstances` gains the world
  (`{ obstacles, bounds }`) as an optional trailing argument; when it is absent (unit-test seam) no
  clamp is applied. `runCombat` always passes it.
- **TR20** The legacy `aimAngle` parameter of `spawnInstances`, and its aim-assist doc prose, are
  **deleted**. The turret path replaces the only reason it existed. `runCombat`'s call site stops
  passing `null` for it.

### 3.5 The wire

- **TR21** `InputMessage` gains an optional `aimAngle?: number` — the world bearing from the
  controlled car's turret pivot to the crosshair, in radians. The client sends it on **every** input
  while the arena scene is live, because the press edge is found by the server (TR23), not the
  client.
- **TR22** `isInputMessage` accepts a message with `aimAngle` absent or a finite number. A present
  non-finite or non-number `aimAngle` **rejects the whole message**, the same as a malformed
  `fireSlots` today.
- **TR23** `serverTick` records, per session, the `aimAngle` of the **last simulated input in the
  batch whose `pressed` mask was non-zero**, into a new `TickResult.aims: Map<string, number>`. An
  input with no `aimAngle` records nothing, so the press falls back per TR12. Inputs past
  `maxInputsPerTick` never reach it, the same gate fire masks ride.
- **TR24** `combat-bridge.ts` threads `aims.get(sessionId) ?? null` onto the combat player as
  `aimBearing`, and `runCombat` passes it and the car's `angle` to `beginFire`. `runPipeline`
  threads `TickResult.aims` through as it already threads `masks`.

### 3.6 The bot

- **TR25** `BotIntent` gains `aimAngle?: number`, and `BotController` forwards it onto the
  `InputMessage` it enqueues. `duel.fixture.ts` forwards it the same way.
- **TR26** For a turret weapon, the bot's firing solution (`solution.ts`) solves a **lead bearing**
  from its own turret pivot to the target's predicted position, rather than requiring the hull to
  face the target. The solver budgets the turret turn time (arc ÷ turn rate) into its time-to-impact.
  The bot's tier aim error (`aim.ts`) is applied to that bearing. A non-turret weapon keeps its
  current heading-based solution.
- **TR27** `chooseSlot` already selects the basic-attack slot whenever `BASIC_ATTACK_CONFIG.enabled`
  is true; this clause only records that the flag flip (TR46) changes the bot's behaviour with no
  code edit there.
- **TR28** `BOT_BRAIN_VERSION` bumps (minor). Every balance and playtest report before this change
  is incomparable, for three reasons: the basic attack comes on, three abilities become free-aim,
  and the bot aims them.

## 4. Input, pointer lock and the crosshair (client)

- **TR29** `SLOT_KEYS` becomes one layout, indexed by fire slot:

  | Fire slot | Binding | Glyph |
  |---|---|---|
  | 0 basic attack | LMB (`buttonsMask: 1`) | `LMB` |
  | 1 | RMB (`buttonsMask: 2`) | `RMB` |
  | 2 | Q (81) | `Q` |
  | 3 | E (69) | `E` |
  | 4 | Space (32) | `SPACE` |

  `H`, `J`, `K`, `L`, `;` and MMB are unbound. `keyGlyph` is deleted: one layout has one label.
  Slot 4 stays inert while `N` is 3, as `slotMaskFrom` already guarantees. The MMB autoscroll
  suppression goes with MMB. The RMB context-menu suppression stays.
- **TR30** The countdown action hint teaches `LMB RMB Q E` (`hintSlotOrder` with the flag on). The
  gutter pills read `RMB`, `Q`, `E`. BA19's rule stands: the basic attack has no pill, and the hint is
  where LMB is taught.
- **TR31** A new client module, `input/pointer-lock.ts`, owns the lock. Its state transitions are a
  pure reducer so they are unit-testable; the DOM wiring around it is thin.
  - **Acquiring.** While the arena scene is live and no menu is open, a click on the game canvas
    calls `canvas.requestPointerLock()`. The browser allows nothing else: a lock needs a user
    gesture.
  - **The locking click never fires.** Mouse buttons contribute nothing to the fire mask until the
    lock is held **and** every button that was down when it was acquired has been released.
  - **The virtual cursor.** While locked, a cursor position in canvas pixels is integrated from
    `movementX/Y`, clamped to the canvas rectangle. It starts at the canvas centre on first lock and
    persists across unlocks within the scene.
  - **Losing the lock.** A `pointerlockchange` to unlocked that the game did not ask for (Esc, alt-tab,
    focus loss) opens the menu (TR35).
- **TR32** The crosshair is drawn at the virtual cursor while the lock is held **and** the controlled
  car is on the field (`isOnField`). It is a circle with a centre dot, and four lines running from
  near the dot out past the circle, up/down/left/right. It is white with a dark outline so it reads
  on both arena floors, and sits on a screen-space layer above the HUD. Its dimensions are a small
  client config (`CROSSHAIR_STYLE`), not literals in the scene. While the menu is open the OS cursor
  shows and the crosshair is hidden.
- **TR33** `aimAngle` (TR21) is `atan2` from `turretPivotOf(controlled car's rendered pose)` to
  `camera.getWorldPoint(virtual cursor)`. The **rendered** pose is used because it is what the
  player aimed at on screen. Keyboard fire keys (Q/E/Space) aim at the crosshair too. Before the
  first lock, the cursor sits at the canvas centre.
- **TR34** While a menu is open (any room kind) the client sends **neutral** input — no steer,
  throttle or fire — for as long as the menu is up. In practice and the playground the pause already
  stops input; in an arena match this is new, and the car coasts.

## 5. The menu

- **TR35** **P** toggles the menu in all three room kinds. **Esc** opens it (via TR31's lock-loss
  path — the browser has already released the lock). Opening the menu always releases the lock.
  Resume closes it and re-requests the lock from the Resume click, which is a user gesture.
- **TR36** **Practice**: unchanged mechanically — P sends `MSG_PRACTICE_PAUSE`, the server freezes the
  sim, and the menu mounts off `state.paused`. Esc now does the same.
- **TR37** **Playground**: unchanged mechanically — its own P handler pauses the room. Esc now does the
  same, and the lock is released while paused and re-requested on resume.
- **TR38** **Arena (multiplayer)**: a **client-only** overlay menu with **Resume** and **Exit**. The
  sim does not pause and nothing is sent to the server except the neutral input (TR34). The overlay
  is semi-transparent (the match stays visible behind it), and its title and buttons sit on an opaque
  enough panel to read clearly over any arena. Exit calls `room.leave()` with the exit target left at
  the join screen, which is the existing disconnect path (D4); the server's `onLeave` is unchanged.
- **TR39** `renderPause` gains a `variant: "paused" | "overlay"`. `"paused"` is today's menu.
  `"overlay"` uses the translucent backdrop and the title "Menu". Both keep Resume and Exit.
- **TR40** Pointer lock is requested only in `ArenaScene`, through the whole of its life: countdown,
  match, death and spectating alike (the crosshair hides when the car is off the field, per TR32, but
  the lock stays so a respawn needs no extra click). The scene releases it on shutdown — which covers
  the move to results, a room leave, and every exit. Lobby, car select, join and results never lock.

## 6. Turret art and drawing

- **TR41** Manifest keys `turret.<carId>` and `turret.default`. `turretSpriteKey(carId)` resolves the
  per-car row, then `turret.default`, then a **procedural fallback** (a rounded block with a barrel,
  drawn in the scene), keeping the project's rule that art is always optional. Art faces +x, like
  car art. The row's `origin` is the **pivot** inside the image (the default image ships
  `[0.31, 0.5]`, on its mount plate). `colorMode` defaults to `"tint"`.
- **TR42** The turret is drawn above its car sprite, at `turretPivotOf(rendered pose)`, rotated to
  `rendered angle + interpolated turretAngle` (shortest-arc interpolation, as `angle` already is). It
  is tinted with the same car fill and four-corner lighting as the hull. Its long edge is
  `TURRET_VISUAL.lengthUnits` (client config, 36) times the row's numeric `scale` (`"fit"` = 1). It
  fades with the car on death and is hidden with it.
- **TR43** `scripts/import-art.mjs` gains `--turret`, writing `public/art/turrets/<carId>.png` (or
  `default.png` for the id `default`). It trims, downscales to the same 2 px per world unit car art
  uses (36 u → 72 px long edge), desaturates unless `--keep-color`, and upserts the `turret.<id>`
  row, preserving hand-tuned fields as the car path already does. `preflight.mjs` accepts the same
  flag. The `process-car-asset` skill documents the turret path. `npm run check:art` covers turret
  rows with the car blockers (alpha, missing file), and `check:cars` includes them.
- **TR44** This work imports `E:\Work\PROJECT DOCS\car racer\assets\turrets\default-turret.png` as
  `turret.default`. No per-car turret ships.
- **TR45** `?dev=assets` draws the turret on each car at its mount and adds a dot where a turret shot
  with `additionalOffset: 0` would spawn (`defaultOffset` along the turret's facing). This is how
  `defaultOffset`, `turretMount`, the row's `origin` and `TURRET_VISUAL.lengthUnits` are lined up by
  eye: the dot should sit on the barrel tip.

## 7. The basic attack comes on

- **TR46** `BASIC_ATTACK_CONFIG.enabled` becomes `true`, following the `basic-attack-toggle` skill's
  checklist: the hint (TR30), the bot (TR27), the manual rebuild, and tests.
  `WEAPON_SLOT_CONFIG.maxAbilitySlots` stays 3; no change is owed there.

## 8. Docs, manual, and the things this moves

- **TR47** The cars & weapons guide rebuilds: `CAR_TABLE` (`turretMount`), `WEAPON_TABLE` (`turret`)
  and the basic-attack flag all move `balanceStamp`. A weapon with `turret` prints a stat point
  "Aim: turret (mouse)". A weapon without one prints nothing new: a point that does not apply is left
  out.
- **TR48** Docs updated in the same change: root `CLAUDE.md` (the basic-attack paragraphs' binding
  prose — `H`, the J/K/L hand, "switched off"; the muzzle description), `docs/combat-model.md`
  (the turret muzzle, turn-then-wind-up order), `docs/config-reference.md` (`TURRET_CONFIG`,
  `CarDef.turretMount`, `WeaponBase.turret`), `docs/schema-reference.md` (`turretAngle`),
  `docs/networking.md` (`aimAngle`), `docs/asset-pipeline.md` (turret rows), and `slot-keys.ts`'s
  doc comment.
- **TR49** **Playtest probes (say it loudly, do not update silently).** The weapon probes sweep
  `WEAPON_TABLE` and fire without `aimAngle`, so a turret weapon fires along `heading + turretAngle`
  = the heading at spawn — the same line as before. But its origin moves from the hull's nose (30 u)
  to `pivot + 25 u`, which shifts measured reach and hit geometry by ~5 u for these rows. The
  final summary names the weapon probes and recommends a run. Probes are updated only on request;
  a probe that stops compiling is the one exception, fixed on the spot and reported.
- **TR50** The netcode rewrite plans (2026-09-04) are **not** edited. The summary notes that
  `aimAngle` and `turretAngle` will need rows in that work's `interfaces.md` ledger when it runs.

## 9. Testing

- **TR51** Unit tests, TDD-first, at the seams:
  - shared: `turnTurret` (shortest arc across ±π, snap within one step, alignment tick,
    `startUp` counted from alignment, tracking a turning car, idle hold); `beginFire` bearing capture
    and fallback; `releaseShots` refusing an unaligned press; `spawnInstances` turret origin, fan
    axis and wall clamp; the config tests TR3/TR4; `turretPivotOf` rotation.
  - server: `isInputMessage` (TR22); `serverTick` aim capture (TR23 — last pressing input wins, a
    capped input contributes nothing); the bridge mirroring `turretAngle` and the turning
    `pendingUntilTick`; one `runPipeline` integration test where a press aimed 90° off the heading
    spawns a shot on the bearing after `ceil(90° / turnPerTick)` ticks.
  - client: `SLOT_KEYS` / `slotMaskFrom` / `hintSlotOrder` under the new layout; the pointer-lock
    reducer (locking click swallowed, lock loss opens the menu, neutral input while the menu is
    open); the aim bearing helper; `renderPause`'s two variants.
  - scripts: manual page and `check:art` suites cover the turret rows.
- **TR52** Done means: root `npm test` green apart from the deliberately-red cases already present
  before this work (recorded by a pre-change run, not recalled from memory), root `npm run build`
  green, `npm run build:manual` committed, and the arena, practice and playground exercised in the
  browser — lock → crosshair → click-to-fire → turret turns → shot leaves the barrel → P/Esc menu →
  Resume relocks → arena Exit lands on join.

## 10. Out of scope

Client-side prediction of the turret turn (a later smoothing pass fits approach A). A turret beam.
Per-car turn rates. Reconnect. Touch or gamepad aim. Retuning any weapon for free aim — that is the
balance harness's question after this lands.
