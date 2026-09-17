# Bigger cars (1.25x hull) — design

**Date:** 2026-09-16
**Status:** approved (revised 2026-09-17 from 1.5x to 1.25x — see §12)
**Branch:** `feature/bigger-cars`
**Clauses:** BC1–BC39

## 1. What this changes, and why

Every car in the game shares one hull, `DRIVE_CONFIG.carWidth` × `carHeight` = **48 × 32** world
units. The user previewed cars drawn 1.5x larger in the playground — a console-only scale of each
car's `Container`, with the sim untouched — liked how the game felt, and asked to ship it. Playing
the shipped 1.5x hull then read as **too** large against arenas that did not grow, so the factor was
revised down to **1.25x** (§12).

**BC1.** What ships is the **real hull**, not the drawing: `carWidth` 48 → **60**, `carHeight`
32 → **40**. What a player sees is what collides, rams, touches spikes and gets hit. A sprite drawn
1.25x over an unchanged hitbox was rejected: shots would visibly pass through a car's outer edge and
cars would appear to overlap before they touch, which reads as a bug.

**BC2.** The arenas do **not** grow. Both stay 1280 × 720 with their current boundaries and spike
strips, so the field is relatively more crowded. That is the feel the preview showed.

### 1.1 What does not change

- **Weapon balance.** No `WEAPON_TABLE` row, `CAR_TABLE` rating or `COMBAT_CONFIG` value moves. A
  bigger target is easier to hit, so real hit rates will rise; that is measured afterwards with the
  balance harness (BC31), not guessed at in advance.
- **Aim assist.** `AIM_CONFIG`'s absolute-unit knobs (`retentionLateralUnits` 30,
  `retentionRangeUnits` 60, `scorePerDistanceUnit`) are left alone.
- **Camera.** `CAMERA_CONFIG.zoom` stays 1.
- **Arena geometry.** Boundaries, spike strips, `SPIKE_CONFIG` (depth 20, damage, trigger speed)
  are unchanged. Only FFA spawn points move (§4).
- **The hitbox model.** Still one OBB per car, one size for every chassis. This is a dimension
  change, not a model change. Per-chassis hull sizes are out of scope.
- **`dashSubstepMaxUnits`** stays 16 (BC11).
- **Historical specs and plans** under `docs/superpowers/` that quote 48 × 32 are records of their
  time and are not rewritten.
- **`BOT_PROFILES`.** Not retuned by this work (BC19).

## 2. The hull

**BC3.** `DRIVE_CONFIG.carWidth: 60` and `carHeight: 40` in
`packages/shared/src/config/drive-config.ts`. The 3:2 aspect ratio is preserved exactly.

**BC4.** No reader of the hull gains a typed number. Every sim, client, bot and script reader
already derives from `DRIVE_CONFIG` — `carHullOf`, the boundary clamp, `contactPointOn`'s lever
clamp, `RAM_CONFIG.inertiaCoefficient`, `muzzleOffset`, the bot's margins and aim subtense, the
client's shadow, occlusion, decals, lock bracket and contact FX, the car-select "Hull size" row, and
the art importer. The dimension change is the only logic edit this section needs.

**BC5.** Derived values that move with it, for reference: half-length 24 → 30, half-width 16 → 20,
diagonal 57.7 → 72.1, half-diagonal 28.8 → 36.1, `inertiaCoefficient` 277.33 → 433.33, muzzle offset
24 → 30, sprite width 96 → 120 px.

## 3. Ram spin

**BC6.** Spin injected by a ram is `torque / (ramDefence × inertiaCoefficient) × spinScale`. At a
1.25x hull the maximum lever arm grows 1.25x and `inertiaCoefficient` grows 1.5625x, so every ram
would spin its victim **0.8x** as hard. Straight-line push is unaffected (`pushOf`/`impactOn` never
read the hull).

