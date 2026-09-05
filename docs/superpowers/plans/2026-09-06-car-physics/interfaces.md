# Interfaces Ledger

Every name the five plans share. **This file outranks any individual plan and is outranked by the
spec.** If a plan's code contradicts a signature here, this file wins and the plan has a bug.

Stage in brackets is where the name first appears.

---

## `SimBody` — the shape after stage 1

`packages/shared/src/sim/step.ts`

```ts
export interface SimBody {
  x: number;
  y: number;
  angle: number;
  /** World velocity, units/second. REPLACES the old scalar `speed`. */
  vx: number;
  vy: number;
  reverseHold: number;
  /** Injected rotation, rad/s, decaying toward 0. Unchanged. */
  angVel: number;
  maneuver: number;
  maneuverTicksLeft: number;
  maneuverAngle: number;
  maneuverSpeed: number;
}
```

**Deleted:** `speed`, `shoveX`, `shoveY`, `authority`. Four fields out, two in.

`authority` is replaced by the `reeling` status (stage 3). `shoveX/shoveY` have no successor: any
lateral component of `vx/vy` *is* the imposed motion, because steering grip keeps the car's own
velocity aligned with its nose.

## Velocity helpers [stage 1]

`packages/shared/src/sim/velocity.ts` — **new file.** Pure, no imports from config.

```ts
/** Signed speed along the car's nose. Negative means reversing. */
export function forwardOf(vx: number, vy: number, angle: number): number;

/** Signed speed across the car's nose. Positive is to the car's left. */
export function lateralOf(vx: number, vy: number, angle: number): number;

/** Total speed regardless of direction. Always >= 0. */
export function speedOf(vx: number, vy: number): number;

/** Rebuild a world velocity from its two components in the car's frame. */
export function toWorld(
  angle: number,
  forward: number,
  lateral: number,
): { vx: number; vy: number };
```

These four are the only place the frame conversion is written. Nothing else in the codebase may
compute `cos(angle) * speed` by hand.

## `ChassisDrive` — the shape after stage 1

`packages/shared/src/config/car-config.ts`

```ts
export interface ChassisDrive {
  maxSpeed: number;
  reverseMaxSpeed: number;
  accel: number;
  reverseAccel: number;
  turnRate: number;
  turnRateAtStop: number;
  /** Per-tick multiplier on forward speed while coasting. Resolved from `coastHalfLifeSeconds`. */
  coastPerTick: number;
  /** Flat deceleration while the brake is held, u/s². Per-car as of this rework. */
  brakeDecel: number;
}
```

Resolved by `driveOf(carId)` exactly as today. `stepDrive` still never reads the roster.

## `CarDef` additions [stage 1]

`packages/shared/src/config/types.ts`

```ts
/**
 * DIRECT VALUES, NOT 0-100 RATINGS. The first two fields on this table that are not ratings —
 * do not scale them by anything.
 */
coastHalfLifeSeconds: number;
brakeDecel: number;
```

## `DRIVE_CONFIG` delta [stage 1]

`packages/shared/src/config/drive-config.ts`

```ts
// ADDED
steeringGrip: 1.0,        // 0-1. How completely velocity rotates with the heading. 1 = on rails.
impactGripDecel: 250,     // u/s². Rate imposed lateral velocity bleeds off.

// REMOVED
drag: 900,                // -> per-car CarDef.coastHalfLifeSeconds
brakeDecel: 1600,         // -> per-car CarDef.brakeDecel

// CHANGED [stage 2]
restitution: 0.15,        // was 0.35
```

## `PlayerState` delta [stage 1]

`packages/shared/src/schema/PlayerState.ts`

```ts
// REMOVED: speed, shoveX, shoveY, authority
@type("number") vx = 0;
@type("number") vy = 0;
```

Invariant 8 holds: `stepWorld`/`stepSim` reads both, so both are networked. Reconciled by **snapping,
not easing** — they feed the next integration, exactly as the old four were.

## `CarObstacle` and `StepContext.selfMass` [stage 2]

`packages/shared/src/sim/collide.ts` and `step.ts`

```ts
/** One other car as the resolver sees it: where it is, and how hard it is to shove. */
export interface CarObstacle {
  hull: Obb;
  mass: number;
}
```

`resolveWorld` gains a fifth parameter and widens its third:

