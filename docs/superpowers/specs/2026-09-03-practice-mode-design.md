# Motor Combat MOBA — Practice Mode Design

**Designed:** 2026-09-03 · **Recorded in repo:** 2026-09-03
**Status:** Approved, not yet implemented.
**Builds on:** [`2026-09-01-playtest-playground-design.md`](2026-09-01-playtest-playground-design.md)
(whose `tick-pipeline` extraction, bot and pause mechanism this reuses),
[`2026-09-01-ffa-game-modes-design.md`](2026-09-01-ffa-game-modes-design.md) (whose deathmatch
respawn and `phased` protection this inherits unchanged), and
[`2026-09-02-playground-usability-and-bot-difficulty-design.md`](2026-09-02-playground-usability-and-bot-difficulty-design.md)
(whose `BOT_PROFILES` this promotes to shipped balance).

Decisions are numbered **PR1–PR31** and referenced by number elsewhere.

---

## Problem

A player who wants to learn a chassis, feel out a weapon's range, or warm up before a match has
exactly one option today: get five other people into a lobby. Nothing in the release build lets one
person drive.

The developer has had this since 2026-09-01 — `?dev=playground` drops straight onto the match screen
against a bot. But the playground is dev-only by construction: it is stripped from the release client
by assertion, its room is unregistered without `DEV_TOOLS=1`, and its whole reason for existing is
live re-tuning, which is precisely what players must not have.

**Practice mode** is the player-facing counterpart: a Practice button on the join screen, a small
settings page (my car, enemy car, difficulty), and then the real game against a bot, with a pause
menu. It ships in the release build.

The two features look alike and share most of their machinery, but they are not the same feature and
must not become one. The playground exists to change the game's numbers. Practice exists to be the
game exactly as it ships.

---

## Scope

**In:** a release-registered `PracticeRoom`; a `PracticeState` schema; a settings screen, pause menu
and session-summary screen on the client; promotion of the bot and its difficulty profiles out of
dev-only naming; a retune of the `easy` and `medium` bot tiers for players; session lifecycle limits
(idle timeout, concurrent-room cap); widening the playground's open-guard to see practice rooms.

**Out:** any change to `stepSim`, the drive model, the OBB hitbox model, collision-damage rules, or
friendly-fire; any change to `ArenaRoom` or `tick-pipeline`; multiplayer practice; practice-only
mechanics (instant respawn, reset-position, training dummies, aim trainers); bot behaviour beyond
retuning existing profile numbers; a new `GameMode` enum value; new playtest probes; changes to the
`hard` bot profile; any change to the join screen beyond adding one button.

---

## The governing principle: strict mirror

**PR1. Practice is the shipped game with one bot in it, and nothing else.**

Every rule the arena applies, practice applies: the real `DEATHMATCH_CONFIG.respawnDelaySeconds`,
the real `phased` spawn protection with its full lifecycle, chassis-default loadouts, the real level
a match starts you at, the real weapon unlock gating, the real hitboxes, the real damage numbers.

This is a decision with teeth, and it is what rules out the obvious conveniences — an instant
respawn, a reset-to-spawn key, a practice-only invulnerability. Each of them makes practice a
slightly different game from the one being practiced for, which defeats the point. A player who
learns a weapon's timing in practice must find that timing unchanged in a match.

The two deliberate divergences, both structural rather than mechanical:

- There is **no match clock and no win condition** (PR9). A practice session ends when the player
  ends it.
- There is **one opponent**, and it is a bot.

**PR2. The playground's affordances are not inherited.** No live tuning, no car switching mid-session,
no free weapon assignment, no inactive chassis, no bot on/off toggle, no arena picker. Practice
settings are chosen once, before the session starts, and are fixed for its duration. This is not a
simplification for later expansion — it is the feature's definition.

---

## Entry and gating

### PR3. A third room type, registered unconditionally

`PracticeRoom` sits beside `ArenaRoom` in `packages/server/src/index.ts` with **no `DEV_TOOLS` gate**.
`PRACTICE_ROOM_NAME = "practice"` lives in shared beside `ROOM_NAME` and `PLAYGROUND_ROOM_NAME`.

