# Motor Combat MOBA — FFA Game Modes Design

**Designed:** 2026-09-01 · **Recorded in repo:** 2026-09-01
**Status:** Implemented.
**Builds on:** [`2026-08-29-status-mechanism-design.md`](2026-08-29-status-mechanism-design.md),
whose duration layer and room-application seam this uses rather than duplicates.

Decisions are numbered **M1–M33** and referenced by number elsewhere.

---

## Problem

The game has exactly one way to end: the last side still alive wins. That rule is hardwired into
`livingSides`, and death is terminal — a wrecked car is intangible, frozen, and spectating until the
match ends.

For a six-player LAN game that produces a specific failure: the first player eliminated has nothing
to do for the rest of the match. The better the other five are, the longer they wait.

**Deathmatch** is the answer. A timed mode where death costs you five seconds instead of the match,
and the winner is whoever scored the most kills. It sits beside the existing rules as a host-chosen
lobby setting, not as a replacement.

---

## Scope

In: a third lobby mode, respawning, kill attribution, a match timer, spawn protection, and the
score surfaces that go with them.

Out: assists, team deathmatch, kill limits ("first to 15"), killstreaks, pickups, and any change to
the drive model, the OBB hitbox model, or the collision-damage rules.

---

## The game-design case

### M1. The new axis is the win condition, not the side structure

`GameMode` already exists and already means something: FFA versus Team. Deathmatch is not a third
answer to that question — it is an answer to a *different* question, "what ends the match."

Two axes, then. The honest options were to make them orthogonal (a side structure and a win
condition, picked separately, giving four combinations) or to flatten them into one list.

**Flattened.** Deathmatch is FFA-only for now, so an orthogonal model would spend a second networked
field, a second lobby control and a team-score aggregation on making three legal combinations and
one illegal one reachable. A flat list has no illegal states to guard.

The enum gains a third value:

```ts
export enum GameMode {
  FFA_LAST_STANDING = 0,   // renamed from FFA; the wire value is unchanged
  TEAM = 1,
  FFA_DEATHMATCH = 2,
}
```

`FFA` → `FFA_LAST_STANDING` is a **source rename only**. The value stays `0`, per hard invariant 7:
enum uint8 values are explicit and stable and are never renumbered. A client built before this change
and one built after still agree on what `0` means.

Team Deathmatch, if it is ever wanted, is a fourth entry and a team-sum in one function. Nothing here
forecloses it.

### M2. Every existing consumer reads a derivation, not the enum

Two pure functions replace direct comparisons against `GameMode`:

| Function | Result | Read by |
|---|---|---|
| `sidesOf(mode)` | `"ffa" \| "team"` | `canDamage`, `assignSpawns`, `livingSides` |
| `winRuleOf(mode)` | `"last_standing" \| "deathmatch"` | the room's end-of-match check, and nothing else |

`sidesOf` replaces today's `toFlowMode` and maps `FFA_DEATHMATCH` to `"ffa"`. That is the whole
reason friendly fire, spawn assignment and the living-sides count need **no modification at all**:
they receive precisely what they receive today.

`winRuleOf` is the new axis, and it is deliberately consumed in exactly one place. A grep for it
answers "what does the win condition change?" completely.

### M3. Deathmatch starts on the same rule as FFA

`canStart` requires two ready players for `FFA_LAST_STANDING`; `FFA_DEATHMATCH` requires the same. A
one-player deathmatch is a driving lesson.

### M4. The match-flow reducer is not touched

Worth stating as a decision, because it is load-bearing and surprising.

`reduceFlow` never decides a winner — the room computes an outcome and dispatches `end` with it. And
respawning is not a phase transition: a respawning player stays `IN_MATCH` throughout, exactly as a
wrecked one does today.

So `flow/match-flow.ts` and `flow/match-flow.test.ts` are untouched by this work. The match timer is
stamped on the same edge into `MATCH` where `applyFlow` already stamps `matchStartedAtTick`, and the
new win rule lives beside `livingSides` rather than inside the reducer.

