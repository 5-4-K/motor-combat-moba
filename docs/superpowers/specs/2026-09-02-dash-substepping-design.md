# Motor Combat MOBA — Dash Substepping Design

**Designed:** 2026-09-02 · **Recorded in repo:** 2026-09-02
**Status:** Specified, not implemented.
**Builds on:** the maneuver layer (S3) from
[`2026-08-27-weapon-system-design.md`](2026-08-27-weapon-system-design.md), whose `ManeuverKind.DASH`
and `endDash` lifecycle this leaves intact.

Decisions are numbered **C1–C18** and referenced by number elsewhere.

**This is a drive-model change.** Root `CLAUDE.md` requires stopping to ask before one. The question
was put and answered: the substep approach was chosen over rescaling `thunderclap.speed` (which
narrows the failure band without closing it) and over a full swept/CCD resolver (which rewrites
`resolveWorld`). That approval is what this spec is written under.

---

## Problem

`thunderclap.speed` is 1600 u/s. At `TICK_RATE_HZ` 30 that is **53.3 units of travel per tick**,
against a car hull of **48 × 32**. The dash moves more than a full car length per tick, and the
translation in `stepDash` is a raw teleport with no intermediate test:

```ts
x: body.x + Math.cos(body.maneuverAngle) * body.maneuverSpeed * dt,
```

So on the tick contact happens, the dasher is already deep inside the target. `resolveWorld` then
calls `mtvBetween`, which by construction returns the **minimum** translation out of the overlap —
the cheapest way out, which for a deep overlap is not the way the car came in. Only afterwards does
`resolveContacts` notice the touch and `ram-bridge`'s `endDash` stop the dash. The hit lands
correctly; the car does not.

### Measured

A sweep of the full 53.3 u of sub-tick phase, head-on, both cars axis-aligned, against the real
`stepSim`. 25 samples, `dx`/`dy` relative to the target's centre:

| Phase band | Resolved position | Result | Count |
|---|---|---|---|
| `raw dx` −36.7 … −16.7 | `dx` −48, `dy` 0 | pushed back, stops in front ✅ | 10/25 |
| `raw dx` −14.4 … −1.1 | `dx` unchanged, `dy` **32** | ejected sideways, left level with the target | 7/25 |
| `raw dx` +1.1 … +14.4 | `dx` unchanged, `dy` **32** | ejected sideways, ends **past** the target | 7/25 |
| `raw dx` +16.7 | `dx` **+48**, `dy` 0 | pushed out the **far side** | 1/25 |

**60% of approach phases end with the dasher beside or past the car it just hit.** The outcome is
fully deterministic in the sub-tick phase, which is why it reads as intermittent in play.

The arithmetic behind the bands: for two axis-aligned cars the x-axis escape depth is `48 − |dx|`
and the y-axis escape depth is `32`. The x push — the correct, backwards one — wins only while
`|dx| > 16`. First contact is at `|dx| = 48`. So there is a **32-unit-wide band in which the
resolver behaves correctly**, and a 53.3 u step jumps clean over it.

### Two things this also explains

- The standing playtest finding `thunderclap 22/24 approach angles dealt nothing at contact range
  <- POINT-BLANK MISS` (`playtest/reports/*/weapons2.md`) is the same root cause: the dasher ends the
  tick at a pose where `contactNormalBetween`'s pad test fails.
- It is **not** a netcode artifact. The client predicts through the same `stepSim` at the same 30 Hz
  and computes the identical wrong ejection, so reconciliation has nothing to correct. It looks the
  same to the host and to a remote player, and a clean LAN does not improve it.

### How it got this bad

Both landed on 2026-09-01, in this order: `a9c7963` authored `speed: 1600`, then `b3c877e` **halved
every car's top speed** (`baseMaxSpeed` 180→90, `speedPerRating` 4.5→2.25) without rescaling the
dash. Ordinary driving now tops out at ~315 u/s = 10.5 u/tick, so the dash is the only thing in the
game that moves faster than a fifth of a car length per tick — 5× the fastest car, where it was
~2.5× before.

---

## Scope

**In:** substepping the DASH translation inside `stepSim`; splitting `stepDash` so its per-tick
bookkeeping stays per-tick; one new `DRIVE_CONFIG` key; a regression test; two probe expectation
updates; a manual rebuild.

**Out:** the OBB hitbox model, the SAT/MTV resolver itself, `resolveWorld`'s resolve ordering or
restitution, the collision-damage rules, friendly fire, `thunderclap`'s balance numbers (`speed`
stays 1600, `range` stays 400), the contact pass, `dashHit`/`endDash`, and the wall-blocked-dash
lifecycle.

---

## The mechanism

### C1. The resolver is not wrong; it is being asked the wrong question

