# Motor Combat MOBA — Attack Stat and Damage Formula Design

**Designed:** 2026-08-28 · **Recorded in repo:** 2026-08-28
**Status:** Implemented.
**Plan:** [`../plans/2026-08-28-attack-stat-damage-formula.md`](../plans/2026-08-28-attack-stat-damage-formula.md)

---

## Problem

Two unrelated things are wrong with the combat stats, and fixing either one alone leaves the other
incoherent.

**Collision damage exists and should not.** A car-vs-car contact currently deals damage judged by
facing — the whole subsystem in `sim/ram.ts` plus phase 5 of `sim/combat.ts`. It is being retired as
a damage source outright. Collision *physics* — push-out, restitution, the OBB hull model — is not
in question and does not change.

**The chassis `strength` stat then has no consumer.** `strength` feeds exactly one call site
(`ramDamageOf` in `sim/combat.ts`); deleting ram damage would leave it a dead number on every row of
`CAR_TABLE`. It is renamed to `attack` and given a real job: scaling the damage of whatever weapon
the car is firing. Today `WeaponDef.damage` is the final damage, identical for every chassis, so two
cars with wildly different combat identities land the same fireball.

A third problem falls out of the second. The rating scale is 0–10 in integers, and a percentage
modifier on a single-digit damage number quantises brutally — a ±10% band on `damage: 8` rounds to
the same integer for three adjacent ratings. The scale has to widen for the formula to resolve at
all.

## Constraints

1. The hard invariants in `CLAUDE.md` hold: no magic numbers in logic, balance lives in shared
   config tables, `stepSim` is the lockstep imported by both server and client, max 6 players.
2. Combat stays **server-only**. The client predicts its own motion and nothing else — it never
   computes damage.
3. `PlayerState.hp` is `uint16`. Damage must resolve to a non-negative integer.
4. `sim/weapons/hits.ts` is the lag-compensation seam (weapon-system spec, D20): it is a pure
   function of an instance and a pose snapshot and **may not read player state**. The attack stat
   must reach it without breaking that.
5. Every car's **top speed must not change**. This is a combat change; the drive model is untouched.
6. `applyDamage` in `sim/damage.ts` stays the only place hp is ever reduced.

## Non-goals

- Changing the drive model, the OBB car-hull model, collision *physics*, or friendly-fire rules.
- Any change to how weapons are aimed, fired, cooled down, or hit-tested.
- A defense stat (see S10) or damage types/resistances.
- Ammunition, healing, or shields.
- Client-side prediction of damage.

---

## Decisions

### S1 — Collision deals no damage; the ram subsystem is deleted, not disabled

Setting `collisionDamagePerStrength: 0` would leave an O(n²) pair scan running every tick — contact
tests, facing dot products, a per-pair cooldown map threaded through `stepSim`'s input and output —
computing a damage of zero forever. The subsystem exists for one purpose and that purpose is gone.

Deleted:

- `sim/ram.ts` entirely (`isRamming`, `ramOutcome`, `ramDamage`, `RamOutcome`) and `sim/ram.test.ts`.
- Phase 5 of `sim/combat.ts`, plus its helpers `ramDamageOf` and `pruneCooldowns`.
- `ramCooldowns` from `CombatInput`/`CombatResult` (`sim/combat.ts`), from `CombatBridge`
  (`server/src/sim/combat-bridge.ts`), and from its four touch points in `ArenaRoom.ts`.
- `COMBAT_CONFIG.collisionDamagePerStrength`, `ramDotThreshold`, `ramContactPad`, and
  `collisionDamageCooldownTicks` — all four are orphaned by the above.

Kept untouched: **`sim/collide.ts` in full**, including `obbsInContact` and its export from
`shared/src/index.ts`. That function loses its only caller, but it is a tested pure-geometry
predicate on the package's public surface, not part of the ram subsystem, and collision is
explicitly out of scope. Cars shove each other exactly as they do now.

Rejected alternative: **keep the facing detection for a future non-damage effect** (knockback, a
stun, a screen shake). Nothing in the roadmap asks for one, and the code is recoverable from git the
day something does. Dormant subsystems rot silently.

### S2 — `strength` becomes `attack`

A pure rename of `CarDef.strength` to `CarDef.attack`, across `CAR_TABLE`, `config/types.ts`, the
client's stat bars, and the docs. `attack` says what the number now does; `strength` described ram
damage, which no longer exists.

`CarId` values are untouched. No enum is renumbered. Nothing on the wire changes — `strength` was
never a schema field, only a config lookup keyed by the networked `carId`.