`maxClients = 1`. The room is single-player by definition.

### PR4. No singleton guard — one room per player is the feature

`ArenaRoom`'s `shouldRejectSecondArena` queries listings for `ROOM_NAME` only, so practice rooms are
invisible to it and the arena stays a singleton. On the practice side, Colyseus's `joinOrCreate`
against a full `maxClients = 1` room mints a fresh room per player, which is exactly the behaviour
`PlaygroundRoom` had to suppress with `PLAYGROUND_BUSY_ERROR`.

That suppression existed for one reason: the playground writes the process-wide tuning store, so two
of them fight. Practice never writes it (PR10), so it needs no equivalent guard, and the default
Colyseus behaviour is correct as-is.

### PR5. Everything ships; nothing lives under `dev/`

Practice scenes and screens live in `packages/client/src/scenes/` and `packages/client/src/ui/`,
never `packages/client/src/dev/`. They carry no `DEV_TOOL_MARKER`, are imported statically, and are
registered in `main.ts`'s scene array like every other screen. `assertNoDevOnlyCode` in
`scripts/build-release.mjs` is unaffected and must stay passing.

---

## The room

### PR6. `PracticeState extends ArenaState`, adding exactly one field

| Field | Type | Meaning |
|---|---|---|
| `paused` | `boolean` | The sim is frozen (PR13). |

That is the entire schema delta. Specifically **not** added:

- No `controlledSessionId`. The player always drives their own car (PR12), so the existing
  `controlledCarOf(state, room.sessionId)` seam resolves through its absent-field path — the same
  path a real match takes today.
- No `tuningJson`. There is no tuning.
- No `botEnabled`. There is always a bot.
- No `botDifficulty`. The client chose it and holds it locally; networking it would be a second
  source of a truth nothing on the wire needs.

Invariant 7 (stable wire values) and invariant 8 (sim-read fields are networked) both hold: the
addition is additive, and `paused` is read by the room's own tick gate.

### PR7. Settings arrive as join options, not as a message

`joinOrCreate` carries `{ name, carId, opponentCarId, difficulty }`, validated server-side by a
shared type guard (`isPracticeSetup`) and refused with a `ServerError` when malformed.

This is where practice is *simpler* than the playground rather than a copy of it.
`MSG_PLAYGROUND_SETUP` exists because the playground re-applies setup mid-session; practice settings
are fixed the moment Start is pressed (PR2), so there is no message and no `applySetup` path — the
room reads its configuration once, in `onCreate`/`onJoin`, and never again.

### PR8. Two message types, both already validated paths

- `INPUT_MESSAGE`, through the same `isInputMessage` guard a real client's message takes, straight
  into the player's own input queue.
- `MSG_PRACTICE_PAUSE`, toggling `state.paused`.

Nothing else. Invariant 3 (clients send inputs, never authoritative state) holds unchanged.

### PR9. Phase pinned to `MATCH`; deathmatch rules; no clock; no win check

`onCreate` sets `phase = RoomPhase.MATCH` and `mode = GameMode.FFA_DEATHMATCH`, and never runs
`reduceFlow`. There is no countdown, no reveal, no results, and neither `livingSides` nor
`deathmatchEnded` is ever called.

`matchEndsTick` is left at its zero default. This is load-bearing and free: `matchClockLabel` already
returns `""` for `matchEndsTick <= 0`, so the HUD drops the clock with no client conditional, while
`winRuleOf(mode) === "deathmatch"` keeps the kills panel lit. No new `GameMode` value is needed and
none is added.

### PR10. `setTuning` is never called from this room — and the playground's guard widens

The hard rule the whole design rests on: `PracticeRoom` never imports or calls `setTuning`. The
tuning store is module-level and process-wide, so a practice room that touched it would re-balance
every other room in the process.

Its mirror image is a real hole that must close in the same change. `shouldRefusePlayground` today
asks only "is anyone in the arena". Because practice rooms are registered on **every** process
including the `npm run dev` one, a developer opening `?dev=playground` while someone practices on
that server would silently re-balance their session. The guard widens to **"is anyone in the arena
or in a practice room"**.