```ts
export function resolveWorld(
  body: SimBody,
  others: readonly CarObstacle[],   // was readonly Obb[]
  obstacles: readonly Aabb[],
  bounds: Bounds,
  selfMass: number,                 // NEW
): SimBody;
```

`StepContext` gains `selfMass: number` beside `carId`. **Required, never optional with a default.**
Both builders — `serverTick` and the client's `buildStepContext` — must supply it, and the compiler
is what keeps the two halves of the lockstep from silently disagreeing about who moves. Same
reasoning the existing `modifiers` field's comment records.

## `Impulse` — the runtime struct [stage 2]

`packages/shared/src/sim/impulse.ts` — **new file.**

```ts
/** One push, fully resolved. Ram and weapons both build this; only how it LANDS is shared. */
export interface Impulse {
  /** Unit vector: the direction the victim is pushed. */
  dirX: number;
  dirY: number;
  /** Magnitude as a Δv in u/s, BEFORE the victim's mass is divided out. */
  speed: number;
  /** Torque scale from the lever arm. 0 = a clean punt with no rotation. */
  spin: number;
  /** Does the victim's mass reduce the displacement? */
  massScaled: boolean;
  /** How long the victim is left reeling, in TICKS (already converted). */
  uncontrolTicks: number;
  /** World-space contact point, for the lever arm. */
  contactX: number;
  contactY: number;
}

/**
 * Apply one impulse to one body: velocity and spin only.
 *
 * Deliberately does NOT apply the `reeling` status — that is not `SimBody` state. The caller
 * (`ram-bridge.ts`, `combat.ts`) applies it from `imp.uncontrolTicks`.
 */
export function applyImpulse(body: SimBody, mass: number, imp: Impulse): SimBody;

/** The reaction the ATTACKER takes: the same impulse negated, scaled by its own mass. */
export function reactionOf(imp: Impulse): Impulse;
```

`applyImpulse` is where victim mass enters and where `massFactorMin`/`massFactorMax` are applied —
read through `ramReferenceMass()`, never recomputed from `massPerRating` and a literal.

## `ImpulseEntry` — what the contact pass returns [stage 2]

`packages/shared/src/sim/contact.ts`. `resolveContacts` returns `impulses` as a
`Map<string, ImpulseEntry>` keyed by **victim** id, replacing the old `knocks: RamKnock[]` array.

```ts
export interface ImpulseEntry {
  attackerId: string;
  severity: number;
  impulse: Impulse;
}
```

`attackerId` rides in the entry because stage 2 Task 5 needs it to apply the reaction, and only
`resolveRam` is in a position to say which of a pair was the attacker.

## `RamCar` velocity [stage 3]

`RamCar.speed` becomes `vx`/`vy`, and `TickResult.approachSpeeds` (`Map<string, number>`) becomes
`approachVelocities` (`Map<string, { vx: number; vy: number }>`).

**It must still be the PRE-COLLISION value**, cached before `resolveWorld` runs. Passing the
post-resolution value once cost 80–90% of all rams and was only caught by a playtest probe.

## `RAM_TICKS` [stage 3]

`packages/shared/src/config/ram-config.ts`, mirroring the existing `SLAM_TICKS` and `WEAPON_TICKS`
pattern — authored milliseconds converted to whole ticks exactly once, at module load.

```ts
export const RAM_TICKS: Readonly<{
  uncontrol: number;
  drWindow: number;
  durationFloor: number;
}>;
```

Never recompute a tick count from milliseconds and a literal tick rate at a call site or in a test.

## `ImpulseDef` — the authored type [stage 4]

`packages/shared/src/config/weapon-types.ts`. Added to **both** `WeaponBase` and `ExplosionDef` as
`impulse?: ImpulseDef`, mirroring the existing `applies?: readonly StatusApplication[]` on both.

```ts
export interface ImpulseDef {
  speed: number;
  direction: "radial" | "alongAim";
  spin: number;
  massScaled: boolean;
  uncontrolMs: number;
  wallStun?: { windowMs: number; durationMs: number };
  retriggerImmunityMs?: number;
}
```

`uncontrolMs` and `wallStun`/`retriggerImmunity` durations convert to ticks **once**, in
`WEAPON_TICKS`, exactly as `applies[].durationMs` does today.

## `reeling` status [stage 3]

`packages/shared/src/config/status-config.ts`

```ts
reeling: {
  id: "reeling", name: "Reeling", kind: "debuff", color: "#e8590c",
  reapply: "refresh",
  modifiers: { turnRate: 0.4, accel: 0.4 },
  flags: [],
}
```

