# Motor Combat MOBA — Status Mechanism Design

**Designed:** 2026-08-29 · **Recorded in repo:** 2026-08-29
**Status:** Implemented.
**Follows on from:** [`2026-08-29-ram-cc-and-knockback-design.md`](2026-08-29-ram-cc-and-knockback-design.md),
which established the impulse layer this deliberately does not duplicate.

---

## Problem

The game had no way to say "for the next three seconds, this car is different." Weapons removed HP,
ramming removed control for about a second, and neither left a trace. Everything in a fight was
either instantaneous or permanent.

A **status** is a named, timed condition a car can be in. `STATUS_TABLE` says what being in one does;
whatever applies it says how long. Weapons and (later) pickups apply them.

---

## The game-design case

### D1. Statuses are the duration layer, and the game was missing one

| Layer | Mechanic | Timescale | Counterplay |
|---|---|---|---|
| Damage | weapons | instant | positioning, cover, dodging |
| Impulse | ram knock | ~1 second, decaying | countersteer |
| **Duration** | **statuses** | **0.7–4 seconds** | **disengage, wait it out, trade** |

Landing a status is not itself the reward — the seconds afterwards are, during which both players
know the trade is skewed and play differently. That is a kind of decision the game could not ask for.

### D2. The status does not own its duration

The single most consequential structural decision, and it came from the design side rather than the
code. `STATUS_TABLE` says what being spiked *does*; the weapon says how long it spikes you for.

Without it, every weapon wanting "a shorter slow" would force a near-duplicate row, and the roster
would grow one status per (effect × duration) pair. With it, a ticking flamethrower and a heavy
one-shot can share `overheated` and mean different things by it.

Two consequences fall out. `applyStatus` takes an explicit `durationTicks` and refuses a non-positive
one outright rather than clamping — zero means the applier is misconfigured, and a status that lands
for one tick reads as one that never landed. And `startTick` has to be networked, because the total
is no longer recoverable from the table and the HUD's drain bar needs it.

### D3. A status never stacks with itself; different statuses do stack

One id on one car is exactly one instance at exactly the strength its row states. That killed the
`stacks` field, `maxStacks`, and a whole stacking mode.

Different statuses touching the same channel stack by **multiplication**: a 5% slow and a 10% slow
are 14.5% together, not 15%. Each further source buys strictly less than the last, so a focus-fired
car degrades toward a floor rather than through it, and composition is order-independent so no source
has to know about any other.

### D4. Re-application is per row: `ignore` by default, `refresh` for lingering sources

`ignore` — nothing happens, not even the clock — is the anti-chain rule, and every row that flips a
flag is required to use it. Two attackers cannot hold one car stunned between them.

`refresh` exists because of a specific trap found while designing the aura: with `ignore`, a car
standing inside a lingering field would watch the status lapse and re-arm on a loop, which reads as a
flicker rather than as a condition. `refresh` extends the clock and **never shortens it**
(`max(existing, now + duration)`), so a weak short source cannot cut a long one down, and it leaves
`startTick` alone so the pulse cadence is not restarted.

### D5. Overheat makes a car twitchy, not sluggish

Reducing `turnRate`, `accel` and `topSpeed` makes a car **sluggish** — easy to control and merely
slow. That is the boring failure mode, and it was what the channel set could express at first.

`overheated` therefore raises `turnRate` above 1. An over-responsive car oversteers on every input
and punts you into walls you meant to graze; paired with brake fade it arrives at corners it cannot
slow for and turns further into them than the driver asked.

**What would be better is losing grip**, and the drive model cannot do it. Motion is welded to the
heading (`x += cos(angle) * speed`), so there is no lateral velocity to lose. That is a drive-model
rewrite, and it is on the project's stop-and-ask list for good reason.

A steering **wobble** was designed and rejected on cost, not on taste. A deterministic
`sin(tick × freq)` term needs the tick inside `stepDrive`, which does not have one — and putting it
on `StepContext` breaks prediction, because `reconcile` replays several pending inputs through a
single context and would apply one tick's wobble to all of them. Threading a per-step tick through
the lockstep is the real price, and it is not worth paying for one status.

### D6. `brakeDecel` is scalable; drag is not

Braking was originally excluded from the channel set on the grounds that taking a player's brakes
away is hostile. Brake fade on an *overheating* car is thematically exact, and it is the one channel
that makes a driver misjudge a corner rather than merely arrive at it later.

