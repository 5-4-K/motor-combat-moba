# Playground Usability and Bot Difficulty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dev-only playtest playground usable for long tuning sessions — a bot with three difficulties instead of one relentless setting, per-car colour choice, alone-by-default, and a settings panel you can navigate — plus two `?dev=assets` gaps.

**Architecture:** Three new fields ride the existing `PlaygroundSetup` wire contract (validated strictly in shared, upgraded leniently in the client's localStorage codec). The bot becomes a pure function of pose plus a `BotProfile` looked up from a frozen `BOT_PROFILES` table; the room keeps owning cadence (reaction hold, fire pulse) through newly-extracted pure helpers so they are testable without a Colyseus harness. The overlay's settings panel is re-laid-out in place — it stays the thin untested DOM shell it already is, with every new decision pushed into `ui-model.ts`.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared` / `server` / `client`), Colyseus 0.15 schema, Phaser 3, vitest (node environment).

**Spec:** [`docs/superpowers/specs/2026-09-02-playground-usability-and-bot-difficulty-design.md`](../specs/2026-09-02-playground-usability-and-bot-difficulty-design.md) — decisions PG24–PG40. It builds on [`2026-09-01-playtest-playground-design.md`](../specs/2026-09-01-playtest-playground-design.md) (PG1–PG23).

## Global Constraints

- **This is a git worktree with no `node_modules`.** Task 0 runs `npm install` in the worktree root before anything else. Skipping it makes every build silently inline the *main checkout's* `shared/dist` — the suites pass on your `src` while the server bundle runs master's sim. Root `CLAUDE.md`, "In a worktree, run `npm install` before the first build."
- **Shared is consumed as built `dist`.** After editing `packages/shared/src`, run `npm run build -w @motor-combat-moba/shared` before server/client tests will see the change. Root `npm test` already does this as its first step.
- **Build with root `npm run build`, never `npm run build --workspaces`** — the root script enforces shared → server → client ordering that the server's tsup inlining depends on.
- **Verify with root `npm test`.** Per-workspace runs silently skip suites.
- **No magic numbers in logic** — every tuning number lands in a named, frozen table.
- **Enum/wire values are explicit and stable; never renumber.** `PlaygroundState` may only *add* schema fields (a plain `ArenaState` client must still decode this room's patches).
- **Nothing in this plan may touch `packages/shared/src/sim/`, `WEAPON_TABLE`, `CAR_TABLE`, `DRIVE_CONFIG`, `RAM_CONFIG`, `COMBAT_CONFIG`, `STATUS_TABLE` or `AIM_CONFIG`.** If a task appears to need one, stop and report — it changes what `balanceStamp` covers and what the playtest probes measure, and both carry loud obligations (root `CLAUDE.md`).
- **`golden.test.ts` must stay green untouched.** It is the proof the dev tooling is inert in release behaviour.
- Do not run `npm run build:manual` and do not edit `docs/turn-tuning.md` — no input to either moves in this plan (PG40).
- Commit after every task. Branch is `claude/dev-tools-playground-45d077`; do not merge or push.

---

## File Structure

**Shared (`packages/shared/src/`)**
- `net/playground-messages.ts` — *modify.* `BotDifficulty`, `isBotDifficulty`, `colorId` + `botDifficulty` on the setup types, strict validation, new defaults.
- `config/color-config.ts` — *modify.* `isColorId` guard beside `COLOR_TABLE`.
- `schema/PlaygroundState.ts` — *modify.* One added `@type("string") botDifficulty`.
- `index.ts` — *modify.* Export the three new symbols.
- `net/playground-messages.test.ts`, `config/config.test.ts` — *modify.* Tests.

**Server (`packages/server/src/rooms/`)**
- `playground-bot.ts` — *modify.* `BotProfile` / `BOT_PROFILES` replace `BOT_CONFIG`; `botInput` takes a profile and gains the coast deadband.
- `PlaygroundRoom.ts` — *modify.* Three new exported pure helpers (`needsRespawn`, `shouldRecomputeIntent`, `pulsedFireSlots`), the reaction hold, colour application, `state.botDifficulty`.
- `playground-bot.test.ts`, `playground-room.test.ts` — *modify.* Tests. **`playground-room.test.ts` never instantiates a room** — it tests exported pure functions only. Keep it that way; that is why the helpers are extracted.

**Client (`packages/client/src/dev/`)**
- `playground/storage.ts` — *modify.* `upgradeStoredSetup` merge before validation.
- `playground/ui-model.ts` — *modify.* `statsTabs` replaces `sliderGroups`; `steppedValue`; `shippedLoadoutOf`.
- `playground/overlay.ts` — *modify.* The panel re-layout. Thin DOM shell, stays untested (PG19).
- `tuning-layout.ts` — *modify.* `WEAPON_GRID_COLS`, `unassignedCellPosition`.
- `AssetTuningScene.ts` — *modify.* Unassigned weapon row, inactive chassis tag, header wording.
- `playground/storage.test.ts`, `playground/ui-model.test.ts`, `tuning-layout.test.ts` — *modify.* Tests.

**Docs**
- `CLAUDE.md`, `docs/config-reference.md` — *modify.* PG40 obligations.

---

## Task 0: Worktree setup

**Files:** none changed.

- [ ] **Step 1: Install into the worktree**

```bash
npm install
```

- [ ] **Step 2: Prove the link points at this worktree, not the main checkout**

```bash
ls -l node_modules/@motor-combat-moba
```

Expected: `shared` and `server`/`client` entries resolving inside
`.claude/worktrees/dev-tools-playground-45d077/packages/…`. If any resolves to
`E:\Work\motor-combat-MOBA\packages\…` (the main checkout), stop and report — every later build
would inline the wrong sim.

- [ ] **Step 3: Baseline the suite before changing anything**

```bash
npm test
```

Expected: PASS. If it fails here, report the failure instead of building on it.

- [ ] **Step 4: Do not commit** — `npm install` must leave `package-lock.json` untouched. Confirm with:

```bash
git status --porcelain
```

Expected: empty output.

---

## Task 1: The wire contract — difficulty, colour, new defaults

**Files:**
- Modify: `packages/shared/src/config/color-config.ts`
- Modify: `packages/shared/src/net/playground-messages.ts`
- Modify: `packages/shared/src/schema/PlaygroundState.ts`
- Modify: `packages/shared/src/index.ts:28-37`, `:134`
- Test: `packages/shared/src/net/playground-messages.test.ts`

**Interfaces:**
- Consumes: `COLOR_TABLE` (`config/color-config.ts`), `slotsOf`, `DEFAULT_CAR_ID`, `ACTIVE_ARENA_ID`.
- Produces, for Tasks 2–7:
  - `type BotDifficulty = "easy" | "medium" | "hard"`
  - `isBotDifficulty(value: unknown): value is BotDifficulty`
  - `isColorId(value: unknown): value is number`
  - `interface PlaygroundCarSetup { carId: CarId; colorId: number; weapons: readonly [WeaponId, WeaponId, WeaponId] }`
  - `interface PlaygroundSetup { botEnabled: boolean; botDifficulty: BotDifficulty; arenaId: string; me: PlaygroundCarSetup; opponent: PlaygroundCarSetup }`
  - `PlaygroundState.botDifficulty: string`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/net/playground-messages.test.ts`:

```ts
describe("isBotDifficulty", () => {
  it("accepts the three literals", () => {
    expect(isBotDifficulty("easy")).toBe(true);
    expect(isBotDifficulty("medium")).toBe(true);
    expect(isBotDifficulty("hard")).toBe(true);
  });

  it("rejects anything else, including prototype-chain names", () => {
    expect(isBotDifficulty("HARD")).toBe(false);
    expect(isBotDifficulty("")).toBe(false);
    expect(isBotDifficulty("toString")).toBe(false);
    expect(isBotDifficulty("constructor")).toBe(false);
    expect(isBotDifficulty(0)).toBe(false);
    expect(isBotDifficulty(null)).toBe(false);
    expect(isBotDifficulty(undefined)).toBe(false);
  });
});

describe("defaultPlaygroundSetup (PG26)", () => {
  it("opens alone, on medium, with two distinct colours", () => {
    const setup = defaultPlaygroundSetup();
    expect(setup.botEnabled).toBe(false);
    expect(setup.botDifficulty).toBe("medium");
    expect(setup.me.colorId).not.toBe(setup.opponent.colorId);
    expect(isColorId(setup.me.colorId)).toBe(true);
    expect(isColorId(setup.opponent.colorId)).toBe(true);
  });

  it("is itself a valid setup", () => {
    expect(isPlaygroundSetup(defaultPlaygroundSetup())).toBe(true);
  });
});

describe("isPlaygroundSetup (PG24 — the three new fields)", () => {
  /** A full, valid v2 payload. Each rejection case below mutates exactly one field of a clone. */
  function valid(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(defaultPlaygroundSetup())) as Record<string, unknown>;
  }

  it("accepts a full v2 payload", () => {
    expect(isPlaygroundSetup(valid())).toBe(true);
  });

  it("rejects a missing botDifficulty", () => {
    const msg = valid();
    delete msg.botDifficulty;
    expect(isPlaygroundSetup(msg)).toBe(false);
  });

  it("rejects an unknown botDifficulty", () => {
    expect(isPlaygroundSetup({ ...valid(), botDifficulty: "nightmare" })).toBe(false);
  });

  it("rejects a missing colorId on either car", () => {
    const noMine = valid();
    delete (noMine.me as Record<string, unknown>).colorId;
    expect(isPlaygroundSetup(noMine)).toBe(false);

    const noTheirs = valid();
    delete (noTheirs.opponent as Record<string, unknown>).colorId;
    expect(isPlaygroundSetup(noTheirs)).toBe(false);
  });

  it("rejects a colorId that is not an integer in COLOR_TABLE", () => {
    for (const bad of [-1, 1.5, COLOR_TABLE.length, "0", null, NaN]) {
      const msg = valid();
      (msg.me as Record<string, unknown>).colorId = bad;
      expect(isPlaygroundSetup(msg)).toBe(false);
    }
  });

  it("still accepts the SAME colour on both cars (PG31 — no guard)", () => {
    const msg = valid();
    (msg.opponent as Record<string, unknown>).colorId = (msg.me as Record<string, unknown>).colorId;
    expect(isPlaygroundSetup(msg)).toBe(true);
  });
});
```

Extend that file's existing import to pull in the new symbols and `COLOR_TABLE`:

```ts
import {
  COLOR_TABLE,
  defaultPlaygroundSetup,
  isBotDifficulty,
  isColorId,
  isPlaygroundSetup,
} from "../index.js";
```

(If the file currently imports from `./playground-messages.js` and `../config/color-config.js`
directly, keep that style and add the new names to those import lists instead — do not convert the
file's import style.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w @motor-combat-moba/shared
```

Expected: FAIL — `isBotDifficulty is not a function`, `isColorId is not a function`, and the default-setup assertions failing on `botEnabled === true`.

- [ ] **Step 3: Add the `isColorId` guard**

In `packages/shared/src/config/color-config.ts`, below the table:

```ts
/**
 * A real index into `COLOR_TABLE`. `colorId` is a wire value and a schema field, so this is the one
 * place that answers "is this a colour" — an out-of-range id would paint a car through
 * `carFillOf`'s silent fallback rather than being rejected at the edge.
 */
export function isColorId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < COLOR_TABLE.length;
}
```

- [ ] **Step 4: Extend the setup types and validation**

In `packages/shared/src/net/playground-messages.ts`, add the import and type, extend the interfaces,
and extend the two guards:

```ts
import { COLOR_TABLE, isColorId } from "../config/color-config.js";
```

```ts
/** How hard the playground's bot plays (PG27). Wire value is the literal string, not an index. */
export type BotDifficulty = "easy" | "medium" | "hard";

const BOT_DIFFICULTIES: readonly BotDifficulty[] = ["easy", "medium", "hard"];

/** Narrows a `<select>`'s string, and guards the wire. Uses `includes` over a frozen list rather
 * than an object lookup, so a prototype-chain name (`"toString"`) can never pass. */
export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return typeof value === "string" && BOT_DIFFICULTIES.includes(value as BotDifficulty);
}

