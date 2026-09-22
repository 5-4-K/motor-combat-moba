# Phase 6 — Tooling

**Goal:** Every tool that reports numbers names the mode it speaks for, and none can silently
report one mode's numbers as another's (G5, MC41).

**Precondition:** phase 5 complete, suite green.

**Read before starting:** the root `CLAUDE.md` sections on the cars & weapons guide, the balance
harness, the playtest probes and `docs/turn-tuning.md`. Each carries rules this phase must keep.

---

### Task 1: `balanceStamp` covers every active mode

**Files:**
- Modify: `scripts/build-cars-and-weapons.mjs`
- Test: `scripts/manual-page.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// A stamp computed over ONE mode would let a Deathmatch rebalance ship a page whose Deathmatch
// tab still shows last week's numbers, with nothing failing.
it("moves balanceStamp when a NON-default active mode's tables move", () => {
  const shipped = balanceStamp();
  const tweaked = applyOverrides(
    modeConfigOf(GameMode.FFA_DEATHMATCH),
    { "weapon.predator.damage": 999 },
  );
  assert.notEqual(stampOfModes([modeConfigOf(GameMode.FFA_LAST_STANDING), tweaked]), shipped);
});

it("is stable across two calls with nothing changed", () => {
  assert.equal(balanceStamp(), balanceStamp());
});
```

`stampOfModes(configs)` is the pure inner function; `balanceStamp()` becomes
`stampOfModes(activeGameModes().map(modeConfigOf))`. Splitting them is what makes the first test
writable without mutating a live registry.

- [ ] **Step 2: Run — FAIL. Make `balanceStamp` hash `activeGameModes().map(modeConfigOf)` rather
      than the module tables. Run — PASS.**

- [ ] **Step 3: Commit**

---

### Task 2: The guide gets a tab per active mode

**Files:**
- Modify: `scripts/build-cars-and-weapons.mjs`, `scripts/cars-and-weapons-copy.mjs`,
  `scripts/manual-facts.mjs`
- Test: `scripts/manual-page.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
it("publishes a Cars and an Effects section for every active mode", () => {
  const html = readFileSync("packages/client/public/manual.html", "utf8");
  for (const mode of activeGameModes()) {
    assert.match(html, new RegExp(`id="mode-${mode}"`));
  }
});

it("resolves every effect link within its own mode's section", () => {
  // A #fx- anchor from Brawl's weapon list must not resolve into Deathmatch's Effects section,
  // or a status Brawl cannot apply would read as documented for Brawl.
  for (const mode of activeGameModes()) { /* both-directions id check, scoped to the section */ }
});
```

- [ ] **Step 2: Run — FAIL. Generate one `<section id="mode-N">` per active mode, each with its own
      Cars and Effects halves and mode-prefixed `#fx-` ids. A plain CSS/JS tab strip switches them;
      no framework.**

- [ ] **Step 3: `npm run build:manual`, commit the page with the script (the page is generated but
      committed).**

---

### Task 3: `--mode` on the three harnesses

**Files:**
- Modify: `scripts/ttk.mjs`, `packages/server/balance/*`, `packages/server/playtest/*`

- [ ] **Step 1: Add `--mode=<id|name>` to each, defaulting to `DEFAULT_GAME_MODE`; wrap each run in
      `withMode(modeConfigOf(mode), ...)`; print the mode in the report header and in the
      directory name.**

- [ ] **Step 2: Add the mode id to balance's config fingerprint, and make `--baseline` refuse a
      cross-mode comparison the same way it already refuses a cross-`BOT_BRAIN_VERSION` one.**

```js
if (baseline.mode !== report.mode) {
  throw new Error(`baseline is mode ${baseline.mode}, this run is ${report.mode} — not comparable`);
}
```

- [ ] **Step 3: Run each once to confirm it still produces a report. Commit.**

```bash
npm run ttk -- --mode=2
npm run balance -- --shape=duel --matches=4 --seed=7 --mode=0
npm run playtest
```

---

### Task 4: `docs/turn-tuning.md` per mode

**Files:**
- Modify: `docs/turn-tuning.md`, `scripts/turn-tuning-doc.test.mjs`

- [ ] **Step 1: Give the page one set of its three tables per active mode, under an
      `## <Mode name>` heading each.**

- [ ] **Step 2: Make the test iterate `activeGameModes()`, resolve each mode's bundle, and name the
      mode alongside the row and chassis in every failure message.**

This is the most tedious file in the phase and it scales worst with mode count. It is also the one
that catches a turn-rate edit that skipped the page, so it earns the tedium.

- [ ] **Step 3: Run `npm test` — expect the page to fail until every table is right. Fix the page,
      never the test. Commit.**

---

### Task 5: `check:art` and `fireSlotsOf`'s readers

**Files:**
- Modify: `scripts/check-art.mjs`, `packages/server/balance/stats.ts`,
  `packages/server/src/bot/brain/duel.fixture.ts`

- [ ] **Step 1: `check:art` sweeps the union of every mode's carried weapons and cars, marking a row
      `(mode: <name>)` where the modes disagree about whether it is carried.**

Art is per-id and global (MC5), so this stays one sweep — but a row carried in one mode and not
another must not read as uncarried.

- [ ] **Step 2: `fireSlotsOf`'s five live readers each run inside a mode scope. Its doc comment
      carries the authoritative list — update it to say the list is per mode now.**

- [ ] **Step 3: Build, full suite, commit.**

---

### Task 6: Documentation

**Files:**
- Modify: root `CLAUDE.md`, `packages/shared/CLAUDE.md`, `packages/server/CLAUDE.md`,
  `packages/client/CLAUDE.md`, `docs/config-reference.md`, `docs/glossary.md`

- [ ] **Step 1: Root `CLAUDE.md` gains a per-mode-config section** naming: the bundle, the scope,
      `cfg()` throwing, the global list (MC30–MC38) and why, how to add and disable a mode, and the
      fact that every harness now takes `--mode`.

- [ ] **Step 2: Correct the statements this work falsifies** — the `setTuning` process-wide rule,
      "`PracticeRoom` never calls `setTuning`", `ACTIVE_ARENA_ID` as the one arena, and the
      "Re-run `npm run build:manual` whenever you change…" list, which now means *any active mode's*
      tables.

- [ ] **Step 3: Add a `game-mode` skill** under `.claude/skills/` walking the add-a-mode checklist:
      enum value, folder, registry row, arena set, `build:manual`, per-mode tests, turn-tuning page.

- [ ] **Step 4: Commit.**

- [ ] **Step 5: Mark phase 6 done in `EXECUTION.md`. Set the table's every row to `done` and
      **In flight** to `none — work complete`. Commit.**

---

## Exit criteria for the whole plan

1. `npm test` and `npm run build` green.
2. An arena room on one mode and a practice room on another tick correctly in one process
   (phase 3 Task 6 proves the sim half; confirm once by hand with two browser tabs).
3. `golden.test.ts` unchanged from before phase 1.
4. Disabling a mode removes it from the lobby and enabling restores it, with no code change beyond
   the flag.
5. `npm run build:manual` writes a page carrying every active mode, and a stale page fails the suite.
6. **Say loudly in the final summary** that `sim/`, the tables and the tick pipeline all changed, so
   `npm run playtest` and `npm run balance` should be re-run — and that reports from before this
   work are not comparable to reports after it.