Drag stays untouchable: a car that would not slow down even off the throttle has stopped being a car.
`STATUS_LIMITS.brakeDecel.min` keeps scaled braking above `DRIVE_CONFIG.drag` for the same reason —
the brake pedal must always beat lifting off, or the control reads as broken rather than degraded.
`status-config.test.ts` asserts that against the live drive numbers.

### D7. Stun takes the car away, and pays for it

`stunned` is the one row that is hard CC: engine, steering and trigger all dead. It pays with the
shortest duration in the table and `ignore`, so it cannot be chained.

Speed is deliberately **not** zeroed — the car coasts down through drag, because an instant stop at
speed reads as hitting an invisible wall rather than as being stunned. Injected ram spin still
applies, so a stunned car that gets hit still tumbles.

Each flag is one thing (`immobilised`, `steeringLocked`, `disarmed`) rather than a bundle, so a
status composes the condition it wants.

### D8. `disarmed` jams the press, not the shot

`beginFire` spends the stock at press time because a wind-up cannot be cancelled. A stun landing
mid-wind-up would eat the stock and produce nothing — a debuff *strictly worse the better your timing
was*, which is exactly backwards. Jam what has not been committed; let what has finish.

### D9. Cleanse repairs; it does not heal

`overhauled` strips every debuff and restores no hp. Cleansing a bleed stops the bleeding but does
not give back what has already bled.

That is the whole difference between a repair and a heal, and it is what lets a cleanse be generous
without being a second health bar. It also makes the cleanse honest about damage-over-time: the
damage already dealt is real and stays real.

A status never cleanses itself — the strip runs before it is added.

### D10. Pulses are authored per pulse, not per second

`{ intervalMs, damage?, heal? }`, mirroring `WeaponDef.damageFrequencyMs`. A `damagePerSecond` field
would have to be divided by the tick rate and rounded to whole hp, so the authored figure and the
delivered one would quietly disagree. Here the number in the table is the number the player sees.

### D11. Everything works in FFA

Six-player FFA is the default mode and has no teammates, so a system whose interesting half was
"buff your ally" would be dead content in the mode most matches are played in. Every shipped
application targets one car — self or enemy.

The corollary is focus fire: in a six-way brawl the loser of any exchange is whoever three people
happen to be pointing at, and stacking debuffs make that worse superlinearly. D3's multiplication and
D13's clamps are what stop the mechanism from making "everyone shoot that one" the dominant strategy.

### D12. An aura is a weapon shape, not a new concept

Correctly identified during design: an aura *is* a circular lingering beam attached to the car. The
attached-beam machinery already re-anchors to the owner every tick, already grows 0→range, already
lingers, and already re-applies on the per-target damage clock. Only three things were missing — a
`disc` hitbox, a `center` origin, and the wall-clip exemption a shape with no direction needs.

An aura aimed at opponents also needs **no change to `canDamage`**: it already refuses the owner, so a
car never touches its own field. That is what let auras ship without touching friendly fire.

### D13. Nothing takes the car away except the row that says it does

A debuff may take the fight off you; it may not take the car off you. Three layered mechanisms:
multiplication (D3), `STATUS_CONFIG.maxActive` (6, and at the cap a *new* status is dropped rather
than evicting a running one), and `STATUS_LIMITS` clamping every channel after aggregation. At worst
a car keeps half its top speed, 40% of its steering, a brake better than coasting, and its trigger.

`stunned` is the deliberate exception and says so on its row.

---

## The technical case

### D14. `Modifiers` is the only type that reaches the sim

    PlayerState.statuses -> toActiveStatuses -> modifiersOf -> Modifiers -> stepDrive / resolveRam / runCombat

Driving, ramming and combat never look at a status list. Adding a status touches no sim code at all,
and adding a *channel* touches exactly one call site.

### D15. Modifiers live on `StepContext`, not `SimBody`, and are required

`SimBody` is integrated state; modifiers are not written back. They are a fact about the rules this
car is driving under, in the same way `others` is a fact about where everyone else is.

Required rather than optional-with-a-neutral-default: `serverTick` and the client's
`buildStepContext` are the only two builders, they must describe the same tick, and a default would
let one silently forget while the other did not.

### D16. The whole status is networked — the one system with no server-only half

`FireState`'s `pending` machine, an instance's `damageClock`, the lock's commit timers: all off the
wire, because the client is told the result rather than the rules. A status is the opposite case.
Invariant 8 says if `stepSim` reads it, it is a networked field, and `stepSim` reads the modifiers
derived from these rows.