**BC7.** Compensate: `RAM_CONFIG.spinScale` 10 → **12.5**. For any ram whose contact geometry scales
with the hull, 1.25 × 1.25 / 1.5625 = 1, so the spin a player feels is **identical** to today. This
keeps the change about size, not handling. Stage 5 of the car-physics rework still owns the real
re-pitch of `spinScale`/`globalScale`; this edit hands it an unchanged spin budget.

**BC8.** The hardest-ram figure (Bastion flanking a stationary Bullseye at top speed, maximum lever)
must still read **4.4975 rad/s**. Its fixture in `ram-config.test.ts` moves to the new maximal-lever
geometry (attacker at `(30, -37.5)`, recovered local contact `(30, -20)`) and its hand derivation is
rewritten with 30 u, 433.33 and 12.5. `spinScale`'s doc comment is updated to match: the lever column
reads 5 / 15 / **30 u (clamped max)**, and the values in the table are unchanged by construction.
The "pins the authored knobs" assertion becomes `spinScale` 12.5, and the comment says why it moved.

**BC9.** Every other ram/contact fixture that places cars by hand at 48 × 32-relative offsets scales
those offsets by 1.25 (or derives them from `DRIVE_CONFIG`), so its hand-derived expectation is
unchanged. `ram.test.ts`'s "ordinary flank ram spin" fixture is the model: attacker `(12, -30)` →
`(15, -37.5)`, lever 12 → 15, and the 1.0283 rad/s derivation still holds.

## 4. Arenas

**BC10.** `arena-01.test.ts` and `arena-02.test.ts` require every spawn to clear every spike strip
by more than a car diagonal (now 72.1). Measured against the original tables, `arena-02`'s FFA rows
**fail outright** (69 u, inside the diagonal) and `arena-01`'s corners **pass by under four units**
(76 u); team spawns clear by 106–122 u and already pass. The FFA rows move inward so each row stays
level and every FFA spawn clears by about 106 u, matching the team spawns — the point is to sit level
with the team spawns rather than to scrape the bar:

| Arena | FFA spawn `y` before | New `y` | Clearance before → new |
|---|---|---|---|
| `arena-01` (spike band y 54–74 / 646–666) | 150 / 570 | **180 / 540** | 76 → 106 (corners; the middle pair was already 106.8) |
| `arena-02` (spike band y 61–81 / 648–668) | 150 / 570 | **187 / 543** | 69 / 78 → 106 / 105 |

`x` and `angle` are unchanged for every row. `arena-02`'s rows are symmetric about its team spawns'
centre line (y 365), as its team spawns already are.

**BC11.** `dashSubstepMaxUnits` stays 16. `config.test.ts` bounds it at half the short axis, which
is now 20, so it passes with more headroom. The measured penetration figures quoted in its comment
(18.49 u, and the five-row table) and in `step.test.ts` (`~26.64u`, `MEASURED_WORST_REACHABLE`)
**are re-measured** by the method those comments already describe (run the sweep with the bound
removed, read the label). The bounds `MAX_PENETRATION` and `MAX_REACHABLE_PENETRATION` are re-derived
with the same headroom ratio they use today. Neither bound failed in the dry run, but a bound whose
quoted measurement is stale no longer "discriminates" in the way its comment claims.

## 5. Tests: the classification rule

A dry run of the hull change plus BC7 on 2026-09-16 failed **23 shared, 10 server and 3 client
tests, plus the manual stamp**. Typecheck passed, the `check-art` blockers passed, and the
turn-tuning page test passed.

**BC12.** Every failing test is classified before it is touched, into exactly one of:

1. **Fixture geometry authored against 48 × 32.** Cars or boxes placed at hull-relative offsets, or
   a literal `48`/`32`/`24`/`16` meaning "the hull". Fix by deriving from `DRIVE_CONFIG`, or by
   scaling the offsets 1.25x so the hand-derived expectation is unchanged. Examples: `collide.test.ts`
   (11 tests), `golden.test.ts`'s `resolveWorld` block (4 tests), `ram.test.ts`, `lock.test.ts`'s
   `muzzleOf`, `combat.test.ts`'s `aimAngleFor`/phased-lock pair, `tick.test.ts`,
   `ram-bridge.test.ts`'s double-slam, client `fx/events.test.ts` and `combat-visual.test.ts`'s lock
   bracket.
