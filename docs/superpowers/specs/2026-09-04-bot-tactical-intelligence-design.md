# Bot tactical intelligence — design

**Date:** 2026-09-04
**Status:** design approved
**Supersedes:** H9–H15 (named stances and desire-blend movement) of
[`2026-09-04-human-like-bot-behavior-design.md`](2026-09-04-human-like-bot-behavior-design.md).
H1–H8, H16–H48, fairness, determinism, personalities, ternary steer/throttle, and “no pathfinding /
no ArenaRoom bots” stand. Decisions here are numbered **G1–G28**.

---

## 1. The problem

The 2026-09-04 human-like brain is shipped and still feels random, including on `hard`. That brain
fakes human *noise* (latency, blunders, personality, FOV) around a thin plan:

- `hunt` and `reposition` drive to the **arena centre**.
- `engage` blends “face the intercept” (weight 1) + orbit (hard `orbitBias` 0.75) + dodge (hardcoded
  weight 2.5). Dodge wins. The result weaves.
- Preferred range is a derived standoff. The kit is not read as tactics: no stun-then-dump, no lock
  wait, no last-known hunt, no wall pin. `ultIsSpent` is recorded and never consumed.

Easy, medium and hard therefore still look like the same circling moth at different speeds. The
acceptance test this pass has to pass is the one H1–H2 already named: watching a match, a player
should say *what kind of player* that bot is.

- **Easy** — a new player: drives at what it sees, mashes, fights to zero, forgets you quickly.
- **Medium** — an experienced casual: holds kit range, sometimes sets up a stun, retreats when hurt.
- **Hard** — a strong human, not a cheat: combos, intercepts, pins, waits for lock, sidesteps without
  abandoning the approach.

**G1. Weakness remains worse decisions (H1).** No damage, speed, or post-aim miss handicaps.

**G2. Hard remains a strong human (H2).** No fourth tier. No clairvoyance (enemy stocks, `pressId`,
`lastDamagerSessionId`).

**G3. A tier is still data (H8).** No module under `bot/brain/` branches on `profileId`. New
behaviours are gated by profile numbers.

---

## 2. Architecture

**G4. Goals replace stances.** The assess layer still scores a closed catalog and holds a winner for
a commitment window. The catalog is *tasks*, not moods. `engage` / `brawl` / `kite` / `disengage` /
`reposition` / `hunt` / `recover` cease to exist as names.

**G5. Five layers, one `decide` call, same cadence as H5–H6.**

```
perceive (every tick)
  → assess: target → kit roles from WeaponDef → score goals → hold one
  → move: serve that goal (one heading, one range) + wall + dodge overlays
  → shoot: fire in service of the held goal
  → humanize (every tick)
```

**G6. A goal publishes `{ headingRad, preferredRange, closing, mayFire }`.** Movement serves that
primary (weight 1). Overlays may deflect heading; they do not replace the goal.

**G7. Commitment and pre-emption are H10 with new names.** Hold for `goalCommitTicks` (rename of
`stanceCommitTicks`; values stay 45 / 30 / 18). Exactly three pre-emptions: control lost (`recover`),
hp crossing `retreatHpFraction` (`reset`), target gone (`huntLastKnown`). Dodging is not a
pre-emption.

**G8. Combo is emergent.** `setupCc` fires a stun → the target is stunned → `dump` wins the next
score. There is no combo state machine, no playbook file, and no `carId` branch under `brain/`.

**G9. Debug overlay prints the goal and its scoreboard (H12).** `BotDebug.stance` / `stanceScores`
become `goal` / `goalScores`. The playground wire (`BotDebugPayload`) follows. A missing score still
means “not on the table” (`-Infinity` is dropped, JSON cannot carry it).

---

## 3. Kit roles

**G10. `rolesOf(slots)` derives tactics from live `WeaponDef` rows.** No new weapon-table fields. A
new weapon inherits behaviour from its row. Tremor (uncarried) is still classified so the mapping
cannot silently rot.

