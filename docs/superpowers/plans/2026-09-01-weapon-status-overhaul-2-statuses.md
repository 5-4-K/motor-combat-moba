# Weapon/Status Overhaul — Plan 2 of 3: The Status Table

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the status roster to the spec's seven-row table — overheated as pure burn, spiked as pure harsh slow, fortified as pure damage reduction, stunned as a full stop, plus the new `armored` row and its `invulnerable` flag — and raise the duration ceiling Wild Charge's 10 s fortified needs.

**Architecture:** Pure table-and-machinery changes in `@motor-combat-moba/shared`. The one new mechanism is `invulnerable`: a `StatusFlag` gated in `runCombat`'s three damage sites, never a `damageTaken: 0` multiplier (the clamp floor is 0.4 — spec O7). The `fullStop` flag machinery already exists from Plan 1; this plan puts it on the `stunned` row, which is what makes Plan 1's interrupt sweep + full stop live in real matches through `thumper`'s existing stun.

**Tech Stack:** TypeScript 5.5, vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-01-weapon-status-overhaul-design.md` (decisions O4–O8). **Prerequisite: Plan 1 is fully landed** (`fullStop` flag, interrupt sweep, `contactHits`).

## Global Constraints

- Same as Plan 1's (shared `dist` rebuild before server/client tests; root `npm test` for verification; ms-authored durations; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).
- `STATUS_TABLE` is in the manual's `balanceStamp`: any table edit requires `npm run build:manual` + committing `packages/client/public/manual.html` in the same commit.
- `docs/turn-tuning.md` carries `overheated`'s `turnRate` by hand and `scripts/turn-tuning-doc.test.mjs` recomputes it — dropping the modifier owes that page (and possibly the script) an edit in the same commit.
- **Live behavior changes in this plan** (say so in the summary): `thumper`'s existing 450 ms stun becomes a full stop + interrupt; `bulwark`'s spiked becomes a 0.6 slow with no bleed; `bulwark`'s fortified loses its heal and ram-mass bonus; `afterburner`'s overheated stops degrading handling and starts burning.

---

### Task 1: `invulnerable` flag, damage gating, and the duration ceiling

**Files:**
- Modify: `packages/shared/src/config/status-types.ts` (flag union)
- Modify: `packages/shared/src/config/status-config.ts` (`maxDurationMs`)
- Modify: `packages/shared/src/config/status-config.test.ts`
- Modify: `packages/shared/src/sim/status/modifiers.ts` + `modifiers.test.ts`
- Modify: `packages/shared/src/sim/combat.ts` + `combat.test.ts`

**Interfaces:**
- Produces: `StatusFlag` gains `"invulnerable"`; `Modifiers.invulnerable: boolean` (`NEUTRAL_MODIFIERS: false`); every damage site in `runCombat` (pulses 0b, contact hits 0d, weapon hits phase 4) deals 0 to an invulnerable target while status riders still land; `STATUS_CONFIG.maxDurationMs === 10000`.

- [ ] **Step 1: Write the failing tests**

`status-config.test.ts`:

```ts
it("ceiling covers the longest authored application (wildcharge's 10s fortified, plan 3)", () => {
  expect(STATUS_CONFIG.maxDurationMs).toBe(10000);
});
```

`modifiers.test.ts`: extend the existing NEUTRAL assertions with `expect(NEUTRAL_MODIFIERS.invulnerable).toBe(false);` and, in whatever test already collapses a flag-carrying status (`stunned`), assert `invulnerable` stays false there.

`combat.test.ts` — the flag has no table row yet, so drive it through the wire-validated seam a future applier will use is impossible (`armored` lands in Task 2); instead this test is written NOW and turned green by Task 2's row — mark it `it.skip` in this task with a `// un-skip in Task 2` note, or (better) write Task 1 gating against a locally-constructed modifiers map by unit-testing the helper below:

Extract the gate as a pure exported helper so it is testable without a row:

