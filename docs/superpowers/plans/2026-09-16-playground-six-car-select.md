# Playground six-car select — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the dev-only playground from a two-car sandbox to six independently configured seats, and move every car-and-match control out of Physics settings into a new Car select panel.

**Architecture:** Six fixed seats with stable session ids (`pg-0`…`pg-5`) replace the human-session/`"bot"` pair. `PlaygroundSetup` carries a six-entry `cars` list plus a `drivenSeat` index; `PlaygroundRoom` adds and removes cars as `enabled` flips and runs one `HumanController` per non-driven enabled seat; the overlay grows a `car-panel.ts` module alongside the existing `vfx-panel.ts` and `env-panel.ts`.

**Tech Stack:** TypeScript, npm workspaces, Colyseus schema, Phaser 4, vitest.

**Spec:** [`docs/superpowers/specs/2026-09-16-playground-six-car-select-design.md`](../specs/2026-09-16-playground-six-car-select-design.md) — clauses PG56–PG88. Read it alongside this plan; every task cites the clauses it implements.

## Global Constraints

- **`npm run dev` must be running or shared must be rebuilt after any `packages/shared` edit.**
  Server and client consume built `dist`, not `src`. After Task 2, run
  `npm run build -w @motor-combat-moba/shared` before any manual browser check. Unit tests import
  `src` and do not need it.
- **Never run `npm run build --workspaces`.** Use root `npm run build`, which enforces
  shared → server → client ordering.
- **There is a deliberate red window between Task 2 and Task 6.** Task 2 changes a shared type that
  the server and client both consume; `npm run build` will not typecheck until Task 6 closes the
  loop. Each of Tasks 2–5 is gated on **its own package's vitest run**, which compiles per-file
  through esbuild and does not typecheck across packages. Task 6 carries the full
  `npm run build && npm test` gate. Do not "fix" the red build early by patching consumers you are
  about to rewrite.
- **Sim code is out of scope.** Nothing in `packages/shared/src/sim/` changes, no balance table
  moves, and no playtest probe is touched. If a task seems to need one, stop and say so.
- **Never renumber an enum wire value** (hard invariant 7). Nothing here adds one.
- **Seat ids are `"pg-0"` … `"pg-5"`** and `PLAYGROUND_SEATS` is derived from `MAX_PLAYERS`, never
  typed as `6` (PG56).
- **Commit after every task**, with the clause ids in the message body.

---

### Task 1: Forget-a-player helpers for the two memory bridges

The playground will remove a car mid-session (PG67). Neither `CombatMemory` nor `ContactMemory` has
a way to drop one session's state today — a real match never needs one, because a car leaves only
when the room does. These two pure helpers are that seam. **This task is independent of every other
task and leaves the build green.**

**Files:**
- Modify: `packages/server/src/sim/combat-bridge.ts`
- Modify: `packages/server/src/sim/ram-bridge.ts`
- Test: `packages/server/src/sim/combat-bridge.test.ts`
- Test: `packages/server/src/sim/ram-bridge.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `forgetCombatPlayer(memory: CombatMemory, sessionId: string): void`
  - `forgetContactPlayer(memory: ContactMemory, sessionId: string): void`

- [ ] **Step 1: Write the failing combat-bridge test**

Append to `packages/server/src/sim/combat-bridge.test.ts`. Add `forgetCombatPlayer` to that file's
existing import from `./combat-bridge.js`, and `newFireState` to its import from
`@motor-combat-moba/shared` if it is not already there.

```ts
describe("forgetCombatPlayer (PG67)", () => {
  it("drops every session-keyed map entry for one player and leaves the others", () => {
    const memory = newCombatMemory();
    for (const id of ["pg-0", "pg-1"]) {
      memory.fireStates.set(id, newFireState("mirage", 3));
      memory.locks.set(id, { targetSessionId: "x", heldTicks: 0, reacquireAtTick: 0 });
      memory.maneuverWeapons.set(id, "thunderclap");
      memory.maneuverPressIds.set(id, `${id}-press`);
      memory.lastDamagers.set(id, "someone");
      memory.loadouts.set(id, ["magmablast", "thunderclap", "afterburner"]);
    }

    forgetCombatPlayer(memory, "pg-0");

    expect(memory.fireStates.has("pg-0")).toBe(false);
    expect(memory.locks.has("pg-0")).toBe(false);
    expect(memory.maneuverWeapons.has("pg-0")).toBe(false);
    expect(memory.maneuverPressIds.has("pg-0")).toBe(false);
    expect(memory.lastDamagers.has("pg-0")).toBe(false);
    expect(memory.loadouts.has("pg-0")).toBe(false);

    // The other seat is untouched: removing one car must not reset the rest of the field.
    expect(memory.fireStates.has("pg-1")).toBe(true);
    expect(memory.loadouts.get("pg-1")).toEqual(["magmablast", "thunderclap", "afterburner"]);
  });

  it("is a no-op for a session it has never seen", () => {
    const memory = newCombatMemory();
    memory.loadouts.set("pg-1", ["predator", "pepperbox", "lance"]);
    expect(() => forgetCombatPlayer(memory, "pg-4")).not.toThrow();
    expect(memory.loadouts.size).toBe(1);
  });
});
```

If `LockState`'s fields differ from `{ targetSessionId, heldTicks, reacquireAtTick }`, read the
interface in `packages/server/src/sim/combat-bridge.ts` and use its real fields — the assertion is
about deletion, not about the lock's shape.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/server/src/sim/combat-bridge.test.ts -t "forgetCombatPlayer"`
Expected: FAIL — `forgetCombatPlayer is not a function` / not exported.

- [ ] **Step 3: Implement it**

Append to `packages/server/src/sim/combat-bridge.ts`:

```ts
/**
 * Drop one session's combat memory entirely (spec PG67).
 *
 * A real match never needs this — a car leaves only when the room does — but the playground removes
 * a seat mid-session and re-adds it later, and a seat that came back carrying its old target lock or
 * a half-finished maneuver would be the previous car wearing a new chassis.
 *
 * Deliberately does NOT sweep `instances` owned by this session. A weapon instance is detached from
 * its owner the moment it is in flight and `runCombat` resolves an ownerless one without incident —
 * the same situation a car dying mid-flight already produces — so cancelling them here would delete
 * shots the world has already seen leave the muzzle.
 */
export function forgetCombatPlayer(memory: CombatMemory, sessionId: string): void {
  memory.fireStates.delete(sessionId);
  memory.locks.delete(sessionId);
  memory.maneuverWeapons.delete(sessionId);
  memory.maneuverPressIds.delete(sessionId);
  memory.lastDamagers.delete(sessionId);
  memory.loadouts.delete(sessionId);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run packages/server/src/sim/combat-bridge.test.ts -t "forgetCombatPlayer"`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing ram-bridge test**

Append to `packages/server/src/sim/ram-bridge.test.ts`, adding `forgetContactPlayer` and
`newContactMemory` to its existing `./ram-bridge.js` import and `pairKey` to its
`@motor-combat-moba/shared` import.

```ts
describe("forgetContactPlayer (PG67)", () => {
  it("drops the seat's slam, falloff and spike state", () => {
    const memory = newContactMemory();
    memory.slammed.set("pg-0", {
      bySessionId: "pg-1",
      wallStunUntilTick: 40,
      immuneUntilTick: 60,
      wallStunTicks: 15,
    });
    memory.falloff.set("pg-0", { count: 3, expiresAtTick: 90 });
    memory.spikes.lastShover.set("pg-0", { sessionId: "pg-1", tick: 10 });
    memory.spikes.immuneUntil.set("pg-0", 50);

    forgetContactPlayer(memory, "pg-0");

    expect(memory.slammed.has("pg-0")).toBe(false);
    expect(memory.falloff.has("pg-0")).toBe(false);
    expect(memory.spikes.lastShover.has("pg-0")).toBe(false);
    expect(memory.spikes.immuneUntil.has("pg-0")).toBe(false);
  });

  it("purges every contact pair naming the seat, and keeps the pairs that do not", () => {
    // The subtle one: `contacts` is what makes a ram fire on ENTRY rather than every tick. A pair
    // key left behind would make the next genuine contact between those two read as a continuing
    // one and land no ram at all.
    const memory = newContactMemory();
    memory.contacts.add(pairKey("pg-0", "pg-1"));
    memory.contacts.add(pairKey("pg-2", "pg-0"));
    memory.contacts.add(pairKey("pg-1", "pg-2"));

    forgetContactPlayer(memory, "pg-0");

    expect([...memory.contacts]).toEqual([pairKey("pg-1", "pg-2")]);
  });

  it("is a no-op for a session it has never seen", () => {
    const memory = newContactMemory();
    memory.contacts.add(pairKey("pg-1", "pg-2"));
    expect(() => forgetContactPlayer(memory, "pg-5")).not.toThrow();
    expect(memory.contacts.size).toBe(1);
  });
});
```

If `SpikeMemory.lastShover`'s value shape differs from `{ sessionId, tick }`, read
`packages/server/src/sim/spike-bridge.ts` and use its real shape.

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run packages/server/src/sim/ram-bridge.test.ts -t "forgetContactPlayer"`
Expected: FAIL — `forgetContactPlayer is not a function`.

- [ ] **Step 7: Implement it**

Append to `packages/server/src/sim/ram-bridge.ts` (`forgetSpikeState` is already re-exported from
this module, so it is in scope — check the `import { ... } from "./spike-bridge.js"` line at the top
and add `forgetSpikeState` to it if only the re-export exists):

```ts
/**
 * Drop one session's contact memory entirely (spec PG67).
 *
 * The three maps are ordinary per-victim state. `contacts` is the one worth naming: it holds pair
 * keys so a ram fires on ENTRY rather than on every tick of an overlap, so a key left behind after a
 * car is removed would make the NEXT genuine contact between those two cars read as a continuing one
 * and land no ram at all. Deleting from a `Set` while iterating it is well-defined in JS — an entry
 * removed at or before the cursor is simply not revisited.
 */
export function forgetContactPlayer(memory: ContactMemory, sessionId: string): void {
  memory.slammed.delete(sessionId);
  memory.falloff.delete(sessionId);
  forgetSpikeState(memory.spikes, sessionId);
  for (const key of memory.contacts) {
    const [a, b] = key.split("|");
    if (a === sessionId || b === sessionId) memory.contacts.delete(key);
  }
}
```

- [ ] **Step 8: Run both suites and the whole server package**

Run: `npx vitest run packages/server/src/sim/`
Expected: PASS, no regressions.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/sim/combat-bridge.ts packages/server/src/sim/combat-bridge.test.ts \
        packages/server/src/sim/ram-bridge.ts packages/server/src/sim/ram-bridge.test.ts
git commit -m "feat(sim): forget one session's combat and contact memory (PG67)

The playground is about to remove a car mid-session and re-add it later.
Neither memory bag could drop one session before this; a real match never
needed it, because a car leaves only when the room does.

The contacts purge is the non-obvious half: that set holds pair keys so a
ram fires on entry, so a key outliving its car would make the next genuine
contact read as a continuing one and land no ram at all."
```

---

### Task 2: Six seats and the new wire type (shared)

Implements PG56, PG60–PG65. **Opens the red window** described in Global Constraints: the server and
client both consume `PlaygroundSetup` and will not typecheck until Task 6. Gate this task on the
shared package's own vitest run only.

**Files:**
- Modify: `packages/shared/src/net/playground-messages.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/net/playground-messages.test.ts`

**Interfaces:**
- Consumes: `MAX_PLAYERS` from `packages/shared/src/constants.ts`.
- Produces:
  - `PLAYGROUND_SEATS: number` (= `MAX_PLAYERS`)
  - `PLAYGROUND_SEAT_IDS: readonly string[]` (`["pg-0", … "pg-5"]`)
  - `PlaygroundCarSetup { carId: CarId; colorId: number; weapons: readonly [WeaponId, WeaponId, WeaponId]; enabled: boolean }`
  - `PlaygroundSetup { botEnabled: boolean; botDifficulty: BotDifficulty; arenaId: string; cars: readonly PlaygroundCarSetup[]; drivenSeat: number }`
  - `isPlaygroundSetup(msg: unknown): msg is PlaygroundSetup`
  - `defaultPlaygroundSetup(): PlaygroundSetup`
  - `MSG_PLAYGROUND_SWITCH` is **removed**.

- [ ] **Step 1: Write the failing tests**

Replace the setup-related blocks in `packages/shared/src/net/playground-messages.test.ts` with these.
Keep every existing block about `isBotDebugPayload`, `isBotDifficulty` and `BOT_SESSION_ID`
untouched — `BOT_SESSION_ID` still exists and `PracticeRoom` still uses it (PG59).

