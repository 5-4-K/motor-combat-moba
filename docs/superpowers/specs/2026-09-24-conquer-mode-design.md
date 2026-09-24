# Conquer mode — design

**Date:** 2026-09-24 · **Branch:** `game/team-shooter` · **Clauses:** CQ1–CQ62

Conquer is a 3v3 zone-control mode on a new, tall arena. Two teams start at opposite ends of a
1280 × 2160 map, and each team sees its own base at the bottom of its screen. They fight over a
circular zone in the centre. A team that holds the zone unopposed for 5 s is "in control", and each
tick in control adds to that team's control bar. 60 s of accumulated control wins. When the 3-minute
clock expires, the higher bar wins. A tie goes to sudden-death overtime. Dead cars respawn at their
own base after 5 s.

The user approved the map in a to-scale mockup (draft 3, 2026-09-24). This spec is that mockup
turned into rules.

## 1. Decisions taken with the user (brainstorm record)

- **CQ1** Capture needs **presence**: a team's capture streak runs only while at least one of its
  living cars is in the zone and no living enemy car is. An empty zone does nothing. Both teams
  present is *contested*: nobody's streak runs, and nobody's bar fills.
- **CQ2** The bar target is **60 s of accumulated control = 100 %**. It is cumulative across
  separate holds, it pauses while contested or empty, and it never drains or resets during a match.
- **CQ3** The percentage is shown to the hundredth of a percent. The sim counts whole ticks
  (33.3 ms at 30 Hz, 0.056 % per tick), so the displayed figure is `controlTicks / targetTicks`,
  floored to two decimals. It never shows finer precision than the sim has.
- **CQ4** "A team cannot have two same cars": **the first to lock claims it.** A chassis that a
  teammate has locked is greyed out and refused. Previewing does not claim. Duplicates across
  the two teams are allowed.
- **CQ5** **Exactly 3v3** is required to start. The user tests from a real lobby with six players.
  There is no playground, practice or bot support.
- **CQ6** A dead car respawns after 5 s **at its own base**, with Deathmatch's existing `phased`
  spawn protection.
- **CQ7** **Overtime is unlimited.** It ends when the first team takes control (CQ18).
- **CQ8** Health bars: **green for self and teammates, red for enemies.** The control bars and the
  zone tint use the same viewer-relative green/red.
- **CQ9** The arena is **1280 × 2160** (three screens tall).
- **CQ10** The zone is **circular**. The **wall spikes stay**. A **phased enemy still contests**:
  any living enemy car counts.
- **CQ11** **Nothing is drawn over the arena for Conquer's HUD.** The right gutter holds, top to
  bottom: the control panel (clock, both bars, capture countdown), then the weapon slots and status
  strip, then the roster grouped by team. There is no left gutter.

## 2. Mode identity

- **CQ12** Add `GameMode.CONQUER = 3`, the next unused wire value (invariant 7). Display name
  `"Conquer"` (slug `conquer`). Register it in `MODE_TABLE` and `MODE_ORDER` after Deathmatch.
- **CQ13** Add a mode folder `modes/conquer/`, copied from `modes/deathmatch/`. Its `index.ts`
  authors `arenas: ["arena-03"]` and `maxPlayers: 6`. Every table is byte-equal to Deathmatch's on
  day one. The folder is deliberately **not** added to `table-pinning.test.ts`, per the game-mode
  skill.
- **CQ14** `sidesOf(CONQUER) = "team"`. `winRuleOf` widens to
  `"last_standing" | "deathmatch" | "conquer"` and returns `"conquer"`. This single fact routes
  friendly fire, rams, maneuver hits and spike credit through the existing team paths:
  `canDamage`, `resolveRam` and `contact.ts` already read `sidesOf`.