```ts
it("dealDamageTo refuses hp from an invulnerable target but reports the hit", () => {
  const target = playerAt("b", 0, 0, 0);
  const before = target.hp;
  dealDamageTo(target, 40, { ...NEUTRAL_MODIFIERS, invulnerable: true });
  expect(target.hp).toBe(before);
  dealDamageTo(target, 40, NEUTRAL_MODIFIERS);
  expect(target.hp).toBe(before - 40);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/config/status-config.test.ts src/sim/status/modifiers.test.ts src/sim/combat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`status-types.ts` — add to `StatusFlag`:

```ts
  /**
   * Takes 0 damage — every source: weapon hits, contact hits, pulses (O7). A FLAG, deliberately
   * not `damageTaken: 0`: that channel's clamp floor is 0.4, and a floor exists so no stack of
   * debuffs can take the car off you — armour is a different statement, "damage is off", and it
   * is applier-owned risk exactly as stun duty cycle is. Status riders still land on an armored
   * car: armour stops hp loss, not consequences.
   */
  | "invulnerable"
```

`status-config.ts`: `maxDurationMs: 8000` → `10000`, comment amended: "Raised from 8000 for `wildcharge`'s 10 s fortified (spec); still bounds a status to roughly a fight's length."

`modifiers.ts`: `Modifiers.invulnerable: boolean`, `NEUTRAL_MODIFIERS.invulnerable: false`, `mods.invulnerable = flags.has("invulnerable");`.

`combat.ts` — replace the private `damage(player, amount)` calls at the three sites with one exported helper (keeps "one place decides whether hp moves in combat"):

```ts
/**
 * The only writer of `hp`/`alive` in combat. `invulnerable` zeroes the amount — the hit still
 * happened (pierce spent, statuses ride, the clock arms); only the hp change is refused.
 */
export function dealDamageTo(player: CombatPlayer, amount: number, mods: Readonly<Modifiers>): void {
  if (!mods.invulnerable) player.hp = applyDamage(player.hp, amount);
  if (player.hp === 0) player.alive = false;
}
```

Call sites: pulse damage (`dealDamageTo(player, pulse.damage, modsOf(player.sessionId))`), contact hits, and phase-4 weapon hits (`dealDamageTo(target, scaleDamage(hit.amount, mods.damageTaken), mods)` — resolve `modsOf(hit.sessionId)` once into a local). Delete the old private `damage`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): invulnerable flag gates every combat damage site; status ceiling to 10s"
```

---

### Task 2: The seven-row table

**Files:**
- Modify: `packages/shared/src/config/status-types.ts` (`StatusId` union)
- Modify: `packages/shared/src/config/status-config.ts` (`STATUS_TABLE`)
- Modify: `packages/shared/src/config/status-config.test.ts`
- Modify: `packages/shared/src/sim/status/modifiers.test.ts`, `statuses.test.ts`, `channels.test.ts`, `combat.test.ts` (wherever old row shapes are asserted — grep `overheated|spiked|fortified` under `packages/shared/src`)

**Interfaces:**
- Produces: `StatusId` gains `"armored"`; the table per the spec:

| Row | After this task |
|---|---|
| `overheated` | `modifiers: {}` + `pulse: { intervalMs: 400, damage: 8 }` (O4) |
| `corroded` | unchanged |
| `stunned` | flags gain `"fullStop"` (O6); rest unchanged |
| `spiked` | `modifiers: { topSpeed: 0.6 }`, no pulse |
| `fortified` | `modifiers: { damageTaken: 0.7 }`, no pulse (O5) |
| `overhauled` | unchanged |
| `armored` | NEW: buff, `#868e96`, `reapply: "refresh"`, `modifiers: {}`, `flags: ["invulnerable"]` (O7) |

