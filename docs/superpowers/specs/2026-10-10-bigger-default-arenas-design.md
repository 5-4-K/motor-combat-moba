# Bigger default arenas at zoom 0.8 — design

Status: draft for owner review · 2026-10-10 · branch `feature/bigger-brawl-arena`

Requirements are numbered **BAR-n** ("bigger arenas") so the plan, the code comments and the tests
can cite them. (`BA1–BA38` is taken by the basic-attack spec.)

## 1. Intent

The owner finds the playable area too small. The fix is **more floor, not a smaller picture**: grow
`arena-01` and `arena-02` and pull the camera back from zoom 1 to 0.8 so the bigger arena still
fills the same 1280 × 720 game window. Cars, shots and effects are drawn 20 % smaller on screen;
the space between them grows.

Zoom alone was rejected (it shrinks the arena with void around it and gains no floor), and
shrinking every world length was rejected (identical result on screen, hundreds of numbers moved,
and the 60 × 40 hull is a stop-and-ask item).

## 2. Goals, non-goals, anti-goals

**Goals**
- BAR1. `arena-01` and `arena-02` become 40 × 22 tiles (1600 × 880 world units), keeping a
  **one-tile boundary wall/spike ring on all four sides**, as today. Playable floor goes from
  1200 × 640 (x 40..1240, y 40..680) to **1520 × 800 (x 40..1560, y 40..840)**, about +58 %.
