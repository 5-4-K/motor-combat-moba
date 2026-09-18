# Stage 3: Rams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-sided push contest with Unity's ram rule — nose-first above a threshold
speed, attacker stops dead and locks, victim flung, spun and reeling.

**Architecture:** `sim/ram.ts` becomes a classifier returning a `RamResolution` that says what each
car receives; `ram-bridge.ts` writes velocities directly, because Unity's model SETS velocity where
ours added to it. `Impulse`/`applyImpulse` survive untouched for `wildcharge`'s slam. Statuses carry
the control loss: `reeling` becomes a total loss of control, and `ramLock` arrives for the attacker.

**Tech Stack:** TypeScript, npm workspaces, vitest.

**Spec:** [`docs/superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`](../../specs/2026-09-18-unity-driving-and-ram-physics-port-design.md)
— §7, §8, §9.3, and decisions U5, U11, U23–U33, U38, U39.

**Ledger:** [`interfaces.md`](interfaces.md) — it carries the exact shapes; where this plan and the
ledger disagree, the ledger wins.

**Depends on:** stages 1 and 2 landed.

## Global Constraints

- **`npm test` from the repo root.** **`npm run build`** at the root, never `--workspaces`.
- Rebuild shared after editing it: `npm run build -w @motor-combat-moba/shared`.
- No magic numbers in logic; constants live in `packages/shared/src/config/`.
- **A ram deals no damage** (U28). Nothing in this stage calls `applyDamage`.
- Falloff scales a VICTIM's half only; an attacker pays full cost every time.
- Slams neither read nor write the falloff stack, and are otherwise untouched here.
- Do not touch `docs/ideas/` or `docs/invariants/`.
- `STATUS_TABLE` feeds `balanceStamp`, so Task 4 owes `npm run build:manual`.

---

### Task 1: Reshape `RAM_CONFIG`

