# Car Physics Rework — Design

**Date:** 2026-09-06
**Status:** Approved, not yet implemented
**Branch:** `feature/car-physics-rework`
**Plans:** [`docs/superpowers/plans/2026-09-06-car-physics/`](../plans/2026-09-06-car-physics/README.md)
— five sequential stages, plus an `interfaces.md` ledger of every shared name.

## The problem

The cars drive like race cars. Every chassis reaches top speed in under 0.61 s and coasts to rest in
under 0.50 s; `drag` (900 u/s²) is two-thirds of `brakeDecel` (1600). There is no momentum anywhere
in the model, so nothing has weight.

Ramming compounds it. A ram writes a `shove` vector that is *added* on top of the victim's own drive
velocity and decays with a 0.25 s half-life; the victim's `speed` is never touched. A car doing 400
u/s that gets rammed keeps doing 400 u/s in its own direction with a fading sideways nudge. Severity
reads the attacker's speed alone — the victim's velocity is not in the equation at all — which is
why ramming a *moving* car reads as nothing happening. And the attacker pays nothing: `resolveRam`
returns one knock, addressed to the victim.

The target is battle cars: heavy, slow to wind up, carrying their momentum, but still precise to aim,
because turning **is** aiming. Contact should be the loud moment — victim thrown and spun, attacker
visibly bounced — bumper cars scaled up in mass with the impulse exaggerated well past life.

## Principles

**A. Physically-grounded mechanism, exaggerated values.** Keep the real structure — equal-and-opposite
impulses, contact-point lever arms, tyre saturation, abrupt grip recovery — and scale the magnitudes
past reality. A grounded mechanism is *predictable*, so players build correct intuitions and aiming
stays learnable. Realism is the skeleton, not the goal.

**B. Break realism deliberately, and say so.** Where physics fights the desired outcome, physics
loses — but the break is named in the design rather than discovered in the code.

**C. The rework governs driving and ramming. Weapons keep their authored behaviour.** A weapon is
allowed to act unphysically because that is what a weapon is for. This is what keeps the blast radius
finite. `thunderclap` is untouched by this work entirely.

**D. Shared plumbing, separate behaviour.** Ram and weapons derive their impulses completely
differently and share only how an impulse *lands*.

## Why one friction circle does not work here

The physically correct model is a single grip cap: below it the tyre holds and kills sideways motion,
above it the tyre saturates and the car slides. Normal cornering sits below; a T-bone blows past. One
number, both behaviours.

It fails at this game's numbers. Holding Mirage's turn at top speed demands **~3700 u/s²** of lateral
force (about 37 g — the cornering is arcade to the bone and has to be, or aiming dies). Bleeding a
ram's ~250 u/s of sideways velocity over one second needs **~250 u/s²**. Cornering demands fifteen
times more grip than ram recovery, so any single cap high enough to keep a car on rails through a
corner annihilates a ram's knockback in about 70 ms. In a real car both numbers sit near 1 g and the
friction circle works; here they are not close.

Hence **two independent knobs** (P3, P11). This is the largest deliberate physics break in the design
(principle B), and it is the one that delivers the whole brief at once: your own steering never
fights your momentum, but someone else's impact absolutely does.

---

## P1–P8: The drive model

**P1.** `SimBody.speed` (a scalar along the heading) becomes `vx, vy` — a true 2D velocity vector.
Everything else in this section follows from that.

**P2.** `shoveX`, `shoveY` and `authority` are **deleted**, not ported. Decompose `vx/vy` into the
component along the heading and the component across it. Steering grip (P3) keeps the car's own
motion aligned with its nose, so *any lateral component is by definition externally imposed* — the
separate shove vector has no job left. `authority` is replaced by the `reeling` status (P21).

**P3.** `steeringGrip` (0–1, `DRIVE_CONFIG`): how completely the velocity vector rotates with the
heading. At `1.0` velocity tracks the nose exactly — on rails, zero wash, precise aiming at any
speed. Below `1.0` it lags and the car washes wide. **Default `1.0`.** Wash is a knob, never a
consequence.

