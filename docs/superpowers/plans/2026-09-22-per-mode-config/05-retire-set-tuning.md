# Phase 5 — `setTuning` retired

**Goal:** The playground installs an ad-hoc bundle for its own room instead of mutating
process-wide singletons (MC39, MC40).

**Precondition:** phase 4 complete, suite green.

---

### Task 1: Build a bundle from overrides

**Files:**
- Create: `packages/shared/src/modes/overlay.ts`
- Test: `packages/shared/src/modes/overlay.test.ts`

**Interfaces:**
- Produces: `applyOverrides(base: ModeConfig, overrides: TuningOverrides): ModeConfig` — clones the
  base's tables, writes each dot-path, re-assembles. Validation stays `tuning-walker.ts`'s job.

- [ ] **Step 1: Write the failing test**

```ts
it("returns a NEW bundle and leaves the base untouched", () => {
  const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
  const before = base.weapons.predator.damage;
  const tuned = applyOverrides(base, { "weapon.predator.damage": 999 });
  expect(tuned.weapons.predator.damage).toBe(999);
  expect(base.weapons.predator.damage).toBe(before);
});

it("re-derives the artifacts a changed leaf feeds", () => {
  const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
  const tuned = applyOverrides(base, { "weapon.predator.cooldownMs": 4000 });
  expect(tuned.derived.weaponTicks.predator.cooldown)
    .not.toBe(base.derived.weaponTicks.predator.cooldown);
});

it("rejects an unknown status id before writing anything", () => {
  const base = modeConfigOf(GameMode.FFA_LAST_STANDING);
  expect(() => applyOverrides(base, { "weapon.predator.applies.0.statusId": "nope" })).toThrow();
});
```

That last one is the one value check `tuning.ts` already makes and must survive: an unknown id
reaches `statusDefOf(...)!.onApply` and throws a bare TypeError mid-tick, killing the room.

- [ ] **Step 2: Run — FAIL. Implement using `leafOf` from `tuning.ts`, then `assembleModeConfig`.**

Re-derivation is free here: `assembleModeConfig` already computes every artifact, so the five
`rebuild*` functions have no successor to write.

- [ ] **Step 3: Run — PASS. Commit.**

---

### Task 2: Point the playground at it

**Files:**
- Modify: `packages/server/src/rooms/PlaygroundRoom.ts`
- Delete: `packages/shared/src/config/tuning.ts`'s `setTuning` / `activeTuning`
- Modify: `packages/shared/src/config/car-config.ts`, `weapon-config.ts`, `weapon-ticks.ts`,
  `ram-config.ts`, `turret-config.ts` — delete the no-op `rebuild*` stubs phase 1 left

- [ ] **Step 1: `PlaygroundRoom` holds `this.modeConfig = applyOverrides(base, setup.tuning)` and
      re-assigns it when the settings panel changes. Every entry point already wraps in
      `scoped(this.modeConfig, ...)` from phase 3, so nothing else changes.**

- [ ] **Step 2: Delete `setTuning`, `activeTuning`, `DEFAULTS`, `ROOTS`, `restoreInPlace` and the
      five `rebuild*` stubs. `tuning-walker.ts` survives whole — it describes paths, not writes.**

- [ ] **Step 3: Update `packages/server/CLAUDE.md` and the root `CLAUDE.md`: the rule that
      `PracticeRoom` must never call `setTuning` because the store is process-wide no longer
      exists. Say what replaced it.**

- [ ] **Step 4: Build, full suite, commit**

```bash
npm run build && npm test
git commit -am "refactor: retire setTuning's process-wide mutation (MC39, MC40)"
```

- [ ] **Step 5: Mark phase 5 done in `EXECUTION.md`, set Next to Phase 6 Task 1, commit.**