- **CQ15** Add a new predicate `respawnsIn(mode): boolean` in `flow/modes.ts`, an exhaustive
  switch that is true for Deathmatch and Conquer. Every site that today tests
  `winRuleOf(mode) === "deathmatch"` in order to mean "cars respawn" switches to it:
  - the room's `respawnSweep` gate
  - `runPhaseSweep`
  - the `matchEndsTick` stamp
  - the client's no-spectate rule
  - the "Respawning in N" text

  Sites that mean "kills decide the match" keep testing `=== "deathmatch"`: the kills column,
  `checkDeathmatchEnd`, and the balance harness. The plan lists every site.
- **CQ16** Every client and lobby site that tests `mode === GameMode.TEAM` to mean "this match has
  teams" switches to `sidesOf(mode) === "team"`. Those sites are:
  - `spawns.ts`
  - `start-rules.ts` (the team branch)
  - `lobby-view.ts`
  - `reveal-view.ts`
  - `ArenaScene`'s allegiance collapse (the one that leaves teammates red today)

  Team brawl's behaviour is unchanged by construction.
- **CQ17** `MODE_BOT_CONFIG` gets a Conquer row (a copy of Deathmatch's), because it is a
  `Record<GameMode, …>`. No bot ever plays Conquer (CQ5). The row exists only to compile.

## 3. Rules — the zone

- **CQ18** Vocabulary, per team `t ∈ {0, 1}`:
  - *present(t)*: count of `t`'s roster cars that are `alive` and whose **centre** lies within the
    zone radius (`(x−zx)² + (y−zy)² ≤ r²`). A `phased` car counts (CQ10). A dead car and a car no
    longer in the roster do not.
  - *streak*: consecutive ticks on which exactly one team was present-and-unopposed.
  - *holder*: the team the current streak belongs to, or −1.
  - *in control*: `holder = t` and `streak ≥ D`, where `D = captureDelayTicks` (150 at 30 Hz).
  - *fill tick*: a tick on which the holder is in control **and** its streak was already `≥ D`
    before this tick, i.e. the tick after the countdown finishes and every tick after that.
    Taking control happens on the tick the streak reaches `D`. Filling starts on the next tick.
- **CQ19** `stepZone(prev, presentA, presentB, D)` is a pure function in `flow/conquer.ts`:
  - only A present → `holder = 0`, `streak = prev.holder === 0 ? min(prev.streak + 1, D) : 1`.
    The streak **saturates at `D`**, so the room and the wire hold the same value
  - only B present → the same for team 1
  - neither, or both → `holder = −1`, `streak = 0`, and `contested = (both present)`
  - it then applies the fill: when `holder ≥ 0` and `prev.holder === holder` and `prev.streak ≥ D`,
    `controlTicks[holder] += 1`, capped at the target. With saturation, that means `prev.streak === D`

  A streak broken for even one tick restarts the 5 s countdown from zero. This includes the holder
  leaving or dying, an enemy entering, and the last holder car respawning outside the zone. That is
  the user's "if that enemy goes out or dies then bar starts filling after 5 seconds again".
- **CQ20** The zone is authored on the **arena**. `ArenaDef` gains two optional fields:
  `zone?: { x, y, radius }` and `flipForTeamB?: boolean` (CQ46). A mode whose
  win rule is `"conquer"` may list only arenas that have a zone. `invariants.test.ts` enforces this.
  Arena-03's zone is `{ x: 640, y: 1080, radius: 150 }`.

## 4. Rules — ending the match

- **CQ21** Evaluated in `conquerOutcome(...)`, a pure function, once per MATCH tick, **after**
  `runPipeline` (so deaths this tick are already applied) and after `stepZone`:
  1. If `controlTicks[t] ≥ targetTicks` for a team → that team wins. Both teams cannot reach the
     target on one tick, because only the holder fills.
  2. Else if `overtime` is false and `tick ≥ matchEndsTick`:
     - unequal bars → the higher bar wins
     - equal bars → set `overtime = true` and carry on
  3. Else if `overtime` is true and some team is *in control* (`streak ≥ D`) → that team wins. This
     includes a team already in control at the moment overtime begins: it wins on the next tick.
- **CQ22** `targetTicks = controlTargetTicks` (1800). `matchEndsTick` reuses the existing stamp
  from `deathmatch().matchSeconds` (180 s), per CQ15. The respawn delay (5 s) and phase windows also
  come from Conquer's own `deathmatch` table. That table is named for its first user, but it is the
  "clock and respawn" table.
- **CQ23** A player leaving mid-match: if a team is left with **zero** roster members, the other
  team wins immediately. If both teams are empty, the match ends as a draw (`winnerTeam −1`).
  Otherwise the match continues short-handed. Leaves never change either bar.
- **CQ24** `endMatch(winnerSessionId = "", winnerTeam)` is the existing path. In a conquer-rule
  mode the results title is **viewer-relative**: "You win" / "You lose", or "Draw" for
  `winnerTeam −1` (user decision, 2026-09-24). Team brawl keeps "Team A wins"/"Team B wins".

## 5. Config

- **CQ25** Add a new per-mode table `conquer`. It becomes the sixteenth `ModeTables` config table,
  read through a seventeenth accessor, `conquer()`. It has a raw pinned global, `CONQUER_CONFIG`,
  in `config/conquer-config.ts`, following `deathmatch-config.ts`:
  - `captureDelaySeconds: 5`
  - `controlTargetSeconds: 60`
  - `teamSize: 3`: the exact per-team count Conquer starts with
  - `uniqueChassisPerTeam: true`

  `resolveConquerTicks` produces `{ captureDelay, controlTarget }` in whole ticks
  (`Math.round(s × TICK_RATE_HZ)`), stored as `derived.conquerTicks`. That makes nine derived
  artifacts.
- **CQ26** Every mode folder carries a `conquer.ts`, the same way every mode carries a `deathmatch.ts`
  (it is a table, not a feature flag). Brawl's and Deathmatch's copies are pinned to
  `CONQUER_CONFIG` in `table-pinning.test.ts`, and are **inert**: `teamSize` and
  `uniqueChassisPerTeam` are read only where `winRuleOf(mode) === "conquer"`. This is how Team brawl
  keeps its 1v1-to-3v3 start rule. `parity.test.ts` skips `conquer` the same way it skips
  post-migration tables.
- **CQ27** An invariant test holds `conquer().teamSize ≤ activeCarIds().length` for every mode whose
  win rule is `"conquer"`. With `uniqueChassisPerTeam` on, a larger team could not finish car
  select.

## 6. Lobby and car select

- **CQ28** `canStart` in a conquer-rule mode requires **exactly `teamSize` ready players on each
  team**. The error is built from the table: `` `Conquer needs exactly ${teamSize} ready players per team` ``. Team brawl's branch is
  unchanged.
- **CQ29** Add a new `PlayerState` field `lockedCarId: string` (default `""`). It is written on
  `lock_car` **only in a mode where `uniqueChassisPerTeam` applies**, and cleared on the edge into
  CAR_SELECT. It is not read by `stepSim`, so invariant 8 is not engaged. Other modes keep their
  blind pick on the wire.
- **CQ30** `MSG_SELECT_CAR` in such a mode is refused when a **teammate** already has
  `lockedCarId === carId`. The check is the pure shared helper `chassisTakenByTeammate`. The server
  processes messages serially, so of two teammates racing for the same car, the first lock wins and
  the second press does nothing. `MSG_PREVIEW_CAR` is not refused.
- **CQ31** The car-select deadline must not create duplicates. In such a mode, a player who has not
  locked in gets their preview if no teammate has taken it. Otherwise they get the first chassis in
  `activeCarIds()` order that no teammate has taken. The deadline locks players one at a time, so
  each lock sees the ones before it.
- **CQ32** Car select, client side: in such a mode, a card whose chassis a teammate has locked is
  greyed, shows "Taken · <name>", and cannot be clicked or locked. If the player's own preview is
  taken from under them, the Lock button disables until they pick another card. The enemy team's
  picks are never shown.
- **CQ33** The lobby gets a Conquer mode card (`modeCardsData()`), with copy that quotes
  `conquer()` and `deathmatch()` through accessors, never literals. Its meta chips read
  `3v3 · 3:00 · zone control`. The lobby's team columns, the reveal's team split and the results'
  team split already exist and light up through CQ16.

## 7. Spawns and respawn

- **CQ34** Initial spawns: `assignSpawns` gives team modes team spawns (CQ16). Team 0 (A) spawns at
  the **bottom** of arena-03 and team 1 (B) at the top.
- **CQ35** Respawn in a team mode picks from the **own team's** spawn list, the one farthest from
  the nearest living **enemy** (`farthestSpawn`). Teammates are not treated as threats. FFA respawn
  is unchanged. The helper is `respawnPointFor(arena, sides, team, livingEnemies)`.
- **CQ36** `arena.test.ts`'s "team A left of centre, team B right" becomes "team A and team B are on
  opposite sides of the centre along the x axis **or** the y axis". Arena-01 and arena-02 still
  satisfy the x form, and arena-03 satisfies the y form.

## 8. Arena-03

- **CQ37** `arena-03`: `width 1280`, `height 2160`, `flipForTeamB: true`, and `zone` per CQ20. There is no inset wall band: the boundary is
  the frame with 100 u chamfered corners, clockwise from the top-left:
  `(100,0) (1180,0) (1280,100) (1280,2060) (1180,2160) (100,2160) (0,2060) (0,100)`.
  It has no floor art, so it renders procedurally (CQ49–CQ51).
- **CQ38** Obstacles (top-left x, y, w, h). The layout is symmetric about both centre lines, so
  a 180° rotation maps it onto itself:
  - **B**, lane pillars `100 × 100`: (200,480) (980,480) (200,1580) (980,1580)
  - **C**, midfield blocks `100 × 60`: (590,660) (590,1440)
  - **D**, zone cover `120 × 60`: (330,850) (830,850) (330,1250) (830,1250)
  - **F**, spikes, `kind: "spike"`, depth 20 (= `SPIKE_CONFIG.depth`), flush to the side walls:
    (0,760,20,640) (1260,760,20,640)

  A and E from draft 1 were removed by the user.
- **CQ39** Spawns, with angle 0 = +x and `+y` down:
  - `teamASpawns`: (460,2040) (640,2040) (820,2040), angle `−π/2` (facing up the map)
  - `teamBSpawns`: (460,120) (640,120) (820,120), angle `π/2`
  - `ffaSpawns`: those six, required by the type and by the ≥ 6 test, and unused by Conquer
- **CQ40** Palette `{ floor: "#2b2f35", obstacle: "#4b5362", border: "#1a1d22" }`. **Correction
  (2026-09-24, found in the browser check):** `palette.floor` is only the main camera's background
  colour, and on an arena without floor art the generated asphalt `TileSprite` covers the whole
  arena above it. So the visible floor is `ENVIRONMENT_FX.floor`'s texture seen through the global
  camera grade (`brightness 1.5`, warm tint), which reads sandy, the same as every art-less arena.
  `palette.floor` never shows. `obstacle` and `border` do apply.
- **CQ41** Arena-03 appears in `activeArenaIds()` only once Conquer is published. BootScene
  therefore loads nothing new before that, and after that there is no art to load.
- **CQ42** The spawn-to-zone distance (≈ 810 u) and the phase ceiling (3 s) together keep a
  freshly respawned car from reaching the zone while still phased: Mirage needs a little over 3 s.
  That is a **dependency, not a guarantee**. Lengthening `phaseMaxSeconds` or moving spawns toward
  the zone lets a car contest while untouchable. The config comment on `phaseMaxSeconds` in Conquer's
  table says so.

## 9. Networked state

- **CQ43** New `ArenaState` fields. None is read by `stepSim`; all are written by the room only.
  - `controlTicksA: uint16`, `controlTicksB: uint16`: accumulated fill ticks
  - `zoneHolder: int8 = −1`
  - `zoneStreakTicks: uint16`, saturating at `D` (CQ19)
  - `zoneContested: boolean`
  - `overtime: boolean`

  All six reset on the edge into MATCH. They keep their final values through the results screen
  until the next match starts.
- **CQ44** The room keeps the zone step in one method, `conquerTick()`, called from `tick()`
  after `runPipeline` and only when `winRuleOf(mode) === "conquer"`. The `winRuleOf` check at
  `tick()`'s win block dispatches to it, the same way `checkDeathmatchEnd` is dispatched today.

## 10. Camera and view

- **CQ45** A 1280-wide arena on a 1280-wide viewport already follows vertically only: the bounds
  clamp pins `scrollX` to 0. No code change is needed for "the camera only moves up and down".
  Field of vision equals the viewport, and there is no fog of war. An enemy off-screen is simply
  not drawn, as today.
- **CQ46** **Team B's world camera is rotated 180°** (`setRotation(Math.PI)`) in a team mode whose
  arena declares `flipForTeamB: true`. Only arena-03 declares it. The HUD camera is never rotated.
  The rotation is set when the arena is drawn and re-applied whenever the local player's `team`
  changes. Team A's view is unrotated. The helper is `viewRotationFor(arena, sides, team)` in
  `scenes/`. Rotation is about the viewport centre, which equals the follow target, and the bounds
  clamp is unaffected at 180°.
- **CQ47** Anything in world space that is drawn relative to the **screen** has to follow the view
  rotation, or it reads upside down for Team B. The survey found three:
  1. The countdown/respawn **self-arrow**: `countdownArrowPoints` gains a view-rotation argument and
     mirrors its offset and apex, so it sits above the car pointing down on screen for both teams.
  2. **Car lighting's world-fixed light angle**: rotated by the view rotation, so the light comes
     from screen-left for both teams.
  3. The **dormant turret aim path**: `cssDeltaToWorld` and `projectToScreen` take the view
     rotation. There is no turret on this build, but the path must be correct when one returns.

  `panCamera` (free-roam spectate) is unreachable in Conquer (CQ15) and stays as is.
- **CQ48** Keyboard driving is car-relative (tank steering), so it needs no change under rotation.

## 11. Rendering

- **CQ49** Procedural **spike strips**. Today an arena without floor art draws no spikes at all:
  `drawableObstacles` drops every `kind` obstacle. With this change, art-less arenas draw each spike
  obstacle as a dark strip with a row of teeth pointing into the playable area, in
  `SPIKE_VISUAL`-style constants in `arena-visual.ts`. Arenas with floor art are unchanged.
- **CQ50** Procedural **chamfer corners**. An art-less arena with a `boundary` fills the region
  between the frame rect and the boundary polygon in the palette's border colour, and strokes the
  boundary itself. Today the rect border is drawn instead. For arena-03 that region is the four
  corner triangles. Arenas with floor art are unchanged.
- **CQ51** The **painted markings'** centre circle is skipped on an arena that has a `zone`, because
  the zone ring replaces it. The dashed centre line stays.
- **CQ52** The **zone ring** is a world-space `Graphics` in `worldObjects`, drawn above the floor and
  markings and below cars: a translucent disc (alpha 0.14) and a 5 px ring at the zone radius. Its
  colour comes from the viewer's allegiance to the holder:
  - **green** (ally hp colour) while the viewer's team is the holder, whether counting down or in
    control
  - **red** (enemy hp colour) while the enemy team is the holder
  - **white** while contested or empty

  It is redrawn only when that colour changes.
- **CQ53** Health bars: `ArenaScene` passes `sidesOf(mode)` to `allegianceOf` instead of collapsing
  on `GameMode.TEAM` (CQ16). Teammates turn green, enemies red, and ram sparks stop firing between
  teammates.

## 12. The gutter HUD in Conquer

- **CQ54** Layout, in 144 × 720 screen space, all on the HUD camera, all in the gutter:
  1. **Control panel**, at the top, height `CONTROL_PANEL_H`:
     - the clock (`m:ss`, or `OVERTIME` once `overtime` is set)
     - an ally bar and an enemy bar, each with its label (`US` / `THEM`) and its percentage (CQ3)
     - a one-line capture status chip (CQ55)
  2. **Weapon slots and status strip**, laid out by the existing `slotBarLayout` /
     `statusStripLayout` with `topInset = CONTROL_PANEL_H`
  3. **Roster**, anchored to the **bottom**, grouped as a `YOUR TEAM` header (ally green) with that
     team's rows, then an `ENEMY` header (enemy red) with theirs. A dead row greys out and shows its
     respawn seconds (`name · 3`).

  A pure `conquerGutterLayout(...)` returns every y. Its test asserts no overlap and nothing past
  720 at the worst case: six players, the maximum status rows `statusStripLayout` reserves, and the
  build's `maxFireSlots`.
- **CQ55** Status chip text, viewer-relative:
  - `TAKING CONTROL · n` (green) while the viewer's team is holder and `streak < D`
  - `ENEMY CAPTURING · n` (red) for the enemy (user's wording, 2026-09-24; it replaced
    "ENEMY TAKING CONTROL · n", which needed 9 px text to fit and was unreadable)
  - `HOLDING` (green) / `ENEMY HOLDING` (red) once in control
  - `CONTESTED` (white) when contested
  - `ZONE EMPTY` (muted) otherwise

  `n = ceil((D − streak) / TICK_RATE_HZ)`, which counts 5…1.
- **CQ56** In Conquer the top-centre match-clock banner over the arena is **not** drawn, because the
  clock lives in the control panel. Deathmatch's banner is unchanged. The centre-screen "Respawning
  in N" and "killed by" texts still show while the viewer is dead. They sit over the viewer's own
  wreck, and they are the same texts Deathmatch shows.
- **CQ57** Other modes' gutter layout is byte-for-byte unchanged. The Conquer layout is selected by
  `winRuleOf(mode) === "conquer"`.

## 13. Results

- **CQ58** The results screen in a conquer-rule mode adds one line under the title, viewer-relative
  like the title: `Control — You 42.52% · Them 18.06%`, read from the final `controlTicksA/B`.

## 14. Harnesses, docs and publishing

- **CQ59** `npm run balance -- --mode=conquer` **refuses** the run, naming the reason: bots cannot
  play an objective mode. Its match loop would otherwise score Conquer as last-standing. `ttk` and
  `playtest` accept the mode (they measure tables and the sim, not the win rule). `cli.test.ts`'s
  hard-coded mode list gains Conquer as a refusal case.
- **CQ60** Docs owed:
  - `docs/turn-tuning.md`: a `## Conquer` section (tables identical to Deathmatch's)
  - `npm run build:manual`: the guide gains a Conquer tab
  - `docs/config-reference.md`: `CONQUER_CONFIG` and the `zone` field
  - `docs/schema-reference.md`: the new fields
  - `docs/combat-model.md`: the win rule
  - root `CLAUDE.md`: table and accessor counts, and the new mode
  - the `game-mode` skill's counts
- **CQ61** Publishing: authored with `isActive: false` first, and flipped to `true` in its own final
  commit, together with the lobby card, the manual rebuild, the turn-tuning section, and the
  registry test updates (`activeGameModes()`, `mode-arg`'s option list).
- **CQ62** Playtest duty (root CLAUDE.md): this change moves no existing mode's sim. It adds a mode,
  an arena, and respawn-point selection for team modes (Team brawl never respawns, so nothing moves
  there). The summary must still say this loudly and recommend `npm run playtest -- --mode=conquer`,
  without running it.

## Out of scope

Bots, practice, playground, minimap or off-screen indicators, fog of war, team kill scoring, a
left-hand gutter, floor art for arena-03, and moving Deathmatch's clock banner off the arena.