**P4.** Coasting deceleration becomes **per-car and speed-proportional**, authored as a half-life in
seconds. Reuses `halfLifeToPerTick` from `ram-config.ts`, which already does exactly this and is
tick-rate independent — so netcode phase 1 taking `TICK_RATE_HZ` 30 → 60 cannot silently halve it.
Speed-proportional gives the long lazy low-speed roll that makes heavy things read as heavy; the
current flat 900 u/s² stops a car dead from a crawl.

**P5.** `brakeDecel` becomes **per-car and stays flat**. A brake pedal is a constant force.

**P5a. Where the per-car values live.** `coastHalfLifeSeconds` and `brakeDecel` are authored on
`CarDef` as **direct values, explicitly not 0–100 ratings** — the first fields on that table that are
not ratings, and they must be commented as such or the next reader will scale them. They resolve into
`ChassisDrive` alongside the existing six, so `stepDrive` continues to read a resolved bundle and never
touches the roster (the property `golden.test.ts` exists to protect).

**P6.** Speed-proportional drag is asymptotic and never reaches zero. `DRIVE_CONFIG.stopEpsilon`
already exists for exactly this and snaps the last sliver to true rest.

**P7. Mass stays out of the drive model.** `drag` and `brakeDecel` are authored per chassis by hand,
*not* derived from `mass`. This preserves `ram-config.ts`'s documented decision intact — nothing is
reversed. Heaviness-while-driving becomes its own authored axis; mass remains a pure contact stat and
gains meaning through P12–P20 instead. `accel` likewise stays an independent rating, so a heavy
chassis that launches well remains authorable.

**P8.** Turn rates (`baseTurnRate`, `turnRatePerRating`, per-car `handling`) are **not changed by this
work**. Turn radius is `speed / turnRate`; cutting top speed ~40% drops every chassis to under one car
length of radius on its own. "Aiming gets easier" falls out of "make them slower" for free.

## P9–P16: Contact and impulse

**P9.** `applyContact` currently reflects the velocity correctly and then discards the direction,
re-projecting only the magnitude back onto the unchanged heading — the code comments state the
consequence outright: walls damp but never redirect. With `vx/vy` the reflection is **kept whole**.
Glancing a wall now slides you along it instead of grinding you to a halt still facing into it.

**P10.** `DRIVE_CONFIG.restitution` drops from `0.35` to **`0.15`**. Real cars have a coefficient of
restitution around 0.1–0.15 — a T-bone is a shunt, not a billiard shot. Knockback comes from momentum
transfer, not from bounce, and 0.35 is 2–3× too springy for the intended weight.

**P11.** `impactGripDecel` (u/s², `DRIVE_CONFIG`): the rate at which externally imposed lateral
velocity bleeds off. This and only this governs ram recovery. Wholly independent of P3 — see "Why one
friction circle does not work here".

**P12.** Car-car separation in `resolveWorld` becomes **mass-weighted**. Today two overlapping cars
push apart equally regardless of chassis. Splitting the correction by mass is a large, constantly
present heaviness effect that applies to *every* contact — scrums, jostling, body-blocking a doorway —
not only to contacts that qualify as rams. A Bastion becomes something that cannot be shouldered
aside.

**P13.** One shared applier, `applyImpulse(victim, impulse)`, does all of:

- adds `Δv = J / m` to the victim's velocity vector,
- adds spin derived from the contact-point lever arm (the existing `spinOf` technique, retained),
- applies the `reeling` status for the impulse's `uncontrolMs`,
- honours `retriggerImmunityMs`.

**P14.** **Impulses are equal and opposite.** A contact impulse applies `−J / m_attacker` to the
attacker. Because Δv scales as `J/m`, mass alone decides the asymmetry: a heavy Bastion ramming a
light Bullseye barely slows, while the reverse bounces the Bullseye off hard. This also *un-saturates*
the attacker side of ram severity, which is currently clamped flat for two of the three chassis.

**P15.** The victim's forward momentum is robbed **automatically**. Whatever component of the incoming
impulse opposes the victim's heading reduces its forward speed by vector addition; whatever is
perpendicular becomes the slide. No special-casing, and only a perfectly perpendicular hit leaves
forward speed untouched — which is correct.