| Role | Derived from | Current rows |
|---|---|---|
| `setupCc` | `applies` includes `stunned` on `opponents` | `roadblock`, `thunderclap` |
| `contact` | `kind === "maneuver"` | `thunderclap` (dash), `wildcharge` (charge) |
| `lockAim` | `usesAimAssist === true` | `predator`, `magmablast`, `thunderclap`, `thumper` |
| `lockHoming` | `homing.acquire === "lock"` | none on the current roster |
| `shotgun` | `pellets.pelletsPerVolley > 1` | `pepperbox` |
| `explosion` | `explosion` present | `magmablast` |
| `holdBeam` | `holdsDuringFire` | `lance` |
| `slow` | `applies` includes `spiked` on `opponents` | `thumper`, `tremor` |

`predator` is proximity-homing *and* aim-assisted. Lock-wait (G20) keys off `lockAim` / the HUD
lock, not `homing.acquire === "lock"`. `wildcharge` stuns on a wall slam, not via `applies`; it is
`contact`, not `setupCc`.

`rolesOf` reports slot indices for the roles that firing has to press (`setupCcSlot`, `contactSlot`)
and arrays for the rest.

---

## 4. Goal catalog

**G11. The catalog is closed.**

| Goal | Chosen when | Movement | Fire |
|---|---|---|---|
| `recover` | dead or `phased` | coast | nothing |
| `huntLastKnown` | no living unphased target | last-known + velocity; else heard shot; else quadrant search. **Never the arena centre.** | hold |
| `rush` | a target exists (easy’s default) | bearing to target, close | mash `chooseSlot` |
| `holdRange` | skirmish, no better tactic | kit-derived range; orbit is a *lateral offset on this goal only* | `chooseSlot` |
| `intercept` | need to cut them off | drive to where they will be (lead for the *body*) | `chooseSlot` |
| `setupCc` | setupCc slot ready, target not stunned | geometry that weapon wants (dash range vs projectile range) | **that** CC slot |
| `dump` | target stunned, or low HP with an ult ready, or their ult just seen spent | close to dump range | damage / ult, skip another setup |
| `contact` | contact slot ready, or ram committed | close to `contactTriggerUnits`, face them | the maneuver (or ram) |
| `reset` | HP below `retreatHpFraction`, or much closer than preferred | back off, keep them in arc | still shoot |
| `pinWall` | target near a bound and we have contact/dump | put them between us and the wall | contact / dump |
| `unpin` | we are the one on the wall | heading to open floor, **still shooting** | `chooseSlot` |

Scoring uses the new weights (section 7) plus the existing `scoreNoiseSigma` draw (exactly one,
always, H21). Impossible goals score `-Infinity` and drop off the overlay.

First-pass score sketch (noise omitted):

- `recover` 100 when control is lost, else off the table.
- no target → only `huntLastKnown` (plus recover).
- `rush` = `rushWeight`.
- `holdRange` = 5 (home for medium).
- `intercept` = `interceptWeight`.
- `setupCc` = `setupWeight` + 2 when the slot is ready and the target is not stunned; else off.
- `dump` = `dumpWeight` + 3 when stunned, + 2 when target hp ≤ `ultWindowHpFraction` and an ult is
  ready, + 2 when `ultIsSpent` (G21); a small base otherwise so dump can still win a close call.
- `contact` = 8 when contact-ready or `wantsRam`, else off.
- `reset` = 8 when hp < `retreatHpFraction` (and that fraction is > 0), else 6 when
  `distance < preferredRange * 0.6`, else off for the retreat clause.
- `pinWall` = `pinWeight` + 2 when the target is within `wallLookaheadUnits` of a bound and
  contact/dump apply; else off.
- `unpin` = 7 when `pinnedOnWall`, else off.

Easy’s `rushWeight` 8 beats `holdRange` 5. Hard’s `setupWeight` 7 / `dumpWeight` 9 beat rush 0.4.

---

## 5. Hunt and acquire

**G12. Hunt never seeks the arena centre.** Three cues, in order:

1. **Last known** — perception already keeps `KnownCar` until `memoryTicks`. Drive at
   `pos + vel × (tick − lastSeenTick) / TICK_RATE_HZ`. Velocity is `(cos(angle) × speed, sin(angle) × speed)`.