`sourceSessionId` is the one field the sim does not read and is networked anyway: it keeps the schema
the whole truth rather than half of it beside a server-only map, and kill credit for a bleed will want
it.

### D17. Expiry first, pulses second, application last

    statusTick (expire + derive) -> serverTick (drive) -> ramTick -> combatTick

Expiry before anything reads a modifier, so no two phases disagree. Pulses first inside `runCombat`,
so a car killed by its own bleed does not also get to fire this tick. New statuses only ever added,
always taking hold on the following tick — one rule for every source, and it has to be one rule
because an on-hit status cannot work any other way.

### D18. Pulses are stateless, derived from `startTick`

`(tick - startTick) % interval === 0`. An accumulator would change every tick, so it would patch every
tick for every burning car; anchoring to the absolute tick number would make every car in the room
pulse in unison. The first pulse lands one interval *in*, because the weapon that applied the status
already dealt its impact damage.

### D19. `applyDamage` is no longer the only HP writer — `sim/damage.ts` is

Repair pulses need healing, and `applyDamage` explicitly refuses negative amounts. `applyHeal` sits
beside it rather than becoming one signed function, so no call site can flip direction by getting a
sign wrong. It clamps to `hpOf` and refuses to lift a wreck off 0, so a repair landing on the tick a
bleed killed its target cannot un-eliminate someone already spectating.

This is a deliberate weakening of a documented invariant, and it keeps what the invariant was
protecting: one file to read when asking what can move a car's hp.

### D20. Outgoing damage freezes at spawn; incoming applies at impact

A shot's cost is the shooter's business at the moment they fired, so `damageDealt` is frozen into
`instance.damage` alongside `ownerTeam` — a buff expiring mid-flight does not un-power it, and
`hits.ts` still never reads player state. How much a shot *hurts* is the target's business at the
moment it lands, so `damageTaken` applies at impact — meaning armour applied while a shot is in the
air protects against it, which is the whole point of applying armour under fire.

### D21. `weaponCooldown` scales the three refire clocks, not the shot's shape

`cooldown`, `refireDelay`, `recovery`. Not `startUp` and not `volleyInterval`: those are the shape of
one press, and a haste buff that compressed them would change what a weapon *is*.

A parameter rather than a field on `FireState`, because a status can lapse mid-recharge and a
multiplier baked in at press time would keep applying long after its clock ran out.

### D22. `ramMass` is one channel, deliberately

A mass buff makes a car hit harder *and* harder to shift, because both read the same
`effectiveMassOf`. Splitting it would let a future weapon author a pure upside; keeping it one channel
means every mass buff carries a real trade.

### D23. No `teammates` target

Reaching a teammate means changing `canDamage`, the one predicate deciding friendly fire for the whole
game — a decision nobody has made. Shipping the member as a value that silently did nothing would be
worse than not having it; adding a union member later is a one-line change the compiler helps with.

---

## What ships

Six statuses — `overheated`, `corroded`, `stunned`, `spiked`, `fortified`, `overhauled` — and five
applications across four weapons:

| Weapon | Applies | To | For |
|---|---|---|---|
| `afterburner` | `overheated` | opponents | 1.5 s |
| `splinter` | `spiked` | opponents | 3 s |
| `shockwave` | `stunned` | opponents | 0.7 s |
| `bulwark` | `corroded` | opponents | 2.5 s |
| `bulwark` | `fortified` | **self** | 4 s |

Numbers are first-pass and meant to be re-tuned from play. What is *not* a tuning question is which
channels a row touches — that is the row's identity.

**`shockwave` changed shape**, from a 140° forward cone to a 360° disc at the same 150 radius. It is a
real buff to Hexagon's slot 2 — a chassis that cannot disengage no longer has to face its attacker to
answer them — and it is the first thing to re-tune. Reverting is a two-line edit.

`overhauled` is applied by nothing: it is the pickup status, and `statusRequests` can deliver it the
day a pickup system exists.

## Future work

- **Pickups**, the other half of the plan and the request queue's reason to exist.
- **Teammate delivery** (D23), if friendly-targeting weapons are ever wanted.
- **Steering wobble** (D5), at the cost of threading a per-step tick through the lockstep.
- **A grip model**, which is what `overheated` really wants and what the drive model cannot express.
- **Per-source diminishing returns**; `sourceSessionId` is already on the wire for it.
- **Kill credit for a bleed** — a DoT death currently credits nobody, which is invisible today because
  nothing reads kill credit.
- **World-space status cues.** The badge tells the driver; nothing tells the player *shooting at* them.