**P16.** Reaction applies only when the impulse source is the attacker's own hull. A detached
explosion has nothing to react against.

## P17–P25: Ram specifics

**P17.** Ram severity is derived from **relative closing velocity** along the contact normal — both
cars' motion — replacing `approachOf`'s reading of the attacker's `speed` alone. This is the single
change that fixes "ramming a moving car feels like nothing."

**P18.** The side bonus is retained unchanged: `bonusFront` 0.3, `bonusFlank` 1.0, `bonusRear` 1.3.
Positioning stays the most important ram lever.

**P19.** `massFactorMin`/`massFactorMax` widen from `0.6/1.6` to **`0.5/2.0`**. Both roster extremes
currently clip (Bastion computes 0.56, Bullseye 1.67), so part of what mass does is being discarded.

**P20.** `SLAM_CONFIG.selfKeepFactor` is **deleted**. The attacker's cost now falls out of P14, and
Bastion at mass 90 naturally takes the smallest reaction on the roster — physics hands it the reduced
self-cost the constant was hand-tuning.

**P21. `reeling` is a new status, and it is not `stunned`.** `stunned` is
`immobilised + steeringLocked + disarmed + fullStop` — you stop dead and sit there, which is precisely
the bumper-car-that-stops behaviour this rework rejects. `reeling` carries **no `fullStop` and no
`disarmed`**: you are flung and sliding, not frozen, and you can still shoot. Being able to fight back
during the second gives the victim something to do and keeps ramming a setup rather than a delete.

Its complete definition:

```ts
reeling: {
  id: "reeling", name: "Reeling", kind: "debuff",
  reapply: "refresh",                    // a fresh ram writes a fresh duration (P24 scales it)
  modifiers: { turnRate: 0.4, accel: 0.4 },
  flags: [],                             // no fullStop, no disarmed, no immobilised
}
```

**`flags: []` is what makes `reapply: "refresh"` legal.** `StatusDef` forces flag-carrying rows to
`"ignore"` so hard CC can never be chained, with `chainable` as an escape hatch restricted to buffs.
Because `reeling` carries no flags it is not subject to that rule, so a second ram *can* write a new
(already-reduced) duration — which is exactly what falloff needs. P21's choice to keep `reeling`
flagless is therefore load-bearing for P24, not merely a feel decision.

**P22. The modifier values sit at the existing `STATUS_LIMITS` floors (0.4 / 0.4), deliberately.** An
earlier draft of this spec proposed 0.15 / 0.25; both are below the current floors and would have been
silently clamped. The fix is *not* to lower the floors. Those floors are documented guarantees — the
`spiked` row calls its own floor "the guarantee a car can always leave" — and widening a global clamp
to serve one row is how a guarantee quietly stops guaranteeing. Any future status would inherit the
looser bound.

`0.4 / 0.4` is enough, because **the helplessness comes from the physics, not from the debuff.** A car
sliding sideways at 250 u/s with its tyres saturated is already a passenger; the multipliers are the
friction-circle stagger on top, not the mechanism. That is principle A working as intended — the
mechanism does the work and the numbers only shade it.

Steering is reduced rather than locked so the countersteer-out-of-a-spin mechanic survives — the
constant `ram-config.ts` calls "the one constant that makes countersteering a skill." A hard lock
would kill it.

**P23.** Full-strength uncontrol is **1000 ms**, with an abrupt recovery snap rather than an
asymptotic fade — modelling the moment a saturated tyre regrips. Real physics on this arena's numbers
gives ~2.5 s and a slide of ~310 units (a quarter of the arena width); that is a deliberate
compression, not an oversight.

**P24. Falloff (diminishing returns) on successive rams.** Without it, coordinated attackers ram-lock
a victim.

- **Per-victim, global across all attackers.** The stack is a fact about the victim, not about a pair.
- **Rolling window.** Each ram pushes the window out from itself, so protection never lapses under
  sustained pressure. A fixed window would let an attacker who counts to 1.0 land full-strength rams
  forever — the exact lock being prevented.
- **Multiplicative with a floor.** Every ram always does something visible, so a late hit in a chain
  never reads as a whiff, and no immunity state is needed.