`mtvBetween` answers "what is the shortest way out of this overlap." Stopping a fast mover needs
"where along its path did it first touch." Those coincide for a shallow contact and diverge for a
deep one. Nothing in `resolveWorld` knows where the body came from, and giving it that knowledge
means an entry-normal or a swept hull — a rewrite of the resolver and its ordering contract.

### C2. Bound the penetration depth instead

If no single translation can bury the car deeper than the resolver's correct band, "shortest way
out" and "back the way you came" stay the same direction and the existing resolver is already right.
This changes how far the body moves between checks, and changes nothing about how a check is
answered.

### C3. The substep count is derived from distance, not fixed

```
N = max(1, ceil(travelThisTick / DRIVE_CONFIG.dashSubstepMaxUnits))
```

At 53.3 u and a 16 u bound, `N = 4`. Deriving it rather than hardcoding it means the value stays
correct if `thunderclap.speed`, `TICK_RATE_HZ`, or the hull dimensions are ever retuned — including
by option 3 of the original triage, should the dash also be rescaled later.

### C4. The bound is half the **smallest** hull dimension

`carHeight / 2` = 16, not `carWidth / 2` = 24 and not an average. A car may be at any angle, so the
32-unit face can always be the competing escape axis; sizing against the 48-unit face would leave
rotated approaches unprotected. This is the standard "never move more than half the thinnest
feature per step" bound, and it is what makes the 32-wide correct band unskippable: from clear
(`|dx| ≥ 48`) the next sample lands at `|dx| ≥ 32`, inside the band.

### C5. The loop lives in `stepSim`, not `stepDrive`

Two reasons, both structural:

1. `stepDrive` is deliberately **world-free** — it never sees `others`, `obstacles` or `bounds`, and
   that is what keeps it roster-free and unit-testable. `resolveWorld` owns the world. Only their
   caller sees both.
2. `stepSim` is the lockstep seam (invariant 4). Server tick and client prediction import the same
   function, so putting the loop there means both halves change together and prediction stays
   consistent for free. In the server bridge it would desync prediction.

### C6. Per-tick bookkeeping runs exactly once

`stepDash` currently fuses the translation with per-tick state that must **not** run N times:
`maneuverTicksLeft − 1`, the `done` exit-speed handoff, `decayShove`, `recoverAuthority`,
`nextAngVel`. Four substeps of the current function would burn the dash's duration and decay knock
four times as fast.

`stepDash` therefore splits: the bookkeeping stays a once-per-tick operation, and the `x`/`y` line
becomes a translation `stepSim` can apply N times with `dt / N`. The sum of N translations equals
today's single translation exactly in free air (`N × v × dt/N = v × dt`), so an uncontested dash is
arithmetically unchanged.

### C7. Substeps resolve against a frozen world

`ctx.others`, `ctx.obstacles` and `ctx.bounds` are sampled once for the tick and held across all
substeps. Other cars do not advance between them. This is already the existing contract — every car
is stepped against the same start-of-tick snapshot — and re-reading mid-tick would make the outcome
depend on iteration order.

### C8. A blocked substep does not abort the remaining substeps

Once the dasher is stopped, later substeps translate into the target again and are pushed back out
again, so the car settles flush against the contact surface. The alternative — detecting "made no
progress" and breaking early — needs a float-epsilon comparison for no behavioural gain, since the
settled position is the same either way.

### C9. Repeated restitution within one tick is acceptable **because it is a dash**, and this is why the loop is gated

`applyContact` damps `speed` and reflects `shoveX/shoveY` on every call, and `resolveWorld`'s
contract is explicit that each distinct surface must damp exactly once, "never r² or r³". N
substeps against one surface would damp N times.

For a dash this is harmless: `speed` is not the dash's motion source (`maneuverSpeed` is), and
`endDash` overwrites `speed` outright on the tick the hit lands. For ordinary driving it would not
be harmless — it would silently break that contract.

So the loop is **gated on `maneuver === ManeuverKind.DASH`** explicitly, even though C3's formula
would independently yield `N = 1` for every other body in the game (~10.5 u/tick at the roster's
top speed). Belt and braces, and the gate documents the intent.

### C10. Obstacles and bounds come along for free, and gain a structural margin

`resolveWorld` resolves cars, obstacles and bounds in one loop, so substepping bounds penetration
against all three. The thinnest obstacle in the roster today is 120 units (`arena-02`), so a 53.3 u
step cannot pass its midpoint and obstacles are not currently affected — but that safety is
incidental, a 2.25× margin that a thinner obstacle or a faster dash would erase. After this change
it is structural. The dash's own wall behaviour (`wallBlockedDashers` → `endDash(player, 0)`) is
unchanged and still runs once per tick in the contact pass.

---

## Config

### C11. One new key in `DRIVE_CONFIG`

```ts
/** Max world units a dash may translate between collision checks. Half the car's SHORT axis. */
dashSubstepMaxUnits: 16,
```

