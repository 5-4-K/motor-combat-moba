# Interfaces ledger — Unity physics port

Every name the five stage plans share. **This ledger outranks any one plan and is outranked by the
spec** ([`2026-09-18-unity-driving-and-ram-physics-port-design.md`](../../specs/2026-09-18-unity-driving-and-ram-physics-port-design.md)).
If a plan and this file disagree, this file wins; if this file and the spec disagree, the spec wins.
A stage that changes a name here edits this file in the same commit.

## Config — `packages/shared/src/config/drive-config.ts`

```ts
export const DRIVE_CONFIG = {
  baseMaxSpeed: 60,            // unchanged
  speedPerRating: 1.518,       // unchanged
  baseDrag: 0.768,             // NEW  1/s at rating 0
  dragPerRating: 0.00608,      // NEW  1/s per point of `accel`
  lateralGripRate: 3.0,        // NEW  1/s, the DRIFT dial (U10). reeling scales it via the `grip` channel
  baseTurnRate: 0.667,         // RETUNED from 3.6
  turnRatePerRating: 0.0169,   // RETUNED from 0.054
  reverseAccelFactor: 0.4,     // RETUNED from 0.6
  reverseEpsilon: 6.0,         // NEW  u/s — brake-vs-reverse AND steering-flip threshold
  flipSteeringInReverse: false, // NEW (U8); shipped OFF — the user switched it off for a tuning
                                 // pass after this ledger was written (see EXECUTION.md's Deferred
                                 // list for why and the four rejected fixes). The ledger is corrected
                                 // to match the code; nothing "restores" `true`.
  stopEpsilon: 1e-3,           // unchanged, widened job (U17)
  carWidth: 60,                // unchanged
  carHeight: 40,               // unchanged
  dashSubstepMaxUnits: 16,     // unchanged
  restitution: 0,              // RETUNED from 0.15 in stage 2 (U22)
} as const;
```

**Deleted:** `steeringGrip`, `impactGripDecel`, `stopTurnRatio`, `baseAccel`, `accelPerRating`,
`reverseSpeedRatio`, `reverseHoldTicks`.

## Config — `packages/shared/src/config/car-config.ts`

```ts
export interface ChassisDrive {
  maxSpeed: number;      // u/s, emergent ceiling: engineAccel / dragRate
  engineAccel: number;   // u/s²
  reverseAccel: number;  // u/s²
  brakeDecel: number;    // u/s²
  turnRate: number;      // rad/s, speed-independent
  dragRate: number;      // 1/s — the authored rate, for docs and status scaling
  dragPerTick: number;   // perTickDecay(dragRate)
  gripPerTick: number;   // perTickDecay(DRIVE_CONFIG.lateralGripRate)
  spinPerTick: number;   // perTickDecay(RAM_CONFIG.reelingSpinDecayRate); 1 until stage 3 wires it
}
```

**`gripPerTick` and `spinPerTick` are resolved per chassis although both rates are global.** That is
what leaves `stepDrive` reading no module-level rate, which is what makes stage 1's 30-vs-60 Hz
equivalence test possible: build a `ChassisDrive` at the other rate and step it.

```ts

export function forwardMaxSpeedOf(id: CarId): number;  // unchanged
export function dragRateOf(id: CarId): number;         // RENAMED from accelOf, new meaning
export function engineAccelOf(id: CarId): number;      // NEW — forwardMaxSpeedOf * dragRateOf
export function reverseAccelOf(id: CarId): number;     // unchanged name, now engineAccelOf * reverseAccelFactor
export function turnRateOf(id: CarId): number;         // unchanged
export function brakeDecelOf(id: CarId): number;       // unchanged
export function driveOf(id: CarId): ChassisDrive;      // unchanged
```

**Deleted:** `accelOf` (renamed), `reverseMaxSpeedOf`, `turnRateAtStopOf`, `coastHalfLifeSecondsOf`,
`CarDef.coastHalfLifeSeconds`, `ChassisDrive.coastPerTick`, `.reverseMaxSpeed`, `.turnRateAtStop`,
`.accel`.

`halfLifeToPerTick` stays in `ram-config.ts` and keeps its one remaining caller there.

## Sim — `packages/shared/src/sim/drive.ts`

`stepDrive`'s signature is unchanged:

```ts
export function stepDrive(
  body: SimBody, input: InputMessage, dt: number,
  chassis: ChassisDrive, mods: Readonly<Modifiers>,
): SimBody;
```

Internal helpers after the rewrite — `engineCommandOf`, `dragFactorOf`, `steerSenseOf`,
`nextSpinOf`. **Deleted:** `nextForward`, `accelerateForward`, `brakeOrReverse`, `reverseFurther`,
`coast`, `bleedLateral`, `isMoving`, `nextAngVel`.

