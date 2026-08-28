# Motor Combat MOBA — Ram CC and Knockback Design

**Designed:** 2026-08-29 · **Recorded in repo:** 2026-08-29
**Status:** Designed. Not implemented.
**Follows on from:** [`2026-08-28-attack-stat-damage-formula-design.md`](2026-08-28-attack-stat-damage-formula-design.md)
S1, which deleted the ram subsystem and named this work as the condition for its return. Nothing in
S1 is reversed — R1 upholds its ruling that collision deals no damage.

---

## Problem

Cars are solid and can be driven into each other, but contact means nothing. Since `ffc072c` removed
collision damage, a car-vs-car impact produces only positional separation: `resolveAgainst` pushes
the moving car out of the overlap and `applyContact` damps its speed. There is no spin, no lateral
knock, and — the part that matters — **no follow-through.** Stop pressing forward and the car you hit
stops dead in the same tick. Ramming is not a mechanic; it is an obstacle-avoidance nuisance.

That was a deliberate state, not an oversight. S1 of the attack-stat spec retired ram as a *damage*
source and explicitly considered keeping the facing detection "for a future non-damage effect
(knockback, a stun, a screen shake)". It rejected that on the grounds that nothing asked for one and
"the code is recoverable from git the day something does". This spec is that day. Ram returns as
**control, not damage**.

The wider design this draws from — `docs/ideas/online-netcode-and-client-architecture-spec.md`, read
at the user's direction — reaches ram CC (its §6.7) through a full rigid-body rewrite: velocity
vectors, a two-point contact manifold, sequential impulse resolution with Coulomb friction, and a
whole-world `step(world, inputs, tick)` signature. That rewrite is roughly two to two-and-a-half
weeks of code and forces a matching netcode change, because impulse exchange cannot be predicted by a
client that interpolates its remotes.

This spec takes the other route. §6.7's severity model is expressed entirely in terms of **forward
velocity and mass** — the source spec says so outright when it warns "do not remove lateral velocity
from the impulse solve, only from this severity calculation". Forward velocity along the nose is
exactly what `SimBody.speed` already is. So the CC layer can be built now, on the existing
single-body resolver, and it sits unchanged on top of the impulse solver if that rewrite ever lands.

## Constraints

1. The hard invariants in `CLAUDE.md` hold: `TICK_RATE_HZ` lives once in shared, no magic numbers in
   logic, balance lives in shared config tables, `stepSim` is the lockstep imported by both server
   and client, anything `stepSim` reads is a networked schema field, max 6 players.
2. **`stepSim` keeps its single-body signature.** `stepSim(body, input, dt, ctx) -> SimBody` is
   consumed by `serverTick`, `PredictionBuffer.predict`, and `PredictionBuffer.reconcile`. Changing
   it is the restructure this spec exists to avoid.
3. **The existing drive and collision behaviour must be reproduced exactly** when no ram is in
   effect. Not "closely" — the existing `drive.test.ts` and `collide.test.ts` suites must pass
   without modification.
4. Ram is **server-only**, like combat. The client predicts its own motion and never computes an
   authoritative outcome.
5. `applyDamage` in `sim/damage.ts` stays the only place hp is ever reduced, and this feature does
   not call it.
6. The car hull stays 48x32 and `carHullOf` stays the single definition of car geometry.
7. `TICK_RATE_HZ` stays 30.

## Non-goals

- The impulse solver, the two-point contact manifold, Coulomb friction, restitution derived from
  impulse magnitude, or momentum conservation. This design produces a **tuned one-way knock**, not
  physics, and says so in its own comments.
- Mass-weighted push-out during ordinary driving. It would require widening `StepContext.others` to
  carry mass — a real interface change — and the mass-weighted shove already delivers the feel it
  would buy.
- Ram damage of any kind. See R1.
- Client-side prediction of the ram. See R16.
- Any change to the hull dimensions, the tick rate, the trig determinism story, or the drive model's
  scalar-`speed`-along-heading representation.
- Weapons, aim assist, friendly-fire rules for shots, respawn, or match flow.

---

## Decisions

### R1 — A ram deals control, never damage

A ram spins the victim, knocks them sideways, and degrades their steering. It costs zero hp and never
touches `applyDamage`.