---

## Kill attribution

### M5. The kill goes to whoever dealt damage last, and there are no assists

Not "most damage dealt," not a share split across attackers, not a contribution window. The last
point of hp taken off you decides who killed you.

The consequence is a large simplification: **no damage ledger exists.** There is no per-attacker
table, no decay window, no threshold. One string per car.

### M6. Every point of hp loss already has a known attacker

This mode would be far harder in a game with fall damage, environmental hazards, or lethal collisions.
It has none:

- **Ramming deals no damage.** `sim/ram.ts` states it outright — ram is impulse only, and `applyDamage`
  is never called from it. Weapons remain the only damage source.
- **Status damage-over-time already carries its source.** `ActiveStatus.sourceSessionId` exists, is
  networked, and `statusPulses` already returns it in `StatusPulseResult`. Its own doc comment
  anticipates this exact feature: *"Kill credit for a bleed and per-source diminishing returns are the
  two things that will want it."*

There is therefore no "world kill" case and no unattributed death. Every kill has an owner.

### M7. `lastDamagerSessionId` is server-only, carried like `fireState`

`CombatPlayer` gains `lastDamagerSessionId: string`, carried into `runCombat` and back out through
`combat-bridge`, and held between ticks in `CombatMemory` — precisely how `fireState` and `lock`
are already handled.

It is **not** networked. The client does not predict damage; `runCombat` is called only from
`ArenaRoom`. Putting it on the schema would patch a string to every client at the tick rate for
nothing. This satisfies hard invariant 8 by the front door: `stepSim` does not read it.

### M8. One writer, stamped at the one place hp already moves

`damage()` in `sim/combat.ts` is already documented as *"The only writer of `hp` and `alive`."* It
gains a third parameter, the attacker's session id, and stamps it on the target. Two call sites
supply it:

| Damage source | Attacker id |
|---|---|
| Weapon hit | the instance's `ownerSessionId` |
| Status pulse | `pulse.sourceSessionId`, already returned by `statusPulses` |

`runCombat` stays pure — the field rides out on the result like everything else.

### M9. The kill is booked at the existing death-transition detector

`combat-bridge.ts` already contains the only line in the codebase that detects the moment of death,
and it is already commented as such:

```ts
// Stamp the death tick on the TRANSITION only ...
if (player.alive && !p.alive) player.diedAtTick = state.tick;
```

That branch does the scoring:

- `victim.deaths += 1`
- `victim.killedBySessionId = p.lastDamagerSessionId`
- `killer.kills += 1`, if that id resolves to a player still present

A killer who has disconnected simply does not get the increment; the victim's `killedBySessionId`
still records who it was, so the banner (M27) reads correctly even for a departed killer.

### M10. Three new networked fields, and one of them is render-only

| Field | Type | Purpose |
|---|---|---|
| `kills` | `uint8` | score |
| `deaths` | `uint8` | score, and the tie-break |
| `killedBySessionId` | `string` | the "killed you" banner and the scoreboard |

`uint8` is sufficient: a 300-second deathmatch capped at six players cannot approach 255.

`lastDamagerSessionId` is cleared on respawn (M19), so an attacker who hurt you before your last
death can never be credited with your next one.

### M11. Kills are counted in every mode; only Deathmatch scores on them

The attribution code runs regardless of mode, so gating it would cost a mode check in the damage path
and buy nothing. Counting always also fixes something that predates this work: `results-view.ts`
renders K/D/A columns as zeroes today, with a comment saying real attribution *"touches the
weapon-damage rules, which is its own conversation."* This is that conversation, and Last Standing
and Team get a real scoreboard out of it for free.

**Assists remain zero** in all three modes, per M5. The column stays because the design has it.

---

## Intangibility, and why it is one rule rather than two

### M12. The game already has intangibility, and this extends it

Spawn protection was not a new mechanic to invent. `sim/context.ts` already reads:

> "A dead car is intangible while it fades out — see `isOnField`."