- [ ] **Step 1: Write the failing tests** — replace the row-shape assertions in `status-config.test.ts` (find the existing per-row expectations and update, don't duplicate):

```ts
it("matches the overhaul table (spec 2026-09-01)", () => {
  expect(STATUS_TABLE.overheated.modifiers).toEqual({});
  expect(STATUS_TABLE.overheated.pulse).toEqual({ intervalMs: 400, damage: 8 });
  expect(STATUS_TABLE.spiked.modifiers).toEqual({ topSpeed: 0.6 });
  expect(STATUS_TABLE.spiked.pulse).toBeUndefined();
  expect(STATUS_TABLE.fortified.modifiers).toEqual({ damageTaken: 0.7 });
  expect(STATUS_TABLE.fortified.pulse).toBeUndefined();
  expect(STATUS_TABLE.stunned.flags).toEqual(["immobilised", "steeringLocked", "disarmed", "fullStop"]);
  expect(STATUS_TABLE.armored.flags).toEqual(["invulnerable"]);
  expect(STATUS_TABLE.armored.reapply).toBe("refresh");
});

it("keeps spiked's slow above the topSpeed clamp floor", () => {
  expect(STATUS_TABLE.spiked.modifiers.topSpeed!).toBeGreaterThan(STATUS_LIMITS.topSpeed.min);
});
```

Find the existing "flag rows must be `reapply: ignore`" test and give it the documented carve-out:

```ts
// O7: `armored` is the one refresh-able flag row. A repeatedly-refreshed invulnerability is a
// real design risk, owned by whatever future applier grants it — the same way stun duty cycle
// is the applier's problem, not the row's. Every OTHER flag row must still be `ignore`.
const FLAG_REAPPLY_EXEMPT: readonly StatusId[] = ["armored"];
```

Un-skip / add the end-to-end invulnerable test from Task 1's note in `combat.test.ts`, now through the real seam:

```ts
it("an armored car takes 0 from a landed shot but still receives its riders", () => {
  const target = playerAt("b", 50.5, 0, 0);
  target.statuses = applyStatus([], "armored", 99, 300, "");
  // Fire thumper at it (the file's existing landed-hit fixture pattern); assert hp unchanged
  // and `stunned` applied (the rider still rides). Statuses take hold next tick, so apply
  // `armored` with startTick before the combat tick under test.
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w @motor-combat-moba/shared -- src/config/status-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `status-types.ts` add `| "armored"` to `StatusId`. In `status-config.ts` rewrite the four rows and add:

```ts
  /**
   * Overheated is a pure burn now (O4): 8 hp per 400 ms is 20 hp/s — 30 hp over afterburner's
   * 1.5 s application, topped up while the target stays in the flame. The handling-debuff identity
   * this row shipped with left the game with the overhaul; the long comment arguing turnRate 0.65
   * vs 1.55 went with it (see git history and the 2026-08-29 status spec for the record).
   */
  overheated: {
    id: "overheated",
    name: "Overheated",
    kind: "debuff",
    color: "#d9480f",
    reapply: "refresh",
    modifiers: {},
    pulse: { intervalMs: 400, damage: 8 },
  },
```

```ts
  /**
   * Pure harsh slow (spec table): 0.6 topSpeed, no bleed — the bleed moved to `overheated`.
   * Above the 0.5 clamp floor, deliberately: the floor is the guarantee a car can always leave.
   */
  spiked: {
    id: "spiked",
    name: "Spiked",
    kind: "debuff",
    color: "#0c8599",
    reapply: "refresh",
    modifiers: { topSpeed: 0.6 },
  },
```

```ts
  /** Pure damage reduction (O5): 0.7x incoming. The heal and ramMass left with the overhaul. */
  fortified: {
    id: "fortified",
    name: "Fortified",
    kind: "buff",
    color: "#1971c2",
    reapply: "refresh",
    modifiers: { damageTaken: 0.7 },
  },
```

`stunned`: append `"fullStop"` to its `flags` array and update its comment: the "speed is deliberately NOT zeroed" paragraph is now false — replace with "Total stop (O6): `fullStop` zeroes speed each tick while shove and injected spin still resolve, so a slammed car still slides into the wall. Landing it also triggers the interrupt sweep — see `runCombat`."

```ts
  /**
   * Takes 0 damage (O7). No applier yet — the second pickup-tier row beside `overhauled`,
   * reachable through `statusRequests` the day something grants it. `refresh` breaks the
   * flag-rows-are-ignore rule with a documented carve-out: the risk of a refreshed
   * invulnerability belongs to its future applier.
   */
  armored: {
    id: "armored",
    name: "Armored",
    kind: "buff",
    color: "#868e96",
    reapply: "refresh",
    modifiers: {},
    flags: ["invulnerable"],
  },
```

Sweep the rest of the shared suite for assertions on the old shapes (grep `turnRate: 0.65`, `topSpeed: 0.82`, `ramMass: 1.25`, `heal: 12`, `intervalMs: 400` under `packages/shared/src` and fix each to the new table; `channels.test.ts` used overheated as the multi-channel example — re-anchor it on a row that still has modifiers, e.g. compose `corroded` + `fortified` for the damageTaken product).

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w @motor-combat-moba/shared`, then `npm run build -w @motor-combat-moba/shared && npm run test -w @motor-combat-moba/server && npm run test -w @motor-combat-moba/client`
Expected: PASS everywhere except `scripts/` tests (next task rebuilds the manual/turn-tuning page).

- [ ] **Step 5: Commit** (deliberately BEFORE the doc/manual step only if the root suite would pass — it will not, so hold the commit and do Task 3 in the same working tree, committing both together there).

---

### Task 3: Turn-tuning page, manual, and the combined commit

**Files:**
- Modify: `docs/turn-tuning.md`
- Check/Modify: `scripts/turn-tuning-doc.test.mjs`
- Regenerate: `packages/client/public/manual.html` (`npm run build:manual`)

- [ ] **Step 1: Read `scripts/turn-tuning-doc.test.mjs`** to learn exactly which cells it derives from `STATUS_TABLE.overheated`. Remove `overheated`'s row/column from the page's tables and from the script's expectations (the modifier is gone from the table, so the page must stop claiming it; the "Keeping this page honest" list in the page names `overheated`'s `turnRate` as an owed edit — update that list too). Re-read the page's PROSE for overheated numbers the test cannot see, per the project rule, and fix them.