`isDashing`, `dashTranslation` and `dashSubstepCount` keep their current signatures.

## Sim — `packages/shared/src/sim/ram.ts`

```ts
export type RamRegion = "front" | "frontCorner" | "side" | "rearCorner" | "rear";
export type RamType = "headOn" | "flank" | "rear";

export interface RamCar {
  sessionId: string; team: 0 | 1; x: number; y: number; angle: number;
  vx: number; vy: number;            // PRE-COLLISION velocity
  carId: CarId; defenceMult: number;
  ramBlocked: boolean;               // NEW — from Modifiers.ramBlocked; a reeling or locked car cannot attack
}

/** What one car receives. `spin` is 0 for a head-on (U27); the clamp is the bridge's, not this. */
export interface RamSide {
  sessionId: string;
  shoveX: number; shoveY: number;
  spin: number;
  /** true: this car's velocity is REPLACED by the shove (attacker stop, head-on). false: ADDED to it. */
  replacesVelocity: boolean;
}

export interface RamResolution {
  type: RamType;
  /** The attacker's id, or "" for a head-on, which has none (U27). */
  attackerId: string;
  /** Every car this contact acts on: two entries for a flank/rear ram (attacker and victim), two for a head-on. */
  sides: readonly RamSide[];
  /** Takes `ramLock`: the attacker, or both cars on a head-on. */
  locked: readonly string[];
  /** Takes `reeling`: the victim, or nobody on a head-on. */
  reeled: readonly string[];
}

export function regionOf(localX: number, localY: number, cornerBand: number): RamRegion;
export function ramTypeOf(victimRegion: RamRegion, attackerForward: Vec2, victimForward: Vec2, headOnAngleDeg: number): RamType;
export function resolveRam(a: RamCar, b: RamCar, mode: "ffa" | "team"): RamResolution | null;
export function applyRams(
  cars: readonly RamCar[], previous: ReadonlySet<string>, mode: "ffa" | "team",
): { rams: RamResolution[]; contacts: Set<string> };
export function pairKey(a: string, b: string): string;   // unchanged
export function contactPointOn(victim: RamCar, attacker: RamCar): Vec2;  // now exported
```

**Deleted:** `ImpactSide`, `impactSideOf`, `RamHit`, `RamImpulseEntry`, `pushOf`, `impactOn`,
`bonusFor`.

## Sim — `packages/shared/src/sim/contact.ts`

`ContactEvents` gains `rams: RamResolution[]`, and `resolveContacts` stops returning an
`ImpulseEntry` map:

```ts
export function resolveContacts(
  cars: readonly ContactCar[], previous: ReadonlySet<string>, mode: "ffa" | "team",
  tick: number, slamImmuneUntil: ReadonlyMap<string, number>,
  obstacles: readonly Aabb[], bounds: Bounds,
): { contacts: Set<string>; events: ContactEvents };
```

`ImpulseEntry` is deleted. `ContactHit`, `SlamEvent`, `SpikeContact` and `SpikeHit` are unchanged,
and the dash and slam arms are untouched.

## Sim — `packages/shared/src/sim/impulse.ts`

`Impulse`, `applyImpulse` and `ImpulseDef` are **unchanged**. After stage 3 their only production
caller is the slam path in `ram-bridge.ts`.

## Config — `packages/shared/src/config/ram-config.ts`

```ts
export const RAM_CONFIG = {
  contactPad: 1,              // unchanged
  minRamSpeed: 39,            // NEW (replaces minApproachSpeed)
  headOnAngleDeg: 45,         // NEW
  cornerBandUnits: 4,         // NEW
  headOnScale: 0.2,           // NEW
  flankScale: 1.5,            // NEW
  rearScale: 1.2,             // NEW
  globalScale: 0.5,           // RETUNED from 0.4, new meaning
  spinScale: 0.3,             // RETUNED from 12.5, new meaning
  spinMaxRate: 6,             // unchanged
  spinEpsilon: 0.01,          // unchanged
  reelingSpinDecayRate: 2.0,  // NEW  1/s
  attackerLockMs: 500,        // NEW
  ramUncontrolMs: 1000,       // unchanged
  drWindowMs: 2000,           // unchanged
  durationDrScale: 0.5,       // unchanged
  durationDrFloorMs: 150,     // unchanged
  impulseDrScale: 0.5,        // unchanged
  impulseDrFloor: 0.25,       // unchanged
} as const;

export function ramTicks(): Readonly<{ uncontrol: number; drWindow: number; durationFloor: number; attackerLock: number }>;
export function rebuildRamTicks(hasOverrides: boolean): void;  // called by setTuning (U40)
export function inertiaRadiusSquared(): number;   // (carWidth² + carHeight²) / 12
export function reelingSpinPerTick(): number;     // exp(-reelingSpinDecayRate / TICK_RATE_HZ)
```