- **Duration and impulse fall off separately**, each with its own scale and floor. Setting either
  scale to `1.0` disables that half — no boolean required.
- **Ram only.** Weapon impulses do not participate and do not share the stack. A victim who is
  stunned, then rammed, then slammed is unfortunate; that is an accepted outcome of coordination.

**P24a. The falloff stack is server-side only and is NOT a schema field.** This looks like an invariant
8 violation and is not: `stepSim` never reads the stack. The stack is consumed once, on the server, at
the moment a ram is resolved, to scale the impulse and duration *before* they are applied. What the
client receives is the already-scaled result — a velocity change and a `reeling` status with a
concrete duration — both of which are networked already. It lives beside `slamImmuneUntil`, which is
the same shape of server-side per-victim map for the same reason.

**P25.** Edge-triggered contact is retained unchanged. A ram fires only on the tick a pair *enters*
contact, so holding the throttle into someone lands one knock. This already does part of the anti-lock
job; P24 covers what it does not.

**P25a. `minApproachSpeed` is restated against relative closing velocity.** It currently gates on the
attacker's own speed (60 u/s, about 11% of the roster's top speed) and its doc comment reasons about
the post-collision rebound making the approach term negative. Under P17 it becomes a threshold on
*relative* closing speed, and it must be re-derived against the new top speeds rather than carried
across — 60 against a 267 u/s roster is a materially different gate than 60 against 449.

**P25b. `spinScale` and `spinMaxRate` are retained but re-pitched.** The lever-arm torque technique in
`spinOf` is kept as-is (P13). Both constants were calibrated by feel against an impulse expressed as a
capped 260 u/s speed; once impulses come from momentum transfer, neither value means what it did.
`spinMaxRate` (6.0) in particular is a ceiling that a much larger impulse will now saturate routinely.

## P26–P31: The `ImpulseDef` seam

**P26.** `impulse?: ImpulseDef` is added to **`WeaponBase` and `ExplosionDef`**, mirroring the existing
`applies?: readonly StatusApplication[]` on both. Optional, so no shipped row changes shape.

```ts
export interface ImpulseDef {
  /** Magnitude, world units/s. Negative pulls the victim toward the source. */
  speed: number;
  /** "radial" = away from the source point. "alongAim" = the shot direction. */
  direction: "radial" | "alongAim";
  /** Torque scale from the contact-point lever arm. 0 = a clean punt, no rotation. */
  spin: number;
  /** Does victim mass reduce the displacement? Ram: yes. Slam: no. */
  massScaled: boolean;
  /** How long the victim is left reeling. Converted to ticks once in WEAPON_TICKS. */
  uncontrolMs: number;
  /** Being driven into level geometry by this impulse stuns. */
  wallStun?: { windowMs: number; durationMs: number };
  /** A car pushed by this cannot be pushed by it again within this. */
  retriggerImmunityMs?: number;
}
```

**P27.** `direction` has two modes. `radial` pushes away from a source point through the victim, where
the source point is **derived from the weapon's own geometry** — the attacker's hull for a contact
impulse, the blast centre for an explosion, the impact point for a shell — never declared. `alongAim`
punches every target the same way instead of splaying them, which is what a shotgun wants. Negative
`speed` gives pull weapons for free.

**P28.** `massScaled` is the designer's escape hatch. `SLAM_CONFIG` states outright "No mass factor,
no side bonus," while ram has both; the def must express either. This field is where principle C
becomes a checkbox instead of a special case.

**P29.** The side bonus is **not** part of `ImpulseDef`. Front/flank/rear is a positioning reward
specific to ramming; a weapon has no business caring which face it strikes. Ram keeps it internally
(P18). Falloff is likewise ram-only (P24) and absent from the def — one optional field to add later if
that changes.

**P30.** Impulses are applied **where statuses are applied**, not inside the contact pass. Today
`contact.ts` builds a `RamKnock` inline in the middle of its pair loop; it already emits
`slams: ContactHit[]` events, so the plumbing exists. Deleting the inline knock-building makes
`contact.ts` **smaller**.

