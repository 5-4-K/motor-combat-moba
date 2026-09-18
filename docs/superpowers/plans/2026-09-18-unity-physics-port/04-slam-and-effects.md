# Stage 4: Slam and Effects Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every impulse behaviour a thing a weapon row *declares* rather than a thing the sim
hardcodes for one weapon — then reconcile everything that sits beside the new ram model with the
model stage 3 landed: `wildcharge`'s authored push, the guide's Effects section, the HUD's status
chips, and the client's impact-spark gate.

**Architecture:** Stage 3 made the ram a rule rather than a contest. This stage does two things in
sequence. **First (Tasks 1-3) it restructures the impulse seam.** Two status applications are
currently hardcoded in `ram-bridge.ts` — `"reeling"` for `ImpulseDef.uncontrolMs`, `"stunned"` for
`ImpulseDef.wallStun` — so the row says how long but the bridge says which; two `ImpulseDef` fields
exist but drive nothing; and two event types describe one thing. After Tasks 1-3 the row names every
status, `spin` works, the word "slam" is gone, and no branch anywhere asks "is this a slam" — it asks
"does this row declare a push". **Then (Tasks 4-8) it reconciles the rest.** Nothing in this stage
changes what the game does: `wildcharge` keeps `spin: 0`, keeps its 1.4 s reeling and keeps its wall
stun, all now authored instead of implied.

**Tech Stack:** TypeScript, npm workspaces, vitest, `node --test` for the `scripts/*.test.mjs`
suite. `@motor-combat-moba/shared` is consumed as built `dist` — rebuild it after editing
(`npm run build -w @motor-combat-moba/shared`).

**Spec:** [`docs/superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`](../../specs/2026-09-18-unity-driving-and-ram-physics-port-design.md)
— **the 2026-09-19 changelog entry is the authority for Tasks 1-3** and supersedes §7.4's two event
types, §11 item 4's task order and §13's "any change to weapons". Tasks 4-8 are constrained by §7.2
(what a ram writes), §8 (the two status rows), §9.3 (the ram starting values and the `wildcharge`
re-pitch obligation), and §12 (`impact-feedback.ts`, the guide).

**Ledger:** [`interfaces.md`](interfaces.md) — outranks this plan for every shared name.

## Global Constraints

- **Stages 1, 2 and 3 must have landed before this stage starts.** Every task here reads a name that
  stage 3 creates: `RAM_CONFIG.flankScale`/`rearScale`/`headOnScale`/`minRamSpeed`/`globalScale` (new
  meaning), `STATUS_TABLE.ramLock`, the redefined `STATUS_TABLE.reeling`, the `spinFree`/
  `ramBlocked` flags, `resolveRam`'s `RamResolution` return, and the exported `contactPointOn`. Check
  [`EXECUTION.md`](EXECUTION.md) says stage 3 is **Landed** before beginning.
- **`npm test` from the repo root**, never per-workspace: a per-workspace run silently skips the
  server suite, and the root script is the only one that also runs `test:scripts`.
- **`npm install` in this worktree before the first build**, or the build inlines the main checkout's
  shared `dist`.
- **Build with root `npm run build`**, never `npm run build --workspaces` (ordering). Note the
  server's build is `tsup`/esbuild and does **not** typecheck — use `npm run typecheck` or
  `npm test` to see a type error in `packages/server`.
- **No magic numbers in logic.** Task 4's test derives its bar from `RAM_CONFIG` and `CAR_TABLE`; it
  must never type `260` or `520`.
- **`contact.ts` is table-free and stays that way.** Every def-derived fact it needs is passed in on
  `ContactCar` — `slamsStunned` already is, and Task 2 adds `pushesOnContact` the same way. Do not
  import `WEAPON_TABLE` or a def lookup into that file.
- **Nothing in Tasks 1-3 may change what the game does.** They are a restructure. `wildcharge` keeps
  `speed: 520`, `spin: 0`, 1400 ms of `reeling` and a 500/500 wall stun; Task 4 is the only task
  allowed to move a number, and it moves exactly one.
- **Which edits owe `npm run build:manual`.** `balanceStamp` hashes `WEAPON_TABLE`, the active
  `CAR_TABLE` rows, `COMBAT_CONFIG`, `STATUS_TABLE`, `DRIVE_CONFIG`, `TICK_RATE_HZ`, the arena width
  and the rendered copy — and **not** `RAM_CONFIG` (`scripts/build-cars-and-weapons.mjs:301-318`).
  For this stage:
  - Task 1 owes a rebuild: it reshapes `WEAPON_TABLE.wildcharge.impulse`, and the stamp hashes
    `JSON.stringify(WEAPON_TABLE)`. Restructuring the object moves the stamp even though no value
    changes.
  - Task 4 owes one **only if a `wildcharge.impulse` VALUE moves**. The stamp does not see comments,
    so a comment-only rewrite owes nothing.
  - Task 5 owes a rebuild: `EFFECT_SOURCES` is inside `copy`.
  - Task 5's `statusBlurb` edit owes a rebuild that **no test will demand**. The builder script is
    not hashed, so changing what it renders leaves the stamp identical and the committed page stale
    with every suite green. This is the one silent-staleness hole in the guard, and Task 8's rebuild
    is what closes it.
  - Tasks 6 and 7 are client-only and owe nothing.
- **Do not touch `docs/combat-model.md`, `docs/config-reference.md`, `docs/glossary.md`,
  `docs/turn-tuning.md` or the root `CLAUDE.md`.** Every one of them is stage 5's (§11 item 5).
- **Do not settle `wildcharge`'s number by feel.** §3 and §9.3 both hand the playground re-pitch to
  stage 5. This stage re-pitches it *analytically* against a quantity the new model makes computable
  again, and installs the guard that will fail if stage 5's retune invalidates it.
- **Do not decouple the weapon and ram modules.** `sim/impulse.ts` importing `ram-config.js`,
  `ImpulseDef.defenceScaled` meaning "divided by `ramDefence`", and the push being applied inside
  `ram-bridge.ts` are all known and deliberately out of scope — the owner reviewed the audit and
  declined it. `EXECUTION.md`'s deferred list carries all seven sites.
- Do not touch `docs/ideas/` or `docs/invariants/`.
- **The server suite is not green and must not be made green.** At stage 3's exit it is **15 failed /
  712 passed across 5 files** — `predict.test.ts` 9, `controller.test.ts` 2 (both G12),
  `planner.test.ts` 1 (R-P16), `tiers.test.ts` 2 (H25 and S13 evade), `balance/match.test.ts` 1.
  All five are stage-1 fallout owned by stage 5's `bot-tuner` pass. Do not touch them, do not re-pin
  them, do not investigate them. Any older "three already-red bot tests" phrasing is obsolete.

---

### Task 1: `ImpulseDef` declares its statuses, and `SLAM_CONFIG` becomes `IMPULSE_CONFIG`

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts` (add `ImpulseStatusApplication`; reshape
  `ImpulseDef`)
- Modify: `packages/shared/src/config/weapon-config.ts:461-520` (the `wildcharge.impulse` block)
- Modify: `packages/shared/src/config/weapon-ticks.ts:100-120` (the impulse conversion)
- Rename: `packages/shared/src/config/slam-config.ts` -> `packages/shared/src/config/impulse-config.ts`
- Modify: `packages/shared/src/index.ts` (the export line), `packages/shared/src/sim/impulse.ts` and
  `packages/shared/src/sim/contact.ts` (the two import sites)
- Test: `packages/shared/src/config/weapon-config.test.ts:448-545`

**Interfaces:**
- Consumes: `StatusId`, `isStatusId`, `msToTicks`.
- Produces: `ImpulseStatusApplication = { statusId: StatusId; durationMs: number }`; `ImpulseDef`
  with `applies: ImpulseStatusApplication[]` and `onWallImpact?: { windowMs: number; applies:
  ImpulseStatusApplication[] }` in place of `uncontrolMs` and `wallStun`; `IMPULSE_CONFIG`
  (`wallContactPad`, `spinScale`); `WEAPON_TICKS[id].impulse` gaining
  `applies: { statusId: StatusId; durationTicks: number }[]` and
  `onWallImpact?: { windowTicks: number; applies: { statusId: StatusId; durationTicks: number }[] }`.

- [ ] **Step 1: Write the failing test**

Replace the status assertions in `weapon-config.test.ts`'s `describe("ImpulseDef")` block with these,
keeping the file's existing helpers:

```ts
it("declares every status an impulse applies, naming none in code", () => {
  const imp = WEAPON_TABLE.wildcharge.impulse!;
  expect(imp.applies.map((a) => a.statusId)).toEqual(["reeling"]);
  expect(imp.applies[0]!.durationMs).toBe(1400);
  expect(imp.onWallImpact!.windowMs).toBe(500);
  expect(imp.onWallImpact!.applies.map((a) => a.statusId)).toEqual(["stunned"]);
  expect(imp.onWallImpact!.applies[0]!.durationMs).toBe(500);
});