export interface PlaygroundCarSetup {
  carId: CarId;
  /** Index into `COLOR_TABLE` (PG31). Purely visual: a colour change never respawns (PG32). */
  colorId: number;
  weapons: readonly [WeaponId, WeaponId, WeaponId];
}

export interface PlaygroundSetup {
  botEnabled: boolean;
  botDifficulty: BotDifficulty;
  arenaId: string;
  me: PlaygroundCarSetup;
  opponent: PlaygroundCarSetup;
}
```

In `isPlaygroundCarSetup`, after the `isCarId` check:

```ts
  if (!isColorId(rec.colorId)) return false;
```

In `isPlaygroundSetup`, add to the returned conjunction:

```ts
    isBotDifficulty(rec.botDifficulty) &&
```

- [ ] **Step 5: Change the defaults (PG26)**

Replace the body of `defaultPlaygroundSetup`:

```ts
/** The playground's opening setup (PG20/PG26): the default chassis's shipped loadout on both cars,
 * the live arena, and — since most sessions open by driving rather than fighting — the bot OFF, on
 * medium for whenever it is switched on. The two `colorId`s are the first two of `COLOR_TABLE` and
 * are deliberately distinct, so a fresh playground never opens with two identically-painted cars. */
export function defaultPlaygroundSetup(): PlaygroundSetup {
  const [slot0, slot1, slot2] = slotsOf(DEFAULT_CAR_ID);
  const weapons: readonly [WeaponId, WeaponId, WeaponId] = [slot0!, slot1!, slot2!];
  return {
    botEnabled: false,
    botDifficulty: "medium",
    arenaId: ACTIVE_ARENA_ID,
    me: { carId: DEFAULT_CAR_ID, colorId: 0, weapons },
    opponent: { carId: DEFAULT_CAR_ID, colorId: 1, weapons },
  };
}
```

- [ ] **Step 6: Add the schema field (PG30)**

In `packages/shared/src/schema/PlaygroundState.ts`, append **below** the existing fields — never
between them (Colyseus assigns field indexes in declaration order, and this room's patches must stay
decodable):

```ts
  /** The active bot difficulty (PG30). Not read by `stepSim`; networked so the settings panel can
   * seed its select from state rather than from a local guess that goes stale on reopen. */
  @type("string") botDifficulty = "medium";
```

- [ ] **Step 7: Export the new symbols**

In `packages/shared/src/index.ts`, add `isBotDifficulty` to the `playground-messages.js` value
export block, add `BotDifficulty` to its type export, and add `isColorId` to the `color-config.js`
export:

```ts
  isBotDifficulty,
  isPlaygroundSetup,
} from "./net/playground-messages.js";
export type { BotDifficulty, PlaygroundCarSetup, PlaygroundSetup } from "./net/playground-messages.js";
```

```ts
export { COLOR_TABLE, isColorId } from "./config/color-config.js";
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npm test -w @motor-combat-moba/shared
```

Expected: PASS. Existing `playground-messages.test.ts` cases that build a setup literal by hand will
now fail to compile or fail validation — **fix them by adding the missing fields**, not by loosening
the guard.

- [ ] **Step 9: Rebuild shared so downstream packages see it**

```bash
npm run build -w @motor-combat-moba/shared
```

- [ ] **Step 10: Full suite — other packages construct setups too**

```bash
npm test
```

Expected: PASS, or type errors in `PlaygroundRoom.ts` / `overlay.ts` / `storage.test.ts` where a
setup literal is now incomplete. Fix those literals minimally (add `colorId` and `botDifficulty`
from `defaultPlaygroundSetup()`); their real changes come in later tasks.

- [ ] **Step 11: Commit**

```bash
git add packages/shared packages/server packages/client
git commit -m "feat(shared): playground setup carries bot difficulty and per-car colour (PG24/PG26/PG30/PG31)"
```

---

## Task 2: Upgrade stored setups instead of discarding them

**Files:**
- Modify: `packages/client/src/dev/playground/storage.ts`
- Test: `packages/client/src/dev/playground/storage.test.ts`

**Interfaces:**
- Consumes: `defaultPlaygroundSetup`, `isPlaygroundSetup` (Task 1).
- Produces: nothing new is exported — `decodeStored`'s behaviour changes only.

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/src/dev/playground/storage.test.ts`:

```ts
describe("decodeStored — v1 upgrade (PG25)", () => {
  /** A setup as saved BEFORE this change: no `botDifficulty`, no `colorId` on either car. */
  const v1Setup = {
    botEnabled: true,
    arenaId: "arena-01",
    me: { carId: "bastion", weapons: ["thumper", "roadblock", "wildcharge"] },
    opponent: { carId: "mirage", weapons: ["predator", "thunderclap", "afterburner"] },
  };

  it("keeps the car, loadout and arena a v1 blob chose", () => {
    const { setup } = decodeStored(JSON.stringify({ setup: v1Setup, overrides: {} }));
    expect(setup.me.carId).toBe("bastion");
    expect(setup.me.weapons).toEqual(["thumper", "roadblock", "wildcharge"]);
    expect(setup.opponent.carId).toBe("mirage");
    expect(setup.arenaId).toBe("arena-01");
    expect(setup.botEnabled).toBe(true); // the stored value wins over the new default
  });

  it("fills the new fields from the defaults, keeping the two cars distinct", () => {
    const { setup } = decodeStored(JSON.stringify({ setup: v1Setup, overrides: {} }));
    const fallback = defaultPlaygroundSetup();
    expect(setup.botDifficulty).toBe(fallback.botDifficulty);
    expect(setup.me.colorId).toBe(fallback.me.colorId);
    expect(setup.opponent.colorId).toBe(fallback.opponent.colorId);
    expect(setup.me.colorId).not.toBe(setup.opponent.colorId);
  });

  it("still falls back whole when the blob is invalid for an older reason", () => {
    const dupe = { ...v1Setup, me: { carId: "bastion", weapons: ["thumper", "thumper", "lance"] } };
    const { setup } = decodeStored(JSON.stringify({ setup: dupe, overrides: {} }));
    expect(setup).toEqual(defaultPlaygroundSetup());
  });

  it("leaves the overrides half alone either way", () => {
    const raw = JSON.stringify({ setup: v1Setup, overrides: { "car.bastion.hp": 55 } });
    expect(decodeStored(raw).overrides).toEqual({ "car.bastion.hp": 55 });
  });

  it("does not invent a setup out of a non-object", () => {
    expect(decodeStored(JSON.stringify({ setup: 7, overrides: {} })).setup).toEqual(
      defaultPlaygroundSetup(),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w @motor-combat-moba/client
```

Expected: FAIL — the v1 blob is rejected by the now-strict `isPlaygroundSetup`, so `setup.me.carId`
is the default chassis rather than `"bastion"`.

- [ ] **Step 3: Implement the upgrade merge**

In `packages/client/src/dev/playground/storage.ts`, add above `decodeStored`:

