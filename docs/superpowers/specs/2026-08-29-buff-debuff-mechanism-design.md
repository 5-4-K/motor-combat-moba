# Motor Combat MOBA — Buff and Debuff Mechanism Design

**Designed:** 2026-08-29 · **Recorded in repo:** 2026-08-29
**Status:** Implemented.
**Follows on from:** [`2026-08-29-ram-cc-and-knockback-design.md`](2026-08-29-ram-cc-and-knockback-design.md),
which established the impulse layer this deliberately does not duplicate.

---

## Problem

The game has no way to say "for the next three seconds, this car is different." Weapons remove HP,
ramming removes control for about a second, and neither leaves a trace. Everything that happens in a
fight is either instantaneous or permanent.

Future weapons and pickups are meant to apply temporary buffs and debuffs. **Neither exists yet, and
neither is in scope here.** What is in scope is the mechanism they will use, built and wired so that
authoring the first one is "name an effect", not "design an effect system."

---

## The game-design case

### D1. Effects are the duration layer, and the game is missing one

Three layers, and the game had two:

| Layer | Mechanic | Timescale | Counterplay |
|---|---|---|---|
| Damage | weapons | instant | positioning, cover, dodging |
| Impulse | ram knock | ~1 second, decaying | countersteer |
| **Duration** | **effects** | **1.5–5 seconds, flat then gone** | **disengage, wait it out, trade** |

An effect is what makes a moment into a *window*. Landing one is not itself the reward — the reward
is the several seconds afterwards, during which both players know the trade is skewed and both play
differently. That is a kind of decision the game currently cannot ask for.

### D2. Duration budget: 1.5 to 5 seconds

Bounded at both ends by what the game already is.

The floor: an effect must outlive the moment that applied it, or it is damage with extra steps. At
30 Hz with 20 Hz patches, anything under about half a second lands and lapses inside two patches and
reads as nothing at all.

The ceiling: an effect must expire inside one engagement, or it stops being a window and becomes a
state of the match. The roster is tuned so an average chassis kills another in about five seconds of
perfect accuracy — so five seconds is the whole fight, and it is the natural hard ceiling. Anything
longer means "you lost a fight thirty seconds ago and are still paying for it," which in a six-player
free-for-all is how a match ends up decided by its first engagement.

`effect-config.test.ts` asserts every row falls in `[1000, 8000]` ms — the wider bracket leaves room
for a deliberately long buff without letting a row drift into "permanent".

### D3. Every channel is a multiplier, never an additive term

The single most consequential decision, and it buys four things at once:

1. **Neutral is exactly reproducible.** A car carrying nothing multiplies every channel by 1, so
   `NEUTRAL_MODIFIERS` reproduces the pre-effect sim bit for bit. `golden.test.ts` pins that, exactly
   as it pinned the ram work's `angVel: 0` / `authority: 1`.
2. **Order-independence.** Multiplication commutes, so two effects landing in either order give the
   same number and no source has to know about any other.
3. **Diminishing returns for free.** Two 0.7 slows are 0.49, not 0.4. Each further source buys
   strictly less than the last, so a focus-fired car degrades toward a floor rather than through it.
4. **Proportional fairness across the roster.** A 25% slow costs the Rectangle (speed 80) more
   absolute speed than the Hexagon (speed 30), which is thematically right — the speedster has the
   most to lose from a slow — while costing both the same *fraction* of what they had.

### D4. Refresh by default; stack rarely; ignore for anything without a gradient

`refresh` is the legible rule: a car is either under an effect or it is not, and re-applying only
buys time. A player can read their own state from the badge and an opponent's from one glance.

`stack` compounds magnitude as well as time, so it rewards sustained pressure — but it is also how a
debuff becomes a snowball, so only one shipped row uses it and it caps at 2.

`ignore` is the anti-chain rule: a running effect cannot be re-applied at all and must expire first.
Every row that flips a boolean flag uses it, and `effect-config.test.ts` enforces that. Without it,
two attackers could hold one car permanently jammed between them.

### D5. Nothing takes the car away

A debuff may take the fight off you; it may not take the car off you. Three mechanisms enforce it,
and they are layered rather than alternatives:

- multiplication (D3) makes each further source cheaper to absorb;
- `EFFECT_CONFIG.maxActive` caps a car at six simultaneous effects;
- `EFFECT_LIMITS` clamps every channel after aggregation — at worst a car keeps half its top speed,
  40% of its steering, and can still shoot.

`topSpeed`'s floor of 0.5 is the load-bearing one. Below roughly half speed a car cannot disengage
from anything, so every slow past that point converts a fight into an execution. That is the ram
knock's job — bounded, visibly decaying, and countersteerable — and it should stay the only thing
that does it.