### S3 — Ratings move to 0–100 on a 150-point budget

Every chassis rating (`speed`, `attack`, `hp`) is an integer **0–100 with 50 as average**, and the
three must **sum to exactly 150**.

The budget is not new, it was just unwritten: all three current cars sum to exactly 16. Making it
explicit turns a coincidence into a testable invariant, and gives whoever authors car four a rule to
follow rather than three examples to eyeball.

The wider scale is what makes S5 work at all. A ±1%-per-point modifier on a damage number near 50
resolves to distinct integers for every rating; the same modifier on the old `damage: 8` does not.

Rejected alternatives:

- **Keep 0–10 and use a coarser step** (±5%/point). Same quantisation problem, and it forces the
  roster into 10 discrete identities.
- **Ratings as floats.** Config diffs stop being readable and the budget rule stops being checkable
  by eye.

### S4 — Derived values re-scale so that only combat moves

The two per-rating multipliers are treated differently, because HP is *meant* to move and speed is
not:

| Constant | Was | Becomes | Effect |
|---|---|---|---|
| `COMBAT_CONFIG.hpPerRating` | 10 | **10 (unchanged)** | hull HP scales 10× with the rating: 30–80 becomes 300–700, on a 0–1000 range |
| `DRIVE_CONFIG.speedPerRating` | 45 | **4.5** | cancels the 10×, so **top speeds are identical to today's** |

`hpPerRating` is deliberately left alone — letting the rating change carry through is exactly how
the HP pool reaches the scale S5 and S7 need. `speedPerRating` divides by 10 to cancel it, so
`forwardMaxSpeedOf` returns exactly what it returns today for all three cars. `baseMaxSpeed`,
`reverseSpeedRatio`, and every other `DRIVE_CONFIG` value are untouched, as is
`CAMERA_CONFIG.freeRoamSpeed` — the config test that pins it above the fastest car still passes on
the same margin. `DRIVE_CONFIG`'s own doc comment explains the `baseMaxSpeed`-to-`speedPerRating`
ratio and quotes worked figures, so it is re-worded in the same commit.

### S5 — The damage formula

```
COMBAT_CONFIG.attackBaseline  = 50    // the rating an "average" chassis carries
COMBAT_CONFIG.damagePerAttack = 0.01  // fractional damage change per rating point

damageFor(attack, weaponDamage) =
  Math.round(weaponDamage * (1 + (attack - attackBaseline) * damagePerAttack))
```

Attack is a **bounded percentage modifier**: 0.5× at rating 0, 1.0× at 50, 1.5× at 100.

The modifier is multiplicative rather than additive on purpose. A flat bonus is collected **once per
shot**, so it pays out in proportion to fire rate — `repeater` fires three stocks at a 100 ms refire
and would bank a flat bonus three times per volley, quietly making `attack` a fire-rate stat. A
percentage modifier gives a fast weapon and a slow weapon the same proportional gain, so `attack`
means the same thing whatever is in the slot.

Rejected alternatives:

- **Additive** (`damage + attack * k`) — the fire-rate coupling above.
- **Pure proportional** (`damage * attack / 50`) — a 0-attack chassis deals literally nothing, and
  `WeaponDef.damage` stops being a number anyone can read as damage.
- **Attacker/defender ratio** (the Pokémon shape) — requires a defense stat, rejected in S10.

### S6 — `WeaponDef.damage` means "damage from an average-attack car"

The convention that makes the weapon table readable: `damage` is what the weapon deals from a
chassis at `attackBaseline`, and `attack` moves it ±50% from there. A weapon author still writes one
number and still knows what it means, and the balance table needs no second column.

### S7 — Fireball's damage is solved from the 5-second TTK target

The design target is **an average chassis kills an average chassis in ~5 seconds** with the
baseline weapon, at perfect accuracy. TTK is reckoned as `hullHP / DPS`, where
`DPS = damage * 1000 / cooldownMs` — the sustained-fire figure, which is what the tests can pin
without modelling flight time or hit rate.

Average chassis: `hp` rating 50 gives **500 hull HP**. Fireball: `cooldownMs` 500 gives **2
shots/sec**.

```
5 s = 500 hp / (damage * 2)   ->   damage = 50
```

So `fireball.damage: 8` becomes **50**. The number is derived, not chosen; if the TTK target or
`hpPerRating` ever moves, the same one-line equation re-derives it.

