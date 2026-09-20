# Variable weapon slots — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a chassis carry 1–4 ability weapons instead of exactly 3, gated by a build-time slot count `N` (1–4, default 3) that decides how many ability slots the shipped build actually has.

**Architecture:** Two numbers replace one. `ABILITY_SLOT_CEILING` (4) is structural and sizes the key table, the mask width and the type bounds; `WEAPON_SLOT_CONFIG.maxAbilitySlots` is `N`, the build-time knob. The basic attack moves from fire slot `kit.length` to fire slot **0**, which is what makes its index a true constant at every kit length and therefore what makes variable kits possible without its key changing per chassis. `beginFire`'s scan reverses to highest-index-wins so the basic attack still loses a same-tick tie. At `N = 3` the shipped game is byte-for-byte unchanged in behaviour: every existing binding fires the same weapon and the HUD is pixel-identical.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared` / `server` / `client`), Vitest, Colyseus schema, Phaser 4. Manual generator and offline harnesses are plain `.mjs` run under Node.

**Spec:** [`docs/superpowers/specs/2026-09-20-variable-weapon-slots-design.md`](../specs/2026-09-20-variable-weapon-slots-design.md) (VS1–VS34)

## Global Constraints

- **`ABILITY_SLOT_CEILING = 4`.** Structural. Never edited as a tuning act. (VS1)
- **`N` default is 3**, named `WEAPON_SLOT_CONFIG.maxAbilitySlots`, range `1 <= N <= 4`. (VS2, VS4)
- **`maxFireSlots = N + 1` and `basicAttackSlotIndex = 0` are DERIVED, never typed.** (VS3)
- **`N` is build-time.** No env var, join option, playground control, or tuning-store entry. (VS5)
- **Fire-slot order is `[basicAttack, ...kit]`.** (VS6)
- **`beginFire` scans highest index first.** (VS12)
- **No magic numbers in logic** — hard invariant 2. Layout offsets get named constants.
- **Every function whose behaviour depends on `N` takes it as a parameter**, and is re-exported with the live value bound — the `hintSlotOrder(enabled)` / `HINT_SLOT_ORDER` shape. Production reads the bound form; tests call the parameterised one across `N = 1..4`. (VS-testing)
- **Rebuild order is shared → server → client.** Use root `npm run build`, never `npm run build --workspaces`. After editing shared, rebuild it before running server or client code.
- **`npm test` from the repo root is the gate** for every task.
- **Do not touch `docs/ideas/` or `docs/invariants/`.** Exclude them from any sweep.
- **No `CAR_TABLE` or `WEAPON_TABLE` row is added, removed or retuned by this plan.** (VS1.1)

---

### Task 1: Slot config foundation — the ceiling, `N`, and a parameterised `slotsFrom`

Purely additive. `N = 3` produces exactly today's numbers (`maxFireSlots` 4, `basicAttackSlotIndex` 3), so nothing changes behaviourally. This task only separates the structural ceiling from the tunable count and makes the truncation testable at other counts.