This preserves what S1 bought. Weapons remain the sole damage source, so the `attack` rating keeps
meaning exactly what its name says, and the TTK matrix in the attack-stat spec stays valid without
recomputation. It also matches the source spec's §6.7, whose entire output is `ccTicks` and
`authority` — no damage term appears anywhere in it.

The intended loop: **ramming sets up the kill, weapons land it.** A player who wins a positional
exchange gets a window, not a health bar.

Rejected: severity-scaled ram damage, and small flat chip damage. Both re-open what S1 closed and
hand a low-`attack` chassis a damage route that bypasses the attack stat entirely, which would force
a roster rebalance around two damage sources.

### R2 — Ram is not combat, and gets its own seam

Ram runs between driving and combat, as its own pass:

```
ArenaRoom.update()
  serverTick(...)     drive + resolve, writes poses          unchanged
  ramTick(...)        detect contact, write motion state     NEW
  combatTick(...)     weapons, damage, win check             unchanged
```

Threading ram through `CombatInput`/`CombatResult` would recreate exactly the entanglement S1 called
out when it deleted "the per-pair `ramCooldowns` map threaded through `CombatInput`/`CombatResult`
and the server". Ram deals no damage, so it has no business in the damage step.

The ordering is a rule, not an implementation detail, and mirrors the one `combatTick` already
documents: ram reads the poses driving actually produced this tick, and writes motion state driving
will read on the next tick.

Module layout follows the existing shared-pure / server-bridge split:

| File | Role |
|---|---|
| `shared/src/sim/ram.ts` | Pure. Contact pair to per-car knock output. No schema, no room, no `MapSchema`. |
| `server/src/sim/ram-bridge.ts` | The schema half, exactly as `combat-bridge.ts` is for combat. |
| `shared/src/sim/collide.ts` | One new export (R3). One changed function (R13). |

`RamMemory` follows `CombatMemory`: room-owned state that lives across ticks and is deliberately
never networked.

### R3 — The contact normal is recovered from an inflated SAT test

`resolveWorld` computes a minimum translation vector for every contact and discards it. Ram needs
that direction. Recomputing it after resolution is not free, because resolution leaves colliding cars
separated to *exactly* touching, and `mtvBetween` treats touching as separated.

`obbsInContact` already solves this by inflating both hulls by a pad before testing. One new export
does the same and returns the vector:

```ts
export function contactNormalBetween(a: Obb, b: Obb, pad: number): Vec2 | null;
```

It is `mtvBetween` over the inflated pair, normalized, and `null` when they are not in contact.
Purely additive — `mtvBetween` and `inflate` already exist as private helpers.

**Sign convention, pinned here because it is the classic source of an inverted-CC bug: `n` points
from `b` toward `a`**, matching `mtvBetween`'s existing contract that its MTV moves `a` clear of `b`.
A test asserts the direction explicitly rather than inferring it.

### R4 — Detection is edge-triggered on fresh contact

For each unordered pair of on-field roster players, `obbsInContact(hullA, hullB, contactPad)`.
`RamMemory` holds the set of pairs in contact on the previous tick, keyed `"idA|idB"` with session
ids sorted. A ram fires only on the tick a pair **enters** contact; pairs still touching are skipped;
pairs no longer touching are dropped from the set.

One ram per contact episode. To ram again you must separate and re-approach, which is the skill
expression the mechanic wants.

Rejected: the deleted subsystem's `collisionDamageCooldownTicks: 15` timer. On a timer, holding the
throttle into a victim re-applies CC every fifteen ticks indefinitely, which is a stun-lock. Edge
triggering also carries less state — a set rather than a map of expiry ticks.

The severity floor (R6) is the real anti-chatter guarantee. If a pair chatters in and out of contact
by fractions of a unit, the second and subsequent triggers score near zero anyway: `applyContact` has
already rebounded the attacker to roughly -35% of its impact speed, so its approach term is negative.

### R5 — Attacker determination is graded, not thresholded

The source spec's §6.7:

```
approach_A = dot(A.vel, A.fwd) * dot(A.fwd, -n)
approach_B = dot(B.vel, B.fwd) * dot(B.fwd,  n)
```