```ts
describe("playground seats (PG56)", () => {
  it("has one seat per player the game allows", () => {
    expect(PLAYGROUND_SEATS).toBe(MAX_PLAYERS);
    expect(PLAYGROUND_SEAT_IDS).toHaveLength(PLAYGROUND_SEATS);
  });

  it("names them in seat order, and they are all distinct", () => {
    expect(PLAYGROUND_SEAT_IDS[0]).toBe("pg-0");
    expect(PLAYGROUND_SEAT_IDS[PLAYGROUND_SEATS - 1]).toBe(`pg-${PLAYGROUND_SEATS - 1}`);
    expect(new Set(PLAYGROUND_SEAT_IDS).size).toBe(PLAYGROUND_SEATS);
  });

  it("never collides with the practice room's bot id (PG59)", () => {
    expect(PLAYGROUND_SEAT_IDS).not.toContain(BOT_SESSION_ID);
  });
});

describe("defaultPlaygroundSetup (PG65)", () => {
  it("opens on two enabled seats, driving the first", () => {
    const setup = defaultPlaygroundSetup();
    expect(setup.cars).toHaveLength(PLAYGROUND_SEATS);
    expect(setup.cars.map((c) => c.enabled)).toEqual([true, true, false, false, false, false]);
    expect(setup.drivenSeat).toBe(0);
    expect(setup.botEnabled).toBe(false);
    expect(setup.botDifficulty).toBe("medium");
  });

  it("paints every seat a distinct colour", () => {
    const setup = defaultPlaygroundSetup();
    expect(new Set(setup.cars.map((c) => c.colorId)).size).toBe(PLAYGROUND_SEATS);
  });

  it("is itself valid", () => {
    expect(isPlaygroundSetup(defaultPlaygroundSetup())).toBe(true);
  });
});

describe("isPlaygroundSetup (PG63)", () => {
  /** A fresh, legal payload each call, so a mutation in one case cannot leak into the next. */
  const valid = (): PlaygroundSetup => defaultPlaygroundSetup();

  it("accepts a legal six-seat payload", () => {
    expect(isPlaygroundSetup(valid())).toBe(true);
  });

  it("accepts six enabled seats", () => {
    const setup = { ...valid(), cars: valid().cars.map((c) => ({ ...c, enabled: true })) };
    expect(isPlaygroundSetup(setup)).toBe(true);
  });

  it("rejects a cars list of the wrong length", () => {
    expect(isPlaygroundSetup({ ...valid(), cars: valid().cars.slice(0, 2) })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), cars: [...valid().cars, valid().cars[0]] })).toBe(false);
  });

  it("rejects a cars value that is not an array", () => {
    expect(isPlaygroundSetup({ ...valid(), cars: { 0: valid().cars[0] } })).toBe(false);
  });

  it("rejects a seat missing its enabled flag", () => {
    const cars = valid().cars.map((c, i) => (i === 3 ? { ...c, enabled: undefined } : c));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(false);
  });

  it("rejects a seat whose three weapons are not distinct (PG17)", () => {
    const cars = valid().cars.map((c, i) =>
      i === 0 ? { ...c, weapons: [c.weapons[0], c.weapons[0], c.weapons[2]] } : c,
    );
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(false);
  });

  it("accepts the same weapon on two DIFFERENT seats (PG17)", () => {
    const base = valid();
    const cars = base.cars.map((c, i) => (i === 1 ? { ...c, weapons: base.cars[0]!.weapons } : c));
    expect(isPlaygroundSetup({ ...base, cars })).toBe(true);
  });

  it("accepts the same colour on two seats (PG31)", () => {
    const cars = valid().cars.map((c) => ({ ...c, colorId: 0 }));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(true);
  });

  it("rejects a payload with no enabled seat", () => {
    const cars = valid().cars.map((c) => ({ ...c, enabled: false }));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(false);
  });

  it("rejects a drivenSeat out of range", () => {
    expect(isPlaygroundSetup({ ...valid(), drivenSeat: -1 })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), drivenSeat: PLAYGROUND_SEATS })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), drivenSeat: 0.5 })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), drivenSeat: "0" })).toBe(false);
  });

  it("rejects a drivenSeat naming a DISABLED seat", () => {
    // Seat 2 is off in the default setup, so this is the whole rule in one line.
    expect(isPlaygroundSetup({ ...valid(), drivenSeat: 2 })).toBe(false);
  });

  it("still rejects a bad arena, difficulty or bot flag", () => {
    expect(isPlaygroundSetup({ ...valid(), arenaId: "arena-99" })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), botDifficulty: "nightmare" })).toBe(false);
    expect(isPlaygroundSetup({ ...valid(), botEnabled: "yes" })).toBe(false);
  });

  it("rejects a prototype-chain id rather than resolving it", () => {
    const cars = valid().cars.map((c, i) => (i === 0 ? { ...c, carId: "toString" } : c));
    expect(isPlaygroundSetup({ ...valid(), cars })).toBe(false);
  });
});
```

Add to that file's imports: `MAX_PLAYERS`, `PLAYGROUND_SEATS`, `PLAYGROUND_SEAT_IDS`,
`defaultPlaygroundSetup`, `isPlaygroundSetup`, and `type PlaygroundSetup`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/shared/src/net/playground-messages.test.ts`
Expected: FAIL — `PLAYGROUND_SEATS` is not exported.

- [ ] **Step 3: Rewrite the setup half of `playground-messages.ts`**

Delete the `MSG_PLAYGROUND_SWITCH` constant (PG74 removes the message entirely). Add `MAX_PLAYERS`
to the imports from `../constants.js`. Replace `PlaygroundCarSetup`, `PlaygroundSetup`,
`isPlaygroundCarSetup`, `isPlaygroundSetup` and `defaultPlaygroundSetup` with:

```ts
/**
 * How many cars the playground seats (spec PG56).
 *
 * DERIVED from `MAX_PLAYERS` rather than typed as `6`, so hard invariant 10 and the sandbox's
 * capacity cannot drift apart — a playground that seated more cars than the game allows would be
 * measuring a match that cannot happen.
 */
export const PLAYGROUND_SEATS = MAX_PLAYERS;

/**
 * The six seats' session ids, in seat order (spec PG56/PG57).
 *
 * STABLE, and owned by the seat rather than by a connection: the human's client `sessionId` names
 * no car in this room. That is what makes handing the wheel to another car a single field write on
 * `controlledSessionId` instead of re-keying a row in `state.players`, and it is what lets a
 * client-side per-car override (the tint map in `fx/car-tint.ts`) survive a page reload — keyed on a
 * Colyseus session id, the human's own tint was silently lost on every reconnect.
 *
 * Deliberately not `"bot"`-prefixed: a seat is a seat whether a human or a bot is driving it, and
 * `BOT_SESSION_ID` belongs to `PracticeRoom`, which is untouched by any of this (PG59).
 */
export const PLAYGROUND_SEAT_IDS: readonly string[] = Object.freeze(
  Array.from({ length: PLAYGROUND_SEATS }, (_, i) => `pg-${i}`),
);

export interface PlaygroundCarSetup {
  carId: CarId;
  /** Index into `COLOR_TABLE` (PG31). Purely visual: a colour change never respawns (PG32). */
  colorId: number;
  weapons: readonly [WeaponId, WeaponId, WeaponId];
  /**
   * Is this seat on the field (PG60)?
   *
   * A disabled seat still carries a full, valid configuration (PG62) — unchecking a car parks it,
   * it does not discard it. That is what makes "five cars, then a duel, then back" two clicks, and
   * it is what lets the localStorage codec be a plain round-trip rather than a merge.
   */
  enabled: boolean;
}

export interface PlaygroundSetup {
  botEnabled: boolean;
  botDifficulty: BotDifficulty;
  arenaId: string;
  /** Exactly `PLAYGROUND_SEATS` entries, in seat order. The index IS the seat (PG61). */
  cars: readonly PlaygroundCarSetup[];
  /** Which seat the human drives. In range, and always an ENABLED seat (PG63). */
  drivenSeat: number;
}

/**
 * One seat's chassis, colour, three-slot loadout and on/off flag.
 *
 * `carId` may be ANY valid `CarId`, not only an active one — spec PG20 lets the playground drive a
 * chassis the live roster has retired or not yet activated, which is most of the table as of
 * 2026-09-16. The three weapons must be real and pairwise DISTINCT within this seat; the same weapon
 * on another seat is legal (PG17), and so is the same `colorId` (PG31).
 */
function isPlaygroundCarSetup(value: unknown): value is PlaygroundCarSetup {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (!isCarId(rec.carId)) return false;
  if (!isColorId(rec.colorId)) return false;
  if (typeof rec.enabled !== "boolean") return false;
  const weapons = rec.weapons;
  if (!Array.isArray(weapons) || weapons.length !== 3) return false;
  if (!weapons.every((w) => isWeaponId(w))) return false;
  return new Set(weapons).size === weapons.length;
}

/**
 * Validates a `pg_setup` payload off the wire (PG63). Reject-whole, as PG13 has always required: one
 * bad seat discards the blob rather than applying the good five, so the client's view of what is
 * live can never disagree with the room seat by seat.
 *
 * There is no MAXIMUM to check. Six is structural — there are six seats — so "at most six cars"
 * falls out of the length check rather than being counted anywhere (PG64). The only floor is that at
 * least one seat is enabled, because a room with no cars has nothing to drive and `drivenSeat` would
 * have nothing legal to name.
 *
 * `isCarId`/`isWeaponId`/`isArenaId` all reject an id that exists only via the prototype chain
 * (`"toString"`, `"constructor"`), so this does too.
 */
export function isPlaygroundSetup(msg: unknown): msg is PlaygroundSetup {
  if (msg === null || typeof msg !== "object") return false;
  const rec = msg as Record<string, unknown>;
  if (typeof rec.botEnabled !== "boolean") return false;
  if (!isBotDifficulty(rec.botDifficulty)) return false;
  if (typeof rec.arenaId !== "string" || !isArenaId(rec.arenaId)) return false;

  const cars = rec.cars;
  if (!Array.isArray(cars) || cars.length !== PLAYGROUND_SEATS) return false;
  if (!cars.every(isPlaygroundCarSetup)) return false;
  if (!cars.some((car) => car.enabled)) return false;

  const driven = rec.drivenSeat;
  if (!Number.isInteger(driven)) return false;
  const seat = driven as number;
  if (seat < 0 || seat >= PLAYGROUND_SEATS) return false;
  // The driven seat must be ON the field. The panel already maintains this (PG78 moves the wheel
  // down when the driven seat is unchecked), so this asserts the rule rather than discovering it —
  // but the wire is not allowed to trust the panel.
  return cars[seat]!.enabled === true;
}

/**
 * The playground's opening setup (PG65) — the same sandbox it has always opened on, expressed in
 * seats: the default chassis's shipped loadout everywhere, seats 0 and 1 on the field, seat 0 driven,
 * the live arena, and the bot OFF (on medium for whenever it is switched on) because most sessions
 * open by driving rather than by fighting.
 *
 * Every seat gets a DISTINCT colour. There are exactly as many `COLOR_TABLE` rows as seats, so this
 * costs nothing and means a freshly-enabled fourth car is never a twin of one already out there.
 * Nothing enforces distinctness beyond this default (PG31).
 */
export function defaultPlaygroundSetup(): PlaygroundSetup {
  const [slot0, slot1, slot2] = slotsOf(DEFAULT_CAR_ID);
  const weapons: readonly [WeaponId, WeaponId, WeaponId] = [slot0!, slot1!, slot2!];
  return {
    botEnabled: false,
    botDifficulty: "medium",
    arenaId: ACTIVE_ARENA_ID,
    cars: PLAYGROUND_SEAT_IDS.map((_, seat) => ({
      carId: DEFAULT_CAR_ID,
      colorId: seat,
      weapons,
      enabled: seat < 2,
    })),
    drivenSeat: 0,
  };
}
```

- [ ] **Step 4: Update the barrel export**

In `packages/shared/src/index.ts`, find the export block carrying `BOT_SESSION_ID` and
`MSG_PLAYGROUND_SWITCH`. Remove `MSG_PLAYGROUND_SWITCH`; add `PLAYGROUND_SEATS` and
`PLAYGROUND_SEAT_IDS`. Leave `BOT_SESSION_ID` and the type exports as they are.

- [ ] **Step 5: Run the shared suite**

Run: `npx vitest run packages/shared/`
Expected: PASS. The only failures allowed are in files that still reference
`MSG_PLAYGROUND_SWITCH` — if `packages/shared/src/net/playground-messages.test.ts` asserts on it,
delete that assertion; the message is gone.

- [ ] **Step 6: Rebuild shared, then commit**

```bash
npm run build -w @motor-combat-moba/shared
git add packages/shared/src/net/playground-messages.ts \
        packages/shared/src/net/playground-messages.test.ts packages/shared/src/index.ts
git commit -m "feat(playground): six seats and a seat-list setup payload (PG56, PG60-PG65)

Replaces me/opponent with a six-entry cars list plus a drivenSeat index,
and gives the playground stable per-seat session ids so the human's
connection no longer owns a car.

Six is structural, not a counted cap: the length check IS the maximum, so
nothing anywhere has to refuse a seventh car. The only floor is that one
seat is enabled, since drivenSeat must name a car that exists.

MSG_PLAYGROUND_SWITCH is deleted -- control is chosen in the panel now.