**Files:**
- Modify: `packages/shared/src/config/ram-config.ts`, `packages/shared/src/config/car-config.ts`
  (stage 1's `spinPerTick` placeholder), `packages/shared/src/index.ts` (exports)
- Test: `packages/shared/src/config/ram-config.test.ts`

**Interfaces:**
- Consumes: `perTickDecay` (stage 1).
- Produces: the ledger's `RAM_CONFIG`; `inertiaRadiusSquared()`; `reelingSpinPerTick()`; `ramTicks()`
  (the ram tick table, now a rebuildable accessor, gaining `attackerLock`); `rebuildRamTicks()`.

- [ ] **Step 1: Write the failing test**

Replace the value-pinning block in `packages/shared/src/config/ram-config.test.ts`:

```ts
describe("RAM_CONFIG under the Unity ram rule", () => {
  it("authors Unity's shove scales, with a flank the hardest hit", () => {
    expect(RAM_CONFIG.headOnScale).toBe(0.2);
    expect(RAM_CONFIG.flankScale).toBe(1.5);
    expect(RAM_CONFIG.rearScale).toBe(1.2);
    expect(RAM_CONFIG.flankScale).toBeGreaterThan(RAM_CONFIG.rearScale);
    expect(RAM_CONFIG.rearScale).toBeGreaterThan(RAM_CONFIG.headOnScale);
  });

  it("gates a ram on a real approach speed", () => {
    expect(RAM_CONFIG.minRamSpeed).toBeGreaterThan(0);
    // A ram is a deliberate act: well over a drift, well under a chassis top speed.
    expect(RAM_CONFIG.minRamSpeed).toBeLessThan(forwardMaxSpeedOf("bastion") / 2);
  });

  it("derives the spin inertia from the hull, so it cannot drift from it", () => {
    const expected = (DRIVE_CONFIG.carWidth ** 2 + DRIVE_CONFIG.carHeight ** 2) / 12;
    expect(inertiaRadiusSquared()).toBeCloseTo(expected, 9);
  });

  it("decays a reeling car's spin as a per-second rate", () => {
    expect(RAM_CONFIG.reelingSpinDecayRate).toBeGreaterThan(0);
    expect(reelingSpinPerTick()).toBeCloseTo(
      Math.exp(-RAM_CONFIG.reelingSpinDecayRate / TICK_RATE_HZ), 12);
  });

  it("locks the attacker for less time than it reels the victim", () => {
    expect(RAM_CONFIG.attackerLockMs).toBeGreaterThan(0);
    expect(RAM_CONFIG.attackerLockMs).toBeLessThan(RAM_CONFIG.ramUncontrolMs);
    expect(ramTicks().attackerLock).toBe(msToTicks(RAM_CONFIG.attackerLockMs));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w @motor-combat-moba/shared -- ram-config.test
```

Expected: FAIL — `RAM_CONFIG.headOnScale` is undefined.

- [ ] **Step 3: Rewrite the config**

Delete `minApproachSpeed`, `defencePushScale`, `bonusFront`, `bonusFlank`, `bonusRear`,
`knockMaxSpeed`, `inertiaCoefficient`, `spinHalfLifeSeconds`, `counterSteerHalfLifeSeconds`, and the
whole `RamDecay` / `RAM_DECAY` / `resolveRamDecay` / `ramDecay` / `rebuildRamDecay` cluster. Write
the ledger's `RAM_CONFIG`, giving each new knob a doc comment naming its Unity original and the
conversion (spec §9.3). Then add:

```ts
/**
 * The hull's squared radius of gyration, `(w² + l²) / 12` — the inertia a ram's spin divides by.
 * Unity's `PushMath.SpinDelta` computes the same quantity from the collider footprint.
 *
 * DERIVED from `DRIVE_CONFIG` rather than authored, so it cannot drift from the hull it describes.
 * `RAM_CONFIG.inertiaCoefficient` was the authored stand-in and is deleted (U29).
 */
export function inertiaRadiusSquared(): number {
  return (DRIVE_CONFIG.carWidth ** 2 + DRIVE_CONFIG.carHeight ** 2) / 12;
}

/** Per-tick factor for a reeling car's free spin. Unity's `EffectsConfig.reelingSpinDecayRate`. */
export function reelingSpinPerTick(): number {
  return perTickDecay(RAM_CONFIG.reelingSpinDecayRate);
}
```

**Then fix the frozen tick table, which is a real bug predating this work (U40).** `RAM_TICKS` is a
`const` resolved at module load, and `setTuning` rebuilds four tables but never it — so
`ramUncontrolMs`, `drWindowMs` and `durationDrFloorMs` are already playground sliders that change
nothing, and `attackerLockMs` would join them. Stage 5's tuning session reaches for exactly these.
Replace the const with the same accessor-plus-rebuild pattern `driveOf` uses:

```ts
interface RamTicks {
  uncontrol: number;
  drWindow: number;
  durationFloor: number;
  attackerLock: number;
}

function resolveRamTicks(): Readonly<RamTicks> {
  return Object.freeze({
    uncontrol: msToTicks(RAM_CONFIG.ramUncontrolMs),
    drWindow: msToTicks(RAM_CONFIG.drWindowMs),
    durationFloor: msToTicks(RAM_CONFIG.durationDrFloorMs),
    attackerLock: msToTicks(RAM_CONFIG.attackerLockMs),
  });
}

const DEFAULT_RAM_TICKS: Readonly<RamTicks> = resolveRamTicks();
let ACTIVE_RAM_TICKS: Readonly<RamTicks> = DEFAULT_RAM_TICKS;

/** The ram durations in ticks. A FUNCTION, not a const: playground tuning may rebuild them. */
export function ramTicks(): Readonly<RamTicks> {
  return ACTIVE_RAM_TICKS;
}

/**
 * Re-resolve the ram durations after a tuning change (spec U40). Without this, every ram duration
 * knob in the playground moved its config value and changed nothing the sim read — the bug this
 * replaces. With no overrides it reassigns the module-load object BY REFERENCE, so an untuned build
 * cannot drift by a float, exactly as `rebuildResolvedDrive` does.
 */
export function rebuildRamTicks(hasOverrides: boolean): void {
  ACTIVE_RAM_TICKS = hasOverrides ? resolveRamTicks() : DEFAULT_RAM_TICKS;
}
```

Then add `rebuildRamTicks(active !== null);` beside the four existing rebuilds in
`packages/shared/src/config/tuning.ts:137-140`, and update the readers in
`packages/server/src/sim/ram-bridge.ts` (three sites) from `RAM_TICKS.x` to `ramTicks().x`. In
`index.ts`, drop the `RAM_DECAY` cluster and export `ramTicks`, `rebuildRamTicks`,
`inertiaRadiusSquared` and `reelingSpinPerTick`.

Add a test to `tuning.test.ts` beside the existing override cases:

```ts
it("rebuilds the ram durations when tuning moves them", () => {
  const before = ramTicks().uncontrol;
  setTuning({ "ram.ramUncontrolMs": RAM_CONFIG.ramUncontrolMs * 2 });
  expect(ramTicks().uncontrol).toBeGreaterThan(before);
  setTuning(null);
  expect(ramTicks().uncontrol).toBe(before);
});
```

Match `setTuning`'s real signature — read the file rather than trusting this sketch.

- [ ] **Step 4: Wire the reeling spin into `ChassisDrive`**

In `car-config.ts`, replace stage 1's placeholder with `spinPerTick: reelingSpinPerTick(),` and
delete the placeholder comment. **Check the import direction first:** `ram-config.ts` may import
`DRIVE_CONFIG`, but if it imports `car-config.ts` this creates a cycle — in that case move
`reelingSpinPerTick` into `drive-config.ts` and record the move in [`interfaces.md`](interfaces.md).

- [ ] **Step 5: Run and commit**

```bash
npm test -w @motor-combat-moba/shared -- ram-config.test
git add packages/shared/src/config packages/shared/src/index.ts
git commit -m "feat(ram): reshape RAM_CONFIG for the Unity ram rule"
```

The rest of the tree does not compile yet; Task 2 is what fixes that.

---

### Task 2: `sim/ram.ts` — the Unity classifier

**Files:**
- Modify: `packages/shared/src/sim/ram.ts` (rewrite), `packages/shared/src/index.ts`
- Test: `packages/shared/src/sim/ram.test.ts` (rewrite)

**Interfaces:**
- Consumes: Task 1's `RAM_CONFIG`, `inertiaRadiusSquared`.
- Produces: `RamRegion`, `RamType`, `RamSide`, `RamResolution`, `regionOf`, `ramTypeOf`,
  `resolveRam`, `applyRams`, and `contactPointOn` (now exported). `RamCar` gains
  `ramBlocked: boolean` — add that to the ledger when you add it here.

```ts
export interface RamSide {
  sessionId: string;
  shoveX: number; shoveY: number;
  spin: number;
  /** true: this car's velocity is REPLACED by the shove. false: the shove is ADDED to it. */
  replacesVelocity: boolean;
}

export interface RamResolution {
  type: RamType;
  /** The attacker, or "" for a head-on, which has none. */
  attackerId: string;
  sides: readonly RamSide[];
  /** Takes `ramLock`: the attacker, or both cars on a head-on. */
  locked: readonly string[];
  /** Takes `reeling`: the victim, or nobody on a head-on (U27). */
  reeled: readonly string[];
}
```

- [ ] **Step 1: Write the failing tests**

Rewrite `packages/shared/src/sim/ram.test.ts` around these cases, keeping the file's existing car and
hull helpers where they still fit:

```ts
describe("regionOf", () => {
  it("names the face a contact landed nearest, in the car's own frame", () => {
    const halfLength = DRIVE_CONFIG.carWidth / 2;
    const halfWidth = DRIVE_CONFIG.carHeight / 2;
    expect(regionOf(halfLength, 0, 4)).toBe("front");
    expect(regionOf(-halfLength, 0, 4)).toBe("rear");
    expect(regionOf(0, halfWidth, 4)).toBe("side");
    expect(regionOf(halfLength, halfWidth, 4)).toBe("frontCorner");
    expect(regionOf(-halfLength, -halfWidth, 4)).toBe("rearCorner");
  });
});

describe("resolveRam", () => {
  it("is null when the faster car leads with its flank, not its nose", () => {
    expect(resolveRam(slidingSideways(), parked(), "ffa")).toBeNull();
  });

  it("is null below minRamSpeed", () => {
    expect(resolveRam(noseFirstAt(RAM_CONFIG.minRamSpeed - 1), parked(), "ffa")).toBeNull();
  });

  it("stops the attacker dead and flings the victim on a flank ram", () => {
    const hit = resolveRam(noseFirstAt(150), parkedBroadside(), "ffa")!;
    expect(hit.type).toBe("flank");
    expect(hit.attackerId).toBe("a");
    expect(hit.locked).toEqual(["a"]);
    expect(hit.reeled).toEqual(["b"]);

    const attacker = hit.sides.find((s) => s.sessionId === "a")!;
    expect(attacker.replacesVelocity).toBe(true);
    expect(Math.hypot(attacker.shoveX, attacker.shoveY)).toBe(0);

    const victim = hit.sides.find((s) => s.sessionId === "b")!;
    expect(victim.replacesVelocity).toBe(false);
    expect(Math.hypot(victim.shoveX, victim.shoveY)).toBeGreaterThan(0);
  });

  it("scales the shove by the attacker's ramAttack against the victim's ramDefence", () => {
    const soft = resolveRam(noseFirstAt(150, "bastion"), parkedBroadside("bullseye"), "ffa")!;
    const hard = resolveRam(noseFirstAt(150, "bastion"), parkedBroadside("bastion"), "ffa")!;
    expect(shoveMagnitudeOf(soft, "b") / shoveMagnitudeOf(hard, "b")).toBeCloseTo(
      ramDefenceOf("bastion") / ramDefenceOf("bullseye"), 6);
  });

  it("throws a flank harder than a rear", () => {
    const flank = shoveMagnitudeOf(resolveRam(noseFirstAt(150), parkedBroadside(), "ffa")!, "b");
    const rear = shoveMagnitudeOf(resolveRam(noseFirstAt(150), parkedFacingAway(), "ffa")!, "b");
    expect(flank).toBeGreaterThan(rear);
  });

  it("spins a victim struck off-centre and not one struck dead-on", () => {
    const offCentre = resolveRam(noseFirstAt(150), parkedBroadsideOffset(20), "ffa")!;
    const deadOn = resolveRam(noseFirstAt(150), parkedBroadside(), "ffa")!;
    expect(Math.abs(sideOf(offCentre, "b").spin)).toBeGreaterThan(0);
    expect(Math.abs(sideOf(deadOn, "b").spin)).toBeCloseTo(0, 6);
  });

  it("stops both cars on a head-on, spins neither and reels neither", () => {
    const hit = resolveRam(noseFirstAt(150), noseFirstOncoming(150), "ffa")!;
    expect(hit.type).toBe("headOn");
    expect(hit.attackerId).toBe("");
    expect(hit.locked.slice().sort()).toEqual(["a", "b"]);
    expect(hit.reeled).toEqual([]);
    for (const side of hit.sides) {
      expect(side.replacesVelocity).toBe(true);
      expect(side.spin).toBe(0);
    }
  });

  it("refuses a teammate, as canDamage does", () => {
    expect(resolveRam(noseFirstAt(150, "bastion", 0), parkedBroadside("bullseye", 0), "team")).toBeNull();
  });

  it("will not let a reeling or locked car attack", () => {
    expect(resolveRam({ ...noseFirstAt(150), ramBlocked: true }, parkedBroadside(), "ffa")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test -w @motor-combat-moba/shared -- ram.test
```

Expected: FAIL — `regionOf` is not exported.

- [ ] **Step 3: Write the classifier**

Replace the contest (`pushOf`, `impactOn`, `bonusFor`, `impactSideOf`, `RamHit`, `RamImpulseEntry`)
with:

```ts
/**
 * Which face of this car a contact landed on, in the car's own frame — Unity's `RamRules.Region`.
 *
 * FACES, not volumes, and that is the whole subtlety: a front zone deep enough to catch corner hits
 * would also swallow the side panel behind the bumper and call a T-bone a head-on. The corner band
 * is the narrow strip where a front or rear face meets a side.
 */
export function regionOf(localX: number, localY: number, cornerBand: number): RamRegion {
  const halfLength = DRIVE_CONFIG.carWidth / 2;
  const halfWidth = DRIVE_CONFIG.carHeight / 2;
  const toFront = halfLength - localX;
  const toRear = halfLength + localX;
  const toSide = halfWidth - Math.abs(localY);

  if (toSide <= cornerBand && toFront <= cornerBand) return "frontCorner";
  if (toSide <= cornerBand && toRear <= cornerBand) return "rearCorner";
  if (toFront <= toRear && toFront <= toSide) return "front";
  if (toRear <= toSide) return "rear";
  return "side";
}

/** Only a nose can throw a ram. Unity's `RamRules.IsAttackRegion`. */
function isAttackRegion(region: RamRegion): boolean {
  return region === "front" || region === "frontCorner";
}

/**
 * The kind of ram, from the face the VICTIM was struck on and how the two cars line up. Unity's
 * `RamRules.Classify`: a side hit is always a flank; a front or rear hit is a head-on or a rear only
 * when the headings agree within `headOnAngleDeg`.
 */
export function ramTypeOf(
  victimRegion: RamRegion,
  attackerForward: Vec2,
  victimForward: Vec2,
  headOnAngleDeg: number,
): RamType {
  const limit = (headOnAngleDeg * Math.PI) / 180;
  if (victimRegion === "front" || victimRegion === "frontCorner") {
    return angleBetween(attackerForward, { x: -victimForward.x, y: -victimForward.y }) <= limit
      ? "headOn"
      : "flank";
  }
  if (victimRegion === "rear" || victimRegion === "rearCorner") {
    return angleBetween(attackerForward, victimForward) <= limit ? "rear" : "flank";
  }
  return "flank";
}

/** Unsigned angle between two unit vectors, radians. */
function angleBetween(a: Vec2, b: Vec2): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  return Math.acos(dot);
}

/** The shove multiplier for a ram of this kind. Unity's `RamRules.ScaleFor`. */
function scaleFor(type: RamType): number {
  if (type === "headOn") return RAM_CONFIG.headOnScale;
  if (type === "rear") return RAM_CONFIG.rearScale;
  return RAM_CONFIG.flankScale;
}

/**
 * The shove one car lands on another. Unity's `RamRules.ShoveDelta`, with `strength`/`resistance`
 * read off this game's `ramAttack`/`ramDefence` (U11) and `globalScale` reconciling the two scales:
 * Unity's ratings are 1-vs-1, this roster's are 45–70 against 30–90.
 */
function shoveOf(attacker: Participant, victim: Participant, type: RamType): Vec2 {
  const magnitude =
    (attacker.forwardSpeed *
      scaleFor(type) *
      RAM_CONFIG.globalScale *
      ramAttackOf(attacker.car.carId)) /
    (ramDefenceOf(victim.car.carId) * victim.car.defenceMult);
  return { x: attacker.forward.x * magnitude, y: attacker.forward.y * magnitude };
}

/**
 * Yaw the shove imparts at the contact point: the 2D cross product of the lever arm with the push,
 * over the hull's squared radius of gyration. Unity's `PushMath.SpinDelta`.
 *
 * Correct by construction rather than by tuning — a dead-centre hit puts lever and push on one line,
 * so the cross product is zero and there is no spin. NOT clamped here: the clamp belongs where the
 * spin is written onto a car (`ram-bridge.ts`), because a clamp inside a pure classifier would make
 * a resolution's meaning depend on the car it is later applied to.
 */
function spinOf(contact: Vec2, victim: RamCar, shove: Vec2): number {
  const rx = contact.x - victim.x;
  const ry = contact.y - victim.y;
  return (RAM_CONFIG.spinScale * (rx * shove.y - ry * shove.x)) / inertiaRadiusSquared();
}
```

`resolveRam` follows `RammingModule.OnCollisionEnter` plus `RamRules.Resolve`:

1. `canDamage` first, unchanged — friendly fire is decided by the same predicate as shots.
2. `contactNormalBetween` on the two hulls at `RAM_CONFIG.contactPad`; `null` means no contact.
3. **One** world contact point: the midpoint of `contactPointOn(a, b)` and `contactPointOn(b, a)`, so
   both cars classify against the same point rather than two different ones.
4. Per car: its flat heading; `forwardSpeed = Math.max(0, vx * fx + vy * fy)` — **speed along its own
   heading**, as Unity measures it, not speed toward the other car; and `regionOf` on that contact
   point transformed into its frame.
5. Qualification: `!ramBlocked && isAttackRegion(region) && forwardSpeed >= RAM_CONFIG.minRamSpeed`.
6. Neither qualifies → `null`. Both qualify → head-on if either classification is `headOn`, else the
   faster `forwardSpeed` attacks, and an exact tie is a head-on. One qualifies → it attacks.
7. Build the sides:
   - **flank / rear:** victim `{ shove, spin, replacesVelocity: false }`, attacker
     `{ shove: 0, spin: 0, replacesVelocity: true }`, `locked: [attackerId]`, `reeled: [victimId]`.
   - **head-on:** each car `{ shove: shoveOf(other, self, "headOn"), spin: 0,
     replacesVelocity: true }`, `locked: [a, b]`, `reeled: []`, `attackerId: ""`.

`applyRams` keeps its edge-triggered pair loop and sorted iteration and collects `RamResolution`s.
Keep the rule that contact is tracked even when no ram results, so accelerating while already
touching cannot manufacture a fresh trigger.

- [ ] **Step 4: Run the tests**

```bash
npm test -w @motor-combat-moba/shared -- ram.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/ram.ts packages/shared/src/sim/ram.test.ts packages/shared/src/index.ts
git commit -m "feat(ram): Unity ram classification — nose-first, faces, head-on"
```

---

### Task 3: `contact.ts` carries resolutions instead of impulses

**Files:**
- Modify: `packages/shared/src/sim/contact.ts:90-102,213-356`
- Test: `packages/shared/src/sim/contact.test.ts`

**Interfaces:**
- Consumes: Task 2's `RamResolution`.
- Produces: `ContactEvents.rams`; `resolveContacts` returning `{ contacts, events }`.

- [ ] **Step 1: Write the failing test**

```ts
it("reports an ordinary ram on the events, not as an impulse map", () => {
  const { events } = resolveContacts(cars, new Set(), "ffa", 0, new Map(), [], BOUNDS);
  expect(events.rams).toHaveLength(1);
  expect(events.rams[0]!.type).toBe("flank");
});

it("still leaves a dash a ContactHit, with no ram alongside it", () => {
  const { events } = resolveContacts(dashingPair, new Set(), "ffa", 0, new Map(), [], BOUNDS);
  expect(events.dashHits).toHaveLength(1);
  expect(events.rams).toHaveLength(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w @motor-combat-moba/shared -- contact.test
```

Expected: FAIL — `events.rams` is undefined.

- [ ] **Step 3: Change the shape**

Delete `ImpulseEntry`; add `rams: RamResolution[]` to `ContactEvents`; drop the `best` map and the
`impulses` return value. In the case-3 fallback:

```ts
  // Case 3: ordinary ram, exactly as `applyRams` resolves it. One resolution per PAIR — unlike the
  // old impulse map there is no per-victim slot to win, because a resolution names every car it acts
  // on. A car rammed by two others in one tick therefore takes both, which the sequential writes in
  // `ram-bridge.ts` already express.
  const ram = resolveRam(a, b, mode);
  if (ram !== null) rams.push(ram);
```

The dash and charge arms are untouched, `anyEvent` still short-circuits the ram fallback, and that is
what keeps `ramLock` from ever stranding a dashing or charging car.

- [ ] **Step 4: Run and commit**

```bash
npm test -w @motor-combat-moba/shared -- contact.test
git add packages/shared/src/sim/contact.ts packages/shared/src/sim/contact.test.ts
git commit -m "refactor(contact): carry ram resolutions on the events"
```

---

### Task 4: `reeling` redefined, `ramLock` added

**Files:**
- Modify: `packages/shared/src/config/status-config.ts:234-242`,
  `packages/shared/src/config/status-types.ts` (`StatusId`)
- Test: `packages/shared/src/config/status-config.test.ts`,
  `packages/shared/src/sim/status/channels.test.ts`

**Interfaces:**
- Consumes: stage 1's three flags.
- Produces: the ledger's two rows.

- [ ] **Step 1: Write the failing test**

```ts
it("makes a reeling car a passenger: no throttle, no steering, no grip, free spin, no ramming", () => {
  const mods = modifiersOf([{ statusId: "reeling", endsTick: 10, sourceSessionId: "a" }], 0);
  expect(mods.immobilised).toBe(true);
  expect(mods.steeringLocked).toBe(true);
  expect(mods.spinFree).toBe(true);
  expect(mods.ramBlocked).toBe(true);
  // It is not a stun: the trigger still works.
  expect(mods.disarmed).toBe(false);
  // Grip is REDUCED, not switched off (spec §5): a shove scrubs, only slower.
  expect(mods.grip).toBeCloseTo(0.6, 9);
  expect(mods.grip).toBeGreaterThan(0);
  // The contest-era multipliers are gone.
  expect(mods.turnRate).toBe(1);
  expect(mods.accel).toBe(1);
});

it("puts grip on the clamped channel path, and says so while the clamp is unreachable", () => {
  // Stage 1 Task 2 added the `grip` channel with a clamp test that could only assert the SHAPE of
  // STATUS_LIMITS: no row declared `grip`, so nothing drove a value through multiply-then-clamp.
  // `reeling` is the first row that does. It still cannot REACH either limit — a single 0.6 sits
  // inside 0.25..2, and `reapply: "ignore"` stops it stacking with itself — so the honest thing to
  // assert is that the value rides the generic channel path, plus a guard that fails the day a
  // second `grip` row makes the clamp reachable and a real clamp test becomes possible.
  const mods = modifiersOf([{ statusId: "reeling", endsTick: 10, sourceSessionId: "a" }], 0);
  expect(mods.grip).toBeCloseTo(STATUS_TABLE.reeling.modifiers.grip!, 9);
  expect(mods.grip).toBeGreaterThanOrEqual(STATUS_LIMITS.grip.min);
  expect(mods.grip).toBeLessThanOrEqual(STATUS_LIMITS.grip.max);

  const gripRows = Object.values(STATUS_TABLE).filter((row) => row.modifiers.grip !== undefined);
  expect(gripRows.map((row) => row.id)).toEqual(["reeling"]);
  // If THAT line fails, a second row now scales grip: write a test that actually drives the product
  // past a limit and checks it is clamped, then delete this guard.
});

it("kills a rammer's own controls without making it a passenger", () => {
  const mods = modifiersOf([{ statusId: "ramLock", endsTick: 10, sourceSessionId: "a" }], 0);
  expect(mods.immobilised).toBe(true);
  expect(mods.steeringLocked).toBe(true);
  expect(mods.ramBlocked).toBe(true);
  // A rammer stops; it does not slide, and it keeps full grip.
  expect(mods.grip).toBe(1);
  expect(mods.spinFree).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w @motor-combat-moba/shared -- channels.test
```

Expected: FAIL — `reeling` still resolves `turnRate: 0.4`.

- [ ] **Step 3: Write the rows**

```ts
  /**
   * Rammed: flung, sliding, spinning and along for the ride. Unity's `ReelingEffect` exactly —
   * `CarAbility.Throttle | Steer | YawHold | Grip | Ram` blocked for `RAM_CONFIG.ramUncontrolMs`.
   *
   * **Inputs off, not numbers worsened, since the 2026-09-18 Unity port.** It used to be
   * `turnRate: 0.4, accel: 0.4` — a car that handled badly. It is now a car with no inputs at all,
   * and the helplessness is the physics: `spinFree` leaves the spin running, and `grip: 0.6` slows
   * how fast the shove it just took scrubs off, so it rides further than a driver would slide. You
   * can still shoot, which is what keeps a ram a setup rather than a delete.
   *
   * **`grip` is a multiplier and not Unity's on/off `Grip` ability, deliberately (spec §5).** Unity
   * kills grip outright while reeling, which is survivable there because its base grip is high and
   * its arena is large. This game runs a much looser base rate for drift, so switching grip off would
   * carry a victim most of the way across the arena. 0.6 of 3/s is 1.8/s: a ~2.2 car length ride.
   *
   * `reapply: "ignore"` is FORCED by the flags (a flag-carrying debuff may never chain) and costs
   * exactly one behaviour: a re-ram landing while a reel is still running no longer extends it.
   * `applyStatus`'s `Math.max(endsTick, …)` already discarded every falloff-scaled duration on that
   * path, so the only case lost is a full-strength re-ram extending a live reel — precisely what
   * diminishing returns exists to discourage. Falloff still scales the shove, the spin, and the
   * duration of a ram landing after a reel has lapsed.
   */
  reeling: {
    id: "reeling",
    name: "Reeling",
    kind: "debuff",
    color: "#e8590c",
    reapply: "ignore",
    modifiers: { grip: 0.6 },
    flags: ["immobilised", "steeringLocked", "spinFree", "ramBlocked"],
  },
  /**
   * The price of landing a ram: your own car goes dead for `RAM_CONFIG.attackerLockMs`. Unity's
   * attacker lock (`RammingModule.LockMask`), and the reason ramming is a commitment rather than a
   * free hit — you stop, and for half a second you cannot drive, steer or ram again.
   *
   * Deliberately WITHOUT `spinFree` and with grip untouched: a rammer stops, it does not slide. Both cars
   * take it on a head-on.
   */
  ramLock: {
    id: "ramLock",
    name: "Ram Lock",
    kind: "debuff",
    color: "#adb5bd",
    reapply: "ignore",
    modifiers: {},
    flags: ["immobilised", "steeringLocked", "ramBlocked"],
  },
```

Add `"ramLock"` to `StatusId`. `status-config.test.ts` polices that a flag-carrying debuff is
`"ignore"` and that chainable rows are buffs — both rows satisfy it. Update any test pinning the row
count or `reeling`'s old modifiers.

- [ ] **Step 4: Rebuild the guide**

```bash
npm run build -w @motor-combat-moba/shared && npm run build:manual
```

The Effects section publishes a status only once something is recorded as applying it, so `ramLock`
appears when stage 4 authors its `EFFECT_SOURCES` line. If the page omits it for now, that is
expected.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(status): reeling becomes total control loss; add ramLock"
```

---

### Task 5: `ram-bridge.ts` writes velocities directly

**Files:**
- Modify: `packages/server/src/sim/ram-bridge.ts:315-410` (the impulses loop) and `contactCarsOf`
- Test: `packages/server/src/sim/ram-bridge.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `applyRamResolution`, per the ledger.

- [ ] **Step 1: Write the failing tests**

Reuse the file's scenario helpers; add one only if none fits.

```ts
it("stops the attacker dead and locks it", () => {
  const { state } = ramScenario();
  contactTick(/* … */);
  expect(state.players.get("a")!.vx).toBe(0);
  expect(state.players.get("a")!.vy).toBe(0);
  expect(hasStatus(readStatuses(state.players.get("a")!), "ramLock", TICK)).toBe(true);
});

it("adds the shove to the victim's PRE-COLLISION velocity", () => {
  const { state, approach } = ramScenario();
  contactTick(/* … */);
  expect(state.players.get("b")!.vx - approach.get("b")!.vx).toBeGreaterThan(0);
});

it("reels the victim and never the attacker", () => {
  const { state } = ramScenario();
  contactTick(/* … */);
  expect(hasStatus(readStatuses(state.players.get("b")!), "reeling", TICK)).toBe(true);
  expect(hasStatus(readStatuses(state.players.get("a")!), "reeling", TICK)).toBe(false);
});

it("scales a chained ram's shove, spin and reel, and charges the attacker in full", () => {
  const first = runRam();
  const second = runRam();
  expect(second.shove).toBeCloseTo(first.shove * RAM_CONFIG.impulseDrScale, 6);
  expect(second.reelTicks).toBeLessThan(first.reelTicks);
  expect(second.attackerStoppedDead).toBe(true);
});

it("clamps the written spin to spinMaxRate", () => {
  const { state } = ramScenario({ speed: 10_000 });
  contactTick(/* … */);
  expect(Math.abs(state.players.get("b")!.angVel)).toBeLessThanOrEqual(RAM_CONFIG.spinMaxRate);
});

it("credits the shover for the spikes", () => {
  const { memory } = ramScenario();
  contactTick(/* … */);
  expect(shoverOf(memory.spikes, "b")).toBe("a");
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test -w @motor-combat-moba/server -- ram-bridge.test
```

Expected: FAIL — `events.rams` is not read yet.

- [ ] **Step 3: Replace the impulses loop**

```ts
  // Every ram this tick. The loop writes velocities DIRECTLY rather than through `applyImpulse`,
  // because Unity's model SETS velocity where ours added to it: an attacker stops dead, a head-on
  // replaces both cars' velocity with the shove they took, and only a flank or rear victim keeps
  // what it was carrying. `applyImpulse` still serves the slam path below, unchanged.
  for (const ram of events.rams) {
    applyRamResolution(state, memory, statusMods, approachVelocities, ram, tick);
  }
```

```ts
function applyRamResolution(
  state: ArenaState,
  memory: ContactMemory,
  statusMods: ReadonlyMap<string, Modifiers>,
  approachVelocities: ReadonlyMap<string, { vx: number; vy: number }>,
  ram: RamResolution,
  tick: number,
): void {
  for (const side of ram.sides) {
    const player = state.players.get(side.sessionId);
    if (!player) continue;

    const shoved = side.shoveX !== 0 || side.shoveY !== 0;
    // Falloff is READ only for a car that actually takes a push, so an attacker's own dead stop
    // never counts a ram against its stack. It scales the shove AND the spin (U5): a chained ram
    // neither throws nor spins at full strength.
    const scales = shoved
      ? nextFalloff(memory.falloff, side.sessionId, tick)
      : { impulseScale: 1, durationScale: 1 };

    const pre = approachVelocities.get(side.sessionId) ?? { vx: player.vx, vy: player.vy };
    player.vx = (side.replacesVelocity ? 0 : pre.vx) + side.shoveX * scales.impulseScale;
    player.vy = (side.replacesVelocity ? 0 : pre.vy) + side.shoveY * scales.impulseScale;
    player.angVel = clamp(
      (side.replacesVelocity ? 0 : player.angVel) + side.spin * scales.impulseScale,
      -RAM_CONFIG.spinMaxRate,
      RAM_CONFIG.spinMaxRate,
    );

    if (ram.reeled.includes(side.sessionId)) {
      const ticks = Math.max(
        ramTicks().durationFloor,
        Math.round(ramTicks().uncontrol * scales.durationScale),
      );
      writeStatuses(player, applyStatus(readStatuses(player), "reeling", tick, ticks, ram.attackerId));
    }

    if (ram.locked.includes(side.sessionId)) {
      writeStatuses(
        player,
        applyStatus(readStatuses(player), "ramLock", tick, ramTicks().attackerLock, ram.attackerId),
      );
    }

    // AS20: whoever put you here owns what happens to you in the spikes. On a head-on that is the
    // other car, which is why this reads the shover off the resolution rather than off `attackerId`.
    if (shoved) {
      const shover = ram.attackerId !== "" ? ram.attackerId : otherSideOf(ram, side.sessionId);
      recordShove(memory.spikes, side.sessionId, shover, tick);
    }
  }
}
```

Two small helpers the loop needs, beside it in the same file:

```ts
/** The other car named by a head-on resolution — the one that put this car where it is. */
function otherSideOf(ram: RamResolution, sessionId: string): string {
  const other = ram.sides.find((s) => s.sessionId !== sessionId);
  return other?.sessionId ?? sessionId;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
```

If `ram-bridge.ts` already has a `clamp`, use that one rather than adding a second.

In `contactCarsOf`, add `ramBlocked: modifiersFor(statusMods, sessionId).ramBlocked` to each
`ContactCar`.

- [ ] **Step 4: Run the server suite and fix the fallout**

```bash
npm test -w @motor-combat-moba/server
```

Every test that recomputed an expectation from `defencePushScale`, `bonusFront`, `globalScale` or
`applyImpulse`-for-a-ram is now measuring a model that does not exist. **Rewrite each to the new rule
rather than re-pinning its arithmetic** — where a case's whole premise was the contest (the attacker
taking its own independently computed impulse, say), replace it with the Unity statement it becomes
(the attacker stops dead).