`dot(A.vel, A.fwd)` is precisely `SimBody.speed` — the scalar velocity along the car's own heading.
No vector state is required. The higher approach is the attacker; if both fall below
`minApproachSpeed` there is no ram and nothing is written.

This is the deleted `isRamming` made continuous. That function asked
`dot(forward, toTarget) >= ramDotThreshold` and answered yes or no; this multiplies by the same dot
product instead of comparing against it, so `0.5` becomes a slope rather than a cliff.

Two properties carry over from the deleted version and are worth keeping deliberately:

- **A car shunted backwards into someone deals nothing.** Its `speed` is negative, or its nose points
  away, and either way `approach` is non-positive. The old code's comment was right that this is what
  makes "get behind them" a strategy rather than "be moving fastest".
- **Head-on hits resolve without a special case.** Both approaches are positive, the faster or
  heavier car wins the comparison, and the front-face bonus (R7) is low anyway, so neither car is
  meaningfully spun. Head-on ramming is not the play.

### R6 — Severity, and where it is clamped

```
severity = clamp01(approach * attackerMass / ramReference)
severity = clamp01(severity * sideBonus)
```

The **second clamp is this spec's addition** and is not in §6.7. Without it a rear hit multiplies an
already-saturated severity by 1.3, and every downstream interpolation overshoots its endpoint:
`lerp(1.0, authorityFloor, 1.3)` lands *below* the floor, defeating the constant whose entire purpose
is to be a floor. Clamping after the bonus keeps every consumer of `severity` inside its stated range.

`ramReference` is derived, never typed (see Numbers).

### R7 — Impact side is classified in the victim's local frame

```
n_local = rotate(n, -victim.angle)
|n_local.x| > |n_local.y|  ->  front (x > 0) or rear (x < 0)
otherwise                  ->  flank
```

Since `n` points from the victim toward the attacker (R3), `n_local.x > 0` means the attacker sits
off the victim's nose.

| Side | Bonus |
|---|---|
| Front | 0.3 |
| Flank | 1.0 |
| Rear | 1.3 |

The hull is 48 long by 32 wide, so front and rear are the narrow faces and the flanks are the long
ones — the geometry this table assumes. The source spec notes at its §6.1 that a 1.5:1 hull makes
front and flank hits occur at similar frequency and suggests 56x28; changing the hull is out of scope
here and would ripple into art fitting.

**This table is the primary balance lever of the whole feature.** It is what makes positioning
matter, and it should be expected to churn during playtest more than anything else in the Numbers
section.

### R8 — Outputs: authority, shove, and spin from a recovered contact point

One scalar drives all three outputs. `impulse` is expressed as a speed rather than as a true impulse,
because this is a tuned knock and not a momentum exchange (R9):

```
impulse   = severity * knockMaxSpeed
authority = lerp(1.0, authorityFloor, severity)
shove     = -n * impulse * victimMassFactor
spin      = clamp(cross(r_local, -n * impulse) / victimInertia * spinScale, +/- spinMaxRate)

victimMassFactor = clamp(ramReferenceMass / victimMass, massFactorMin, massFactorMax)
victimInertia    = victimMass * inertiaCoefficient
```

**Mass is counted once on each side, and the split is deliberate.** `severity` already carries the
*attacker's* mass (R6), so the attacker must not appear again here. The *victim's* mass enters only
where it physically belongs: the same impulse displaces a light car further and rotates it faster.
`victimMassFactor` is clamped so the lightest chassis cannot be launched absurdly far by the heaviest.

Note that `spin` divides by inertia while `shove` does not divide by mass directly — they use the
victim's mass through different terms because they answer different questions. `spinScale` absorbs the
unit mismatch that follows from `impulse` being a speed; it exists to be calibrated in playtest, not
to be derived.

**There is no `ccTicks` field.** §6.7 carries both a CC duration and an authority floor. A single
`authority` value that decays back toward 1.0 gets both from one number: a harder ram dips deeper and
therefore takes longer to climb back. That is one knob instead of two, one fewer networked field, and
it removes the question of what happens when a countdown and a floor disagree. If playtest wants
duration decoupled from depth, adding `ccTicks` later is purely additive.