(Two separate processes cannot collide: a release build never sets `DEV_TOOLS=1`, so the playground
room is not registered there at all, and `isDevToolsEnabled()` is an exact `"1"` match.)

### PR11. Latency injection mirrors `ArenaRoom`

The playground deliberately skips `ArenaRoom`'s latency injection, on the reasoning that simulated
lag makes a feel test lie. Practice takes the opposite decision for the same reason it exists:
strict mirror (PR1) means practice must feel like the arena on the same deploy. In a release build
the injector is off, so this is a no-op there and matters only when a developer is testing with it on.

### PR12. The player always drives their own car

No control routing. `PlaygroundRoom`'s `controlledSessionId` machinery is not carried over, and the
`MSG_PLAYGROUND_SWITCH` equivalent does not exist. The human's inputs go to the human's queue.

### PR13. Pause freezes `state.tick`

`MSG_PRACTICE_PAUSE` toggles `state.paused`; while paused, `tick()` returns before incrementing
`state.tick`, so cooldowns, statuses, respawn timers and shot lifetimes all freeze coherently
because every one of them keys off the tick counter. This is PG7's mechanism unchanged.

The client mirrors the flag and stops sending inputs, which already works: `ArenaScene.pumpInput`
bails on `isPlaygroundPaused(room.state)`, and that helper duck-types `paused` off a bare
`ArenaState` rather than off `PlaygroundState`. It is correct for practice as written and only its
name is wrong (PR22).

### PR14. The bot is a synthetic second car

`onJoin` creates the player's `PlayerState` and a second one under the reserved bot session id, with
its own input queue and fire-mask entry, both in `matchRoster` from the first tick, both
`IN_MATCH`/`alive`. The bot's row is schema-ordinary, so the client renders it as an ordinary remote
player and no client change is needed to see it. It is named `"Bot"` and takes a colour distinct
from the player's via the lobby's own `pickColor`.

Teams 0 and 1 are visual only; the mode is FFA and `canDamage` never consults them.

### PR15. `"random"` resolves once, at room creation, over active chassis only

The opponent chassis is chosen when the room is created and never re-rolled — not on respawn. Cars
do not change chassis mid-match, and neither does the bot (PR1). `resolveOpponentCar` draws only
from active chassis, so a chassis hidden from car select cannot appear in practice either.

### PR16. Death, respawn and spawn protection are inherited verbatim

`runPipeline`, `respawnSweep`, `respawnPlayer`, `phaseEndSweep` and `overlapsSolid` are called, not
modified. Respawn happens after the real delay at the spawn farthest from the other car, with the
real `phased` protection and its cap-and-decision lifecycle. `isOnField` / `isSolid` are untouched.

---

## The bot

### PR17. The bot module and its profiles are promoted out of dev-only naming

`packages/server/src/rooms/playground-bot.ts` becomes `packages/server/src/rooms/bot.ts`, and
`BOT_PROFILES` moves into a named config table rather than living as a constant inside a room
helper. Both rooms import the one module.

This is a rename with a real consequence: the profiles stop being a developer's tuning aid and
become shipped balance that players judge. They get the same treatment as the rest of the balance
surface — a config table, no magic numbers in logic (invariant 2).

### PR18. `hard` is frozen; only `easy` and `medium` are retuned

`playground-bot.test.ts` pins `hard`'s six numbers by value because it is exactly the bot that
shipped. That pin stays, and `hard` is not touched by this work — it is already a stiff opponent
(1-tick reaction, a shot every 2 ticks, a 0.3 rad fire cone, with `resolveAimAngle` rotating its
shots toward a locked target).

`easy` and `medium` were tuned to be useful to the developer, not readable to a new player, and are
retuned toward the latter. The retune is limited to the six existing profile numbers per tier; no
new lever is added, and the invariant `aimToleranceRad < fireConeRad` continues to hold on every row
(a row with it backwards produces a bot that settles at a heading it can never fire from).

### PR19. Difficulty is fixed for the session

Chosen on the settings page, applied at room creation, never changed mid-session. Changing it means
exiting and starting again — consistent with PR2 and with the fact that a match's opponent does not
get easier halfway through.