`isOnField(player)` is `status === IN_MATCH && alive`, and a car at 0 hp is already dropped from
every other car's collision list, from the ram pair list, and from combat's target list. Spawn
protection is that same condition, held a moment past the respawn.

### M13. Intangible and invulnerable are the same rule

Rather than "cannot be hurt" **plus** "passes through cars," one statement: **a phasing car is not
present in the world.** Not a collider, not a ram partner, not a weapon target, not an aim-assist
lock candidate. Invulnerability falls out of intangibility instead of being a second mechanism.

The rejected alternative was a status with `damageTaken: 0`. It fails twice:

1. `STATUS_LIMITS.damageTaken.min` is `0.4`, so `0` clamps to `0.4` and the car takes 40% damage.
   Relaxing that clamp would let *any* source grant true invulnerability, which is a balance change
   this feature has no business making.
2. Even at zero, shots still **connect** — pierce is consumed, impact effects play, and on-hit
   statuses such as `corroded` land on a supposedly invulnerable car.

### M14. The predicate splits in two

One predicate does two jobs today, and a phasing car needs those jobs to disagree: it must be
**driveable but not solid**.

| Predicate | Meaning | Consumed by |
|---|---|---|
| `isOnField` | may be simulated | the mover gate in `sim/tick.ts` — **unchanged** |
| `isSolid` | participates in contacts | `otherCarHulls`, the ram pair list in `ram-bridge.ts` |

`isSolid` is `isOnField && !phased`. The mover gate keeps `isOnField`, so a phased car drives
normally. `tick.ts` carries a comment warning that divergence between the mover gate and the wall
gate would drive a non-match player around the arena; this split is deliberate and that comment must
be updated to describe both predicates.

**Correction, caught in whole-branch review.** The table above is incomplete, and the omission is
what let spawn protection ship without existing. It lists two consumers of "participates in
contacts" — `otherCarHulls` and the ram pair list — and stops there. But M13 promises four things:
not a collider, not a ram partner, **not a weapon target, not an aim-assist lock candidate.** The
last two live in `sim/combat.ts` behind a third predicate the table never names, `isFighting`
(`inRoster && alive`), and nothing in this design ever told anyone to touch it. Every task-level
review read M14 as the provisioning list for M13, found both of its rows done, and passed. The
result was a car that phased through cars and rams while taking full weapon damage, consuming
pierce, collecting on-hit statuses, and serving as a lock target — the feature's central promise,
absent, with five documents asserting it worked.

The table should always have read:

| Predicate | Meaning | Consumed by |
|---|---|---|
| `isOnField` | may be simulated | the mover gate in `sim/tick.ts` — **unchanged** |
| `isSolid` | participates in contacts | `otherCarHulls`, the ram pair list in `ram-bridge.ts` |
| `isTargetable` | may be shot at or locked | the hit snapshot, the lock candidate list, and `aimAngleFor`'s target guard — all in `sim/combat.ts` |

`isTargetable` is `isFighting && !phased`, derived from the modifiers `runCombat` already computes
once per car per tick.

The reason it is a **third** predicate rather than a change to `isFighting` is the same asymmetry
M15's correction turned on, pointing the other way: `isFighting` gates being shot at *and* acting —
firing, holding a lock, keeping an attached beam alive. Folding `phased` into it would stop a
phasing car from firing, and M23's first termination condition is "the player commits a press". A
protection that cannot be given up by shooting is a different mechanic from the one this spec
designed. So the rule is one line long and worth stating outright: **gate the places a car is looked
at as a target; leave every place it acts alone.** `combat.test.ts` pins both halves, including a
case that fails if someone later "simplifies" the two predicates into one.

### M15. The filter lives on the entry, which is what makes it symmetric

`otherCarHulls(entries, selfSessionId)` gains a `tick` parameter and drops any entry that is phased,
reading each entry's own status rows through the shared `modifiersFromRows`.

Filtering on the *entry* rather than on the caller is the whole trick. Were a car to filter its own
`others` list by its own phased state, A would pass through B while B still collided with A — an
asymmetry that would show up as one car shoving a ghost. Filtering entries makes symmetry
structural rather than something a test has to catch.