- [ ] **Step 2: Rebuild the manual**

Run: `npm run build -w @motor-combat-moba/shared && npm run build:manual`
(The guide's status blurbs derive from `STATUS_TABLE`, so the page picks up every new row shape and the `armored` row.)

- [ ] **Step 3: Full verification**

Run: `npm test` (root) and `npm run typecheck`
Expected: PASS — including `scripts/turn-tuning-doc.test.mjs` and `scripts/manual-page.test.mjs`.

- [ ] **Step 4: Commit everything from Tasks 2–3 together**

```bash
git add packages/shared/src docs/turn-tuning.md scripts/turn-tuning-doc.test.mjs packages/client/public/manual.html
git commit -m "feat(shared): the overhaul status table — pure burn, pure slow, pure armor, full-stop stun, armored row"
```

---

### Task 4: Docs and the execution summary

**Files:**
- Modify: `docs/combat-model.md` — the Statuses section: the "Who applies what" table (still the OLD appliers until Plan 3 — update the durations/effects that changed, note Plan 3 re-tables it), the stunned paragraphs (coast-down reasoning replaced by full stop + interruption), the pulse examples (burn is overheated's now), cleanse/fortified prose (no heal in the game).
- Modify: `docs/config-reference.md` — the `STATUS_TABLE` section to the new rows.
- Modify: `packages/shared/CLAUDE.md` — the statuses paragraph (armored, invulnerable, full-stop stun).

- [ ] **Step 1: Make the edits**, verifying each claim against the shipped code, not this plan.

- [ ] **Step 2: Verify**: `npm test` (root). Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs packages/shared/CLAUDE.md
git commit -m "docs: status table overhaul — full-stop stun, pure burn/slow/armor, armored row"
```

- [ ] **Step 4: Execution summary must flag, loudly:**
  - **Live behavior changes** (the four listed in Global Constraints — thumper's stun is now a full stop that cancels wind-ups, kills attached beams and ends maneuvers in today's matches).
  - **Playtest flag (project rule):** `STATUS_TABLE` is squarely in what the probes measure; the W7 stun-duty-cycle probe's semantics changed (same duration, far stronger stun). Recommend `npm run playtest`; do not run or edit probes unbidden (compile breaks excepted).
  - `npm run ttk` reads the tables — spiked/fortified/overheated changes move its numbers; recommend a run for the record.
  - The manual was rebuilt; `docs/turn-tuning.md` lost its overheated row.

---

## Self-review (performed while writing)

- **Spec coverage:** O4 (Task 2 overheated), O5 (fortified), O6 (stunned fullStop — mechanism from Plan 1, row here), O7 (armored + invulnerable, Task 1–2), the maxDurationMs prerequisite for the spec's fortified 10 s (Task 1). Appliers/durations move in Plan 3 with the weapon rows, per the spec's sequencing.
- **Consistency:** `dealDamageTo(player, amount, mods)` is the one name used in Tasks 1–2; the flag list order in the stunned expectation matches the authored array order.
- **Placeholders:** none; the one deliberately deferred test (armored end-to-end) is written in Task 2 where its row exists.