- BAR2. Every mode that plays these arenas runs at camera zoom **0.8**: Brawl, Deathmatch, Team
  brawl (inactive, but must be right when re-enabled), and through them Practice (pinned to the
  Deathmatch bundle) and the dev Playground (default mode's bundle).
- BAR3. At zoom 0.8 the camera sees 1600 × 900 world units. The arena (1600 × 880) fills the width
  exactly and is **centred vertically**, leaving a 10-unit band above and below. That band is
  painted the arena's `palette.border` colour so it reads as "outside", never as floor.
- BAR4. The camera never pans on these arenas: the whole arena is always on screen, so the bot's
  B17 fairness check (`buildBotView`'s `arenaFits`) stays on its "sees everything" path.

**Non-goals**
- Art changes. Car sprites at zoom 0.8 are drawn at 0.4× their stored size (`SUPERSAMPLE = 2`),
  below the 0.5× the importer was tuned for, so they may shimmer. The owner will look in a browser
  first; any re-bake (`SUPERSAMPLE = 1.6`) or mipmap work is a separate change.
- Conquer. `arena-03` and Conquer's camera are unchanged.
- Balance retuning. Weapon ranges, speeds and the bot are not touched to compensate.
- Mobile layout. Discussed and parked.
- Arena preview art. None exists today (`arena.<id>.preview` is optional); nothing to redo.

**Anti-goals** (would be a failure even if it "works")
- Any mode showing more or less of the world than another player in the same mode (the FIT /
  letterbox rule in `client/src/config/display.ts` stands).
- The 10-unit band being drawn in the floor colour, so it looks driveable.
- The arena pinned to the top of the view with the whole 20-unit band at the bottom (what Phaser's
  clamp does by default when the view is bigger than the bounds — see §5).
- Conquer's resolved bundle moving. Its snapshot must not change.

## 3. Constraints

- Per-mode config rules (CLAUDE.md): zoom is `ModeTables.camera.zoom`; read through `camera()`,
  never at module scope.
- `TILE_SIZE` stays 40. The hull stays 60 × 40. `LOGICAL_CANVAS` stays 1280 × 720.
- Invariant 2: no magic numbers — the centring must derive from the camera's own size and zoom and
  the arena's size, never a literal 10 or 880.
- Arena `width`/`height` mean the image frame and camera bounds (CLAUDE.md, "Arenas and spikes");
  they become 1600 × 880.

## 4. Decided by the owner

| # | Decision |
|---|---|
| D1 | Grid 40 × 22 at zoom 0.8 ("option A"), not 48 × 27 at 0.667 or 40 × 23 at 0.783. |
| D2 | Enlarge `arena-01` and `arena-02` in place (shared), not new Brawl-only arenas. |
| D3 | Zoom 0.8 goes in the **base** (`CAMERA_CONFIG.zoom`); Conquer gets an explicit `camera.zoom: 1` override so its resolved value does not move. |
| D4 | Arena 01's spike runs are stretched proportionally and stay mirrored; spawns scale with the floor. Arena 02 keeps spikes along its whole edge. One boundary tile on every side in both. |
| D5 | The band outside the arena is filled with the arena's `palette.border` colour. |
| D6 | No art change in this work; the owner tests first. |

## 5. The design

### 5.1 Config

- BAR5. `CAMERA_CONFIG.zoom` → `0.8` (`shared/src/config/drive-config.ts`). Rewrite its comment:
  the "1 is the widest setting inside the 1–2 range — below 1 the textures shimmer" sentence now
  describes a known, accepted trade-off pending the owner's art check, and the arena/zoom coupling
  becomes "the default arenas are 1600 × 880, sized so zoom 0.8 shows them whole".
- BAR6. `CONQUER_OVERRIDES.camera` gains `zoom: 1` with a one-line comment: `arena-03` is
  1280 × 2160 — exactly one screen wide at zoom 1, scrolling vertically — and is authored for it.
- BAR7. Snapshots: `brawl`, `deathmatch`, `team-brawl` move (`zoom: 0.8`); `conquer` must **not**
  move. Re-snapshot only the three moved files.

### 5.2 Arena 01 (40 × 22)

- BAR8. Top/bottom edge, 40 columns, mirrored about the vertical centre line. Each original run's
  columns are mapped by ×1.25 (32 → 40) and rounded to whole tiles:
  `####^^^^^^####^^^^####^^^^####^^^^^^####` (runs at cols 4–9, 14–17, 22–25, 30–35). The
  existing `T`/`t` (top) and `B`/`b` (bottom) art-orientation keys apply as today.
- BAR9. Side columns, 22 rows. The original spike row pairs 3–4, 8–9, 13–14 (of 0..17) map by
  ×22/18 to **4–5, 10–11, 16–17** (of 0..21) — mirrored about the horizontal centre line. All other
  interior rows are `PLAIN`. The left/right orientation keys (`#`/`^` left, `R`/`r` right) apply as
  today.
- BAR10. Spawns scale about the floor: `x' = 40 + (x − 40) × 1520/1200`,
  `y' = 40 + (y − 40) × 800/640`, rounded to whole units **and then made exactly mirror-symmetric**
  (`x_right = 1600 − x_left`, `y_bottom = 880 − y_top`), since the file's comment promises spawns
  "symmetric to the unit". FFA: (243, 215), (1357, 215), (243, 665), (1357, 665), (800, 215),
  (800, 665). Team spawns keep the rule "y divides the playable height into four equal parts":
  y 240 / 440 / 640, x 243 (team A, angle 0) and 1357 (team B, angle π). Angles unchanged.
- BAR11. Update the file's header comment: 1600 × 880 (40 × 22), floor x 40..1560, y 40..840, sized
  for zoom 0.8; drop "1280x720 … is the client's logical canvas".

### 5.3 Arena 02 (40 × 22)

- BAR12. `EDGE = "#" + "^".repeat(38) + "#"`, `FLOOR_ROW = "l" + ".".repeat(38) + "l"`, 22 rows
  (edge, 20 floor rows, edge). Legend and palette unchanged.
- BAR13. Spawns scale by the same formulas as BAR10 from today's values. Today's FFA ys
  (187 / 543) are not mirror-symmetric (147 u and 137 u off the spike faces); scale them as they
  are — (224, 669) — rather than silently "fixing" them. x: 243 / 1357 / 800. Team spawns as BAR10.
  Update the clearance numbers in its spawn comment to the new figures.

### 5.4 Client: centring and the band (`ArenaScene`)

- BAR14. Today: `cam.setBounds(0, 0, arena.width, arena.height)`. When the camera's world view
  (`cam.width / zoom`, `cam.height / zoom`) is larger than the arena on an axis, Phaser 4.2.1's
  `clampX`/`clampY` pin the scroll so the view starts at world 0 on that axis — the arena hugs the
  top/left and the whole gap lands on the far side. Fix: on each axis where the view is larger,
  grow the bounds to the view's size, centred on the arena (bounds origin `−(view − arena) / 2`).
  Where the arena is larger on an axis, bounds stay the arena's on that axis so the soft follow
  still clamps exactly as today. **That branch is live**: Conquer's `arena-03` (1280 × 2160) is
  taller than the view and scrolls vertically, and its width equals the view at zoom 1; its bounds
  must come out identical to today's `(0, 0, 1280, 2160)`, asserted by a test. Pure helper (e.g. `client/src/camera/bounds.ts`, `cameraBoundsOf(arena, viewW, viewH,
  zoom)`), unit-tested, called where `setBounds` is today.
- BAR15. The band: anything the camera shows outside `[0, arena.width] × [0, arena.height]` is
  drawn in `colors.border` (`arenaColorsOf(arena)`). Builder's choice how (a filled rect behind the
  world at the lowest depth, or switching the camera background and painting the floor rect) **but
  Conquer's `arena-03` must look exactly as it does today**, including whatever currently shows
  outside its chamfered boundary.
- BAR16. Re-check other places that read zoom or arena size against the new numbers: the FOV dim
  overlay size (`ArenaScene` ~3295, already divides by zoom), aim offset (`aim-offset.ts`, already
  divides by zoom), spectate free-roam, the respawn cut, the kill-cam / hit-stop. No change expected;
  confirm, don't assume.

### 5.5 Server and shared readers

- BAR17. `buildBotView` (`server/src/bot/view.ts`): viewport becomes 1600 × 900; both arenas fit
  (1600 × 880). No code change; fix comments that say "arena-01, 1280x720, fits exactly" and "what
  `zoom: 1` draws". Tests in `bot/view.test.ts` that assumed a 1280 × 720 viewport are updated to
  the derived viewport, not to new literals.
- BAR18. Comment drift to correct (non-exhaustive; grep `1280`, `720`, `1240`, `680`, `zoom of 1`,
  `zoom 1`): `LOGICAL_CANVAS` doc, `arena-01.ts`, `arena-02.ts`, `bot/view.ts`,
  `client/src/scenes/combat-visual.ts` (`BOLT_VISIBLE_TEAR`: "zoom 1 … a world unit IS a pixel"),
  `client/src/scenes/ribbon-fill.ts` (disc segments "at the arena's fixed zoom of 1"),
  `server/src/bot/view.ts` ("Both shipped arenas currently fit" — already false for `arena-03`). Where a
  constant's *value* was justified by "1 unit = 1 pixel", note that at 0.8 a unit is 0.8 px, so those
  thresholds are now conservative (more detail than visible) — no value change.

## 6. What this owes (the builder must do all of it)

- Rebuild shared; root `npm run build` order.
- `npm run build:manual` and commit `manual.html` — weapon reach is printed as a share of each mode's
  `arenas[0]` playable width, which grows 1200 → 1520.
- `docs/turn-tuning.md`: no table moves (zoom and arena size are not in it); confirm the test passes.
- Tests: full scope (`npm test`) — shared outside a mode folder changed — plus `npm run test:slow`
  (`arena/`, `config/`, `modes/`) and `npm run playtest -- --scope=all` for every active mode
  (`brawl`, `deathmatch`, `conquer`).
- Balance fingerprint changes for **all three active modes**: Brawl and Deathmatch through their
  bundle (camera) and the arenas, Conquer because `configFingerprintInput` hashes the whole `ARENAS`
  table (`server/balance/fingerprint.ts`) even though Conquer's snapshot does not move. Old
  `--baseline` reports are refused in every mode. Say so; do not re-run balance as part of this work.
- Probes: per CLAUDE.md, **do not update probe expectations silently**. Run them, and report loudly
  which numbers moved (expected: ram trigger rates, spike contacts, weapon reach as a share of arena,
  anything placing cars at fixed arena-01 coordinates). Fix only compile breaks or probes that no
  longer reach their code path (e.g. a fixed position now in open floor instead of against a wall),
  and say so.

## 7. Left to the builder

- BAR19 (author's call, not the owner's). The dev Playground runs the default (Brawl) bundle and
  accepts any arena, including `arena-03`. At zoom 0.8 there, `arena-03` shows with border-coloured
  bands left and right (centred by BAR14; `cameraBackgroundOf` paints the border colour whenever the
  camera bounds exceed the arena rect, not only for tile arenas) and the bot's viewport is 1600 × 900. Accepted as is: the
  Playground is dev-only and this is visibly correct, not misleading. No Playground-specific zoom.

- Exact mechanism for BAR15's band, within its constraint.
- Whether `cameraBoundsOf` lives in `client/src/camera/` or beside `ArenaScene`.
- How existing arena tests are rewritten, provided they assert the BAR1/BAR8–BAR13 geometry
  (floor rect, one-tile ring, mirror symmetry of spikes and spawns, spawn clearance from every
  wall ≥ a car diagonal).

## 8. Risks, stated plainly

- **Balance moves in three modes.** +58 % floor favours long-range kits and weakens rams and
  short-range weapons; matches run longer; spikes are reached less often. Accepted by the owner.
- **Sprite shimmer at 0.4× texture scale.** Owner checks in a browser; fix is out of scope.
- **Readability.** A car is ~32 px tall on the 720 canvas (4.4 % of height, down from 5.6 %). Status
  icons and thin beams shrink with it.
