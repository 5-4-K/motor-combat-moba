# Match Readability and Controls — Implementation Plan

> **For agentic workers:** implement this plan task-by-task, in order. Each task is independently green: run the verification block before moving on. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a match legible — mark your own car during the countdown, colour HP bars by allegiance, list the roster in the right gutter, accept WASD, move the powers to J/K/L, shrink `bulwark` by a fifth, put ability zones under the cars, and turn the beam fade into a fast cut at the end of life.

**Architecture:** Eight tasks in strict order. Task 1 is the only shared-package change and lands first so every later build reads a settled `WEAPON_TABLE`. Tasks 2–5 are small, independent client changes to existing files. Task 6 is the largest — it adds the roster panel and re-budgets the whole gutter, and it depends on nothing before it except being last among the layout work. Task 7 adds the countdown arrow into the camera seam Task 2 already corrected. Task 8 is the doc sweep and full verification.

Every new behaviour is extracted as a **pure function in its own module with its own test**, following the shape `weapon-hud.ts`, `status-hud.ts` and `combat-visual.ts` already use: pure layout and pure decisions are testable in Node with no canvas, and `ArenaScene` stays a wiring layer that owns Phaser objects and nothing else.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared` → `server` → `client`), Vitest for the three package suites, `node --test` for `scripts/*.test.mjs`.

**Spec:** [`docs/superpowers/specs/2026-08-30-match-readability-and-controls-design.md`](../specs/2026-08-30-match-readability-and-controls-design.md) (decisions D1–D17)

---

## Global Constraints

- **Build with root `npm run build`, never `npm run build --workspaces`.** The server's tsup step inlines shared's `dist`; only the root script enforces shared → server → client ordering.
- **After editing shared, rebuild it** before anything downstream reads it. Root `npm test` does this first.
- **Verify with root `npm test`.** Per-workspace runs silently skip suites.
- **This plan adds no schema field and touches no file under `packages/shared/src/sim/`.** If a change reaches either, stop — it has left the spec.
- **`golden.test.ts` must pass unchanged, at every task.** It is the tripwire for the line above.
- **No magic numbers in logic.** Every number this plan introduces is a named `const` with a comment saying what it is spending against.
- **Enum uint8 values are explicit and stable; never renumber.** None are touched here.
- Max 6 players (`MAX_PLAYERS`); import it, never write `6`.
- **`docs/ideas/` and `docs/invariants/` are off limits.** Never read, cite, grep, or edit them.
- **Branch is `feature/roster-types`.** "main" would mean `development/main`; never `master`.
- **Do not run `npm run playtest`.** Task 1 flags a stale probe; running it is the user's call.
- **Do not touch `packages/server/`.** Nothing in this plan is server-side.
- Phaser must not be imported by a `.ts` file that a Node test imports — its device detection runs at module load and crashes the suite. Key codes are written as bare numbers (`slot-keys.ts` documents this); pure modules take plain numbers and objects, never Phaser types.

### The camera rule — copy verbatim into any new object

`splitCameras` keeps two `ignore` lists. **Every object in the scene must be ignored by exactly one camera.** Ignored by neither, it draws twice (once clipped into the arena viewport, once unclipped across the whole canvas). Ignored by both, it vanishes. HUD objects (`setScrollFactor(0)`, gutter-space) go in `hudObjects`; world objects go in `worldObjects`.

### The gutter budget (D12) — copy verbatim

```
ROSTER_ROW_HEIGHT_PX   18      ROSTER_ROW_GAP_PX      2
ROSTER_PAD_TOP_PX      10      ROSTER_PAD_BOTTOM_PX  10

panel (6 rows)   10 + 6*18 + 5*2 + 10             = 138
slot stack       3*64 + 2*28                      = 248
slot top         138 + (720 - 138 - 248) / 2      = 305
strip bottom     305 - 16                         = 289
strip height     6*24 - 4                         = 140
strip top        289 - 140                        = 149   -> 11 px clear of the panel
```

---

## File Structure

```
packages/shared/src/config/weapon-config.ts        Task 1  bulwark range/speed
packages/client/src/scenes/combat-visual.ts        Task 3  beamFadeAlpha; Task 4 allegianceOf, hpBarColor
packages/client/src/scenes/combat-visual.test.ts   Task 3, 4
packages/client/src/config/slot-keys.ts            Task 5  J/K/L
packages/client/src/config/slot-keys.test.ts       Task 5
packages/client/src/scenes/roster-panel.ts         Task 6  NEW  rosterRows, rosterPanelLayout
packages/client/src/scenes/roster-panel.test.ts    Task 6  NEW
packages/client/src/scenes/weapon-hud.ts           Task 6  slotBarLayout topInset
packages/client/src/scenes/weapon-hud.test.ts      Task 6
packages/client/src/scenes/countdown-arrow.ts      Task 7  NEW  countdownArrowPoints, arrowBobOffset
packages/client/src/scenes/countdown-arrow.test.ts Task 7  NEW
packages/client/src/scenes/ArenaScene.ts           Tasks 2-7  wiring only
docs/                                              Tasks 1, 8
packages/client/public/manual.html                 Task 1  regenerated, never hand-edited
```

---

## Task 1: Shrink `bulwark` by 20% of its area

**Spec:** D6. Area of a cone is `½·r²·θ`; 20% comes off range, not angle, so the zone stays a zone rather than becoming a line. `speed` moves with `range` so it still grows out over exactly one second.

- [ ] In `packages/shared/src/config/weapon-config.ts`, in the `bulwark` row **only**:
  - `speed: 550` → `speed: 492`
  - `range: 550` → `range: 492`
- [ ] Change nothing else on the row. `damage` 35, `damageFrequencyMs` 400, `cooldownMs` 15000, `recoveryMs` 200, `lifetimeMs` 2875, `hitbox.angleDeg` 60 and both `applies` entries all stay. `√0.8 = 0.8944`, and `550 × 0.8944 = 491.9`, rounded to 492.
- [ ] Update the row's doc comment above the definition. It currently reads that `range` and `speed` "both rise 10% together (500 -> 550), so the zone is 10% bigger and still takes exactly one second to grow out". Rewrite that sentence to record the new number and *why* it is range and not angle (D6), keeping the "one second to grow out" invariant explicit — it is the reason the two fields move together and the next person to re-tune needs to know it.
- [ ] `npm run build -w @motor-combat-moba/shared`
- [ ] `npm run build:manual` — required, not optional. `balanceStamp` hashes `WEAPON_TABLE` whole, so these two fields move it and `scripts/manual-page.test.mjs` fails until the page is regenerated. **Never hand-edit `manual.html`.**
- [ ] Update `docs/config-reference.md`: the `bulwark` row of the weapon table, columns `speed` and `range`, `550` → `492` in both.
- [ ] Search the docs for any prose quoting bulwark's reach (`grep -rn "550" docs/*.md`) and fix what is now wrong. **Exclude `docs/ideas/` and `docs/invariants/`.**

**Verify:**
```bash
npm run build -w @motor-combat-moba/shared && npm run build:manual && npm test
npm run ttk    # must print the same matrix as before: no damage number moved
```

**Flag in the task summary (do not act on):** `packages/server/playtest/geometry.ts:267` measures beam reach for `bulwark` by name; its numbers are stale at 492. Name the probe, name the number, recommend `npm run playtest`. Fix it only if it stops compiling — it should not, since no type changed.

---

## Task 2: One draw-order rule — every weapon instance under every car

**Spec:** D7, D13, D15. Also corrects `lockGfx`, which is registered with neither camera today and therefore double-draws.

- [ ] In `ArenaScene.ts`, in the depth constant block (currently around lines 97–135), make the stack explicit and ordered. Add `CAR_DEPTH = 0` with a comment saying the cars were previously on Phaser's implicit default and that the default became load-bearing the moment instances moved below it. Add `ARROW_DEPTH = 52` now (Task 7 uses it) with a comment: above cars so it is never hidden, below `LOCK_DEPTH`/`HP_BAR_DEPTH` so it never occludes a bar or bracket.
- [ ] Change `SHOT_DEPTH` from `50` to `-5`. Keep the name — it is still every instance. Replace its comment with the spec's rule and its accepted cost: one rule for all instances, so a projectile crossing behind a car is briefly hidden by it; split it later only if play says the hidden projectile matters more than the simplicity (D7).
- [ ] In `drawCar`, `container.setDepth(CAR_DEPTH)` before returning it.
- [ ] In `splitCameras`, add `lockGfx` to `worldObjects` (D13). It draws in world space at `LOCK_DEPTH`; without this it renders once clipped in the arena viewport and once unclipped over the gutter.
- [ ] Re-read `splitCameras`'s docstring and confirm every object created in `create()` now appears in exactly one list.

**Verify:**
```bash
npm test
```
No test asserts a depth today; the change is verified by build + suite green, and by the browser check in Task 8. Do **not** invent a depth test that pins Phaser internals.

---

## Task 3: The beam fade becomes a fixed window ending at the death tick

**Spec:** D8. Today the fade window is the entire lifetime; it becomes `BEAM_FADE_OUT_MS`, anchored to the end.

- [ ] Move `beamFadeAlpha` out of `ArenaScene` and into `combat-visual.ts` as an exported pure function, so it can be tested. Current implementation is `ArenaScene.beamFadeAlpha` (a private method around line 1225). New signature — plain numbers and strings only, no Phaser and no schema type:
  ```ts
  export function beamFadeAlpha(
    kind: number,          // WeaponKind, from the instance
    weaponId: string,
    spawnTick: number,
    tick: number,
  ): number
  ```
- [ ] Add `export const BEAM_FADE_OUT_MS = 100;` beside it. Its comment must say: one rule for all four beams; it is the fade *window*, anchored to the death tick, not to the start of linger; `lifetimeMs` is deliberately untouched so the damage window never moves; and 0 gives a hard cut.
- [ ] The rule, given `ticks = weaponTicksOf(weaponId)`:
  - not `WeaponKind.BEAM`, or not a known `weaponId` → `1`
  - `ticks.lifetime <= 0` → `1`
  - death tick `D = spawnTick + ticks.flight + ticks.lifetime` (this is exactly `expired`'s boundary in `sim/weapons/instances.ts:248`, `tick - spawnTick >= flight + lifetime`)
  - `fadeTicks = Math.min(msToTicks(BEAM_FADE_OUT_MS), ticks.lifetime)` — **clamped**, so a window longer than the linger can never start the fade before the beam is fully grown
  - `fadeTicks <= 0` → `1` (hard cut)
  - `remaining = D - tick`; `remaining >= fadeTicks` → `1`; else `Math.max(0, remaining / fadeTicks)`
- [ ] `msToTicks` is exported from shared (`config/weapon-ticks.ts`) — import it, do not re-derive the ms→tick rounding.
- [ ] In `ArenaScene.renderShots`, call the imported function with `instance.kind`, `instance.weaponId`, `instance.spawnTick`, `room.state.tick`. Delete the private method.
- [ ] Tests in `combat-visual.test.ts`: alpha is 1 through growth and through all but the last window; it ramps down across the window; a projectile is always 1; an unknown weapon id is always 1; `fadeTicks` clamps when the window exceeds the lifetime; the value at the last drawn tick (`remaining === 1`) is above 0, so nothing draws at alpha 0.

**Verify:**
```bash
npm test
```

---

## Task 4: HP bar colour becomes allegiance

**Spec:** D1, D2, D10. Colour says whose side; length keeps saying how hurt.

- [ ] In `combat-visual.ts`, add:
  ```ts
  export type Allegiance = "ally" | "enemy";
  export function allegianceOf(
    viewer: { sessionId: string; team: number },
    subject: { sessionId: string; team: number },
    mode: "ffa" | "team",
  ): Allegiance
  ```
  Rules: same `sessionId` → `"ally"` in both modes; `mode === "team"` and equal `team` → `"ally"`; otherwise `"enemy"`. It takes the viewer explicitly so allegiance can never follow the spectate camera (D2) — put that reason in the doc comment.
- [ ] **Replace** `hpBarColor(fraction: number)` with `hpBarColor(allegiance: Allegiance)`. Do not keep the fraction parameter. Named constants: `HP_BAR_ALLY = 0x49c46a` (the existing healthy green) and `HP_BAR_ENEMY = 0xd94040` (the existing critical red) — reusing the shipped hexes keeps the palette unchanged while the meaning changes.
- [ ] The doc comment must record what was given up and why: the amber/red low-health warning is gone, because length already carries health and colour was spending its one channel saying the same thing twice (D1). Note explicitly that there is no exception for your own car — a rule with one exception has to be taught (D1).
- [ ] In `ArenaScene.drawHpBar`, take the allegiance as a parameter rather than computing it per bar. In `renderCars`, derive once per frame:
  - `viewer = room.state.players.get(room.sessionId)` — the local player, **not** `cameraTarget(room)`;
  - `mode = room.state.mode === GameMode.TEAM ? "team" : "ffa"` — the same derivation `renderCars` already makes for the impact spark, a few lines below; hoist it so there is one expression, not two that can drift.
  - When `viewer` is absent (a pure spectator who never joined), fall back to `"enemy"` for every car — nobody is your ally if you have no seat.
- [ ] Rewrite the three `hpBarColor` tests in `combat-visual.test.ts` (currently lines 52–67) for the new signature: ally and enemy are different colours; the same allegiance always gives the same colour; and there is no fraction-dependent behaviour left to assert.
- [ ] Add `allegianceOf` tests: self is ally in `ffa` and in `team`; a teammate is ally only in `team`; an opponent is enemy in both; a dead viewer's allegiance is unchanged (pass the same viewer, assert the same answer).

**Verify:**
```bash
npm test
```

---

## Task 5: WASD steers, and the powers move to J / K / L

**Spec:** D5, D16.

- [ ] In `packages/client/src/config/slot-keys.ts`, replace the `SLOT_KEYS` rows with J / K / L. `KeyboardEvent.keyCode` values: **J = 74, K = 75, L = 76**. Glyphs are `"J"`, `"K"`, `"L"`.
- [ ] Keep the module's existing rule about writing bare numeric key codes rather than importing `phaser` — that comment is why this file is testable, do not remove it. Update the worked examples in it (`SPACE 32, Q 81, E 69`) to the new codes so the comment does not describe keys the table no longer holds.
- [ ] Add a sentence recording that Space / Q / E were removed rather than kept as hidden alternates, because an undocumented second binding breaks quietly later and Q/E are keys a future feature will want (D5).
- [ ] Note in the comment that the glyph column got narrower — a single letter where `"space"` used to be. **Do not** shrink `SLOT_KEY_COLUMN_PX` or `HUD_GUTTER_WIDTH` in this task: `weapon-hud.test.ts` asserts the gutter holds the key column, Task 6 is about to spend the gutter's vertical budget, and changing its width here would tangle two unrelated changes. Leave the slack; say in the comment that it is now slack.
- [ ] In `ArenaScene.create()`, add a WASD key set alongside `this.cursors`, e.g. `this.driveKeys = keyboard?.addKeys({ up: 87, left: 65, down: 83, right: 68 })` — or four `addKey` calls, matching whatever the file already does. Clear it in the same teardown block that sets `this.cursors = undefined` (around line 712).
- [ ] In `sendInputTick`, OR the two sets into the existing `axisOf` calls:
  ```ts
  steer:    axisOf(left.isDown || aKey.isDown, right.isDown || dKey.isDown),
  throttle: axisOf(down.isDown || sKey.isDown, up.isDown || wKey.isDown),
  ```
  Keep the existing `?? false` guards — `input.keyboard` is optional and every read must survive it being absent.
- [ ] **Do not change `axisOf`.** Its "both directions down means zero" rule is exactly what makes ORing two key sets safe: holding `A` and `Right` is the same situation as holding `Left` and `Right`, and it already answers 0. Add a line to its doc comment saying two key sets now feed it and this is why that is sound.
- [ ] Leave the spectator pan keys (`panLeft`/`panRight`/`panUp`/`panDown`, already W/A/S/D) untouched. Free roam is only reachable once you are dead and have no car to drive, so there is no conflict (D5).
- [ ] Update `slot-keys.test.ts` for J/K/L. `slotMaskFrom` is unchanged; keep its tests as they are.

**Verify:**
```bash
npm test
```

---

## Task 6: The roster panel, and the gutter re-budget it forces

**Spec:** D3, D11, D12. The largest task. The panel is the easy half; the coupling to the status strip is the half that breaks if rushed.

**Read first:** `weapon-hud.ts` (`slotBarLayout`), `status-hud.ts` (`statusStripLayout` and its docstring), `config/display.ts`. The status strip is **bottom-aligned to the slots' top edge and grows upward**, so moving the slots moves the strip.

### 6a — the pure module

- [ ] Create `packages/client/src/scenes/roster-panel.ts`.
- [ ] `RosterRow`: `{ sessionId: string; name: string; colorId: number; alive: boolean }`.
- [ ] `rosterRows(players, ...)` — takes a plain array (the caller flattens the `MapSchema`), returns the rows to draw:
  - include only `status === PlayerStatus.IN_MATCH`; alive and dead both;
  - sort **team, then `joinedAtTick`, then `sessionId`** — stable and derived, never insertion order. A row that jumps when someone dies is worse than no panel; `joinedAtTick` is already networked for exactly this kind of tie-break (D11). In FFA everyone is team 0, so it degrades to join order.
  - cap at `MAX_PLAYERS`, imported from shared.
- [ ] `rosterPanelLayout(count, viewWidth, gutterWidth)` — pure, mirroring `slotBarLayout`'s shape. Returns per-row boxes (swatch rect and label anchor) plus the panel's total height, which is what Task 6b feeds back as `topInset`. Constants exactly as the gutter budget above: `ROSTER_ROW_HEIGHT_PX 18`, `ROSTER_ROW_GAP_PX 2`, `ROSTER_PAD_TOP_PX 10`, `ROSTER_PAD_BOTTOM_PX 10`, plus a swatch size and a gap to the label. Every one carries a comment saying it is spending against the shared budget.
- [ ] Zero players returns an empty list and **height 0**, so a pre-reveal or spectator frame leaves the slots exactly where they are today.
- [ ] Names truncate to the label column with an ellipsis. `HUD_GUTTER_WIDTH` does not change (D12) — measuring text needs a canvas, so truncate by character budget in the pure function, the same way `SLOT_KEY_COLUMN_PX` is a reserved budget rather than a measurement.
- [ ] `roster-panel.test.ts`: ordering is team → `joinedAtTick` → `sessionId`; dead rows are present and flagged; non-`IN_MATCH` players are excluded; the list caps at `MAX_PLAYERS`; rows fit inside `gutterWidth`; row pitch is constant; 0 players gives height 0.

### 6b — the gutter re-budget

- [ ] `slotBarLayout` gains a **`topInset` parameter** and centres the slots in `viewHeight - topInset` starting at `topInset`, instead of centring in the whole `viewHeight`. Its docstring already explains why the slots live in the gutter; add why they are now inset, and that `statusStripLayout` follows for free because it derives from `slotBarLayout(...)[0].y`.
- [ ] Update the one production call site (`ArenaScene.ts:1315`) to pass the panel height. Update `weapon-hud.test.ts`'s two call sites (lines 149, 199) to pass `0` and keep asserting today's geometry — with inset 0 the function must be byte-identical in behaviour to what it is now, and that is the regression guard.
- [ ] Add a `slotBarLayout` test with a non-zero inset: slots start below the inset, stay centred in the remainder, and the stack's height is unchanged.
- [ ] **Add the worst-case overlap test** (this is the point of D12). Six players, six badges (`STATUS_CONFIG.maxActive`), three slots (`WEAPON_SLOT_CONFIG.maxWeaponSlots`): compute the panel, feed its height to `slotBarLayout`, feed `[0].y` to `statusStripLayout`, and assert the strip's top is **at or below the panel's bottom** and the strip's bottom is at or above the slots' top. It should clear by 11 px at the shipped constants. This test is what makes a later nudge to `ROSTER_ROW_HEIGHT_PX` fail loudly instead of sliding a badge under a name.

### 6c — the wiring

- [ ] In `ArenaScene`, add a fixed pool of `MAX_PLAYERS` `Text` objects built once in `buildHudTextPool` (never per frame).
- [ ] **Give the roster its own `rosterGfx`** for the swatches — `this.add.graphics().setScrollFactor(0).setDepth(HUD_BOX_DEPTH)` — rather than reusing `hudGfx`. `hudGfx` is `clear()`ed at the top of `renderWeaponHud`, so drawing roster swatches into it from a different method creates a silent ordering dependency where whichever method runs second erases the first. A second `Graphics` costs one draw call and removes the trap entirely.
- [ ] **Add the new `Text` pool and `rosterGfx` to `hudObjects` in `splitCameras`**, and destroy `rosterGfx` in the teardown block — the camera rule above.
- [ ] Per frame: rows from `rosterRows`, boxes from `rosterPanelLayout`, then show/hide from the pool. Swatch fill is `carFillOf(player.colorId)` (from `car-visual.ts`) — reuse it, do not re-parse `COLOR_TABLE`.
- [ ] **The panel height must be computed once per frame and shared with `renderWeaponHud`.** Note the asymmetry: the roster lists every `IN_MATCH` player, but `renderWeaponHud` lays its slots out for `hudTargetPlayer(room)` — the *spectated* car, which is not always the local one. The inset therefore comes from the roster's row count and never from the HUD target. Compute it once (a small private helper, or a field set at the top of the frame) and pass it to both, so the two can never disagree about where the panel ends.
- [ ] Dead rows grey out: one named `ROSTER_DEAD_TEXT` colour and one named `ROSTER_DEAD_SWATCH_ALPHA`, so "greyed" is two constants rather than a scattering of literals. Alive rows keep the live text colour.
- [ ] Destroy the pool in the same teardown block as the other pools (around lines 699–705) and reset the array, exactly as the existing pools do.

**Verify:**
```bash
npm test
```

---

## Task 7: The countdown arrow

**Spec:** D4, D14. Depends on Task 2, which already added `ARROW_DEPTH` and fixed the camera seam.

- [ ] Create `packages/client/src/scenes/countdown-arrow.ts` with two pure functions:
  - `arrowBobOffset(nowMs: number): number` — bounded, periodic, frame-rate independent. Named constants for amplitude and period.
  - `countdownArrowPoints(x, y, bobOffset)` — the triangle's three points in **world** coordinates, apex pointing **down** at the car, always screen-up in orientation. It takes no car angle: the marker's only sentence is "this one", and rotating it would make it say something about heading, which is the car's own job (D4). Named constants for width, height, and the gap between the apex and the car's top.
- [ ] The camera does not rotate, so world-up is screen-up; say so in the module comment, since that is the assumption the "no angle parameter" signature rests on.
- [ ] In `ArenaScene.create()`, add `this.arrowGfx = this.add.graphics().setDepth(ARROW_DEPTH)`. **Add it to `worldObjects` in `splitCameras`** — it draws in world space, so it must be ignored by the HUD camera (the camera rule). Destroy it in the teardown block beside `hpGfx`/`lockGfx`.
- [ ] Draw it in the render loop, cleared and refilled each frame like `hpGfx` — one `Graphics`, not a container per car and not a tween (a tween would have to be cancelled on the phase flip; `performance.now()` does not).
- [ ] Gate on **both** conditions (D14): `room.state.phase === RoomPhase.COUNTDOWN` **and** the local player exists with `status === PlayerStatus.IN_MATCH`. Phase alone is not enough — someone who joined mid-countdown and is not in the match has no car to point at.
- [ ] Anchor to the same render pose `renderCars` computes for the local car, not to the raw server pose, so the arrow does not lag the predicted car it is marking.
- [ ] The instant the phase leaves `COUNTDOWN` the arrow is gone: `clear()` and draw nothing. No fade, no tween (D4).
- [ ] `countdown-arrow.test.ts`: the triangle is screen-up for any car angle passed alongside it (assert the points do not depend on angle); the apex sits below the other two points and above the car's centre; the bob is bounded by its amplitude and is periodic; the points translate with `x`/`y`.

**Verify:**
```bash
npm test
```

---

## Task 8: Docs, and full verification

- [ ] `docs/combat-model.md` — the HP-bar paragraph (around line 818). It currently says living cars carry a bar scaled to their chassis maximum and that "a wreck fades to `WRECK_ALPHA`". `WRECK_ALPHA` **does not exist** — the wreck fade is `deathFadeAlpha` over `DEATH_FADE_MS` and the car is then not drawn at all. Fix both: the stale constant, and the new allegiance rule (green ally, red enemy, length is the only health channel).
- [ ] `docs/combat-model.md` — add a sentence where instance drawing is described: every live instance now draws **below** the cars, one rule for projectiles and beams alike; and the beam fade is a fixed `BEAM_FADE_OUT_MS` window ending at the death tick rather than a ramp across the whole lifetime.
- [ ] `docs/project-structure.md` — add `roster-panel.ts` and `countdown-arrow.ts` to the client tree, in the style of the surrounding lines. Update the `slot-keys.ts` line if it names the keys.
- [ ] Search for controls prose that is now wrong: `grep -rn "Space\|WASD\|arrow keys" docs/*.md packages/*/CLAUDE.md README.md` — **excluding `docs/ideas/` and `docs/invariants/`**, and ignoring `docs/superpowers/plans/` and `docs/superpowers/specs/`, which are historical records and must not be back-edited.
- [ ] Confirm `docs/config-reference.md` and `manual.html` were both handled in Task 1.
- [ ] Root `CLAUDE.md`: leave it alone unless something in it is now false. Do not add a section for this work — it indexes docs, it does not carry per-feature detail.

**Verify:**
```bash
npm run build          # root, ordered: shared -> server -> client
npm test               # all three suites plus the script tests
npm run ttk            # unchanged matrix
npm run check:art      # unchanged; no art moved
```

**Then verify in a browser** — five of these nine changes have no unit-testable surface, and the suite cannot see any of them:

```bash
npm run dev            # then open http://localhost:5173
```

- [ ] Countdown: an arrow bobs over **your** car and no other, and is gone the instant the match starts.
- [ ] HP bars: yours and your teammates' green, enemies' red, at full health and at a sliver alike. In FFA every other car is red.
- [ ] Right panel: every player listed with their colour; a dead player greys out and stays listed.
- [ ] Gutter: with six players and statuses active, the panel, the badge strip and the three weapon slots do not overlap.
- [ ] Controls: WASD drives, arrows drive, J/K/L fire, and Space/Q/E do nothing.
- [ ] Drive into your own `bulwark` and into an `afterburner` cone: the car is drawn **over** the zone.
- [ ] Watch a `bulwark` expire: full opacity to the last moment, then a fast cut, with the visual and the hitbox ending together.
- [ ] Lock a target: the bracket draws **once**, in the arena, and not a second time over the gutter (Task 2's `lockGfx` fix).

**Report in the summary:** the `bulwark` reach change and the stale `packages/server/playtest/geometry.ts` probe, with a recommendation to run `npm run playtest`.