### D6. `immobilised` exists in the type and no row spends it

Hard CC is a car whose driver is watching. The game already has its answer for "take control away":
the ram knock, which is bounded, decays visibly, and can be fought with countersteer — a skill
expression, not a punishment. A debuff that merely zeroes the throttle has none of that.

The flag is implemented and tested so the sim honours it if a future design earns one. No row uses
it, and `effect-config.test.ts` asserts that, so shipping one is a deliberate act rather than a
config edit nobody notices.

### D7. `disarmed` jams the press, not the shot

`beginFire` spends the stock at press time because a wind-up cannot be cancelled. So a jam landing
mid-wind-up would eat the stock and produce nothing — a debuff that is *strictly worse the better
your timing was*, which is exactly backwards. Jam what has not been committed yet; let what has
finish.

### D8. Effects must work in FFA

Six-player FFA is the default mode, and it has no teammates. An effect system whose interesting half
is "buff your ally" would be dead content in the mode most matches are played in. So every shipped
row targets one car — self or enemy — and the teammate case is a *use* of the mechanism (a request
naming a teammate's session id), not a special path in it.

The corollary is about focus fire. In a six-way brawl the loser of any exchange is whoever three
people happen to be pointing at, and stacking debuffs make that worse superlinearly. D3's
multiplication and D5's clamps are what stop the mechanism from turning "everyone shoot that one" into
the dominant strategy.

### D9. `ramMass` is one channel, deliberately

A mass buff makes a car hit harder *and* harder to shift, because both read the same number
(`effectiveMassOf`). Splitting it into "ram power" and "ram resistance" would let a future weapon
author a pure upside; keeping it one channel means every mass buff carries a real trade — a heavier
car is a car that commits.

Mass touches ramming and nothing else in this game (never acceleration, never top speed — see
`RAM_CONFIG`'s note on why), so scaling it cannot leak into the drive model.

### D10. The badge strip is load-bearing, not decoration

**An effect a player cannot see is a bug they will report as the car feeling wrong.** A slow with no
badge reads as netcode. A damage buff with no badge reads as inconsistent weapon damage. Neither is
something a player can learn from, so neither can become skill.

Hence: one pill per effect in its own colour, a drain bar, a name, a stack count and a seconds
countdown. Debuffs lead (what is being done to you outranks what you picked up), soonest-lapsing
first within each group, ties broken on id so the strip cannot flicker, and the strip grows *upward*
so a badge does not move when another lapses beneath it.

---

## The technical case

### D11. `Modifiers` is the only type that reaches the sim

    PlayerState.effects -> toActiveEffects -> modifiersOf -> Modifiers -> stepDrive / resolveRam / runCombat

Driving, ramming and combat never look at an effect list. Adding an effect therefore touches no sim
code at all, and adding a *channel* touches exactly one call site — the one that reads it.

### D12. Modifiers live on `StepContext`, not `SimBody`

`SimBody` is integrated state: every field is written back each tick. Modifiers are not written back;
they are a fact about the rules this car is driving under, in the same way `others` is a fact about
where everyone else is. `StepContext` is where those live.

They are **required** rather than optional-with-a-neutral-default. `serverTick` and the client's
`buildStepContext` are the only two builders of a `StepContext`, they must describe the same tick, and
a default would let one of them silently forget while the other did not. The compiler is what keeps
the two halves of the lockstep honest, and a default would take that away.

### D13. The whole effect is networked — the one system with no server-only half

`FireState`'s `pending` machine, an instance's `damageClock`, the lock's commit timers: all off the
wire, because the client is told the result rather than the rules. An effect is the opposite case.
Invariant 8 says if `stepSim` reads it, it is a networked field, and `stepSim` reads the modifiers
derived from these rows. A car under a slow the client could not see would be mispredicted every tick
it lasted and snapped back by every patch.

`sourceSessionId` is the one field the sim does not read, and it is networked anyway: it keeps the
schema the *whole* truth about a car's effects rather than half of it beside a server-only map, and
retrofitting a source through every application site later would cost far more than the one string it
costs now. Kill credit and per-source diminishing returns are the two things that will want it.

### D14. Expiry first, application last, and the seam is one tick

    effectTick (expire + derive) -> serverTick (drive) -> ramTick -> combatTick (adds effects)

Expiry runs before anything reads a modifier, so no two phases can disagree about whether a car is
still slowed and no tick simulates an effect whose last tick was the previous one. New effects are
only ever *added*, at the far end of the tick, and take hold on the next one — the same one-tick seam
a ram knock already accepts.

That rule is uniform across both application seams, and it has to be: an on-hit effect cannot work
any other way (hits resolve last), so letting a room request bite immediately would mean two rules
instead of one. `runCombat` therefore reads every car's modifiers *before* applying this tick's
requests, so a crate and a shot arriving together cannot resolve differently depending on which the
room happened to queue first.

### D15. The clock is exclusive at the end, and both sides check it

`endsTick = tick + duration`; active while `tick < endsTick`. `expireEffects` drops it on the tick
that equals `endsTick`, and `modifiersOf` independently refuses to read it there. The server's sweep
is authoritative; the independent filter is what stops a client reading a 20 Hz patch from predicting
one or two ticks of an effect the 30 Hz server already dropped.

### D16. Outgoing damage freezes at spawn; incoming applies at impact

Deliberately asymmetric. A shot's cost is the shooter's business at the moment they fired, so
`damageDealt` is frozen into `instance.damage` alongside `ownerTeam` — a buff expiring mid-flight does
not un-power it, and `hits.ts` still never reads player state. How much a shot *hurts* is the target's
business at the moment it lands, so `damageTaken` applies at impact — which means armour applied while
a shot is in the air protects against it, and that is the whole point of applying armour under fire.

### D17. `weaponCooldown` scales the three refire clocks and not the shot's shape

`cooldown`, `refireDelay`, `recovery` — the three "when may I shoot again" clocks. Not `startUp` and
not `volleyInterval`: those are the shape of one press, and a haste buff that compressed them would
change what a weapon *is* rather than how often you get it.

It is a parameter to `tickRecharge` and `releaseShots` rather than a field on `FireState`, because an
effect can lapse mid-recharge and a multiplier baked in at press time would keep applying long after
its clock ran out.

### D18. Braking and drag are never scaled

Both are the car's ability to *stop*. A debuff that made a car harder to slow down would read to its
driver as the game taking the brakes away — the one input a player reaches for when they are already
in trouble.

### D19. Two application seams, both wired, neither used

- **`WeaponDef.onHit`** — effect ids a weapon puts on each car it **damages**. Keyed to the damage
  list rather than to contact, so it inherits every rule already there: friendly fire, the shooter's
  own immunity, wrecks, pierce, and the per-target damage clock that stops a beam re-applying every
  tick. A weapon that debuffs without hurting can author `damage: 0` — the effect rides the hit, not
  the number. Optional rather than required (unlike `usesAimAssist`): "this weapon also debuffs" is
  an addition, not a question every row must answer.
- **`CombatInput.effectRequests`** — the room's queue, for anything that is not a weapon. This is
  what a pickup system uses. A request rather than a direct write because `runCombat` owns the effect
  list for the duration of a tick, and it is the one combat input not backed by a table, so its id is
  validated even though it is typed.

### D20. At the cap, the new effect is dropped

`EFFECT_CONFIG.maxActive` is a wire guard (an unbounded `ArraySchema` is an unbounded patch) and a
design ceiling (six simultaneous rule changes cannot be read at a glance). At the cap a **new** id is
dropped rather than evicting a running one — so an attacker can never use a cheap effect to strip a
meaningful one off a target. Re-applying something already running is not a new id and is never
dropped.

### D21. A single row must be legal without the clamp

`EFFECT_LIMITS` is the backstop against many sources piling up. A row that needs it to be legal *on
its own, at full stacks* is a row whose authored number is a lie, so `effect-config.test.ts` asserts
every row lands inside its channels' limits unaided.

### D22. Effects are cleared, not expired, between matches

`clearInstances` sweeps them alongside the lock and the ram knock, so a car never spawns into a
countdown still carrying the slow that killed it last round. Effects only tick in `MATCH`, so
whatever was standing at the final tick would otherwise freeze and persist.

---

## What ships

Eight reference rows covering every channel and the one used flag — `overdrive`, `tarred`, `rattled`,
`primed`, `exposed`, `hardened`, `stoked`, `jammed`. **Nothing applies any of them.** They exist so
the mechanism has real rows to be tested and balanced against; retuning, renaming or deleting one
costs nothing while that stays true. See
[`../../config-reference.md`](../../config-reference.md#effect_table).

## Future work

- **Per-source diminishing returns.** `sourceSessionId` is already on the wire for it. The case for
  it is the focus-fire problem in D8; the case against doing it now is that no effect exists to
  observe the problem with.
- **An `onFire` list on `WeaponDef`**, for a weapon that buffs its own car when it shoots. Deliberately
  not built — `onHit` is the seam a future weapon actually asked for, and a second one should wait
  until something wants it.
- **Effect-driven visuals on the car itself** (a tint, a trail), rather than only the HUD badge. The
  badge is what makes the mechanism legible to the player driving; a world-space cue is what makes it
  legible to the player *shooting at* them.
- **Pickups**, which is the other half of the user's stated plan and the request queue's reason to
  exist.