---

## The client

### PR20. One button on the join screen; the name is optional

`ui/screens/join.ts` gains a **Practice** action beside "Join lobby". It reads the name field, trims
it, and falls back to `"Player"` when empty.

The name is not validated by anyone and no connection is opened at this point: practice rooms are
per-player, so the arena's uniqueness rule (`ServerError` 4001, "Name is taken") has no counterpart
here. A player whose chosen name collides in the lobby can still practice under it.

The alternative considered and rejected: splitting the join screen into a required name gate plus a
separate home menu. It is the cleaner entry flow and would remove the fallback entirely, but it
touches 12 `scene.start("join")` call sites across 6 files on the live match flow, for a benefit
practice does not need. It stays available as separate future work.

### PR21. `PracticeSetupScene` and its screen module

A new scene rendering a new `ui/screens/practice-setup.ts`: **My car**, **Enemy car** (with "Random"
first, then active chassis only), **Difficulty**, plus **Back** and **Start**.

It follows the established split — a pure render function returning a handle, with the rules in a
tested module and the scene as a shell over the top — because a Phaser scene cannot be unit-tested
without a browser.

Selections persist to `localStorage` and are restored on entry, so a returning player picks a car
once rather than every session. Persistence lives in `packages/client/src/practice/`, mirroring what
`dev/playground/storage.ts` does for the playground but outside `dev/` (PR5).

**Start** joins the practice room, puts it in the registry, and starts `ArenaScene`. **Back**
returns to the join screen.

### PR22. `ArenaScene` runs unchanged, with one room-name-gated addition

This is the payoff of PR6: prediction, reconciliation, camera follow, weapon and status HUD, roster
panel and impact feedback all work because `PracticeState` decodes as an ordinary match state. The
HUD needs no practice conditional (PR9).

The single addition is the pause menu. `P` sends `MSG_PRACTICE_PAUSE`; a new `ui/screens/pause.ts`
renders **Resume** and **Exit** over the existing `ScreenOverlay`.

**The gate must be derived from the room itself, not from a flag a scene sets.** A registry flag can
go stale — practice, exit, then join a real match, and a flag nobody cleared puts a pause menu in a
live match. `room.name === PRACTICE_ROOM_NAME` cannot go stale and is the intended mechanism;
**confirm `colyseus.js`'s `Room` actually exposes `name` before relying on it** (it was not
verifiable while this spec was written — the checkout had no `node_modules`). If it does not, the
fallback is a registry flag cleared in **both** `PracticeSummaryScene` and `ArenaScene`'s shutdown
handler, and the staleness case gets its own test.

Gating on the presence of `paused` in the state is **not** an option: `PlaygroundState` carries it
too and mounts its own overlay, so a duck-typed gate would put the practice menu on top of the
playground's.

`isPlaygroundPaused` is renamed **`isSimPaused`** (2 call sites plus its test). Its body is already
correct for both rooms; only the name claims otherwise.

### PR23. The pause menu renders off `state.paused`, never optimistically

`P` sends the toggle and the overlay appears when the server's flag comes back, rather than showing
immediately and hoping. The alternative lets the menu sit open while the sim is still running — a
state in which the player is being shot at by a bot they cannot see. Over a LAN the round trip is a
frame, and the message is delivered over a reliable transport.

### PR24. Exit snapshots before leaving, then shows a session summary

**Exit** snapshots kills and deaths **before** calling `room.leave()` — the state is gone the moment
the room is left, the same discipline `ResultsScene.snapshot()` already follows — then leaves, then
starts `PracticeSummaryScene`.

The summary reuses the row and table rendering from `ui/screens/results.ts` with the winner banner
suppressed. It does **not** reuse `ResultsScene` itself: that scene runs `bindViewRouter`, which
routes on `state.phase`, and practice pins phase to `MATCH` forever, so the scene would bounce
straight back into the arena; its `room.onLeave` also hardcodes a return to the join screen.

`resultsView()` is **not** modified. The summary composes the row rendering directly rather than
teaching the match's results view about a mode that never ends — the same reasoning that rules out
reusing the scene, applied one level down.