**Spin comes from a real contact point, not a guessed direction.** Clamping the attacker's centre
into the victim's OBB in local frame — the same technique `circleOverlapsObb` already uses — yields
an approximate contact point `r_local`. The 2D cross product of that with the shove force is §6.5's
torque term evaluated at one point, without the solver. It behaves correctly by construction rather
than by tuning:

- A dead-centre nose hit gives `r = (-24, 0)` and `f = (+k, 0)`; the cross product is zero and there
  is **no spin**.
- A flank hit forward of centre spins the nose away from the attacker; aft of centre spins the tail
  away. Opposite signs, from geometry.

Inertia is the source spec's §5.5 formula, `m * (48^2 + 32^2) / 12`.

**Implementation note (added after the fact, see Numbers):** the `24` and `16` above are the half
of the 48x32 hull, shown as literals purely to illustrate the geometry. `ram.ts` does not type them:
`spinOf` derives the clamp bounds as `DRIVE_CONFIG.carWidth / 2` and `DRIVE_CONFIG.carHeight / 2`, and
`RAM_CONFIG.inertiaCoefficient` derives from the same two constants. Both must move with `carHullOf`
in lockstep, or the torque lever and the inertia it divides by would silently disagree about which
hull the ram actually collided against — typing them here would have created exactly that trap.

### R9 — The attacker receives nothing

No kickback term, no speed drain, no spin. The existing `restitution: 0.35` bounce in `applyContact`
already makes ramming cost the aggressor its momentum — a head-on into a stationary car leaves the
attacker travelling backwards at roughly 35% of impact speed.

Adding a second attacker-side term would stack two effects that do the same job, and during tuning
neither could be attributed. If ramming reads as weightless for the aggressor in playtest, this is
one constant to add.

**This design does not conserve momentum and the code comments will say so.** It is a one-way knock
derived from the attacker's forward momentum. Real exchange requires the impulse solver.

### R10 — Four new `SimBody` fields, and a bit-identical neutral state

```ts
angVel: number;     // rad/s, decays toward 0
shoveX: number;     // u/s, decays toward 0
shoveY: number;
authority: number;  // 1.0 = full control, decays back toward 1.0
```

`stepDrive` integrates them as **added terms**, never as replacements:

```
angle = body.angle + (input.steer * turnRate * authority + angVel) * dt
{speed, reverseHold} = nextSpeed(...)                    // untouched
x = body.x + (cos(angle) * speed + shoveX) * dt
y = body.y + (sin(angle) * speed + shoveY) * dt
```

then decay, with epsilon snaps to exact `0` and exact `1` following the pattern `stopEpsilon` already
establishes for `speed`.

**At neutral state the arithmetic is bit-identical to today.** Multiplying by `1.0` and adding `0.0`
are exact in IEEE-754, and `nextSpeed` is not touched at all. This is how constraint 3 is met: not by
careful porting, but by construction. It cannot silently fail, because the existing suites are the
assertion.

This is the same discipline the source spec asks for at its §14 phase 1 — "verify `LATERAL_KEEP = 0`
reproduces the old model" — obtained without the risk, because the old path is still the only path
when the new fields are neutral.

### R11 — Authority scales steering only

Not throttle, not braking. §5.6 of the source spec assigns each kind of knock a recovery route, and
"slowed" recovers through the throttle. A player must always be able to drive out of a knock even
while their steering is mush; taking both at once makes the victim a passenger, which is the failure
mode §6.7 warns about when it calls `AUTHORITY_FLOOR` "the feel dial".

### R12 — Countersteering bleeds the spin

```
if (input.steer * angVel < 0) angVel *= counterSteerDecay;
```

One line, one constant. Without it, `angVel` is an independent decaying term and steering can only
*offset* the visible rotation, never shorten it — recovery time would be fixed by `spinHalfLife` and
skill could not improve it. That forfeits the property §5.4 identifies as the reason the model is
worth having: "a skilled player recovers meaningfully faster."

This is the source spec's deferred "catch bonus" (§5.4, appendix) serving as the primary skill
expression rather than as a refinement.

### R13 — Shove reflects off surfaces, inside `applyContact`

`applyContact` reflects `v = forward * speed` along the contact normal with restitution. It is blind
to the shove components, so a shoved car driven into a wall would be re-pushed into it every tick and
pinned there by the clamp until the shove decayed.