**P31.** `SLAM_CONFIG` dissolves: `knockSpeed` → `impulse.speed`, `victimAuthority` → `uncontrolMs`,
`selfKeepFactor` → deleted (P20), `wallStun*` → onto the def, `reslamImmunityMs` →
`retriggerImmunityMs`. Only `wallContactPad` survives, and it is a world constant rather than a slam
one. **Authored on `wildcharge` only** in this work; `magmablast` is deferred until the feel is
confirmed in the playground. Wildcharge's punt stays **fixed rather than speed-scaled** — a slam is a
slam, protecting a 20-second ult from a bad approach (principle C).

Its authored row, as the one worked example:

```ts
impulse: {
  speed: 520,            // re-pitch against the new ram maximum, see below
  direction: "radial",
  spin: 0,               // a clean straight punt is what distinguishes an ult from a scrape
  massScaled: false,     // SLAM_CONFIG: "No mass factor, no side bonus"
  uncontrolMs: 1400,     // longer than a full-strength ram's 1000
  wallStun: { windowMs: 500, durationMs: 500 },
  retriggerImmunityMs: 600,
}
```

**`speed: 520` is the number most likely to be wrong and least likely to be noticed.** It was authored
as "2× `RAM_CONFIG.knockMaxSpeed`" — the config comment says so — and that relationship is by hand, not
derived. Once ram impulses come from momentum transfer instead of a capped 260, nothing fails and
Bastion's 20-second ult can quietly end up weaker than an ordinary flank ram. It must be deliberately
re-pitched against the measured new ram maximum, not carried across.

`spin: 0` is a decision, not an omission. Every other impact in the new model spins the victim via the
lever arm, so a slam that punts in a dead-straight line will read as inconsistent unless it is
understood as the ult's signature.

---

## Starting values

Not final; every one is live-tunable in `?dev=playground`, which already covers `DRIVE_CONFIG`,
`RAM_CONFIG` and `CAR_TABLE`.

| | Mirage | Bullseye | Bastion |
|---|---|---|---|
| Top speed | 267 *(was 449)* | 223 *(was 375)* | 190 *(was 320)* |
| 0 → top speed | 1.5 s *(was 0.44)* | 1.8 s *(was 0.61)* | 2.2 s *(was 0.57)* |
| Coast half-life | 1.2 s | 1.0 s | 1.5 s |
| Brake decel | 500 | 520 | 430 |
| Turn radius | 33 u *(was 55)* | 31 u *(was 53)* | 30 u *(was 51)* |

Time-to-top-speed rises 3–4× and now orders correctly — the tank is slowest to wind up. Turn radius
drops below one car length (48 u) on every chassis **with turn rates untouched**.

Global:

```text
steeringGrip        1.0       on rails; lower for wash
impactGripDecel     250       u/s^2, imposed lateral bleed
restitution         0.15      was 0.35
ramUncontrolMs      1000      full-strength reeling from a RAM (weapons author their own)
drWindowMs          2000      rolling
durationDrScale     0.5       1.0 disables duration falloff
durationDrFloorMs   150
impulseDrScale      0.5       1.0 disables impulse falloff
impulseDrFloor      0.25      fraction of full impulse
massFactorMin       0.5       was 0.6
massFactorMax       2.0       was 1.6
```

## Invariants restated

- **Invariant 8** ("if `stepSim` reads it, it is a networked schema field") is unchanged in force.
  Net effect on the wire: `speed, shoveX, shoveY, authority` (4) → `vx, vy` (2). The rework *removes*
  two networked fields; `reeling` rides the existing `StatusState` array.
- `config.test.ts`'s `brakeDecel > drag` ordering becomes **per-car** and is evaluated where drag is
  strongest: `brakeDecel > coastRate × maxSpeed`. Stricter than the current check.
- `CAMERA_CONFIG.freeRoamSpeed` (1050) must still exceed the fastest car. It does trivially now, and
  should come down alongside the speed cut or free-roam spectating will feel unmoored.

## What this does NOT change

- **`thunderclap`** — untouched entirely. No impulse, no `reeling`, `stunned` stays. It is a weapon
  whose effect is a status applied on contact, not a contact mechanic (principle C).