`repeater.damage: 5` becomes **31**, preserving its current 5:8 ratio against fireball exactly
(`50 × 5/8 = 31.25`). No car can equip `repeater` — it exists as the multi-stock reference weapon
(weapon-system spec, D5) — so there is no balance to discover here, only a ratio to keep faithful.

### S8 — Resolved damage is frozen on the instance at spawn

`WeaponInstance` gains `damage: number`, computed once in `spawnInstances` from the owner's `attack`
and the weapon def, and `resolveInstanceHits` reads `instance.damage` where it now reads
`def.damage`.

This follows the precedent already set by `ownerTeam` on the same struct, and for the same reason:
`hits.ts` tests against a snapshot of **living fighters only**, so an owner wrecked while their own
shot is still in flight has vanished from any lookup by the time the shot lands. A live
`CAR_TABLE[carIdOf(owner)]` lookup at hit time would fall back to a default chassis and silently
change a shot's damage mid-flight. Freezing also means a mid-match car change cannot retroactively
re-power a shot already in the air.

`damage` is sim-only, exactly like `ownerTeam`, `pierceLeft`, and `damageClock`. It is **not** added
to `WeaponInstanceState`: the client never computes or displays per-instance damage, and hp arrives
from the server already reduced.

Rejected alternative: **scale in `combat.ts` when applying the hit** (`damage(target, hit.amount *
mod)`). It puts the owner lookup back at hit time — the exact hazard above — and splits the
definition of "how much does this hurt" across two modules.

### S9 — Rounding happens once, at spawn

`Math.round` is applied inside `damageFor`, so the frozen instance damage is already an integer and
`applyDamage` keeps subtracting integers from a `uint16`. Rounding once at spawn — rather than per
hit — also means a piercing shot deals the identical number to every car it passes through.

At the S3 scale the rounding error is under 1% of a shot (±0.5 on ~50). On the old single-digit
numbers it would have been ~6%, which is the other reason the scale had to widen.

### S10 — No defense stat

Rams are gone and there is no healing, so weapons are the only damage source. Under those
conditions a percentage-reduction defense stat and the `hp` stat are **mathematically the same
stat** — both scale effective HP and nothing distinguishes them. Shipping two dials that mean
"survives longer" makes the roster harder to reason about and buys nothing.

The variant that *is* qualitatively different, **flat** reduction (`damage - defense`), is a known
balance trap: it scales inversely with a weapon's per-hit damage, so it would hard-counter
low-damage/high-rate weapons — a tank with meaningful flat defense is literally immune to
`repeater`. Not worth introducing while the weapon table has two entries.

Recorded as a live option in [Future work](#future-work), not a closed door.

### S11 — Client stat presentation follows the rename

`CAR_BARS` becomes `["speed", "attack", "hp"]`; the `BAR_LABELS` entry "Power" becomes "Attack" and
its `BAR_ICONS` sword glyph moves with it under the new key. `StatBar.percent` is now the rating
**verbatim** — the `* 10` in `carSelectView` is deleted, along with the "straight from the raw 0-10
rating" comment on the field.

The full-stats panel's **"Ram damage"** row is replaced by a **per-weapon damage** row for each
weapon in the chassis loadout, derived through the same `damageFor` the sim uses — never
transcribed. That keeps the panel's existing rule (every number derived from shared config, so
retuning moves the screen and the sim together) and makes the new stat legible at the point the
player picks a car. `"Hit cooldown"`, which reported `collisionDamageCooldownTicks`, is deleted with
the constant.

---

## Numbers

### Roster

| Car | speed | attack | hp | top speed | hull HP | fireball damage | DPS |
|---|---|---|---|---|---|---|---|
| `rectangle` | 80 | 30 | 40 | 540 u/s | 400 | 40 | 80 |
| `oval` | 50 | 70 | 30 | 405 u/s | 300 | 60 | 120 |
| `hexagon` | 30 | 50 | 70 | 315 u/s | 700 | 50 | 100 |
| *(average)* | *50* | *50* | *50* | *405 u/s* | *500* | *50* | *100* |

Each row sums to 150. Top speeds are identical to today's. Chassis identities are preserved:
`rectangle` fastest and weakest-hitting, `oval` the glass cannon, `hexagon` the tank.

### TTK matrix

Seconds for the row to kill the column, at perfect accuracy, `hullHP / DPS`:

| row kills column | rectangle | oval | hexagon |
|---|---|---|---|
| **rectangle** | 5.00 | 3.75 | 8.75 |
| **oval** | 3.33 | **2.50** | 5.83 |
| **hexagon** | 4.00 | 3.00 | 7.00 |

Average-vs-average is **5.00 s**, the design target, and it is the value the test pins.