**Deleted:** `minApproachSpeed`, `defencePushScale`, `bonusFront`, `bonusFlank`, `bonusRear`,
`knockMaxSpeed`, `inertiaCoefficient`, `spinHalfLifeSeconds`, `counterSteerHalfLifeSeconds`,
`RamDecay`, `RAM_DECAY`, `resolveRamDecay`, `ramDecay`, `rebuildRamDecay`.

`halfLifeToPerTick` survives (exported, used by `reelingSpinPerTick`'s neighbours and by tests).

## Statuses — `packages/shared/src/config/status-types.ts`, `status-config.ts`

`StatusFlag` gains `"spinFree" | "ramBlocked"`; `Modifiers` gains those two booleans (false in
`NEUTRAL_MODIFIERS`, OR-ed in `modifiersOf`) **and one multiplier channel, `grip`** (neutral 1,
multiplied and clamped like every other channel), with a `STATUS_LIMITS.grip` entry — suggested
`{ min: 0.25, max: 2 }`. There is **no `gripless` flag**: `grip` is a rate multiplier, so a status can
say "scrubs, but slower", which a boolean cannot.

```ts
reeling: { id: "reeling", name: "Reeling", kind: "debuff", color: "#e8590c",
  reapply: "ignore", modifiers: { grip: 0.6 },
  flags: ["immobilised", "steeringLocked", "spinFree", "ramBlocked"] },

ramLock: { id: "ramLock", name: "Ram Lock", kind: "debuff", color: "#adb5bd",
  reapply: "ignore", modifiers: {},
  flags: ["immobilised", "steeringLocked", "ramBlocked"] },
```

`StatusId` gains `"ramLock"`. Wire values are string ids, so nothing renumbers.

## Server — `packages/server/src/sim/ram-bridge.ts`

`contactTick`'s signature is unchanged. Internally the impulses loop is replaced by a rams loop that
writes velocities directly:

```ts
function applyRamResolution(
  state: ArenaState, memory: ContactMemory,
  approachVelocities: ReadonlyMap<string, { vx: number; vy: number }>,
  ram: RamResolution, tick: number,
): void;
```

**`statusMods` is deliberately omitted, not dropped by oversight (controller ruling S3-m).** The
`ramDefence` multiplier this function would have read from it is already consumed upstream, in
`shoveOf` via `ContactCar.defenceMult` (spec §7.2 divides by `victimDefenceMult` there) — a second
read here would double-count. The function is module-private with one call site, and nothing else
in this plan set binds its arity. If a later stage needs status context inside this function, adding
the parameter back is a one-line change.

`newFalloffStack`, `nextFalloff`, `sweepFalloff`, `FalloffStack`, `FalloffScales`, `ContactMemory`,
`clearKnock`, `forgetContactPlayer` and the slam half are unchanged.

## Bot — `packages/server/src/bot/brain/predict.ts`

`OBSERVATION_MODIFIERS` keeps `accel: 0` and `brakeDecel: 0` and **loses** its `topSpeed` override
(U34). `BOT_BRAIN_VERSION` moves to `6.0.0` in stage 1.

**AMENDED — it moved again, in stage 5 Task 8 (2026-09-19), to `6.0.1`.** This line originally said
it "does not move again inside this work", written before Task 8 found a real bug in
`physicsPredictor`: the below-threshold (residual ram-spin) branch needs `mods.spinFree: true` to
decay per its own doc comment, and U16 ("steering SETS the rate") silently made that impossible
without it — the residual was overwritten to exactly 0 on the first rolled tick instead of decaying,
so a bot mispredicted a just-rammed car as having stopped spinning immediately. Fixed by passing
`spinFree: true` for exactly that branch. `BOT_PROFILES` did not move — this is a real behaviour
change in brain code, and the `bot-tuner` skill's own rule is that `BOT_BRAIN_VERSION` bumps for
that regardless of what this ledger predicted. Reviewed and settled: the escalation was correct on
the merits (behaviour moved without `BOT_PROFILES` moving, which is precisely what the fingerprint
exists to invalidate), and this ledger is the one that was wrong, not the bump. See the stage 5
Task 8 report (`.superpowers/sdd/05-tune-and-reconcile/task-8-report.md`) for the full account.