2. **A measured value.** Re-measure by the method the test's own comment documents, re-pin, and
   update the quoted figures in the comment. Examples: `ram-config.test.ts`'s hardest ram (BC8),
   `golden.test.ts`'s pinned outcomes if they are measured rather than derived.
3. **A genuine behaviour change.** The game now behaves differently, and the test is right to say
   so. Root-cause it first, per `superpowers:systematic-debugging`.

**BC13.** A threshold is **never loosened** to make a test pass without a measurement that justifies
the new number by the test's own documented method, and a comment saying so. A test is never
deleted.

**BC14.** A golden fixture (`golden.test.ts`) is re-pinned only for its `resolveWorld` cases, which
read the hull. Its drive-integration cases do not read the hull and must not move. If one does, stop
and report it.

## 6. The bot

**BC15.** The bot's hull-derived margins grow with the hull: `movement.ts` (spike and obstacle
probes, `max/2` 24 → 30), `planner.ts`'s `boundsPenalty` margin (48 → 60), `perception.ts`'s
`THREAT_LATERAL_UNITS`, and `solution.ts`'s aim subtense. That is the correct behaviour for a bigger
car and is kept.

**BC16.** Because behaviour changes without `BOT_PROFILES` moving, **`BOT_BRAIN_VERSION` is bumped**
(4.6.0 → 4.7.0), per root `CLAUDE.md`.

**BC17.** Six server tests driven by bot behaviour failed in the dry run, and each is a category-3
suspect until shown otherwise:
- `balance/match.test.ts` "shortening matchSeconds still lets the deathmatch clock fire, so a winner
  can appear" — seed 98 produced no winner in 30 s. Its comment documents the procedure for this
  (sweep seeds 1–150, prefer one already in a known-good set). The procedure is followed, and the
  test is not weakened.
- `tiers.test.ts` "the ladder holds (P50) › hits more often as the tier rises" — hard 0.63 was not
  above medium 0.86.
- `tiers.test.ts` "(P49) › hard kills a stationary target inside twice its kit's theoretical floor" —
  18.7 s against a 17.87 s cap.
- `controller.test.ts` "keeps the body on the aim line when the target is OFF-AXIS" — 0.69 against
  < 0.2.
- `firing.test.ts` "preferredRangeOf … exactly ONE cell of nine" — `mirage/medium` joined
  `mirage/hard`.
- `planner.test.ts` "does not let one out-of-arena candidate turn commitPenalty into a latch
  (R-P16)" — reversed throttle.

**BC18.** Each gets a root cause before any edit. Acceptable outcomes:
- (a) The test's scene is hull-relative (a target placed where a 72-unit car now overlaps or sits
  against something). Fix the fixture.
- (b) A brain module holds a typed number that silently assumed the 48-unit hull. Derive it from
  `DRIVE_CONFIG`; this is covered by the BC16 bump.