**Files:**
- Modify: `packages/shared/src/config/weapon-slots.ts`
- Test: `packages/shared/src/config/weapon-slots.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const ABILITY_SLOT_CEILING = 4`
  - `WEAPON_SLOT_CONFIG: { maxAbilitySlots: number; maxFireSlots: number; basicAttackSlotIndex: number }` — values `3, 4, 3` after this task.
  - `export function slotsFrom(carId: string, weapons: readonly WeaponId[], max?: number): readonly WeaponId[]` — `max` defaults to `WEAPON_SLOT_CONFIG.maxAbilitySlots`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/config/weapon-slots.test.ts`:

```ts
describe("the slot count", () => {
  it("separates the structural ceiling from the tunable count", () => {
    // VS1/VS2. The ceiling sizes the key table, the mask width and the type bounds and is never a
    // tuning act; `maxAbilitySlots` is the build-time knob a designer moves.
    expect(ABILITY_SLOT_CEILING).toBe(4);
    expect(WEAPON_SLOT_CONFIG.maxAbilitySlots).toBeGreaterThanOrEqual(1);
    expect(WEAPON_SLOT_CONFIG.maxAbilitySlots).toBeLessThanOrEqual(ABILITY_SLOT_CEILING);
  });

  it("derives the fire-slot count rather than typing it", () => {
    // VS3. Typed separately, the two could disagree with N and with each other.
    expect(WEAPON_SLOT_CONFIG.maxFireSlots).toBe(WEAPON_SLOT_CONFIG.maxAbilitySlots + 1);
  });

  it("truncates to a caller-given max so the rule is testable at every N", () => {
    // VS-testing. `maxAbilitySlots` is build-time and a test cannot move it, so the rule has to be
    // reachable through a parameter or it can only ever be exercised at the shipped value.
    const four = ["predator", "pepperbox", "lance", "tremor"] as const;
    expect(slotsFrom("bullseye", four, 1)).toEqual(["predator"]);
    expect(slotsFrom("bullseye", four, 2)).toEqual(["predator", "pepperbox"]);
    expect(slotsFrom("bullseye", four, 4)).toEqual([...four]);
  });

  it("caps a roster kit at N, so slotsOf answers what the PLAYER sees", () => {
    // VS10. `slotsOf` is what the HUD, the guide, the playground picker, the balance seat filter,
    // ttk's attacker axis and the bot's reach model all read. They ask "what kit was this chassis
    // designed around", and with N in play the honest answer is the truncated one — a weapon the
    // build cannot fire is not part of the kit the player experiences.
    for (const id of Object.keys(CAR_TABLE) as CarId[]) {
      expect(slotsOf(id).length).toBeLessThanOrEqual(WEAPON_SLOT_CONFIG.maxAbilitySlots);
    }
  });

  it("warns only when a kit exceeds the CEILING, not merely N", () => {
    // VS11. A chassis authoring four weapons in an N=3 build is the DESIGNED case, not a mistake:
    // warning on it would log on every boot. Only a kit past the ceiling is an authoring error.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const four = ["predator", "pepperbox", "lance", "tremor"] as const;

    expect(slotsFrom("quiet-car", four, 2)).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();

    const five = [...four, "thumper"] as const;
    expect(slotsFrom("loud-car", five, 4)).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("loud-car");
  });
});
```

Update the import at the top of the file to add `ABILITY_SLOT_CEILING`:

```ts
import { ABILITY_SLOT_CEILING, WEAPON_SLOT_CONFIG, slotsOf, slotsFrom, fireSlotsOf } from "./weapon-slots.js";
```

The existing test `"truncates an over-long loadout to the slot limit and warns once, naming the car"` passes a 4-element list and expects a warning. Under VS11 that list is now within the ceiling and must NOT warn. Change its input to five elements and its expectation to `ABILITY_SLOT_CEILING`:

```ts
  it("truncates a past-the-ceiling loadout and warns once, naming the car", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const over = ["magmablast", "magmablast", "magmablast", "magmablast", "magmablast"] as const;

    const first = slotsFrom("bastion", over, ABILITY_SLOT_CEILING);
    const second = slotsFrom("bastion", over, ABILITY_SLOT_CEILING);

    expect(first).toHaveLength(ABILITY_SLOT_CEILING);
    expect(second).toHaveLength(ABILITY_SLOT_CEILING);
    expect(warn).toHaveBeenCalledTimes(1); // once per car, not once per call
    expect(warn.mock.calls[0]![0]).toContain("bastion");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @motor-combat-moba/shared -- weapon-slots`
Expected: FAIL — `ABILITY_SLOT_CEILING` is not exported.

- [ ] **Step 3: Implement**

Replace the top of `packages/shared/src/config/weapon-slots.ts` (the `MAX_ABILITY_SLOTS` const, the `WEAPON_SLOT_CONFIG` object, and `slotsFrom`) with:

```ts
/**
 * The STRUCTURAL ceiling: how many ability slots the game is BUILT for, as opposed to how many this
 * build turns on. It sizes `SLOT_KEYS`, bounds the wire mask's width, and is the upper bound
 * `maxAbilitySlots` is validated against. It is not a balance number and no skill edits it —
 * raising it is its own piece of work, because the HUD gutter has no room above 4 (VS21).
 */
export const ABILITY_SLOT_CEILING = 4;

/**
 * The BUILD-TIME ability-slot count, `N`. 1 to `ABILITY_SLOT_CEILING`, default 3.
 *
 * A chassis may author more weapons than this; the extras stay in `CAR_TABLE` and are simply not
 * reachable in this build — not fired, not drawn, not taught, not published (VS2). Flip it with the
 * `ability-slot-count` skill, which walks every step the change owes.
 */
const ABILITY_SLOTS = 3;

/**
 * The slot counts, and the difference between them.
 *
 * `maxAbilitySlots` is `N`: how many weapons a chassis's KIT may present in this build. The server
 * rejects an ability fire at or beyond this index and the HUD draws at most this many boxes.
 *
 * `maxFireSlots` is how many weapons a car can actually fire: the kit plus its basic attack (BA11).
 * `basicAttackSlotIndex` is 0 — the basic attack is FIRST, which is what keeps it a true constant at
 * every kit length (VS5/VS6). Both are derived, never typed, so they cannot disagree with `N`.
 */
export const WEAPON_SLOT_CONFIG = {
  maxAbilitySlots: ABILITY_SLOTS,
  maxFireSlots: ABILITY_SLOTS + 1,
  basicAttackSlotIndex: ABILITY_SLOTS,
} as const;

/** Cars already warned about, so an over-long loadout logs once rather than once per tick. */
const warned = new Set<string>();

/**
 * A car's loadout, capped at `max` (default: this build's `N`).
 *
 * Two different over-lengths, deliberately handled differently (VS11):
 *
 * - Longer than `ABILITY_SLOT_CEILING` — an authoring error. Warn once per car, naming it.
 * - Within the ceiling but longer than `max` — the DESIGNED case. A chassis may author four weapons
 *   and run in an `N = 3` build; warning on that would log on every boot for a configuration that
 *   is working exactly as intended. Truncate silently.
 *
 * `max` is a parameter rather than a direct config read so the rule is reachable at every `N`:
 * `maxAbilitySlots` is build-time and no test can move it.
 */
export function slotsFrom(
  carId: string,
  weapons: readonly WeaponId[],
  max: number = WEAPON_SLOT_CONFIG.maxAbilitySlots,
): readonly WeaponId[] {
  if (weapons.length > ABILITY_SLOT_CEILING && !warned.has(carId)) {
    warned.add(carId);
    console.warn(
      `[weapons] car "${carId}" lists ${weapons.length} weapons but the ceiling is ` +
        `${ABILITY_SLOT_CEILING}; ignoring: ${weapons.slice(ABILITY_SLOT_CEILING).join(", ")}`,
    );
  }
  return weapons.length <= max ? weapons : weapons.slice(0, max);
}
```

Leave `slotsOf` and `fireSlotsOf` untouched in this task — `slotsOf` already calls `slotsFrom`, which now defaults to `N`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @motor-combat-moba/shared -- weapon-slots`
Expected: PASS, all cases.

- [ ] **Step 5: Full suite**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS. Nothing else reads `MAX_ABILITY_SLOTS` (it was module-private) and every derived value is unchanged at `N = 3`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/config/weapon-slots.ts packages/shared/src/config/weapon-slots.test.ts
git commit -m "feat(slots): split the structural ceiling from the build-time slot count

ABILITY_SLOT_CEILING (4) sizes the key table, the mask width and the type
bounds; WEAPON_SLOT_CONFIG.maxAbilitySlots is N, the build-time knob,
default 3. slotsFrom takes its cap as a parameter so the truncation rule
is reachable at every N, and warns only when a kit exceeds the CEILING —
a chassis authoring four weapons in an N=3 build is the designed case,
not an authoring error.

No derived value moves at N=3. VS1-VS4, VS11."
```

---

### Task 2: The index flip — basic attack to fire slot 0, end to end

**This task must land as one commit.** Flipping shared's order without the client's key table would leave every suite green while `H` fired nothing — the precise failure mode that makes a partial flip worse than no flip.

**Files:**
- Modify: `packages/shared/src/config/weapon-slots.ts` (`basicAttackSlotIndex`, `fireSlotsOf`)
- Modify: `packages/shared/src/sim/weapons/fire.ts:~100` (`newFireState`'s order)
- Modify: `packages/server/src/sim/combat-bridge.ts:169-170` (`loadoutFor`'s order)
- Modify: `packages/server/src/bot/brain/firing.ts:258` (comment only — the constant moved)
- Modify: `packages/client/src/config/slot-keys.ts` (`SLOT_KEYS`, `hintSlotOrder`)
- Modify: `packages/client/src/scenes/ArenaScene.ts:~2875` (the HUD's ability offset)
- Test: `packages/shared/src/config/weapon-slots.test.ts`, `packages/shared/src/sim/weapons/fire.test.ts`, `packages/client/src/config/slot-keys.test.ts`, `packages/client/src/scenes/movement-hint.test.ts`

**Interfaces:**
- Consumes: `WEAPON_SLOT_CONFIG`, `ABILITY_SLOT_CEILING` from Task 1.
- Produces:
  - `WEAPON_SLOT_CONFIG.basicAttackSlotIndex === 0`
  - `fireSlotsOf(carId)` returns `[basicAttackOf(carId), ...slotsOf(carId)]`
  - `SLOT_KEYS` is `ABILITY_SLOT_CEILING + 1` entries, index 0 = basic attack
  - `hintSlotOrder(enabled: boolean): readonly number[]` — `[0,1,2,3]` / `[1,2,3]` after this task

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/config/weapon-slots.test.ts`, inside the `"the slot count"` describe:

```ts
  it("puts the basic attack at fire slot 0, before the kit", () => {
    // VS6. Under the old order the basic attack sat at `kit.length`, a constant only because every
    // active kit was the same length. Once kits vary, `kit.length` varies, and the key that fires
    // the basic attack would change when the player changed chassis. At index 0 it is a true
    // constant at every kit length.
    expect(WEAPON_SLOT_CONFIG.basicAttackSlotIndex).toBe(0);
    expect(fireSlotsOf("bastion")).toEqual([
      basicAttackOf("bastion"),
      "thumper",
      "roadblock",
      "wildcharge",
    ]);
  });
```

In `packages/shared/src/sim/weapons/fire.test.ts`:

```ts
  it("builds its slots with the basic attack first", () => {
    // VS6/VS9. `newFireState`'s explicit-loadout path builds this order inline rather than calling
    // `fireSlotsOf`, so it needs its own assertion or the two can silently diverge.
    const state = newFireState("bastion", 1);
    expect(state.slots.map((s) => s.weaponId)).toEqual([
      basicAttackOf("bastion"),
      "thumper",
      "roadblock",
      "wildcharge",
    ]);
  });

  it("puts the basic attack first on an explicit playground loadout too", () => {
    const state = newFireState("bastion", 1, ["lance", "predator"]);
    expect(state.slots.map((s) => s.weaponId)).toEqual([
      basicAttackOf("bastion"),
      "lance",
      "predator",
    ]);
  });
```

In `packages/client/src/config/slot-keys.test.ts`:

```ts
  it("binds slot 0 to the basic attack and the abilities after it", () => {
    // VS15. Every binding a player already uses fires the same weapon it fired before: H/LMB was
    // slot 3 and is now slot 0; J/RMB was 0 and is now 1; K/SHIFT was 1 and is now 2; L/SPACE was
    // 2 and is now 3. The renumbering is internal.
    expect(SLOT_KEYS.map((k) => k.keyGlyph)).toEqual(["H", "J", "K", "L", ";"]);
    expect(SLOT_KEYS.map((k) => k.glyph)).toEqual(["LMB", "RMB", "SHIFT", "SPACE", "MMB"]);
  });

  it("is ceiling-length at every N, so the table never has to grow again", () => {
    // VS16. `slotMaskFrom` limits its own scan to `maxFireSlots`, so rows past N are simply never
    // read into a mask — the key for a slot this build does not have does nothing.
    expect(SLOT_KEYS).toHaveLength(ABILITY_SLOT_CEILING + 1);
  });

  it("narrows the mask with N, so an unavailable slot cannot be pressed", () => {
    // VS18. `SLOT_MASK` in the server's tick derives from `maxFireSlots`, so it narrows with N by
    // construction; `slotMaskFrom` limits its own scan the same way. A hand-rolled client cannot
    // press a slot this build does not have.
    const all = [true, true, true, true, true];
    expect(slotMaskFrom(all, 0)).toBe((1 << WEAPON_SLOT_CONFIG.maxFireSlots) - 1);
  });

  it("reads the basic attack's mouse button on bit 0", () => {
    expect(slotMaskFrom([], 1)).toBe(0b0001); // LMB -> basic attack
    expect(slotMaskFrom([], 2)).toBe(0b0010); // RMB -> ability 1
  });
```

In `packages/client/src/scenes/movement-hint.test.ts`, replace the two `ACTION_KEYS`/`ACTION_ALTS` assertions:

```ts
    expect(ACTION_KEYS).toEqual(["H", "J", "K", "L"]);
    expect(ACTION_ALTS).toEqual(["LMB", "RMB", "SHIFT", "SPACE"]);
```

The printed row is unchanged — the basic attack was already taught first — but it now comes from `[0,1,2,3]` rather than `[3,0,1,2]`. Add an assertion that says so, and relax the two set-equality checks, which would now fail because `SLOT_KEYS` carries a fifth row the `N = 3` hint does not print:

```ts
    expect(hintSlotOrder(true)).toEqual([0, 1, 2, 3]);
    expect(hintSlotOrder(false)).toEqual([1, 2, 3]);
    // Subset, not equality: SLOT_KEYS is ceiling-length while the hint prints this build's N.
    for (const glyph of ACTION_ALTS) expect(SLOT_KEYS.map((k) => k.glyph)).toContain(glyph);
    for (const glyph of ACTION_KEYS) expect(SLOT_KEYS.map((k) => k.keyGlyph)).toContain(glyph);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `basicAttackSlotIndex` is 3, `fireSlotsOf` returns kit-first, `SLOT_KEYS` has 4 rows.

- [ ] **Step 3: Flip shared's order**

In `packages/shared/src/config/weapon-slots.ts`, change the config's index and `fireSlotsOf`:

```ts
export const WEAPON_SLOT_CONFIG = {
  maxAbilitySlots: ABILITY_SLOTS,
  maxFireSlots: ABILITY_SLOTS + 1,
  /**
   * The basic attack is FIRST, so its index is 0 on every chassis at every kit length (VS6). It
   * used to be last, at `kit.length`, which was a constant only for as long as every active kit
   * was the same length — the moment kits vary, a last-placed basic attack answers to a different
   * key on each car.
   */
  basicAttackSlotIndex: 0,
} as const;
```

Replace `fireSlotsOf`'s body (keep its long doc comment, but correct the order it describes):

```ts
export function fireSlotsOf(carId: CarId): readonly WeaponId[] {
  return [basicAttackOf(carId), ...slotsOf(carId)];
}
```

`fireSlotsOf`'s documented reader list (balance `stats.ts`, `scripts/ttk.mjs` ×2,
`duel.fixture.ts` ×2, the playtest probes) is unchanged in MEMBERSHIP — only the order those
readers see moves (VS8). Do not add or remove a reader here.

In `packages/shared/src/sim/weapons/fire.ts`, in `newFireState`:

```ts
  // The basic attack FIRST, then the kit (VS6). An explicit playground loadout overrides the
  // ability slots and nothing else: the basic attack is a property of the chassis, not of the
  // loadout, so it is prepended either way and the settings panel never offers it.
  const kit = weaponIds ? slotsFrom(carId, weaponIds) : isCarId(carId) ? slotsOf(carId) : [];
  const weapons = isCarId(carId) ? [basicAttackOf(carId), ...kit] : kit;
```

In `packages/server/src/sim/combat-bridge.ts`, in `loadoutFor`:

```ts
  const kit = explicit ? slotsFrom(carId, explicit) : isCarId(carId) ? slotsOf(carId) : [];
  return isCarId(carId) ? [basicAttackOf(carId), ...kit] : kit;
```

- [ ] **Step 4: Reindex the client's key table**

Replace `SLOT_KEYS` in `packages/client/src/config/slot-keys.ts`:

```ts
export const SLOT_KEYS = [
  { codes: [72], buttonsMask: 1, glyph: "LMB", keyGlyph: "H" },
  { codes: [74], buttonsMask: 2, glyph: "RMB", keyGlyph: "J" },
  { codes: [75, 16], buttonsMask: 0, glyph: "SHIFT", keyGlyph: "K" },
  { codes: [76, 32], buttonsMask: 0, glyph: "SPACE", keyGlyph: "L" },
  { codes: [186], buttonsMask: 4, glyph: "MMB", keyGlyph: ";" },
] as const;
```

Update its doc comment's opening line to `0 is the basic attack, 1..N are the ability kit (VS15)`, and note that `;` extends the `H J K L` home-row run one key right and MMB (`MouseEvent.buttons` bit value 4) is the only mouse button still free. `"SHIFT"` remains the widest label at five characters, so `SLOT_KEY_COLUMN_PX` does not need re-measuring — `"MMB"` is three.

Replace `hintSlotOrder`:

```ts
export function hintSlotOrder(enabled: boolean, abilities = WEAPON_SLOT_CONFIG.maxAbilitySlots): readonly number[] {
  const slots = Array.from({ length: abilities }, (_, i) => i + 1);
  return enabled ? [0, ...slots] : slots;
}
```

- [ ] **Step 5: Offset the HUD's ability read**

In `packages/client/src/scenes/ArenaScene.ts`, `renderWeaponHud`. The bar draws ABILITY slots, and the basic attack is now the array's FIRST element rather than its last, so the old `min(count, maxAbilitySlots)` clamp would drop ability `N` and draw the basic attack instead (VS22). Pass the ability count and offset the read by one:

```ts
    const player = this.hudTargetPlayer(room);
    // The ability count, not the array length: the fire-slot array is `[basicAttack, ...kit]`, and
    // the bar draws the kit (BA15). `max(0, …)` because a player with no chassis has no slots at
    // all, not a basic attack alone.
    const abilityCount = player ? Math.max(0, player.weapons.length - 1) : 0;
    const boxes = player
      ? slotBarLayout(abilityCount, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, topInset)
      : [];

    for (let i = 0; i < this.hudKeyTexts.length; i++) {
      const box = boxes[i];
      // +1: ability i is fire slot i+1, because fire slot 0 is the basic attack (VS23).
      const slot = player && box ? player.weapons.at(i + 1) : undefined;
```

Then find every other place in `renderWeaponHud` and its helpers that indexes `player.weapons` or `SLOT_KEYS` by the ability loop counter `i`, and apply the same `+ 1`. Search with:

```bash
grep -n "weapons.at(\|SLOT_KEYS\[" packages/client/src/scenes/ArenaScene.ts
```

Every hit inside the ability-slot loop takes `i + 1`; hits outside it do not.

- [ ] **Step 6: Suppress middle-click autoscroll**

MMB is the browser's autoscroll trigger: without this, pressing ability 4 starts an autoscroll drag
over the canvas (VS17). `ArenaScene` already suppresses the right button's context menu at
`packages/client/src/scenes/ArenaScene.ts:954` with `this.input.mouse?.disableContextMenu()`; Phaser
has no equivalent for the middle button, so add a listener beside that call:

```ts
    this.input.mouse?.disableContextMenu();
    // The middle button is ability 4's binding (VS15/VS17). Left alone it starts the browser's
    // autoscroll drag over the canvas, which is the same class of problem `disableContextMenu`
    // solves for the right button and `addKey` solves for Space.
    this.game.canvas.addEventListener("mousedown", (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    });
```

Verify by hand in Step 10 — no unit test can observe a browser default.

- [ ] **Step 7: Correct the bot's comment**

`packages/server/src/bot/brain/firing.ts:258` reads `if (i === WEAPON_SLOT_CONFIG.basicAttackSlotIndex && !BASIC_ATTACK_CONFIG.enabled) continue;`. The line is correct as written — it reads the constant — but its comment says "a disabled basic attack never becomes the bot's one press". Add that the constant is now 0 rather than last, so a reader does not assume it still guards the tail.

- [ ] **Step 8: Run the full suite**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS. Fix any test that asserted the old order by correcting the ORDER it expects — never by loosening it to ignore order.

- [ ] **Step 9: Verify the built server bundle actually carries the change**

Run: `npm run build && grep -c "basicAttackSlotIndex" packages/server/dist/index.js`
Expected: at least 1. Then confirm the inlined shared path is the local one, not an escaped worktree:

Run: `grep -o "// \.\..*shared/dist/[a-z-]*\.js" packages/server/dist/index.js | head -3`
Expected: paths beginning `// ../shared/dist/`. If they begin `// ../../../../../packages/shared/dist/`, run `npm install` at the repo root and rebuild — the build is inlining another checkout's shared.

- [ ] **Step 10: Verify the two mouse bindings by hand**

Run: `npm run build && npm run dev`, join a practice match. Left-click fires the basic attack; middle-click fires ability 4 at `N = 4` and does nothing at `N = 3` — and in neither case does the page start an autoscroll drag.

- [ ] **Step 11: Commit**

```bash
git add -A packages/shared packages/server packages/client
git commit -m "feat(slots): move the basic attack to fire slot 0

Under the old order it sat at kit.length, a constant only because every
active kit was the same length. Once kits vary that index varies, and the
key firing the basic attack would change with the chassis. At index 0 it
is a true constant at every kit length and the fire-slot array stays
dense.

Shared, server and client move together on purpose: flipping the order
without the key table would leave every suite green while H fired
nothing. Every binding a player already uses fires the same weapon it
fired before; the renumbering is internal. SLOT_KEYS gains its
ceiling-length fifth row (semicolon / MMB) for ability 4.

VS6-VS9, VS15, VS16, VS22, VS23."
```

---

### Task 3: Highest-index-wins, so the basic attack still loses a tie

**Files:**
- Modify: `packages/shared/src/sim/weapons/fire.ts:250-256` (`beginFire`'s scan)
- Test: `packages/shared/src/sim/weapons/fire.test.ts`

**Interfaces:**
- Consumes: `basicAttackSlotIndex === 0` from Task 2.
- Produces: no signature change. `beginFire`'s tie semantics reverse.

- [ ] **Step 1: Write the failing tests**

```ts
describe("same-tick tie-breaking", () => {
  it("lets the basic attack lose a tie to an ability, from index 0", () => {
    // VS12. The rule is unchanged from the build where the basic attack sat LAST and lost by being
    // the highest index; at index 0 it loses by being the lowest, which is why the scan reversed.
    const state = newFireState("bastion", 1);
    const mask = 0b0011; // basic attack (slot 0) + ability 1 (slot 1)
    const after = beginFire("s1", state, mask, 0);
    expect(after.pending?.slot).toBe(1);
    expect(after.pending?.weaponId).toBe("thumper");
  });

  it("fires the basic attack when it is the only bit set", () => {
    const state = newFireState("bastion", 1);
    const after = beginFire("s1", state, 0b0001, 0);
    expect(after.pending?.slot).toBe(0);
    expect(after.pending?.weaponId).toBe(basicAttackOf("bastion"));
  });

  it("gives the HIGHEST ability the tie, not the lowest", () => {
    // VS13. Accepted consequence of VS12, asserted rather than discovered: a player mashing every
    // key burns their largest cooldown instead of their smallest. Recorded here so a future reader
    // finds a decision, not a bug.
    const state = newFireState("bastion", 1);
    const after = beginFire("s1", state, 0b1111, 0);
    expect(after.pending?.weaponId).toBe("wildcharge");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @motor-combat-moba/shared -- fire`
Expected: FAIL — the ascending scan returns slot 0 / `thumper`.

- [ ] **Step 3: Reverse the scan**

In `beginFire`, replace the loop header and its comment:

```ts
  // HIGHEST set bit the car can actually use wins (VS12). The basic attack sits at index 0, so
  // scanning downward is what makes it lose a same-tick tie to an ability — the behaviour it had
  // when it was the LAST slot and an ascending scan reached an ability first. The consequence among
  // abilities is deliberate and recorded as VS13: the highest ability wins, so mashing every key
  // fires the largest cooldown rather than the smallest.
  const usable = Math.min(state.slots.length, WEAPON_SLOT_CONFIG.maxFireSlots);
  for (let index = usable - 1; index >= 0; index--) {
```

The loop body is unchanged. In particular `pressId` stays `sessionId#tick#slot` and
`lastFiredSlot` stays slot identity rather than weapon id (VS14): renumbering the indices changes
the STRINGS a press mints, which is harmless because `pressId` is sim-only, never networked, and
never compared across builds.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @motor-combat-moba/shared -- fire`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS. If a bot or balance test moves here, stop — `controller.ts` emits `1 << slot`, exactly one bit, so a bot cannot present a tie. A moved bot test means something else changed and needs diagnosing, not re-baselining.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sim/weapons/fire.ts packages/shared/src/sim/weapons/fire.test.ts
git commit -m "feat(slots): break a same-tick tie by highest slot, not lowest

The basic attack kept losing a tie to an ability by being the highest
index; at index 0 it would start winning them, so a player holding LMB
would have every ability press eaten. Reversing the scan restores the
documented behaviour through the index that moved.

Among abilities the highest now wins, so mashing every key fires the
largest cooldown rather than the smallest. Deliberate, and asserted.

VS12, VS13."
```

---

### Task 4: Top-anchor the HUD slot stack

**Files:**
- Modify: `packages/client/src/scenes/weapon-hud.ts` (`slotBarLayout`, a new named constant)
- Test: `packages/client/src/scenes/weapon-hud.test.ts`

**Interfaces:**
- Consumes: `slotBarLayout(count, viewWidth, viewHeight, gutterWidth, topInset)` — signature unchanged.
- Produces: `export const SLOT_STACK_TOP_GAP_PX` — the stack's offset below the roster panel.

The current layout CENTRES the stack in the column below the roster panel, so adding a box pushes the stack UP. The status strip is anchored to the stack's top and grows upward, so at 4 boxes the strip climbs 46 px into a roster panel it currently clears by 11 px. Top-anchoring fixes that and buys two further properties: the strip's clearance becomes independent of the count, and ability 1 keeps the same screen position on every chassis instead of jumping when the player switches car (VS20).

- [ ] **Step 1: Write the failing tests**

Add to `packages/client/src/scenes/weapon-hud.test.ts`:

```ts
describe("the slot stack's anchor", () => {
  const at = (count: number) =>
    slotBarLayout(count, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, 138);

  it("puts the stack's top in the same place at every count", () => {
    // VS20. Centring made the top move with the count, which pushed the badge strip into the
    // roster panel at four boxes and made ability 1 jump when the player switched chassis.
    expect(at(1)[0]!.y).toBe(at(2)[0]!.y);
    expect(at(2)[0]!.y).toBe(at(3)[0]!.y);
    expect(at(3)[0]!.y).toBe(at(4)[0]!.y);
  });

  it("lands exactly where the centred 3-slot layout used to", () => {
    // The anchor's VALUE is chosen for this: at N=3 the HUD is pixel-identical to the build before
    // this change, so nothing about the shipped game's appearance moves.
    expect(at(3)[0]!.y).toBe(305);
  });

  it("fits four slots inside the view and would not fit five", () => {
    // VS21. Four is the layout's limit as well as the config's. Writing the overflow down is what
    // makes raising ABILITY_SLOT_CEILING fail loudly instead of clipping a label off-screen.
    expect(at(4).at(-1)!.nameY + SLOT_NAME_FONT_PX).toBeLessThanOrEqual(VIEW_HEIGHT);
    const five = slotBarLayout(5, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, 138);
    expect(five.at(-1)!.nameY + SLOT_NAME_FONT_PX).toBeGreaterThan(VIEW_HEIGHT);
  });
});
```

In the existing `"the gutter budget"` describe, add a case proving the strip's clearance survives a fourth box:

```ts
  it("keeps the badge strip clear of the panel at four slots too", () => {
    const four = slotBarLayout(4, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, panel.height);
    const wide = statusStripLayout(
      STATUS_CONFIG.maxActive, VIEW_WIDTH, VIEW_HEIGHT, HUD_GUTTER_WIDTH, four[0]!.y,
    );
    expect(wide[0]!.y - panel.height).toBe(11);
  });
```

Note `slotBarLayout(5, …)` must actually return five boxes for the overflow assertion to mean anything, so its internal `min(count, maxAbilitySlots)` clamp has to go — the caller now passes the ability count and the clamp was only ever doing the basic attack's exclusion by accident (VS22).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @motor-combat-moba/client -- weapon-hud`
Expected: FAIL — tops differ by count, and `at(5)` returns 3 boxes.

- [ ] **Step 3: Implement**

Beside the other layout constants in `packages/client/src/scenes/weapon-hud.ts`:

```ts
/**
 * How far below the roster panel the slot stack starts (VS20).
 *
 * The stack is TOP-ANCHORED, not centred. Centring made the top move with the slot count: a fourth
 * box pushed the stack up 46 px, and since `statusStripLayout` anchors to the stack's top and grows
 * UPWARD, the badge strip climbed into a roster panel it clears by only 11 px. Anchoring also keeps
 * ability 1 in one place on screen whatever chassis the player drives.
 *
 * The value is what the old centred 3-slot layout produced at the shipped constants, so the HUD is
 * pixel-identical at N = 3. It is expressed as a gap below `topInset` rather than as an absolute y
 * so it still tracks `rosterPanelLayout` if the panel's height ever changes.
 */
export const SLOT_STACK_TOP_GAP_PX = 167;
```

Replace `slotBarLayout`'s body:

```ts
export function slotBarLayout(
  count: number,
  viewWidth: number,
  viewHeight: number,
  gutterWidth: number,
  topInset: number,
): SlotBox[] {
  if (count <= 0) return [];
  const top = topInset + SLOT_STACK_TOP_GAP_PX;
  const groupWidth = SLOT_BOX_PX + SLOT_KEY_GAP_PX + SLOT_KEY_COLUMN_PX;
  const x = viewWidth - gutterWidth + (gutterWidth - groupWidth) / 2;
  return Array.from({ length: count }, (_, i) => {
    const y = top + i * (SLOT_BOX_PX + GAP_PX);
    return {
      x,
      y,
      size: SLOT_BOX_PX,
      keyX: x + SLOT_BOX_PX + SLOT_KEY_GAP_PX,
      nameY: y + SLOT_BOX_PX + SLOT_NAME_GAP_PX,
    };
  });
}
```

Update its doc comment: the bar draws one box per ABILITY slot, the caller passes the ability count (the fire-slot array length minus one), and the clamp is gone because it was excluding the basic attack by accident rather than by rule. `viewHeight` is now unused by the body — keep the parameter (callers and tests pass it, and VS21's overflow case is asserted against it) and reference it in the doc as the bound the layout is tested against.

If the linter rejects an unused parameter, assert the bound instead of dropping it:

```ts
  // The stack is tested against this bound (VS21); four boxes fit and five do not.
  void viewHeight;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @motor-combat-moba/client -- weapon-hud`
Expected: PASS, including the existing gutter-budget block unchanged (`slots[0].y` is still 305, `strip[0].y` still 149, clearance still 11).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/scenes/weapon-hud.ts packages/client/src/scenes/weapon-hud.test.ts
git commit -m "feat(hud): top-anchor the slot stack instead of centring it

Centring made the stack's top move with the slot count, so a fourth box
pushed it up 46 px and the badge strip — anchored to that top and growing
upward — climbed into a roster panel it clears by 11 px. Anchoring keeps
the clearance independent of the count and keeps ability 1 in one place
on screen whatever chassis is driven.

The anchor's value reproduces the old centred 3-slot layout exactly, so
the HUD is pixel-identical at N=3. Four boxes fit; five overflow, and the
test says so.

VS20-VS22."
```

---

### Task 5: Variable kit length — 1 to 4 weapons per chassis

This is the task that makes the feature true. Everything before it was groundwork at a fixed kit length.

**Files:**
- Modify: `packages/shared/src/config/weapon-slots.ts` (`slotsOf` doc)
- Modify: `packages/client/src/scenes/movement-hint.ts` (`ACTION_KEYS`/`ACTION_ALTS` → functions of the kit)
- Modify: `packages/client/src/scenes/ArenaScene.ts:~3558` (pass the driven chassis's ability count)
- Test: `packages/shared/src/config/weapon-slots.test.ts`, `packages/shared/src/sim/weapons/fire.test.ts`, `packages/client/src/scenes/movement-hint.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  - `actionKeysFor(abilities: number, enabled: boolean): readonly string[]`
  - `actionAltsFor(abilities: number, enabled: boolean): readonly string[]`
  - `ACTION_KEYS` / `ACTION_ALTS` remain exported, bound to `WEAPON_SLOT_CONFIG.maxAbilitySlots` and `BASIC_ATTACK_CONFIG.enabled`, for callers with no chassis in hand.

- [ ] **Step 1: Write the failing tests**

Replace `weapon-slots.test.ts`'s `"gives every ACTIVE car exactly a full kit, and no car more than the slot limit"` with:

```ts
  it("gives every ACTIVE car between one and the ceiling's worth of weapons", () => {
    // VS24. Relaxed from "exactly maxAbilitySlots". That exactness existed to keep
    // `basicAttackSlotIndex` honest while the basic attack sat at `kit.length`; at index 0 the
    // constant is true at every kit length (asserted below), so the floor can be a floor.
    //
    // The guard this doubled as — a weapon silently dropped from a shipped loadout — is NOT lost:
    // "gives each chassis the kit its type calls for" pins all three shipped kits element by
    // element, which catches a dropped weapon more precisely than any count.
    //
    // The floor is scoped to ACTIVE cars on purpose (VS25): an inactive chassis may carry no
    // weapons at all, and that is the shape a prototype is driven in while its exclusive kit is
    // still being authored. The ceiling applies to every row (VS26) — a kit may exceed N, which is
    // the designed case, but never the ceiling, which is an authoring error.
    for (const car of Object.values(CAR_TABLE)) {
      if (car.isActive) expect(car.weapons.length).toBeGreaterThanOrEqual(1);
      expect(car.weapons.length).toBeLessThanOrEqual(ABILITY_SLOT_CEILING);
    }
  });

  it("keeps the basic attack at slot 0 at every kit length", () => {
    // VS27. The invariant that was previously true only by coincidence, and the reason the
    // assertion above could be relaxed at all.
    for (const kit of [1, 2, 3, 4]) {
      const weapons = ["predator", "pepperbox", "lance", "tremor"].slice(0, kit) as WeaponId[];
      const state = newFireState("bullseye", 1, weapons);
      expect(state.slots[0]!.weaponId).toBe(basicAttackOf("bullseye"));
      expect(state.slots).toHaveLength(kit + 1);
    }
  });
```

Add to `fire.test.ts`:

```ts
  it("lets a short kit fire every slot it has, and ignores bits past it", () => {
    // VS7. The fire-slot array is DENSE at every kit length — a short kit produces a short array,
    // not holes — so `usable = min(slots.length, maxFireSlots)` handles it with no special case.
    const state = newFireState("bullseye", 1, ["predator"]);
    expect(state.slots).toHaveLength(2);
    expect(beginFire("s1", state, 0b0010, 0).pending?.weaponId).toBe("predator");
    // Bit 3 is ability 3, which this chassis does not carry: dropped, not crashed.
    expect(beginFire("s1", state, 0b1000, 0).pending).toBeNull();
  });
```

In `movement-hint.test.ts`:

```ts
  it("teaches only the slots the driven chassis actually has", () => {
    // VS19. `ACTION_KEYS` was a module constant, so a two-weapon chassis would have been taught
    // the semicolon for a slot it does not carry.
    expect(actionKeysFor(2, true)).toEqual(["H", "J", "K"]);
    expect(actionKeysFor(4, true)).toEqual(["H", "J", "K", "L", ";"]);
    expect(actionKeysFor(3, false)).toEqual(["J", "K", "L"]);
    expect(actionAltsFor(2, true)).toEqual(["LMB", "RMB", "SHIFT"]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `actionKeysFor` is not exported; the kit-length loop fails if `newFireState` mis-sizes.

- [ ] **Step 3: Make the hint a function of the kit**

In `packages/client/src/scenes/movement-hint.ts`, replace the two constants:

```ts
/**
 * The action row's clusters for a chassis carrying `abilities` weapons, derived from `SLOT_KEYS` so
 * a rebind can never leave the hint teaching keys the game stopped listening to.
 *
 * Parameterised by kit size (VS19): with variable kits a module constant would teach a two-weapon
 * chassis the semicolon for a slot it does not carry. The basic attack is taught FIRST and is the
 * only place either of its bindings appears — the gutter pill never carries it (BA19) — so dropping
 * it when `BASIC_ATTACK_CONFIG.enabled` is false must remove the pill, not leave a dead one.
 */
export function actionKeysFor(abilities: number, enabled: boolean): readonly string[] {
  return hintSlotOrder(enabled, abilities).map((slot) => SLOT_KEYS[slot]!.keyGlyph);
}

export function actionAltsFor(abilities: number, enabled: boolean): readonly string[] {
  return hintSlotOrder(enabled, abilities).map((slot) => SLOT_KEYS[slot]!.glyph);
}

/** This build's full row, for a caller with no chassis in hand. */
export const ACTION_KEYS: readonly string[] = actionKeysFor(
  WEAPON_SLOT_CONFIG.maxAbilitySlots,
  BASIC_ATTACK_CONFIG.enabled,
);
export const ACTION_ALTS: readonly string[] = actionAltsFor(
  WEAPON_SLOT_CONFIG.maxAbilitySlots,
  BASIC_ATTACK_CONFIG.enabled,
);
```

Add the imports `BASIC_ATTACK_CONFIG`, `WEAPON_SLOT_CONFIG` from `@motor-combat-moba/shared` and `hintSlotOrder` from `../config/slot-keys.js`; drop the now-unused `HINT_SLOT_ORDER` import.

- [ ] **Step 4: Feed the hint the driven chassis**

In `packages/client/src/scenes/ArenaScene.ts` at the `buildHintRow(gfx, ACTION_KEYS, ACTION_ALTS, ACTION_LABEL, ACTION_HINT_Y)` call, resolve the local player's ability count the same way `renderWeaponHud` does and pass the per-chassis row:

```ts
      ...this.buildHintRow(
        gfx,
        actionKeysFor(this.localAbilityCount(), BASIC_ATTACK_CONFIG.enabled),
        actionAltsFor(this.localAbilityCount(), BASIC_ATTACK_CONFIG.enabled),
        ACTION_LABEL,
        ACTION_HINT_Y,
      ),
```

Add the private helper beside `hudTargetPlayer`:

```ts
  /**
   * How many ABILITY slots the local player's chassis carries — the fire-slot array minus its
   * basic attack (VS19). Falls back to this build's `N` before the player's car is known, which is
   * the countdown's own first frame.
   */
  private localAbilityCount(): number {
    const weapons = this.room?.state.players.get(this.room.sessionId)?.weapons;
    return weapons && weapons.length > 0
      ? weapons.length - 1
      : WEAPON_SLOT_CONFIG.maxAbilitySlots;
  }
```

Adjust the room/state accessor to whatever `hudTargetPlayer` already uses in this file — read it first and mirror it rather than inventing a second access path.

Update the imports: add `actionAltsFor`, `actionKeysFor` and keep `ACTION_LABEL`; drop `ACTION_ALTS`/`ACTION_KEYS` if nothing else uses them.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A packages/shared packages/client
git commit -m "feat(slots): let an active chassis carry one to four weapons

The exact-kit-length assertion existed to keep basicAttackSlotIndex
honest while the basic attack sat at kit.length. At index 0 the constant
holds at every length, so the floor becomes a floor. The dropped-weapon
guard it doubled as is unaffected — the per-chassis kit assertions pin
all three shipped loadouts element by element.

The countdown hint stops being a module constant: with variable kits it
would teach a two-weapon chassis a key for a slot it does not carry.

VS7, VS19, VS24-VS27."
```

---

### Task 6: Playground — variable-length seat loadouts

**Files:**
- Modify: `packages/client/src/dev/playground/ui-model.ts:142-152` (`isLoadoutLegal`), `:283-286` (`shippedLoadoutOf`)
- Modify: `packages/client/src/dev/playground/car-panel.ts:199, 381` (add/remove rows)
- Modify: `packages/client/src/dev/playground/overlay.ts:465`
- Modify: `packages/shared/src/net/playground-messages.ts` (`isPlaygroundSetup`'s per-seat check, doc at :165)
- Test: `packages/client/src/dev/playground/ui-model.test.ts`, `packages/server/src/rooms/playground-room.test.ts`

**Interfaces:**
- Consumes: `WEAPON_SLOT_CONFIG.maxAbilitySlots`, `slotsFrom` from Task 1.
- Produces:
  - `isLoadoutLegal(weapons: readonly WeaponId[]): boolean` — 1 to `N` entries, pairwise distinct. No longer a type predicate.
  - `shippedLoadoutOf(carId: CarId): readonly WeaponId[] | undefined`

- [ ] **Step 1: Write the failing tests**

```ts
describe("a playground seat's loadout", () => {
  it("accepts one to N distinct weapons", () => {
    // VS34. Was "exactly three distinct". A seat may now carry a short kit, which is how a tester
    // reaches the shapes the roster does not ship.
    expect(isLoadoutLegal(["lance"])).toBe(true);
    expect(isLoadoutLegal(["lance", "predator"])).toBe(true);
    expect(isLoadoutLegal([])).toBe(false);
  });

  it("still rejects a dupe within one seat", () => {
    // PG17 unchanged: the same weapon on the OTHER car is fine, a dupe within one car is not.
    expect(isLoadoutLegal(["lance", "lance"])).toBe(false);
  });

  it("rejects more weapons than this build has slots", () => {
    const tooMany = Array.from(
      { length: WEAPON_SLOT_CONFIG.maxAbilitySlots + 1 },
      (_, i) => (["lance", "predator", "pepperbox", "tremor", "thumper"] as const)[i]!,
    );
    expect(isLoadoutLegal(tooMany)).toBe(false);
  });

  it("hands back a chassis's shipped kit at whatever length it is", () => {
    expect(shippedLoadoutOf("bastion")).toEqual(["thumper", "roadblock", "wildcharge"]);
  });

  it("still loads a three-entry setup written by an older build", () => {
    // VS34. A persisted localStorage setup has no length field; three distinct weapons is a legal
    // loadout at any N >= 3 and is truncated by the same rule as a roster kit below that.
    expect(isLoadoutLegal(["thumper", "roadblock", "wildcharge"])).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @motor-combat-moba/client -- ui-model`
Expected: FAIL — the one-weapon and two-weapon cases return false.

- [ ] **Step 3: Implement**

`ui-model.ts`:

```ts
/**
 * A seat's slot picks are legal iff there is at least one, no more than this build's `N`, and they
 * are pairwise distinct (PG17, VS34 — the same weapon on ANOTHER seat is fine; only a dupe within
 * one seat is rejected). Mirrors `isPlaygroundSetup`'s own per-seat check so the overlay catches an
 * illegal pick locally, before building a payload the server would silently reject.
 *
 * No longer a type predicate: a variable-length loadout has no tuple type to narrow to.
 */
export function isLoadoutLegal(weapons: readonly WeaponId[]): boolean {
  return (
    weapons.length >= 1 &&
    weapons.length <= WEAPON_SLOT_CONFIG.maxAbilitySlots &&
    new Set(weapons).size === weapons.length
  );
}
```

```ts
/**
 * A chassis's shipped kit (PG34) — what the "restore loadout" button beside each seat writes.
 * `undefined` when the kit is not a legal loadout (an inactive prototype carrying nothing), so the
 * button disables rather than producing a setup `isPlaygroundSetup` rejects.
 */
export function shippedLoadoutOf(carId: CarId): readonly WeaponId[] | undefined {
  const kit = slotsOf(carId);
  return isLoadoutLegal(kit) ? kit : undefined;
}
```

Add `WEAPON_SLOT_CONFIG` to the file's shared import.

In `car-panel.ts`, the seat's weapon `<select>` list is currently a fixed three. Render `car.weapons.length` selects, followed by a **＋** button (disabled at `maxAbilitySlots` entries) and a **−** button per row (disabled at one entry). Both write the seat's `weapons` array and re-validate through `isLoadoutLegal`, exactly as the existing `:381` guard does — read that handler and extend it rather than adding a second write path.

In `playground-messages.ts`, `isPlaygroundSetup`'s per-seat weapons check moves from "exactly 3 distinct" to the same rule. Update the `:165` doc line from "three-slot loadout" to "one-to-`N` loadout".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS.

- [ ] **Step 5: Verify by hand**

Run: `npm run dev`, open `http://localhost:5173/?dev=playground`, and in the Car select panel remove a weapon from seat 0 until one remains, then add back to four. The HUD's slot stack must follow the count with its top fixed, and the countdown hint must print exactly the keys the seat has.

- [ ] **Step 6: Commit**

```bash
git add -A packages/client/src/dev packages/shared/src/net
git commit -m "feat(playground): variable-length seat loadouts

A seat carries one to N distinct weapons instead of exactly three, with
add/remove beside each seat's rows. isLoadoutLegal stops being a type
predicate — a variable-length loadout has no tuple to narrow to. A
three-entry setup persisted by an older build still loads: it is legal at
any N >= 3 and truncated by the same rule as a roster kit below that.

VS34."
```

---

### Task 7: Players' guide — publish `min(kit, N)`, drop the uniformity token, fold `N` into the stamp

**Files:**
- Modify: `scripts/build-cars-and-weapons.mjs` (`balanceStamp`, the per-chassis weapon list)
- Modify: `scripts/manual-facts.mjs` (delete `roster.slotsPerCar`)
- Modify: `scripts/cars-and-weapons-copy.mjs:33, 44` (the two sentences quoting it)
- Modify: `scripts/manual-facts.test.mjs:138`
- Regenerate: `packages/client/public/manual.html`

**Interfaces:**
- Consumes: `WEAPON_SLOT_CONFIG.maxAbilitySlots`, `slotsOf` (already truncating) from Task 1.
- Produces: `balanceStamp()` includes `abilitySlots: WEAPON_SLOT_CONFIG.maxAbilitySlots`.

- [ ] **Step 1: Write the failing test**

In `scripts/manual-page.test.mjs`:

```js
test("the stamp moves with the build's slot count", () => {
  // VS30. N changes what the page SAYS — how many weapons each chassis lists — so a change to it
  // that skipped `npm run build:manual` would ship a guide advertising slots the build lacks.
  // Hashing it is what turns that into a failing suite with the command to run.
  assert.ok(String(balanceStampInputsKeys()).includes("abilitySlots"));
});
```

If the module exposes no inputs-key helper, assert structurally instead — read `balanceStamp`'s source and check the literal appears:

```js
test("the stamp folds in the build's slot count", () => {
  const src = readFileSync(new URL("./build-cars-and-weapons.mjs", import.meta.url), "utf8");
  assert.match(src, /abilitySlots: WEAPON_SLOT_CONFIG\.maxAbilitySlots/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/manual-page.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `scripts/build-cars-and-weapons.mjs`, add to `balanceStamp`'s `inputs` (import `WEAPON_SLOT_CONFIG` from built shared alongside the others):

```js
    // How many ability slots this build has. N changes how many weapons each chassis lists, which
    // is something the page SAYS, so it belongs in the fingerprint (VS30).
    abilitySlots: WEAPON_SLOT_CONFIG.maxAbilitySlots,
```

`slotsOf` already truncates to `N` after Task 1, so the per-chassis weapon lists at `:699` and `:284` need no change — verify that by reading them rather than assuming, and leave a comment at `:699` naming `slotsOf`'s truncation as the reason `N` is honoured without a second cap.

In `scripts/manual-facts.mjs`, delete the `"roster.slotsPerCar"` entry and its comment. In `scripts/manual-facts.test.mjs:138`, delete the assertion on it.

In `scripts/cars-and-weapons-copy.mjs`, rewrite the two sentences so they do not quote a roster-wide count (VS29):

- Line ~33 (Mirage): `"The fastest chassis and the thinnest hull. Two of its {roster.slotsPerCar:words} weapons "` → `"The fastest chassis and the thinnest hull. Most of its kit "` — then finish the sentence from the existing text so the meaning survives.
- Line ~44 (Bastion): `"of its {roster.slotsPerCar:words} weapons stun or slam."` → `"of its kit stun or slam."`

Read both lines in full before editing; the fragments above are the tokens' surroundings, not the whole sentences.

- [ ] **Step 4: Rebuild and commit the page**

Run: `npm run build -w @motor-combat-moba/shared && npm run build:manual`
Expected: the script prints a new stamp and writes `packages/client/public/manual.html`.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS, including `manual-page.test.mjs`'s stamp recomputation and `manual-facts.test.mjs`'s guard that no token's current value is typed as digits.

- [ ] **Step 6: Look at the page**

Open `packages/client/public/manual.html` in a browser. Each chassis must list its "Basic attack" card plus its kit, and the two rewritten sentences must read naturally without the deleted count.

- [ ] **Step 7: Commit**

```bash
git add scripts packages/client/public/manual.html
git commit -m "feat(manual): publish min(kit, N) and fold N into balanceStamp

roster.slotsPerCar resolved slotsOf(carIds[0]).length — one number
asserting a uniformity that no longer holds — so it is deleted and the
two sentences quoting it are rewritten not to name a roster-wide count.
The token map shrinks with the sentences; a fact the prose never quotes
cannot rot.

balanceStamp hashes N, so changing it without npm run build:manual fails
the suite with the command to run rather than shipping a guide that
advertises slots the build does not have.

VS28-VS30."
```

---

### Task 8: Offline tools respect `N`, and stop assuming every row has a carrier

**Files:**
- Modify: `packages/server/playtest/weapons.ts`, `weapons2.ts`, `geometry.ts` (`carrierOf`, `slotBitFor`)
- Modify: `scripts/ttk.mjs:232, 248, 264` (the carrier sweep)
- Modify: `packages/server/balance/stats.ts:226-229` (accumulator seeding — already `fireSlotsOf`, verify it truncates)
- Test: `scripts/ttk.test.mjs`

**Interfaces:**
- Consumes: `fireSlotsOf` (already truncated via `slotsOf`) from Tasks 1–2.
- Produces: `carrierOf(weaponId): CarId | undefined` — was effectively non-optional and threw.

`balance`, `ttk` and the playtest probes sweep only what a player can press (VS31). This deliberately diverges from the basic-attack toggle's precedent, where the tools are flag-unaware: an unreachable basic attack is one row of nineteen, while an unreachable ability slot can be a quarter of the game's firepower.

The hazard that creates is VS32: `carrierOf` currently crashes the whole run when a `WEAPON_TABLE` row has no chassis — the documented reason those tools ignore `BASIC_ATTACK_CONFIG.enabled`. A weapon parked past `N` has no *reachable* carrier.

- [ ] **Step 1: Write the failing test**

In `scripts/ttk.test.mjs`:

```js
test("names the weapons it could not reach instead of crashing", () => {
  // VS32. A row with no reachable carrier — uncarried like `tremor`, or parked past N — must be
  // skipped and NAMED. Crashing the run was acceptable while every authored row was reachable.
  const skipped = unreachableWeaponIds();
  assert.ok(Array.isArray(skipped));
  assert.ok(skipped.includes("tremor"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/ttk.test.mjs`
Expected: FAIL — `unreachableWeaponIds` is not exported.

- [ ] **Step 3: Implement**

In `scripts/ttk.mjs`, make `carrierOf` total and add the reporting helper:

```js
/**
 * Which chassis can fire this weapon in THIS build, or `undefined` when nobody can (VS32).
 *
 * Total on purpose. It used to throw, which was safe only while every authored row was reachable:
 * a row parked past `N`, or authored and uncarried like `tremor`, has no reachable carrier and must
 * be skipped and named rather than killing the whole run.
 */
export function carrierOf(weaponId) {
  return carIds().find((id) => fireSlotsOf(id).includes(weaponId));
}

/** Every `WEAPON_TABLE` row no chassis can fire in this build, for the matrix's footer. */
export function unreachableWeaponIds() {
  return Object.keys(WEAPON_TABLE).filter((id) => carrierOf(id) === undefined);
}
```

At `:248` the matrix already names the chassis it left off; extend that footer to name the unreachable weapons the same way. At `:264`, skip a weapon whose `carrierOf` is `undefined` rather than indexing into a missing carrier.

Apply the same treatment to `carrierOf` and `slotBitFor` in `packages/server/playtest/weapons.ts`, `weapons2.ts` and `geometry.ts`: return `undefined`, skip the scenario, and add the weapon to the probe's report as a named skip. Probes report, they never assert — a probe that throws on the first surprise stops measuring every scenario after it.

`packages/server/balance/stats.ts:226-229` already seeds from `fireSlotsOf`, which truncates after Task 1. Read it and confirm; add a comment naming the truncation as the reason `N` is honoured, and leave the code alone if it is already correct.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test scripts/ttk.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Run the tools for real**

Run: `npm run build && npm run ttk`
Expected: a full matrix, with `tremor` named in the unreachable footer rather than an exception.

Run: `npm run playtest`
Expected: every scenario reports; named skips for unreachable rows; no crash.

- [ ] **Step 6: Commit**

```bash
git add -A scripts packages/server/playtest packages/server/balance
git commit -m "feat(tools): sweep only what a player can press, and stop assuming a carrier

balance, ttk and the playtest probes respect N: a report that measured
weapons nobody can fire would describe a game nobody plays. That diverges
from the basic-attack toggle, where the tools are flag-unaware, and the
divergence is the point — an unreachable basic attack is one row of
nineteen, an unreachable ability slot can be a quarter of the firepower.

carrierOf becomes total. It threw, which was safe only while every
authored row was reachable; a row parked past N, or uncarried like
tremor, is now skipped and named in the report.

VS31-VS33."
```

---

### Task 9: Bump `BOT_BRAIN_VERSION`

**Files:**
- Modify: `packages/server/src/config/bot-profiles.ts:798`
- Test: whichever bot suite pins the version, if any — find it with `grep -rn "BOT_BRAIN_VERSION" packages/server/src --include=*.test.ts`

The bot needs no code change beyond the constant that already moved, but its behaviour changes for two reasons that are easy to miss and must be written into the commit so a later reader does not "fix" them:

1. `personality.ts` indexes its per-slot weights by fire slot (`weights[i]`). Moving the basic attack from index 3 to index 0 re-assigns every bot's weighting. The **draw count is unchanged** — `maxFireSlots` is `3 + 1 = 4` at the default `N`, exactly what `MAX_ABILITY_SLOTS + 1` produced — so nothing is re-seeded; the same numbers land on different slots.
2. `chooseSlot` resolves a score tie with a strict `score > bestScore` over an ascending scan, so the first slot holding the maximum wins — and the basic attack is now first rather than last.

VS12's scan reversal does **not** reach the bot: `controller.ts` emits `fireSlots: 1 << slot`, exactly one bit, so a bot never presents a tie for `beginFire` to break.

- [ ] **Step 1: Bump the constant**

```ts
export const BOT_BRAIN_VERSION = "6.1.0";
```

Minor, not patch: behaviour changed without `BOT_PROFILES` moving, which is exactly what the version records.

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: PASS. If a bot test pinned the old string, update it to the new one.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/config/bot-profiles.ts
git commit -m "chore(bot): bump BOT_BRAIN_VERSION for the moved basic-attack slot

Not an RNG change: maxFireSlots is 3+1 at the default N, exactly what
MAX_ABILITY_SLOTS+1 produced, so the draw count is unchanged and nothing
is re-seeded. What changed is where those numbers land — personality
weights are indexed by fire slot, so moving the basic attack to index 0
re-assigns every bot's weighting — and chooseSlot's strict score >
bestScore over an ascending scan now resolves an exact tie to the basic
attack rather than to the last ability.

Behaviour moved without BOT_PROFILES moving, which is what this constant
records. Balance reports across this commit are not comparable."
```

---

### Task 10: The `ability-slot-count` skill and the docs it must not contradict

**Files:**
- Create: `.claude/skills/ability-slot-count/SKILL.md`
- Modify: `CLAUDE.md` (the basic-attack paragraph's "fire slot 3" claims, the slot-count prose)
- Modify: `docs/combat-model.md` (slot order, the basic attack's index)
- Modify: `docs/config-reference.md` (`WEAPON_SLOT_CONFIG`, `ABILITY_SLOT_CEILING`)
- Modify: `.claude/skills/basic-attack-toggle/SKILL.md` (its "fire slot 3, `H`/LMB" line)

**Interfaces:**
- Consumes: everything. This task is documentation and must be written last, from the code as it actually landed.

- [ ] **Step 1: Write the skill**

`.claude/skills/ability-slot-count/SKILL.md`, mirroring `basic-attack-toggle`'s shape:

```markdown
---
name: ability-slot-count
description: >-
  Use when someone wants to change how many weapon slots cars have — "give
  cars four weapons", "drop to two slots for this build", "how many ability
  slots does this build have", or any request to widen or narrow the number
  of ability slots without changing any car's authored kit. Edits
  WEAPON_SLOT_CONFIG's build-time count N and carries out every step that
  change owes — rebuild, manual, bot version, tests. Not for changing WHICH
  weapons a chassis carries — that is weapon-forger.
---
```

The body must cover, each as a checklist item:

1. **The one edit:** `ABILITY_SLOTS` in `packages/shared/src/config/weapon-slots.ts`. Range 1–4, validated by a config test. `ABILITY_SLOT_CEILING` is **not** the knob and is never edited here.
2. **What N gates:** firing (`beginFire`'s `usable` cap), the HUD box count, the countdown hint, the guide's per-chassis weapon lists, the playground's per-seat loadout cap, and the offline tools' sweep. Nothing is deleted from `CAR_TABLE`.
3. **Rebuild:** root `npm run build` (shared → server → client, in that order — never `--workspaces`), then `npm run build:manual`, then commit the regenerated `packages/client/public/manual.html`. `balanceStamp` hashes N, so skipping the manual fails `npm test` with the command to run.
4. **Bump `BOT_BRAIN_VERSION`.** A change to N moves `maxFireSlots`, which changes how many random numbers `rollPersonality` draws per bot, which shifts **every seeded RNG stream downstream of it**. This is a strictly larger disturbance than a re-weighting: every bot in a seeded run behaves differently. Balance and playtest reports do not survive it, and the harness's `--baseline` flag will refuse the comparison.
5. **Raising N above a chassis's kit does nothing for that chassis** — its effective count is `min(kit.length, N)`. Giving a car a fourth weapon is a `CAR_TABLE` edit and needs a new exclusive `WEAPON_TABLE` row (exclusivity L1 is unconditional); only `tremor` is spare.
6. **N above 4 is refused** by the config test, and the HUD has no room: four boxes bottom out at y=663 against a 720 px view and five overflow at 743. Raising `ABILITY_SLOT_CEILING` is its own piece of work.
7. **Say so loudly in the summary** and recommend `npm run playtest` and `npm run balance`, per the repo's playtest rule — N reaches weapon reach, press rates and per-slot report columns.

- [ ] **Step 2: Correct the docs the change contradicts**

Run this and fix every hit that claims the basic attack is fire slot 3, that a kit is exactly three weapons, or that `H`/LMB is slot 3:

```bash
grep -rn "fire slot 3\|slot 3\|three-weapon kit\|exactly three" CLAUDE.md docs .claude/skills \
  --exclude-dir=ideas --exclude-dir=invariants
```

In `CLAUDE.md` specifically, the basic-attack paragraph states "The basic attack is always fire slot 3 (`H` / `LMB`; the abilities moved to `J`/`RMB`, `K`/`SHIFT`, `L`/`SPACE`)" and "**`CarDef.weapons` and `slotsOf` still mean the three ABILITY slots**". Both are now false. Rewrite them to say fire slot **0**, a kit of **1 to `N`**, and add a sentence naming `ABILITY_SLOT_CEILING` and the `ability-slot-count` skill, with a link to the new spec.

Add the spec to the "Read the right doc" table.

- [ ] **Step 3: Verify the docs test**

`docs/turn-tuning.md` is untouched by this work — no drive knob, `CAR_TABLE` rating, `STATUS_TABLE` row or ram constant moved — so `scripts/turn-tuning-doc.test.mjs` must still pass unchanged. Confirm rather than assume:

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A .claude CLAUDE.md docs
git commit -m "docs(slots): the ability-slot-count skill, and the claims it contradicts

CLAUDE.md, combat-model.md and basic-attack-toggle all stated the basic
attack is fire slot 3 and a kit is exactly three weapons. Both are now
false: it is slot 0 and a kit is one to N.

VS12 (the skill), VS1-VS34 (the corrected prose)."
```

---

## Final verification

- [ ] `npm run build` from the repo root, in that order, with no `--workspaces`.
- [ ] `npm test` green.
- [ ] `grep -o "// \.\..*shared/dist/[a-z-]*\.js" packages/server/dist/index.js | head -3` shows `// ../shared/dist/` — the server bundle inlined THIS checkout's shared, not another's.
- [ ] `npm run check:art` green (it is deliberately `N`-unaware; the nine basic-attack rows plus `tremor` still warn, as they did before).
- [ ] `npm run ttk` produces a matrix and names `tremor` as unreachable rather than throwing.
- [ ] `npm run dev`, join a practice match: `H`/LMB fires the basic attack, `J`/RMB/`K`/`SHIFT`/`L`/`SPACE` fire abilities 1–3, the slot stack shows three boxes with its top unmoved from the previous build, and the countdown hint prints `H J K L`.
- [ ] `?dev=playground`: set a seat to one weapon and to four, and confirm the HUD count, the hint row and the fire keys all follow.
- [ ] **Say loudly in the summary** that `sim/weapons/fire.ts`, `WEAPON_SLOT_CONFIG` and the per-slot report columns all moved, and recommend `npm run playtest` and `npm run balance`. Do not run them on the user's behalf; do not update a probe unless asked. A probe that no longer COMPILES is the one case to fix on the spot — say that you did.