it("accepts any real status id on either list — that is the point of the restructure", () => {
  for (const def of Object.values(WEAPON_TABLE)) {
    if (def.impulse === undefined) continue;
    for (const a of def.impulse.applies) expect(isStatusId(a.statusId), def.id).toBe(true);
    for (const a of def.impulse.onWallImpact?.applies ?? []) {
      expect(isStatusId(a.statusId), def.id).toBe(true);
    }
  }
});

it("converts every impulse duration to ticks exactly once", () => {
  const ticks = WEAPON_TICKS.wildcharge.impulse!;
  expect(ticks.applies[0]!.statusId).toBe("reeling");
  expect(ticks.applies[0]!.durationTicks).toBe(msToTicks(1400));
  expect(ticks.onWallImpact!.windowTicks).toBe(msToTicks(500));
  expect(ticks.onWallImpact!.applies[0]!.durationTicks).toBe(msToTicks(500));
});

it("leaves onWallImpact absent rather than zeroed when a row declares none", () => {
  // Absent must mean absent — the same rule `WeaponTicks.impulse` already follows. A zero-length
  // window would arm a sweep that can never fire, which is worse than not arming one.
  const bare: ImpulseDef = {
    speed: 1, direction: "radial", spin: 0, defenceScaled: false, applies: [],
  };
  expect(bare.onWallImpact).toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w @motor-combat-moba/shared -- weapon-config.test
```

Expected: FAIL — `imp.applies` is undefined; `ImpulseDef` still has `uncontrolMs` and `wallStun`.

- [ ] **Step 3: Add the type**

In `weapon-types.ts`, immediately above `ImpulseDef`:

```ts
/**
 * One status an impulse applies.
 *
 * **Deliberately NOT `StatusApplication`.** That type carries `target` and `wave`, and on this path
 * both can only ever hold one value: an impulse acts on exactly one car — the one it pushed — and
 * lands exactly once, so there is no volley to select and no second target to name. A field that can
 * hold one value is a rule hiding as a knob, and policing it with a config test is the defect this
 * restructure exists to remove, not a mitigation of it. The field NAMES match
 * `StatusApplication`'s on purpose, so the two read as kin.
 */
export interface ImpulseStatusApplication {
  statusId: StatusId;
  /** Converted to whole ticks once, in `WEAPON_TICKS`. */
  durationMs: number;
}
```

- [ ] **Step 4: Reshape `ImpulseDef`**

Replace `uncontrolMs` and `wallStun` with:

```ts
  /**
   * Applied to the pushed car the moment the push lands. An empty list is legal and means a push
   * that only pushes.
   *
   * **The bridge names no status of its own.** Until the 2026-09-19 restructure this was
   * `uncontrolMs: number` and `ram-bridge.ts` supplied the id `"reeling"` in code, so a row could
   * say how long but not which — the one place a weapon's effect was decided outside its row.
   */
  applies: ImpulseStatusApplication[];
  /**
   * Applied if the pushed car meets level geometry within `windowMs` of taking the push.
   *
   * A **deferred conditional application**: unlike `applies`, whose statuses land at once, these
   * wait and may never land at all. `ram-bridge.ts` arms a per-victim record when the push lands and
   * sweeps it each tick until the window closes; the first tick the car's hull is within
   * `IMPULSE_CONFIG.wallContactPad` of an obstacle or boundary, these apply and the window shuts, so
   * one push can stun at most once.
   *
   * Omit for a push that cannot. Absent must mean absent — a `windowMs: 0` would arm a sweep that
   * can never fire, which is worse than not arming one.
   */
  onWallImpact?: { windowMs: number; applies: ImpulseStatusApplication[] };
```

- [ ] **Step 5: Migrate `wildcharge` and rename the config**

In `weapon-config.ts`, replace `uncontrolMs: 1400` and `wallStun: { windowMs: 500, durationMs: 500 }`
with:

```ts
      applies: [{ statusId: "reeling", durationMs: 1400 }],
      onWallImpact: { windowMs: 500, applies: [{ statusId: "stunned", durationMs: 500 }] },
```

Keep every surrounding doc comment; only those two fields move. Then `git mv slam-config.ts
impulse-config.ts`, rename the export `SLAM_CONFIG` -> `IMPULSE_CONFIG`, and rewrite that file's
header comment to say what it is now:

```ts
/**
 * Constants every contact-applied weapon impulse reads. Named `SLAM_CONFIG` until 2026-09-19, when
 * both members turned out never to have been slam-specific:
 *
 * - `wallContactPad` — how close a hull counts as touching level geometry. It already had a non-slam
 *   consumer before the rename (`contact.ts`'s wall-blocked dash), and it is what every
 *   `ImpulseDef.onWallImpact` sweep measures against.
 * - `spinScale` — how much an authored push rotates its target. Inert until the same date, because
 *   the contact point handed to `applyImpulse` was the victim's own centre and the lever arm was
 *   therefore always exactly zero; Task 2 passes a real point and this became live.
 */
```

Update the three import sites (`index.ts`, `sim/impulse.ts`, `sim/contact.ts`).

- [ ] **Step 6: Convert the durations in `WEAPON_TICKS`**

In `weapon-ticks.ts`, replace the `uncontrol` / `wallStunWindow` / `wallStunDuration` fields:

```ts
            applies: def.impulse.applies.map((a) => ({
              statusId: a.statusId,
              durationTicks: msToTicks(a.durationMs),
            })),
            onWallImpact:
              def.impulse.onWallImpact === undefined
                ? undefined
                : {
                    windowTicks: msToTicks(def.impulse.onWallImpact.windowMs),
                    applies: def.impulse.onWallImpact.applies.map((a) => ({
                      statusId: a.statusId,
                      durationTicks: msToTicks(a.durationMs),
                    })),
                  },
```

Widen the `WeaponTicks.impulse` type to match, and leave `retriggerImmunity` unchanged.

- [ ] **Step 7: Run, rebuild the guide, commit**

```bash
npm test -w @motor-combat-moba/shared -- weapon-config.test
npm run build -w @motor-combat-moba/shared && npm run build:manual
```

Expected: the four cases PASS. `ram-bridge.ts` does NOT compile yet — Task 3 fixes it, and its errors
are the ones to record in your report.

```bash
git add packages/shared/src/config packages/shared/src/sim/impulse.ts packages/shared/src/sim/contact.ts packages/shared/src/index.ts packages/client/public/manual.html
git commit -m "refactor(impulse): a weapon row names the statuses its push applies"
```

---

### Task 2: One contact event, and a real contact point

**Files:**
- Modify: `packages/shared/src/sim/contact.ts` (`ContactHit`, `SlamEvent` deleted, `ContactCar`,
  `ContactEvents`, `resolvePair`'s two maneuver branches)
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/sim/contact.test.ts`

**Interfaces:**
- Consumes: Task 1's `ImpulseDef`; stage 3's exported `contactPointOn(victim, attacker): Vec2`.
- Produces: `ContactHit` gaining `push?: { dirX, dirY, contactX, contactY }`; `SlamEvent` **deleted**;
  `ContactEvents.contactHits: ContactHit[]` replacing `dashHits` and `slams`; `ContactCar` gaining
  `pushesOnContact: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
it("reports a dash and a charge as the same kind of event, in one list", () => {
  const { events } = resolveContacts(dashingPair, new Set(), "ffa", 0, new Map(), [], BOUNDS);
  expect(events.contactHits).toHaveLength(1);
  expect(events.contactHits[0]!.push).toBeUndefined();
});

it("carries push geometry only when the row declares an impulse", () => {
  const { events } = resolveContacts(chargingPair, new Set(), "ffa", 0, new Map(), [], BOUNDS);
  expect(events.contactHits).toHaveLength(1);
  const push = events.contactHits[0]!.push!;
  expect(Math.hypot(push.dirX, push.dirY)).toBeCloseTo(1, 9);
});

it("derives a real contact point, not the victim's centre, so an authored spin can rotate", () => {
  // This is why `ImpulseDef.spin` could never do anything: a lever arm of exactly zero.
  const { events } = resolveContacts(chargingPair, new Set(), "ffa", 0, new Map(), [], BOUNDS);
  const push = events.contactHits[0]!.push!;
  const victim = chargingPair[1]!;
  expect(Math.hypot(push.contactX - victim.x, push.contactY - victim.y)).toBeGreaterThan(0);
});

it("still keeps a car in any maneuver out of the ram arm", () => {
  // `anyEvent`'s real job. `ramLock` immobilises for half a second, and stranding a mid-ult charger
  // with it would be the worst bug this stage could ship.
  const { events } = resolveContacts(chargingPair, new Set(), "ffa", 0, new Map(), [], BOUNDS);
  expect(events.rams).toHaveLength(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w @motor-combat-moba/shared -- contact.test
```

Expected: FAIL — `events.contactHits` is undefined.

- [ ] **Step 3: Merge the two event types**

Delete `SlamEvent` entirely. On `ContactHit`:

```ts
  /**
   * The contact geometry this push needs, or `undefined` for a hit that pushes nobody.
   *
   * Present when the car's maneuver weapon declares an `ImpulseDef` (`ContactCar.pushesOnContact`)
   * AND the two hulls were far enough apart to measure a normal. Absent covers a dash, a charge
   * whose row declares no impulse, and the degenerate exact overlap where `awayFrom` returns null.
   *
   * **`ram-bridge.ts` cannot recompute either field** — the normal is measured between two moving
   * OBBs at the moment they touched, and this pass is the only place holding both. That is why the
   * geometry rides the event rather than being looked up later.
   *
   * `contactX`/`contactY` is a GENUINE point on the hull, from `contactPointOn` — the same helper
   * every ordinary ram uses. Until 2026-09-19 it was the victim's own centre, which made
   * `applyImpulse`'s lever arm exactly zero and `ImpulseDef.spin` incapable of rotating anyone at
   * any authored value.
   */
  push?: { dirX: number; dirY: number; contactX: number; contactY: number };
```

On `ContactCar`, beside `slamsStunned`:

```ts
  /**
   * Does this car's active maneuver weapon declare an `ImpulseDef`? Resolved by the bridge, like
   * every other def-derived fact on this type — this file stays table-free.
   */
  pushesOnContact: boolean;
```

On `ContactEvents`, replace `dashHits` and `slams` with:

```ts
  /**
   * Every maneuver contact this pass resolved — dashes and charges in one list. They were two lists
   * of two types until 2026-09-19, when the only difference left between them became "does this row
   * declare a push", which is a property of the weapon rather than of the event.
   */
  contactHits: ContactHit[];
```

- [ ] **Step 4: Collapse the two branches into one**

Replace both arms of `resolvePair`'s maneuver loop with:

```ts
    if (!inManeuver(attacker)) continue;
    if (!canDamage(attacker.sessionId, attacker.team, other.sessionId, other.team, mode)) continue;

    // The three gates below are the PUSH's, not the maneuver's: a hit that pushes nobody has no
    // victim to protect from re-pushing and no stun to land, so it is never gated by them.
    let push: ContactHit["push"];
    if (attacker.pushesOnContact) {
      if (other.stunned && !attacker.slamsStunned) continue;
      if (tick < (pushImmuneUntil.get(other.sessionId) ?? 0)) continue;
      const away = awayFrom(attacker, other);
      if (away !== null) {
        const point = contactPointOn(other, attacker);
        push = { dirX: away.x, dirY: away.y, contactX: point.x, contactY: point.y };
      }
    }

    contactHits.push({
      attackerSessionId: attacker.sessionId,
      targetSessionId: other.sessionId,
      weaponId: attacker.maneuverWeaponId as WeaponId,
      push,
    });
    anyEvent = true;
```

`inManeuver` replaces `isDasher`/`isCharger` as the loop's gate:

```ts
function inManeuver(c: ContactCar): boolean {
  return (
    (c.maneuver === ManeuverKind.DASH || c.maneuver === ManeuverKind.CHARGE) &&
    c.maneuverWeaponId !== ""
  );
}
```

Keep `isDasher` — `wallBlockedDashers` still needs it. Rename the `slamImmuneUntil` parameter to
`pushImmuneUntil` throughout. `anyEvent`'s short-circuit at the end of the loop is unchanged, and it
is load-bearing for the reason the fourth test states.

- [ ] **Step 5: Run and commit**

```bash
npm test -w @motor-combat-moba/shared -- contact.test
```

Expected: PASS. `ram-bridge.ts` still does not compile.

```bash
git add packages/shared/src/sim/contact.ts packages/shared/src/sim/contact.test.ts packages/shared/src/index.ts
git commit -m "refactor(contact): one maneuver contact event, with a real contact point"
```

---

### Task 3: The bridge applies what the row declared

**Files:**
- Modify: `packages/server/src/sim/ram-bridge.ts` (the pushes loop, the wall sweep, `contactCarsOf`,
  `ContactMemory.slammed`)
- Test: `packages/server/src/sim/ram-bridge.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `ContactMemory.pushed` replacing `.slammed`, carrying
  `{ bySessionId, wallWindowUntilTick, immuneUntilTick, wallApplies }`.

- [ ] **Step 1: Write the failing tests**

Reuse the file's existing scenario helpers; add one only if none fits.

```ts
it("applies exactly the statuses the row declared, by id", () => {
  const { state } = slamScenario();
  contactTick(/* … */);
  expect(hasStatus(readStatuses(state.players.get("b")!), "reeling", TICK)).toBe(true);
});

it("would apply a different status if the row named one", () => {
  // The restructure's whole point: nothing in the bridge knows the word "reeling".
  const { state } = slamScenario({ applies: [{ statusId: "spiked", durationMs: 1400 }] });
  contactTick(/* … */);
  const victim = readStatuses(state.players.get("b")!);
  expect(hasStatus(victim, "spiked", TICK)).toBe(true);
  expect(hasStatus(victim, "reeling", TICK)).toBe(false);
});

it("stuns on a wall impact inside the window, once, for the row's own duration", () => {
  const { state, memory } = slamScenario({ victimAgainstWall: true });
  contactTick(/* … */);
  expect(hasStatus(readStatuses(state.players.get("b")!), "stunned", TICK)).toBe(true);
  expect(memory.pushed.get("b")!.wallWindowUntilTick).toBe(TICK);
});

it("arms no live wall window when the row declares no onWallImpact", () => {
  const { memory } = slamScenario({ onWallImpact: undefined });
  contactTick(/* … */);
  expect(memory.pushed.get("b")!.wallApplies).toHaveLength(0);
});

it("rotates a victim when the row authors a spin, and not when it does not", () => {
  const still = runSlam({ spin: 0 });
  const spun = runSlam({ spin: 3 });
  expect(Math.abs(still.victim.angVel)).toBeCloseTo(0, 9);
  expect(Math.abs(spun.victim.angVel)).toBeGreaterThan(0);
});
```

`slamScenario`'s options are new — extend the existing helper to take an `ImpulseDef` override rather
than writing a second fixture builder. If it cannot accept one cheaply, say so in your report and
build the override inline.

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test -w @motor-combat-moba/server -- ram-bridge.test
```

Expected: FAIL to compile — `authored.ticks.uncontrol` no longer exists.

- [ ] **Step 3: Apply the declared statuses**

Replace the hardcoded `"reeling"` write in the pushes loop:

```ts
    for (const applied of authored.ticks.applies) {
      writeStatuses(
        victim,
        applyStatus(
          readStatuses(victim), applied.statusId, tick, applied.durationTicks, hit.attackerSessionId,
        ),
      );
    }
```

and the wall sweep's hardcoded `"stunned"`:

```ts
    for (const applied of entry.wallApplies) {
      statusRequests.push({
        targetSessionId: victimId,
        statusId: applied.statusId,
        durationTicks: applied.durationTicks,
        sourceSessionId: entry.bySessionId,
      });
    }
```

Rename `memory.slammed` -> `memory.pushed`, and its record fields to
`{ bySessionId, wallWindowUntilTick, immuneUntilTick, wallApplies }`, armed from
`authored.ticks.onWallImpact` — and when the row declares none, arm `wallApplies: []` with the window
already closed, so the sweep skips it immediately rather than carrying a live window that can never
fire. Read the contact geometry off `hit.push` and skip any hit whose `push` is `undefined`.

Keep the last-push-wins arbitration, the re-slam immunity clock, the `recordShove` spike credit, and
`endManeuverOnly` plus the attacker's self-status expiry exactly as they are — those are maneuver
rules, not impulse rules, and the existing comments say so.

In `contactCarsOf`, add `pushesOnContact: impulseOf(maneuverWeaponId) !== null` beside the existing
`slamsStunned: slamsStunnedOf(maneuverWeaponId)`.

- [ ] **Step 4: Verify the whole tree**

```bash
npm run build && npm run typecheck && npm test && npm run test:scripts
grep -rniE "\bslam" packages/shared/src packages/server/src --include=*.ts | grep -v "\.test\."
```

Expected: build and typecheck clean; shared, client and `test:scripts` green; the server at exactly
its 15 pre-existing failures. The grep should return **nothing but comments describing history** — if
a live identifier still says "slam", rename it.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sim/ram-bridge.ts packages/server/src/sim/ram-bridge.test.ts
git commit -m "feat(impulse): the bridge applies the statuses the row declared"
```

---

### Task 4: Re-pitch `wildcharge`'s `ImpulseDef` against the new ram scale

**Files:**
- Modify: `packages/shared/src/config/weapon-config.ts:461-502` (the `wildcharge.impulse` block)
- Test: `packages/shared/src/config/weapon-config.test.ts:448-545` (the `describe("ImpulseDef")`
  block)

**Interfaces:**
- Consumes: stage 3's `RAM_CONFIG.flankScale`, `.rearScale`, `.headOnScale`, `.globalScale`,
  `.ramUncontrolMs`, `.impulseDrFloor`; `forwardMaxSpeedOf`, `ramAttackOf`, `ramDefenceOf`.
- Produces: nothing new. A `WEAPON_TABLE.wildcharge.impulse` whose comments are true, and a guard
  over its `speed`.

**The arithmetic this task rests on.** Under §7.2 a ram's shove magnitude is

```
shove = driveIn * typeScale * globalScale * ramAttack(attacker) / (ramDefence(victim) * defenceMult)
```

and `driveIn` is bounded by the attacker's own top speed, `typeScale` by `max(headOnScale,
flankScale, rearScale)` and the rating ratio by the roster's extremes — so **the new model has a
computable roster maximum again**, which the deleted contest deliberately did not (it was open-ended
by design, R9). At the §9.2/§9.3 starting values (top speeds Mirage 189.03 / Bullseye 158.67 /
Bastion 135.9; `flankScale` 1.5, `globalScale` 0.5; ratings Mirage 55/50, Bullseye 45/30,
Bastion 70/90):

| ram | shove Δv | `520 /` it |
|---|---|---|
| Mirage flanks Bullseye at top speed — **the roster maximum** | 259.92 u/s | **2.00×** |
| Bastion flanks Bullseye at top speed (§9.3's `globalScale` calibration case, "~237") | 237.83 u/s | 2.19× |
| Mirage flanks Mirage at top speed — a typical mirror-match flank | 155.95 u/s | 3.33× |
| Bullseye flanks Bastion at top speed — the roster's weakest ram | 59.50 u/s | 8.74× |
| the roster maximum at the falloff floor (`impulseDrFloor` 0.25) | 64.98 u/s | 8.00× |
| Mirage head-on into Bullseye at top speed (`headOnScale` 0.2) | 34.66 u/s | 15.0× |

`520` therefore lands at **almost exactly twice the roster's hardest possible ordinary ram** — which
is the relationship `SLAM_CONFIG.knockSpeed` was originally authored to ("2x `RAM_CONFIG.knockMaxSpeed`")
and which stopped being expressible when the contest removed the maximum. **The value does not move;
its justification is rebuilt from a quantity that exists again.** Leave the value and rewrite the
comments.

- [ ] **Step 1: Write the guard**

Append to the `describe("ImpulseDef")` block in
`packages/shared/src/config/weapon-config.test.ts`, and add its imports —
`forwardMaxSpeedOf, ramAttackOf, ramDefenceOf` to the existing `./car-config.js` import and a new
`import { RAM_CONFIG } from "./ram-config.js";`:

```ts
/**
 * The hardest ordinary ram the roster can produce, in u/s of victim Δv, derived from the live
 * config rather than typed (spec §7.2's shove formula at its extremes).
 *
 * The maximum is reachable because every term is bounded: `driveIn` by the attacker's own top
 * speed, the type scale by the largest of the three, and the rating ratio by the roster's own
 * spread. The deleted contest had no such number — it was open-ended on purpose (R9) — which is
 * exactly why `wildcharge.impulse.speed`'s old "2x the ram maximum" comment had become a claim
 * about a quantity that did not exist.
 *
 * The whole table, not `activeCarIds()`: the question is what the game's physics can produce, and a
 * prototype chassis is driven in the playground long before it is published.
 */
function hardestOrdinaryRam(): number {
  const ids = Object.keys(CAR_TABLE) as CarId[];
  const typeScale = Math.max(RAM_CONFIG.flankScale, RAM_CONFIG.rearScale, RAM_CONFIG.headOnScale);
  let hardest = 0;
  for (const attacker of ids) {
    for (const victim of ids) {
      const shove =
        forwardMaxSpeedOf(attacker) *
        typeScale *
        RAM_CONFIG.globalScale *
        (ramAttackOf(attacker) / ramDefenceOf(victim));
      if (shove > hardest) hardest = shove;
    }
  }
  return hardest;
}

it("punts meaningfully harder than the hardest ordinary ram in the roster", () => {
  // The ult's whole identity, and the one property `RAM_CONFIG` can silently take away: it is NOT
  // hashed by `balanceStamp`, so a stage-5 retune of `globalScale` or `flankScale` moves every ram
  // in the game with no page rebuild and no other failing test. This is what notices.
  //
  // 1.5x rather than the 2.00x the shipped values actually land (520 vs 259.92), so an ordinary
  // tuning nudge does not trip it and a real inversion does: the bar bites once `globalScale`
  // passes ~0.667, a third above its authored 0.5.
  const slam = WEAPON_TABLE.wildcharge.impulse!;
  expect(slam.speed).toBeGreaterThan(hardestOrdinaryRam() * 1.5);
});

it("leaves its victim reeling for longer than a full-strength ram does", () => {
  // Both durations mean the same thing since spec U31: `reeling` is a total loss of control, not a
  // 60% steering debuff. An ult on a 20 s cooldown must outlast the thing anyone can do by driving.
  // A slam is also never falloff-scaled (U6), so this is the floor as well as the ceiling.
  const slam = WEAPON_TABLE.wildcharge.impulse!;
  expect(slam.uncontrolMs).toBeGreaterThan(RAM_CONFIG.ramUncontrolMs);
});
```

- [ ] **Step 2: Run it, and prove the guard bites**

```bash
npm test -w @motor-combat-moba/shared -- weapon-config.test
```

Expected: PASS. This is a guard installed over a value the analysis above concluded is already
right, not a red-green cycle — so prove it is not vacuous before trusting it. Temporarily set
`speed: 300` in `weapon-config.ts`, re-run, and confirm it FAILS
(`expected 300 to be greater than 389.87`); then put `520` back and re-run to green.

- [ ] **Step 3: Rewrite the `speed` comment**

Replace the whole doc comment above `speed: 520` in `packages/shared/src/config/weapon-config.ts`.
It currently argues from `SLAM_CONFIG.knockSpeed`, `RAM_CONFIG.knockMaxSpeed` and "the contest" —
all three deleted by stage 3 — and tells the reader stage 5 will re-pitch it against a contest
outcome:

```ts
      /**
       * The victim's Δv, in u/s, applied whole: `defenceScaled: false` below opts out of the
       * `ramDefence` divisor, so every chassis is punted exactly this far.
       *
       * **Re-pitched analytically by the 2026-09-18 Unity port's stage 4, and the number did not
       * move — its justification did.** It was authored as "2x `RAM_CONFIG.knockMaxSpeed`", then
       * orphaned twice: `knockMaxSpeed` went with `mass`, and the ram contest that replaced it was
       * open-ended by design (R9), so "the ram maximum" named a quantity nothing produced. The
       * Unity ram model brings that quantity back — a ram's shove is
       * `driveIn * typeScale * globalScale * ramAttack / ramDefence` (spec §7.2), every term
       * bounded — and at the §9.3 starting values the roster's hardest possible ram is a Mirage
       * flanking a Bullseye at its own top speed, at 259.9 u/s. 520 is 2.00x that, 3.3x a mirror-
       * match flank (156.0) and 8.0x the hardest ram once diminishing returns bottom out. The
       * original authoring intent is true again, by arithmetic rather than by assertion.
       *
       * `weapon-config.test.ts` pins the relationship rather than the number, at 1.5x the computed
       * maximum, because **`RAM_CONFIG` is not hashed by `balanceStamp`**: a retune of `globalScale`
       * or `flankScale` moves every ram in the game with nothing else failing.
       *
       * Still PROVISIONAL in one respect the arithmetic cannot settle (spec §9.3): under U31 the
       * 1.4 s of reeling below is a total loss of control with no lateral grip, so a 520 u/s punt
       * carries its victim into a wall — and often the spikes — far more reliably than the same
       * number did before. Stage 5 confirms that in the playground with the user. If it comes down,
       * it comes down as a fraction of `hardestOrdinaryRam()`, not to a freshly typed constant.
       */
      speed: 520,
```

- [ ] **Step 4: Rewrite the `uncontrolMs` comment**

Its last paragraph is about the *car-physics rework's* stage 4 ("Until stage 4 a slam imposed no
control loss at all"), which now reads as this stage, and it argues from `SLAM_CONFIG.victimAuthority`
and a `reeling` that no longer means what it says. Replace it:

```ts
      /**
       * How long the victim is left `reeling`, in ms. Longer than a full-strength ram's
       * `RAM_CONFIG.ramUncontrolMs` (1000) — an ult on a 20 s cooldown should outlast anything a
       * player can do by driving — and never falloff-scaled, since diminishing returns are ram-only
       * (spec U6), so an ult is not quietly discounted by how many ordinary rams the victim has
       * recently absorbed.
       *
       * **This got much harsher on 2026-09-18 without the number moving.** Under spec U31 `reeling`
       * carries `immobilised`, `steeringLocked`, `spinFree`, `ramBlocked` and `grip: 0.6`
       * (spec §5): 1.4 seconds of being a passenger, sliding on whatever velocity it was
       * given. Before that it was `turnRate: 0.4, accel: 0.4` — a degraded car, still steering. The
       * duration is the same; what it buys is not, and stage 5's playground pass is where that is
       * judged against the punt above.
       *
       * (It was carried across from the deleted `SLAM_CONFIG` by the car-physics rework's own
       * stage 4, which is a different stage 4 from the one that rewrote this comment.)
       */
      uncontrolMs: 1400,
```

- [ ] **Step 5: Sweep the block for any other deleted name**

```bash
grep -n "knockMaxSpeed\|SLAM_CONFIG\|contest\|pushOf\|impactOn\|victimAuthority\|selfKeepFactor" packages/shared/src/config/weapon-config.ts
```

Expected: no hits inside the `wildcharge` row. `defenceScaled`'s comment (spec R10) and `spin: 0`'s
comment both describe mechanisms stage 3 kept — `defenceFactorOf` in `sim/impulse.ts` and the lever
arm every ram still spins by (§7.2's `spinDelta`) — and stay as they are.

- [ ] **Step 6: Verify**

```bash
npm run build -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/shared -- weapon-config.test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/config/weapon-config.ts packages/shared/src/config/weapon-config.test.ts
git commit -m "docs(weapons): re-pitch wildcharge's slam against the Unity ram scale"
```

---

### Task 5: Publish `ramLock` in the players' guide

**Files:**
- Modify: `scripts/cars-and-weapons-copy.mjs:72-85` (`EFFECT_SOURCES` and its doc comment),
  `scripts/build-cars-and-weapons.mjs:131-151` (`statusBlurb`),
  `scripts/manual-page.test.mjs:243-247` (a stale comment)
- Test: `scripts/manual-facts.test.mjs`, `scripts/manual-page.test.mjs`

**Interfaces:**
- Consumes: stage 3's `STATUS_TABLE.ramLock` and redefined `.reeling`; the `spinFree`
  and `ramBlocked` flags.
- Produces: `EFFECT_SOURCES.ramLock`; three new words in `statusBlurb`'s vocabulary.

**Why this is not one line.** `PUBLISHED_EFFECTS` (`build-cars-and-weapons.mjs:447-449`) filters
`STATUS_TABLE` to rows something can apply — a weapon an active chassis carries, or an authored
`EFFECT_SOURCES` line. `ramLock` is applied by the contact pass, not by a weapon row, so without a
line it does not appear at all. And `statusBlurb` (`:131-151`) has words for `fullStop`,
`immobilised`, `steeringLocked`, `disarmed`, `invulnerable` and `phased` only — so after stage 3
**`reeling` and `ramLock` would both render as exactly "no control · no steering"**, identical and
both wrong: `reeling` lost the `turnRate`/`accel` multipliers that used to describe it, and neither
row's sliding, spinning or ram-blocking reaches the page.

- [ ] **Step 1: Teach `statusBlurb` the three new flags**

In `scripts/build-cars-and-weapons.mjs`, inside `statusBlurb`, add three lines — after
`steeringLocked` for the two that describe how the car moves, and after `disarmed` for the one that
describes what it may do:

```js
  if ((def.modifiers?.grip ?? 1) < 1) parts.push("low grip");
  if ((def.flags ?? []).includes("spinFree")) parts.push("spins freely");
  if ((def.flags ?? []).includes("disarmed")) parts.push("cannot fire");
  if ((def.flags ?? []).includes("ramBlocked")) parts.push("cannot ram");
```

(the `disarmed` line already exists — move the two new movement words above it and the ram word
below, keeping the worst-first ordering the block's own comment states). Extend that comment: it
currently says `fullStop` and `invulnerable` are "the two flags a flag-only row can carry with
nothing else in `modifiers`", which the Unity port makes false — `reeling` and `ramLock` are both
flag-only rows now, and they are the reason this vocabulary had to grow.

The two rows then read:

- **Reeling** — `no control · no steering · no grip · spins freely · cannot ram`
- **Ram Lock** — `no control · no steering · cannot ram`

- [ ] **Step 2: Author the `EFFECT_SOURCES` line**

In `scripts/cars-and-weapons-copy.mjs`:

```js
export const EFFECT_SOURCES = {
  reeling: "Every ram, and Wild Charge's slam.",
  ramLock: "Landing a ram yourself, and both cars in a head-on.",
  phased: "The moment after you respawn in Deathmatch.",
};
```

No digits and no spelled-out measurement, so `manual-facts.test.mjs`'s two prose guards stay green
without a new token. Update that export's doc comment: it says "Two reach a player another way
entirely" and names `reeling` and `phased`; it is three now, and the third is the interesting one —
`ramLock` is the first status a player is put in **by succeeding**, which is exactly why it has to be
on the page.

> **Flagged for the user, not decided here.** Spec §8 states that `EFFECT_SOURCES.reeling`'s line
> "stays true and needs no edit". Under §7.2 it is now *imprecise*: a head-on is a ram type (§7.1)
> and it reels nobody, so "Every ram" over-promises by one case. The spec is explicit, so this plan
> leaves the line alone and records the gap. If the user wants it tightened, "Any ram but a head-on,
> and Wild Charge's slam." is the wording, and it costs nothing extra — the copy file is already
> being rebuilt by this task.

- [ ] **Step 3: Fix the stale comment in the page test**

`scripts/manual-page.test.mjs:243-246` explains its `fromCopy` exemption as "`reeling` and `phased`
come from ramming and from the deathmatch respawn, not from a weapon row". The set itself is derived
from `Object.keys(EFFECT_SOURCES)` and needs no change, but name the third row so the next reader is
not left hunting for why an effect nothing links to is passing:

```js
    // `reeling`, `ramLock` and `phased` come from the contact pass and from the deathmatch respawn,
    // not from a weapon row, so nothing in the Cars section links to them by construction. They are
    // named in EFFECT_SOURCES, which is exactly what publishes them.
```

- [ ] **Step 4: Rebuild and read the section**

```bash
npm run build:manual
grep -o 'id="fx-[a-zA-Z]*"' packages/client/public/manual.html
```

Expected: the list includes `fx-ramLock` and `fx-reeling`. Then open
`http://localhost:5173/manual.html` (or the file directly) and read the two cards side by side —
they must describe different conditions, and `Ram Lock` must not read like a punishment.

- [ ] **Step 5: Run the script suite**

```bash
node --test "scripts/*.test.mjs"
```

Expected: PASS, including `manual-page.test.mjs`'s stamp check (the page was just rebuilt), its
"resolves every in-page link" check and its "links to every effect it publishes" check.

- [ ] **Step 6: Commit**

```bash
git add scripts/cars-and-weapons-copy.mjs scripts/build-cars-and-weapons.mjs scripts/manual-page.test.mjs packages/client/public/manual.html
git commit -m "docs(manual): publish ramLock and read the new status flags"
```

---

### Task 6: The HUD status chips — verify, then pin what the verification found

**Files:**
- Read only: `packages/client/src/scenes/status-hud.ts`,
  `packages/client/src/scenes/ArenaScene.ts:2877-2925`
- Test: `packages/client/src/scenes/status-hud.test.ts`

**Interfaces:**
- Consumes: stage 3's `STATUS_TABLE.ramLock` and redefined `.reeling`.
- Produces: nothing. Two regression cases.

**The HUD needs no change, and here is the proof.** The strip is fully table-driven:

- `status-hud.ts:40-42` — `statusFillOf` reads `statusDefOf(statusId).color` and parses it. No
  per-status branch.
- `status-hud.ts:62-83` — `statusBadges` reads `def.name` and `def.kind` off the row, derives
  `secondsLeft` and `fraction` from the two networked ticks, and drops anything `isStatusId` does
  not recognise. No per-status branch.
- `status-hud.ts:85-89` — `compareBadges` orders debuff-before-buff, then by time left, then by id.
  `ramLock` is a `kind: "debuff"`, so it sorts with the rest of them.
- `ArenaScene.ts:2922` — the label is `setText(\`${badge.name}  ${badge.secondsLeft}s\`)`. "Ram Lock"
  is eight characters at `STATUS_LABEL_FONT_PX` 11 in a `HUD_GUTTER_WIDTH` 144 gutter less
  `STATUS_STRIP_GAP_PX * 2` (32) and `STATUS_BAR_WIDTH_PX + HUD_STATUS_LABEL_PAD_X` (10) — 102 px of
  room, wider than "Overheated", which already ships.

So a new `STATUS_TABLE` row reaches the HUD with no client edit at all. Three things were worth
checking anyway, and all three come out clean:

1. **Is a half-second chip worth drawing?** Yes, and it needs no special case.
   `secondsLeft = Math.ceil(remaining / TICK_RATE_HZ)`, so `attackerLockMs` 500 (15 ticks) reads
   `1s` for its whole life and never `0s` — the floor the field's own doc comment promises. It is the
   only on-screen explanation for why your car went dead the instant you connected, and a player who
   is not told will report it as a dropped input. Drawing it is the cheaper of the two mistakes.
2. **Colour.** The ledger's `#adb5bd` is a mid grey, distinct from the roster's other debuffs
   (`#d9480f`, `#74b816`, `#4263eb`, `#0c8599`, `#e8590c`). It is close to `armored`'s `#868e96` and
   `overhauled`'s `#f1f3f5` — both **buffs**, so `compareBadges` never interleaves them with it, and
   neither has an applier in the shipped game (`build-cars-and-weapons.mjs:447`'s
   `PUBLISHED_EFFECTS` leaves both off the guide for exactly that reason). No change.
3. **The cap.** `STATUS_CONFIG.maxActive` is 6 and `statusStripLayout` shows at most that many, so
   two more reachable rows cannot overflow the strip.

- [ ] **Step 1: Pin it, so the next row is not taken on trust**

Append to `packages/client/src/scenes/status-hud.test.ts`, reusing that file's existing `row` helper:

```ts
describe("the ram statuses", () => {
  it("draws a badge for each straight off the table, with no client-side branch", () => {
    for (const id of ["reeling", "ramLock"] as const) {
      const badge = statusBadges([row(id, 0, 15)], 0)[0]!;
      expect(badge.name).toBe(STATUS_TABLE[id].name);
      expect(badge.kind).toBe("debuff");
      expect(badge.fill).toBe(Number.parseInt(STATUS_TABLE[id].color.replace("#", ""), 16));
    }
  });

  it("never shows 0s on a live half-second lock", () => {
    // `attackerLockMs` is 500 — 15 ticks at 30 Hz, less than one whole second for its entire life.
    // The chip is the only thing telling a player why their car went dead the moment they connected,
    // so it must read `1s` throughout rather than rounding itself away.
    const ticks = Math.round((RAM_CONFIG.attackerLockMs / 1000) * TICK_RATE_HZ);
    for (let t = 0; t < ticks; t++) {
      expect(statusBadges([row("ramLock", 0, ticks)], t)[0]!.secondsLeft).toBe(1);
    }
    expect(statusBadges([row("ramLock", 0, ticks)], ticks)).toHaveLength(0);
  });
});
```

Add `RAM_CONFIG` and `STATUS_TABLE` to that file's `@motor-combat-moba/shared` import; `TICK_RATE_HZ`
is already there.

- [ ] **Step 2: Run it**

```bash
npm test -w @motor-combat-moba/client -- status-hud.test
```

Expected: PASS with no source change. If it fails, the HUD is *not* table-driven and this task's
conclusion is wrong — find the branch before editing the test.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/scenes/status-hud.test.ts
git commit -m "test(hud): pin reeling and ramLock rendering from the table"
```

---

### Task 7: Make the impact spark agree with the new ram rule

**Files:**
- Modify: `packages/client/src/scenes/impact-feedback.ts`,
  `packages/client/src/scenes/ArenaScene.ts:1875-1979,2158-2176`,
  `packages/client/src/net/interpolation.ts:25-32` (one comment)
- Test: `packages/client/src/scenes/impact-feedback.test.ts`

**Interfaces:**
- Consumes: stage 3's `resolveRam(a, b, mode): RamResolution | null` and `RamCar`.
- Produces: `ImpactPose` aliased to the shared `RamCar`; `Impact` gains `closingSpeed`.

**What is wrong now.** `freshImpacts` sparks and shakes the camera on any fresh hull contact with a
car `canDamage` allows (`impact-feedback.ts:78-92`). That matched the sim exactly while
`RAM_CONFIG.minApproachSpeed` was 0 and any face could attack — every contact really was a ram. After
stage 3 it does not: §7.1 requires the attacker's own struck region to be `front` or `frontCorner`
and its drive-in to be at least `RAM_CONFIG.minRamSpeed` (39 u/s — 21% of a Mirage's top speed, 29%
of a Bastion's), and a car in `ramLock` or `reeling` may not attack at all. The spec's own exit
criterion is "a flank-first slide into someone does nothing but bump" — and today that slide shakes
the screen. It is worse after stage 3 than before, because a real ram now stops the attacker dead:
the spark is the player's only cue for *why*, and firing it on nudges that cost nothing is exactly
how a cue stops being read.

**The fix is to delete the duplicate, not to re-derive it.** `resolveRam` is pure, already gated by
`canDamage` internally, and already does its own OBB contact test — so the client can ask the sim's
own function whether this contact is a ram. `obbsInContact` stays for the *tracking* half, which must
keep seeing every contact so a held grind cannot be converted into a fresh trigger by speeding up
mid-touch — the same reason `applyRams` records `contacts` for pairs that produce no ram.

- [ ] **Step 1: Write the failing tests**

Replace `impact-feedback.test.ts`'s `pose` helper and add the new cases. The existing helper builds
stationary poses, so **every current case would report no spark under the new gate** — that is the
point, and each is re-pointed rather than deleted:

```ts
const pose = (
  sessionId: string,
  x: number,
  y: number,
  angle = 0,
  team: 0 | 1 = 0,
  vx = 0,
  vy = 0,
): ImpactPose => ({
  sessionId, x, y, angle, team, vx, vy,
  carId: "mirage" as CarId, defenceMult: 1, ramBlocked: false,
});

/** Nose-first at a speed comfortably over `minRamSpeed` (39 u/s). */
const charging = (sessionId: string, x: number, y: number, team: 0 | 1 = 0) =>
  pose(sessionId, x, y, 0, team, 150, 0);
```

then, alongside the re-pointed existing cases (`charging("me", 0, 0)` in place of `pose("me", 0, 0)`
everywhere the local car is meant to be the rammer):

```ts
it("does not spark on a contact the sim does not call a ram", () => {
  // Drifting in sideways: the drive-in along the nose is zero, so §7.1 disqualifies it as an
  // attacker outright. The cars touch, separate positionally, and nothing else happens — so
  // nothing should flash either.
  const tracker = newImpactTracker();
  const sliding = pose("me", 0, 0, Math.PI / 2, 0, 150, 0);
  expect(freshImpacts(sliding, [pose("them", 47, 0)], tracker, "ffa")).toEqual([]);
});

it("does not spark below the ram threshold", () => {
  const tracker = newImpactTracker();
  const crawling = pose("me", 0, 0, 0, 0, RAM_CONFIG.minRamSpeed / 2, 0);
  expect(freshImpacts(crawling, [pose("them", 47, 0)], tracker, "ffa")).toEqual([]);
});

it("sparks when the remote is the one ramming", () => {
  // The local car is the victim here, and it is still the local car's screen that should shake.
  const tracker = newImpactTracker();
  const hit = freshImpacts(pose("me", 0, 0), [pose("them", 47, 0, Math.PI, 0, -150, 0)], tracker, "ffa");
  expect(hit).toHaveLength(1);
});

it("does not spark for a car that may not ram", () => {
  const tracker = newImpactTracker();
  const locked = { ...charging("me", 0, 0), ramBlocked: true };
  expect(freshImpacts(locked, [pose("them", 47, 0)], tracker, "ffa")).toEqual([]);
});

it("still tracks a non-ram contact, so speeding up mid-grind cannot fake a fresh hit", () => {
  // Contact bookkeeping is independent of whether a spark fires — the same split `applyRams` makes
  // when it records `contacts` for pairs that produce no ram.
  const tracker = newImpactTracker();
  freshImpacts(pose("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa");
  expect(freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa")).toEqual([]);
});

it("reports the drive-in speed, so the shake can scale with the hit", () => {
  const tracker = newImpactTracker();
  const hit = freshImpacts(charging("me", 0, 0), [pose("them", 47, 0)], tracker, "ffa")[0]!;
  expect(hit.closingSpeed).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test -w @motor-combat-moba/client -- impact-feedback.test
```

Expected: FAIL — `ImpactPose` has no `vx`, and `Impact` has no `closingSpeed`.

- [ ] **Step 3: Rewrite the gate**

In `packages/client/src/scenes/impact-feedback.ts`:

```ts
import {
  RAM_CONFIG,
  carHullOf,
  obbsInContact,
  resolveRam,
  speedOf,
  type RamCar,
} from "@motor-combat-moba/shared";

/**
 * What this pass needs to know about one car — which is exactly what the sim's own ram resolver
 * needs, so it is that type rather than a parallel one.
 *
 * It was a bare pose (`{sessionId, x, y, angle, team}`) while the gate was "are these hulls
 * touching and are they enemies". The Unity ram rule reads velocity, heading and the ram flags too
 * (spec §7.1), and a second copy of that rule on the client is precisely the drift this alias
 * exists to make impossible.
 */
export type ImpactPose = RamCar;

export interface Impact {
  sessionId: string;
  x: number;
  y: number;
  /** The shove the sim will apply, in u/s — what the shake scales with. */
  closingSpeed: number;
}
```

and the loop body in `freshImpacts`:

```ts
  for (const other of others) {
    if (other.sessionId === self.sessionId) continue;
    // Tracking is still plain hull contact, deliberately WIDER than the spark: `applyRams` records
    // a contact for every touching pair, ram or not, so that holding against someone and then
    // accelerating cannot re-trigger without separating first. Narrowing this to rams would hand
    // back exactly that exploit.
    const inContact = obbsInContact(
      selfHull,
      carHullOf(other.x, other.y, other.angle),
      RAM_CONFIG.contactPad,
    );
    if (!inContact) continue;
    touching.add(other.sessionId);
    if (tracker.contacts.has(other.sessionId)) continue;

    // The sim's own answer, not a second reading of it. `resolveRam` applies `canDamage`, the
    // front/frontCorner attack region, `RAM_CONFIG.minRamSpeed` and the ram-blocked check itself —
    // so a flank-first slide, a crawl and a car inside its own `ramLock` all come back `null`, and
    // the spark stays a cue for the one contact that actually costs somebody something.
    const ram = resolveRam(self, other, mode);
    if (ram === null) continue;
    const side = ram.sides.find((s) => s.sessionId !== self.sessionId) ?? ram.sides[0];
    fresh.push({
      sessionId: other.sessionId,
      x: (self.x + other.x) / 2,
      y: (self.y + other.y) / 2,
      closingSpeed: side ? speedOf(side.shoveX, side.shoveY) : 0,
    });
  }
```

Rewrite the file's header comment's `canDamage` paragraph (`:59-64`): the team gate is no longer
this file's own — it is inside `resolveRam`, which is the stronger version of the same claim, and
the paragraph should say so rather than naming a predicate this file stopped importing.

- [ ] **Step 4: Feed it real cars in `ArenaScene`**

`ArenaScene.ts:1879` builds a `teams` map that exists **only** for this pass (`grep -n "teams"
packages/client/src/scenes/ArenaScene.ts` returns four lines, all of them this pass). Replace it with
the thing the pass now wants, built in the same `room.state.players.forEach` where the pose already
lands at `:1932`:

```ts
    // Everything `freshImpacts` needs, assembled where the render pose is already in hand. This
    // replaces the old `teams` map: the spark gate went from "are they an enemy" to "is this a ram",
    // and a ram reads velocity, chassis and the ram flags as well.
    const impactCars = new Map<string, ImpactPose>();
```

and, beside `poses.set(sessionId, pose)`:

```ts
      const mods = modifiersFromRows(player.statuses, room.state.tick);
      impactCars.set(sessionId, {
        sessionId,
        team: player.team === 1 ? 1 : 0,
        x: pose.x, y: pose.y, angle: pose.angle, vx: pose.vx, vy: pose.vy,
        carId: player.carId as CarId,
        defenceMult: mods.ramDefence,
        ramBlocked: mods.ramBlocked,
      });
```

then the call site at `:1958-1977` reads `impactCars.get(selfId)` for self, every other entry for
`others`, and passes the resolution's speed through:

```ts
      for (const impact of freshImpacts(selfCar, others, this.impacts, mode)) {
        this.showImpact(impact.x, impact.y, impact.closingSpeed);
      }
```

`showImpact`'s `closingSpeed = 0` default and its doc comment (`:2162-2166`) say "no caller has one
to give" — which this makes false. `ramShake` (`fx/camera.ts:66-76`) has always scaled intensity by
it and has always been fed 0; drop the default, and rewrite the paragraph to say the shake now scales
with the shove the sim is about to apply.

- [ ] **Step 5: Fix the interpolation comment this makes false**

`packages/client/src/net/interpolation.ts:25-32` says `vx`/`vy` "come from `to` untouched because
nothing that draws reads them". Something does now. Keep the behaviour — a half-blended velocity must
still never flow back into a step — and correct the reason:

```ts
 * `vx`/`vy` come from `to` un-blended: a half-blended velocity must never flow back into a step. The
 * impact-spark pass (`scenes/impact-feedback.ts`) does read them, to ask `resolveRam` whether a
 * contact is a ram, and the latest patched velocity is the right input for that — it is the server's
 * own number, where a blend would be an invention.
```

- [ ] **Step 6: Verify**

```bash
npm run build && npm test -w @motor-combat-moba/client
grep -n "canDamage" packages/client/src/scenes/impact-feedback.ts
```

Expected: build green, client suite green, the grep returns nothing (the gate moved inside
`resolveRam`).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src packages/shared/src
git commit -m "fix(client): spark only on contacts the Unity ram rule calls a ram"
```

---

### Task 8: Rebuild the guide, verify the stage, and update the tracker

**Files:**
- Modify: `packages/client/public/manual.html` (generated), [`EXECUTION.md`](EXECUTION.md)

**Interfaces:**
- Consumes: everything above.
- Produces: a committed page that matches the tables and the builder.

- [ ] **Step 1: Rebuild the page**

Task 5 already rebuilt it, but Task 4 may have moved `WEAPON_TABLE` and the builder's `statusBlurb`
change is invisible to `balanceStamp`, so rebuild once more at the end of the stage. Cheap, and the
alternative is a page that is stale with every suite green.

```bash
npm run build:manual
git diff --stat packages/client/public/manual.html
```

Expected: either no diff (Task 5's build already captured everything) or a diff confined to the
Effects section and the stamp meta tag. A diff touching weapon stat cells means a `WEAPON_TABLE`
value moved in Task 4 — check that was intended.

- [ ] **Step 2: Full verification**

```bash
npm install
npm run build
npm test
grep -n "shared/dist" packages/server/dist/index.js | head -3
```

Expected: build green; `npm test` green except the bot tests `EXECUTION.md` already records as red;
the inlined path reads `// ../shared/dist/…`, not an escaped worktree path.

- [ ] **Step 3: Check the art the guide draws still reads**

Nothing in this stage imports art, but the Effects section changed shape and the page is the only
place a status card is read at rest.

```bash
npm run check:art
```

Expected: the same `ok`/warning set stage 3 recorded — ten `check:weapons` warnings (`tremor` plus
the nine `basic-attack-<carId>` rows, none of which has an icon yet) and no blockers.

- [ ] **Step 4: Commit and update the tracker**

```bash
git add -A
git commit -m "chore(manual): rebuild the guide for the Unity port's effects"
```

Update [`EXECUTION.md`](EXECUTION.md) **in this same commit**: stage 4 row to **Landed**; the figures
Task 4 measured (`hardestOrdinaryRam()` at the shipped config, and `520 /` it); that
`wildcharge.impulse.speed` is still provisional and is stage 5's playground call; the
`EFFECT_SOURCES.reeling` head-on wording question from Task 5 Step 2, as an open item for the user;
that the HUD needed no change and why; and which stage is next.

- [ ] **Step 5: Say it out loud in the summary**

Two standing obligations this stage triggers, neither of which is a step to take on the user's
behalf:

- **The playtest probes.** `packages/server/playtest/` measures ram trigger rates and collision depth
  against the real pipeline, and stage 3 already invalidated every one of them. Nothing in stage 4
  touches `sim/`, so no new breakage is added — but the stage is a natural point to say so again.
  Name `packages/server/playtest/ram.ts` (already carrying a STALE banner) and recommend
  `npm run playtest`. Do not update a probe unless asked.
- **The balance harness.** `configFingerprint` hashes `RAM_CONFIG` whole, so every stored baseline is
  already incomparable. A fresh baseline is handed over, not acted on.

---

## Stage 4 exit criteria

- [ ] No status id appears as a string literal in `packages/server/src/sim/ram-bridge.ts`. Every
      status a weapon applies is named on its own row.
- [ ] `grep -rniE "slam" packages/*/src --include=*.ts` returns nothing but comments describing
      history. `SLAM_CONFIG`, `slam-config.ts` and `SlamEvent` are gone.
- [ ] `ContactEvents` has one maneuver-contact list, not two, and no branch asks whether a hit is a
      slam — only whether its row declares a push.
- [ ] `ImpulseDef.spin` rotates a victim when a row authors one, proven by a test; `wildcharge`
      still authors `0` and still punts straight.
- [ ] `wildcharge` still applies 1400 ms of `reeling` and still stuns on a wall inside 500 ms —
      both now read off the row rather than out of the bridge.
- [ ] `npm run build` (root) succeeds and the server bundle inlines `// ../shared/dist/…`.
- [ ] `npm test` passes except the bot tests `EXECUTION.md` records as already red.
- [ ] No comment in `WEAPON_TABLE.wildcharge.impulse` names `SLAM_CONFIG`, `knockMaxSpeed`, the ram
      contest, `pushOf`, `impactOn`, `victimAuthority` or `selfKeepFactor`.
- [ ] `wildcharge`'s punt is pinned against a `RAM_CONFIG`-derived roster maximum, not a typed
      number, and the guard is proven to fail when the value is wrong.
- [ ] `manual.html` publishes a `Ram Lock` card, and `Reeling` and `Ram Lock` read as different
      conditions rather than as the same two words.
- [ ] `node --test "scripts/*.test.mjs"` passes, including the stamp check against the committed
      page.
- [ ] The HUD is unchanged, and two tests say why it did not need to be.
- [ ] A flank-first slide and a sub-`minRamSpeed` crawl produce no spark and no camera shake; a
      nose-first ram at speed produces both, scaled by the shove the sim will apply.