```ts
/**
 * Merge a stored `setup` record over `defaultPlaygroundSetup()` before validating it (PG25).
 *
 * `isPlaygroundSetup` guards both the wire and this codec, and it went strict when `colorId` and
 * `botDifficulty` were added — so without this, every setup saved before that change would fail
 * validation and silently discard a car, a loadout and an arena the developer had chosen. The merge
 * is deliberately shallow-per-side: the two car records are merged over their OWN defaults, so an
 * upgraded blob inherits two DISTINCT colours rather than both cars landing on `me`'s.
 *
 * This never loosens the wire. The server still rejects an incomplete payload; only what this
 * browser saved for itself is upgraded, and a blob still invalid after the merge falls back whole.
 */
function upgradeStoredSetup(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const fallback = defaultPlaygroundSetup();
  const mergeCar = (car: unknown, base: PlaygroundCarSetup): unknown =>
    isPlainRecord(car) ? { ...base, ...car } : base;
  return {
    ...fallback,
    ...value,
    me: mergeCar(value.me, fallback.me),
    opponent: mergeCar(value.opponent, fallback.opponent),
  };
}
```

Change the `setup` line of `decodeStored` to run it:

```ts
    setup: (() => {
      const upgraded = upgradeStoredSetup(rec.setup);
      return isPlaygroundSetup(upgraded) ? upgraded : defaultPlaygroundSetup();
    })(),
```

Add `PlaygroundCarSetup` to the file's existing `import type` line.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w @motor-combat-moba/client
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/playground/storage.ts packages/client/src/dev/playground/storage.test.ts
git commit -m "feat(client): upgrade v1 playground setups on load instead of discarding them (PG25)"
```

---

## Task 3: Bot difficulty profiles and the coast deadband

**Files:**
- Modify: `packages/server/src/rooms/playground-bot.ts`
- Test: `packages/server/src/rooms/playground-bot.test.ts`

**Interfaces:**
- Consumes: `BotDifficulty` (Task 1), `InputMessage`.
- Produces, for Task 4:
  - `interface BotProfile { readonly standoffUnits: number; readonly deadbandUnits: number; readonly reactionTicks: number; readonly aimToleranceRad: number; readonly fireConeRad: number; readonly firePeriodTicks: number }`
  - `const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>>`
  - `botInput(seq: number, self: BotPose, target: BotPose | null, slotRanges: readonly number[], profile: BotProfile): InputMessage`
  - `BOT_CONFIG` is **deleted**.

- [ ] **Step 1: Write the failing tests**

Rewrite the import line of `packages/server/src/rooms/playground-bot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOT_PROFILES, botInput, type BotPose, type BotProfile } from "./playground-bot.js";

const HARD: BotProfile = BOT_PROFILES.hard;
```

Add `HARD` as the fifth argument to every existing `botInput(...)` call in the file, and delete the
old `"BOT_CONFIG carries the documented constants and is frozen"` test. Then append:

```ts
describe("BOT_PROFILES (PG27)", () => {
  it("is frozen, table and rows alike", () => {
    expect(Object.isFrozen(BOT_PROFILES)).toBe(true);
    for (const profile of Object.values(BOT_PROFILES)) expect(Object.isFrozen(profile)).toBe(true);
  });

  it("hard is EXACTLY the bot that shipped — the whole point of the difficulty split", () => {
    // These six numbers are the pre-split `BOT_CONFIG` plus `PlaygroundRoom`'s own
    // `OPPONENT_FIRE_PERIOD`. Pinned by value, not by comment: "the current one should be hard" has
    // to stay true through every later retune of easy and medium.
    expect(BOT_PROFILES.hard).toEqual({
      standoffUnits: 70,
      deadbandUnits: 0,
      reactionTicks: 1,
      aimToleranceRad: 0.3,
      fireConeRad: 0.35,
      firePeriodTicks: 2,
    });
  });

  it("keeps aimToleranceRad below fireConeRad on every profile", () => {
    // The tolerance is the deadzone the bot STOPS STEERING inside; the cone is the gate it must be
    // inside TO FIRE. A profile with tolerance >= cone lets the bot settle at a heading it is happy
    // with but can never shoot from — an easy bot that never fires.
    for (const [name, profile] of Object.entries(BOT_PROFILES)) {
      expect(profile.aimToleranceRad, name).toBeLessThan(profile.fireConeRad);
    }
  });

  it("orders the pressure knobs monotonically from easy to hard", () => {
    const { easy, medium, hard } = BOT_PROFILES;
    expect(easy.standoffUnits).toBeGreaterThan(medium.standoffUnits);
    expect(medium.standoffUnits).toBeGreaterThan(hard.standoffUnits);
    expect(easy.deadbandUnits).toBeGreaterThan(medium.deadbandUnits);
    expect(medium.deadbandUnits).toBeGreaterThan(hard.deadbandUnits);
    expect(easy.reactionTicks).toBeGreaterThan(medium.reactionTicks);
    expect(medium.reactionTicks).toBeGreaterThan(hard.reactionTicks);
    expect(easy.firePeriodTicks).toBeGreaterThan(medium.firePeriodTicks);
    expect(medium.firePeriodTicks).toBeGreaterThan(hard.firePeriodTicks);
  });
});