The server and client do not typecheck until the Car select panel lands;
that is the planned red window."
```

---

### Task 3: `PlaygroundRoom` runs six seats

Implements PG57, PG59, PG66–PG73. Closes the server half of the red window.

**Files:**
- Modify: `packages/server/src/rooms/PlaygroundRoom.ts`
- Test: `packages/server/src/rooms/playground-room.test.ts`

**Interfaces:**
- Consumes: `PLAYGROUND_SEAT_IDS`, `PLAYGROUND_SEATS`, `PlaygroundSetup`, `defaultPlaygroundSetup`
  (Task 2); `forgetCombatPlayer`, `forgetContactPlayer` (Task 1).
- Produces:
  - `seatIndexOf(sessionId: string): number` — exported pure helper, `-1` for a non-seat id.
  - `loadoutOrChassisChanged` keeps its existing signature and meaning.
  - `otherPlaygroundId` is **deleted**.

- [ ] **Step 1: Write the failing pure-helper test**

In `packages/server/src/rooms/playground-room.test.ts`, **delete the entire `otherPlaygroundId`
describe block** (the function goes with it) and add:

```ts
describe("seatIndexOf (PG57)", () => {
  it("maps each seat id to its index", () => {
    PLAYGROUND_SEAT_IDS.forEach((id, i) => expect(seatIndexOf(id)).toBe(i));
  });

  it("returns -1 for anything that is not a seat", () => {
    // A client session id, the practice room's bot id, and junk all land here: this room's cars are
    // its seats and nothing else.
    expect(seatIndexOf("")).toBe(-1);
    expect(seatIndexOf(BOT_SESSION_ID)).toBe(-1);
    expect(seatIndexOf("aBcDeF123")).toBe(-1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/server/src/rooms/playground-room.test.ts -t "seatIndexOf"`
Expected: FAIL — `seatIndexOf` is not exported.

- [ ] **Step 3: Rewrite `PlaygroundRoom`'s seat handling**

In `packages/server/src/rooms/PlaygroundRoom.ts`:

Update the `@motor-combat-moba/shared` import block: drop `BOT_SESSION_ID`,
`MSG_PLAYGROUND_SWITCH` and `pickColor`; add `PLAYGROUND_SEATS` and `PLAYGROUND_SEAT_IDS`. Add
`forgetCombatPlayer` to the `../sim/combat-bridge.js` import and `forgetContactPlayer` to the
`../sim/ram-bridge.js` import.

Delete `otherPlaygroundId` entirely and replace it with:

```ts
/**
 * Which seat is this session id, or -1 (spec PG57).
 *
 * Every car in this room is a seat and nothing else is: a client's Colyseus session id owns no car
 * here, which is what makes handing the wheel to another car a single write to
 * `controlledSessionId`. `indexOf` over six frozen strings rather than a parsed suffix, so
 * `"pg-99"` and `"pg-0x1"` are simply not seats instead of being clamped into one.
 */
export function seatIndexOf(sessionId: string): number {
  return PLAYGROUND_SEAT_IDS.indexOf(sessionId);
}
```

Replace the `humanSessionId` field with nothing — delete it and every read of it. Replace the
single `bot`/`botRng` fields with per-seat maps:

```ts
  /**
   * One bot per seat (B10, spec PG69). Rebuilt when the difficulty changes — a profile is
   * constructor state — and dropped wholesale whenever a setup arrives, the bot is switched off or
   * the wheel moves, which is the three-case staleness rule (PG29) applied per seat.
   */
  private bots = new Map<string, BotController>();
  /**
   * A distinct, seeded stream per seat rather than one shared stream: two seats sharing an RNG would
   * make each bot's draw depend on the other's turn order, which is not what "seat 3's bot" means.
   * The same reasoning `packages/server/balance/match.ts` already runs six seats on. The BASE seed is
   * a constant because the playground is interactive — the streams exist to be independent, not to
   * make the sandbox reproducible.
   */
  private readonly botRngs = new Map<string, Rng>(
    PLAYGROUND_SEAT_IDS.map((id, seat) => [id, makeRng(deriveSeed(1, "playground-seat", seat))]),
  );
```

Add `makeRng`, `deriveSeed` and `type Rng` to the `../bot/index.js` import if `Rng` is not already
there.

Replace `onJoin` with:

```ts
  onJoin(_client: Client, _options?: { name?: unknown }): void {
    // No car is created here. `applySetup` is the one path that adds, removes and configures cars
    // (PG66), and it runs below with whatever this browser last saved replayed over it moments later
    // by `PlaygroundScene` (PG20). The human's session id names no car at all (PG57).
    this.applySetup(defaultPlaygroundSetup());
    // After the cars are spawned, so the 3-2-1 counts the player's own three seconds rather than
    // ticks the room burned before they connected. Deliberately NOT re-stamped by `applySetup`
    // itself: this is a MATCH-start countdown, and re-running it on every weapon swap would put a
    // three-second freeze between the tester and every edit.
    beginCountdown(this.state);
  }
```

Delete the `MSG_PLAYGROUND_SWITCH` handler from `onCreate` entirely.

Replace `applySetup`, `applyCarSetup` and `addCar` with:

```ts
  /**
   * Apply a validated setup blob (PG16/PG66) — the one path that adds, removes and configures cars.
   *
   * A seat is identified by its index, never by who is driving it: the human keeps configuring seat
   * 3 after taking the wheel of seat 5, which is what makes "drive that one for a minute" a view
   * change rather than an edit.
   *
   * A car whose chassis or loadout actually changed is respawned, and so is every enabled car on an
   * arena change; a car that changed nothing keeps its pose, hp and cooldowns. A COLOUR change never
   * respawns (PG32). Stat overrides never come through here — they hot-apply on their own message.
   */
  private applySetup(setup: PlaygroundSetup): void {
    this.state.botEnabled = setup.botEnabled;
    this.state.botDifficulty = setup.botDifficulty;
    // Any setup change can invalidate a held intent — a new chassis drives differently, a new
    // difficulty has a different cadence, the wheel may have moved, and a bot may have just been
    // switched off (PG29). Dropping every controller is the whole of that rule.
    this.bots.clear();
    this.state.controlledSessionId = PLAYGROUND_SEAT_IDS[setup.drivenSeat]!;
    const arenaChanged = this.state.arenaId !== setup.arenaId;
    if (arenaChanged) this.state.arenaId = setup.arenaId;

    const respawn: string[] = [];
    for (let seat = 0; seat < PLAYGROUND_SEATS; seat++) {
      const id = PLAYGROUND_SEAT_IDS[seat]!;
      const car = setup.cars[seat]!;
      const existing = this.state.players.get(id);

      if (!car.enabled) {
        if (existing) this.removeSeat(id);
        continue;
      }
      if (!existing) {
        this.addCar(id, `Car ${seat + 1}`, car.colorId, seat % 2);
        this.applyCarSetup(id, car);
        respawn.push(id);
        continue;
      }
      if (this.applyCarSetup(id, car) || arenaChanged) respawn.push(id);
    }

    for (const id of respawn) {
      const player = this.state.players.get(id);
      // `respawnPlayer` is the whole of "this car is new": fresh hp for the chassis, a fire state
      // built from the loadout written just above, a spawn away from the other cars, spawn
      // protection, and every knock and debuff cleared.
      if (player) respawnPlayer(this.ctx(), player);
    }
  }

  /** Writes one seat's chassis, loadout and colour, and reports whether a RESPAWN is owed. Colour is
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
    // Held in combat memory rather than only in the fire state, so `toCombatPlayers` compares the
    // running slots against THIS list instead of the chassis's shipped kit — see `CombatMemory`.
    this.combat.loadouts.set(sessionId, [...setup.weapons]);
    return true;
  }

  /**
   * Take one seat off the field (PG67).
   *
   * Every per-session map, not merely `state.players`: a seat switched back on later must arrive as
   * a NEW car, never inheriting a stale target lock, a half-finished maneuver, a ram-falloff stack
   * or a contact pair from its previous life. The two `forget*` helpers own the memory bags; the
   * four maps here are this room's own.
   */
  private removeSeat(sessionId: string): void {
    this.state.players.delete(sessionId);
    this.inputQueues.delete(sessionId);
    this.prevFireMasks.delete(sessionId);
    this.matchRoster.delete(sessionId);
    this.phaseCaps.delete(sessionId);
    this.bots.delete(sessionId);
    forgetCombatPlayer(this.combat, sessionId);
    forgetContactPlayer(this.ram, sessionId);
  }

  /** One seat's car. Schema-ordinary — the client renders every seat alike. */
  private addCar(sessionId: string, name: string, colorId: number, team: number): PlayerState {
    const player = new PlayerState();
    player.sessionId = sessionId;
    player.name = name;
    // Straight from the setup (PG73). The old `pickColor(used, Math.random)` draw was overwritten by
    // `applyCarSetup` on the same pass, so it was never observed — and it was the one `Math.random`
    // call in a room that otherwise runs off seeded streams.
    player.colorId = colorId;
    player.team = team;
    player.joinedAtTick = this.state.tick;
    // In the match from the first tick: there is no lobby, no car select and no countdown to pass
    // through, and `isOnField` gates the mover on exactly this pair of fields.
    player.status = PlayerStatus.IN_MATCH;
    player.alive = true;
    player.level = PLAYGROUND_LEVEL;
    this.state.players.set(sessionId, player);
    this.inputQueues.set(sessionId, []);
    this.prevFireMasks.set(sessionId, 0);
    this.matchRoster.add(sessionId);
    return player;
  }
```

Replace `enqueueOpponentInput` with:

```ts
  /**
   * One input per tick for every enabled seat the human is NOT driving — that seat's bot intent with
   * the bot on, a neutral input with it off. Either way it goes through the ordinary input queue, so
   * the "clients send inputs, never state" invariant holds: a bot is a client, just an in-process one.
   */
  private enqueueAiInputs(): void {
    const driven = this.state.controlledSessionId;
    const difficulty = isBotDifficulty(this.state.botDifficulty) ? this.state.botDifficulty : "medium";

    for (const id of PLAYGROUND_SEAT_IDS) {
      if (id === driven) continue;
      const queue = this.inputQueues.get(id);
      // No queue means the seat is off the field. Nothing to drive.
      if (!queue) continue;

      // A fresh `seq` every tick, held intent or not: `serverTick` wants one input per tick per car,
      // and reusing a sequence number reads as a duplicate rather than a repeat. Monotonic across the
      // room rather than per seat, which is all `serverTick` needs — it sorts a batch by seq and acks
      // the highest, and never compares one player's seq to another's.
      this.opponentSeq += 1;
      const seq = this.opponentSeq;

      // Alone mode (PG11/PG71) sends a NEUTRAL input, not silence. `serverTick` leaves an input-less
      // player unstepped unless it is carrying a knock, so a dummy handed no input freezes exactly
      // where the bot was switched off — and it KEEPS the velocity it was carrying, which
      // `serverTick` reports as that car's `approachVelocities` on every subsequent tick.
      // `resolveRam` reads that as the drive-in term, so a parked dummy scores as an attacker at its
      // last driving speed in every contact, forever. Coasting it on zeros runs it through the
      // ordinary drive model instead.
      if (!this.state.botEnabled) {
        this.bots.delete(id);
        queue.push({ seq, steer: 0, throttle: 0, fireSlots: 0 });
        continue;
      }

      // `!bot ||` rather than `bot?.profileId !==`: the optional-chain form is equivalent at
      // runtime but leaves `bot` typed `BotController | undefined` after the block, so
      // `bot.decide(view)` below would not compile. Assigning in the `!bot` branch is what narrows it.
      let bot = this.bots.get(id);
      if (!bot || bot.profileId !== difficulty) {
        // No `targetSessionId` (PG70): each bot resolves its own target through `pickTarget` against
        // everything it can see, so a six-car brawl is a brawl rather than five cars queueing to
        // chase the human.
        bot = new HumanController(difficulty);
        this.bots.set(id, bot);
      }

      const view = buildBotView({
        state: this.state,
        selfSessionId: id,
        combat: this.combat,
        rng: this.botRngs.get(id)!,
        observedFires: this.previousTickFires,
        stalenessTicks: BOT_PROFILES[difficulty].viewStalenessTicks,
        ring: this.botRing,
      });
      // No car for this seat: push NOTHING. An input queued for a session that is not in
      // `state.players` is never consumed by `serverTick`, and would be read as a stale intent if
      // that seat were re-added.
      if (!view) continue;

      queue.push({ seq, ...bot.decide(view) });
    }
  }

  /**
   * Whose thoughts the debug read-out prints (spec PG72).
   *
   * H12's read-out is ONE bot's, and five stacked two-line entries over the arena would be
   * unreadable — so: the first seat, in seat order, whose bot is currently targeting the car the
   * human is driving; failing that, the first bot seat there is. Recomputed at every broadcast
   * window and never held, or a controller held across its seat being switched off would keep
   * broadcasting a dead bot's last thought.
   */
  private debugBot(): HumanController | undefined {
    let fallback: HumanController | undefined;
    for (const id of PLAYGROUND_SEAT_IDS) {
      const bot = this.bots.get(id);
      if (!(bot instanceof HumanController)) continue;
      fallback ??= bot;
      if (bot.currentTargetSessionId === this.state.controlledSessionId) return bot;
    }
    return fallback;
  }
```

In `tick()`, change `this.enqueueOpponentInput();` to `this.enqueueAiInputs();` and change
`const debug = this.bot instanceof HumanController ? this.bot.debug() : undefined;` to
`const debug = this.debugBot()?.debug();`.

- [ ] **Step 4: Run the helper test and watch it pass**

Run: `npx vitest run packages/server/src/rooms/playground-room.test.ts -t "seatIndexOf"`
Expected: PASS.

- [ ] **Step 5: Write the failing seat-lifecycle tests**

The existing harness in this file casts a `PlaygroundRoom` to a private-surface interface. Extend
that interface and add a new describe block. Note the harness's `addCar` signature changed to
`(sessionId, name, colorId, team)`, so **update the existing `PlaygroundRoomHarness` interface and
both existing `room.addCar(...)` calls** — they currently pass `[]` and `[human.colorId]` as the
third argument and must now pass a colour number (use `0` and `1`).

```ts
describe("seat lifecycle (PG66/PG67/PG68)", () => {
  interface SetupHarness {
    state: PlaygroundState;
    combat: CombatMemory;
    ram: ContactMemory;
    inputQueues: Map<string, InputMessage[]>;
    prevFireMasks: Map<string, number>;
    matchRoster: Set<string>;
    phaseCaps: Map<string, number>;
    setState(state: PlaygroundState): void;
    applySetup(setup: PlaygroundSetup): void;
  }

  function readyRoom(): SetupHarness {
    const room = new PlaygroundRoom() as unknown as SetupHarness;
    room.setState(new PlaygroundState());
    room.state.phase = RoomPhase.MATCH;
    room.state.arenaId = ACTIVE_ARENA_ID;
    return room;
  }

  /** The default setup with `mutate` applied — a fresh, legal six-seat blob every call. */
  function setupWith(mutate: (s: PlaygroundSetup) => PlaygroundSetup): PlaygroundSetup {
    return mutate(defaultPlaygroundSetup());
  }

  const enable = (s: PlaygroundSetup, ...seats: number[]): PlaygroundSetup => ({
    ...s,
    cars: s.cars.map((c, i) => ({ ...c, enabled: seats.includes(i) })),
    drivenSeat: seats[0]!,
  });

  it("opens the default setup with exactly two cars on the field", () => {
    const room = readyRoom();
    room.applySetup(defaultPlaygroundSetup());
    expect([...room.state.players.keys()]).toEqual([PLAYGROUND_SEAT_IDS[0], PLAYGROUND_SEAT_IDS[1]]);
    expect(room.state.controlledSessionId).toBe(PLAYGROUND_SEAT_IDS[0]);
  });

  it("adds a car when a seat is enabled", () => {
    const room = readyRoom();
    room.applySetup(defaultPlaygroundSetup());
    room.applySetup(setupWith((s) => enable(s, 0, 1, 4)));

    const added = room.state.players.get(PLAYGROUND_SEAT_IDS[4]!);
    expect(added).toBeDefined();
    expect(added!.alive).toBe(true);
    expect(added!.hp).toBe(hpOf(added!.carId));
    expect(room.matchRoster.has(PLAYGROUND_SEAT_IDS[4]!)).toBe(true);
    expect(room.inputQueues.has(PLAYGROUND_SEAT_IDS[4]!)).toBe(true);
  });

  it("removes a car, and every map entry with it, when a seat is disabled (PG67)", () => {
    const room = readyRoom();
    room.applySetup(setupWith((s) => enable(s, 0, 1, 2)));
    const gone = PLAYGROUND_SEAT_IDS[2]!;
    // State the removal has to clear, planted where the sim would have left it.
    room.ram.contacts.add(pairKey(gone, PLAYGROUND_SEAT_IDS[0]!));
    room.ram.falloff.set(gone, { count: 2, expiresAtTick: 99 });

    room.applySetup(setupWith((s) => enable(s, 0, 1)));

    expect(room.state.players.has(gone)).toBe(false);
    expect(room.inputQueues.has(gone)).toBe(false);
    expect(room.prevFireMasks.has(gone)).toBe(false);
    expect(room.matchRoster.has(gone)).toBe(false);
    expect(room.phaseCaps.has(gone)).toBe(false);
    expect(room.combat.loadouts.has(gone)).toBe(false);
    expect(room.combat.fireStates.has(gone)).toBe(false);
    expect(room.ram.falloff.has(gone)).toBe(false);
    expect(room.ram.contacts.size).toBe(0);
  });

  it("respawns a car whose chassis changed, and NOT one whose colour changed (PG68/PG32)", () => {
    const room = readyRoom();
    room.applySetup(defaultPlaygroundSetup());
    const seat0 = room.state.players.get(PLAYGROUND_SEAT_IDS[0]!)!;
    const seat1 = room.state.players.get(PLAYGROUND_SEAT_IDS[1]!)!;
    seat0.x = 123;
    seat0.y = 456;
    seat1.x = 700;
    seat1.y = 400;
    seat1.hp = 5;

    room.applySetup(
      setupWith((s) => ({
        ...s,
        cars: s.cars.map((c, i) =>
          i === 0 ? { ...c, carId: "bastion", weapons: slotsOf("bastion") as typeof c.weapons } : i === 1 ? { ...c, colorId: 4 } : c,
        ),
      })),
    );

    // Seat 0 changed chassis: moved off its planted pose and given fresh hp.
    expect(room.state.players.get(PLAYGROUND_SEAT_IDS[0]!)!.x).not.toBe(123);
    expect(room.state.players.get(PLAYGROUND_SEAT_IDS[0]!)!.hp).toBe(hpOf("bastion"));
    // Seat 1 changed only its colour: repainted in place, hp and pose untouched.
    expect(room.state.players.get(PLAYGROUND_SEAT_IDS[1]!)!.colorId).toBe(4);
    expect(room.state.players.get(PLAYGROUND_SEAT_IDS[1]!)!.x).toBe(700);
    expect(room.state.players.get(PLAYGROUND_SEAT_IDS[1]!)!.hp).toBe(5);
  });

  it("respawns every enabled car on an arena change", () => {
    const room = readyRoom();
    room.applySetup(setupWith((s) => enable(s, 0, 1, 3)));
    for (const seat of [0, 1, 3]) {
      room.state.players.get(PLAYGROUND_SEAT_IDS[seat]!)!.x = 11;
    }

    const other = ARENA_IDS.find((id) => id !== room.state.arenaId)!;
    room.applySetup(setupWith((s) => ({ ...enable(s, 0, 1, 3), arenaId: other })));

    for (const seat of [0, 1, 3]) {
      expect(room.state.players.get(PLAYGROUND_SEAT_IDS[seat]!)!.x).not.toBe(11);
    }
  });

  it("points controlledSessionId at the driven seat", () => {
    const room = readyRoom();
    room.applySetup(setupWith((s) => enable(s, 2, 5)));
    expect(room.state.controlledSessionId).toBe(PLAYGROUND_SEAT_IDS[2]);
  });
});
```

Add to the file's imports: `ACTIVE_ARENA_ID`, `ARENA_IDS`, `PLAYGROUND_SEAT_IDS`, `pairKey`,
`slotsOf`, `defaultPlaygroundSetup`, `type PlaygroundSetup`; and `seatIndexOf` plus the existing
exports from `./PlaygroundRoom.js`. Import `type CombatMemory` from `../sim/combat-bridge.js` and
`type ContactMemory` from `../sim/ram-bridge.js`.

If `ARENA_IDS` turns out not to be re-exported from the shared barrel, use
`Object.keys(ARENAS)` instead — `ARENAS` definitely is. Check before assuming either way.

- [ ] **Step 6: Run and watch them fail, then pass**

Run: `npx vitest run packages/server/src/rooms/playground-room.test.ts`
Expected: the new block fails before Step 3's edits are complete and passes after. If Step 3 is
already applied, they should pass on the first run — that is fine; the failing-first cycle for this
task was Steps 1–2.

- [ ] **Step 7: Write the failing AI-input tests**

```ts
describe("enqueueAiInputs (PG70/PG71)", () => {
  interface AiHarness {
    state: PlaygroundState;
    inputQueues: Map<string, InputMessage[]>;
    bots: Map<string, unknown>;
    setState(state: PlaygroundState): void;
    applySetup(setup: PlaygroundSetup): void;
    enqueueAiInputs(): void;
  }

  function readyAiRoom(botEnabled: boolean, seats: number[]): AiHarness {
    const room = new PlaygroundRoom() as unknown as AiHarness;
    room.setState(new PlaygroundState());
    room.state.phase = RoomPhase.MATCH;
    room.state.arenaId = ACTIVE_ARENA_ID;
    const base = defaultPlaygroundSetup();
    room.applySetup({
      ...base,
      botEnabled,
      cars: base.cars.map((c, i) => ({ ...c, enabled: seats.includes(i) })),
      drivenSeat: seats[0]!,
    });
    return room;
  }

  it("queues nothing for the driven seat — that queue is the human's", () => {
    const room = readyAiRoom(false, [0, 1, 2]);
    room.enqueueAiInputs();
    expect(room.inputQueues.get(PLAYGROUND_SEAT_IDS[0]!)).toHaveLength(0);
  });

  it("queues a neutral input for every other enabled seat when the bot is off (PG71)", () => {
    const room = readyAiRoom(false, [0, 1, 2]);
    room.enqueueAiInputs();
    for (const seat of [1, 2]) {
      const queue = room.inputQueues.get(PLAYGROUND_SEAT_IDS[seat]!)!;
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ steer: 0, throttle: 0, fireSlots: 0 });
    }
    expect(room.bots.size).toBe(0);
  });

  it("builds one bot per non-driven enabled seat when the bot is on (PG69)", () => {
    const room = readyAiRoom(true, [0, 1, 2, 3]);
    room.enqueueAiInputs();
    expect([...room.bots.keys()].sort()).toEqual(
      [PLAYGROUND_SEAT_IDS[1]!, PLAYGROUND_SEAT_IDS[2]!, PLAYGROUND_SEAT_IDS[3]!].sort(),
    );
  });

  it("queues nothing at all for a disabled seat", () => {
    const room = readyAiRoom(true, [0, 1]);
    room.enqueueAiInputs();
    expect(room.inputQueues.has(PLAYGROUND_SEAT_IDS[4]!)).toBe(false);
  });

  it("gives each seat a distinct input seq on one tick", () => {
    const room = readyAiRoom(false, [0, 1, 2, 3]);
    room.enqueueAiInputs();
    const seqs = [1, 2, 3].map((s) => room.inputQueues.get(PLAYGROUND_SEAT_IDS[s]!)![0]!.seq);
    expect(new Set(seqs).size).toBe(3);
  });
});
```

- [ ] **Step 8: Run them**

Run: `npx vitest run packages/server/src/rooms/playground-room.test.ts -t "enqueueAiInputs"`
Expected: PASS. If the bot-on case throws inside `buildBotView`, the cars need poses —
`applySetup` spawns them through `respawnPlayer`, so they have real ones; if it still throws, read
the error rather than stubbing the view.

- [ ] **Step 9: Write the failing debug-pick test**

```ts
describe("debugBot (PG72)", () => {
  interface DebugHarness {
    state: PlaygroundState;
    bots: Map<string, { currentTargetSessionId: string | undefined }>;
    setState(state: PlaygroundState): void;
    debugBot(): unknown;
  }

  function roomWithBots(targets: Record<number, string | undefined>): DebugHarness {
    const room = new PlaygroundRoom() as unknown as DebugHarness;
    room.setState(new PlaygroundState());
    room.state.controlledSessionId = PLAYGROUND_SEAT_IDS[0]!;
    for (const [seat, target] of Object.entries(targets)) {
      const bot = new HumanController("medium");
      // `currentTargetSessionId` is a getter over a private field; the brain sets it on its first
      // `decide`. Stubbing the getter is what keeps this test about the PICK rather than about the
      // planner.
      Object.defineProperty(bot, "currentTargetSessionId", { get: () => target });
      room.bots.set(PLAYGROUND_SEAT_IDS[Number(seat)]!, bot as never);
    }
    return room;
  }

  it("picks the bot targeting the driven car", () => {
    const room = roomWithBots({ 1: "pg-3", 2: "pg-0", 3: "pg-2" });
    expect(room.debugBot()).toBe(room.bots.get(PLAYGROUND_SEAT_IDS[2]!));
  });

  it("picks the lowest such seat when two are targeting the driven car", () => {
    const room = roomWithBots({ 1: "pg-0", 4: "pg-0" });
    expect(room.debugBot()).toBe(room.bots.get(PLAYGROUND_SEAT_IDS[1]!));
  });

  it("falls back to the first bot seat when nobody is targeting the driven car", () => {
    const room = roomWithBots({ 2: "pg-5", 5: "pg-2" });
    expect(room.debugBot()).toBe(room.bots.get(PLAYGROUND_SEAT_IDS[2]!));
  });

  it("returns undefined with no bots at all", () => {
    const room = roomWithBots({});
    expect(room.debugBot()).toBeUndefined();
  });
});
```

- [ ] **Step 10: Run the whole server package**

Run: `npx vitest run packages/server/`
Expected: PASS. Any remaining failure naming `otherPlaygroundId`, `humanSessionId` or
`MSG_PLAYGROUND_SWITCH` is a leftover reference in a test — delete it, the production symbol is gone.

- [ ] **Step 11: Commit**

```bash
git add packages/server/src/rooms/PlaygroundRoom.ts packages/server/src/rooms/playground-room.test.ts
git commit -m "feat(playground): run six seats, one bot each (PG57, PG66-PG73)

applySetup becomes the add/remove path: a seat turning on gets a car and a
spawn, one turning off is deleted from every per-session map the room and
the two memory bags hold. A pair key outliving its car was the subtle one
-- it would have made the next genuine contact read as a continuing one.

Bots get no fixed target, so a six-car brawl is a brawl rather than five
cars queueing to chase the human. The debug read-out follows whichever bot
is targeting the driven car, recomputed per window so a switched-off seat
cannot keep broadcasting its last thought.

otherPlaygroundId, humanSessionId and the pickColor draw are gone: none of
them is a question a six-seat room can ask."
```

---

### Task 4: Seat helpers and a widened `statsTabs` (client ui-model)

Implements PG78, PG79, PG82. Pure functions, testable while the overlay is still red.

**Files:**
- Modify: `packages/client/src/dev/playground/ui-model.ts`
- Test: `packages/client/src/dev/playground/ui-model.test.ts`

**Interfaces:**
- Consumes: `PlaygroundSetup`, `PLAYGROUND_SEATS` (Task 2).
- Produces:
  - `enabledSeats(setup: PlaygroundSetup): number[]`
  - `canDisableSeat(setup: PlaygroundSetup, seat: number): boolean`
  - `nextDrivenSeat(setup: PlaygroundSetup, disabled: number): number`
  - `statsTabs(setup: PlaygroundSetup): StatsTab[]` — same signature, widened behaviour.
  - `OverlayView` gains `"cars"`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/src/dev/playground/ui-model.test.ts`:

```ts
describe("seat helpers (PG78/PG79)", () => {
  const withSeats = (...seats: number[]): PlaygroundSetup => {
    const base = defaultPlaygroundSetup();
    return {
      ...base,
      cars: base.cars.map((c, i) => ({ ...c, enabled: seats.includes(i) })),
      drivenSeat: seats[0]!,
    };
  };

  it("lists enabled seats in seat order", () => {
    expect(enabledSeats(withSeats(4, 1, 0))).toEqual([0, 1, 4]);
  });

  it("allows disabling a seat while another is enabled", () => {
    expect(canDisableSeat(withSeats(0, 3), 0)).toBe(true);
    expect(canDisableSeat(withSeats(0, 3), 3)).toBe(true);
  });

  it("refuses to disable the LAST enabled seat (PG79)", () => {
    // A room with no cars has nothing to drive, and the wire rejects such a payload anyway — a
    // control that silently produces a rejected send is worse than one that says why.
    expect(canDisableSeat(withSeats(2), 2)).toBe(false);
  });

  it("treats disabling an already-disabled seat as allowed (it is a no-op)", () => {
    expect(canDisableSeat(withSeats(0, 1), 5)).toBe(true);
  });

  it("hands the wheel to the lowest remaining enabled seat (PG78)", () => {
    const setup = { ...withSeats(1, 3, 5), drivenSeat: 3 };
    expect(nextDrivenSeat(setup, 3)).toBe(1);
  });

  it("keeps the wheel where it is when a seat OTHER than the driven one is disabled", () => {
    const setup = { ...withSeats(1, 3, 5), drivenSeat: 3 };
    expect(nextDrivenSeat(setup, 5)).toBe(3);
  });

  it("keeps the wheel on the last seat rather than moving it nowhere", () => {
    const setup = withSeats(4);
    expect(nextDrivenSeat(setup, 4)).toBe(4);
  });
});

describe("statsTabs over seats (PG82)", () => {
  const seated = (
    picks: { seat: number; carId: CarId; weapons: [WeaponId, WeaponId, WeaponId] }[],
  ): PlaygroundSetup => {
    const base = defaultPlaygroundSetup();
    const bySeat = new Map(picks.map((p) => [p.seat, p]));
    return {
      ...base,
      cars: base.cars.map((c, i) => {
        const pick = bySeat.get(i);
        return pick ? { ...c, carId: pick.carId, weapons: pick.weapons, enabled: true } : { ...c, enabled: false };
      }),
      drivenSeat: picks[0]!.seat,
    };
  };

  const titles = (setup: PlaygroundSetup, key: StatsTabKey): string[] =>
    statsTabs(setup).find((t) => t.key === key)!.groups.map((g) => g.title);

  it("lists one car group for a single enabled seat", () => {
    const setup = seated([{ seat: 0, carId: "mirage", weapons: ["magmablast", "thunderclap", "afterburner"] }]);
    expect(titles(setup, "cars")).toEqual([CAR_TABLE.mirage.name]);
  });

  it("de-duplicates two seats on the same chassis", () => {
    const kit: [WeaponId, WeaponId, WeaponId] = ["magmablast", "thunderclap", "afterburner"];
    const setup = seated([
      { seat: 0, carId: "mirage", weapons: kit },
      { seat: 1, carId: "mirage", weapons: kit },
    ]);
    expect(titles(setup, "cars")).toEqual([CAR_TABLE.mirage.name]);
  });

  it("lists every distinct chassis across six enabled seats", () => {
    const setup = seated([
      { seat: 0, carId: "mirage", weapons: ["magmablast", "thunderclap", "afterburner"] },
      { seat: 1, carId: "bullseye", weapons: ["predator", "pepperbox", "lance"] },
      { seat: 2, carId: "bastion", weapons: ["thumper", "roadblock", "wildcharge"] },
      { seat: 3, carId: "mirage", weapons: ["predator", "pepperbox", "lance"] },
      { seat: 4, carId: "bullseye", weapons: ["thumper", "roadblock", "wildcharge"] },
      { seat: 5, carId: "bastion", weapons: ["magmablast", "thunderclap", "afterburner"] },
    ]);
    expect(titles(setup, "cars").sort()).toEqual(
      [CAR_TABLE.mirage.name, CAR_TABLE.bullseye.name, CAR_TABLE.bastion.name].sort(),
    );
    expect(titles(setup, "weapons")).toHaveLength(9);
  });

  it("ignores a DISABLED seat's chassis and weapons", () => {
    const base = defaultPlaygroundSetup();
    const setup: PlaygroundSetup = {
      ...base,
      cars: base.cars.map((c, i) =>
        i === 0
          ? { ...c, carId: "mirage", weapons: ["magmablast", "thunderclap", "afterburner"], enabled: true }
          : i === 1
            ? { ...c, carId: "bastion", weapons: ["thumper", "roadblock", "wildcharge"], enabled: false }
            : { ...c, enabled: false },
      ),
      drivenSeat: 0,
    };
    // Tuning a chassis that is not on the field changes nothing observable (PG13), so it is not listed.
    expect(titles(setup, "cars")).toEqual([CAR_TABLE.mirage.name]);
    expect(titles(setup, "weapons")).not.toContain(WEAPON_TABLE.thumper.name);
  });

  it("still returns all three tabs in order even when one is empty", () => {
    const setup = seated([{ seat: 0, carId: "taurus", weapons: ["magmablast", "thunderclap", "afterburner"] }]);
    expect(statsTabs(setup).map((t) => t.key)).toEqual(["global", "cars", "weapons"]);
  });
});
```

Add to the test file's imports: `defaultPlaygroundSetup`, `CAR_TABLE`, `WEAPON_TABLE`,
`type CarId`, `type PlaygroundSetup`, `type WeaponId` from `@motor-combat-moba/shared`; and
`enabledSeats`, `canDisableSeat`, `nextDrivenSeat`, `statsTabs`, `type StatsTabKey` from
`./ui-model.js`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/client/src/dev/playground/ui-model.test.ts`
Expected: FAIL — `enabledSeats` is not exported.

- [ ] **Step 3: Implement the helpers and widen `statsTabs`**

In `packages/client/src/dev/playground/ui-model.ts`, widen `OverlayView`:

```ts
/**
 * `"hidden"` while the sim is unpaused; the rest are the paused sub-screens. `"cars"` is the Car
 * select panel (PG74) — the six seats plus the mode, arena and hitbox controls that used to sit at
 * the top of `"physics"`.
 */
export type OverlayView = "hidden" | "menu" | "cars" | "physics" | "vfx" | "env";
```

and in `pauseKeyAction`, add `"cars"` to the panel list:

```ts
  // Any settings panel backs out to the menu without touching pause; the sim stays frozen.
  if (view === "cars" || view === "physics" || view === "vfx" || view === "env") return "back-to-menu";
```

Add the three helpers:

```ts
/** Which seats are on the field, in seat order (PG82). */
export function enabledSeats(setup: PlaygroundSetup): number[] {
  const seats: number[] = [];
  setup.cars.forEach((car, seat) => {
    if (car.enabled) seats.push(seat);
  });
  return seats;
}

/**
 * May this seat be switched off (PG79)?
 *
 * No, when it is the only one left on the field: `isPlaygroundSetup` rejects a payload with no
 * enabled seat, so the panel would be offering a control whose only effect is a silently-dropped
 * send — the failure `env-panel.ts` already names for `floor.*`/`floorArt.*`. Disabling an
 * already-disabled seat is trivially allowed, because it is a no-op rather than a change.
 */
export function canDisableSeat(setup: PlaygroundSetup, seat: number): boolean {
  if (!setup.cars[seat]?.enabled) return true;
  return enabledSeats(setup).length > 1;
}

/**
 * Where the wheel goes when `disabled` is switched off (PG78).
 *
 * Down to the lowest still-enabled seat, never off: `drivenSeat` may never name a disabled seat, so
 * unchecking the car you are driving has to hand the wheel somewhere rather than leaving it dangling
 * for the validator to reject. Disabling any OTHER seat leaves the wheel alone.
 *
 * `disabled` is read as "about to be switched off", so this is called BEFORE the flag flips. When
 * nothing else is enabled the wheel stays put — `canDisableSeat` refuses that case upstream, and
 * returning the seat unchanged is the honest answer rather than a -1 the caller must special-case.
 */
export function nextDrivenSeat(setup: PlaygroundSetup, disabled: number): number {
  if (setup.drivenSeat !== disabled) return setup.drivenSeat;
  const next = enabledSeats(setup).find((seat) => seat !== disabled);
  return next ?? disabled;
}
```

Replace the two id-collection lines at the top of `statsTabs` (the `carIds` and `weaponIds`
`const`s reading `setup.me` / `setup.opponent`) with:

```ts
  const seats = enabledSeats(setup).map((seat) => setup.cars[seat]!);
  const carIds = [...new Set(seats.map((car) => car.carId))];
```

and

```ts
  const weaponIds = [...new Set(seats.flatMap((car) => car.weapons))];
```

Update `statsTabs`'s doc comment: the filter is now "the up-to-six enabled chassis and the up-to-
eighteen weapons they carry", and it reads the ENABLED seats only — a seat parked off the field is
not tunable, because tuning a chassis that is not spawned changes nothing observable (PG13).

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run packages/client/src/dev/playground/ui-model.test.ts`
Expected: PASS. Existing tests in that file that build a two-car `PlaygroundSetup` literal will fail
to construct — rewrite them onto `defaultPlaygroundSetup()` plus a `cars` map, exactly as the new
blocks do.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/playground/ui-model.ts packages/client/src/dev/playground/ui-model.test.ts
git commit -m "feat(playground): seat helpers and a six-seat statsTabs (PG78/PG79/PG82)

statsTabs keeps PG13's rule -- only what is on the field is tunable -- and
only widens where the list comes from: up to six chassis and eighteen
weapons, drawn from the ENABLED seats, so a parked seat is not tunable.

canDisableSeat and nextDrivenSeat are the two rules the panel needs and a
pure function can hold: the last car cannot be switched off, and unchecking
the car you are driving hands the wheel down rather than leaving drivenSeat
naming a car that is not there."
```

---

### Task 5: Storage — upgrade a two-car blob, migrate the bot's tint

Implements PG85 and PG86.

**Files:**
- Modify: `packages/client/src/dev/playground/storage.ts`
- Test: `packages/client/src/dev/playground/storage.test.ts`

**Interfaces:**
- Consumes: `PLAYGROUND_SEAT_IDS`, `defaultPlaygroundSetup`, `isPlaygroundSetup` (Task 2);
  `BOT_SESSION_ID`, `sanitizeCarTints`.
- Produces: `decodeStored` / `encodeStored` unchanged in signature; `upgradeStoredSetup` gains the
  seat branch; a new module-private `migrateTintKeys`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/client/src/dev/playground/storage.test.ts`:

```ts
describe("upgrading a two-car blob to six seats (PG85)", () => {
  /** What a browser saved before this change: me/opponent, no cars, no drivenSeat. */
  const legacy = {
    setup: {
      botEnabled: true,
      botDifficulty: "hard",
      arenaId: ACTIVE_ARENA_ID,
      me: { carId: "bastion", colorId: 3, weapons: ["thumper", "roadblock", "wildcharge"] },
      opponent: { carId: "bullseye", colorId: 5, weapons: ["predator", "pepperbox", "lance"] },
    },
  };

  it("puts me at seat 0 and opponent at seat 1, both enabled and driving seat 0", () => {
    const stored = decodeStored(JSON.stringify(legacy));
    expect(stored.setup.cars).toHaveLength(PLAYGROUND_SEATS);
    expect(stored.setup.cars[0]).toMatchObject({ carId: "bastion", colorId: 3, enabled: true });
    expect(stored.setup.cars[1]).toMatchObject({ carId: "bullseye", colorId: 5, enabled: true });
    expect(stored.setup.drivenSeat).toBe(0);
  });

  it("fills seats 2-5 from the defaults, switched off", () => {
    const stored = decodeStored(JSON.stringify(legacy));
    expect(stored.setup.cars.slice(2).every((c) => c.enabled === false)).toBe(true);
    expect(stored.setup.cars.slice(2).map((c) => c.colorId)).toEqual(
      defaultPlaygroundSetup().cars.slice(2).map((c) => c.colorId),
    );
  });

  it("keeps the rest of the legacy setup", () => {
    const stored = decodeStored(JSON.stringify(legacy));
    expect(stored.setup.botEnabled).toBe(true);
    expect(stored.setup.botDifficulty).toBe("hard");
  });

  it("leaves a blob that already carries seats alone", () => {
    const modern = { setup: { ...defaultPlaygroundSetup(), botDifficulty: "easy" as const } };
    const stored = decodeStored(JSON.stringify(modern));
    expect(stored.setup.botDifficulty).toBe("easy");
    expect(stored.setup.cars).toHaveLength(PLAYGROUND_SEATS);
  });

  it("still falls back whole on a blob missing a required section", () => {
    // The narrowness rule is unchanged: this upgrade never invents `arenaId`, `botEnabled` or a
    // missing car record. Such a blob stays invalid and the whole setup falls back.
    const broken = { setup: { ...legacy.setup, arenaId: undefined } };
    expect(decodeStored(JSON.stringify(broken)).setup).toEqual(defaultPlaygroundSetup());
  });

  it("falls back whole on garbage", () => {
    expect(decodeStored("not json").setup).toEqual(defaultPlaygroundSetup());
    expect(decodeStored(null).setup).toEqual(defaultPlaygroundSetup());
  });
});

describe("migrating stored car tints to seat ids (PG86)", () => {
  it("moves the bot's tint to seat 1", () => {
    const stored = decodeStored(
      JSON.stringify({ carTint: { [BOT_SESSION_ID]: { hex: 0xff2bd6, on: true } } }),
    );
    expect(stored.carTint[PLAYGROUND_SEAT_IDS[1]!]).toEqual({ hex: 0xff2bd6, on: true });
    expect(stored.carTint[BOT_SESSION_ID]).toBeUndefined();
  });

  it("upgrades a bare-number bot tint on the way through", () => {
    const stored = decodeStored(JSON.stringify({ carTint: { [BOT_SESSION_ID]: 0x112233 } }));
    expect(stored.carTint[PLAYGROUND_SEAT_IDS[1]!]).toEqual({ hex: 0x112233, on: true });
  });

  it("keeps a tint already stored against a seat id", () => {
    const stored = decodeStored(
      JSON.stringify({ carTint: { [PLAYGROUND_SEAT_IDS[4]!]: { hex: 0x00ff00, on: false } } }),
    );
    expect(stored.carTint[PLAYGROUND_SEAT_IDS[4]!]).toEqual({ hex: 0x00ff00, on: false });
  });

  it("never overwrites a real seat tint with the legacy bot one", () => {
    const stored = decodeStored(
      JSON.stringify({
        carTint: {
          [BOT_SESSION_ID]: { hex: 0xff0000, on: true },
          [PLAYGROUND_SEAT_IDS[1]!]: { hex: 0x0000ff, on: true },
        },
      }),
    );
    expect(stored.carTint[PLAYGROUND_SEAT_IDS[1]!]).toEqual({ hex: 0x0000ff, on: true });
  });

  it("leaves an unidentifiable old session key where it is, harmlessly", () => {
    // The human's own old key was a per-connection Colyseus id and cannot be mapped to a seat. It
    // simply never resolves, which `sanitizeCarTints` already tolerates.
    const stored = decodeStored(JSON.stringify({ carTint: { aBcDeF: { hex: 0x010203, on: true } } }));
    expect(stored.carTint[PLAYGROUND_SEAT_IDS[0]!]).toBeUndefined();
  });
});
```

Add to that file's imports: `ACTIVE_ARENA_ID`, `BOT_SESSION_ID`, `PLAYGROUND_SEATS`,
`PLAYGROUND_SEAT_IDS`, `defaultPlaygroundSetup`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run packages/client/src/dev/playground/storage.test.ts`
Expected: FAIL — the legacy blob decodes to `defaultPlaygroundSetup()` (no upgrade branch) and the
bot tint stays under `"bot"`.

- [ ] **Step 3: Implement the upgrade and the migration**

In `packages/client/src/dev/playground/storage.ts`, replace `upgradeStoredSetup` with:

```ts
/**
 * Additively fill in what a stored `setup` record is missing, before validating it (PG25/PG85).
 *
 * Two generations of blob pass through here. The older one lacks `botDifficulty` and a per-car
 * `colorId`; the 2026-09-16 one lacks the whole seat model, carrying `me` and `opponent` where six
 * `cars` and a `drivenSeat` now live. `isPlaygroundSetup` guards both the wire and this codec and
 * went strict for each of those, so without this every blob saved before the change would fail
 * validation and silently discard a car, a loadout and an arena the developer had chosen.
 *
 * Deliberately narrow, in the style the `colorId` upgrade already set: each piece is added only when
 * it is absent, and a whole missing SECTION is never invented. A blob without `arenaId`, without
 * `botEnabled`, or without both car records stays invalid and falls back whole, exactly as before.
 * This never loosens the wire — the server still rejects an incomplete payload; only what this
 * browser saved for itself is upgraded.
 */
function upgradeStoredSetup(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const fallback = defaultPlaygroundSetup();
  const withDifficulty =
    value.botDifficulty === undefined ? { ...value, botDifficulty: fallback.botDifficulty } : value;
  // Already a seat blob: nothing to do. Checked by presence rather than by shape, so a malformed
  // `cars` is handed to the validator to reject rather than being silently replaced.
  if (withDifficulty.cars !== undefined) return withDifficulty;

  const { me, opponent, ...rest } = withDifficulty as Record<string, unknown>;
  if (me === undefined || opponent === undefined) return withDifficulty;

  /** One legacy car record onto its seat: its own fields, plus whatever that seat's default
   * supplies for a field it never had (`colorId` on the oldest blobs, `enabled` on all of them). */
  const seatFrom = (car: unknown, seat: number, enabled: boolean): unknown => {
    const base = fallback.cars[seat]!;
    if (!isPlainRecord(car)) return { ...base, enabled };
    return {
      ...car,
      ...(car.colorId === undefined ? { colorId: base.colorId } : {}),
      enabled,
    };
  };

  return {
    ...rest,
    cars: fallback.cars.map((base, seat) =>
      seat === 0 ? seatFrom(me, 0, true) : seat === 1 ? seatFrom(opponent, 1, true) : { ...base, enabled: false },
    ),
    drivenSeat: 0,
  };
}
```

Add the tint migration beside it:

```ts
/**
 * Re-key the playground's stored car tints onto seat ids (PG86).
 *
 * Exactly one old key can be identified: the bot's, which was the constant `BOT_SESSION_ID` and is
 * seat 1 under the upgrade above. The human's own key was a per-connection Colyseus session id,
 * which cannot be mapped to anything — it is left where it is and simply never resolves, which
 * `sanitizeCarTints` already tolerates (a stale key costs that one car its tint, never the blob).
 *
 * That loss is not a regression. Under the old keying the human's tint was ALREADY discarded on
 * every reload, because the key was new on every connection; seat ids are the change that stops
 * that happening again.
 *
 * A tint already saved against seat 1 WINS over the legacy one. Saving under a seat id can only
 * have happened after this change, so it is the newer intent.
 */
function migrateTintKeys(tints: CarTintOverrides): CarTintOverrides {
  const legacy = tints[BOT_SESSION_ID];
  if (legacy === undefined) return tints;
  const seat1 = PLAYGROUND_SEAT_IDS[1]!;
  const rest: CarTintOverrides = {};
  for (const [key, tint] of Object.entries(tints)) {
    if (key !== BOT_SESSION_ID) rest[key] = tint;
  }
  return seat1 in rest ? rest : { ...rest, [seat1]: legacy };
}
```

Written as a loop rather than as `const { [BOT_SESSION_ID]: _dropped, ...rest } = tints` because
that destructuring form leaves an unused binding, which this repo's lint rejects.

In `decodeStored`, change the `carTint` line to:

```ts
    carTint: migrateTintKeys(sanitizeCarTints(rec.carTint)),
```

Sanitising first is what upgrades a bare-number legacy tint to `{hex, on: true}` before the key
moves, so the migration only ever handles the canonical shape.

Add `BOT_SESSION_ID`, `PLAYGROUND_SEAT_IDS` and `defaultPlaygroundSetup` to the
`@motor-combat-moba/shared` import, and `type CarTintOverrides` is already imported from
`../../fx/car-tint.js`.

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run packages/client/src/dev/playground/storage.test.ts`
Expected: PASS. Existing tests in that file that assert on `stored.setup.me` must be rewritten onto
`stored.setup.cars[0]`.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/dev/playground/storage.ts packages/client/src/dev/playground/storage.test.ts
git commit -m "feat(playground): upgrade a saved two-car blob to six seats (PG85/PG86)

me and opponent become seats 0 and 1, both on, driving seat 0; the other
four come from the defaults, off. Narrow in the style the colorId upgrade
set: a blob missing a whole section still falls back whole.

The bot's tint key migrates to seat 1. The human's cannot -- it was a
per-connection session id -- but that tint was already lost on every
reload, which is the bug seat ids fix."
```

---

### Task 6: The Car select panel, and a stats-only Physics panel

Implements PG74–PG77, PG80, PG81, PG83, PG84. **Closes the red window**; this task carries the full
`npm run build && npm test` gate.

**Files:**
- Create: `packages/client/src/dev/playground/car-panel.ts`
- Modify: `packages/client/src/dev/playground/overlay.ts`
- Test: `packages/client/src/dev/playground/overlay.test.ts`

The new module follows the shape `vfx-panel.ts` and `env-panel.ts` already use: it builds and
returns DOM, takes every side effect as an injected callback, and holds no reference to the room.
Read `packages/client/src/dev/playground/env-panel.ts` first — its props-object signature and its
"mark the inert control rather than letting it silently do nothing" convention are the two patterns
this module must match.

**Interfaces:**
- Consumes: `enabledSeats`, `canDisableSeat`, `nextDrivenSeat`, `isLoadoutLegal`, `carOptions`,
  `weaponOptions`, `arenaOptions`, `shippedLoadoutOf` (Task 4); `PLAYGROUND_SEATS`,
  `PLAYGROUND_SEAT_IDS` (Task 2); `carTintOverrides`, `carFillOf`.
- Produces:

```ts
export interface CarPanelProps {
  /** The setup the panel opens on (PG83). Never mutated — the panel rebuilds a fresh one on read. */
  readonly initial: PlaygroundSetup;
  /** The live per-car tint map, mutated in place and keyed by seat id (PG84). */
  readonly tints: CarTintOverrides;
  /** Whether hitbox outlines are on, and how to set them. Applied on the spot, not on Back. */
  readonly showHitboxes: () => boolean;
  readonly setShowHitboxes: (on: boolean) => void;
  /** Ship the rebuilt setup. Called on every control change that produces a LEGAL setup. */
  readonly onSetup: (setup: PlaygroundSetup) => void;
  /** Save to localStorage. Called after every edit, tint edits included. */
  readonly persist: (setup: PlaygroundSetup) => void;
  /** A tint changed: repaint. */
  readonly onTintEdit: () => void;
  readonly onBack: () => void;
}

export interface CarPanel {
  readonly el: HTMLElement;
  /** Whether any enabled seat's loadout is currently illegal (PG81) — the overlay's P-key exit
   * consults this so P is not a side door out while a loadout is illegal. */
  readonly isIllegal: () => boolean;
}

export function buildCarPanel(props: CarPanelProps): CarPanel;
```

- [ ] **Step 1: Write the failing overlay-model test**

`overlay.test.ts` today covers `termLine` only; the panel itself is the untested DOM shell by design
(PG16/PG19). Add the one assertion that is about routing rather than about DOM:

```ts
describe("pauseKeyAction over the Car select panel (PG74)", () => {
  it("backs Car select out to the menu without touching pause", () => {
    expect(pauseKeyAction("cars", "DIV")).toBe("back-to-menu");
  });

  it("still ignores P while focus is in one of its many form controls", () => {
    // Six seats means six chassis selects and eighteen weapon selects: picking "Pepperbox" with the
    // keyboard must never toggle pause out from under the user.
    expect(pauseKeyAction("cars", "SELECT")).toBe("ignore");
    expect(pauseKeyAction("cars", "INPUT")).toBe("ignore");
  });
});
```

Import `pauseKeyAction` from `./ui-model.js` in that file.

- [ ] **Step 2: Run it**

Run: `npx vitest run packages/client/src/dev/playground/overlay.test.ts`
Expected: PASS if Task 4's `pauseKeyAction` edit landed; FAIL otherwise, which means Task 4 is
incomplete — go back and finish it rather than patching here.

- [ ] **Step 3: Create `car-panel.ts`**

Write the module to this shape. The CSS class names reuse the overlay's existing ones
(`pg-panel`, `pg-settings`, `pg-settings-header`, `pg-row`, `pg-mode`, `pg-car-row`, `pg-loadout`,
`pg-illegal`, `pg-tint-row`, `pg-tint-hex`, `pg-tint-off`, `pg-difficulty`, `pg-illegal-hint`,
`pg-fx-block`, `pg-fx-headrow`, `pg-fx-head`) so no new stylesheet is needed; add only the three
new rules named in Step 4.

```ts
import type { CarId, PlaygroundSetup, WeaponId } from "@motor-combat-moba/shared";
import { CAR_TABLE, COLOR_TABLE, PLAYGROUND_SEATS, PLAYGROUND_SEAT_IDS } from "@motor-combat-moba/shared";
import { button, h } from "../../ui/dom.js";
import { carFillOf } from "../../scenes/car-visual.js";
import type { CarTintOverrides } from "../../fx/car-tint.js";
import {
  arenaOptions,
  canDisableSeat,
  carOptions,
  enabledSeats,
  isLoadoutLegal,
  nextDrivenSeat,
  shippedLoadoutOf,
  weaponOptions,
} from "./ui-model.js";

/**
 * The Car select panel (spec PG74-PG84): six seats, the alone/vs-bot mode, the arena and the hitbox
 * toggle.
 *
 * Its own module, alongside `vfx-panel.ts` and `env-panel.ts`, for the same reason those are: it is
 * a few hundred lines of DOM with no decisions in it, and `overlay.ts` was already the longest file
 * in the package before this feature widened it. Every decision this panel makes lives in
 * `ui-model.ts` as a pure function — which seats are on, whether the last one may be switched off,
 * where the wheel goes — so what is left here is nodes and listeners.
 *
 * Holds NO reference to the room. Everything that leaves this module leaves through a callback, the
 * same contract the two sibling panels have, so the panel can be rebuilt without re-wiring the room
 * and so nothing here can send a message the overlay did not route.
 */
export function buildCarPanel(props: CarPanelProps): CarPanel {
  // -- shared controls -------------------------------------------------------------------------
  const modeAlone = h("input", { type: "radio", name: "pg-mode", value: "alone",
    checked: !props.initial.botEnabled }) as HTMLInputElement;
  const modeBot = h("input", { type: "radio", name: "pg-mode", value: "bot",
    checked: props.initial.botEnabled }) as HTMLInputElement;

  const difficultySelect = selectFor(
    [{ id: "easy", name: "Easy" }, { id: "medium", name: "Medium" }, { id: "hard", name: "Hard" }],
    props.initial.botDifficulty,
  );
  difficultySelect.classList.add("pg-difficulty");
  // Meaningless while every other car is a target dummy, and saying so with the control itself is
  // clearer than leaving a live select that changes nothing.
  const syncDifficultyEnabled = (): void => { difficultySelect.disabled = !modeBot.checked; };

  const arenaSelect = selectFor(arenaOptions().map((id) => ({ id, name: id })), props.initial.arenaId);

  const hitboxToggle = h("input", { type: "checkbox", checked: props.showHitboxes() }) as HTMLInputElement;

  // -- one row of state per seat ---------------------------------------------------------------
  /**
   * One row of live controls per seat. `drive` inputs all carry `name: "pg-drive"` so the browser
   * enforces "exactly one seat is driven" for us — checking a new one unchecks the old, which is
   * what makes `readSetup`'s `findIndex` over `drive.checked` always find exactly one.
   */
  interface SeatRow {
    enabled: HTMLInputElement;
    drive: HTMLInputElement;
    car: HTMLSelectElement;
    color: HTMLSelectElement;
    weapons: HTMLSelectElement[];
    loadoutRow: HTMLElement;
    body: HTMLElement;
    title: HTMLElement;
    syncTint: () => void;
  }
  const rows: SeatRow[] = [];

  /** The setup the live controls currently describe. Rebuilt from the DOM every time, never from a
   * cached draft — the panel the user is looking at IS the source of truth for what gets sent. */
  function readSetup(): PlaygroundSetup {
    return {
      botEnabled: modeBot.checked,
      botDifficulty: difficultySelect.value as PlaygroundSetup["botDifficulty"],
      arenaId: arenaSelect.value,
      cars: rows.map((row) => ({
        carId: row.car.value as CarId,
        colorId: Number(row.color.value),
        weapons: row.weapons.map((s) => s.value) as [WeaponId, WeaponId, WeaponId],
        enabled: row.enabled.checked,
      })),
      drivenSeat: rows.findIndex((row) => row.drive.checked),
    };
  }
  // ... build each seat section, wire `evaluate`, return { el, isIllegal }
}
```

The three pieces worth writing out, because they hold the clauses rather than copying existing DOM:

```ts
  const illegalHint = h("span", { class: "pg-illegal-hint" }, ["duplicate weapon in a loadout"]);
  illegalHint.hidden = true; // avoid a flash before the first `evaluate` paints its real state
  const backBtn = button({}, ["Back"], () => props.onBack());
  let illegal = false;

  /** Which seat bodies are open. Local to this panel session and NOT persisted — a collapse is a
   * scroll convenience, the same ruling `activeTab` already carries (PG35/PG76). */
  const open = new Set<number>(enabledSeats(props.initial));

  /**
   * Re-evaluate legality (always) and, when `send` is true and everything is legal, ship the setup.
   *
   * Legality is checked over EVERY seat, not only the enabled ones: `isPlaygroundSetup` rejects a
   * duplicate loadout wherever it sits, so a parked seat with two Lances would make every later send
   * fail silently. The outline goes on whichever rows are actually illegal, so the user is pointed at
   * the seat that is wrong rather than at the panel.
   */
  function evaluate(send: boolean): void {
    const setup = readSetup();
    illegal = false;
    setup.cars.forEach((car, seat) => {
      const bad = !isLoadoutLegal(car.weapons);
      rows[seat]!.loadoutRow.classList.toggle("pg-illegal", bad);
      // A parked seat's illegal loadout still blocks the send, so open its section rather than
      // hiding the thing the user has to fix behind a collapsed header.
      if (bad && !car.enabled) open.add(seat);
      illegal ||= bad;
    });
    backBtn.disabled = illegal;
    illegalHint.hidden = !illegal;
    if (!send || illegal) return;
    props.onSetup(setup);
    props.persist(setup);
  }

  /**
   * Repaint everything that depends on WHICH seats are on: collapse state, header titles, and the
   * last-seat lock (PG76/PG79). Runs after any enable or drive change, never after a plain chassis
   * or weapon edit — those cannot change which seats exist.
   */
  function syncSeats(): void {
    const setup = readSetup();
    rows.forEach((row, seat) => {
      const on = row.enabled.checked;
      row.body.hidden = !open.has(seat);
      row.title.textContent = `Car ${seat + 1} — ${CAR_TABLE[row.car.value as CarId].name}`;
      row.title.parentElement?.classList.toggle("pg-seat-off", !on);
      // The last car on the field cannot be switched off (PG79): the wire rejects a setup with no
      // enabled seat, and a control whose only effect is a silently-dropped send is worse than one
      // that says why.
      const locked = !canDisableSeat(setup, seat);
      row.enabled.disabled = locked;
      row.enabled.title = locked ? "the last car on the field cannot be switched off" : "";
      row.syncTint();
    });
  }
```

and the per-seat wiring, inside the loop that builds `rows`:

```ts
    enabledBox.addEventListener("change", () => {
      if (!enabledBox.checked) {
        // PG78: the wheel has to land somewhere, or `drivenSeat` would name a car that is not there.
        // `readSetup()` here already reflects the unchecked box — a `change` listener runs after the
        // flip — which `nextDrivenSeat` handles either way: this seat is no longer in `enabledSeats`,
        // so the `find` returns the lowest one that is. All six drive radios share one `name`, so
        // checking the new one unchecks this one for free.
        const next = nextDrivenSeat(readSetup(), seat);
        rows[next]!.drive.checked = true;
        open.delete(seat);
      } else {
        open.add(seat);
      }
      syncSeats();
      evaluate(true);
    });

    driveRadio.addEventListener("change", () => {
      // PG77: reaching for "drive this one" on a parked seat is asking for it to be on the field.
      // Making that a second click would be a control that does nothing on first use — the same
      // ruling the tint picker already carries for its own first pick.
      if (!enabledBox.checked) {
        enabledBox.checked = true;
        open.add(seat);
      }
      syncSeats();
      evaluate(true);
    });

    carSelect.addEventListener("change", () => {
      syncRestore();
      syncSeats();
      evaluate(true);
    });

    for (const select of [colorSelect, ...weaponSelects]) {
      select.addEventListener("change", () => evaluate(true));
    }

    headBtn.addEventListener("click", () => {
      if (open.has(seat)) open.delete(seat);
      else open.add(seat);
      syncSeats();
    });
```

Everything else is a copy with one substitution each:

- **The tint trio** — copy `overlay.ts`'s `tintPicker` body verbatim. Two substitutions: its key
  becomes `PLAYGROUND_SEAT_IDS[seat]` instead of `room.sessionId` / `BOT_SESSION_ID` (PG84), and its
  `persist()` call becomes `props.persist(readSetup()); props.onTintEdit();`. Return its `sync`
  function as the row's `syncTint`. The precedence rule it carries — exactly one of the palette and
  the tint paints a car, and the inert side is dimmed and titled rather than disabled — is unchanged
  and must not be simplified away; it is the whole point of the control.
- **`selectFor` and `colorSelect`** — copy both helpers from `overlay.ts` into this module (they are
  six and eight lines). `overlay.ts` keeps its own copies for the stats rows.
- **The restore-kit button** — copy `restoreButton` verbatim; its `sync` becomes `syncRestore`.
  `shippedLoadoutOf` returns `undefined` for every unreleased prototype (they all carry
  `weapons: []`), so the button disables with `"This chassis has no three-weapon kit"` on five of
  the eight chassis today. That is correct, not a bug to work around.
- **Mode / arena / hitbox listeners** — mode radios call `syncDifficultyEnabled()` then
  `evaluate(true)`; the difficulty and arena selects call `evaluate(true)`; the hitbox toggle calls
  `props.setShowHitboxes(hitboxToggle.checked)` and nothing else. The hitbox toggle is the one
  control here that does NOT go through `evaluate`: it changes what this browser paints, not what
  the room simulates, so batching it behind a legality check would be a delay with no reason.
- **Header** — `h("div", { class: "pg-settings-header" }, [h("h2", {}, ["Car select"]), illegalHint, backBtn])`.
- **Body order** — mode row, arena row, hitbox row, then the six sections (PG75).
- **Return** — `{ el, isIllegal: () => illegal }`.

Finish construction with `syncDifficultyEnabled(); syncSeats(); evaluate(false);` — the initial
legality paint only. Opening the panel must not itself send.

- [ ] **Step 4: Add the three new CSS rules to `overlay.ts`'s `CSS` string**

```css
/* A seat section's header: the on/off box, the collapsing title button, the drive radio. */
.pg-seat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  background: #23262b;
  border-radius: 4px;
}
.pg-seat-head .pg-fx-head { flex: 1; min-width: 0; }
.pg-seat-head label { font-size: 11px; color: #aaa; white-space: nowrap; }
/* A seat that is off is still configurable — it is parked, not gone — so it is dimmed rather than
   disabled (PG62). */
.pg-seat-off .pg-fx-head { opacity: 0.55; }
.pg-seat-body { padding: 4px 8px 8px; }
```

- [ ] **Step 5: Rewire `overlay.ts`**

1. `subView` gains `"cars"`; `render()` gains
   `else if (view === "cars") root.appendChild(buildCarsPanel());`.
2. `buildMenu()` loses the `"Switch car"` button and gains, directly under Resume:
   ```ts
   button({}, ["Car select"], () => { subView = "cars"; render(); }),
   ```
3. Delete the `MSG_PLAYGROUND_SWITCH` import and its `room.send` call.
4. Replace `setupFromState` with the PG83 rule — live row, else stored seat, else default:
   ```ts
   /**
    * The setup the Car select panel opens on (PG83): per seat, the live row if there is one, else
    * whatever this browser last saved for that seat, else the default.
    *
    * The stored middle step is load-bearing rather than belt-and-braces. A DISABLED seat has no row
    * in `state.players` — that is what disabled means — so seeding it from the defaults would
    * silently discard the configuration the user typed into it before unchecking it, every time the
    * panel was reopened. PG62 says a parked seat keeps its configuration, and storage is the only
    * thing in a live session that remembers one: `PlaygroundScene` replays the stored blob into the
    * room on join and never again. Live state still wins wherever it exists, so an enabled seat can
    * never show a stale stored value.
    */
   function setupFromState(room: Room<PlaygroundState>): PlaygroundSetup {
     const fallback = defaultPlaygroundSetup();
     const stored = loadStored().setup;
     const cars = PLAYGROUND_SEAT_IDS.map((id, seat) => {
       const player = room.state.players.get(id);
       const parked = stored.cars[seat] ?? fallback.cars[seat]!;
       if (!player) return { ...parked, enabled: false };
       return { ...carSetupFromPlayer(player, parked), enabled: true };
     });
     // Mid-flight to the server (a fresh join, before the first patch) `state.players` is empty and
     // NO seat is enabled, which is not a setup the wire would accept. Force seat 0 on rather than
     // letting `drivenSeat` come back -1 and every later send be silently rejected.
     if (!cars.some((car) => car.enabled)) cars[0] = { ...cars[0]!, enabled: true };

     const driven = PLAYGROUND_SEAT_IDS.indexOf(room.state.controlledSessionId);
     return {
       botEnabled: room.state.botEnabled,
       botDifficulty: isBotDifficulty(room.state.botDifficulty)
         ? room.state.botDifficulty
         : fallback.botDifficulty,
       arenaId: isArenaId(room.state.arenaId) ? room.state.arenaId : fallback.arenaId,
       cars,
       // Fall back to the lowest seat that IS on the field rather than to 0, which may not be one.
       drivenSeat: cars[driven]?.enabled ? driven : cars.findIndex((car) => car.enabled),
     };
   }
   ```
   `carSetupFromPlayer` keeps its per-field leniency and drops `enabled` from its return (the caller
   sets it); its `fallback` parameter type becomes `Omit<PlaygroundCarSetup, "enabled">` or it keeps
   taking the full type and the caller spreads — either is fine, pick one and be consistent.
5. Add `buildCarsPanel()`, wiring the props:
   ```ts
   function buildCarsPanel(): HTMLElement {
     const panel = buildCarPanel({
       initial: setupFromState(room),
       tints: carTintMap,
       showHitboxes,
       setShowHitboxes: (on) => { setShowHitboxes(on); persistView(); },
       onSetup: (setup) => {
         const arenaChanged = setup.arenaId !== lastSentArenaId;
         room.send(MSG_PLAYGROUND_SETUP, setup);
         if (arenaChanged) { lastSentArenaId = setup.arenaId; onArenaChanged(); }
       },
       persist: (setup) => persistSetup(setup),
       onTintEdit: () => {},
       onBack: () => { if (panel.isIllegal()) return; subView = "menu"; render(); },
     });
     carsPanel = panel;
     return panel.el;
   }
   ```
   with `let carsPanel: CarPanel | undefined;` in the mount scope, cleared when the view leaves.
6. **`persist` splits.** The old `persist()` closed over the physics panel's DOM. Replace it with
   two mount-scope functions so both panels can save without owning each other's controls:
   ```ts
   /** The setup last known good, so a save from a panel that does not own the setup controls still
    * writes a coherent blob rather than clobbering it with defaults. */
   let lastSetup: PlaygroundSetup = loadStored().setup;

   function saveAll(): void {
     saveStored({
       setup: lastSetup,
       overrides: { ...lastOverrides },
       view: { showHitbox: showHitboxes() },
       vfx: { ...vfxOverrides },
       env: { ...envOverridesMap },
       carTint: { ...carTintMap },
     });
   }
   function persistSetup(setup: PlaygroundSetup): void { lastSetup = setup; saveAll(); }
   function persistView(): void { saveAll(); }
   ```
   `lastOverrides` is a mount-scope binding declared as
   `let lastOverrides: TuningOverrides = loadStored().overrides;`, and `buildSettings` **assigns its
   own map to it** (`lastOverrides = overrides;`) right after seeding that map from
   `overridesFromState(room)`. Assignment, not a copy: `fieldRow` mutates `overrides` in place, and
   `saveAll` has to see those mutations without being re-wired on every edit. `persistVfx` and
   `persistEnv` collapse into `saveAll` calls.

   `lastSetup` and the room can only disagree if the user never opens Car select, and they cannot:
   `PlaygroundScene` sends the stored setup to the room on join, so the two start equal and
   `persistSetup` keeps them so.
7. **Slim `buildSettings`.** Delete from it: the mode radios, the difficulty select, the arena
   select, both car selects, both colour selects, both tint pickers, both restore buttons, the six
   weapon selects, both loadout rows, `readSetup`, `evaluate`, the `controls` array, the
   `illegalHint`, `settingsIllegal`, the hitbox toggle and the `carRow`/`row` helpers that only
   served them. What remains: `overrides`, `backBtn`, `fieldRow`, `renderStats`, `resetAllBtn`,
   `copyBtn`, `leaveSettings` and the returned node — which becomes:
   ```ts
   return h("div", { class: "pg-panel pg-settings" }, [
     h("div", { class: "pg-settings-header" }, [h("h2", {}, ["Physics settings"]), backBtn]),
     h("div", { class: "pg-stats-toolbar" }, [resetAllBtn, copyBtn]),
     tabBar,
     statsContainer,
   ]);
   ```
   `renderStats()` now reads `statsTabs(lastSetup)` — the stats sections follow the seats the Car
   select panel last sent (PG82). `leaveSettings` keeps sending the tuning blob exactly once and
   loses its `settingsIllegal` guard (PG81): this panel has no loadout control left to make illegal.
8. `onKeyDown`'s `"back-to-menu"` branch: route `"cars"` through `carsPanel`'s own Back (so the
   illegal guard applies to P too), `"vfx"`/`"env"` as today, `"physics"` through `leaveSettings`.

- [ ] **Step 6: Run the client suite**

Run: `npx vitest run packages/client/`
Expected: PASS.

- [ ] **Step 7: Run the full gate**

Run: `npm run build && npm test`
Expected: PASS, both. This is the first point since Task 2 at which the repo typechecks. Read any
remaining error as a real reference you have not updated, not as expected noise.

- [ ] **Step 8: Verify it in the running app**

```bash
npm run dev
```

Open `http://localhost:5173/?dev=playground`, press P, and check each of these by hand. Report what
you saw, honestly, including anything that did not work:

1. "Car select" is in the menu and "Switch car" is not.
2. Six sections, seats 1 and 2 checked, seat 1 driving.
3. Check seats 3–6: six cars appear on the field.
4. Uncheck one: its car disappears. Uncheck down to one: that checkbox goes disabled.
5. Move the drive radio to a **disabled** seat: it enables and you are driving it.
6. Uncheck the seat you are driving: the wheel lands on the lowest remaining seat.
7. Switch to Vs bot: every other car starts moving and they fight each other, not only you.
8. Set a duplicate weapon in one seat: that loadout outlines red and Back is disabled.
9. Change a car's colour: it repaints without respawning. Pick a tint: the palette select dims.
10. Reload the page: your seats, your loadouts **and your own car's tint** all come back.
11. Physics settings holds only the stats tabs, and its Cars tab lists every enabled chassis.
12. With six bots on, watch the frame rate (PG88). If it drops, **say so** — do not cap the seats.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/dev/playground/car-panel.ts \
        packages/client/src/dev/playground/overlay.ts \
        packages/client/src/dev/playground/overlay.test.ts
git commit -m "feat(playground): the Car select panel (PG74-PG84)

Six collapsible seat sections, plus the mode, arena and hitbox controls
lifted out of Physics settings -- which is now the stats tabs and nothing
else. Its own module beside vfx-panel and env-panel, for the same reason:
DOM with no decisions in it, and overlay.ts was already the longest file
in the package.

Switch car is gone. Control is a radio per seat, and reaching for it on a
parked seat switches that seat on rather than doing nothing.

The panel seeds a parked seat from localStorage rather than from the
defaults: a disabled seat has no state to read, so seeding from defaults
would discard the configuration the user typed in before unchecking it."
```

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `packages/client/CLAUDE.md`

- [ ] **Step 1: Add the spec to the root doc table**

In `CLAUDE.md`, find the playground row in the "Read the right doc" table — the long one ending
`...(EV1–EV34)`. Append to its description column:

```
; the six-seat widening, the Car select panel and the stable seat ids (PG56–PG88)
```

and append to its link column:

```
, [`docs/superpowers/specs/2026-09-16-playground-six-car-select-design.md`](docs/superpowers/specs/2026-09-16-playground-six-car-select-design.md)
```

- [ ] **Step 2: Add a paragraph to the playground section of `CLAUDE.md`**

Immediately after the existing "**The playground tunes two kinds of VFX...**" paragraph, add:

```markdown
**The playground seats six cars, and a seat is not a connection.** As of 2026-09-16 the sandbox runs
six fixed seats with stable session ids (`pg-0`…`pg-5`) rather than "the human's car plus `"bot"`";
the human's own `client.sessionId` names no car at all, and `controlledSessionId` alone says which
one they drive. `PlaygroundSetup` carries a six-entry `cars` list — each with its own chassis,
colour, loadout and `enabled` flag — plus a `drivenSeat` index, and **six is structural rather than a
counted cap**: there are six seats, so nothing anywhere refuses a seventh car. A disabled seat keeps
its configuration (that is what makes a duel and a six-way two clicks apart), and the Car select
panel seeds one from localStorage rather than from the defaults, because a parked seat has no row in
`state.players` to read. `BOT_SESSION_ID` still exists and is `PracticeRoom`'s alone.
See [`docs/superpowers/specs/2026-09-16-playground-six-car-select-design.md`](docs/superpowers/specs/2026-09-16-playground-six-car-select-design.md).
```

- [ ] **Step 3: Note the tint keying fix in `packages/client/CLAUDE.md`**

Find the section that documents the per-car tint (added by the 2026-09-16 tint work — search for
`car-tint`). Append:

```markdown
The map is keyed by **seat id** as of the six-car widening, not by Colyseus session id. That was not
a refactor for tidiness: the human's key used to be a fresh session id on every connection, so their
own tint was silently discarded on every page reload while the bot's — keyed on the constant
`"bot"` — persisted. A stored `"bot"` entry migrates to seat 1; an old human key cannot be
identified and is dropped.
```

- [ ] **Step 4: Verify the docs suite still passes**

Run: `npm test`
Expected: PASS. `CLAUDE.md` is not under test, but `docs/turn-tuning.md` and the manual page are —
neither is touched by this work, so a failure here means something earlier in the plan moved a
config value it should not have.

- [ ] **Step 5: Commit and push**

```bash
git add CLAUDE.md packages/client/CLAUDE.md
git commit -m "docs(playground): record the six-seat model and the seat-keyed tints

Six is structural rather than a counted cap, and a seat is not a
connection -- both are easy to un-learn from the code alone."
git push -u origin development/main
```

---

## Self-review

**Spec coverage.** Every clause maps to a task: PG56/PG60–PG65 → Task 2. PG57/PG59/PG66–PG73 →
Task 3, with PG67's memory purge seamed out into Task 1. PG58 is an assertion about existing
behaviour and needs no code — it is verified by Task 6 Step 8's manual check that the arena scene
still renders. PG74–PG77, PG80, PG81, PG83, PG84 → Task 6. PG78/PG79/PG82 → Task 4. PG85/PG86 →
Task 5. PG87's four test layers are distributed across Tasks 2–6 (its `playground-room.test.ts`
bullets are Task 3 Steps 5–9, its `ui-model` bullets Task 4, its `storage` bullets Task 5, its
`shared` bullets Task 2). PG88 → Task 6 Step 8 item 12, as a reporting obligation rather than a
code change.

**Names used consistently across tasks.** `forgetCombatPlayer` / `forgetContactPlayer` (Task 1 →
Task 3), `PLAYGROUND_SEATS` / `PLAYGROUND_SEAT_IDS` (Task 2 → Tasks 3, 4, 5, 6), `seatIndexOf`
(Task 3, exported for its own test only), `enabledSeats` / `canDisableSeat` / `nextDrivenSeat`
(Task 4 → Task 6), `buildCarPanel` / `CarPanelProps` / `CarPanel` (Task 6 only), `migrateTintKeys`
(Task 5, module-private).

**Two known soft spots**, called out rather than hidden:

1. **Task 6 Step 3 is prose-plus-skeleton, not a full file.** A complete `car-panel.ts` would be
   ~400 lines of DOM most of which is a mechanical copy of `overlay.ts`'s existing controls. The
   step names the source to copy from (`overlay.ts`'s `tintPicker`, `restoreButton`, `selectFor`)
   and specifies every behaviour by clause. An executor who cannot get there from that should read
   `env-panel.ts` end to end first.
2. **`seatIndexOf` has exactly one production caller** (`setupFromState`'s `indexOf`, which could
   inline it). It is exported because the rule "a client session id is not a seat" is worth a named
   test, and because a future caller asking "which seat is this?" should not re-derive it.