2. **Heard a shot** — nearest live instance (or `observedFires` if a host supplies them) whose owner
   is not self. Gated on `hearChance`, rolled **once per hunt episode** (the stretch with no target),
   not per tick — the same per-opportunity rule as dodge/ram/ult (H25/H30/H40). Easy often ignores;
   hard always uses.
3. **Search** — commit to one quadrant waypoint at (0.25 or 0.75) × arena width/height. Arrive
   (within `minEngageUnits`), pick another of the four. Never `(width/2, height/2)` as a standing order.

A `phased` opponent is not a target. If they are still on screen, cue 1 is their visible pose — a
human sees the respawn.

**G13. Acquire delay is not a hunt.** A car that is visible but not yet `noticedAtTick` must not skip
acquire (that would cheat) and must not seek the centre. Continue the previous heading (or coast).
`controller.test.ts` currently asserts hunt-to-centre; that test is rewritten so centre-seeking
fails the suite.

**G14. Host wiring (H48) is verify-not-rebuild.** PracticeRoom and PlaygroundRoom already construct a
`ViewRing` and pass `observedFires`. If that is still true at implementation time, consume
`ultIsSpent` only — do not re-plumb. Hear-toward-shot reads `view.instances` (already on the view).

---

## 6. Movement

**G15. One primary heading.** The goal’s `headingRad` has weight 1. `blendHeading` remains, with the
H14 fallback (previous heading when the blend cancels).

**G16. Dodge is a deflection.** Replace hardcoded `DODGE_WEIGHT = 2.5` with profile `dodgeWeight`
(0.4 / 0.6 / 0.8 — monotonic up the ladder, always below the goal’s 1). Throttle still serves the
goal: a pro sidesteps without abandoning the approach.

**G17. Attached beams aimed at the bot are threats.** Today `threatHeading` returns undefined when
`speed <= 0`, so Hard weaves off `predator` and sits in `lance` / `afterburner`. An attached beam
(`kind === "beam"` and `attached`) whose heading passes within the existing lateral threshold inside
`dodgeHorizonTicks` is a threat. Same once-per-instance `dodgeChance` roll. Still a desire, not a
goal. Detached beams and explosions are not this pass.

**G18. Orbit is not a competing vector.** `orbitDesire` is applied only on `holdRange`, as a small
lateral offset, scaled by existing `orbitBias`. Easy’s 0 means they never circle.

**G19. Deadband coast only on `holdRange`.** `rush` / `contact` / `dump` / `huntLastKnown` / `intercept`
/ `pinWall` / `unpin` throttle forward until they are in the window (`closing: false` or a range
check that still drives in). `reset` uses `closing: true` so reverse can open range while facing.
Idle fidget (H43) fires **only on `recover`**, not whenever `target === undefined` (that fidget
during hunt is part of today’s wandering).

`steer` / `throttle` stay ternary. `reduceToIntent` stays the only converter. No pathfinding:
arena-01 has no obstacles.

---

## 7. Shooting

**G20. `chooseSlot` reads the held goal.**

- `setupCc` → that stun slot, if in range and aimed.
- `dump` → damage / ult; skip another setup slot unless it is the only ready shot.
- `contact` → the maneuver slot.
- `rush` / `holdRange` / `intercept` / `reset` / `unpin` / `pinWall` → current ranking + discipline.
- `huntLastKnown` / `recover` → hold fire (`mayFire` is already false).

One slot per press (H27). Per-episode ult hold (H30). Draw order unchanged (H21): the two rng draws
in `chooseSlot` still happen every call, including when the goal will discard the result.

**G21. Lock-aim wait.** A `lockAim` slot on a disciplined tier holds unless
`self.lockTargetSessionId === target.sessionId`. Easy’s `fireDisciplineChance` ~0 means they mash
without a lock. Reading our own HUD lock is fair.

**G22. Consume `ultIsSpent` (H22).** Hard’s `dump` scores higher when the target was seen spending a
weapon with `cooldownMs >= ultCooldownMs` inside `memoryTicks`. Easy’s `dumpWeight` is 1 and they
almost never win dump over rush, so the seam is live without making easy look like a pro. The
remembering stays perception’s job; scoring is the first consumer.