**`flags: []` is load-bearing.** `StatusDef` forces flag-carrying rows to `reapply: "ignore"` so hard
CC cannot be chained. Because `reeling` carries no flags it escapes that rule, which is what lets a
second ram write a new (already-reduced) duration — the thing falloff needs. Do not add a flag here
without re-reading spec P21/P22.

Both modifier values sit **at** the existing `STATUS_LIMITS` floors (`turnRate` 0.4, `accel` 0.4).
Do not lower those floors to make `reeling` harsher; see spec P22 for why.

## Ram falloff state [stage 3]

`packages/server/src/sim/ram-bridge.ts` — **server-side only, NOT a schema field.**

```ts
/** Per-victim diminishing-returns stack. Lives beside `slamImmuneUntil`, same shape, same reason. */
interface FalloffEntry {
  /** How many rams have landed inside the current rolling window. */
  count: number;
  /** Tick the window lapses. Each fresh ram pushes this out from itself. */
  expiresAtTick: number;
}
type FalloffStack = Map<string, FalloffEntry>;
```

This is **not** an invariant 8 violation: `stepSim` never reads it. It is consumed once, on the
server, at the moment a ram resolves, to scale the impulse and duration *before* they are applied.
The client receives the already-scaled result.

## `RAM_CONFIG` delta [stage 3]

```ts
// ADDED
ramUncontrolMs: 1000,
drWindowMs: 2000,
durationDrScale: 0.5,      // 1.0 disables duration falloff
durationDrFloorMs: 150,
impulseDrScale: 0.5,       // 1.0 disables impulse falloff
impulseDrFloor: 0.25,      // fraction of full impulse

// CHANGED
massFactorMin: 0.5,        // was 0.6
massFactorMax: 2.0,        // was 1.6
minApproachSpeed: ?,       // re-derived against the new top speeds — see spec P25a
spinScale: ?,              // re-pitched against momentum-derived impulses — see spec P25b
spinMaxRate: ?,            // ditto

// REMOVED
authorityFloor,            // -> the `reeling` status
authorityHalfLifeSeconds,  // -> ditto
authorityEpsilon,          // -> gone with authority
shoveHalfLifeSeconds,      // -> DRIVE_CONFIG.impactGripDecel
shoveEpsilon,              // -> gone with shove

// EXPLICITLY KEPT — both still govern `angVel`, which this rework never touches
spinHalfLifeSeconds,
counterSteerHalfLifeSeconds,  // the one constant that makes countersteering a skill
```

Removing the five above also means removing their entries from `RamDecay`, `resolveRamDecay`,
`RAM_DECAY`, `ramDecay()` and `rebuildRamDecay`. The two kept ones stay in all of those.

## `SLAM_CONFIG` dissolution [stage 4]

| Old field | Becomes |
|---|---|
| `knockSpeed: 520` | `wildcharge.impulse.speed` — **re-pitch, do not carry across** (spec P31) |
| `victimAuthority: 0.35` | `wildcharge.impulse.uncontrolMs: 1400` |
| `selfKeepFactor: 0.7` | **deleted** — falls out of mass (spec P20) |
| `wallStunWindowMs` / `wallStunDurationMs` | `wildcharge.impulse.wallStun` |
| `reslamImmunityMs: 600` | `wildcharge.impulse.retriggerImmunityMs` |
| `wallContactPad: 1` | **stays** — a world constant, not a slam one |

The file survives holding only `wallContactPad`, and `SLAM_TICKS` disappears entirely.

## Names that do NOT change

Guarding against well-meaning drift:

- `stepSim`, `stepDrive`, `resolveWorld`, `resolveContacts`, `resolveRam`, `applyContact`,
  `contactNormalBetween`, `carHullOf`, `impactSideOf`, `pairKey`.
- `RamCar`, `ContactCar`, `ContactHit`, `ContactEvents`, `RamHit`, `ImpactSide`.
- `massOf`, `driveOf`, `ramReference`, `ramReferenceMass`, `halfLifeToPerTick`.
- `stunned` and every flag it carries. `thunderclap`'s row in its entirety.
- The `bonusFront` / `bonusFlank` / `bonusRear` side-bonus table.
- Edge-triggered contact: `previous`, `contacts`, and the "fires only on entering contact" rule.

`RamKnock` **does** disappear — stage 2 replaces it with `Impulse`.