Two known outliers, both accepted as roster tuning rather than formula faults:

- **oval mirror, 2.50 s** — the shortest fight in the game. Two glass cannons trading is *supposed*
  to be fast; moving `oval` to `50 / 65 / 35` softens it if it plays badly.
- **rectangle beats hexagon in 8.75 s** — the speedster has no damage answer to the tank, only
  kiting. This is the intended extreme of the matchup triangle.

Real fights run longer than every figure here: these assume no miss, no flight time, and no
obstacle.

---

## Blast radius

**Shared** — `config/types.ts` (`CarDef.attack`), `config/car-config.ts` (roster, and `hpOf`
unchanged in shape), `config/combat-config.ts` (four keys out, two in), `config/drive-config.ts`
(`speedPerRating` and its doc comment), `config/weapon-config.ts` (two `damage` values), a new
`damageFor` helper,
`sim/ram.ts` (deleted), `sim/combat.ts` (phase 5 and `ramCooldowns` out),
`sim/weapons/instances.ts` (`damage` on `WeaponInstance`, computed in `spawnInstances`),
`sim/weapons/hits.ts` (one line: `def.damage` becomes `instance.damage`).

**Server** — `sim/combat-bridge.ts` (2 sites) and `rooms/ArenaRoom.ts` (4) lose `ramCooldowns`. No
schema change, so no client/server version skew beyond the usual shared-`dist` rebuild.

**Client** — `ui/car-select-view.ts` and `ui/screens/car-select.ts` per S11. Nothing in the
prediction path touches damage, so `ArenaScene` and the reconciler are unaffected.

**Docs** — `docs/combat-model.md` (the "Ramming" section and its "Contact, not interpenetration"
subsection are deleted; a new section documents `damageFor`), `docs/config-reference.md` (the
`CAR_TABLE` table and its derived-values note), `docs/schema-reference.md` (only if it mentions ram
cooldowns), and a status line on the two weapon-system spec docs noting that D-decisions referencing
ram damage are superseded here.

**Tests that must move** — the ram blocks in `sim/combat.test.ts` (including the
"ramming, driven through the real sim" regression block) and all of `sim/ram.test.ts` are deleted.
`config/config.test.ts` pins the old ratings and gains the budget invariant. The fixture documented
at `combat-model.md:345`, which balances a shot landing against `ramContactPad` *not* firing a ram
on the same tick, loses that second half and simplifies.

---

## Testing

1. **`damageFor` unit tests** — 1.0× at `attackBaseline`; 0.5× at 0 and 1.5× at 100; rounding to
   integers; monotonic in `attack`; a zero-damage weapon stays zero.
2. **The TTK anchor** — a test asserting that an average chassis (500 hp) against `fireball` at
   `attackBaseline` yields exactly 5.00 s under `hullHP / DPS`. This is the spec's headline number
   and it should fail loudly if any of `hpPerRating`, `attackBaseline`, `damagePerAttack`, or
   `fireball.damage` drifts.
3. **The 150-point budget** — every `CAR_TABLE` row sums to 150 and every rating is an integer in
   0–100.
4. **Speeds are unchanged** — `forwardMaxSpeedOf` returns 540 / 405 / 315, the same values pinned
   today, proving S4's re-scale cancelled.
5. **Per-chassis damage through the real sim** — the same weapon deals 40, 60, and 50 depending on
   the firing chassis, asserted through `stepSim` rather than by calling `damageFor`.
6. **Damage is frozen at spawn** — a shot in flight whose owner is wrecked mid-flight still deals
   its owner's chassis damage.
7. **No contact deals damage** — two cars driven into each other through `stepSim`, head-on and
   rear-end, both at full hp afterwards; they still separate, proving collision physics survived.

---

## Future work

- **Per-weapon `attackScaling`** — a coefficient on `WeaponDef` (default 1.0) multiplying the S5
  modifier, so a sniper can scale hard with `attack` while a spray weapon barely does. The League of
  Legends shape. Deliberately omitted: with two weapons authored and one unequippable, it is a knob
  with nothing to tune against.
- **A defense stat** — see S10. If it lands, the open question is percentage vs flat, and flat needs
  a floor to stay non-degenerate.
- **`attack` scaling with the in-match level** — `PlayerState.level` and `WeaponDef.unlocksAt`
  already exist. `damageFor` is the single seam a level term would enter through.
- **A damage-number HUD** — now that the same weapon hits for different amounts, the player has no
  way to see it. Out of scope here; the data is server-side and would need a schema field.
