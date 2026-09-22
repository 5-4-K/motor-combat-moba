# Phase 4 — Lobby and arena sets

**Goal:** A mode carries an arena set, the client loads the union of every active mode's arenas, and
the release zip ships that same union (MC23–MC26).

**Precondition:** phase 3 complete, suite green.

---

### Task 1: `activeArenaIds()`

**Files:**
- Modify: `packages/shared/src/modes/registry.ts`
- Test: `packages/shared/src/modes/registry.test.ts`

**Interfaces:**
- Produces: `activeArenaIds(): readonly ArenaId[]` — union of every ACTIVE mode's `arenas`,
  de-duplicated, in registry order.

- [ ] **Step 1: Write the failing test**

```ts
it("unions the arena sets of active modes only", () => {
  expect(activeArenaIds()).toEqual(["arena-01", "arena-02"]);
});

it("de-duplicates arenas two modes share", () => {
  expect(new Set(activeArenaIds()).size).toBe(activeArenaIds().length);
});
```

- [ ] **Step 2: Run — FAIL, `activeArenaIds is not a function`.**

- [ ] **Step 3: Implement it**

```ts
/** Union of every ACTIVE mode's arena set, de-duplicated, in registry (picker) order. */
export function activeArenaIds(): readonly ArenaId[] {
  const seen = new Set<ArenaId>();
  for (const mode of activeGameModes()) {
    for (const id of MODE_TABLE[mode].config.arenas) seen.add(id);
  }
  return Object.freeze([...seen]);
}
```

Active modes only: an unpublished mode's arena would otherwise bloat the release zip with art no
player can reach.

- [ ] **Step 4: Run — PASS. Commit.**

```bash
git commit -am "feat(shared): activeArenaIds unions the published modes' arena sets (MC24)"
```

---

### Task 2: An empty or unregistered arena set (Review Focus #3)

**Files:**
- Test: `packages/shared/src/modes/invariants.test.ts` (extend Task 4 of phase 2)

- [ ] **Step 1: Write the test**

```ts
it("names at least one arena, all of them registered (MC23)", () => {
  // An empty set makes arenas[0] undefined and getArena throws MID-MATCH, killing the room;
  // an unregistered id does the same one tick later. Both must fail the suite, not the match.
  expect(def.config.arenas.length).toBeGreaterThan(0);
  for (const id of def.config.arenas) expect(isArenaId(id)).toBe(true);
});
```

- [ ] **Step 2: Run — PASS today. Commit.**

The test earns its place the day someone adds a mode and forgets its arena set — which is exactly
when it is cheapest to catch.

---

### Task 3: The room picks its mode's arena

**Files:**
- Modify: `packages/server/src/rooms/ArenaRoom.ts`, `PracticeRoom.ts`

- [ ] **Step 1: Set `state.arenaId = config.arenas[0]` wherever the bundle is resolved**

Not `ACTIVE_ARENA_ID` (MC26). `PlaygroundRoom` keeps writing `state.arenaId` from its setup panel —
it is the one room that picks an arena directly.

- [ ] **Step 2: Build, server suite, commit**

---

### Task 4: The client loads the arena union

**Files:**
- Modify: `packages/client/src/scenes/BootScene.ts`,
  `packages/client/src/assets/asset-keys.ts`
- Test: `packages/client/src/assets/asset-keys.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("loads art for every active mode's arenas, not just one (MC24)", () => {
  for (const id of activeArenaIds()) {
    expect(shouldLoadAssetKey(`arena.${id}.floor`, activeArenaIds(), false)).toBe(true);
  }
});
```

- [ ] **Step 2: Run — FAIL (the signature takes one id). Widen `shouldLoadAssetKey`'s second
      parameter from `activeArenaId: string` to `arenaIds: readonly string[]` and repoint its three
      call sites. Run — PASS.**

Without this, switching mode in the lobby reaches the "Arena mismatch" screen, which reads as the
stale-`dist` bug and will waste an afternoon.

- [ ] **Step 3: Build, client suite, commit**

---

### Task 5: The release ships the union

**Files:**
- Modify: `scripts/build-release.mjs`
- Test: `scripts/build-release.test.mjs` if one exists; otherwise verify by running the build

- [ ] **Step 1: Repoint the prune and its post-build assertion at `activeArenaIds()` (MC25)**

Both halves. The assertion currently throws if any non-active arena's art survived; it must now
throw only for an arena outside the union.

- [ ] **Step 2: Run `npm run build:release` and confirm both arenas' art is in the zip**

```bash
npm run build:release && ls dist-release/motor-combat-moba/client/art/arenas/
```
Expected: `arena-01` and `arena-02`.

- [ ] **Step 3: Commit**

- [ ] **Step 4: Mark phase 4 done in `EXECUTION.md`, set Next to Phase 5 Task 1, commit.**