The fix is inside `applyContact`: reflect the shove pair along `n` with the same restitution, beside
the existing speed logic. It is a no-op when `shove` is zero, so `collide.test.ts` passes unmodified.

**This is the only existing function in `collide.ts` that gains logic.** `resolveWorld`,
`clampIntoBounds`, `resolveBounds`, `resolveAgainst`, and `mtvBetween` change only to the extent that
they construct `SimBody` literals (R14). The single-body contract — "only the body moves" — is
untouched, and no impulse is exchanged anywhere.

### R14 — `SimBody` literals stay explicit

The functions in `collide.ts` that return a fresh body spell out every field. At nine fields, an
object spread would be shorter and would make the pass-through intent more legible.

They stay explicit anyway, for uniformity with the rest of the repo and because the explicit form
guarantees the returned object carries exactly `SimBody`'s fields and nothing a structurally-typed
caller happened to bring along.

Note for reviewers: TypeScript catches an *omitted* field, because these functions declare `SimBody`
as their return type. The residual risk the spread would have removed is narrower — writing
`angVel: 0` where `angVel: body.angVel` was meant, which compiles and produces a car that stops
spinning the instant it touches anything. Tests cover it (see Testing).

### R15 — Teammates are fully immune to ram

Gated by the existing `canDamage`, exactly as the deleted subsystem did, and for the reason its
comment gave: "shots and contact can never disagree about who is on your side."

Teammates still collide. They push each other out of overlap and damp each other's speed through
ordinary resolution, as they do today. They simply produce no spin, no shove, and no authority loss.

**Known accepted cost.** Friendly contact has no follow-through, so a teammate parked in a corridor is
a soft obstacle with no satisfying way to move them, and a heavy ally striking you at full speed
producing nothing is a visible physics inconsistency. The alternative considered was giving teammates
the shove but not the CC — physical response without the ability to disable an ally. It was rejected
in favour of the simpler rule. The gate is a single predicate call, so revisiting this after playtest
is a contained change.

### R16 — Server-authoritative, with the knock arriving as a snap

Ram is computed server-side only. The client never detects a ram for gameplay purposes.

All four fields join `speed` and `reverseHold` in `reconcile`'s always-snap set. The existing comment
is already the argument, written for this case: "a half-eased value would poison every subsequent step
rather than merely look wrong."

This is what makes an unpredicted ram viable rather than merely tolerable. The knock arrives as a
**one-time velocity and authority snap**, after which the client plays the entire spin-and-slide out
locally through its own `stepSim`. The client is not chasing server positions frame by frame during a
knock; it snaps the impulse once and predicts the rest.

**Honest cost.** For the roughly one RTT before that snapshot lands, the client has predicted
straight-ahead motion the server did not simulate. On a hard ram that divergence exceeds
`NET_CONFIG.reconcileSnapPos` (24 units) and the position snaps. On LAN this is one tick and
invisible. At 100-130 ms it is three or four ticks and visible.

The fix for that is the source spec's §9.1 — predict all six cars forward instead of interpolating
remotes — not a ram-specific prediction path. Building one now would need `StepContext.others` widened
to carry remote speed and mass, and the §9.1 work would then supersede it. This also matches §7.6,
which lists impact sparks under "predict immediately" and **CC application under "wait for server"**.

### R17 — Impact feedback is predicted; the knock is not

The client runs its own `obbsInContact` check for the local car against remote hulls and fires camera
shake and an impact spark the instant it detects contact. Render-only: nothing it computes reaches
`stepSim`, the schema, or the server.

This is §7.6's split applied to ramming. A ram that sparks immediately and knocks a moment later reads
as impact; one that does nothing for four ticks reads as a dropped input. A false positive costs a
spurious spark, which is unnoticeable.

### R18 — `mass` is a fourth free-floating rating; the budget is deleted with no replacement

`CarDef` gains `mass`, an integer 0-100 like the others, scaled by `massPerRating` exactly as `hp` is
scaled by `hpPerRating`. `massOf(id)` joins `hpOf` in `car-config.ts`.

The 150-point budget assertion at `config/config.test.ts` is **deleted**, at the user's direction. The
0-100 integer range checks stay and extend to `mass`.

