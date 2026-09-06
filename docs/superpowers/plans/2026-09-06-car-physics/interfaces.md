# Interfaces Ledger

Every name the five plans share. **This file outranks any individual plan and is outranked by the
spec.** If a plan's code contradicts a signature here, this file wins and the plan has a bug.

Stage in brackets is where the name first appears.

**Revised for spec revision 2** (2026-09-06 — the ram contest replaces `mass` and equal-and-opposite
impulses; see the spec's Changelog and R1–R11). Every entry below that named `mass`, a mass-derived
name, or `reactionOf` has been updated or removed accordingly. Anything still describing those names
elsewhere in an older plan file is stale — this ledger, not that plan, is authoritative.

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

## `CarDef` ram ratings [stage 3, revision 2]

`packages/shared/src/config/types.ts`. **`mass` is removed from `CarDef` entirely (R1)** — not
renamed, not kept as a display-only field. In its place, two ordinary 0–100 ratings (unlike the
direct values above, these ARE ratings):

```ts
/** How hard this chassis hits in a ram contest. Affects only what it does to OTHERS. R1/R2. */
ramAttack: number;
/** How solid this chassis is: what it resists, what it absorbs, how hard it is to shoulder aside. R1. */
ramDefence: number;
```

Starting values inherit `ramDefence` from the old `mass` ratings (90/50/30) to keep today's solidity
ordering legible through the migration; `ramAttack` starts deliberately flatter. See the spec's
"Starting values" table — every number there is a placeholder pending a playground pass.

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

## `CarObstacle` and `StepContext.selfRamDefence` [stage 2, field renamed by revision 2 / R8]

`packages/shared/src/sim/collide.ts` and `step.ts`

**The plumbing built in stage 2 is unchanged. Only the stat feeding it changes** (R8): `mass` is
gone, `ramDefence` takes its place, one-for-one.

```ts
/** One other car as the resolver sees it: where it is, and how hard it is to shove. */
export interface CarObstacle {
  hull: Obb;
  ramDefence: number;   // was `mass: number`
}
```

`resolveWorld` gains a fifth parameter and widens its third:

```ts
export function resolveWorld(
  body: SimBody,
  others: readonly CarObstacle[],   // was readonly Obb[]
  obstacles: readonly Aabb[],
  bounds: Bounds,
  selfRamDefence: number,            // NEW; was `selfMass`
): SimBody;
```

`StepContext` gains `selfRamDefence: number` beside `carId` (was `selfMass`). **Required, never
optional with a default.** Both builders — `serverTick` and the client's `buildStepContext` — must
supply it, and the compiler is what keeps the two halves of the lockstep from silently disagreeing
about who moves. Same reasoning the existing `modifiers` field's comment records; that reasoning is
unchanged by the rename.

## `Impulse` — the runtime struct [stage 2]

`packages/shared/src/sim/impulse.ts` — **new file.**

```ts
/** One push, fully resolved. Ram and weapons both build this; only how it LANDS is shared. */
export interface Impulse {
  /** Unit vector: the direction the victim is pushed. */
  dirX: number;
  dirY: number;
  /** Magnitude as a Δv in u/s, for a ram already the contest's output (R5) — BEFORE the victim's
   *  `ramDefence` is divided out, when `defenceScaled` says it should be. */
  speed: number;
  /** Torque scale from the lever arm. 0 = a clean punt with no rotation. */
  spin: number;
  /** Does the victim's `ramDefence` reduce the displacement? R10 — was `massScaled`. Ram: yes.
   *  A hard slam: no, it punts every chassis identically. */
  defenceScaled: boolean;
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
export function applyImpulse(body: SimBody, ramDefence: number, imp: Impulse): SimBody;
```

**`reactionOf` is deleted (R7).** There was a function here that handed the attacker a negated copy
of the victim's impulse, scaled by its own mass. Revision 2 removes it outright: there is no
equal-and-opposite reaction anymore. Each car's outcome — victim's and attacker's alike — is computed
directly from R5 (`theirPush × yourShare × faceBonus ÷ yourDefence × globalScale`), evaluated once
per car in the contest, not derived from the other car's result. If an older plan, comment, or task
description references `reactionOf`, it is describing the superseded P14 mechanism — delete the call
site rather than porting it.

`applyImpulse` is where the `÷ yourDefence` term of R5 is applied — conditionally, only when
`imp.defenceScaled` is true — and there is no min/max clamp on it: `massFactorMin`/`massFactorMax`
and `ramReferenceMass()` are **deleted** by R1, not widened or renamed. The contest itself
(`yourPush`, `theirPush`, `yourShare`, the face bonus) is computed by the caller — stage 3's ram
code — before an `Impulse` is constructed; `applyImpulse` only applies the Δv and spin it is handed,
divides by `ramDefence` when told to, and honours `retriggerImmunityMs`.

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

`attackerId` rides in the entry because stage 3's ram contest needs to know which car is on the other
side of each victim's outcome, and only `resolveRam` is in a position to say which of a pair was the
attacker. (Under revision 1 this fed `reactionOf`; under revision 2 it feeds the contest's `theirPush`
side instead — see R7. There is no reaction to apply anymore.)

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
  defenceScaled: boolean;   // R10 — was `massScaled`
  uncontrolMs: number;
  wallStun?: { windowMs: number; durationMs: number };
  retriggerImmunityMs?: number;
}
```

`uncontrolMs` and `wallStun`/`retriggerImmunity` durations convert to ticks **once**, in
`WEAPON_TICKS`, exactly as `applies[].durationMs` does today.

`defenceScaled` is the same escape hatch as before, renamed (R10): does the target's `ramDefence`
reduce this push? Ram: yes. `wildcharge`'s slam: no — it punts every chassis identically, which is
why its authored row sets this field `false`.

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

// DELETED (R1) — with `mass`, not widened to 0.5/2.0 as an earlier draft of this table said.
massFactorMin,
massFactorMax,

// ADDED (revision 2 — R2, R5)
defencePushScale: 35,      // how much a STATIONARY car resists (R2). First knob to reach for
                           // when contact feels wrong: low = parked cars are nearly free hits,
                           // high = everything feels like hitting a wall.
globalScale,               // converts a contest result into a delta-v (R5). TO BE MEASURED, not
                           // guessed — revision 1's equivalent was derived and was wrong by 5x.

// CHANGED
minApproachSpeed: 0,       // ships INACTIVE (R9) rather than re-derived — see spec P25a/R9
ramImpactCeiling,          // ships INACTIVE (R9); must NOT be a normalised 0-1 fraction — see below
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

**Ram strength stops being a normalised 0–1 fraction (R9).** Revision 1's `ramImpactCeiling` capped
the contest output at 1.0, and two of the three chassis hit that cap on an ordinary full-speed rear
ram — so speed differences above the cap did nothing. Revision 2 keeps `minApproachSpeed` and
`ramImpactCeiling` as config, both set so neither binds, and turns the output into an open-ended
linear value with a high cap instead. Do not author or read either gate as if it clamps a 0–1 share;
neither is meant to bind at the starting values.

## `SLAM_CONFIG` dissolution [stage 4]

| Old field | Becomes |
|---|---|
| `knockSpeed: 520` | `wildcharge.impulse.speed` — **re-pitch, do not carry across** (spec P31) |
| `victimAuthority: 0.35` | `wildcharge.impulse.uncontrolMs: 1400` |
| `selfKeepFactor: 0.7` | **deleted** — falls out of the contest, not mass (spec P20, R4/R5): a car winning its contest decisively takes almost nothing |
| `wallStunWindowMs` / `wallStunDurationMs` | `wildcharge.impulse.wallStun` |
| `reslamImmunityMs: 600` | `wildcharge.impulse.retriggerImmunityMs` |
| `wallContactPad: 1` | **stays** — a world constant, not a slam one |

The file survives holding only `wallContactPad`, and `SLAM_TICKS` disappears entirely.

## Names deleted by revision 2 (R1, R7)

These appeared in the "do NOT change" list against revision 1 and are now gone. If you find a
reference to any of these outside the spec's Changelog, it is stale:

- `CarDef.mass`, `massOf`, `massPerRating`, `RAM_REFERENCE_MASS`, `ramReference`, `ramReferenceMass`,
  `effectiveMassOf` — all removed with `mass` (R1). Replaced by `CarDef.ramAttack`/`ramDefence`, no
  direct successor function (the contest is built inline from R2–R5, not behind a single helper of
  the old shape).
- `massFactorMin`, `massFactorMax` — deleted, not widened (R1).
- The `ramMass` status channel — becomes a `ramDefence` channel (R11).
- `reactionOf` — deleted outright, no successor (R7). See the note under `applyImpulse` above.
- `SLAM_CONFIG.selfKeepFactor` — deleted; falls out of the contest (P20, R4/R5).

## Names that do NOT change

Guarding against well-meaning drift:

- `stepSim`, `stepDrive`, `resolveWorld`, `resolveContacts`, `resolveRam`, `applyContact`,
  `contactNormalBetween`, `carHullOf`, `impactSideOf`, `pairKey`.
- `RamCar`, `ContactCar`, `ContactHit`, `ContactEvents`, `RamHit`, `ImpactSide`.
- `driveOf`, `halfLifeToPerTick`.
- `stunned` and every flag it carries. `thunderclap`'s row in its entirety.
- The `bonusFront` / `bonusFlank` / `bonusRear` side-bonus table and its values (0.3 / 1.0 / 1.3) are
  unchanged (P18/R6) — but **what the bonus is looked up by** is not: R6 applies it to the face
  *each* car presents, not only the victim's, so `impactSideOf` (or whatever computes the looked-up
  face) is now called once per car in a contest, not once for the victim alone. The name survives;
  the call pattern around it does not.
- Edge-triggered contact: `previous`, `contacts`, and the "fires only on entering contact" rule.

`RamKnock` **does** disappear — stage 2 replaces it with `Impulse`.
