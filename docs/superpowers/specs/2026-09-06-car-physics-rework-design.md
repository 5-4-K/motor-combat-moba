# Car Physics Rework — Design

**Date:** 2026-09-06
**Status:** Revision 2 approved. Stages 1 and 2 executed against revision 1 — see the changelog.
**Branch:** `feature/car-physics-rework`
**Plans:** [`docs/superpowers/plans/2026-09-06-car-physics/`](../plans/2026-09-06-car-physics/README.md)
— plus an `interfaces.md` ledger of every shared name.

## Changelog

**Revision 2 (2026-09-06) — the ram contest replaces mass and equal-and-opposite impulses.**

Revision 1 derived ram outcomes from `mass` and made contact impulses equal and opposite (P14).
Executing stages 1 and 2 measured what that produces, and the answer was that **every chassis is
thrown backwards faster than its own top speed for landing a ram** — Bastion 190 → −184.5 u/s,
Bullseye 223 → −304.5, Mirage 267 → −310.9, and Wild Charge −340.5, which is 1.8× its user's top
speed, backwards. That is not a tuning miss. It has two structural causes, both found by arithmetic
rather than by play:

1. `applyContact`'s restitution reflection treats another car as **immovable geometry**. It is
   mass-blind by construction, so an attacker rebounds off a car it outweighs three to one exactly as
   it would off a wall. P12 made *position* mass-weighted and left *velocity* alone.
2. `knockMaxSpeed` was authored as the **victim's** Δv under a one-way model. Charging the attacker
   the momentum-equivalent hands it a Δv of the same order — and the victim starts near rest while
   the attacker starts at top speed, so the same number reads as "launched" for one and "reversed"
   for the other.

A third problem surfaced alongside them: `mass` was one number doing five jobs (ram severity, impulse
scaling, positional separation, the `ramMass` status channel, and a displayed stat), so no aspect of
ramming could be tuned without moving the others — and ram power was additionally coupled to top
speed through `ramReference()`, which normalises against the *roster's fastest car*, so raising one
chassis's speed silently weakened every other chassis's rams.

Revision 2 removes `mass` entirely, replaces it with per-car `ramAttack` and `ramDefence`, and replaces
equal-and-opposite impulses with a **contest** between the two cars. See **R1–R11** below.

**What this does NOT invalidate.** All of stage 1 stands. So does most of stage 2: wall deflection,
`restitution: 0.15`, the `Impulse` struct and its single-applier seam, edge-triggered contact, and
`resolveWorld`'s fifth-parameter plumbing. What is superseded is named clause by clause below —
P12, P13's mass bullet, P14, P16, P17, P19, P20 and P28.

**P-numbers are stable.** Superseded clauses keep their numbers and point forward rather than being
renumbered, because plans, code comments and commit messages reference them by number.

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

**P7. Contact stats stay out of the drive model.** `drag` and `brakeDecel` are authored per chassis by
hand, *not* derived from any contact stat. Heaviness-while-driving is its own authored axis. `accel`
likewise stays an independent rating, so a solid chassis that launches well remains authorable.

*Revised by R1: this clause originally read "mass stays out of the drive model" and kept `mass` as a
pure contact stat. `mass` no longer exists; `ramAttack` and `ramDefence` replace it and are equally absent
from the drive model. The separation the clause protects is unchanged — how a car drives and how it
collides are authored independently.*

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

**P12. SUPERSEDED BY R8 — the mechanism stands, only the stat changes.** Car-car separation in
`resolveWorld` becomes **weighted by `ramDefence`** (originally: by mass). Today two overlapping cars
push apart equally regardless of chassis. Splitting the correction is a large, constantly present
solidity effect that applies to *every* contact — scrums, jostling, body-blocking a doorway — not
only to contacts that qualify as rams. A Bastion becomes something that cannot be shouldered aside.

**P13.** One shared applier, `applyImpulse(victim, impulse)`, does all of:

- adds the velocity change from R5 to the victim's velocity vector (originally `Δv = J / m`; superseded by R1/R5, since there is no `m`),
- adds spin derived from the contact-point lever arm (the existing `spinOf` technique, retained),
- applies the `reeling` status for the impulse's `uncontrolMs`,
- honours `retriggerImmunityMs`.

**P14. SUPERSEDED BY R4/R5/R7.** This clause required impulses to be equal and opposite, with
mass alone deciding the asymmetry. It was implemented in stage 2 and then measured: every chassis
ends up thrown backwards faster than its own top speed. See the changelog for why, and R7 for what
replaces it — each car's outcome is computed directly from the contest rather than as a negated copy
of the other's. The *intent* of P14 survives intact in R4: the lopsided car still barely slows while
the flimsy one still bounces off hard. Only the mechanism producing it changed.

**P15.** The victim's forward momentum is robbed **automatically**. Whatever component of the incoming
impulse opposes the victim's heading reduces its forward speed by vector addition; whatever is
perpendicular becomes the slide. No special-casing, and only a perfectly perpendicular hit leaves
forward speed untouched — which is correct.

**P16. SUPERSEDED BY R7 — but the rule underneath it survives and still matters.** There is no
longer a "reaction" to gate, because no car receives a negated copy of another's impulse. What this
clause protected is now expressed differently: a **detached** impulse source (an explosion, a shell)
has no car behind it, so it brings a push into the contest and receives nothing back. Only a contact
between two hulls is a two-sided contest.

## R1–R11: The ram contest (revision 2)

This section replaces the mass model. Where a P-clause below conflicts with an R-clause, **the
R-clause wins**.

**R1. `mass` is removed from the game.** `CarDef.mass`, `massOf`, `massPerRating`,
`RAM_REFERENCE_MASS`, `massFactorMin`/`massFactorMax`, `effectiveMassOf` and the `ramMass` status
channel all go. In its place, two per-car ratings:

- **`ramAttack`** — how hard this chassis hits. Affects **only** what it does to others.
- **`ramDefence`** — how solid it is. Affects what it resists, what it absorbs, and how hard it is to
  shoulder aside.

One number doing five jobs becomes two numbers doing one job each. That is the whole point: a
chassis can now be made to hit harder without also becoming immovable, and faster without hitting
harder.

**R2. Each car brings a `push` into a collision.**

```
push = (ramAttack × driveIn) + (ramDefence × defencePushScale)
```

`defencePushScale` is a single global constant. It answers "how much does a stationary car resist?"
Set it low and parked cars are nearly free hits; set it high and everything feels like hitting a
wall. It is the first knob to reach for when contact feels wrong.

The defence term is what stops a stationary victim being a *completely* free hit, and it is what
makes T-boning a Bastion cost more than T-boning a Bullseye — roughly seven times more at the
illustrative ratings, and nobody authored that number.

**R3. `driveIn` is the part of a car's own velocity directed into the impact**, along the contact
normal, **clamped at zero**.

Not raw speed: a car strafing past would otherwise "win" the contest without driving into anything.
Not closing speed either — closing speed is the *sum* of the two `driveIn` values, and the contest
needs them separately. A car driving *away* from the impact (you rear-ending it) contributes zero,
not a negative.

**R4. The two pushes compete. Your share of the contest is how badly you are losing it.**

```
yourShare = theirPush / (yourPush + theirPush)
```

Bring nothing and your share is 1 — you absorb everything. Bring as much as they do and it is 0.5.
Dominate and it approaches 0.

**R5. What each car takes:**

```
impact = theirPush × yourShare × faceBonus(the face YOU present) ÷ yourDefence × globalScale
```

Read plainly: *you take the other car's push, reduced by how much you are winning the contest,
adjusted for which of your faces got hit, and softened by your own solidity.*

**R6. The face bonus applies to the face each car presents to the impact**, not only the victim's.
`bonusFront` 0.3 / `bonusFlank` 1.0 / `bonusRear` 1.3, unchanged from P18.