Mass affects **ramming and nothing else** — never acceleration, never top speed. This is deliberate
and is the reason the rating has to be independent rather than derived from `hp`: the source spec's
§5.5 notes that a force-based drive makes heavy imply sluggish and collapses the archetype space to
one axis. Rate-based drive plus an independent mass rating is what permits a light bruiser or a heavy
glass cannon.

**What is lost.** The budget was the roster's only automatic guard against a fourth chassis being
authored strictly better than the three shipped ones; its own test comment said so. A dominance check
(no car greater-or-equal on all four ratings and strictly greater on one) was offered as a replacement
and declined. Roster fairness is therefore a review-time judgement from here on, and this paragraph is
the record of that being a choice rather than an oversight.

### R19 — Decay constants are authored in seconds, converted once at load

Every decay is a **half-life in seconds**, converted to a per-tick multiplier at config load:

```
perTick = 0.5 ** (1 / (halfLifeSeconds * TICK_RATE_HZ))
```

The source spec's constants assume 60 Hz; this project runs at 30. A per-tick decay of 0.6 authored
for 60 Hz yields half the wall-clock recovery time at 30 Hz, silently. Authoring in seconds makes the
table tick-rate independent, so the 60 Hz move contemplated in the source spec's §14 would not halve
every recovery time as a side effect.

This inverts, but follows, the source spec's §4.4 rule that all durations be converted once at table
load in shared code. `config/weapon-ticks.ts` already establishes the conversion pattern.

### R20 — Match start clears every knock field

`ArenaRoom` zeroes `player.speed` when a match begins. It must also zero `angVel`, `shoveX`, `shoveY`
and set `authority = 1`, or a spin survives into the next match — exactly what the surrounding comment
already promises will not happen.

`authority` defaults to `1`, not `0`, on `PlayerState` itself. A Schema numeric default of zero would
mean "no steering" for every player who has never been touched, which would present as a completely
undriveable car on first spawn. Pinned by a test.

---

## Numbers

All provisional, all expected to churn in playtest. Values marked **[D]** are computed from other
constants, never typed.

### Roster

`massPerRating: 10`, matching `hpPerRating`.

| Chassis | speed | attack | hp | mass | Top speed | Hull HP | Mass **[D]** |
|---|---|---|---|---|---|---|---|
| rectangle | 80 | 30 | 40 | 35 | 540 | 400 | 350 |
| oval | 50 | 70 | 30 | 45 | 405 | 300 | 450 |
| hexagon | 30 | 50 | 70 | 85 | 315 | 700 | 850 |

Identity: the hexagon is the tank and the best rammer; the rectangle is fast but light and rams poorly
for its speed; the oval is the gun. No chassis dominates another on all four ratings, though nothing
enforces that any more (R18).

### Ram

| Constant | Value | Notes |
|---|---|---|
| `contactPad` | 1 | Restored from the deleted `ramContactPad`, same value and same reason |
| `minApproachSpeed` | 60 | Below this a contact is a nudge, not a ram — about 11% of top speed |
| `ramReferenceMass` | 500 **[D]** | `massPerRating * 50` — the mass of an average-rated chassis |
| `ramReference` | 270,000 **[D]** | `ramReferenceMass * forwardMaxSpeedOf(fastest)` |
| `massFactorMin` | 0.6 | Floor on `victimMassFactor`, so the heaviest car is still movable |
| `massFactorMax` | 1.6 | Ceiling, so the lightest car is not launched absurdly |
| `bonusFront` | 0.3 | |
| `bonusFlank` | 1.0 | |
| `bonusRear` | 1.3 | **The most important number in the feature** |
| `authorityFloor` | 0.35 | The feel dial |
| `knockMaxSpeed` | 260 | Peak `impulse` at severity 1.0, before `victimMassFactor` |
| `spinScale` | 100 | Multiplier on the torque-derived rate, for calibration — see note below |
| `spinMaxRate` | 6.0 | rad/s ceiling, so a corner hit cannot produce absurd spin |
| `inertiaCoefficient` | 277.33 **[D]** | `(48^2 + 32^2) / 12` |
| `spinHalfLife` | 0.35 s | |
| `shoveHalfLife` | 0.25 s | |
| `authorityHalfLife` | 0.30 s | Gap to 1.0 halves at this rate |
| `counterSteerHalfLife` | 0.15 s | R12; roughly twice as fast as free decay |
| `spinEpsilon` | 0.01 rad/s | |
| `shoveEpsilon` | 1 u/s | |
| `authorityEpsilon` | 0.01 | |

