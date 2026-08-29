# Motor Combat MOBA — Weapon Roster Design

**Designed:** 2026-08-29 · **Recorded in repo:** 2026-08-29
**Status:** Approved. Not yet implemented. Numbers solved 2026-08-29 — see [Solved numbers](#solved-numbers).
**Plan:** [`../plans/2026-08-29-weapon-roster.md`](../plans/2026-08-29-weapon-roster.md) — seven tasks.
**Builds on:** [`2026-08-27-weapon-system-design.md`](2026-08-27-weapon-system-design.md) (D1–D22),
[`2026-08-27-aim-assist-target-lock-design.md`](2026-08-27-aim-assist-target-lock-design.md) (A1–A14),
[`2026-08-28-attack-stat-damage-formula-design.md`](2026-08-28-attack-stat-damage-formula-design.md)

---

## Problem

The weapon *system* is built and the weapon *content* is not. `WEAPON_TABLE` holds two rows:
`fireball`, which every chassis carries, and `repeater`, which no chassis carries. Car select is
therefore a choice of three stat lines attached to one identical gun, and most of the system —
beams, pellet fans, sequential volleys, pierce, wind-ups, stocks in live play — has never been seen
on a screen.

This spec is the content pass: **nine weapons, three per chassis, none shared.** It decides what
each weapon *is* and why, not what its numbers are. Every weapon here is expressible with fields
that already exist in `WeaponDef`, so the roster costs zero new sim mechanics.

## Constraints

1. The hard invariants in `CLAUDE.md` hold. Balance lives in shared config tables, never in logic.
2. `WEAPON_SLOT_CONFIG.maxWeaponSlots` is 3, so a chassis carries at most three weapons. This spec
   fills all three on all three chassis and does not ask for a fourth.
3. The level system still does not exist. Every weapon ships `unlocksAt: 1`, as `fireball` does.
4. **No new sim mechanics.** Every weapon must be authorable as a `WEAPON_TABLE` row against the
   current `WeaponDef` union. If a design needs an engine change, it is out of scope here.
5. The drive model, the OBB hull model and friendly fire are untouched (`CLAUDE.md`: stop and ask).
6. Combat stays server-only.

## Non-goals

- ~~Final balance numbers.~~ **Resolved 2026-08-29.** Numbers are now solved and live in
  [Solved numbers](#solved-numbers). They remain subject to playtest, but they are no longer
  placeholders and should be transcribed into `WEAPON_TABLE` as written.
- Any new mechanic: homing, ricochet, explosion-on-impact AoE, rear-facing spawns, knockback,
  slows/burns/stuns as status, shields, heals, damage falloff, hold-to-charge. See
  [What we deliberately cannot build yet](#what-we-deliberately-cannot-build-yet).
- Weapon art. Icons follow the existing `process-weapon-icon` pipeline (D19) at implementation time.
- The in-match level gate that `unlocksAt` will one day drive.

---

## Design foundation — what the chassis stats already say

The three chassis were balanced to a 150-point budget before any of this, and their numbers already
describe three different games. The roster's job is to make each one *play* like its stat line.

| Chassis | Top speed | Hull HP | `attack` scale | The fantasy |
|---|---|---|---|---|
| **Rectangle** | 540 (fastest) | 400 | **0.8×** (weakest) | **The Runner.** Can reach anyone, hits soft. Speed is the weapon. |
| **Oval** | 405 | **300** (softest) | **1.2×** (hardest) | **The Gunner.** Glass cannon. Wants never to be touched. |
| **Hexagon** | 315 (slowest) | **700** (toughest) | 1.0× | **The Bastion.** Can't chase, can't flee. Owns the ground it stands on. |

Derived from `forwardMaxSpeedOf`, `hpOf` and `damageFor` — not new numbers.

**The intended counter-triangle:**

- **Rectangle beats Oval** — closes the gap fast; Oval's wind-ups whiff on something moving 540.
- **Oval beats Hexagon** — kites it indefinitely; Hexagon can never close a 90 u/s speed deficit.
- **Hexagon beats Rectangle** — Rectangle *must* come close to use its kit, and close is exactly
  where Hexagon's kit lives.

---

## Decisions

### L1 — Kits are fully exclusive; nine weapons, no sharing

Each chassis carries three weapons no other chassis carries. `fireball` stops being universal and
becomes Rectangle's slot 1.

The alternative — keep `fireball` shared as slot 1 and author six — is cheaper and was rejected:
car select would remain two-thirds of a decision, and a shared opener drags all three chassis toward
the same early-fight rhythm. Exclusivity is the point of having three chassis.

### L2 — The slot-1 / slot-2 / slot-3 shape is go-to / mid / commitment

Every kit reads left to right as escalating commitment, and the escalation is in **payoff per press
and exposure while pressing**, not in sustained DPS:

| Slot | Cooldown | Payoff per press | Role |
|---|---|---|---|
| 1 — go-to | short | ~10% of an average car | Fills every gap. Never gates anything. |
| 2 — mid | medium | ~20–25% | A real burst with a real aiming or positioning condition. |
| 3 — ultimate | long | ~25–40%, up to ~55% fully connected | A commitment. Wins a fight if used properly. |

Percentages are of an **average** car's 500 hull HP (`hpPerRating × 50`), the same yardstick
`fireball`'s damage was solved against. They are the design target, not the shipped numbers.

Sustained DPS is deliberately *not* the frame for slot 3. A 13–16 s cooldown on a 2 s weapon has low
sustained DPS by construction; its value is the moment, and the go-to fills the rest.

### L3 — `fireball` keeps its numbers and becomes Rectangle-exclusive

`fireball`'s 50 damage is *solved*, not chosen: it is the number that makes an average-vs-average
kill take the design target of five seconds. Retuning it would move the yardstick the other eight
weapons are being balanced against, in the same pass that authors them.

It also stays on `DEFAULT_CAR_ID` (`rectangle`), so the fallback chassis — driven by pre-reveal lobby
players and anything unrecognised on the wire — still fires the shot every existing player knows.

The "modification" `fireball` receives is therefore its loadout membership, not its stats.

### L4 — `repeater` is converted into `splinter`, not preserved alongside it

`repeater` exists today solely as the live reference for the stock mechanic (D5), because `fireball`
had to ship single-stock to keep the weapon-system migration a zero-balance-change diff. Oval's
slot 1 is a stock weapon, so the reference can be a weapon players actually fire. A reachable
reference is strictly better: stock bugs surface in matches instead of only in test files.

`repeater` is the reference row for four properties. Three survive the conversion:

| Property `repeater` proved | After conversion |
|---|---|
| Multi-stock (`stock: { max, refireDelayMs }`) | **`splinter`** — carried by Oval. |
| `usesAimAssist: false` | **`skewer`** and **`pepperbox`** — both carried. |
| A non-zero `recoveryMs` | **`lance`** — see L5. |
| `recoveryMs > cooldownMs` | **Nothing.** Accepted loss; see below. |

`recoveryMs > cooldownMs` means "you can refire *this* weapon before you can switch to any other
slot" — a weapon you commit to once you start. It was considered for `pepperbox` and rejected: no
weapon in this roster wants that feel, and inventing one to preserve a table property would be
tail-wagging-dog. The engine lever is untouched and remains available to a future weapon.

This is a **rename plus a retune**, not a rename. `repeater`'s numbers were written to demonstrate a
mechanic (31 damage, a slow 700 u/s bullet, a 3-unit hitbox, a 3 s recharge, no aim assist);
`splinter` wants a fast thin dart with aim assist and a shorter recharge. The `stock` shape and the
teal colour carry over; nothing else should be assumed to.

### L5 — Recovery is small everywhere except `lance`

`recoveryMs` gates *other* slots after a press. Go-tos get effectively none (`fireball`'s is already
0). Mids get a token ~0.2 s, enough that two slots cannot resolve on one frame.

Two of the three ultimates also get a small recovery, deliberately. `afterburner` and `bulwark` each
spawn one instance that then lives on its own — a cone that burns for ~2 s, a zone that sits for
~2.5 s. Low recovery means the driver is free to keep fighting while it does: Rectangle flames a
target and keeps throwing fireballs into them; Hexagon drops a zone and immediately thumps whoever
is stuck in it. The ultimate becomes **a state you enter, not a turn you spend**, which rewards
using it to set up rather than to finish.

`lance` is the exception because it is the opposite kind of move — one instant, one large hit, no
lingering presence. Its wind-up alone should not be its whole cost. A real (~1 s) recovery is what
makes a missed `lance` genuinely punishing on a 300 HP chassis, which is the trade the glass cannon
should be making.

### L6 — A zoning ultimate is a legitimate ultimate

`bulwark` deals damage but its primary output is denied ground. That is accepted, on one condition:
**it must be fairly rewarding when used properly.** A car forced to cross it takes a serious chunk,
and a car that refuses has surrendered position — which, for a chassis that cannot take ground by
driving, *is* the win condition. It must never read as a safe wall to drive through.

The enabling fact is that `canDamage` returns false for `ownerId === targetId` and there is no
friendly fire in team mode: **the owner can sit inside their own `bulwark`.** The weapon is not a
symmetric hazard, it is an asymmetric exclusion zone, and that is most of its design.

### L7 — Every field in `WeaponDef` is exercised by a carried weapon

Not an aesthetic goal. Today the roster carries one plain single-shot projectile, so beams, pellet
fans, sequential volleys, pierce, wind-ups, `damageFrequencyMs > 0` and `attached` beams are
untested in play and, in several cases, unreachable in tests without hand-built fixtures
(see `combat-model.md`, "What the tests do and do not reach"). The roster below closes that gap:

| Mechanic | Weapon that carries it into play |
|---|---|
| Single projectile, aim assist on | `fireball`, `thumper` |
| Aim assist off (skillshot) | `pepperbox`, `skewer` |
| Pellet fan (`pelletsPerVolley`, `spreadAngleDeg`) | `pepperbox` |
| Sequential volleys (`volleys`, `volleyIntervalMs`) | `pepperbox` |
| Stocks (`stock`) | `splinter` |
| `pierce` | `skewer` |
| `ellipse` projectile hitbox | `skewer` |
| Large-radius `circle` hitbox | `thumper` |
| Attached beam, ticking (`damageFrequencyMs > 0`) | `afterburner` |
| Attached beam, single-hit (`damageFrequencyMs: 0`) | `shockwave` |
| Detached beam, single-hit, `rect` | `lance` |
| Detached beam, ticking, `cone` | `bulwark` |
| Beam `lifetimeMs > 0` (never yet tested) | `afterburner`, `bulwark`, `lance` |
| `startUpMs > 0` (wind-up) | `skewer`, `lance` |
| `recoveryMs > 0` | `lance` (and token values elsewhere, L5) |

`repeater`'s one orphaned property is covered in L4.

---

## The roster

This section describes what each weapon *is*. The stats are in
[Solved numbers](#solved-numbers) — kept separate so a tuning pass edits one place, not nine
prose paragraphs.

### Rectangle — The Runner

*Theme: your driving is your aim. Every weapon rewards motion and punishes standing still.*

| Slot | Weapon | Shape | What it feels like |
|---|---|---|---|
| 1 | **Fireball** `#E8590C` | projectile, circle, aim assist | Unchanged. A 2/s snap poke at long range. The table's yardstick. |
| 2 | **Pepperbox** | projectile, 3 volleys × 2 pellets, narrow fan, no aim assist | A drive-by burst. Sequential volleys read the car's pose at *each shot's own tick*, so driving straight clusters it and **turning through the burst sprays it across an arc**. The skill expression falls out of the mechanic for free. |
| 3 | **Afterburner** | beam, cone, `attached: true`, ticking | A flame cone welded to the nose for ~2 s, ticking several times a second at short range, sweeping as the driver steers. |

**Afterburner used properly:** pressed when already on a target's bumper. No other chassis can catch
a fleeing car; Rectangle can, and this is what converts the catch into a kill. A full 2 s of contact
is over half an average car's health; a 4–5 tick sweep on a pass is still the kit's biggest press.
Its low recovery (L5) means Fireball keeps firing throughout.

**Why this kit fits the stats:** Rectangle's 0.8× `attack` means it cannot win a damage race, and its
400 HP means it cannot win a brawl. Its whole kit is short-to-medium range and rewards being in
motion, so its speed advantage is doing the work rather than its damage.

### Oval — The Gunner

*Theme: reach and precision, with real punishment for being caught out of position.*

| Slot | Weapon | Shape | What it feels like |
|---|---|---|---|
| 1 | **Splinter** `#0CA5B0` | projectile, small circle, `stock`, aim assist | Three banked darts — fast, thin, long range. Dump all three in half a second, or tap one and hold the rest. Trigger discipline is the skill. |
| 2 | **Skewer** | projectile, ellipse, `pierce: 1`, short wind-up, no aim assist | Long, thin, very fast, passes through two cars. Screen-length range. Aim assist is deliberately off — it is earned, not given. Lining two enemies up is the highest-value press in the game. |
| 3 | **Lance** | beam, rect, `attached: false`, single-hit | A long wind-up during which the driver is a visible sitting duck, then a near-instant beam stamped clean across the arena. One hit per car. Long recovery. |

**Lance used properly:** fired at a target that cannot spend the next 0.7 s dodging — cornered, mid
commitment, or lined up behind a second car so it catches both. Two cars is roughly three quarters of
an average car's health in one press. A whiff is close to a death sentence on 300 HP.

**Why this kit fits the stats:** every weapon reaches, and two of the three carry a real aiming or
timing condition. The 1.2× `attack` makes each connection matter; the 300 HP makes each wind-up a
gamble. Oval is the chassis whose weapons are hardest to *land*, which is where its damage lead is
paid for.

### Hexagon — The Bastion

*Theme: make the ground around you unsurvivable. It cannot chase — so it makes you come to it.*

| Slot | Weapon | Shape | What it feels like |
|---|---|---|---|
| 1 | **Thumper** | projectile, large circle, slow, aim assist | A fat, lumbering slug with a forgiving hitbox. Dodgeable at distance because it is slow; near-unmissable in a brawl. |
| 2 | **Shockwave** | beam, wide cone, `attached: true`, single-hit, very short life | A cone hugging the chassis for a quarter second, one large hit per car. Not aimed so much as triggered — it only needs people to be near. Anti-ram, anti-dive, anti-Rectangle. |
| 3 | **Bulwark** | beam, cone, `attached: false`, ticking, long linger | A wide cone stamped into the world and left there, ticking for ~2.5 s. Fire it down a lane, into a chokepoint, or onto your own position. |

**Bulwark used properly:** see L6. Dropped *on yourself* to become unapproachable for three seconds,
or laid across the only path between an enemy and their escape. Full duration should be comparable
to eating an Afterburner.

**Thumper's specific job** is to stop the kite from being free. Hexagon is 90 u/s slower than Oval
and 225 slower than Rectangle; without one weapon that reaches, the slowest chassis has no answer at
all to a patient opponent. Thumper reaches, but its low speed makes it genuinely dodgeable at range —
it buys pressure, not a ranged win.

**Why this kit fits the stats:** two of three weapons are contact-range and the third denies ground.
Hexagon converts 700 HP into the right to *be somewhere*, which is the only currency a chassis that
cannot reposition has.

---

## Solved numbers

Solved 2026-08-29 against `fireball` as the fixed anchor (L3), and validated against every guard in
`weapon-config.test.ts` before being written down. Transcribe these into `WEAPON_TABLE` as given.
All durations are **milliseconds**; `WEAPON_TICKS` converts once (D6).

### The derivation rule

`fireball` is 50 damage / 500 ms = **100 damage per second at 1.0× `attack`**, which is the number
that makes an average-vs-average kill take the design target of five seconds. Every other row is
placed relative to it under one rule:

> **Go-tos sustain. Mids burst. Ultimates commit.**

A mid weapon having *lower sustained DPS than its own slot 1* is correct and not a bug — it buys a
chunk of damage inside a window the go-to physically cannot match. `pepperbox` lands 168 in 200 ms;
`fireball` needs 1.7 s to do the same. That is the trade, and it is what keeps the two off each
other: neither dominates, because they are paid in different currencies.

This is the assumption most of the table hangs on. If playtest says burst weapons feel weak, the fix
is to shorten their cooldowns, **not** to raise their damage past the ultimates.

### Rectangle — 0.8× `attack`

| Field | `fireball` *(unchanged)* | `pepperbox` | `afterburner` |
|---|---|---|---|
| `kind` | projectile | projectile | **beam** |
| `damage` | 50 | 28 (per pellet) | 26 (per tick) |
| `damageFrequencyMs` | 0 | 0 | **200** |
| `speed` / `range` | 900 / 900 | 800 / 600 | 1100 / 220 |
| `hitbox` | circle r12 | circle r7 | cone 55° |
| `cooldownMs` | 500 | 1800 | 13000 |
| `startUpMs` / `recoveryMs` | 0 / 0 | 0 / 200 | 0 / 200 |
| `volley` | 1 / 0 / 1 / 0 | **3 / 100 / 2 / 10°** | — |
| `pierce` | 0 | 0 | — |
| `attached` / `lifetimeMs` | — | — | **true** / 2000 |
| `usesAimAssist` | true | false | **false — forced** |
| `color` | `#E8590C` | `#B45309` | `#D6336C` |

`pepperbox` full burst = 6 × 28 = **168** (34% of an average car), delivered inside 200 ms. Its
all-pellets-connect sustained DPS is 83, *below* `fireball`'s 100 — see the rule above. Realistically
3–4 pellets land, so its payoff decays with range, which is what makes it a closing tool.

`afterburner` total life = 220/1100 + 2000 = **2.2 s** ÷ 200 ms ≈ 11 ticks = **286 max** (57%). A
realistic 5-tick sweep is ~130.

### Oval — 1.2× `attack`

| Field | `splinter` | `skewer` | `lance` |
|---|---|---|---|
| `kind` | projectile | projectile | **beam** |
| `damage` | 30 | 110 | 180 |
| `damageFrequencyMs` | 0 | 0 | 0 |
| `speed` / `range` | 1100 / 850 | 1400 / 1100 | **6000** / 1200 |
| `hitbox` | circle r5 | **ellipse 22 along / 5 across** | rect width 20 |
| `cooldownMs` | **400** (per stock) | 2400 | 16000 |
| `stock` | **max 3, refire 130** | — | — |
| `startUpMs` / `recoveryMs` | 0 / 0 | 250 / 200 | **700 / 1000** |
| `volley` | 1 / 0 / 1 / 0 | 1 / 0 / 1 / 0 | — |
| `pierce` | 0 | **1** | — |
| `attached` / `lifetimeMs` | — | — | false / 150 |
| `usesAimAssist` | true | false | false |
| `color` | `#0CA5B0` | `#1864AB` | `#6741D9` |

**`splinter`'s 400 ms recharge is the entire weapon.** Tapping one dart per 400 ms sustains 75 DPS.
Dumping all three puts 90 damage out in 260 ms and then leaves a 1.2 s dry spell — 62 DPS across the
cycle. So **tapping wins the long fight and dumping wins the moment**, and choosing between them
every few seconds is the trigger discipline the weapon was designed around. Any recharge much longer
than this collapses the weapon: at the 1.7 s first drafted for it, `splinter` sustains 18 DPS and is
not a viable slot 1.

`skewer` carries **`pierce: 1`, which is two cars** — `pierce` counts opponents passed through
*after* the first, so `pierce: 2` would be three cars and would let a 110-damage shot deal 396 on
Oval, out-damaging `lance`. Two cars = 220 base, 264 on Oval.

### Hexagon — 1.0× `attack`

| Field | `thumper` | `shockwave` | `bulwark` |
|---|---|---|---|
| `kind` | projectile | **beam** | **beam** |
| `damage` | 75 | 100 | 35 (per tick) |
| `damageFrequencyMs` | 0 | 0 | **400** |
| `speed` / `range` | 450 / 550 | 1500 / 150 | 500 / 500 |
| `hitbox` | **circle r20** | cone 140° | cone 60° |
| `cooldownMs` | **1000** | 5000 | 15000 |
| `startUpMs` / `recoveryMs` | 0 / 0 | 0 / 200 | 0 / 200 |
| `volley` | 1 / 0 / 1 / 0 | — | — |
| `pierce` | 0 | — | — |
| `attached` / `lifetimeMs` | — | **true** / 150 | false / **2500** |
| `usesAimAssist` | true | **false — forced** | false |
| `color` | `#495057` | `#5C940D` | `#862E9C` |

`bulwark` total life = 500/500 + 2500 = **3.5 s** ÷ 400 ms ≈ 8 ticks = **280 max** (56%), matching
`afterburner`'s ceiling as L6 intends.

### Two constraints that decided numbers, not preferences

**1. The aim-assist cliff bans a range of cooldowns.** `AIM_CONFIG.lockTimeoutMs` is 800, so the
behavioural cliff sits at 1.25 Hz, and `weapon-config.test.ts` rejects any aim-assist weapon whose
sustained rate (`1000 / cooldownMs`) falls within 15% of it. **That forbids every `cooldownMs`
between 696 and 941** for an aim-assist weapon. `thumper` was first drafted at 900 ms, which is
inside the band and would have failed the suite; 1000 ms clears it at 20% distance and suits the
lumbering-slug feel better regardless. Standing margins:

| Weapon | `cooldownMs` | Sustained Hz | Distance from cliff |
|---|---|---|---|
| `fireball` | 500 | 2.00 | 0.60 ✓ |
| `splinter` | 400 | 2.50 | 1.00 ✓ |
| `thumper` | 1000 | 1.00 | 0.20 ✓ |

**2. Aim assist requires `range >= AIM_CONFIG.lockRange` (400).** `afterburner` (220) and
`shockwave` (150) are therefore *forced* to `usesAimAssist: false`. This is the right answer anyway:
both are `attached` beams that already track the firing car's heading every tick, so a lock would
have nothing left to decide.

### Palette

Grouped by chassis, so colour answers *who is shooting* before shape answers *what is coming*. All
nine are darker than the six `COLOR_TABLE` player colours and clear of their hues, per D19.

| Rectangle — warm | Oval — cool | Hexagon — industrial |
|---|---|---|
| `fireball` `#E8590C` ember *(existing)* | `splinter` `#0CA5B0` teal *(existing)* | `thumper` `#495057` gunmetal |
| `pepperbox` `#B45309` brass | `skewer` `#1864AB` deep blue | `shockwave` `#5C940D` acid olive |
| `afterburner` `#D6336C` flame-core magenta | `lance` `#6741D9` indigo | `bulwark` `#862E9C` hazard purple |

The tightest pair is `lance` `#6741D9` against `bulwark` `#862E9C` — blue-violet against
magenta-violet. They sit on different chassis and draw as very different shapes (a thin instant line
against a wide lingering cone), so it should hold; it is the first pair to revisit if anything reads
ambiguously on screen.

---

## Balance frame

The yardstick is **damage per press as a fraction of an average car's 500 hull HP**, before the
firing chassis's `attack` scale. Computed from [Solved numbers](#solved-numbers):

| Weapon | Damage per press | % of 500 | Fully connected | Sustained DPS |
|---|---|---|---|---|
| `fireball` | 50 | 10% | — | 100 |
| `pepperbox` | 168 (6 pellets) | 34% | — | 83 (all pellets) |
| `afterburner` | ~130 (5 ticks) | ~26% | 286 · 57% (full 2.2 s) | — |
| `splinter` | 30 (one dart) · 90 (full bank) | 6% · 18% | — | 75 tapping · 62 dumping |
| `skewer` | 110 | 22% | 220 · 44% (two cars) | 41 |
| `lance` | 180 | 36% | 360 · 72% (two cars) | — |
| `thumper` | 75 | 15% | — | 75 |
| `shockwave` | 100 | 20% | — | — |
| `bulwark` | ~105 (3 ticks) | ~21% | 280 · 56% (full 3.5 s) | — |

Sustained DPS is omitted for the ultimates on purpose: a 13–16 s cooldown on a 2 s weapon has a low
figure by construction (`afterburner` is 19), and reading it as a weakness is the error L2 exists to
prevent. Their value is the moment; the go-to fills the rest.

Two properties to preserve while tuning:

1. **No slot is strictly dominated.** Because a car carries all three and recovery is small (L5), a
   go-to with materially worse damage-per-second than the ultimate is still correct to use in the
   gaps — but a mid weapon that is worse than the go-to in every dimension is a bug.
2. **The `attack` scale multiplies everything.** A weapon tuned to feel right on Hexagon (1.0×)
   lands 20% harder on Oval and 20% softer on Rectangle. Since kits are exclusive (L1), each weapon
   only ever fires from one chassis, so tune each row *at its owner's scale*, not at baseline.

### Arena caveat

Ranges here are tuned for **`arena-01`, which is 1280 × 720**. Fireball's existing 900 range already
crosses 70% of it and Lance's ~1200 crosses all of it. On `arena-02` (2000 × 2000) the same numbers
become mid-range. `arena-01` is the arena in play, so it is the tuning target; this is recorded so
the shift is not a surprise when a larger arena ships.

---

## What we deliberately cannot build yet

None of the nine needs an engine change. These do, and were kept out (constraint 4). Recorded
because they are the obvious next asks:

| Wanted | Why it is not here |
|---|---|
| Homing / seeking missiles | Instances are frozen to their exit pose; the lock decides a direction only (A1), with no in-flight correction. |
| Ricochet / bouncing shots | Projectiles die on an obstacle or the arena edge. |
| Explosion-on-impact AoE | An instance has one hitbox for its whole life; there is no on-death spawn. |
| Mines, oil slicks, anything dropped **behind** | Instances spawn at the muzzle — the car's physical nose. There is no spawn offset (D13 explicitly excludes muzzle offsets). |
| Knockback / physics impulses on hit | Damage is the only hit effect. |
| Slows, burns, stuns as lasting status | No status system; `damageFrequencyMs` is a per-instance clock, not a debuff on the target. |
| Shields, heals, damage reduction | `applyDamage` is the only HP writer and only subtracts. |
| Damage falloff over distance | `damage` is a constant per weapon. |
| Hold-to-charge | `startUpMs` is a fixed wind-up that cannot be cancelled or extended. |
| Ultimates unavailable at match start | No "starts on cooldown" concept; a weapon is ready when it unlocks. Accepted for now — wind-up and recovery carry the risk instead. |

The recommendation is to ship nine weapons at zero engine risk, play them, and *then* pick one
mechanic from this list deliberately.

---

## Implementation notes

Not a plan — the seams a plan will have to cover.

**Config.** Nine rows in `WEAPON_TABLE`, nine ids in `WeaponId`, three `weapons` arrays in
`CAR_TABLE`. `weapon-config.test.ts` already validates the table; note it fails any aim-assist weapon
authored within 15% of the `lockTimeoutMs` cliff, which constrains Splinter's and Thumper's fire
rates against `AIM_CONFIG`.

**Colours.** Decided as a set — see [Palette](#palette). Each is clear of `COLOR_TABLE`'s six player
colours and dark enough to read against the arena floor (D19 — the client draws the hitbox itself,
there is no world sprite).

**The `repeater` → `splinter` conversion** (L4) touches, beyond the table: `weapon-config.test.ts`,
`combat.test.ts` (two sites — the multi-stock tick and the `usesAimAssist: false` case),
`fire.test.ts` (five sites), `asset-keys.test.ts`, `combat-visual.test.ts`, `weapon-hud.test.ts`,
`scripts/import-weapon-icon.mjs`'s comment, plus the "carried by no car, do not delete" passages in
`weapon-config.ts`, `combat-config.ts`, `combat-model.md` and `config-reference.md`. Mechanical, but
not zero.

Two of those sites need a *new host*, not a find-and-replace, because `splinter` does not inherit
`repeater`'s numbers:

- `fire.test.ts`'s **recovery** test is built on `repeater`'s `recoveryMs: 5000`. `splinter`'s is 0.
  Move it to **`lance`** (`recoveryMs: 1000`), the roster's only weapon with a substantial one.
- `fire.test.ts`'s **stock recharge** tests walk `repeater`'s 3000 ms cooldown and 100 ms refire
  tick by tick. `splinter` is 400 / 130, so the windows must be recomputed, not renamed —
  400 ms is 12 ticks and 130 ms rounds up to 4 ticks (133 ms) at 30 Hz.

`combat.test.ts`'s `usesAimAssist: false` case can move to `skewer` or `pepperbox`; either is
carried, which is an improvement over asserting it on a weapon nobody could fire.

**Docs to update at implementation:** `config-reference.md`'s weapon table and its `repeater`
passages, `combat-model.md`'s coverage list (several "no car carries this, so this is untested"
statements stop being true), and `ArenaScene.ts`'s comment about `recoveryMs > 0` being uncarried.

**Icons.** Nine HUD icons via the `process-weapon-icon` skill. `import-weapon-icon.mjs` notes an icon
is only visible if some car's loadout carries the weapon — after this change, all nine do.

**Testing.** The valuable new coverage is the paths that were previously unreachable: a beam with a
non-zero `lifetimeMs` (none has ever existed), `spawnInstances` emitting more than one pellet, an
attached beam re-anchoring through a turn during real play, and `damageFrequencyMs > 0` re-arming
against a target that stays inside a zone.

## Open questions

1. ~~**Exact numbers.**~~ **Closed 2026-08-29** — see [Solved numbers](#solved-numbers).
2. ~~**Palette.**~~ **Closed 2026-08-29** — see [Palette](#palette).
3. **Naming.** The set leans industrial/mechanical, which suits the abstract chassis names, but this
   is a preference and not a rule; a better name for any individual weapon is welcome.
4. **Does Hexagon have enough reach?** The one design call most likely to be wrong in playtest.
   Thumper is the mitigation (see its note above); if a patient Oval still kites Hexagon for free,
   the fix is Thumper's speed and range, not a fourth weapon.
5. **Ultimates ready at spawn.** Accepted for now (see the table above). Revisit if the opening
   seconds of a match feel dominated by slot 3.
6. **Is `pepperbox`'s burst-over-sustained trade the right shape?** It is the assumption the widest
   set of numbers hangs on (see [The derivation rule](#the-derivation-rule)), and it applies to
   `skewer` too. If burst weapons feel weak in play, shorten their cooldowns rather than raising
   their damage past the ultimates.