One action: **Back to practice settings**, landing on `PracticeSetupScene` with selections intact.

### PR25. Close codes route the player somewhere sensible

The 4000+ block continues from the codes already taken (4000 bad name, 4001 taken name, 4002 kicked,
4003 second arena, 4004 arena busy, 4005 playground busy):

| Code | Meaning | When it arrives | Client behaviour |
|---|---|---|---|
| 4006 | Idle-timed-out (PR27) | Mid-session | Leaves the arena for the setup screen, reason printed |
| 4007 | At capacity (PR29) | At join, from **Start** | Stays on the setup screen; inline error, Start re-enabled |

The two are different events and must not share a code path: 4007 is a rejected `joinOrCreate` the
player never left the setup screen for, while 4006 closes a session already in progress.

Any other close — a server restart mid-session — falls back to the join screen, as every other scene
already does.

---

## Session lifecycle and limits

### PR26. Why limits exist at all

Each practice session is a room with a 30 Hz simulation interval and a 20 Hz patch encoder, running
in the one Node process that also hosts the live match, on the host's personal PC. Two cars per room
is cheap, but a room whose player walked away is pure waste, and nothing else in the server bounds
how many exist.

### PR27. Idle is measured in wall clock, and checked before the pause gate

The room stamps `Date.now()` on each input message received. The idle check runs at the **top** of
`tick()`, before the `paused` early-return of PR13.

Both halves of that matter. Measuring idle in sim ticks would never advance for a paused room — the
exact case most worth reaping — and running the check after the pause return would never fire at all
while paused. `PRACTICE_CONFIG.idleTimeoutSeconds` (default 300) closes the room with code 4006.

A cost asymmetry worth recording, which does *not* change the rule: a paused room is nearly free,
because `tick()` returns before the pipeline runs. The expensive ghost is an *unpaused* idle room,
simulating at full rate around a parked car. One rule covers both, and special-casing pause would
add a branch for no gain.

### PR28. A warning before the timeout

A message type sent at `PRACTICE_CONFIG.idleWarningSeconds` (default 60) remaining, which the client
shows as a toast. Without it, a player who paused to read something is dumped to a settings screen
with no explanation — a worse experience than the ghost room the timeout exists to prevent.

### PR29. A concurrent-room cap, enforced at `onCreate`

`onCreate` queries practice listings and throws `ServerError(4007)` at or past
`PRACTICE_CONFIG.maxConcurrentRooms` (default **6** — the game's own player ceiling, so no LAN
scenario has more practicing humans than the match supports; measured as a comfortable margin below
where tick drift or CPU actually turn up, see Risk 2). Overridable by environment through the
`getTickRateHz` / `getCarSelectSeconds` pattern already in `mode.ts`.

Known and accepted: two simultaneous `onCreate` calls can both pass the check, the same race
`shouldRefusePlayground` already carries. Closing it needs a lock the rest of the server does not
have, for a failure mode that requires two people pressing Start in the same millisecond on a
six-person LAN.

### PR30. No reconnection

`allowReconnection` is never called, so a closed tab disposes the room immediately rather than
holding it through a grace window. `onLeave` disposes unconditionally.

### PR31. `PRACTICE_CONFIG` lives in shared config

`idleTimeoutSeconds`, `idleWarningSeconds`, `maxConcurrentRooms`. Per invariant 2, none of these
appear as literals in logic.

---

## Testing

**Rules go in pure functions, so they are testable without a matchmaker or a browser** — the pattern
`PlaygroundRoom` already follows with `shouldRefusePlayground`, `otherPlaygroundId` and
`loadoutOrChassisChanged`:

- `shouldRefusePractice(listings, cap)` — at, under and over the cap.
- `resolveOpponentCar(setup, rng, activeCars)` — an explicit chassis passes through; `"random"`
  draws only from active chassis; an inactive or unknown id is refused.
- `isIdle(lastInputAtMs, nowMs, timeoutMs)` and its warning counterpart.
- `isPracticeSetup(msg)` — the join-options guard, rejecting each malformed shape.