---

## 8. Parameter table

**G23. New knobs, first pass.** Added to `BotProfile`. Existing knobs keep their jobs, with two
meaning changes: `orbitBias` only applies on `holdRange`; `stanceCommitTicks` is renamed
`goalCommitTicks`.

| Field | easy | medium | hard | ladder |
|---|---|---|---|---|
| `rushWeight` | 8 | 2 | 0.4 | falls |
| `interceptWeight` | 0 | 2 | 5 | rises |
| `setupWeight` | 0 | 4 | 7 | rises |
| `dumpWeight` | 1 | 5 | 9 | rises |
| `pinWeight` | 0 | 1 | 6 | rises |
| `hearChance` | 0.15 | 0.55 | 1 | rises (probability) |
| `dodgeWeight` | 0.4 | 0.6 | 0.8 | rises (always < 1) |
| `goalCommitTicks` | 45 | 30 | 18 | falls |

`BOT_BRAIN_VERSION` bumps to **2.0.0**: goals replace stances, movement and hunt rewrite, ult memory
consumed. The table hash cannot see that.

**G24. Personality still jitters inside the tier band (H47).** Additional shifts:

- `brawler` — `rushWeight` × 1.25, `setupWeight` × 0.8
- `kiter` — `rushWeight` × 0.8, `interceptWeight` × 1.25 (plus existing standoff/orbit/retreat/ram)
- `opportunist` — `dumpWeight` × 1.25

Score weights are not unit-interval. `hearChance` is.

---

## 9. Testing

**G25. Characterisation that pins the feel** (extend `tiers.test.ts`; rewrite stance tests as goal
tests):

- Easy vs a visible target: `rush`, throttle forward, no orbit.
- Hard Bastion, `roadblock` ready, target not stunned: `setupCc`; after stun: `dump`.
- Target leaves awareness: heading toward last-known, **not** arena centre.
- Acquire delay with a visible-but-unnoticed car: does not seek the centre.
- Never-seen, no shots: quadrant waypoint, not `(width/2, height/2)`.
- Hard under fire: still closing (dodge did not flip throttle off the goal).
- Predator: Hard waits for lock; Easy may fire without.
- Nine weapons (plus `tremor`) → expected `rolesOf`.
- Same seed → identical intent stream (H21).
- Existing: Easy burns ult / Hard holds; Hard `reset` when hurt; wall → Hard `unpin`; H27 one bit;
  dodge still changes Hard’s steer.

The wall test’s hunt-to-centre warm-up comments are lies after this pass; retarget at `unpin`.

**G26. `bot-profiles.test.ts` `LADDER` stays a total record** over `BotProfile`. Adding a knob
without a direction is a compile error.

---

## 10. Documentation and hosts

**G27.** Rewrite [`docs/bot-behavior.md`](../../bot-behavior.md) for goals, the new knobs, hunt cues,
and the overlay’s `goal` line. Root `CLAUDE.md` bot paragraph: five layers, a tier is data, one slot
per tick; stances become goals. The 2026-09-04 spec’s H9 table is historical; this spec is what the
brain does.

Playground overlay copy in `overlay.ts` and `isBotDebugPayload`’s closed list of ids must agree.

**G28. Out of scope, unchanged.** No pathfinding, no analog steer, no fourth difficulty, no
learning, no chassis playbooks, no bots in `ArenaRoom`, no damage/speed handicaps. Playtest probes
do not import this brain — do not touch them. Balance reports become non-comparable (`botFingerprint`
will refuse). Recommend `npm run balance` after ship; do not run it as part of this work. Practice
1v1 is the acceptance test.

---

## 11. What this disturbs

- Every characterisation test that names a stance.
- `BotDebug` / `BotDebugPayload` / playground overlay (dev-only wire).
- `BOT_BRAIN_VERSION` 1.1.0 → 2.0.0; every prior balance report is incomparable.
- `stance.ts` is deleted; `goals.ts` absorbs `scoreTargets`.