It lives in shared config rather than as a literal because invariant 2 forbids magic numbers in
logic. It belongs to `DRIVE_CONFIG` rather than a weapon row because it is a property of the
collision resolver's correct band, not of any one weapon — a second dash weapon would inherit it.

`config.test.ts` pins it to the hull: `dashSubstepMaxUnits <= min(carWidth, carHeight) / 2`, so
shrinking a car without revisiting this fails the suite rather than quietly reopening the bug.

---

## Behaviour

### C12. The dash now stops on first contact every time, and that is a gameplay change

Today thunderclap stops at first contact for 40% of approach phases and passes through for the rest.
Afterwards it stops for all of them. Mirage becomes a gap-closer that reliably plants the driver in
front of the target rather than one that sometimes ends up behind it.

This is intended, but it is a design change and not only a bug fix: whatever value the pass-through
had as a disengage or repositioning tool is removed. If reliable pass-through is wanted, it should be
authored deliberately — a `maneuver.piercesCars` flag alongside the existing `piercesWalls`, which
this spec does **not** introduce.

### C13. Free-air dash distance is unchanged

`maneuverTicksLeft` is untouched, `maneuverSpeed` is untouched, and C6 makes the summed translation
identical. An uncontested dash still covers 400 units in 8 ticks. Only the contact case changes.

---

## Testing

### C14. The regression test is a sub-tick phase sweep, and it must sweep angles too

A new case in `collide.test.ts` or `step.test.ts` that, for a dasher approaching a stationary target:

- sweeps the full sub-tick phase in at least 24 steps across one tick of dash travel, and
- repeats that sweep across a range of approach angles and target orientations, not head-on only,

asserting that the dasher never ends a tick **inside** the target's hull and never ends it **past**
the target's centre along its own dash axis.

The phase sweep is not optional detail. A single placement measures one arbitrary point on the tick
grid and would have passed against the current, broken code for 10 of the 25 phases measured above —
this is the same rule the playtest probes are built on.

A working sweep already exists from the investigation and can seed this test.

### C15. `golden.test.ts` is unaffected, and that is checkable

Its fixture carries `maneuver: 0`, so no dash path runs in it and the frozen values do not move. If
a future fixture gains a dash, the values move and must be regenerated deliberately rather than
reflexively.

### C16. The existing dash tests must pass unchanged

`drive.test.ts`'s free-air dash cases pin the arithmetic C6 preserves. They are the check that the
split of `stepDash` did not change what an uncontested dash does. They must not be edited to
accommodate the change.

---

## Impact on the probes and the manual

### C17. Two probes measure this, and one of them should flip to OK

- `playtest/weapons2.ts` — the point-blank approach-angle scenario currently reports
  `thunderclap 22/24 approach angles dealt nothing at contact range`. This change is expected to fix
  it. **Update the expectation so the fix reads as `OK`; do not delete the probe.**
- `playtest/weapons.ts` — the maneuver-reach row (its comment notes the dash "carries the car to the
  target and must land its hit"). Its numbers move.

**An `npm run playtest` run is recommended after implementation**, and reading what moved is the
user's call. No new probe or scenario is to be created.

### C18. The manual must be rebuilt

`balanceStamp` hashes `DRIVE_CONFIG` **whole** via `JSON.stringify`, so adding `dashSubstepMaxUnits`
moves the fingerprint even though no player-facing number changes. `scripts/manual-page.test.mjs`
will fail until `npm run build:manual` is run and the page committed.

`docs/turn-tuning.md` is **not** affected: `scripts/turn-tuning-doc.test.mjs` reads six named
`DRIVE_CONFIG` fields (`baseTurnRate`, `turnRatePerRating`, `stopTurnRatio`, `baseMaxSpeed`,
`speedPerRating`, `reverseSpeedRatio`), none of which change, and does not enumerate the object's
keys.

---

## Summary of new and changed surfaces

**Shared — new:** `DRIVE_CONFIG.dashSubstepMaxUnits`; a translation-only dash helper factored out of
`stepDash`; a `config.test.ts` assertion tying the bound to the hull.

**Shared — changed:** `stepSim` (a DASH-gated substep loop around `resolveWorld`); `stepDash` (split,
same behaviour).

**Shared — untouched:** `resolveWorld`, `mtvBetween`, `applyContact`, the resolve ordering,
`carHullOf`, the OBB dimensions, `resolveContacts`, `WEAPON_TABLE`, `CAR_TABLE`, `TICK_RATE_HZ`.

**Server — untouched:** `ArenaRoom.tick`, the tick order, `ram-bridge`'s `endDash`,
`wallBlockedDashers`. The fix is entirely below the bridge.

**Client — untouched:** prediction inherits the fix through `stepSim` (C5). No render change.

**Repo chores:** `npm run build:manual` + commit the page (C18); two probe expectation updates and a
recommended `npm run playtest` (C17).