**Post-implementation correction (2026-08-29): `spinScale` shipped as `100`, not the `1.0` this table
originally specified.** At `1.0` the spin channel was structurally inert: `torque / inertia` for a
solid flank hit lands in the low hundredths of a rad/s, an order of magnitude below `spinEpsilon`
(0.01) on some hits and nowhere near `spinMaxRate` (6.0) on the hardest — the hardest possible ram in
the game produced roughly 0.077 rad/s, about 2 degrees of total rotation before decay finished it off.
`spinScale` exists precisely to absorb the unit mismatch that follows from `impulse` being expressed
as a speed rather than a true impulse (R8's own text says as much), and `1.0` did not absorb it — it
left the mismatch in place. `100` was tuned in playtest so a solid flank ram lands near 2 rad/s while
the hardest possible ram saturates `spinMaxRate`, which is what R8's own commentary describes as the
intended feel. The half-extents `spinOf` clamps into are unaffected by this — see the implementation
note under R8.

### Worked severities

Ideal head-on approach, before the side bonus:

| Attacker | mass x top speed | Raw severity |
|---|---|---|
| hexagon | 850 x 315 = 267,750 | 0.99 |
| rectangle | 350 x 540 = 189,000 | 0.70 |
| oval | 450 x 405 = 182,250 | 0.68 |

A hexagon rear-ending at full speed: `clamp01(0.99 * 1.3)` = 1.0, so `authority` = 0.35 and `impulse`
is a full 260 u/s. Maximum CC in the game. The resulting shove depends on who was hit — a rectangle
(`victimMassFactor` = 1.43) is thrown at 372 u/s, another hexagon (clamped to 0.6) at 156 u/s.

The same hexagon hitting a front face: `0.99 * 0.3` = 0.297, so `authority` = 0.81 and `impulse` is
77 u/s. Head-on ramming is deliberately weak, which is what R5 predicts and §6.7 intends.

Travel from a shove is roughly `v * halfLife / ln 2`. At 372 u/s and a 0.25 s half-life that is about
134 units, or just under three car lengths — a decisive reposition, not a launch.

---

## Blast radius

**New:**

- `shared/src/sim/ram.ts` and `ram.test.ts` — the name returns, the contents do not.
- `shared/src/config/ram-config.ts`.
- `server/src/sim/ram-bridge.ts` and `ram-bridge.test.ts`.

**Changed:**

| File | Change |
|---|---|
| `shared/src/sim/step.ts` | Four fields on `SimBody`. |
| `shared/src/sim/drive.ts` | Additive terms, decay, R12. `nextSpeed` untouched. |
| `shared/src/sim/collide.ts` | `contactNormalBetween` export; shove reflection in `applyContact`; new fields carried through the explicit literals. |
| `shared/src/schema/PlayerState.ts` | Four `@type("number")` fields; `authority` defaults to 1. |
| `shared/src/config/car-config.ts`, `types.ts` | `mass` on `CarDef`, `massOf`. |
| `shared/src/config/config.test.ts` | Budget assertion deleted; range checks extended to `mass`. |
| `shared/src/index.ts` | New exports. |
| `server/src/sim/tick.ts` | `bodyOf` / `writeBody` carry four more fields. |
| `server/src/rooms/ArenaRoom.ts` | `ramTick` between `serverTick` and `combatTick`; match reset (R20). |
| `client/src/net/prediction.ts` | Four fields join the always-snap set. |
| `client/src/net/interpolation.ts` | `blendPose` carries the new fields. |
| `client/src/scenes/ArenaScene.ts` | `bodyOf` carries the new fields; local impact VFX (R17). |
| `client/src/ui/car-select-view.ts` | Mass stat row; ram rows restored from `ffc072c^`. |

**Explicitly unchanged:** `sim/damage.ts`, `sim/combat.ts`, everything under `sim/weapons/`,
`sim/context.ts`, `resolveWorld`'s single-body contract, `mtvBetween`, the arena definitions, and the
`stepSim` signature.

---

## Testing

The governing rule: **no existing test in `drive.test.ts` or `collide.test.ts` may be modified.** If
one needs changing, R10's neutral-state identity is broken, and that is a bug in the change rather
than a stale test.

1. **Neutral-state identity** — `stepDrive` and `resolveWorld` with `angVel = 0`, `shove = 0`,
   `authority = 1` produce output identical to the pre-change implementation. The existing 14 drive
   tests and 53 collide tests passing unmodified *is* this test; an explicit one pins it against a
   fixed pose table as well.
2. **Field pass-through** — every function in `collide.ts` returning a `SimBody` preserves all four
   new fields when it is not the one modifying them. This is the R14 residual risk, made explicit.
3. **Contact normal direction** — `contactNormalBetween(a, b, pad)` points from `b` toward `a`,
   asserted against a hand-placed pair, not inferred.
4. **Attacker determination** — the faster approach wins; a car shunted backwards deals nothing; a car
   whose nose points away deals nothing; both below `minApproachSpeed` yields no ram.
5. **Severity grading** — monotonic in approach and in mass; clamped at 1.0 before and after the side
   bonus; a rear hit at saturation does not overshoot `authorityFloor`.
6. **Side classification** — front, flank, and rear each asserted from a hand-placed pose, with the
   sign convention explicit. A ram to the rear produces more CC than the identical ram to the front.
6a. **Victim mass asymmetry** — the identical ram shoves a light chassis further than a heavy one,
   and `victimMassFactor` is clamped at both ends. Attacker mass must not appear twice: two rams with
   equal `severity` but different attacker masses produce the same `impulse`.
7. **Spin geometry** — a dead-centre nose hit produces exactly zero spin; a flank hit forward of centre
   and one aft of centre produce spin of opposite sign; spin is clamped at `spinMaxRate`.
8. **Edge triggering** — a pair held in contact across many ticks fires exactly one ram; separating and
   re-approaching fires a second.
9. **Teammate immunity** — a full-severity ram between teammates in team mode writes nothing, and the
   pair still separates, proving collision physics survived.
10. **Countersteer** — holding steer against a spin reduces `angVel` faster than coasting does.
11. **Authority scopes to steering** — a car at `authorityFloor` accelerates and brakes at unmodified
    rates.
12. **Shove reflects** — a car shoved into a wall rebounds rather than pinning; a car with zero shove
    behaves exactly as today.
13. **Reconciliation snaps** — all four fields snap rather than ease, asserted through
    `PredictionBuffer.reconcile`.
14. **Match reset** — a knocked car entering a new match has zeroed knock fields and `authority` of 1.
15. **Schema default** — a freshly constructed `PlayerState` has `authority === 1`.
16. **No hp moves** — two cars driven into each other at full speed through the real sim, at every
    impact side, both at full hp afterwards.

---

## Future work

- **Teammate shove without CC.** R15's rejected middle option. If friendly contact reads as mushy in
  playtest, this is the first thing to try; the gate is one predicate call.
- **Attacker kickback.** R9. One constant, if ramming reads as weightless for the aggressor.
- **`ccTicks` as an independent duration.** R8. Purely additive if depth-coupled duration proves too
  blunt.
- **Mass-weighted push-out.** Needs `StepContext.others` widened to carry mass. Would make heavy cars
  feel heavy during ordinary driving, not only on impact.
- **The impulse solver.** The source spec's §6.4 to §6.6. Everything in this spec — the severity model,
  the side bonus table, the mass ratings, the authority dial — sits on top of it unchanged, because
  §6.7 is explicitly a layer over the physics rather than part of it. What the solver would add is
  momentum conservation, friction, emergent spin from contact geometry, and correct flush side-by-side
  contact.
- **Hull ratio.** The source spec's §6.1 argues 56x28 over 48x32 to sharpen the flank-versus-front read
  that R7's table depends on. A hull change touches art fitting and is a `CLAUDE.md` stop-and-ask item.
- **A ram indicator.** With no damage number, the victim has no feedback about *why* they lost control.
  Currently covered only by R17's spark.