describe("botInput — the coast deadband (PG28)", () => {
  it("coasts inside the deadband where hard would charge or reverse", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    // 130 units out: inside easy's 170 +- 60 band, outside medium's 110 +- 30 band.
    const target: BotPose = { x: 130, y: 0, angle: 0 };
    expect(botInput(1, self, target, [60], BOT_PROFILES.easy).throttle).toBe(0);
    expect(botInput(1, self, target, [60], BOT_PROFILES.medium).throttle).toBe(1);
  });

  it("still closes when well outside the band, and backs off when well inside it", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    expect(botInput(2, self, { x: 400, y: 0, angle: 0 }, [60], BOT_PROFILES.easy).throttle).toBe(1);
    expect(botInput(3, self, { x: 20, y: 0, angle: 0 }, [60], BOT_PROFILES.easy).throttle).toBe(-1);
  });

  it("collapses to the old charge-or-reverse expression at deadbandUnits 0", () => {
    const self: BotPose = { x: 0, y: 0, angle: 0 };
    // Exactly at hard's standoff: the old code's `distance > standoff ? 1 : -1` reverses here, and
    // a zero-width band must not turn that into a coast.
    expect(botInput(4, self, { x: 70, y: 0, angle: 0 }, [60], HARD).throttle).toBe(-1);
    expect(botInput(5, self, { x: 71, y: 0, angle: 0 }, [60], HARD).throttle).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w @motor-combat-moba/server
```

Expected: FAIL — `BOT_PROFILES` is not exported and `botInput` takes four arguments.

- [ ] **Step 3: Implement the profile table and the deadband**

Replace `BOT_CONFIG` in `packages/server/src/rooms/playground-bot.ts`:

```ts
import type { BotDifficulty, InputMessage } from "@motor-combat-moba/shared";

/** One difficulty's knobs (PG27). Three for pressure, two for accuracy, one for rate of fire. */
export interface BotProfile {
  /** Distance the bot tries to hold. */
  readonly standoffUnits: number;
  /** Half-width of a band around `standoffUnits` where throttle is 0 — the bot coasts instead of
   * charging or reversing. 0 reproduces the pre-split behaviour exactly. */
  readonly deadbandUnits: number;
  /** How often the ROOM recomputes intent, holding the previous one in between (PG29). Read there,
   * not here: `botInput` stays a pure function of the pose it is handed. */
  readonly reactionTicks: number;
  /** Steering deadzone. Wider settles further off target. MUST stay below `fireConeRad`. */
  readonly aimToleranceRad: number;
  /** How well aimed the bot must be to fire. */
  readonly fireConeRad: number;
  /** Fire-mask pulse cadence, also read by the room (PG29). */
  readonly firePeriodTicks: number;
}

/**
 * The three difficulties (PG27).
 *
 * `hard` is EXACTLY the bot that shipped — the old `BOT_CONFIG` plus the old `OPPONENT_FIRE_PERIOD`
 * — and `playground-bot.test.ts` pins those six numbers by value so it stays that way.
 *
 * `aimToleranceRad < fireConeRad` on every row, and a test asserts it: tolerance is the deadzone the
 * bot stops steering inside, the cone is the gate it must be inside to fire, so a row with the
 * inequality backwards produces a bot that settles happily at a heading it can never shoot from.
 * Easy widens BOTH — it settles further off target and is willing to shoot from there — but that is
 * the weakest of the six levers, because `resolveAimAngle` rotates a shot toward a locked target for
 * any weapon with `usesAimAssist`. The pressure knobs and `firePeriodTicks` do the real work.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({
    standoffUnits: 170,
    deadbandUnits: 60,
    reactionTicks: 6,
    aimToleranceRad: 0.55,
    fireConeRad: 0.6,
    firePeriodTicks: 10,
  }),
  medium: Object.freeze({
    standoffUnits: 110,
    deadbandUnits: 30,
    reactionTicks: 3,
    aimToleranceRad: 0.42,
    fireConeRad: 0.48,
    firePeriodTicks: 5,
  }),
  hard: Object.freeze({
    standoffUnits: 70,
    deadbandUnits: 0,
    reactionTicks: 1,
    aimToleranceRad: 0.3,
    fireConeRad: 0.35,
    firePeriodTicks: 2,
  }),
});
```

Change `botInput`'s signature and its two `BOT_CONFIG` reads plus the throttle expression:

```ts
export function botInput(
  seq: number,
  self: BotPose,
  target: BotPose | null,
  slotRanges: readonly number[],
  profile: BotProfile,
): InputMessage {
```

```ts
  const steer: -1 | 0 | 1 =
    delta > profile.aimToleranceRad ? 1 : delta < -profile.aimToleranceRad ? -1 : 0;

  const distance = Math.hypot(dx, dy);
  // Coast inside the deadband rather than charging or reversing (PG28). The old expression was
  // `distance > standoff ? 1 : -1`, which at the standoff distance oscillates between full ahead and
  // full astern every tick — a large part of what made the one shipped bot feel relentless.
  //
  // The `deadbandUnits > 0` term is load-bearing, not defensive: at exactly `standoffUnits` a zero
  // band still satisfies `Math.abs(0) <= 0`, so without it hard would COAST where it used to
  // reverse. Testing the band for width first is what makes `deadbandUnits: 0` reproduce the old
  // expression exactly, which is the whole basis of "hard is the bot that shipped".
  const inDeadband =
    profile.deadbandUnits > 0 &&
    Math.abs(distance - profile.standoffUnits) <= profile.deadbandUnits;
  const throttle: -1 | 0 | 1 = inDeadband ? 0 : distance > profile.standoffUnits ? 1 : -1;

  let fireSlots = 0;
  if (Math.abs(delta) < profile.fireConeRad) {
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w @motor-combat-moba/server
```

Expected: FAIL only in `PlaygroundRoom.ts`, which still calls `botInput` with four arguments. That is
Task 4. If `playground-bot.test.ts` itself has failures, fix them before moving on.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/rooms/playground-bot.ts packages/server/src/rooms/playground-bot.test.ts
git commit -m "feat(server): bot difficulty profiles with a coast deadband (PG27/PG28)"
```

---

## Task 4: Wire the room — difficulty, reaction hold, colour without respawn

**Files:**
- Modify: `packages/server/src/rooms/PlaygroundRoom.ts`
- Test: `packages/server/src/rooms/playground-room.test.ts`

**Interfaces:**
- Consumes: `BOT_PROFILES`, `BotProfile`, `botInput` (Task 3); `PlaygroundSetup`, `PlaygroundCarSetup`, `isBotDifficulty` (Task 1).
- Produces (exported pure helpers, so the room's decisions are testable without a Colyseus harness — `playground-room.test.ts` must keep never instantiating a room):
  - `loadoutOrChassisChanged(currentCarId: string, currentWeapons: readonly string[], setup: PlaygroundCarSetup): boolean`
  - `shouldRecomputeIntent(tick: number, reactionTicks: number, hasHeldIntent: boolean): boolean`
  - `pulsedFireSlots(tick: number, firePeriodTicks: number, fireSlots: number): number`
- `OPPONENT_FIRE_PERIOD` is **deleted**.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/rooms/playground-room.test.ts`, extending its import from
`./PlaygroundRoom.js` with the three new names:

```ts
describe("loadoutOrChassisChanged (PG32)", () => {
  const setup = {
    carId: "bastion",
    colorId: 3,
    weapons: ["thumper", "roadblock", "wildcharge"],
  } as const;

  it("is false when chassis and loadout both already match", () => {
    expect(loadoutOrChassisChanged("bastion", ["thumper", "roadblock", "wildcharge"], setup)).toBe(
      false,
    );
  });

  it("is true on a chassis change", () => {
    expect(loadoutOrChassisChanged("mirage", ["thumper", "roadblock", "wildcharge"], setup)).toBe(
      true,
    );
  });

  it("is true on a loadout change, including a reorder", () => {
    expect(loadoutOrChassisChanged("bastion", ["thumper", "roadblock", "lance"], setup)).toBe(true);
    expect(loadoutOrChassisChanged("bastion", ["roadblock", "thumper", "wildcharge"], setup)).toBe(
      true,
    );
  });

  it("is true when the room has no loadout recorded yet", () => {
    expect(loadoutOrChassisChanged("bastion", [], setup)).toBe(true);
  });

  it("IGNORES colour — a repaint must not cost hp, cooldowns and a pose (PG32)", () => {
    const repainted = { ...setup, colorId: 5 } as const;
    expect(
      loadoutOrChassisChanged("bastion", ["thumper", "roadblock", "wildcharge"], repainted),
    ).toBe(false);
  });
});

describe("shouldRecomputeIntent (PG29)", () => {
  it("recomputes every tick at reactionTicks 1 — hard is unchanged", () => {
    for (const tick of [0, 1, 2, 3, 97]) {
      expect(shouldRecomputeIntent(tick, 1, true)).toBe(true);
    }
  });

  it("recomputes on the cadence and holds in between", () => {
    expect(shouldRecomputeIntent(9, 3, true)).toBe(true);
    expect(shouldRecomputeIntent(10, 3, true)).toBe(false);
    expect(shouldRecomputeIntent(11, 3, true)).toBe(false);
    expect(shouldRecomputeIntent(12, 3, true)).toBe(true);
  });

  it("recomputes regardless of cadence when there is nothing held", () => {
    // A cleared hold — a setup change, the bot toggled off and back on, a dead target — must not
    // wait out the rest of the interval enqueueing an intent that no longer exists.
    expect(shouldRecomputeIntent(10, 3, false)).toBe(true);
    expect(shouldRecomputeIntent(11, 6, false)).toBe(true);
  });

  it("never divides by zero on a malformed cadence", () => {
    expect(shouldRecomputeIntent(10, 0, true)).toBe(true);
    expect(shouldRecomputeIntent(10, -1, true)).toBe(true);
  });
});

describe("pulsedFireSlots (PG29)", () => {
  it("passes the mask through on a pulse tick and zeroes it otherwise", () => {
    expect(pulsedFireSlots(4, 2, 0b101)).toBe(0b101);
    expect(pulsedFireSlots(5, 2, 0b101)).toBe(0);
  });

  it("pulses a tenth as often on easy as hard", () => {
    expect(pulsedFireSlots(10, 10, 0b1)).toBe(0b1);
    for (const tick of [11, 12, 13, 19]) expect(pulsedFireSlots(tick, 10, 0b1)).toBe(0);
    expect(pulsedFireSlots(20, 10, 0b1)).toBe(0b1);
  });

  it("never divides by zero on a malformed cadence", () => {
    expect(pulsedFireSlots(7, 0, 0b11)).toBe(0b11);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w @motor-combat-moba/server
```

Expected: FAIL — the three helpers do not exist.

- [ ] **Step 3: Extract the three pure helpers**

In `packages/server/src/rooms/PlaygroundRoom.ts`, delete the `OPPONENT_FIRE_PERIOD` constant and add,
beside `otherPlaygroundId`:

```ts
/**
 * Does this setup change actually require a respawn? Chassis and loadout do; **colour does not**
 * (PG32) — repainting a car mid-test must not reset its hp, cooldowns and pose. Pure and exported so
 * the rule is a test rather than a comment inside a room method.
 */
export function loadoutOrChassisChanged(
  currentCarId: string,
  currentWeapons: readonly string[],
  setup: PlaygroundCarSetup,
): boolean {
  return currentCarId !== setup.carId || currentWeapons.join() !== setup.weapons.join();
}

/**
 * Should the bot recompute its intent this tick, or re-enqueue the one it is holding (PG29)?
 *
 * A cleared hold always recomputes: a setup change, a bot toggled off and back on, or a dead target
 * drops the held intent, and waiting out the rest of the interval would enqueue a decision made
 * against a pose from before the change. A non-positive cadence recomputes every tick rather than
 * dividing by zero — the table cannot produce one, and a modulo by zero is `NaN`, which is falsy and
 * would freeze the bot on its last intent forever.
 */
export function shouldRecomputeIntent(
  tick: number,
  reactionTicks: number,
  hasHeldIntent: boolean,
): boolean {
  if (!hasHeldIntent) return true;
  if (reactionTicks <= 1) return true;
  return tick % reactionTicks === 0;
}

/**
 * The fire bits that actually reach the wire this tick (PG29).
 *
 * `serverTick` counts only newly-set bits as a press (`clean & ~prev`), so a bot holding the same
 * bits fires each slot ONCE and then never again; `respawnPlayer` does not clear `prevFireMasks`
 * either, so a killed bot comes back still latched. Zeroing the bits off-pulse turns every pulse
 * tick into a fresh press edge. It does not make the bot fire faster than its weapons allow —
 * stocks, recharges and the switch lock still bound the rate, and feeling those is the point.
 */
export function pulsedFireSlots(tick: number, firePeriodTicks: number, fireSlots: number): number {
  if (firePeriodTicks <= 1) return fireSlots;
  return tick % firePeriodTicks === 0 ? fireSlots : 0;
}
```

- [ ] **Step 4: Use them, and add the difficulty + colour wiring**

Add the room field beside `opponentSeq`:

```ts
  /**
   * The bot's last computed intent, re-enqueued on the ticks its profile is not recomputing (PG29).
   * Cleared — set back to `undefined` — whenever it could go stale: a setup change, the bot switched
   * off, or a target that is no longer alive.
   */
  private heldBotIntent: InputMessage | undefined;
```

In `applySetup`, write the difficulty and drop the hold:

```ts
  private applySetup(setup: PlaygroundSetup): void {
    this.state.botEnabled = setup.botEnabled;
    this.state.botDifficulty = setup.botDifficulty;
    // Any setup change can invalidate a held intent — a new chassis drives differently, a new
    // difficulty has a different cadence, and the bot may have just been switched off (PG29).
    this.heldBotIntent = undefined;
```

In `applyCarSetup`, apply the colour unconditionally and gate the respawn on the extracted rule:

```ts
  /** Writes one car's chassis, loadout and colour, and reports whether a RESPAWN is owed. Colour is
   * always written and never owes one (PG32). */
  private applyCarSetup(sessionId: string, setup: PlaygroundCarSetup): boolean {
    const player = this.state.players.get(sessionId);
    if (!player) return false;
    const current = this.combat.loadouts.get(sessionId) ?? [];
    // Written before the early return, so a colour-only edit still repaints. `ArenaScene` keys its
    // car container on `carId:colorId:alive`, so this reaches the screen on the next patch.
    player.colorId = setup.colorId;
    if (!loadoutOrChassisChanged(player.carId, current, setup)) return false;
    player.carId = setup.carId;
    this.combat.loadouts.set(sessionId, [...setup.weapons]);
    return true;
  }
```

Rewrite the bot half of `enqueueOpponentInput` (leave the `!self || !queue` guard and the
alone-mode comment block as they are, adding the hold clear):

```ts
    if (!this.state.botEnabled) {
      // Dropping the hold here is what stops switching the bot back on from replaying an intent
      // computed against a pose from minutes ago (PG29).
      this.heldBotIntent = undefined;
      queue.push({ seq, steer: 0, throttle: 0, fireSlots: 0 });
      return;
    }

    const profile = BOT_PROFILES[
      isBotDifficulty(this.state.botDifficulty) ? this.state.botDifficulty : "medium"
    ];

    const driven = this.state.players.get(this.state.controlledSessionId);
    // A dead target is no target: the bot coasts rather than chasing the wreck's last pose, and the
    // hold is dropped so it reacts the instant the target respawns instead of waiting out its
    // cadence.
    const target = driven?.alive ? poseOf(driven) : null;
    if (target === null) this.heldBotIntent = undefined;

    if (shouldRecomputeIntent(this.state.tick, profile.reactionTicks, this.heldBotIntent !== undefined)) {
      const slots = this.combat.fireStates.get(opponentId)?.slots ?? [];
      this.heldBotIntent = botInput(
        seq,
        poseOf(self),
        target,
        slots.map((slot) => weaponDefOf(slot.weaponId).range),
        profile,
      );
    }

    const intent = this.heldBotIntent ?? { seq, steer: 0, throttle: 0, fireSlots: 0 };
    // A held intent is re-enqueued with a FRESH seq: `serverTick` wants one input per tick per car,
    // and reusing a sequence number reads as a duplicate rather than a repeat.
    queue.push({
      ...intent,
      seq,
      fireSlots: pulsedFireSlots(this.state.tick, profile.firePeriodTicks, intent.fireSlots),
    });
```

Update the imports: add `BOT_PROFILES` to the `./playground-bot.js` import, and `isBotDifficulty` to
the `@motor-combat-moba/shared` import.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -w @motor-combat-moba/server
```

Expected: PASS, including Task 3's suite now that the call site compiles.

- [ ] **Step 6: Full suite and a real build**

```bash
npm test && npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/rooms/PlaygroundRoom.ts packages/server/src/rooms/playground-room.test.ts
git commit -m "feat(server): apply bot difficulty, reaction hold and per-car colour in the playground room (PG29/PG30/PG32)"
```

---

## Task 5: Overlay derivations — tabs, steppers, shipped loadout

**Files:**
- Modify: `packages/client/src/dev/playground/ui-model.ts`
- Test: `packages/client/src/dev/playground/ui-model.test.ts`

**Interfaces:**
- Consumes: `tunableFields`, `TunableField`, `CAR_TABLE`, `WEAPON_TABLE`, `slotsOf`, `PlaygroundSetup`.
- Produces, for Task 6:
  - `type StatsTabKey = "global" | "cars" | "weapons"`
  - `interface StatsGroup { title: string; fields: TunableField[] }`
  - `interface StatsTab { key: StatsTabKey; title: string; groups: StatsGroup[] }`
  - `statsTabs(setup: PlaygroundSetup): StatsTab[]` — always length 3, always in the order global, cars, weapons.
  - `steppedValue(field: TunableField, current: number, direction: 1 | -1): number`
  - `canStep(field: TunableField): boolean`
  - `shippedLoadoutOf(carId: CarId): [WeaponId, WeaponId, WeaponId] | undefined`
  - `sliderGroups` is **deleted** (nothing outside `overlay.ts` and this test file uses it).

- [ ] **Step 1: Write the failing tests**

In `packages/client/src/dev/playground/ui-model.test.ts`, replace the existing `sliderGroups`
describe block with:

```ts
describe("statsTabs (PG35)", () => {
  /** Both cars on different chassis with their own shipped kits — the ordinary case. */
  function twoCarSetup(): PlaygroundSetup {
    return {
      ...defaultPlaygroundSetup(),
      me: { carId: "bastion" as CarId, colorId: 0, weapons: ["thumper", "roadblock", "wildcharge"] as [WeaponId, WeaponId, WeaponId] },
      opponent: { carId: "mirage" as CarId, colorId: 1, weapons: ["predator", "thunderclap", "afterburner"] as [WeaponId, WeaponId, WeaponId] },
    };
  }

  it("returns the three tabs, always in global/cars/weapons order", () => {
    expect(statsTabs(twoCarSetup()).map((t) => t.key)).toEqual(["global", "cars", "weapons"]);
  });

  it("puts drive, ram and combat rows under global, in one group", () => {
    const global = statsTabs(twoCarSetup())[0]!;
    expect(global.groups).toHaveLength(1);
    expect(global.groups[0]!.fields.length).toBeGreaterThan(0);
    for (const field of global.groups[0]!.fields) {
      expect(["drive", "ram", "combat"]).toContain(field.group);
    }
  });

  it("gives each SELECTED chassis its own group under cars, and no other chassis", () => {
    const cars = statsTabs(twoCarSetup())[1]!;
    expect(cars.groups.map((g) => g.title)).toEqual([CAR_TABLE.bastion.name, CAR_TABLE.mirage.name]);
    for (const group of cars.groups) {
      for (const field of group.fields) expect(field.group).toBe("car");
    }
  });

  it("gives each SELECTED weapon its own group under weapons, and no other weapon", () => {
    const weapons = statsTabs(twoCarSetup())[2]!;
    expect(weapons.groups.map((g) => g.title)).toEqual([
      WEAPON_TABLE.thumper.name,
      WEAPON_TABLE.roadblock.name,
      WEAPON_TABLE.wildcharge.name,
      WEAPON_TABLE.predator.name,
      WEAPON_TABLE.thunderclap.name,
      WEAPON_TABLE.afterburner.name,
    ]);
  });

  it("dedupes a chassis and a weapon both cars picked", () => {
    const same = defaultPlaygroundSetup(); // both cars are the default chassis with one kit
    const tabs = statsTabs(same);
    expect(tabs[1]!.groups).toHaveLength(1);
    expect(tabs[2]!.groups).toHaveLength(3);
  });

  it("keeps a tab present with an empty group list rather than dropping it", () => {
    // The tab bar's shape must not change under the pointer, so every key is always returned.
    const tabs = statsTabs(twoCarSetup());
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) expect(Array.isArray(tab.groups)).toBe(true);
  });
});

describe("canStep / steppedValue (PG36)", () => {
  const field: TunableField = {
    path: "drive.baseMaxSpeed",
    group: "drive",
    label: "baseMaxSpeed",
    kind: "number",
    shipped: 135,
    min: 0,
    max: 405,
    step: 4.05,
  } as TunableField;

  it("steps up and down by exactly one step", () => {
    expect(steppedValue(field, 100, 1)).toBeCloseTo(104.05, 6);
    expect(steppedValue(field, 100, -1)).toBeCloseTo(95.95, 6);
  });

  it("clamps at both ends instead of running past them", () => {
    expect(steppedValue(field, 404, 1)).toBe(405);
    expect(steppedValue(field, 405, 1)).toBe(405);
    expect(steppedValue(field, 1, -1)).toBe(0);
    expect(steppedValue(field, 0, -1)).toBe(0);
  });

  it("is a round trip up then down away from the clamps", () => {
    expect(steppedValue(field, steppedValue(field, 200, 1), -1)).toBeCloseTo(200, 6);
  });

  it("refuses to step a field with no grid, returning the value unchanged", () => {
    const enumField = { ...field, kind: "enum", min: undefined, max: undefined, step: undefined } as TunableField;
    expect(canStep(enumField)).toBe(false);
    expect(steppedValue(enumField, 100, 1)).toBe(100);
    expect(canStep(field)).toBe(true);
  });
});

describe("shippedLoadoutOf (PG34)", () => {
  it("returns the chassis's own kit from the roster", () => {
    expect(shippedLoadoutOf("bastion" as CarId)).toEqual(CAR_TABLE.bastion.weapons);
  });

  it("returns a three-weapon kit for every chassis on today's roster", () => {
    // The `undefined` branch has no chassis to exercise today; it is what stops a FUTURE chassis
    // with a short or duplicated kit from producing a loadout the validator rejects.
    for (const carId of Object.keys(CAR_TABLE) as CarId[]) {
      expect(shippedLoadoutOf(carId)).toHaveLength(3);
    }
  });
});
```

Add `statsTabs`, `steppedValue`, `canStep`, `shippedLoadoutOf` to the file's import from
`./ui-model.js`, drop `sliderGroups`, and add `defaultPlaygroundSetup` / `PlaygroundSetup` to the
shared imports if not already there.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w @motor-combat-moba/client
```

Expected: FAIL — `statsTabs is not a function`.

- [ ] **Step 3: Implement**

In `packages/client/src/dev/playground/ui-model.ts`, replace `sliderGroups` with:

```ts
export type StatsTabKey = "global" | "cars" | "weapons";

export interface StatsGroup {
  title: string;
  fields: TunableField[];
}

export interface StatsTab {
  key: StatsTabKey;
  title: string;
  groups: StatsGroup[];
}

/**
 * The Stats area's three tabs (PG35), replacing the single flat scroll `sliderGroups` produced.
 *
 * The FILTER is unchanged from that function and from spec PG13: only what is actually on the field
 * is tunable — the one or two selected chassis, the up-to-six selected weapons, and the global
 * drive/ram/combat rows. Tuning a chassis that is not spawned changes nothing observable, so
 * widening this would only lengthen the scroll.
 *
 * All three tabs are ALWAYS returned, in this order, even when a tab's group list is empty: the tab
 * bar's shape must not change under the pointer. Row order within a group, and group order within a
 * tab, follow `tunableFields()`'s own order, since this only filters and never re-sorts.
 */
export function statsTabs(setup: PlaygroundSetup): StatsTab[] {
  const fields = tunableFields();

  const carIds = [...new Set([setup.me.carId, setup.opponent.carId])];
  const carGroups: StatsGroup[] = [];
  for (const carId of carIds) {
    const carFields = fields.filter((f) => f.group === "car" && f.ownerId === carId);
    if (carFields.length > 0) carGroups.push({ title: CAR_TABLE[carId].name, fields: carFields });
  }

  const weaponIds = [...new Set([...setup.me.weapons, ...setup.opponent.weapons])];
  const weaponGroups: StatsGroup[] = [];
  for (const weaponId of weaponIds) {
    const weaponFields = fields.filter((f) => f.group === "weapon" && f.ownerId === weaponId);
    if (weaponFields.length > 0) {
      weaponGroups.push({ title: WEAPON_TABLE[weaponId].name, fields: weaponFields });
    }
  }

  return [
    {
      key: "global",
      title: "Global",
      groups: [
        {
          title: "Global",
          fields: fields.filter(
            (f) => f.group === "drive" || f.group === "ram" || f.group === "combat",
          ),
        },
      ],
    },
    { key: "cars", title: "Cars", groups: carGroups },
    { key: "weapons", title: "Weapons", groups: weaponGroups },
  ];
}

/**
 * Can this row's value be nudged a step at a time (PG36)? Only a `number` row with a full
 * `min`/`max`/`step` grid — all three are optional on `TunableField`, and a boolean or enum row has
 * nothing to step. The overlay omits the buttons entirely when this is false, rather than rendering
 * a pair that does nothing.
 */
export function canStep(field: TunableField): boolean {
  return (
    field.kind === "number" &&
    typeof field.min === "number" &&
    typeof field.max === "number" &&
    typeof field.step === "number" &&
    field.step > 0
  );
}

/**
 * `current` moved one `step` in `direction`, clamped into `[min, max]` (PG36).
 *
 * The caller passes the range input's CURRENT value — already snapped by the browser to the
 * `min`/`step` grid — rather than a float the buttons track themselves, which is what makes
 * up-then-down a round trip instead of a slow drift. Returns `current` untouched for a row that
 * `canStep` rejects.
 */
export function steppedValue(field: TunableField, current: number, direction: 1 | -1): number {
  if (!canStep(field)) return current;
  const next = current + direction * field.step!;
  return Math.min(field.max!, Math.max(field.min!, next));
}

/**
 * A chassis's shipped kit (PG34) — what the "restore loadout" button beside each car select writes.
 * `undefined` when the kit is not three distinct weapons, so a future chassis with a short or
 * duplicated kit disables the button rather than producing a loadout `isPlaygroundSetup` rejects.
 */
export function shippedLoadoutOf(carId: CarId): [WeaponId, WeaponId, WeaponId] | undefined {
  const kit = slotsOf(carId);
  return isLoadoutLegal(kit) ? [kit[0], kit[1], kit[2]] : undefined;
}
```

Add `slotsOf` to the file's import from `@motor-combat-moba/shared`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w @motor-combat-moba/client
```

Expected: FAIL only in `overlay.ts`, which still imports `sliderGroups`. That is Task 6. Confirm
`ui-model.test.ts` itself is green.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/playground/ui-model.ts packages/client/src/dev/playground/ui-model.test.ts
git commit -m "feat(client): stats tabs, slider steppers and shipped-loadout derivations (PG34/PG35/PG36)"
```

---

## Task 6a: Settings panel — sticky header and the car rows

**Files:**
- Modify: `packages/client/src/dev/playground/overlay.ts`

**Interfaces:**
- Consumes: `shippedLoadoutOf` (Task 5); `COLOR_TABLE`, `isBotDifficulty`, `BotDifficulty` (Task 1).
- Produces: nothing exported — `mountPlaygroundOverlay`'s signature is unchanged.
- This file is the thin untested DOM shell (PG19). **Verification is `npm run build` plus loading the page**, not a unit test. Do not add a test file for it.

- [ ] **Step 1: Extend the CSS**

In `overlay.ts`'s `CSS` string, add:

```css
.pg-settings-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: -20px -24px 12px;
  padding: 16px 24px 10px;
  background: rgba(20, 22, 26, 0.98);
  border-bottom: 1px solid #333;
}
.pg-settings-header h2 {
  margin: 0;
}
.pg-settings-header button {
  width: auto;
  margin: 0;
  padding: 6px 16px;
}
.pg-illegal-hint {
  margin-left: auto;
  margin-right: 10px;
  font-size: 11px;
  color: #d94040;
}
.pg-car-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.pg-car-row select.pg-car {
  flex: 2;
  min-width: 0;
}
.pg-car-row select.pg-color {
  flex: 1;
  min-width: 0;
}
.pg-car-row button {
  flex: 0 0 auto;
  width: auto;
  margin: 0;
  padding: 4px 9px;
}
.pg-difficulty {
  margin-left: 10px;
  padding: 2px 4px;
  background: #1c1e22;
  color: #f0f0f0;
  border: 1px solid #555;
  border-radius: 4px;
}
.pg-difficulty:disabled {
  opacity: 0.4;
}
```

Change `.pg-settings`'s `min-width` from `360px` to `420px`.

- [ ] **Step 2: Add the colour and difficulty controls**

Add a helper beside `selectFor`:

```ts
/** The six player colours, by name, for a car's colour select (PG31). Both cars may pick the same
 * one — there is deliberately no guard here or on the wire. */
function colorSelect(value: number): HTMLSelectElement {
  const select = selectFor(
    COLOR_TABLE.map((color) => ({ id: String(color.colorId), name: color.name })),
    String(value),
  );
  select.classList.add("pg-color");
  return select;
}
```

In `buildSettings`, after the mode radios:

```ts
    const meColorSelect = colorSelect(initial.me.colorId);
    const oppColorSelect = colorSelect(initial.opponent.colorId);

    const difficultySelect = selectFor(
      [
        { id: "easy", name: "Easy" },
        { id: "medium", name: "Medium" },
        { id: "hard", name: "Hard" },
      ],
      initial.botDifficulty,
    );
    difficultySelect.classList.add("pg-difficulty");
    // Meaningless while the other car is a target dummy, and saying so with the control itself is
    // clearer than leaving a live select that changes nothing.
    const syncDifficultyEnabled = (): void => {
      difficultySelect.disabled = !modeBot.checked;
    };
    syncDifficultyEnabled();
    for (const el of [modeAlone, modeBot]) {
      el.addEventListener("change", syncDifficultyEnabled);
    }
```

Add both car selects the `pg-car` class where they are built:

```ts
    const meCarSelect = selectFor(cars, initial.me.carId);
    const oppCarSelect = selectFor(cars, initial.opponent.carId);
    meCarSelect.classList.add("pg-car");
    oppCarSelect.classList.add("pg-car");
```

- [ ] **Step 3: Extend `readSetup` to carry the new fields**

```ts
    function readSetup(): PlaygroundSetup {
      return {
        botEnabled: modeBot.checked,
        botDifficulty: isBotDifficulty(difficultySelect.value) ? difficultySelect.value : "medium",
        arenaId: arenaSelect.value,
        me: {
          carId: meCarSelect.value as CarId,
          colorId: Number(meColorSelect.value),
          weapons: meWeaponSelects.map((s) => s.value) as [WeaponId, WeaponId, WeaponId],
        },
        opponent: {
          carId: oppCarSelect.value as CarId,
          colorId: Number(oppColorSelect.value),
          weapons: oppWeaponSelects.map((s) => s.value) as [WeaponId, WeaponId, WeaponId],
        },
      };
    }
```

Add `meColorSelect`, `oppColorSelect` and `difficultySelect` to the `controls` array so each fires
`evaluate(true)` on change. **Do not** add them to the second loop that calls `renderStats()` — a
colour or difficulty change does not alter which stat sections are drawn.

- [ ] **Step 4: Add the restore-shipped-loadout buttons**

```ts
    /** Writes a chassis's shipped kit into one car's three weapon selects (PG34), then runs the
     * ordinary edit path so the send, the persistence and the stats sections all follow. Disabled
     * for a chassis whose kit is not three distinct weapons, so it can never build a loadout the
     * validator would reject. */
    function restoreButton(
      carSelect: HTMLSelectElement,
      weaponSelects: HTMLSelectElement[],
    ): HTMLButtonElement {
      const btn = button({ class: "pg-restore" }, ["↺"], () => {
        const kit = shippedLoadoutOf(carSelect.value as CarId);
        if (!kit) return;
        weaponSelects.forEach((select, i) => {
          select.value = kit[i]!;
        });
        evaluate(true);
        renderStats();
      });
      const sync = (): void => {
        const carId = carSelect.value as CarId;
        const kit = shippedLoadoutOf(carId);
        btn.disabled = kit === undefined;
        btn.title = kit
          ? `Restore ${CAR_TABLE[carId].name}'s shipped loadout`
          : "This chassis has no three-weapon kit";
      };
      sync();
      carSelect.addEventListener("change", sync);
      return btn;
    }

    const meRestoreBtn = restoreButton(meCarSelect, meWeaponSelects);
    const oppRestoreBtn = restoreButton(oppCarSelect, oppWeaponSelects);
```

Place this **after** `evaluate` and `renderStats` are declared (both are function declarations, so
hoisting makes the closure safe wherever it sits, but keeping it below them keeps the file readable).

Add `CAR_TABLE`, `COLOR_TABLE`, `isBotDifficulty` to the shared import and `shippedLoadoutOf` to the
`./ui-model.js` import.

- [ ] **Step 5: Rebuild the panel's markup**

Replace the returned tree's header and car rows:

```ts
    const illegalHint = h("span", { class: "pg-illegal-hint" }, ["duplicate weapon in a loadout"]);

    const carRow = (
      label: string,
      carSelect: HTMLSelectElement,
      colorSel: HTMLSelectElement,
      restoreBtn: HTMLButtonElement,
    ): HTMLElement =>
      h("div", { class: "pg-row" }, [
        h("label", {}, [label]),
        h("div", { class: "pg-car-row" }, [carSelect, colorSel, restoreBtn]),
      ]);

    return h("div", { class: "pg-panel pg-settings" }, [
      h("div", { class: "pg-settings-header" }, [h("h2", {}, ["Settings"]), illegalHint, backBtn]),
      h("div", { class: "pg-row pg-mode" }, [
        h("label", {}, [modeAlone, " Play alone"]),
        h("label", {}, [modeBot, " Vs bot"]),
        difficultySelect,
      ]),
      row("Arena", arenaSelect),
      carRow("My car", meCarSelect, meColorSelect, meRestoreBtn),
      row("My loadout", meLoadoutRow),
      carRow("Opponent car", oppCarSelect, oppColorSelect, oppRestoreBtn),
      row("Opponent loadout", oppLoadoutRow),
      h("div", { class: "pg-stats-toolbar" }, [resetAllBtn, copyBtn]),
      statsContainer,
    ]);
```

Note `backBtn` has moved into the header and is **no longer appended at the bottom**.

In `evaluate`, show the hint only while Back is disabled:

```ts
      backBtn.disabled = !meLegal || !oppLegal;
      settingsIllegal = backBtn.disabled;
      illegalHint.hidden = !backBtn.disabled;
```

Set `illegalHint.hidden = true` at construction so it does not flash before the first `evaluate`.

- [ ] **Step 6: Verify it compiles and runs**

```bash
npm run build
```

Expected: PASS.

```bash
npm run dev
```

Open `http://localhost:5173/?dev=playground`, press `P`, click **Settings**, and confirm by eye:
Back sits top-right on the same line as the "Settings" heading and stays there while the panel
scrolls; both car rows show a colour select and a `↺`; picking a colour repaints that car
immediately **without** resetting its hp bar; `↺` restores that chassis's real kit; the difficulty
select is greyed while "Play alone" is checked; setting two weapon slots to the same weapon disables
Back and shows the red hint beside it. Stop the server when done.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/dev/playground/overlay.ts
git commit -m "feat(client): sticky settings header, car colour and restore-loadout controls (PG31/PG33/PG34)"
```

---

## Task 6b: Settings panel — tabbed stats and slider steppers

**Files:**
- Modify: `packages/client/src/dev/playground/overlay.ts`

**Interfaces:**
- Consumes: `statsTabs`, `canStep`, `steppedValue`, `StatsTabKey` (Task 5).
- Produces: nothing exported. Still the untested DOM shell (PG19).

- [ ] **Step 1: Extend the CSS**

```css
.pg-tabs {
  display: flex;
  gap: 6px;
  margin: 14px 0 4px;
  border-bottom: 1px solid #333;
}
.pg-tabs button {
  flex: 1;
  width: auto;
  margin: 0;
  border-radius: 4px 4px 0 0;
  border-bottom: none;
  font-size: 13px;
}
.pg-tabs button.pg-tab-active {
  background: #3a4048;
  color: #ffffff;
}
.pg-tab-empty {
  margin: 10px 0;
  font-size: 12px;
  color: #6f757c;
}
.pg-stat-row .pg-step {
  flex: 0 0 auto;
  width: auto;
  margin: 0;
  padding: 1px 6px;
  font-size: 12px;
  line-height: 1.2;
}
```

- [ ] **Step 2: Add the stepper buttons to a number row**

In `fieldRow`, after `valueSpan` is built and `onEdit` is defined, add:

```ts
      /** Nudge by one `field.step`, clamped, then run the ordinary edit path (PG36) so the
       * `isAtShipped` tolerance, the readout and the localStorage save all behave as a drag's do.
       * Reads the control's CURRENT value — already snapped by the browser to the min/step grid —
       * rather than tracking a float here, which is what makes up-then-down a round trip. */
      function stepBy(direction: 1 | -1): void {
        const value = readValue();
        if (typeof value !== "number") return;
        applyValue(steppedValue(field, value, direction));
        onEdit();
      }

      const steppers = canStep(field)
        ? [
            button({ class: "pg-step", title: "One step down" }, ["−"], () => stepBy(-1)),
            button({ class: "pg-step", title: "One step up" }, ["+"], () => stepBy(1)),
          ]
        : [];
```

Change the returned row so the two buttons bracket the control:

```ts
      return h("div", { class: "pg-row pg-stat-row" }, [
        h("label", { title: path }, [`${field.label} (shipped ${String(field.shipped)})`]),
        steppers[0] ?? null,
        control,
        steppers[1] ?? null,
        valueSpan,
        resetBtn,
      ]);
```

(`h`'s `Child` type already accepts `null`, so an enum or boolean row simply skips them.)

Add `canStep` and `steppedValue` to the `./ui-model.js` import.

- [ ] **Step 3: Replace the flat stats render with three tabs**

Above `renderStats`, add the active-tab state:

```ts
    /** Which stats tab is showing (PG35). Local to this settings session and NOT persisted: it opens
     * on Global every time, and `renderStats` preserves it across a car/weapon change. */
    let activeTab: StatsTabKey = "global";
    const tabBar = h("div", { class: "pg-tabs" });
```

Replace `renderStats`:

```ts
    /** Rebuilds the tab bar and the active tab's rows from `statsTabs(readSetup())` — the sections
     * depend on which cars/weapons are selected (PG13/PG35), so this runs once up front and again
     * whenever a car or weapon select changes. Never called mid-drag of a range input: that would
     * tear down the element the pointer has captured. */
    function renderStats(): void {
      const tabs = statsTabs(readSetup());

      tabBar.replaceChildren();
      for (const tab of tabs) {
        const btn = button({ class: tab.key === activeTab ? "pg-tab-active" : "" }, [tab.title], () => {
          activeTab = tab.key;
          renderStats();
        });
        tabBar.appendChild(btn);
      }

      statsContainer.replaceChildren();
      const current = tabs.find((tab) => tab.key === activeTab) ?? tabs[0]!;
      if (current.groups.length === 0) {
        statsContainer.appendChild(h("div", { class: "pg-tab-empty" }, ["Nothing selected."]));
        return;
      }
      for (const group of current.groups) {
        statsContainer.appendChild(
          h("div", { class: "pg-stat-group" }, [
            h("h3", {}, [group.title]),
            ...group.fields.map(fieldRow),
          ]),
        );
      }
    }
    renderStats();
```

Insert `tabBar` into the returned tree, between the toolbar and `statsContainer`:

```ts
      h("div", { class: "pg-stats-toolbar" }, [resetAllBtn, copyBtn]),
      tabBar,
      statsContainer,
```

Swap the `sliderGroups` import for `statsTabs`, and add `type StatsTabKey`.

- [ ] **Step 4: Verify it compiles and runs**

```bash
npm run build
```

Expected: PASS — and no remaining reference to `sliderGroups` anywhere:

```bash
grep -rn "sliderGroups" packages/
```

Expected: no output.

```bash
npm run dev
```

At `http://localhost:5173/?dev=playground` → `P` → **Settings**, confirm: three tabs read
Global / Cars / Weapons and open on Global; Cars shows only the selected chassis and Weapons only the
selected six; `−`/`+` appear on slider rows but not on checkbox or dropdown rows; one press moves the
readout by one step and stops at the ends; pressing `+` then `−` returns to the starting number; `↺`
still snaps to the shipped value and clears the override; changing a car keeps you on the tab you
were on. Stop the server when done.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/playground/overlay.ts
git commit -m "feat(client): tabbed stats and per-slider steppers in the playground settings panel (PG35/PG36)"
```

---

## Task 7: `?dev=assets` — unassigned weapons and inactive chassis

**Files:**
- Modify: `packages/client/src/dev/tuning-layout.ts`
- Modify: `packages/client/src/dev/AssetTuningScene.ts`
- Test: `packages/client/src/dev/tuning-layout.test.ts`

**Interfaces:**
- Consumes: `orphanWeaponIds`, `weaponCellCenter` (both already in `tuning-layout.ts`).
- Produces:
  - `const WEAPON_GRID_COLS = 3`
  - `unassignedCellPosition(index: number, chassisCount: number): { row: number; col: number }`

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/src/dev/tuning-layout.test.ts`:

```ts
describe("unassignedCellPosition (PG37)", () => {
  it("starts on the row below the last chassis row", () => {
    expect(unassignedCellPosition(0, 3)).toEqual({ row: 3, col: 0 });
    expect(unassignedCellPosition(0, 1)).toEqual({ row: 1, col: 0 });
  });

  it("fills left to right before wrapping", () => {
    expect(unassignedCellPosition(1, 3)).toEqual({ row: 3, col: 1 });
    expect(unassignedCellPosition(2, 3)).toEqual({ row: 3, col: 2 });
  });

  it("wraps to a new row every WEAPON_GRID_COLS cells", () => {
    expect(WEAPON_GRID_COLS).toBe(3);
    expect(unassignedCellPosition(3, 3)).toEqual({ row: 4, col: 0 });
    expect(unassignedCellPosition(7, 3)).toEqual({ row: 5, col: 1 });
  });

  it("lands on a real grid point, so the cells line up with the kit columns above", () => {
    const { row, col } = unassignedCellPosition(1, 3);
    expect(weaponCellCenter(row, col)).toEqual(weaponCellCenter(3, 1));
  });
});
```

Add `WEAPON_GRID_COLS` and `unassignedCellPosition` to the file's import from `./tuning-layout.js`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w @motor-combat-moba/client
```

Expected: FAIL — `unassignedCellPosition is not a function`.

- [ ] **Step 3: Implement the layout helper**

In `packages/client/src/dev/tuning-layout.ts`, beside `orphanWeaponIds`:

```ts
/**
 * Cells per row in the weapon grid. Equal to the kit size, so an unassigned weapon's cell lines up
 * with the slot columns above it rather than starting a second, differently-pitched grid.
 */
export const WEAPON_GRID_COLS = 3;

/**
 * Where the `index`-th unassigned weapon's cell goes (PG37): straight below the last chassis row,
 * filling left to right and wrapping every `WEAPON_GRID_COLS`.
 *
 * Takes `chassisCount` rather than reading `CAR_TABLE`, for the same reason `orphanWeaponIds` takes
 * its tables — the wrap and the offset are covered by fixtures instead of by whatever the roster
 * happens to be today.
 */
export function unassignedCellPosition(
  index: number,
  chassisCount: number,
): { row: number; col: number } {
  return {
    row: chassisCount + Math.floor(index / WEAPON_GRID_COLS),
    col: index % WEAPON_GRID_COLS,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w @motor-combat-moba/client
```

Expected: PASS.

- [ ] **Step 5: Draw the unassigned row and mark inactive chassis**

In `AssetTuningScene.ts`, extract the row label so the unassigned row can reuse it, and append the
orphan cells. Replace `drawWeaponGrid`:

```ts
  /** Every weapon's icon: one row per chassis in kit-slot order, then a row for anything on no kit
   * at all (PG37) — an orphan is usually a weapon being brought up, and it needs looking at more
   * than a shipped one does. */
  private drawWeaponGrid(): void {
    const cars = Object.values(CAR_TABLE);
    cars.forEach((car, row) => {
      this.drawGridRowLabel(
        row,
        car.id,
        `slots 1-${car.weapons.length}`,
        car.isActive ? undefined : "inactive",
      );
      car.weapons.forEach((weaponId, col) => this.drawWeaponCell(weaponId, row, col));
    });

    const orphans = orphanWeaponIds(
      Object.keys(WEAPON_TABLE),
      cars.map((car) => car.weapons),
    );
    orphans.forEach((weaponId, index) => {
      const { row, col } = unassignedCellPosition(index, cars.length);
      if (col === 0) this.drawGridRowLabel(row, "unassigned", "on no kit");
      this.drawWeaponCell(weaponId as WeaponId, row, col);
    });
  }

  /** The label pair to the left of one weapon-grid row, plus an optional amber tag beneath. */
  private drawGridRowLabel(row: number, title: string, subtitle: string, tag?: string): void {
    const rowY = weaponCellCenter(row, 0).y;
    this.add
      .text(150, rowY, title, { fontSize: "15px", color: "#ffffff", fontStyle: "bold" })
      .setOrigin(1, 0.5);
    this.add
      .text(150, rowY + 20, subtitle, { fontSize: "11px", color: "#6f757c" })
      .setOrigin(1, 0.5);
    if (tag) {
      this.add.text(150, rowY + 36, tag, { fontSize: "11px", color: "#d99a40" }).setOrigin(1, 0.5);
    }
  }
```

In `drawCell`, after the manifest-key text, add the same tag for the car section (PG38):

```ts
    if (!CAR_TABLE[carId as CarId].isActive) {
      this.add
        .text(x, y + 80, "inactive", { fontSize: "11px", color: "#d99a40" })
        .setOrigin(0.5);
    }
```

In `summary`, the orphans are now drawn, so drop the "not shown" claim:

```ts
    const orphanNote = orphans.length > 0 ? ` (${orphans.join(", ")} on no kit)` : "";
```

Add `unassignedCellPosition` to the `./tuning-layout.js` import and `type CarId` to the shared import.

- [ ] **Step 6: Verify**

```bash
npm test && npm run build
```

Expected: PASS.

```bash
npm run dev
```

Open `http://localhost:5173/?dev=assets` and confirm an **unassigned** row sits below the three
chassis rows carrying `tremor`'s cell — icon (or its "no icon" marker), slot circle, shot swatch and
manifest line, drawn exactly like every other weapon — and that the header note now reads
`(tremor on no kit)` without "not shown". Stop the server when done.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/dev/tuning-layout.ts packages/client/src/dev/tuning-layout.test.ts packages/client/src/dev/AssetTuningScene.ts
git commit -m "feat(client): draw unassigned weapons and mark inactive chassis in ?dev=assets (PG37/PG38)"
```

---

## Task 8: Documentation obligations and final verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/config-reference.md`

- [ ] **Step 1: Point the doc table at the new spec**

In root `CLAUDE.md`'s "Read the right doc" table, extend the playground row so it names both specs:

```markdown
| The dev-only playtest playground: `?dev=playground`, the extracted tick pipeline, the runtime tuning store, `isActive`, the bot, persistence/export (PG1–PG23); bot difficulty, car colour, tabbed stats and the settings re-layout (PG24–PG40) | [`docs/superpowers/specs/2026-09-01-playtest-playground-design.md`](docs/superpowers/specs/2026-09-01-playtest-playground-design.md), [`docs/superpowers/specs/2026-09-02-playground-usability-and-bot-difficulty-design.md`](docs/superpowers/specs/2026-09-02-playground-usability-and-bot-difficulty-design.md) |
```

- [ ] **Step 2: Record the table rename in the config reference**

Find where `docs/config-reference.md` names `BOT_CONFIG` (search for it) and replace that mention:

```bash
grep -n "BOT_CONFIG" docs/config-reference.md
```

Rewrite the sentence to describe `BOT_PROFILES` instead — a dev-only, frozen
`Record<BotDifficulty, BotProfile>` in `packages/server/src/rooms/playground-bot.ts` whose `hard` row
is pinned by test to the numbers the single shipped bot used, and which is never read by `stepSim` or
by any release code path. If the grep finds nothing, add one line in the same section that documents
the other dev-only tables; do not invent a new section.

- [ ] **Step 3: Full verification**

```bash
npm test
```

Expected: PASS, `golden.test.ts` included and unmodified.

```bash
npm run build
```

Expected: PASS.

```bash
git status --porcelain
```

Expected: only the two doc files, if you have not committed them yet.

- [ ] **Step 4: Confirm the dev tools stayed out of the release bundle**

```bash
npm run build:release
```

Expected: PASS. `assertNoDevOnlyCode` fails the build if `DEV_TOOL_MARKER` reached a release bundle;
a pass is the proof that everything in this plan is still dev-only. Delete the generated
`dist-release/` and zip afterwards if the repo does not gitignore them:

```bash
git status --porcelain
```

Expected: no untracked build output.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/config-reference.md
git commit -m "docs: record playground bot profiles and the PG24-PG40 spec (PG40)"
```

- [ ] **Step 6: Report what a human still has to look at**

The suites cannot see any of this. Say so in the completion summary, naming each:

- `?dev=playground` → `P` → Settings: header, colour selects, `↺`, difficulty select, tabs, steppers.
- `?dev=assets`: the unassigned row.
- **The bot at each difficulty is a feel judgement no test makes.** Recommend driving all three and
  say the numbers in `BOT_PROFILES` are a starting point, tunable in one place.
- Confirm in the summary that **no playtest probe was touched and none needed to be** (nothing in
  this plan reaches `sim/`, a balance table, the tick order or the client's prediction assembly), so
  `npm run playtest` is not owed — but the user may run it if they want a baseline.

---

## Self-Review

**Spec coverage:**

| Spec decision | Task |
|---|---|
| PG24 new fields, strict validation | 1 |
| PG25 storage upgrade on load | 2 |
| PG26 alone + medium + distinct colours by default | 1 |
| PG27 `BOT_PROFILES`, hard pinned by value, tolerance < cone | 3 |
| PG28 deadband coast, reaction delay | 3 (deadband), 4 (reaction) |
| PG29 pure `botInput`, room owns cadence, fresh `seq`, cleared hold | 3, 4 |
| PG30 `botDifficulty` schema field | 1 (field), 4 (written) |
| PG31 colour from `COLOR_TABLE`, duplicates allowed | 1 (wire), 6a (UI) |
| PG32 colour never respawns | 4 |
| PG33 sticky header, Back top-right, illegal hint | 6a |
| PG34 restore shipped loadout | 5 (derivation), 6a (button) |
| PG35 three tabs, same filter | 5 (derivation), 6b (UI) |
| PG36 steppers, number rows only, read-snapped-then-step | 5 (derivation), 6b (UI) |
| PG37 unassigned weapon row | 7 |
| PG38 inactive chassis tag | 7 |
| PG39 tests | in each task |
| PG40 obligations | 8 |

No spec decision is unassigned.

**Placeholder scan:** every code step carries the actual code. No "TBD", no "handle edge cases", no
"similar to Task N". The two places that say *find and rewrite* rather than showing a diff — Task 8's
`config-reference.md` edit and Task 3's "add `HARD` to every existing call" — both give the exact
grep and the exact replacement text, because the surrounding lines are not knowable from here.

**Type consistency:** `BotProfile` / `BOT_PROFILES` / `botInput(..., profile)` are named identically
in Tasks 3 and 4. `loadoutOrChassisChanged`, `shouldRecomputeIntent`, `pulsedFireSlots` appear with
the same signatures in Task 4's Interfaces block, its tests, and its implementation.
`statsTabs` / `StatsTab` / `StatsTabKey` / `canStep` / `steppedValue` / `shippedLoadoutOf` match
between Task 5's definitions and Task 6a/6b's uses. `isColorId` / `isBotDifficulty` are defined in
Task 1 and consumed in Tasks 1, 4 and 6a. `unassignedCellPosition` / `WEAPON_GRID_COLS` match between
Task 7's test, helper and scene.