And because `otherCarHulls` is the same shared function that both `serverTick` and the client's
`buildStepContext` call, both halves of the lockstep change together. This is the same property that
keeps hull dimensions honest.

`ContextPlayer` gains the status rows; both callers already hold them on the schema.

**Correction, caught during implementation.** The paragraph above is wrong, and it is worth recording
why rather than quietly rewriting it: it argues from a picture of collision that this codebase does
not use.

`resolveWorld(body, others, obstacles, bounds)` separates a **single body** against a list — each car
pushes *itself* out of what it sees. Mutual separation is emergent from both cars independently
running their own step, each with its own view of `others`. Filtering the *entry* controls only one
side of that: it stops every *other* solid car from being handed the phased car's hull, so nobody
else collides with the ghost. It says nothing about what the ghost is handed back. A phased car
calling `otherCarHulls` with the entry-only filter still receives everyone else's real hulls and still
pushes itself out of them — a respawning car would be blocked and speed-bounced by the very car
camping its spawn. That is not "one car shoving a ghost," which the original paragraph correctly
worried about; it is the reverse asymmetry, and it defeats spawn protection (M14) and the "not a
collider" half of M13 just as completely. Filtering on the entry alone does not make symmetry
structural — it only chooses which of the two directions the asymmetry lands on.