Then room-level tests mirroring `playground-room.test.ts` for the wiring: pause freezes `state.tick`;
the idle sweep fires **while paused**; the bot's input reaches the bot's queue and not the player's;
a malformed join option is refused; the room never calls `setTuning`.

Client-side: the setup screen's model, the pause screen, and settings persistence are tested; the
scenes themselves are not, per the existing convention.

**Regression bar:** every existing suite stays green **without edits**, `golden.test.ts` above all.
The one expected exception is additive assertions in the bot profile test for the retuned `easy` and
`medium` rows — `hard`'s pinned values do not move (PR18).

---

## What this does not touch

Recorded explicitly, because the repo's rules require flagging when these move:

- **No playtest probe reaches this.** No `sim/` change, no tick-order change, no `WEAPON_TABLE`,
  `CAR_TABLE`, `DRIVE_CONFIG`, `RAM_CONFIG`, `COMBAT_CONFIG`, `STATUS_*`, `AIM_CONFIG`, `NET_CONFIG`,
  `TICK_RATE_HZ` or `DEFAULT_PATCH_RATE_HZ` change. `runPipeline` is called, not modified. No probe
  expectation goes stale and `npm run playtest` is not owed a run. **To be re-verified against the
  final diff, not assumed.**
- **The generated manual is not owed a rebuild.** `balanceStamp` hashes tables none of this changes.
- **`docs/turn-tuning.md` is untouched.** No `handling`, `speed` or `DRIVE_CONFIG` edit.
- **`ArenaRoom` and `tick-pipeline` are unmodified.** The only edit to live match code is
  `ArenaScene`'s pause menu, behind a room-name gate.

Docs that **do** change: a `CLAUDE.md` paragraph (the room, the never-call-`setTuning` rule, the
widened playground guard), a docs-table row for this spec, plus `project-structure.md`,
`schema-reference.md` (`PracticeState`) and `config-reference.md` (`PRACTICE_CONFIG`).

---

## Risks

1. **The `ArenaScene` edit** is the only change to live match code. Mitigated by the room-name gate,
   and by the existing suites staying green without edits.
2. **The concurrency cost was estimated, then measured (2026-09-03).** N `colyseus.js` clients drove
   N practice rooms headlessly (30 Hz input, real bot opponent) at N = 1, 3, 6, 12, with the cap
   raised via `MAX_PRACTICE_ROOMS` for the run only. Two independent readings were taken: the
   client-observed `state.tick` cadence (patch-rate limited, 20 Hz — the method the design expected
   to use), and, to separate sim-loop drift from patch/network jitter, a temporary
   `performance.now()` hook around every room's `setSimulationInterval` callback, added to the
   **gitignored** server build only and never committed. The two agree on **shape**, not on absolute
   value: a client can only observe `state.tick` at the 20 Hz patch boundary, so its reading is
   aliased by the patch rate and came back around ~37.4 ms, not comparable to the 33.33 ms sim-tick
   target. Only the server-side instrumented reading measures the actual sim loop, and it is the one
   that stays within ~0.1 ms of that target at every N. What both readings agree on is the trend: flat
   as N rises from 1 to 12 with no room-count-driven degradation — occasional single-tick spikes
   (35–65 ms) show up even at N=1, so they read as container scheduling noise, not room-count-driven
   degradation. Server CPU (`/proc/<pid>/stat` utime+stime deltas) rose roughly
   linearly and stayed light: ~4% at N=1, ~7-8% at N=3, ~7-8% at N=6, ~11-12% at N=12. Measured in a
   containerized dev sandbox, not the host PC practice actually ships on — the absolute CPU% is not
   representative of real hardware and the readings carry that container's own scheduling jitter, but
   the flat-versus-N shape of both the tick-interval and CPU data is the useful result. Verdict: 6
   holds the tick steady with room to spare; 12 stayed comfortable too in this environment. PR29's
   default stays at 6 — a safety rail below the observed headroom, not a target raised to meet it.
3. **Feature drift between practice and the playground.** They share a bot, a pipeline and a pause
   mechanism, and the temptation to unify them further will recur. PR2 is the answer: the playground
   exists to change the numbers, practice exists not to.