This is the correction that makes head-ons work. In a head-on *both* cars present their nose, so both
are scored at 0.3 — your own nose is braced too, and revision 1 gave you no credit for that. In a
T-bone the victim presents its flank (1.0) while the attacker still presents its nose (0.3).

**R7. There is no equal-and-opposite reaction, and no `reactionOf`.** Each car's outcome is computed
directly from R5. The attacker is not handed a negated copy of the victim's impulse; it is simply the
car that happens to be winning the contest. A collision is one event evaluated once per car, which is
what stops the attacker being charged twice for it.

**R8. Positional separation is weighted by `ramDefence`, not mass** — otherwise identical to P12. The
plumbing built in stage 2 (`resolveWorld`'s fifth parameter, `CarObstacle`, both lockstep builders)
is unchanged; only the number feeding it changes.

**R9. Impact scales linearly with speed, and the gates ship inactive.** `minApproachSpeed` and the
ceiling remain as config, set so that neither binds, and are tuned later by feel.

This matters more than it sounds. Revision 1 expressed ram strength as a 0–1 fraction that saturated,
and two of the three chassis hit that cap on an ordinary full-speed rear ram — so speed differences
above the cap did **nothing**. Ram strength must therefore stop being a normalised fraction and
become an open-ended linear value with a high cap.

Dropping the minimum also collapses a distinction revision 1 needed: a gentle bump is simply a ram
with a low `driveIn`, so there is no separate "baseline versus ram" path to build.

**R10. `ImpulseDef.massScaled` becomes `defenceScaled`** — does the target's `ramDefence` reduce this
push? Ram: yes. A hard slam: no, it punts every chassis identically. Same escape hatch, same
reasoning as P28; only the stat it names changes.

**R11. Two consequences outside the sim.** `mass` is displayed to players on the car-select screen —
it is replaced there by `ramAttack` and `ramDefence`, which are more legible than mass was. And the
`ramMass` status channel becomes a **`ramDefence`** channel, since "harder to shove" is now what
defence means; there is deliberately no status channel for `ramAttack`, and adding one is a separate
decision.

### Worked outcomes

Illustrative ratings (Bullseye defence 30, Mirage 50, Bastion 90), a full-speed push of 200, and
`defencePushScale` set so a stationary mid-tier car brings roughly 10–15% of a full-speed car's push:

| collision | your share | you take |
|---|---|---|
| T-bone, you are the crossing victim | ~1.0 | 200 × 1.0 × **1.0** ≈ **356** |
| T-bone, you are the attacker (vs Bullseye) | ~0.1 | ≈ **1** |
| T-bone, you are the attacker (vs Bastion) | ~0.27 | ≈ **7** |
| Head-on, equal push | 0.5 | 200 × 0.5 × **0.3** ≈ **44** |
| Head-on, you stopped | ~0.85 | ≈ **74** |
| Head-on, them at speed | ~0.15 | ≈ **2** |
| Rear-end, you are the fleeing victim | ~1.0 | 200 × 1.0 × **1.3** ≈ **463** |

The properties that fall out without being authored: a head-on is far gentler than a T-bone
(~12% of it) while still hurting both cars; a stopped car takes more than one that drives into the
hit, but still well under a T-bone; the car winning the contest outright barely feels it; ramming a
tank moves it a third as far *and* costs you seven times more.

**A deliberate break, named.** Momentum is not conserved. A chassis with high `ramAttack` **and** high
`ramDefence` hits like a truck and barely feels it, and nothing in the model prevents that —
attack and defence are a power budget balanced by hand, where revision 1 had physics police it via
mass. That is the price of the control, and it is accepted knowingly (principle B).

**Defence is worth more than attack, and must be priced accordingly.** It appears twice — adding to
your push in the contest *and* dividing your received impact — so its effectiveness compounds while
attack's does not. This is what makes a tank feel like a tank; it is not a defect. But a point of
defence cannot be costed the same as a point of attack when setting the roster.

## P17–P25: Ram specifics

**P17. REFINED BY R3.** Ram outcome depends on both cars' motion along the contact normal, replacing
`approachOf`'s reading of the attacker's `speed` alone — which is what fixes "ramming a moving car
feels like nothing." R3 sharpens it: the two cars' `driveIn` components are needed **separately** for
the contest, not merely summed into a closing speed. Closing speed remains their sum.

**P18.** The side bonus is retained unchanged: `bonusFront` 0.3, `bonusFlank` 1.0, `bonusRear` 1.3.
Positioning stays the most important ram lever.

**P19. DELETED BY R1.** `massFactorMin`/`massFactorMax` do not survive the removal of mass. The
problem this clause identified — that both roster extremes clipped, so part of what the stat did was
being discarded — goes away with the clamps rather than being fixed by widening them.

**P20. STANDS, with a new derivation.** `SLAM_CONFIG.selfKeepFactor` is **deleted**. The attacker's
cost now falls out of the contest (R4/R5) rather than from equal-and-opposite impulses: a car that
wins its contest decisively takes almost nothing, which is the reduced self-cost this constant was
hand-tuning.

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

**P25a. SUPERSEDED BY R9 — the gate stays as a knob but ships inactive.** This clause originally
required `minApproachSpeed` to be re-derived against relative closing speed and the new top speeds
(60 against a 267 u/s roster being a materially different gate than 60 against 449).

R9 supersedes that: `minApproachSpeed` and the ceiling both **remain as config and are set so that
neither binds**, to be tuned later by feel. A gentle bump is then simply a ram with a low `driveIn`,
and linear scaling makes it come out small on its own — which is why revision 2 needs no separate
"baseline versus ram" path. The clause's underlying observation still holds and is why the value
cannot merely be carried across: a threshold authored against a 449 u/s roster means something
different against a 267 u/s one.

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

**P28. RENAMED BY R10 — `massScaled` becomes `defenceScaled`.** It remains the designer's escape hatch. `SLAM_CONFIG` states outright "No mass factor,
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
| `ramAttack` | 55 | 45 | 70 |
| `ramDefence` | 50 | 30 | 90 |

Time-to-top-speed rises 3–4× and now orders correctly — the tank is slowest to wind up. Turn radius
drops below one car length (48 u) on every chassis **with turn rates untouched**.

**The ram stats are named `ramAttack` and `ramDefence`, not `attack`/`defence`.** `CarDef.attack`
already exists and scales **weapon damage** (`damageFor` in `sim/damage.ts` and `sim/combat.ts`).
Reusing that name would silently couple a chassis's ramming power to its gun damage — precisely the
kind of hidden coupling revision 2 exists to remove.

`ramDefence` starts at the old `mass` ratings (90/50/30), which preserves today's solidity ordering
and makes the migration legible. `ramAttack` starts *flatter* than that on purpose: under the old
model, mass drove offence and defence together, so a Bastion hit hardest **and** was hardest to
shift. Splitting them is the point, and a flatter offence spread is the conservative first cut.

**Every value in this section is a placeholder pending a playground pass**, and `globalScale` below
more than any of them — it must be **measured**, not guessed, by driving the contest at a known
closing speed and comparing against the feel the old `knockMaxSpeed` produced on a victim. Setting it
from arithmetic alone is how revision 1 shipped a number that threw attackers backwards.

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

  -- revision 2: the contest (R1-R11). massFactorMin/massFactorMax are DELETED with mass.

defencePushScale    35        how much a STATIONARY car resists. The first knob to reach for when
                              contact feels wrong: low = parked cars are nearly free hits, high =
                              everything feels like hitting a wall. At 35 a stationary mid-tier car
                              brings ~12% of a full-speed car's push.
globalScale         TBM       converts a contest result into a delta-v. MEASURE, do not guess.
bonusFront          0.3       unchanged (P18). Applies to the face EACH car presents (R6).
bonusFlank          1.0       unchanged
bonusRear           1.3       unchanged
minApproachSpeed    0         ships INACTIVE (R9); a gentle bump is just a low-driveIn ram
ramImpactCeiling    (high)    ships INACTIVE (R9); must not be a normalised 0-1 fraction
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
- The exclusion of contact stats from the drive model (P7, R1). `ramAttack` and `ramDefence` are as absent
  from driving as `mass` was; how a car drives and how it collides stay independently authored.
- Wall and obstacle contact. R7 changes how two **cars** exchange velocity; a car against static
  geometry still reflects with `restitution` exactly as P9/P10 describe.
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
3. **Ram.** *Rewritten for revision 2.* The contest replaces equal-and-opposite: remove `mass`, add
   `ramAttack`/`ramDefence`, build `driveIn` and the share, re-weight separation by `ramDefence`,
   delete `reactionOf`. Then `reeling`, falloff, re-pitched spin.
4. **`ImpulseDef`.** The type, the seam, `SLAM_CONFIG` dissolution, wildcharge's row, `contact.ts`
   shrinking. `massScaled` becomes `defenceScaled` (R10).
5. **Tune and reconcile.** Playground passes on the starting values; `globalScale` **measured**;
   manual rebuild; playtest probe expectations; balance baseline. Also carries the deferred
   `dashSubstepMaxUnits` fix.

**Stage 3 is now large enough to split**, and probably should be: the stat model (remove `mass`, the
contest, undo equal-and-opposite) is a different body of work from ram feel (`reeling`, falloff,
tuning the bonuses), and stages 1 and 2 showed that four-task plans execute cleanly while larger ones
strain. Split by inserting `03b-`, never by renumbering — plans, code comments and commit messages
already reference these stage numbers.

Stage 1 is the one that cannot be partially landed — the schema, both halves of the lockstep, and
every reader of `speed` move together or nothing compiles.

**Stages 1 and 2 are executed.** Stage 2 landed equal-and-opposite reactions, which stage 3 now
undoes; that work is marked superseded in place rather than reverted, because its plumbing (the
`Impulse` seam, `resolveWorld`'s fifth parameter, edge-triggered contact) is what revision 2 builds
on.

## Flagged for confirmation

- **P22** — `reeling` leaves partial steering (×0.4) rather than locking it, to preserve countersteering
  as a skill, and sits at the existing `STATUS_LIMITS` floors rather than lowering them. If it turns
  out not to feel helpless enough in the playground, the honest options are a *longer* duration or a
  *bigger* impulse — not a lowered global clamp.
- Starting values, all of them. They are a coherent set to feel in the playground, not a balance pass.
- `wildcharge`'s `impulse.speed` (520) — carried across as a placeholder and explicitly expected to be
  wrong until re-pitched against the measured new ram maximum (P31).

Added in revision 2:

- **`globalScale` (R5)** — deliberately unset. It must be measured against the contest at a known
  closing speed, not derived. Revision 1's equivalent was derived and was wrong by 5×.
- **`ramAttack` / `ramDefence` starting spreads.** `ramDefence` inherits the old `mass` ordering;
  `ramAttack` is deliberately flatter. Whether offence *should* be flatter than defence is a feel
  question nobody has answered yet.
- **Defence compounding (R5).** `ramDefence` both adds to your push and divides your received
  impact, so it is worth more per point than `ramAttack`. Accepted knowingly, but if a Bastion
  proves unkillable the honest fix is pricing the roster, not weakening one of the two roles —
  the compounding is what makes a tank read as a tank.
- **Momentum is not conserved (R5).** A chassis high in both stats hits hard and barely feels it,
  and nothing prevents it. Attack and defence are a hand-balanced budget where mass used to be
  self-policing.
- **Head-on violence.** R6 makes a head-on roughly 12% of a T-bone at equal closing speed. Real
  head-ons carry ~2× the closing speed, so they land nearer 25%. If head-ons should be gentler still
  in practice, the lever is `bonusFront` below 0.3.