- (c) A measured band (tiers' seeded hit rates, kill times) is re-measured across the **same seeds
  the comment lists**. It is re-pinned only if the relation the test asserts (strict ladder, "inside
  twice the floor") still holds on every seed.

**BC19.** If a failure can only be resolved by retuning `BOT_PROFILES`, or the ladder genuinely no
longer holds, **stop and report to the user**. That is `bot-tuner` territory and a user decision, not
part of this change.

## 7. Car art

**BC20.** All nine car sprites were **re-imported at 144 px** (`SUPERSAMPLE` 2 × the 72-unit long
axis) under the 1.5x revision, from the user's source folder `E:\Work\PROJECT DOCS\car racer\assets\cars\`. Filenames there
are the capitalised car ids (`Anvil.png`, `Bastion.png`, `Bullseye.png`, `Caprico.png`,
`Cleaver.png`, `Mirage.png`, `Prowler.png`, `Skorpios.png`, `Taurus.png`). Each goes through the
`process-car-asset` skill's own workflow: build shared **after** the hull change, preflight, then
`node scripts/import-art.mjs <source> <carId>`, with flags only as the preflight directs.

**BC21.** A preflight **blocker** on any source stops that car and is reported to the user; its old
96 px sprite is left in place rather than guessed at. Warnings are relayed in the summary.

**BC22.** `import-art.mjs`, `check-cars.mjs` and the skill's `preflight.mjs` need **no logic change**.
All three read the hull from built shared. Only prose moves:
- `.claude/skills/process-car-asset/SKILL.md`: "48x32 hull" becomes "60x40 hull", and "legible at
  48×32" becomes "legible at 60×40".
- `generation-prompt.md`: "legible at 48x32 pixels", "fits art to the 48×32 hull" and "Legible at
  48x32" all become 60×40.
- `packages/client/public/art/README.md`: the example output line and the `scale` row.
- `docs/asset-pipeline.md`: the `scale` row, the rotation example (`128 along the hull's 48, not
  along its 32` becomes 72/48), the "roughly 48×32 world units" line, and the fit-target table row.

**BC23.** The manifest rows need no change (`file` only, default fit). The importer rewrites them
idempotently.

**BC24.** After import, `npm run check:cars` must report no blockers. Under the 1.25x revision the
expected width is 120 px and the art is deliberately **left at 144 px** (§12), so every chassis
reports an off-size *warning* — over-sampled, not under-sampled, which costs a little texture memory
and nothing else. Warnings never fail the suite.

## 8. Client

**BC25.** Three typed world-space client constants were sized around the 48 × 32 hull without
deriving from it. They scale by the same 1.5x, so each overlay keeps its current proportion to the
car:

| Constant | File | Now | New | Why |
|---|---|---|---|---|
| `LOCK_BRACKET_HALF` | `scenes/combat-visual.ts` | 34 | **42.5** | must exceed the half-diagonal, now 36.1 (its test already derives this and fails today) |
| `LOCK_BRACKET_ARM` | `scenes/combat-visual.ts` | 11 | **13.75** | proportion to the bracket; still under half the side |
| `ARROW_GAP_PX` | `scenes/countdown-arrow.ts` | 38 | **47.5** | apex at the bottom of the bob must clear the 36.1 half-diagonal (42.5 > 36.1) |
| `HP_BAR_GEOMETRY.length` | `scenes/ArenaScene.ts` | 44 | **55** | the bar lies across the car's tail; keeps its width relative to the 40-unit (was 32) tail |

`HP_BAR_GEOMETRY.offset` already derives from `carWidth` and stays as written; `thickness` stays 5.
`countdown-arrow.test.ts`'s hardcoded `Math.hypot(48, 32)` is replaced by `DRIVE_CONFIG`, which is
what makes that test catch this class of drift from now on.

No other client logic changes. Comments that state the hull as a fact are updated to 60 × 40 (or
reworded to reference `DRIVE_CONFIG`):
- `fx/environment.ts`, `fx/occlusion.ts` (its "107 x 93 units against a 48 x 32 hull" figure is
  reworded as historical), `scenes/car-lighting.ts`
- `scenes/combat-visual.ts` (both mentions), `scenes/countdown-arrow.ts` and its test (the
  half-diagonal becomes 36 u, and the test's `Math.hypot(48, 32)` is derived from `DRIVE_CONFIG`)
- `scenes/weapon-hud.ts`, `assets/sprite-fit.ts` and its test's comment, `scripts/import-weapon-icon.mjs`
- `packages/client/CLAUDE.md`

Tests that call pure geometry helpers with explicit arbitrary dimensions (`shapes.test.ts`,
`maneuver-visual.test.ts`'s `hullOutlinePoints(…, 48, 32)`, `contact.test.ts`'s standalone hull,
`hits.test.ts`) are not about the game's hull and are left alone unless they fail.

## 9. Shared comments and docs

**BC26.** Shared comments that state the hull as a fact are updated: `ram.ts` ("48 long by 32
wide"), `step.ts` and `step.test.ts` (thunderclap's 53.3 u/tick "against a 48x32 hull"),
`aim-config.ts` ("cars are 48 x 32"), `drive-config.ts`'s `dashSubstepMaxUnits` comment (BC11),
`config.test.ts`'s "32-unit face"/"48-unit face" (now 40/60), `ram-config.ts` (BC8), and the
server-side `planner.ts` "48-unit margin" prose, `planner.test.ts`, `solution.test.ts` and
`ram-bridge.test.ts` comments.

**BC27.** Docs:
- `docs/config-reference.md` gets these edits:
  - the `DRIVE_CONFIG` table's `carWidth`/`carHeight` rows (60 / 40)
  - the `RAM_CONFIG` table's `spinScale` row (12.5, with the reason) and `inertiaCoefficient` row
    (433.33 **[D]**)
  - the `spinScale` prose ("it is 10 now", and the lever-arm table's clamp at 24 u → 30 u)
  - the lever-clamp sentence "(24 and 16 today)" → "(30 and 20 today)"
- `docs/turn-tuning.md`: its prose calling radii "under one car length (48 u)" is re-read against
  60 u. Its three tables do not contain the hull, and its test already passes.
- Root `CLAUDE.md`: one new dated paragraph recording the resize, the spin compensation and the
  moved spawns. Older dated paragraphs stay as history.
- `docs/superpowers/plans/2026-09-06-car-physics/EXECUTION.md`: one note that `spinScale` moved
  10 → 12.5 outside the rework to hold spin constant across the hull resize, so stage 5 re-pitches
  from 12.5.

**BC28.** The players' guide is regenerated with `npm run build:manual`. `DRIVE_CONFIG` is in its
stamp, and the page prints "a car is 60 long" and weapon reach in car lengths. The regenerated page
is committed.

## 10. Probes and harnesses: flagged, not run

**BC29.** The playtest probes are **not** updated as a matter of course and **not** run. The final
summary must name, loudly:
- `geometry.ts` and `collision.ts`: hull-derived placements and verdicts.
- `prediction.ts`: its FINDING threshold is `carWidth`, which just grew 1.25x.
- `ram.ts`: attacker placements at `vx - 48 - gap`, a typed hull length that is now wrong.
- `weapons.ts`: `HULLS_TOUCH_AT = 48` and the "W2. Point-blank (… hulls touch at 48)" report string,
  both now wrong.
- `weapons2.ts`: pellet-reach label.

It recommends `npm run playtest`. A probe that fails to **compile** is the one exception and is
fixed on the spot, and the summary says so.

**BC30.** The summary also flags `npm run ttk` (hit-rate-blind, so expected to move little) and the
balance harness.

**BC31.** The summary recommends `npm run balance`, noting that a report from before this change
is not comparable across the `BOT_BRAIN_VERSION` bump.

## 11. Verification

**BC32.** Root `npm test` is green: shared, server, client and scripts, including the manual stamp
and the check-art blockers.

**BC33.** Root `npm run build` succeeds, and the server bundle is checked to carry the new hull
(`grep "carWidth: 60" packages/server/dist/index.js`), per the shared-dist gotcha.

**BC34.** A visual check in the playground (`?dev=playground`, dev server via the preview tools):
cars render at the new size with the re-imported art, the debug hitbox outline matches the sprite,
and cars collide where they appear to touch. A screenshot is shared. The guide page
(`/manual.html`) is loaded to confirm the new sprites and the "60 long" text.


## 12. Revision: 1.5x → 1.25x (2026-09-17)

**BC35.** The 1.5x hull shipped on this branch and played too large: the arenas did not grow (BC2),
so a 72 × 48 car left the field feeling crowded rather than weighty. The factor is revised to
**1.25x — 60 × 40** — and every clause above is restated at that factor rather than kept as history,
because none of this has reached `development/main` yet.

**BC36.** What that changed, against the 1.5x work:

- `spinScale` **12.5**, not 15 (BC7). The hardest ram still measures 4.4975 rad/s.
- Every hand-placed fixture offset re-derived at 1.25x of its **48 × 32 original**, not at 1.25/1.5
  of the 72 × 48 value, so each hand derivation is exact rather than rounded twice.
- The golden `resolveWorld` poses re-pinned a third time: wall 30, corner 35.3553390593,
  car 485.5357142857143, obstacle 289.5798033337405.
- The bot's slot-preference sweep returns to **one** cell of nine (`mirage/hard`), the 48 × 32
  reading — `mirage/medium` only comes alive at 72 × 48. `firing.ts`, `bot-profiles.ts` and
  `docs/bot-behavior.md` revert to "one cell", with the neutral standoffs re-measured at 60 × 40
  (bullseye 70 / 220 / 570, mirage 103.3 / 220 / 220, bastion 111.7 / 132.5 / 132.5).
- `planner.test.ts`'s R-P16 winner is `{ steer: 1, throttle: 1 }`. Measured: `{ 1, 1 }` and
  `{ -1, 1 }` score **bit-identically** in this symmetric scene, so the steer sign is `ALL_ACTIONS`
  order breaking an exact tie, not a play. The comment now says so; `throttle: 1` is the real claim.
- `solution.test.ts`'s fine pass re-bands to 16–28, off a 1-unit probe putting the last connecting
  offset at 25 and the first miss at 26.
- `instances.test.ts`'s beam wall-clip expectation is derived through `MUZZLE_STEP_UNITS` rather than
  written as a bare gap. `wallClipDistance` marches the centre axis in 4 u steps, so it answers the
  gap **rounded up** to a multiple of 4; 48 × 32 (176) and 72 × 48 (164) both happened to be exact
  multiples and 60 × 40 (170) is the first that is not.
- `BOT_BRAIN_VERSION` stays **4.7.0** — it already marks "the hull moved and every derived margin
  moved with it" against 4.6.0, and no 4.7.0 report exists to compare against.

**BC37.** The **car art is deliberately not re-imported** and stays at 144 px, at the user's
instruction; they will re-import against the 60 u hull separately. `check:cars` therefore warns on
all nine rows (144 px against an expected 120) and blocks on none. BC20/BC21/BC24's import workflow
is unchanged for whenever that happens.

**BC38.** The FFA spawn rows (BC10) **stay** where the 1.5x work put them. At 72.1 u of diagonal
`arena-02`'s original rows fail outright and `arena-01`'s clear by under four units, so the move is
forced on one arena and wanted on the other.

**BC39.** Three server tests were **already failing on `development/main`** before any of this work,
from the 2026-09-16 top-speed cut, and are not this change's to fix (BC19 sends them to `bot-tuner`
and the user). Measured at each hull, for whoever picks that up:

| Test | 48 × 32 (base) | 72 × 48 | 60 × 40 (now) |
|---|---|---|---|
| `controller.test.ts` OFF-AXIS mean offset (bar < 0.2) | 0.2386 | 0.6939 | **0.2017** |
| `tiers.test.ts` P49 time-to-kill (cap 17.87 s) | no kill in the run | 18.7 s | **passes** |
| `tiers.test.ts` P50 hard vs medium hit rate | 0.778 vs 0.8 | 0.632 vs 0.857 | **0.765 vs 0.857** |

P49 goes green at 60 × 40. The other two stay red, both closer to their bars than at 72 × 48 and
OFF-AXIS closer than at base.