Mutual intangibility needs **both** directions, and the shipped `otherCarHulls` does both: it still
drops a phased entry from everyone else's list (the paragraph above is correct about that half), and
it additionally returns `[]` outright when the *caller's own* entry is phased — so a phased car sees
nothing and pushes against nothing, symmetric with being unseen. The one exception is a caller absent
from `entries` altogether (the client's "local player not loaded yet" path), which falls back to
"solid" rather than phased, since `buildStepContext` must still hand prediction real hulls to run
against, not an empty world for a car nobody has actually put into spawn protection.

What the original paragraph got right, and what is still true of the shipped code: the filter lives
inside `otherCarHulls` itself, the one function both `serverTick` and the client's `buildStepContext`
call, so both halves of the lockstep still change together — that property was never in question, only
which direction of filtering it bought symmetry in. `resolveWorld`, the OBB hull model, and
`carHullOf` remain exactly as untouched as M16 says.

### M16. `resolveWorld` and the hull model are not touched

Only the *membership* of the `others` array changes. The SAT test, the MTV separation, the resolve
ordering, the bounce, and the OBB dimensions are all untouched.

This is deliberate and it is why this design is safe to build: root `CLAUDE.md` requires stopping to
ask before changing the drive model, the hitbox model, or the collision-damage rules. None of them
change.

### M17. Phasing passes through cars only

Obstacles and the arena bounds stay solid. A car that could phase through walls could leave the map.

---

## `phased` as a status

### M18. It is a status, not a bespoke field

The status layer already provides everything this needs: it is networked on `PlayerState.statuses`,
it is client-predicted, it renders a HUD badge, it carries `startTick` and `endsTick` so a drain bar
and a ghost alpha need no new schema field, and `clearStatuses()` already exists with the comment
*"A fresh match, a respawn — anything that is not 'it ran out'."*

Three additions:

- `StatusId` gains `"phased"`
- `StatusFlag` gains `"phased"`
- `Modifiers` gains `phased: boolean` (false in `NEUTRAL_MODIFIERS`)

`phased` is a **buff**. It carries no channel multipliers — it flips one flag and nothing else.

### M19. `chainable` replaces a hardcoded test exception

`status-config.test.ts` requires every flag-carrying row to be `reapply: "ignore"`, *"so hard CC can
never be chained."* Contact-clear extension (M22) needs `phased` to be `reapply: "refresh"`, so that
rule must admit an exception.

The exception is **declared per row in the table**, not special-cased in the test:

```ts
/** May a flag-carrying row be refreshed while running? Default false. */
chainable?: boolean;
```

The test becomes: *every flag-carrying row that is not `chainable` must be `ignore`.* `phased` sets
`chainable: true`; every existing row is untouched and still `ignore`.

**It is not called `canStack`.** "Stack" has a defined and opposite meaning in this codebase —
`status-types.ts` states that a status can never stack with itself and that no option compounds
magnitude. `phased` does not compound; re-applying only extends its clock. `chainable` borrows the
word the test itself already uses.

The rationale the original rule protects is untouched: it exists so an *opponent* cannot hold you in
hard CC indefinitely. `phased` is granted by the room to a car about itself, and no opponent can
apply it at all.

### M20. Cleansing is narrowed to debuffs in the type system

`StatusOnApply.cleanse` is typed `StatusKind` today, so a future row *could* be authored to strip
buffs — and would strip spawn protection. The field narrows:

```ts
cleanse?: "debuff";     // was: cleanse?: StatusKind
```

A buff-cleanse becomes a **compile error** rather than a rule a test must police, and `phased` needs
no special-casing whatsoever: it is safe because nothing in the game can cleanse a buff.

`StatusKind` is unchanged and still types `StatusDef.kind`. Only this one field narrows. A future
"strip enemy buffs" weapon would need a deliberate type widening, which is the point of encoding it
here.

No row is affected today: exactly one row carries an `onApply`, and it is already `cleanse: "debuff"`.

---

## The respawn lifecycle

**This entire section applies to `FFA_DEATHMATCH` only.** In `FFA_LAST_STANDING` and `TEAM` the
sweeps below never run, no car is ever granted `phased`, and death stays terminal exactly as it is
today. That is the property M32's regression check is asserting.

### M21. The sweep runs at the top of the room tick, before `statusTick`

Placement is a decision, not an implementation detail.

Writing the status list before `statusTick` means the modifiers derived moments later already include
`phased`, so there is **no tick on which a freshly respawned car is solid**.

The alternative was the documented `statusRequests` seam, which is the correct route for a pickup and
the wrong one here: by design a request lands on the tick it is queued for and bites on the *next*
one. That one-tick window is exactly the window a spawn must not have.

### M22. Respawn conditions and the reset

For each roster player where `!alive && tick >= diedAtTick + respawnDelayTicks`:

**Spawn choice.** Of the arena's existing `ffaSpawns`, take the one maximising distance to the
nearest living enemy. Pure, unit-testable, and it needs no new arena data. This is the upstream layer
that most competitive shooters rely on, and it is what makes the overlap case (M23) rare before any
other rule runs.

**Reset**, reusing what `revealCars` already does per car:

| Field | Value |
|---|---|
| pose | the chosen spawn |
| `speed` | `0` |
| ram knock | `clearKnock(player)` |
| `hp` | `hpOf(carId)` |
| `alive` | `true` |
| `diedAtTick` | `0` |
| `killedBySessionId` | `""` |
| `lastDamagerSessionId` | `""` |
| `statuses` | `clearStatuses()` |
| fire state | a fresh `newFireState(carId, level)` |

Nothing survives a death: no stock, no switch lock, no lingering debuff, no knock.

**Same car, no re-pick.** Car select is a pre-match phase; mid-match re-picking would need a UI this
design does not include.

Then `phased` is granted.

### M23. The phase ends on a timer, a clear contact test, or a shot

The configured duration is a **minimum**, not a fixed window. The phase ends when:

1. `tick >= endsTick` **and** the car's OBB overlaps no other solid car, **or**
2. the player commits a press — you trade protection for the shot, **or**
3. the hard cap elapses, regardless of overlap.

Condition 1 is the important one, and it exists because of a specific failure: if the phase lapsed
while the car overlapped another, both would suddenly interpenetrate and `resolveWorld` would
separate them with a single-tick position push *and* a speed bounce. Bounded, but a visible snap.

This is the Quake/Source-lineage solution — a spawning body stays non-solid until its hull is
unobstructed — and the overlap test reuses `collide.ts`'s existing SAT rather than reimplementing it.

Condition 3 is belt-and-braces rather than load-bearing. Griefing condition 1 by parking on a phased
car is weak: the attacker cannot damage it and is only delaying their own shot. At the cap the car
becomes solid and eats one bounded MTV separation.

Extension is a `reapply: "refresh"` application, which is what M19 exists to permit.

---

## Ending the match

### M24. `matchEndsTick` rides the edge `matchStartedAtTick` already rides

A `uint32` on `ArenaState`, stamped in `applyFlow` on the transition into `MATCH` — the same place
and the same edge that already stamps `matchStartedAtTick`, for the same reason: one number patched
to everyone beats a local stopwatch per machine. It is `0` outside Deathmatch.

### M25. `livingSides` is not called in Deathmatch at all

Not "called and ignored" — not called.

With respawns, every player can be simultaneously dead while waiting out their timers. `livingSides`
would count zero living sides, return `DRAW`, and end the match. Gating the *result* would be
fragile; the mode simply does not ask the question.

### M26. `deathmatchOutcome`, beside `livingSides` in `flow/win.ts`

```
deathmatchOutcome(players) → { winnerSessionId, winnerTeam: -1 }
```

Ranked by **kills descending, then deaths ascending**. Fewest deaths is the tie-break: it is a real
skill signal, it is deterministic, and it needs no overtime phase.

A top position still tied on both yields `winnerSessionId: ""` — the existing draw path, which
`ResultsScene` already renders. Sudden death was rejected: it needs a new phase, a networked overtime
flag, and a stalemate guard for players who simply hide.

Deathmatch ends when:

- `tick >= matchEndsTick`, or
- fewer than two roster players remain — otherwise a lone survivor drives in circles until the timer.

`onLeave`'s win check takes the same mode split as `combatTick`'s.

**Known display gap:** a shared win renders identically to "nobody won," because both are
`winnerSessionId: ""`. Naming the tied leaders is deliberately out of scope.

---

## Client

### M27. What the player sees

| Surface | Modes | Notes |
|---|---|---|
| Match timer, counting down to `matchEndsTick` | Deathmatch | reuses `durationLabel` from `results-view.ts` rather than writing a second `m:ss` clock |
| Kills column on the arena roster panel | Deathmatch | `roster-panel.ts` is already a pure, tested layout module. Omitted in Last Standing, where a kill count would compete with the thing that matters — who is alive |
| **"[name] killed you"**, centred, 3 s, local player only | **both** | `dead && tick - diedAtTick < 3 s`, with the name resolved from `killedBySessionId`. Clears on respawn because respawn zeroes `diedAtTick` |
| Respawn countdown | Deathmatch | **derived, not networked**: `diedAtTick + respawnDelayTicks - tick` |
| Ghost alpha on your phased car | Deathmatch | reads the status row already patched to it |
| Spectate cycle while awaiting respawn | Deathmatch | unchanged. `isSpectating` is already `IN_MATCH && !alive`, which is exactly a player awaiting respawn |
| Real K/D on the results scoreboard | all | replaces the placeholder zeroes |

Neither the respawn countdown nor the phase's remaining time costs a schema field: the first is
derived from `diedAtTick`, the second from the status row's own `endsTick`.

---

## Config

### M28. `DEATHMATCH_CONFIG`

A new table in shared, per hard invariant 2 — no magic numbers in logic. Tick counts are derived
once and frozen, following the `WEAPON_TICKS` and `STATUS_PULSE_TICKS` pattern.

| Key | Value | Rationale |
|---|---|---|
| `matchSeconds` | `300` | five minutes |
| `respawnDelaySeconds` | `5` | long enough to sting, short enough not to be a spectate sentence |
| `phaseSeconds` | `1.5` | the minimum protection window |
| `phaseMaxSeconds` | `3` | the hard cap of M23, twice the minimum |

These sequence deliberately: 3 s of "[name] killed you," then 2 s of respawn countdown, then a return
with 1.5 s of protection.

All four are first-pass numbers meant to be re-tuned from play.

---

## Testing

### M29. The pure functions carry the weight

Unit tests for `deathmatchOutcome` (kill ordering, the deaths tie-break, the shared-win case),
farthest-free-spawn selection, `sidesOf` and `winRuleOf`, the `isSolid` split, kill attribution
through both a weapon hit and a status pulse, and the narrowed `chainable` rule in
`status-config.test.ts`.

### M30. `golden.test.ts` must be unaffected

A car in no status still resolves to `NEUTRAL_MODIFIERS`, and `phased` adds a flag that defaults
false. The drive integration is arithmetically unchanged, and the frozen fixture must still pass
untouched. If it moves, something in this design leaked into the drive path and is wrong.

---

## Impact on the probes and the manual

### M31. Two probe fixes are required, and no new probe is written

Root `CLAUDE.md` reserves new probe scenarios for the user. This design writes none. Two existing
probes are affected and both must be handled:

- **A compile break.** `playtest/prediction.ts:162` calls `otherCarHulls(entries, "me")` directly, so
  the added `tick` parameter (M15) breaks the build. A probe that does not compile measures nothing;
  it is fixed as part of the work.
- **Two stale comments.** `playtest/weapons.ts:214` and `playtest/weapons2.ts:259` both assert *"there
  is no wreck — a dead car leaves the field the instant it dies."* In Deathmatch it leaves and then
  returns. Both must be qualified.

### M32. A playtest run is recommended as a regression check

This change touches collision-set membership, the ram pair list, and the tick order in
`ArenaRoom.tick` — all on the list of changes that reach the probes, and precisely what the
ram-trigger-rate and collision-depth probes measure.

The expectation is that **nothing moves.** Outside Deathmatch no car ever carries `phased`, so
`isSolid` is identical to `isOnField` and every existing probe should report its current numbers. A
run is therefore a regression check, not a re-baseline — and a number that *did* move means the
predicate split leaked into modes it should not touch.

A Deathmatch probe is not written here. If one is ever wanted, the measurements worth taking are: the
distance to the nearest living enemy at each respawn; how often contact-clear extends the phase and
whether the hard cap ever fires; and the MTV displacement on the tick a car becomes solid, which
should be approximately zero. The last would need the sub-tick phase sweep the probes require of
anything involving contact.

### M33. The manual must be rebuilt

`STATUS_TABLE` is hashed whole by `balanceStamp`, so adding the `phased` row moves the fingerprint
and `scripts/manual-page.test.mjs` will fail until `npm run build:manual` is re-run and
`packages/client/public/manual.html` committed. That is in scope for the implementation.

---

## Summary of new and changed surfaces

**Shared — new:** `sidesOf`, `winRuleOf`, `deathmatchOutcome`, `DEATHMATCH_CONFIG`, `isSolid`,
`StatusId "phased"`, `StatusFlag "phased"`, `StatusDef.chainable`.

**Shared — changed:** `GameMode` (+1 value, 1 rename), `otherCarHulls` (+`tick`, filters phased),
`ContextPlayer` (+statuses), `Modifiers` (+`phased`), `StatusOnApply.cleanse` (narrowed), `damage()`
(+attacker id), `CombatPlayer` (+`lastDamagerSessionId`), `PlayerState` (+`kills`, `deaths`,
`killedBySessionId`), `ArenaState` (+`matchEndsTick`), `canStart`.

**Shared — untouched:** `reduceFlow`, `livingSides`, `canDamage`, `assignSpawns`, `resolveWorld`,
`carHullOf`, `stepDrive`, `DRIVE_CONFIG`, `CAR_TABLE`, `WEAPON_TABLE`.

**Server:** the respawn sweep and the phase-end sweep in `ArenaRoom.tick`; the mode split in
`combatTick` and `onLeave`; kill booking in `combat-bridge`; `isSolid` in `ram-bridge` and `tick.ts`.

**Client:** match timer, kills column, killed-you banner, respawn countdown, ghost alpha, real K/D in
`results-view.ts`, a third mode card in the lobby.