`pipeline-order.test.ts` declares itself the sequence `globalScale` and `spinScale` were measured
through. That measurement is stage 5's to redo; here, make the test assert the ORDER (drive → resolve
→ contact → combat) without pinning magnitudes, and say so in a comment.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ram): the bridge writes ram velocities directly"
```

---

### Task 6: Close the stage

**Files:**
- Modify: `EXECUTION.md`, `docs/turn-tuning.md` (prose only — its tables are stage 5's)

- [ ] **Step 1: Full verification**

```bash
npm install
npm run build
npm test
grep -rn "applyImpulse" packages/server/src | grep -v test
```

Expected: build green; `npm test` green except the three already-red bot tests; `applyImpulse` has
exactly one production caller left — the slam path.

- [ ] **Step 2: Measure the shipped ram for stage 5 to tune against**

```bash
node --input-type=module -e "
const m = await import('./packages/shared/dist/index.js');
const a = { sessionId:'a', team:0, x:0, y:0, angle:0, vx:m.forwardMaxSpeedOf('bastion'), vy:0, carId:'bastion', defenceMult:1, ramBlocked:false };
const b = { sessionId:'b', team:0, x:50, y:0, angle:Math.PI/2, vx:0, vy:0, carId:'bullseye', defenceMult:1, ramBlocked:false };
const hit = m.resolveRam(a, b, 'ffa');
const v = hit.sides.find(s => s.sessionId === 'b');
console.log('shove u/s:', Math.hypot(v.shoveX, v.shoveY).toFixed(1), 'spin rad/s:', v.spin.toFixed(2));
"
```

Record both numbers in `EXECUTION.md`. Stage 5 re-pitches `globalScale` and `spinScale` against
them. A shove that carries the victim more than about four car lengths (240 u) means it crosses most
of the arena — flag that to the user now rather than after the tuning pass.

- [ ] **Step 2b: Restore the `angVel` round-trip coverage stage 1 could not keep**

Stage 1 Task 8 re-pinned `packages/server/src/sim/tick.test.ts`'s "carries angVel/vx/vy through
bodyOf → stepDrive → writeBody" case and reported that it **lost real coverage**: under the ported
`stepDrive`, steering SETS the yaw rate rather than adding to it, so an injected `angVel` is
overwritten every tick unless `spinFree` is set — and no `STATUS_TABLE` row set `spinFree` until
this stage's Task 4. The round trip was therefore unreachable and the case was pinned at the
degenerate value.

`reeling` now carries `spinFree`. Restore the case: give the car `reeling`, inject an `angVel`, and
assert it survives the round trip and decays by `spinPerTick` rather than being zeroed. This is the
coverage the stage-1 comment promised would come back here — check that comment still reads true
and update it once it has.
- [ ] **Step 2a: `docs/turn-tuning.md`'s `reeling` prose — it is now wrong, and no test can see it**

Task 4 of this stage redefined `reeling` to `modifiers: { grip: 0.6 }`, dropping the `turnRate: 0.4`
and `accel: 0.4` multipliers it used to carry. Three places on that page still argue from the old
pair, in prose the parser test cannot reach:

- the **"Getting rammed to feel less helpless"** row — its whole "the multipliers only move in ONE
  direction, both already sit AT their `STATUS_LIMITS` floors (0.4 / 0.4)" argument is void. What
  replaces it: severity is now the `grip` multiplier (how far the shove carries) plus the flags
  (`immobilised`, `steeringLocked`, `spinFree`, `ramBlocked`), and duration is still
  `RAM_CONFIG.ramUncontrolMs` with its falloff knobs.
- the **"I lose control when hit"** symptom row, which names the same two multipliers.
- the paragraph retiring the old **"Rate while reeling"** derived row, written during stage 1, which
  correctly said at the time that `reeling` "still carries one (0.4)". It does not any more.

Re-read the whole page for any other sentence naming `reeling`'s `turnRate` or `accel`. Build a flat
`file:line` checklist and verdict each line individually rather than summarising by section — a
sibling task in stage 1 lost three stale lines exactly by batching them.

- [ ] **Step 3: Commit and update the tracker**

```bash
git add -A
git commit -m "docs(execution): stage 3 landed — the Unity ram rule"
```

---

## Stage 3 exit criteria

- [ ] A nose-first flank ram at speed stops the attacker dead, flings and spins the victim, and
      leaves it reeling for about a second.
- [ ] A flank-first slide into another car resolves as a bump and nothing else.
- [ ] A head-on stops both cars, spins neither, reels neither, and locks both.
- [ ] Chained rams fall off in shove, spin and reel duration; the attacker pays full cost each time.
- [ ] `applyImpulse` has exactly one production caller: the slam.
- [ ] No ram path calls `applyDamage`.
- [ ] `npm test` green except the three already-red bot tests.
- [ ] The measured shove and spin for a reference ram are recorded in `EXECUTION.md`.