- **`stunned`** — its flags, its `reapply: "ignore"`, and every existing source of it.
- Turn rates, `handling`, `accel` ratings (P8, P7).
- The `mass` rating's exclusion from the drive model (P7).
- Friendly fire, targeting, `canDamage`, damage, HP, or any weapon's damage numbers.
- Edge-triggered ram contact (P25).

## Obligations this work incurs

1. **`golden.test.ts` refixtured.** Its job is pinning the drive integration against a frozen fixture;
   a deliberate rewrite of that integration re-pins it by design. Note the cost honestly: the fixture
   that would have caught an *accidental* change is regenerated here.
2. **`docs/turn-tuning.md` rewritten** in the same commit. `scripts/turn-tuning-doc.test.mjs`
   recomputes every cell from built shared and fails until the page agrees. New per-car `drag` and
   `brakeDecel` need columns. Its prose also argues from figures inside sentences, which the test
   cannot see — re-read it even when the suite is green.
3. **`npm run build:manual`.** `CAR_TABLE` gains fields and `WEAPON_TABLE` gains `impulse`, so
   `balanceStamp` moves and `scripts/manual-page.test.mjs` fails until the guide is rebuilt.
4. **Playtest probes.** `packages/server/playtest/` measures ram trigger rates, collision depth,
   weapon reach and prediction error against the real pipeline. Every one of those is invalidated by
   this work, and several will no longer compile. Compile breaks get fixed on the spot; thresholds
   and expectations are the user's call.
5. **Balance harness.** Config fingerprint moves, so no existing baseline is comparable. Bot
   fingerprint is unaffected.
6. **Bot.** `bot/brain/aim.ts` and `perception.ts` reconstruct velocity as `cos(angle) * speed` and
   therefore cannot currently lead a shoved or drifting car. With `vx/vy` both get shorter and more
   correct. This is a bot behaviour change without a `BOT_PROFILES` move, so `BOT_BRAIN_VERSION`
   must be bumped.
7. **Netcode sequencing.** Phase 1 raises `TICK_RATE_HZ` to 60 and phase 2 hand-packs the snapshot
   that carries these very fields. Authoring durations in milliseconds (P4, P23) is what makes this
   work survive phase 1. Phase 2 overlaps directly and needs sequencing or a deliberate merge.

## Suggested sequencing

Five stages, each ending somewhere the game is playable. The order is chosen so the riskiest change
lands first while the suite still has its old fixture to argue with, and so the feel can be judged
before the weapon seam is built on top of it.

1. **Vector drive.** `vx/vy` replaces `speed`; `shove`/`authority` deleted; steering grip; per-car
   proportional drag and brake. Schema, prediction, interpolation, bot velocity reads.
   `golden.test.ts` refixtured, `turn-tuning.md` rewritten. Ends with cars that drive heavy and aim
   well, with ramming temporarily degraded.
2. **Contact and impulse.** Whole-reflection walls, restitution, mass-weighted separation,
   `applyImpulse`, equal-and-opposite reactions. Ends with contact that reads correctly.
3. **Ram.** Relative closing velocity, `reeling`, falloff, widened clamps, re-pitched spin. Ends with
   the ramming feel the brief asks for.
4. **`ImpulseDef`.** The type, the seam, `SLAM_CONFIG` dissolution, wildcharge's row, `contact.ts`
   shrinking. Ends with weapons able to push.
5. **Tune and reconcile.** Playground passes on the starting values; manual rebuild; playtest probe
   expectations; balance baseline.

Stages 1 and 3 are each large enough to warrant their own plan. Stage 1 is the one that cannot be
partially landed — the schema, both halves of the lockstep, and every reader of `speed` move together
or nothing compiles.

## Flagged for confirmation

- **P22** — `reeling` leaves partial steering (×0.4) rather than locking it, to preserve countersteering
  as a skill, and sits at the existing `STATUS_LIMITS` floors rather than lowering them. If it turns
  out not to feel helpless enough in the playground, the honest options are a *longer* duration or a
  *bigger* impulse — not a lowered global clamp.
- Starting values, all of them. They are a coherent set to feel in the playground, not a balance pass.
- `wildcharge`'s `impulse.speed` (520) — carried across as a placeholder and explicitly expected to be
  wrong until re-pitched against the measured new ram maximum (P31).
