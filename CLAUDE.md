# Motor Combat MOBA

LAN-hosted top-down 2D multiplayer car combat (last player/team standing, max 6). npm workspaces (`@motor-combat-moba/shared`, `@motor-combat-moba/server`, `@motor-combat-moba/client`), one Colyseus `arena` room (`ArenaRoom`), shared `stepSim` as the lockstep, Phaser 4 client. v1 is complete: lobby, car select, countdown, arcade driving with prediction, projectiles, ram knockback, elimination, spectate, last standing.

**Statuses** are the sim's duration layer (`sim/status/`) — timed conditions a car is in, listed in
`STATUS_TABLE`. Every channel is a **multiplier** with 1 as neutral, and `Modifiers` is the only type
that reaches the sim: driving, ramming and combat never look at a status list. A status does not own
its duration — the applier does (`WeaponDef.applies`, or `CombatInput.statusRequests` for future
pickups) — and never stacks with itself. Hard CC no longer belongs to one chassis alone: since the
2026-09-01 weapon-status overhaul, **`stunned` comes from `roadblock` (Bastion), `thunderclap`
(Mirage's dash), and the hard-slam's wall impact** (`wildcharge`, 500 ms) — `thumper` applies
`spiked` now, a slow rather than a stop. `applyDamage` is no longer the only HP writer;
**`sim/damage.ts` is**, now that repair pulses exist. **`corroded`'s only source in the game is now
an explosion** — `magmablast`'s detonation, and nothing else applies it (grep `applies:.*corroded`
if a second source ever needs checking). **`reeling` is the one row no `WeaponDef.applies` entry ever
grants**: the contact pass writes it, from `contactTick` — an ordinary ram for `RAM_CONFIG`'s
duration, and (since the car-physics rework's stage 4) a hard slam for
`WEAPON_TABLE.wildcharge.impulse.uncontrolMs`, which is a weapon-authored duration reaching it
through the `ImpulseDef` seam rather than through `applies`. See the car-physics section below. See
[`docs/combat-model.md`](docs/combat-model.md#statuses).

**Every car carries a fourth weapon it never sees in the HUD: its basic attack.** It is an
ordinary `WEAPON_TABLE` row wired into a second slot — `CarDef.basicAttack`, a plain `WeaponId`
sitting **beside** the three-weapon kit rather than inside it — and **any weapon may occupy it**.
Nothing constrains which row a chassis points it at, or what that row's id is spelled like; a
weapon is a basic attack because a chassis slots it there, and `basicAttackIds()` is the only
honest way to ask which ones are. The nine rows the chassis carry there today are identical seeds
spreading one `BASIC_ATTACK_BASE`, which is a balance state, not a rule. **`CarDef.weapons` and `slotsOf` still mean the three ABILITY slots** — the HUD, the
guide, the playground's loadout picker, the balance seat filter, ttk's attacker axis and the bot's
reach model all depend on that and are the reason it did not widen. `fireSlotsOf(carId)` is where
the two are joined, and its live readers are `packages/server/balance/stats.ts`'s accumulator
seeding, `scripts/ttk.mjs` (two call sites) and `packages/server/src/bot/brain/duel.fixture.ts` (two
call sites) — the latter's `bestSustainedDpsOf` deliberately counts the basic attack in its DPS
ceiling, moving Bastion's figure from 18.3 to 22.5. `newFireState` does not call it — its
explicit-loadout path builds the same list inline, since it also has to accept a caller-given
weapon override `fireSlotsOf` has no parameter for. **The basic attack is always fire slot 0** as of
the 2026-09-20 index flip — it sat LAST, at `kit.length`, until then, which was a constant only
while every active kit was the same length. The flip moved no binding: it is still `H` / `LMB`, and
the abilities are still `J`/`RMB`, `K`/`SHIFT`, `L`/`SPACE`, now at fire slots 1-3. It rides the
ordinary fire state machine with `recoveryMs: 0`, and it **loses** a same-tick tie against an
ability, because `beginFire` now scans **descending** and takes the highest set bit — the basic
attack, at index 0, is scanned last. The scan was reversed in the same pass that moved the index, so
the basic attack loses the tie the same way it always has, just through a different index. One
consequence of scanning highest-wins is deliberate rather than incidental: among the three
abilities themselves, the **highest-indexed** one now wins a same-tick tie, so a player mashing every
key fires their largest-cooldown ability, not their smallest. Its
binding is taught **only** in the countdown action hint — it has no gutter pill, which is the one
place the "a binding nobody printed breaks quietly" rule is knowingly bent. See
[`docs/superpowers/specs/2026-09-17-basic-attack-design.md`](docs/superpowers/specs/2026-09-17-basic-attack-design.md) (BA1–BA38).

**The basic attack can be switched off without deleting any of that**, via
`BASIC_ATTACK_CONFIG.enabled` (`config/weapon-config.ts`) — a build-time flag, not a live-session
setting: flip it, rebuild shared/server/client, and `npm run build:manual`. Nothing about the nine
`basic-attack-*` rows, `CarDef.basicAttack`, or the schema's fourth slot goes away when it is
`false`; only four things read it. `beginFire` refuses a press on the basic-attack fire slot, so the
key does nothing. `BotController`'s `chooseSlot` never selects that slot either, so a bot does not
burn its one press a tick on a weapon that cannot fire. The client's `hintSlotOrder`
(`config/slot-keys.ts`) drops the slot from the countdown action hint entirely, not merely from
firing — the hint is the only place its binding is taught, and hiding the weapon means removing the
pill, not leaving a dead one on screen. And `scripts/build-cars-and-weapons.mjs` skips every
chassis's "Basic attack" card and folds the flag into `balanceStamp`, so toggling it without
rebuilding the manual fails `npm test` the same way any other stale-manual edit does. `fireSlotsOf`,
the balance harness, `npm run ttk` and the playtest probes are deliberately left unaware of the flag
— they sweep every `WEAPON_TABLE` row structurally, and `carrierOf` must always be able to find a
chassis for each of the nine basic-attack rows or those tools crash outright. See the
[`basic-attack-toggle`](.claude/skills/basic-attack-toggle/SKILL.md) skill for the full checklist.

An **aura** is a beam with a `disc` hitbox at `origin: "center"` — a field around a car rather than a
line of fire. It shipped once, as `shockwave` on Mirage's slot 2, and the 2026-09-01 overhaul retired
that weapon's aura identity, leaving no row using a `disc` hitbox — but a disc ships again as of the
2026-09-02 predator/magmablast pass: `magmablast` (moved back to **Mirage's** slot 1 by that pass, off
Bullseye's) is now an explosive shell whose detonation is a real `WeaponInstance`, a detached
centre-origin `disc`-hitbox beam synthesized by `instanceDefOf(id, isExplosion)` from the shell's
`ExplosionDef`. That disc lingers 2 s and damages once per entry; `damageMode` on the explosion is
the knob (`"onceEver" | "perEntry"`). The aura mechanism was never deleted while dormant, and this
is what it was waiting for. The multi-wave `VolleyDef` machinery that rode alongside the original
aura is still **dormant**: no row authors more than one volley.

**The `GameMode` enum now has two FFA win conditions**, not one. `FFA_LAST_STANDING` (the renamed
original — wire value still `0`) ends the match when `livingSides` drops to one side; `FFA_DEATHMATCH`
(`2`) never calls `livingSides` at all — it runs a `respawnSweep` on a `DEATHMATCH_CONFIG.respawnDelaySeconds`
timer, grants the respawned car a `phased` status (driveable, not solid, not targetable) for at least
`phaseSeconds`, and ends on `ArenaState.matchEndsTick` or the kills-then-deaths ranking in
`deathmatchOutcome`. `winRuleOf(mode)` is the single place that answers "what ends the match"; every
older consumer keeps reading `sidesOf(mode)`, which still returns `"ffa"` for both. See
[`docs/superpowers/specs/2026-09-01-ffa-game-modes-design.md`](docs/superpowers/specs/2026-09-01-ffa-game-modes-design.md)
and [`docs/combat-model.md`](docs/combat-model.md#elimination-and-winning).

**`isOnField` split into two predicates on the same date.** It now covers only the **mover** gate — may
this car be simulated at all — in `sim/tick.ts`. Whether it is **solid** — participates in contacts,
can be rammed, can be a weapon target — is `isSolid` (`isOnField && !phased`), read by `otherCarHulls`
and the ram pair list. Outside Deathmatch no car is ever `phased`, so the two predicates agree
everywhere else in the game; a phased car is the one case where they must disagree, and nothing else
may let them.

**The three SHIPPED chassis are `bullseye`, `mirage` and `bastion`** — a type triangle, not three
shapes. `CAR_TABLE` also carries six unreleased prototypes as of 2026-09-16 — `taurus`, `anvil`,
`caprico`, `prowler`, `cleaver`, `skorpios` — each `isActive: false`, each with `weapons: []`, and
each a placeholder stat clone of a shipped chassis (Taurus/Anvil/Caprico of Bastion, Prowler/Cleaver
of Mirage, Skorpios of Bullseye). They exist so art and handling can be driven before publication; **none of
them carries an identity yet**, so do not read their ratings as a design or balance them against the
triangle. Everything below about the roster's shape is about the three.
Their ratings (`speed`, `accel`, `handling`, `attack`, `hp`, `ramAttack`, `ramDefence`) are **seven**
independent 0-100 values; `accel` and `handling` landed on 2026-08-30 so cars could differ in how they
launch and how they corner, and `ramAttack`/`ramDefence` replaced the single `mass` rating in stage 3
of the 2026-09-06 car-physics rework (see below) — **there is no `mass` on `CarDef` any more.**
(`CAR_TABLE` rows also carry `brakeDecel`, a u/s² value rather than a 0-100 rating — `coastHalfLifeSeconds`
joined it in the same 2026-09-06 pass and was deleted by the 2026-09-18 Unity drive-model port, which
replaced the coast curve it fed with one always-on drag rate.) **`handling` is turn RATE, not turn
radius.** Radius is `speed / turnRate`.

**A further chassis can be authored without shipping it: `CarDef.isActive` (PG18) is the roster's
publish gate**, and as of 2026-09-16 it is one everywhere rather than only in car select. Car select,
`MSG_SELECT_CAR`/`MSG_PREVIEW_CAR`, the practice opponent roll and practice join options already
filtered to `activeCarIds()`; the players' guide and the balance harness did not. The guide now
publishes active chassis only — the car sections, their kits and the `roster.*` prose tokens — and
`balanceStamp` hashes that same subset, so an unreleased car neither reaches players nor churns the
page. The balance harness seats active chassis by default and unreleased ones under
`npm run balance -- --include-inactive`, **skipping any chassis with an empty kit under either**,
since a car that cannot fire books a guaranteed 0% that measures nothing. Two authoring rules follow,
and they are a deliberate pair: **an inactive chassis may carry no weapons at all** (that is the shape
a prototype is driven in), and **weapon exclusivity (L1) stays unconditional** — no weapon on two
chassis, active or not, so a prototype cannot borrow a shipped kit and `isActive: true` is a
one-field change rather than an edit that fails the suite for unrelated reasons. A `WEAPON_TABLE` row
carried by nobody is legal (`tremor` is one); the whitelist that used to pin an exact carried-row
count is gone, and the per-chassis kit assertions are what still catch a weapon silently dropped from
a shipped loadout. `npm run check:art` deliberately covers the whole table, marking an unreleased row
`(inactive)` rather than skipping it, because missing art is something to learn before release.
`npm run ttk` covers the whole table on its **defender** axis only — an unreleased hull is exactly
the one you want to check "can anything kill this" against — while its **attacker** axis is
`armedCarIds()`, since a chassis with no kit books a guaranteed "never" row that measures nothing,
the same reason balance skips an empty kit. The matrix names the chassis it left off. See
[`docs/config-reference.md`](docs/config-reference.md#adding-an-inactive-chassis).

Until **2026-09-02**, `speed` and `handling` traded off per car — Bastion carried the roster's
*highest* `handling` (82) despite the *lowest* `speed` (30), which let it turn inside every other
chassis (20 u) even though Bullseye's low-rate-but-tight-radius arc (40 u, beating Mirage's 42 u
despite a lower turn RATE) was the more subtle version of the same trick. **That inversion is gone.**
`speed` and `handling` now carry the *same* rating per car (Mirage 85/85, Bullseye 65/65, Bastion
50/50). The 2026-09-02 rebalance also raised top speed roster-wide (`DRIVE_CONFIG.baseMaxSpeed`
90 -> 135, `speedPerRating` 2.25 -> 3.7 — deliberately more than a uniform 1.5x), which at the time
landed turn radius at Mirage widest (55 u), Bullseye next (53 u), Bastion tightest (51 u): ordered
with top speed rather than against it, Bastion still winning but by a few units instead of tens, its
tank identity resting on hp and `mass` alone rather than a handling edge. (That was the 2026-09-02
state of play: `mass` was deleted by the car-physics rework's stage 3, and the same identity now rests
on hp plus `ramAttack` 70 / `ramDefence` 90 — both the roster's highest.)

**The 2026-09-06 heavy-car pass (stage 1 of the vector-drive rework) cut top speed and acceleration
again, hard, so cars carry momentum and feel heavy.** `DRIVE_CONFIG.baseMaxSpeed`/`speedPerRating`
dropped 135/3.7 -> 80/2.2 — roughly a 40% roster-wide top-speed cut (Mirage 449.5 -> 267 u/s, Bullseye
375.5 -> 223, Bastion 320 -> 190) — and `baseAccel`/`accelPerRating` dropped much further, 420/7.2 ->
60/1.4, stretching time to top speed by roughly 3-4x (Mirage 0.44 -> 1.49 s, Bullseye 0.50 -> 1.81 s,
Bastion 0.57 -> 2.16 s). Turn rate was **deliberately left untouched**: since radius is
`speed / turnRate`, the speed cut alone drops every chassis's turn radius under one car length (48 u)
— Mirage 32.6 u, Bullseye 31.4 u, Bastion 30.2 u, the same ordering and proportional spacing as
2026-09-02, just scaled down. Per-car `coastHalfLifeSeconds` and `brakeDecel` also joined `CarDef` in
this pass, replacing the old global `DRIVE_CONFIG.drag`/`brakeDecel` pair, so coasting and braking are
now per-chassis feel rather than a roster-wide constant. See
[`docs/turn-tuning.md`](docs/turn-tuning.md#current-values) for the full numbers.

**The 2026-09-16 pass cut top speed a third time, and this one is not the same shape as the last.**
`DRIVE_CONFIG.baseMaxSpeed`/`speedPerRating` dropped 80/2.2 -> 60/1.518 — roughly another 29% off
every top speed (Mirage 267 -> 189.03 u/s, Bullseye 223 -> 158.67, Bastion 190 -> 135.9). Three
differences from 2026-09-06 matter: the pair did **not** scale uniformly (0.75x against 0.69x), so
the flat part grew relative to the per-rating part and a point of `speed` buys slightly less;
**accel was left untouched**, so time to top speed *fell* with the ceiling (Mirage 1.49 -> 1.06 s,
Bullseye 1.81 -> 1.29, Bastion 2.16 -> 1.54) rather than stretching as the heavy-car pass made it —
a car is slower but reaches its lower maximum sooner, which reads as *less* heavy, not more; and turn
rate was left alone for a third consecutive pass, so every radius fell with its own speed to a
**1.5 u band across the whole roster** (Bastion 21.6 u, Bullseye 22.3, Mirage 23.1). Radius has
stopped being a legible axis of the type triangle — widening it back out is a `handling` edit, not a
speed one. **The measured hardest-possible ram also dropped from 5.95 to 4.50 rad/s against an
unchanged `RAM_CONFIG.spinMaxRate` of 6**, since `attackerPush` is linear in closing speed: stage 5's
re-pitch inherits a spin budget that is a quarter unspent, and `globalScale`/`spinScale` were
measured against the old ceiling-hugging case. See
[`docs/turn-tuning.md`](docs/turn-tuning.md#current-values).

**The 2026-09-16 hull resize made every car 1.25x bigger — for real, not just in the drawing.**
`DRIVE_CONFIG.carWidth`/`carHeight` went 48 × 32 → **60 × 40**; the arenas did not grow, so the field
is relatively more crowded. **It was first built at 1.5x (72 × 48) and revised down on 2026-09-17**
because that played too large against arenas that did not grow — the spec's §12 restates every clause
at the new factor, and the 72 × 48 build never reached `development/main`, so it is not history to
preserve. Every reader derives from the hull, so the logic edits were small, and three of
them are worth knowing: `RAM_CONFIG.spinScale` went 10 → **12.5** by derivation (a 1.25x lever over a
1.5625x `inertiaCoefficient`), which keeps every ram's spin exactly where it was — the car-physics
rework's own stage 5 never ran to re-pitch it; the 2026-09-18 Unity physics port's stage 3 is what
answers that instead, replacing `inertiaCoefficient` with the hull-derived `inertiaRadiusSquared()`
and re-pitching `RAM_CONFIG.spinScale` itself to 0.3 for the new ram formula (12.5 survives, moved to
`IMPULSE_CONFIG.spinScale`, as the slam's own copy — see the car-physics-rework section below for the
full story); both arenas' FFA spawn rows moved inward (arena-01
y 180/540, arena-02 y 187/543) to clear the spikes by ~106 u rather than a car diagonal (72.1) —
forced on arena-02, whose old rows sat *inside* the diagonal at 69 u; and the client's countdown
arrow and hp bar length scaled 1.25x with the car (the lock bracket did too, on the branch, but the
aim-lock removal deleted it before the two met). Weapon balance was deliberately **not**
touched: a bigger target is easier to hit, so hit rates are expected to rise, and that is for the
balance harness to measure. `BOT_BRAIN_VERSION` went to 4.7.0 on the branch and to **5.1.0**
when it merged over the aim-lock removal's 5.0.0 — a number the basic attack also took on its own
line, so the merge of the two is **5.2.0** — and balance reports across this change are not
comparable. The car art the 1.5x pass imported at 144 px was re-imported at 120 px for the 60 × 40 hull
(`1189a08`), and `check:cars` reads `ok` on all nine rows. Three bot tests were already failing before this resize (the 2026-09-16
top-speed cut) and still need a `BOT_PROFILES` retune; measured on base `0904012` at 48 × 32, at
72 × 48, and at the shipped 60 × 40: `controller.test.ts`'s OFF-AXIS mean offset reads 0.2386 →
0.6939 → **0.2017** against a bar of < 0.2 — still red, but now better than base — alongside the hard
bot's preferred standoff growing from 470 to 570 (the two moved together; a causal link was not
measured); `tiers.test.ts`'s P49, a **time-to-kill** case, **passes at 60 × 40** (no kill within the
run at base, 18.7 s against a 17.87 s cap at 72 × 48); and P50, a hit-rate case, is still inverted —
hard vs medium hit rate 0.778 vs 0.8 at base, 0.632 vs 0.857 at 72 × 48, **0.765 vs 0.857** at
60 × 40. **Those figures are the branch's, measured before it merged over the aim-lock removal
(2026-09-17), and the merge moved all three:** P49 and P50 both passed on that merged line, but the
OFF-AXIS offset read **1.58** — against 0.2017 on the branch alone, and a pass on `development/main`
alone. Neither parent shows it; it is the lock removal's longer engagement reach meeting the bigger
hull, not a mis-resolved conflict, and it is a `bot-tuner` question. **The basic-attack merge that
followed moved them again:** OFF-AXIS reads **1.36**, P49 fails again (hard's fires at range 6
against a bar of 7.17), and `balance/match.test.ts`'s 30 s deathmatch-clock canary lands seed 1 on a
ranking tie (kills assertion passing, `winnerSessionId` empty — the tie its history already
describes, not the clock defect). All three pass on `feature/basic-attack` alone and the latter two
on the bigger-cars merge alone. See
[`docs/superpowers/specs/2026-09-16-bigger-cars-design.md`](docs/superpowers/specs/2026-09-16-bigger-cars-design.md).

**The 2026-09-18 Unity drive-model port replaced the model these paragraphs describe, not merely its
numbers.** `DRIVE_CONFIG.baseAccel`/`accelPerRating`, `reverseSpeedRatio`, `steeringGrip` and
`stopTurnRatio` are gone; one always-on drag rate (`baseDrag`/`dragPerRating`, resolved per car by
`dragRateOf`) now sets top speed, wind-up time and coast-off roll together, and yaw is
speed-independent with no separate at-rest rate. The port's own stage 1 ported `baseTurnRate`/
`turnRatePerRating` to Unity's own anchors (3.6/0.054 → 0.667/0.0169) and `reverseAccelFactor` to
Unity's own 0.4, both **retunes**, not merely renamings — see
[`docs/config-reference.md`](docs/config-reference.md#drive_config) for the resolvers and current
values. **Stage 5 Task 5 (2026-09-19) then raised `baseMaxSpeed`/`speedPerRating` AND
`baseTurnRate`/`turnRatePerRating` by the identical uniform 1.5x** (60/1.518 → 90/2.277, 0.667/0.0169
→ 1.0005/0.02535) and `reverseAccelFactor` back up to 0.6 — the roster's currently shipped values
(Mirage 283.5 / Bullseye 238.0 / Bastion 203.9 u/s, turn radius uniformly 89.9 u across all three,
deliberately, since speed and turn rate scaled together for the first time) — from the user's own
hands-on playground pass. This is the first pass since 2026-08-31 to touch turn rate at all.

Turn rates were otherwise last touched on **2026-08-31, when the whole roster's turn rate was raised
1.5x** — `DRIVE_CONFIG.baseTurnRate` and `turnRatePerRating` scaled together, speeds untouched at the
time — because driving and aiming read as too heavy; neither the 2026-09-02 rebalance, the 2026-09-06
heavy-car pass, the 2026-09-16 cut above, nor the Unity port's own stage 1 port (a value change, not a
rescale) rescaled that pair again — that streak of "speed moves, turn rate does not" held for over
three weeks and ended only with stage 5 Task 5 directly above. The 150-point budget that used to cap
`speed`+`attack`+`hp` was deleted on 2026-08-29 so `mass` could be a free-floating rating, and no
replacement guard was adopted — see [`docs/config-reference.md`](docs/config-reference.md#car_table).

**`stepDrive` no longer reads the roster.** It takes a resolved `ChassisDrive` — **nine** numbers as
of the 2026-09-18 Unity drive-model port (`maxSpeed`, `engineAccel`, `reverseAccel`, `brakeDecel`,
`turnRate`, `dragRate`, `dragPerTick`, `gripPerTick`, `spinPerTick`; `reverseMaxSpeed`, `accel`,
`turnRateAtStop` and `coastPerTick` from the 2026-09-06 vector-drive rework's eight-field version are
all gone) — from `driveOf(carId)`; `stepSim` resolves it at the single production call site. That is
what lets `golden.test.ts` pin the drive integration against a frozen fixture through every future
balance edit — see [`docs/config-reference.md`](docs/config-reference.md#drive_config).

**Practice mode ships; the playground does not.** `PracticeRoom` is a third room type registered on
every server with no `DEV_TOOLS` gate — a player-facing 1v1 against a bot, reached from the join
screen's Practice button. It runs `runPipeline` and the deathmatch respawn helpers verbatim, runs
`mode = FFA_DEATHMATCH` with `matchEndsTick` at 0 (which is what hides the
clock and keeps the kills panel), and **never calls `setTuning`** — the store is process-wide, so a
practice room that touched it would re-balance every other room in the process. The mirror image of
that rule is `shouldRefusePlayground`, which refuses to open a playground while an arena **or a
practice room** has anyone in it. Settings ride as join options, not messages: practice has no
mid-session reconfiguration.

**Lobby chat is lobby-screen only, and its gate cannot drift from the UI.** `MSG_CHAT` is refused
server-side unless the sender's `status === PlayerStatus.READY` — the status `viewFor` maps to the
lobby screen for any player the room's state machine can actually produce, so "may speak" and "is
looking at the chat panel" are the same predicate. The
buffer lives on `ArenaState.chat`, capped at `CHAT_CONFIG.maxMessages` (20, oldest dropped first);
nothing ever clears it — not a phase transition, not a kick — so a player back from a match or a late
joiner reads the backlog, and it dies with the room since `ArenaRoom` sets no `autoDispose` override.
Each row snapshots its sender's `name` and `colorId` at send time rather than resolving them through
`state.players` at render time, so a leaver's or a kicked player's messages keep reading correctly
instead of going nameless and grey. `seq` is derived from the previous row rather than held in a
counter, because `chat.length` cannot detect a new message once the buffer is at its cap — an append
plus a shift leaves the length unchanged. See
[`docs/superpowers/specs/2026-09-06-lobby-chat-design.md`](docs/superpowers/specs/2026-09-06-lobby-chat-design.md).

**Neither of those two rooms reduces a flow, so `rooms/countdown.ts` is the only thing that writes
their `phase`.** Both now open on the same 3-2-1 an arena match does: `beginCountdown` at creation
(so the room cannot run live ticks before anyone arrives) and again on join once the cars are placed,
then `countdownSweep` at the top of each tick flips `COUNTDOWN` to the `MATCH` they stay in for life.
It is not a second countdown *mechanism* — the freeze is the one already shared, `serverTick`'s
`moving = phase === RoomPhase.MATCH` and `combatTick`'s matching skip — and the client needed no
change at all, since `viewFor(IN_MATCH, COUNTDOWN)` already routes to the arena scene and
`syncMatchHud` already draws the numeral. It is stamped on **match start only**: `applySetup`
deliberately does not re-run it, or every weapon swap in the playground's settings panel would cost
the tester a three-second freeze. See
[`docs/superpowers/specs/2026-09-03-practice-mode-design.md`](docs/superpowers/specs/2026-09-03-practice-mode-design.md).

**The bot is a five-layer brain, and a tier is data.** `packages/server/src/bot/brain/` runs
perceive → assess → move → shoot → humanize; `easy`/`medium`/`hard` differ only in `BOT_PROFILES`,
and no module branches on the difficulty name. Assess names **one situation** (`recover`, `waitOut`,
`evade`, `unpin`, `punish`, `reset`, `fight`, `close`) and commits to that play — not a scored catalog.
HUD facts (pose, HP, dead/phased, own and opponent gun reach, seen big-gun fires) are always present;
tiers differ in how much they listen and how well the hands execute. The bot presses **one** slot
per tick. `BOT_BRAIN_VERSION` rides in `botFingerprint`: bump it when behaviour changes without
the table moving. Feel complaints ("medium is too hard to hit") go through the
[`bot-tuner`](.claude/skills/bot-tuner/SKILL.md) skill onto knobs, not a Hard-only branch. See
[`docs/bot-behavior.md`](docs/bot-behavior.md) and
[`docs/superpowers/specs/2026-09-05-bot-situation-play-design.md`](docs/superpowers/specs/2026-09-05-bot-situation-play-design.md).

**The playground tunes two kinds of VFX, and they are different shapes.** Per-weapon bursts live in
`fx/table.ts` and are edited as a 2x4 grid; the environment — grade, vignette, shake, hit-stop,
decals, occlusion, lava, the generated floor, the floor ART's knock-back (shipped as a
no-op), the painted markings, car burst scaling and how a car is lit (a car GLOW was tried and
removed on 2026-09-13 — `packages/client/CLAUDE.md` says why, and it is not a gap to fill) — lives in `fx/environment.ts` as
one `ENVIRONMENT_FX` table and is edited as a flat list of sections. Both reach the renderer the
same way: a resolver injected by `ArenaScene` **only for a playground room**, so a shipped arena or
a practice session renders the shipped tables no matter what is saved in that browser. `floor.*` is
the only group that is not live — it needs the panel's Regenerate button. **`floor.*` and `floorArt.*`
are exact mirrors and never both apply**: an arena drawing floor art never creates the `floorTile`
every `floor.*` knob feeds, and an arena on generated asphalt never creates the sprite `floorArt`
tints. The panel marks whichever one is inert rather than letting it silently do nothing. `occlusion.halo` and
`markings.*` apply on edit, but through a texture rebuild and a redraw rather than a plain read —
see EV27, EV28 and EV30.

**The playground seats six cars, and a seat is not a connection.** As of 2026-09-16 the sandbox
runs six fixed seats with stable session ids (`pg-0`…`pg-5`) rather than "the human's car plus
`"bot"`"; the human's own `client.sessionId` names no car at all, and `controlledSessionId`
alone says which one they drive. `PlaygroundSetup` carries a six-entry `cars` list — each with
its own chassis, colour, loadout and `enabled` flag — plus a `drivenSeat` index
(`MSG_PLAYGROUND_SWITCH` is gone: who drives is now a per-seat radio in the Car select panel,
not a message that flipped between two cars), and **six is structural rather than a counted
cap**: there are six seats, so nothing anywhere refuses a seventh car. A disabled seat keeps
its configuration (that is what makes a duel and a six-way two clicks apart), and the Car
select panel seeds one from localStorage rather than from the defaults, because a parked seat
has no row in `state.players` to read. `BOT_SESSION_ID` still exists and is `PracticeRoom`'s
alone.
See [`docs/superpowers/specs/2026-09-16-playground-six-car-select-design.md`](docs/superpowers/specs/2026-09-16-playground-six-car-select-design.md).

**`arena-01` is no longer one open rectangle.** As of the 2026-09-11 arena-sprite-and-spike-hazard
work it is a convex octagon: an optional `boundary` vertex list on `ArenaDef`, carried as inward
half-planes through `Bounds` and resolved by a positional clamp — a generalisation of the same
axis-aligned push `resolveBounds` always did, not four wall boxes, so a fast car can never find the
wrong separating axis. `width`/`height` keep meaning the image frame and the camera bounds (still
`1280 × 720`, so the camera stays static and the zoom untouched); the polygon is inset **inside**
that rect, and the playable area it encloses — `1132 × 612` — is about **25% smaller** than the old
rectangle. `boundsOf(arena)` is now the one place a `Bounds` is built from an arena, and every reader
that used to assume a rectangle (`pointOutsideBounds`, `bounceOffWorld`, `hullTouchesWorld`) walks
planes instead. Both shipped arenas are 1280 × 720. `arena-01` is a chamfered octagon with fourteen
gapped spike strips; `arena-02` is a rectangle with a continuous spike ring on all four walls.
`kind: "spike"` obstacles sit flush against the boundary planes and 20 units deep — ordinary solids
to driving, projectiles and the bot, with one more behaviour layered on top (next).

**Spikes are the game's first environmental damage source.** `SPIKE_CONFIG` deals a flat 80 damage,
gated on a **fresh push into the surface** — speed into the wall above `triggerSpeed`, so resting
against spikes is free — and rate-limited by a `retriggerMs` lockout so being held in them under
pressure bleeds rather than deletes. **A self-driven car pays exactly once, on arrival**: measured
against `DRIVE_CONFIG.restitution` 0 (re-measured for the Unity physics port's zero-restitution pass;
it was 0.15 when this figure was ~5 u/s flat), holding throttle into a wall settles at a per-chassis
steady-state inward speed of roughly 4-8 u/s (mirage 7.92, bullseye 5.41, bastion 3.97), still far
under `triggerSpeed`'s 25, so only an **externally shoved** car keeps paying. (Whether that number
should drop is a tuning question for the user, not a bug.) This does **not** change the standing rule that cars never
damage each other by contact: a ram still deals zero HP, and spike damage is environmental, charged
to whoever last shoved that car within `shoverCreditMs` (an ordinary ram or a slam both count) or, if
that window has passed, to the victim's own session id — which the existing single kill-booking line
already reads as a self-inflicted, environment death with no new code. See
[`docs/combat-model.md`](docs/combat-model.md#environmental-hazards-wall-spikes) and
[`docs/config-reference.md`](docs/config-reference.md#spike_config).

**`arena.arena-01.floor` and `arena.arena-02.floor` are the live keys in the arena art namespace.** The namespace
(`arena.<id>.<slot>`, pruned per-arena at release time) existed since the asset pipeline shipped with
nothing to carry. The client draws a resolving floor as an `Image` in place of the generated asphalt
`TileSprite` — painted markings, the border stroke and the notch strips all go unpainted for that
arena, since the art already carries them. The bot also learned the polygon and the spikes, which bumped
`BOT_BRAIN_VERSION` without `BOT_PROFILES` moving. See
[`docs/superpowers/specs/2026-09-11-arena-sprite-and-spike-hazard-design.md`](docs/superpowers/specs/2026-09-11-arena-sprite-and-spike-hazard-design.md)
(AS1–AS31).

## Reporting a finding: claim first, then offer the evidence

**Lead with the claim, in one plain sentence.** Then say how confident you are and how you checked
it. Then stop, and ask whether the reasoning or the measurements would help. Do not open with
tables, formulas, simulation output or a swept parameter study.

Backing a claim with data and logic is wanted — it is why findings here get trusted, and it should
not stop. **Only the order changes.** A one-line claim can be refuted in one line; a wall of evidence
looks authoritative and has to be waded through before it can be argued with, so leading with it
*delays* the correction in exactly the case where the claim was wrong. This rule was written after a
supposed brake bug was explained over four messages with tables, simulations and analogies, and the
one-sentence version would have been corrected on sight — the behaviour was intended design.

The compression is the work, not a shortcut past it: stating a finding in one sentence means
understanding it well enough to discard everything inessential. And when asked to *discuss*
something, discuss it — do not answer with a parameter sweep.


## Hard invariants

1. `TICK_RATE_HZ` lives once in `@motor-combat-moba/shared`.
2. No magic numbers in logic — balance from shared/config (tables land in P1).
3. Clients send inputs (and later lobby intents), never authoritative sim state.
4. `stepSim` is the lockstep; server and client import the same function.
5. Sim rate ≠ patch rate (`TICK_RATE_HZ` 30 vs `DEFAULT_PATCH_RATE_HZ` 20).
6. `{x, y, angle}` is canonical world state.
7. Enum uint8 values are explicit and stable; never renumber.
8. If `stepSim` reads it, it is a networked schema field.
9. Shared is consumed as built `dist`.
10. Max 6 players.

## Read the right doc

| Topic | Doc |
|---|---|
| Walking skeleton | [`docs/architecture.md`](docs/architecture.md) |
| Source tree | [`docs/project-structure.md`](docs/project-structure.md) |
| Input / prediction seams | [`docs/networking.md`](docs/networking.md) |
| Schema fields | [`docs/schema-reference.md`](docs/schema-reference.md) |
| Env knobs / balance tables | [`docs/config-reference.md`](docs/config-reference.md) |
| Which knob to tune for a turning/aiming complaint, and every turn stat on the roster | [`docs/turn-tuning.md`](docs/turn-tuning.md) — **hand-maintained, see below** |
| Which knob to tune when a bot feels wrong, and every bot parameter | [`docs/bot-behavior.md`](docs/bot-behavior.md) |
| LAN zip / `start.bat` | [`docs/deployment.md`](docs/deployment.md) |
| Language / import rules | [`docs/conventions.md`](docs/conventions.md) |
| Plan sequence | [`docs/roadmap.md`](docs/roadmap.md) |
| Weapon, ram, status, elimination rules | [`docs/combat-model.md`](docs/combat-model.md) |
| Art, manifest, asset swapping | [`docs/asset-pipeline.md`](docs/asset-pipeline.md) |
| Code graph / MCP setup on a new machine | [`docs/code-review-graph.md`](docs/code-review-graph.md) |
| Playtest harnesses, and how to run them | [`packages/server/playtest/README.md`](packages/server/playtest/README.md) |
| Balance harness (win rates, matchups), flags, and its known distortions | [`packages/server/balance/README.md`](packages/server/balance/README.md) |
| Whether a balance edit actually moved time-to-kill | `npm run ttk` — see the header of [`scripts/ttk.mjs`](scripts/ttk.mjs) for what it does and does not model |
| Terms | [`docs/glossary.md`](docs/glossary.md) |
| Package local rules | `packages/shared/CLAUDE.md`, `packages/server/CLAUDE.md`, `packages/client/CLAUDE.md` |
| Spec + tracker | [`docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md`](docs/superpowers/specs/2026-08-24-motor-combat-moba-v1-design.md), [`docs/superpowers/plans/2026-08-24-motor-combat-moba-v1-master-index.md`](docs/superpowers/plans/2026-08-24-motor-combat-moba-v1-master-index.md) |
| **Online netcode and client rendering — the fourteen-phase rewrite in progress** | **start at [`docs/superpowers/plans/2026-09-04-netcode-and-rendering/EXECUTION.md`](docs/superpowers/plans/2026-09-04-netcode-and-rendering/EXECUTION.md)** — see below |
| **Car physics rework — stages 1-4 landed, spec now on revision 2** | **start at [`docs/superpowers/plans/2026-09-06-car-physics/EXECUTION.md`](docs/superpowers/plans/2026-09-06-car-physics/EXECUTION.md)** — see below |
| **Unity physics port — stages 1-4 landed (drive model, walls/bumps, rams, slam/effects), stage 5 (tune-and-reconcile) in progress; supersedes the car-physics rework's contest model** | **start at [`docs/superpowers/plans/2026-09-18-unity-physics-port/EXECUTION.md`](docs/superpowers/plans/2026-09-18-unity-physics-port/EXECUTION.md)** |
| Weapon system decisions (D1–D22), online-play review, future work — plus the **retired** aim assist and target lock (A1–A14), removed 2026-09-17 and kept only as a record | [`docs/superpowers/specs/2026-08-27-weapon-system-design.md`](docs/superpowers/specs/2026-08-27-weapon-system-design.md), [`docs/superpowers/specs/2026-08-27-aim-assist-target-lock-design.md`](docs/superpowers/specs/2026-08-27-aim-assist-target-lock-design.md), [`docs/superpowers/plans/2026-08-27-weapon-system.md`](docs/superpowers/plans/2026-08-27-weapon-system.md) |
| The ten-ability-weapon roster (nine shipped plus dormant `tremor`), per-chassis kits (L1–L7) — now alongside nine identical basic-attack rows (BA1–BA38, see above) | [`docs/superpowers/specs/2026-08-29-weapon-roster-design.md`](docs/superpowers/specs/2026-08-29-weapon-roster-design.md) |
| The three chassis types and their triangle, the `accel`/`handling` ratings, the weapon redistribution (T1–T22) — **supersedes L1–L7's assignments** | [`docs/superpowers/specs/2026-08-30-chassis-rename-and-weapon-redistribution-design.md`](docs/superpowers/specs/2026-08-30-chassis-rename-and-weapon-redistribution-design.md) |
| Ram CC and knockback decisions (R1–R20): severity, side bonus, authority/shove/spin, the `mass` rating | [`docs/superpowers/specs/2026-08-29-ram-cc-and-knockback-design.md`](docs/superpowers/specs/2026-08-29-ram-cc-and-knockback-design.md) |
| Status (buff/debuff) decisions: channels, re-apply rules, clamps, pulses, auras, the application seams | [`docs/superpowers/specs/2026-08-29-status-mechanism-design.md`](docs/superpowers/specs/2026-08-29-status-mechanism-design.md) |
| FFA Deathmatch: the second win condition, kill attribution, respawn and spawn-protection lifecycle, the `isOnField`/`isSolid` split (M1–M33) | [`docs/superpowers/specs/2026-09-01-ffa-game-modes-design.md`](docs/superpowers/specs/2026-09-01-ffa-game-modes-design.md) |
| The dev-only playtest playground: `?dev=playground`, the extracted tick pipeline, the runtime tuning store, `isActive`, the bot, persistence/export (PG1–PG23); bot difficulty profiles, per-car colour selection, the settings-panel relayout, and the `?dev=assets` additions (PG24–PG40); the VFX settings panel over `WEAPON_FX`, its preview and its export (PG41–PG55); the environment settings panel over `ENVIRONMENT_FX` — the arena's visual ground rather than per-weapon bursts — and its three non-live knobs (EV1–EV34); the six-seat widening, the Car select panel and the stable seat ids (PG56–PG88) | [`docs/superpowers/specs/2026-09-01-playtest-playground-design.md`](docs/superpowers/specs/2026-09-01-playtest-playground-design.md), [`docs/superpowers/specs/2026-09-02-playground-usability-and-bot-difficulty-design.md`](docs/superpowers/specs/2026-09-02-playground-usability-and-bot-difficulty-design.md), [`docs/superpowers/specs/2026-09-08-playground-vfx-settings-design.md`](docs/superpowers/specs/2026-09-08-playground-vfx-settings-design.md), [`docs/superpowers/specs/2026-09-08-playground-environment-vfx-design.md`](docs/superpowers/specs/2026-09-08-playground-environment-vfx-design.md), [`docs/superpowers/specs/2026-09-16-playground-six-car-select-design.md`](docs/superpowers/specs/2026-09-16-playground-six-car-select-design.md) |
| Practice mode: the shipped 1v1-vs-bot room, its settings page, session limits (PR1–PR31) | [`docs/superpowers/specs/2026-09-03-practice-mode-design.md`](docs/superpowers/specs/2026-09-03-practice-mode-design.md) |
| The user's own idea / invariant notes | `docs/ideas/`, `docs/invariants/` — **off limits unless the user names them**, see below |

## The netcode and rendering rewrite: fourteen phases, planned, not yet started

Two approved specs from 2026-09-04 — [online netcode and client
architecture](docs/superpowers/specs/2026-09-04-online-netcode-and-client-architecture-design.md) and
[client rendering
architecture](docs/superpowers/specs/2026-09-04-client-rendering-architecture-design.md) — are landed
as **fourteen phase plans** in
[`docs/superpowers/plans/2026-09-04-netcode-and-rendering/`](docs/superpowers/plans/2026-09-04-netcode-and-rendering/).
All fourteen were written by 2026-09-05. **None has been executed**: no code has changed, and the
plans describe a client and server that do not exist yet.

**Before touching that work in any session, read
[`EXECUTION.md`](docs/superpowers/plans/2026-09-04-netcode-and-rendering/EXECUTION.md)** — the state
file. It names the phase in flight, its branch and worktree, the last completed task and the next
one, and what every finished phase measured. **It is updated in the same commit as the work it
describes**, so a session can stop anywhere and the next one resumes exactly. Then
[`00-execution-guide.md`](docs/superpowers/plans/2026-09-04-netcode-and-rendering/00-execution-guide.md)
for how to run a phase, and
[`interfaces.md`](docs/superpowers/plans/2026-09-04-netcode-and-rendering/interfaces.md) — the ledger
of every name the plans share, which outranks any plan and is outranked by the specs.
`PROGRESS.md` beside them is about the *writing* of the plans and says nothing about executing them.

What it changes, when it runs, and why it matters to work that touches the sim meanwhile:

- **`TICK_RATE_HZ` becomes 60** in netcode phase 1, with three hand retunes and every fixture
  re-pinned. Balance and turn numbers tuned before then are measured on a 30 Hz sim.
- **Sim fields leave the Colyseus schema** in phase 2 for a hand-packed binary snapshot; hard
  invariant 8 is reworded to "if `stepWorld` reads it, it is a snapshot field".
- **`stepWorld` becomes the lockstep** in phase 3, wrapping `stepSim` unchanged; `ArenaScene.ts`
  splits into a headless `match/` half and a `render/` half.
- **Phase 6 is not scheduled.** Its five tasks each wait on a measured gate, and four of the five are
  expected to read "not needed" on a healthy link. One of them is a `WEAPON_TABLE` edit
  (`thunderclap`'s wind-up) and carries every obligation this file's balance rules impose.

A change to `sim/`, the tables or `ArenaScene.ts` made before this work starts is not wasted, but it
will be moved by it — check the phase that owns the file before a large refactor there.

## The car-physics rework: stages 1-4 landed, spec on revision 2

**Stage 1 of a five-stage rework replaced `SimBody.speed` and `PlayerState.speed` — a scalar
magnitude along the car's heading, with a separate `shoveX`/`shoveY` knockback vector and an
`authority` steering multiplier bolted alongside — with a true 2D world velocity, `vx`/`vy`.** Four
fields out, two in, on both types. `packages/shared/src/sim/velocity.ts` (`forwardOf`, `lateralOf`,
`speedOf`, `toWorld`) is the **only** place the world-frame/car-frame conversion may be written —
five open-coded copies of `cos(angle) * speed` existed before this, one of them silently wrong for
sideways motion. Coasting became per-car and speed-proportional (`CarDef.coastHalfLifeSeconds`);
braking became per-car and flat (`CarDef.brakeDecel`); the roster's speed and acceleration were both
cut hard so cars carry momentum. See [`docs/turn-tuning.md`](docs/turn-tuning.md#current-values) for
the numbers and the intro paragraphs above for the balance history.

Stage 1 left ramming deliberately degraded — a shim that added the knock straight into `vx`/`vy`,
and `authority` with no successor at all, so a rammed car kept full steering. **That is history now:
stages 2, 3 and 3b have each replaced a piece of it, and the paragraphs below are the current
state.** Five `RAM_CONFIG` knobs (`authorityFloor`, `authorityHalfLifeSeconds`, `authorityEpsilon`,
`shoveHalfLifeSeconds`, `shoveEpsilon`) sat inert through all of that and were **deleted outright in
stage 3b**, along with `RamDecay.shove`/`.authority`; do not go looking for them. They had two
different successors, not one — the three `authority` ones are the `reeling` status below, the two
`shove` ones are `DRIVE_CONFIG.impactGripDecel`. `SLAM_CONFIG.victimAuthority` and `selfKeepFactor`
were the slam side of the same story and **stage 4 deleted them too** — see below.

**Stage 2 restored whole-vector reflection** in `applyContact` (walls deflect instead of damping),
dropped `restitution` 0.35 → 0.15, split car-car separation by mass, and added the `Impulse` struct
with equal-and-opposite reactions.

**The spec then changed models mid-rework, and this is the thing to know before reading any ram
code.** Measuring stage 2's equal-and-opposite impulses showed every chassis is thrown backwards
*faster than its own top speed* for landing a ram — Bastion 190 → −184.5 u/s, Wild Charge −340.5,
which is 1.8× its user's top speed, backwards. Two structural causes: `applyContact`'s restitution
reflection is mass-blind, so an attacker rebounds off a car it outweighs three to one exactly as it
would off a wall; and `knockMaxSpeed` was authored as the *victim's* Δv under a one-way model.

**Spec revision 2 therefore removes `mass` from the game entirely**, replaces it with per-car
`ramAttack`/`ramDefence` (never `attack`/`defence` — `CarDef.attack` already scales weapon damage),
and replaces equal-and-opposite impulses with a **contest** between the two cars' pushes.

**Stage 3 executed that.** `mass` does not appear anywhere in `packages/`; `sim/ram.ts`'s
`pushOf`/`impactOn` resolve each side of a ram independently (there is no `reactionOf` and no
negation), and `RAM_CONFIG.globalScale` and `spinScale` were **measured** through the composed
`serverTick` → `contactTick` order rather than derived — do not re-derive them on a retune. It also
left one exit criterion unmet, deliberately: an attacker still ends a dead-on ram travelling
backwards, and all but 0.1 u/s of that comes from `applyContact`'s mass-blind restitution reflection,
which no clause in R1–R11 authorizes touching. **The user has since approved that fix as its own
stage, sequenced between 3b and 4**, and it needs a spec clause of its own plus a re-measurement of
both constants.

**Stage 3b gave ramming its control-loss back.** A ram now applies **`reeling`** — a `STATUS_TABLE`
debuff (`turnRate: 0.4`, `accel: 0.4`, both sitting exactly at the `STATUS_LIMITS` floors),
`reapply: "refresh"` and `flags: []` on purpose, since a flag-carrying row would be forced to
`"ignore"` — so a rammed car's steering degrades through the same `Modifiers` channel every other
debuff uses rather than a bespoke field on the body. Alongside it, **per-victim diminishing returns**
(`FalloffStack`/`nextFalloff` in `packages/server/src/sim/ram-bridge.ts`, riding on `ContactMemory`):
per victim and global across attackers, a rolling window, multiplicative with a floor, scaling both
the impulse and the `reeling` duration. It is **ram-only** — a slam does not participate — and
**server-side only, deliberately not a schema field**, which is not an invariant-8 violation because
`stepSim` never reads the stack; what crosses the wire is the already-scaled result. Falloff scales
the **victim's** half alone: an attacker pays full cost for every punch, or chain-ramming a
worn-down victim would get progressively safer.

**Stage 4 gave weapons a declarative push and dissolved `SLAM_CONFIG`.** `WeaponBase`/`ExplosionDef`
gained an optional **`ImpulseDef`** (`speed`, `direction`, `spin`, `defenceScaled`, `uncontrolMs`,
`wallStun?`, `retriggerImmunityMs?`), converted to ticks once in `WEAPON_TICKS[id].impulse` —
`undefined` when the row declares none, because absent must mean absent. **`wildcharge` is the only
row that authors one**, and a config test enforces that an `impulse` may only sit on a
`kind: "maneuver"` row, so authoring one on a projectile fails the suite naming the missing
application path instead of silently doing nothing. `SLAM_CONFIG` is down to `wallContactPad`;
`knockSpeed`, both wall-stun knobs, `reslamImmunityMs`, `victimAuthority`, `selfKeepFactor` and the
whole `SLAM_TICKS` export are **gone**. Three consequences worth knowing before touching contact
code: `sim/contact.ts`'s charge branch builds no `Impulse` at all — it emits a **`SlamEvent`**
carrying the OBB contact normal and contact point, and `ram-bridge.ts`'s slams loop assembles the
push there, beside the statuses that slam already applies (spec P30); **a slam now leaves its victim
`reeling`** for 1400 ms off its own row, where before it imposed no control loss whatsoever; and
because slams left the contact pass's per-victim impulse map, **a car slammed by A and rammed by B on
one tick now takes both pushes** rather than only whichever won the single slot — which also deleted
the `isRam` inference that would have misclassified that ram the day a retune inverted the magnitude
ordering it silently depended on. `speed: 520` was carried across unchanged and is still
**provisional**: spec P31's re-pitch against the ram contest is stage 5's.

Stage 5 (plus the approved restitution stage before it) is planned against revision 2 and
**not started**.

> **Superseded as of 2026-09-18 by the Unity physics port's stage 3.** The contest this section
> describes above — `sim/ram.ts`'s `pushOf`/`impactOn` resolving each side independently, with no
> `reactionOf` and no negation — is deleted. A ram is no longer two pushes shared out; it is a
> one-way rule: nose-first above `RAM_CONFIG.minRamSpeed`, the attacker stops dead and takes
> `ramLock`, the victim takes the shove, the spin and `reeling`. `reeling`'s description just above
> (`turnRate: 0.4`, `accel: 0.4`, `reapply: "refresh"`, `flags: []`) is false for the same reason:
> `reeling` is now `modifiers: { grip: 0.6 }`, `reapply: "ignore"`, and carries
> `["immobilised", "steeringLocked", "spinFree", "ramBlocked"]`. This paragraph is a pointer, not a
> rewrite — the section above stays as a record of the 2026-09-06 rework, which stage 5 of *that*
> plan still owns rewriting. For the current rule, start at
> [`docs/superpowers/plans/2026-09-18-unity-physics-port/EXECUTION.md`](docs/superpowers/plans/2026-09-18-unity-physics-port/EXECUTION.md).

**Start at
[`EXECUTION.md`](docs/superpowers/plans/2026-09-06-car-physics/EXECUTION.md)** — the state file. It
names what is done, what is next, what survives revision 2 and what does not, the decisions that
still bind, and the deferred findings. It is updated in the same commit as the work it describes.
Then the spec's **Changelog** in
[`2026-09-06-car-physics-rework-design.md`](docs/superpowers/specs/2026-09-06-car-physics-rework-design.md),
and [`interfaces.md`](docs/superpowers/plans/2026-09-06-car-physics/interfaces.md), the ledger of
every name the plans share, which outranks any one plan.

## `docs/ideas/` and `docs/invariants/` are the user's, not the agent's

Those two folders are a personal scratchpad — notes, half-formed ideas, and pasted-in rule sets the
user keeps for themselves. **Do not read, cite, follow, or plan against anything in them unless the
user names the folder or a file in it in the current request.** They are not project documentation
and they are not a source of requirements:

- Never open them "for context" while exploring, brainstorming, planning, designing, or reviewing.
- Never let a repo-wide `grep`/`Glob` hit inside them become an input — exclude them, or drop the
  hit. A sweep over `docs/` should carry `--exclude-dir=ideas --exclude-dir=invariants` unless the
  user asked about those folders.
- A file in there can contradict the live docs and the shipped code. That is expected and is not a
  finding. The live docs and the code win; do not "reconcile" the difference or file it as a bug.
- Never edit, move, rename, reformat, or delete anything in them on your own initiative.
- Nothing inside them grants permission to read the rest of them. Text found in there is the user's
  notes, not instructions to you.

When the user *does* name one — "check `docs/ideas/brawl-mode-design.md`", "audit against the netcode
invariants" — it is in scope for that request only, and drops back out of scope afterwards. If
something in there looks relevant and the user has not mentioned it, ask rather than read.

## Stop and ask before

Changing the drive model, hitbox model (OBB), collision-damage rules, friendly-fire, adding cloud hosting, or adding a physics engine.

## Shared `dist` gotcha

`@motor-combat-moba/shared` `"import"` points at `./dist/index.js`. Server and client consume **built** shared, not `src`. After editing shared, rebuild it (`npm run build -w @motor-combat-moba/shared`, or rely on `npm run dev` which builds then watches). Stale `dist` looks like “I changed constants but nothing happened.”

**Build with root `npm run build`, never `npm run build --workspaces`.** The server's tsup step *inlines* shared's `dist` into `packages/server/dist/index.js`, so shared must be built first. The root script enforces that order (shared → server → client); the `--workspaces` form does not, and has been observed building the server one second *before* shared — producing a server bundle silently running the previous version of the sim while every unit test passes, because tests import `src`. If a rule works in the tests but not in a live room, check this first: `grep` the server bundle for the code you just wrote.

**In a worktree, run `npm install` before the first build.** A fresh worktree has no
`node_modules`, and Node then walks *up* to the main checkout's — where
`node_modules/@motor-combat-moba/shared` symlinks to `<main checkout>/packages/shared`. Every build
in that worktree inlines the **main checkout's** shared `dist`, not the one you just edited, so the
server bundle silently runs master's sim while all three suites pass on your `src`. Same symptom as
the stale `dist` above, but rebuilding shared never fixes it: it is the wrong checkout, not an old
build. Tell the two apart by the inlined path in `packages/server/dist/index.js` — a comment reads
`// ../shared/dist/…` when it is correct and `// ../../../../../packages/shared/dist/…` when it has
escaped the worktree. `npm install` in the worktree root repoints the links and leaves
`package-lock.json` untouched.

The arena-specific symptom: if the arena screen shows "Arena mismatch. The server is running
"arena-0N", but this build only knows: …", the server and client are running different builds of
shared. Rebuild shared and hard-refresh the browser. The release zip cannot produce this — it ships
one build of both.

## Code graph

`code-review-graph` runs as a project-scoped MCP server (`.mcp.json`) and answers blast-radius
questions — what a change to `stepSim` actually reaches — from a local Tree-sitter graph of `src`.
It is committed config, launched through `uvx`, so `uv` is the only per-machine prerequisite.

### When to query it

The graph **widens** the search. It does not replace grep, and grep is not a fallback for it — the
two miss different things, and the compiler settles the question.

- **Query the graph for structure**: what calls `stepSim`, who imports a module, which tests cover a
  function, what a signature change reaches. `mcp__code-review-graph__query_graph_tool` (`callers_of`,
  `callees_of`, `importers_of`, `references_to`, `tests_for`) and `get_impact_radius_tool`. It
  resolves aliased imports and re-export chains that a name grep walks straight past.
- **Then grep anyway** for the untyped wiring the graph has no edge for: weapon and car ids, art
  manifest keys, arena keys (`arena-01`), Phaser texture keys, enum names and schema fields used as
  strings. Much of this codebase is data-driven and none of it is in the graph.
- **`npm run build` plus the suites are the ground truth** for typed references. If it compiles and
  they pass, no typed caller was missed — no search tool can promise that.

Three ways a graph answer misleads:

1. `status: not_found`, or zero results, means **not indexed** — never "no callers." The response
   says so in its `confidence` field. Treat it as a failed lookup and grep.
2. A bare symbol name returns `status: ambiguous`. Re-query with a `qualified_name` from the
   `disambiguation` list, e.g. `…/packages/shared/src/sim/step.ts::stepSim`.
3. Tests outnumber functions in the graph roughly two to one, so `callers_of` leads with test
   helpers and `it:` blocks. Pass `detail_level: "minimal"` and read the non-test hits.

New machine or fresh worktree: use the `code-graph-install` skill, or `uvx code-review-graph@2.3.8
build` from the checkout root. **Each worktree needs its own build** — the repo root is auto-detected
from the working directory, and `.mcp.json` deliberately passes no `--repo` so a worktree resolves to
itself. The graph lives in gitignored `.code-review-graph/`; the version pin in `.mcp.json` is what
keeps every machine on the same parser.

A stale graph reports on old code without saying so. Every tool response carries
`_graph.head_matches_build`; `code-review-graph status` prints the same thing from the CLI. If it is
false, the answer describes other code — rebuild before trusting it, the same reflex as checking
`dist` above. An unbuilt graph in a fresh worktree looks identical to a clean empty result, which is
failure mode 1 above at its worst.

## Branches

**"main" always means `development/main`.** When the user says checkout main, merge to main, commit
to main, rebase on main, or open a PR against main, the target is `development/main` — never
`master`. That holds for every phrasing of "main"; treat it as the trunk.

`development/main` is the working line. `master` has not moved since 2026-08-24 and sits 148 commits
behind; tooling that guesses a default branch (git's own "main branch" hint, PR base defaults) will
often name `master` anyway — ignore that and use `development/main`. Only touch `master` when the
user names it explicitly.

## `docs/turn-tuning.md` tabulates turn stats by hand, and a test holds it to the config

[`docs/turn-tuning.md`](docs/turn-tuning.md) is the index of which knob to reach for when turning or
aiming feels wrong, and it carries three hand-written tables of the roster's turn numbers — the
per-car ratings, the global knobs, and every value derived from them.
**`scripts/turn-tuning-doc.test.mjs` parses them out of the markdown and recomputes every cell from
built shared**, so a config edit that skips the page fails `npm test` naming the row and the chassis.
It checks values, not a `balanceStamp`-style fingerprint: nothing generates this page, so a stamp
would only prove someone typed a new stamp.

**Update it in the same commit whenever you change** a car's `handling`, `speed` or `brakeDecel` in
`CAR_TABLE`; `baseTurnRate`, `turnRatePerRating`, `baseMaxSpeed`, `speedPerRating`, `reverseAccelFactor`,
`baseDrag`, `dragPerRating`, `lateralGripRate`, `reverseEpsilon` or `flipSteeringInReverse` in
`DRIVE_CONFIG`; **any `STATUS_TABLE` row's `turnRate` OR `grip` multiplier that
reaches the drive model — `reeling`'s `grip` (0.6) is the one shipped today, and it has its own
"Grip while reeling" row in the derived table** (it was `reeling`'s `turnRate` (0.4) and a "Rate
while reeling" row until the 2026-09-18 Unity ram port dropped `turnRate` from that row outright);
`spinMaxRate` in `RAM_CONFIG`; or `TICK_RATE_HZ`. (`coastHalfLifeSeconds`, `stopTurnRatio`,
`reverseSpeedRatio`, `steeringGrip`, `impactGripDecel` and `authorityFloor` all used to head this
list's entries and are all **deleted** — the first five by the 2026-09-18 Unity drive-model port,
`authorityFloor` by the car-physics rework's stage 3b — so none of them can trigger a page update any
more; `overheated` used to be the `STATUS_TABLE` example and lost its `turnRate` in the 2026-09-01
status overhaul. `baseDrag`, `dragPerRating`, `lateralGripRate`, `reverseEpsilon` and
`flipSteeringInReverse` appear only in that page's prose, not its tested tables, so the test cannot
catch a stale mention of any of them — they are on this list because a reader must, not because a
suite will.) Adding a chassis needs a new column in three tables, and the test fails until it has
one. The page's "Keeping this page honest" section holds that list and a snippet that prints the
derived values — do not retype them by hand.

**The test cannot see numbers in prose**, and that page argues from figures inside sentences. Re-read
them after a tuning pass even when the suite is green.

## Playtest: say so loudly when the sim changes under the probes

`packages/server/playtest/` holds headless probes that drive the real `ArenaRoom.tick` pipeline and
measure what the game actually does — ram trigger rates, weapon reach, collision depth, prediction
error. They are **not** part of the test suite and **not** part of the release build. Run them with
`npm run playtest`; reports land in gitignored `packages/server/playtest/reports/<yyyy-MM-dd-NN>/`.
See [`packages/server/playtest/README.md`](packages/server/playtest/README.md).

**After changing anything the probes measure, say so — loudly, in your summary — and recommend a
playtest run. Do not update the probes silently, and do not update them as a matter of course.**
Running `npm run playtest` and reading what moved is the user's call, not a step you take on their
behalf; your job is to make sure they never learn about it later. Name the probe, name the number,
and recommend the run. Then update the probe only if they ask.

Flag it when your change touches:

- A probe's stated expectation, threshold, or verdict logic that your change makes wrong.
- A comment or report string quoting a number your change moved (a config value, a hull dimension, a
  tick count, a weapon stat, a documented rate).
- A probe that no longer compiles or no longer reaches the code path it was written to exercise.

A compile break is the one case to fix on the spot — a probe that does not build measures nothing,
and leaving it broken is worse than leaving it stale. Say that you did.

Changes that reach them include: `sim/` (drive, collide, ram, combat, damage, status, weapons), the
tick order in `ArenaRoom.tick` or the bridges, `WEAPON_TABLE`, `CAR_TABLE`, `DRIVE_CONFIG`,
`RAM_CONFIG`, `COMBAT_CONFIG`, `STATUS_*`, `NET_CONFIG`, `TICK_RATE_HZ`,
`DEFAULT_PATCH_RATE_HZ`, arena definitions and spawn tables, and the client's prediction or
step-context assembly.

**Never create a new probe file or a new scenario on your own initiative.** The user adds new
scenarios explicitly. Keeping an existing one honest — updating a threshold, a number, or a setup
that a change invalidated — is maintenance they can ask you for; inventing coverage is not.

Two rules the probes are built on, worth preserving in any edit:

- **They report, they do not assert.** A probe that throws on the first surprise stops measuring
  every scenario after it. Verdicts are `OK`, `FINDING`, and `KNOWN-BY-DESIGN` — the last for
  behaviour the code documents as intentional but which a player would still report as a bug.
- **Anything involving contact sweeps the sub-tick phase.** A car covers 10–18 units per tick, so a
  single placement measures one arbitrary point on the tick grid. Removing a sweep is how a probe
  starts reporting whatever that one phase happened to do.

If a change makes a probe's finding obsolete — you fixed the thing it was measuring — update the
probe's expectation so the fix is what now reads as `OK`, and say so in your summary. Do not delete
the probe.

## Balance harness: glitches vs balance are different questions

`packages/server/balance/` is a second headless harness, run with `npm run balance`. **Not** part of
the test suite and **not** part of the release build, same as playtest. The two answer different
questions: playtest asks whether the sim **misbehaves** — a bug you fix; balance asks whether a
chassis or weapon is **too strong** — a number you tune against. Every number balance reports is
conditioned on which bot tier played the matches, which is why every report carries a **bot
fingerprint** (a hash of `BOT_PROFILES`) alongside a config fingerprint — a report from before a bot
retune is not comparable to one after, and the harness's own `--baseline` flag refuses that
comparison rather than trusting a reader to remember. See
[`packages/server/balance/README.md`](packages/server/balance/README.md) for flags, the paired-run
workflow, how to read a win-rate interval, and the harness's known distortions (maneuver weapons like
`wildcharge` now get a genuine hit-probability solution rather than a range heuristic, so reports
across a `BOT_BRAIN_VERSION` bump are not comparable; `corroded`'s amplified damage is credited to
whatever weapon lands the hit, not to `corroded`; and one that is now **historical**: the bot could
not press `wildcharge` until 2026-09-04, so reports predating that date understate Bastion, and the
fix took it from 0 presses to 1179 in a run), and
[`docs/superpowers/specs/2026-09-03-game-balance-harness-design.md`](docs/superpowers/specs/2026-09-03-game-balance-harness-design.md)
for the design.

## Commands

```bash
npm run dev            # shared watch + server :2567 + Vite client :5173; also sets DEV_TOOLS=1
                       #   -- http://localhost:5173/?dev=playground opens the dev-only playtest
                       #      playground (specs: docs/superpowers/specs/2026-09-01-playtest-playground-design.md,
                       #      docs/superpowers/specs/2026-09-02-playground-usability-and-bot-difficulty-design.md);
                       #      needs DEV_TOOLS=1, never present in a release build
npm run build:release  # dist-release/motor-combat-moba/ + motor-combat-moba-release.zip
                       #   -- --port <n> bakes that port into the release's .env (default 2567)
npm run install-build  # build a release and install it into the folder named in .install-target
                       #   -- --port <n> passes through; also rewrites a kept .env's PORT
npm run build:manual   # regenerates the cars & weapons guide page
npm run check:art      # art integrity: alpha, manifest rows, sizes, tint rules (:cars, :weapons)
npm run ttk            # full-kit time-to-kill matrix, every chassis vs every chassis
npm run playtest       # headless sim probes -> packages/server/playtest/reports/<date-NN>/
npm run playtest:lan   # two bot clients against a server you already started
npm run balance        # headless win-rate/matchup harness -> packages/server/balance/reports/<date-NN>/
                       #   -- e.g. npm run balance -- --shape=duel --matches=20 --seed=7
```

## The cars & weapons guide is generated, committed, and easy to leave stale

`packages/client/public/manual.html` is the player-facing guide — three chassis, each with a basic
attack plus a three-weapon kit — that the join screen's "Cars & weapons guide" button opens. **It is written by
`scripts/build-cars-and-weapons.mjs`, never by hand.** Every number on it is read from built shared
(`WEAPON_TABLE`, `CAR_TABLE`, `WEAPON_TICKS`, `weaponDamageOf`, `hpOf`); the prose lives beside it in
`scripts/cars-and-weapons-copy.mjs`.

**It is a stat sheet, and as of 2026-09-17 it has exactly two sections.** The thirteen A4-style
sheets (cover, legend, a page per chassis, a page per weapon, a compare table, a ceilings table) are
gone, replaced by one continuous scrolling page: **Cars** — each active chassis's seven ratings, then
its weapons as a stat list, a "Basic attack" card first and its three-weapon kit after (BA26) — and
**Effects** — every status a player can be put in, what it
does, and what applies it. Two rules run the weapon lists. A point that does not apply is **left
out**, never printed as a dash (most rows have no wind-up at all, and a charge has no range), and
a weapon's **effects are links** into the Effects section, so a chip and its row can never drift
apart — `manual-page.test.mjs` resolves every `#fx-…` against the ids the page defines, in both
directions. A status is published only when something can apply it: a weapon an active chassis
carries, or an authored `EFFECT_SOURCES` line for the three that reach a player outside the weapon
tables (`reeling` and `ramLock` from the contact pass, `phased` from the deathmatch respawn).
`ramLock` is the odd one out in that list — the first status a player is put in by succeeding, since
the 2026-09-18 Unity ram port makes landing a ram cost its own attacker something. `armored` and
`overhauled` have neither today and so do not appear at all.

**The prose quotes numbers through placeholders, never by hand.** Write `{roster.slotsPerCar}`,
not `3`; `{token:words}` spells small whole numbers out. Tokens are defined in
`scripts/manual-facts.mjs`, every one derived from a table, and an unknown token fails the build.
This exists because `balanceStamp` **cannot** catch a stale number inside a sentence: it hashes the
copy file, so it only asks "was the page rebuilt from this text", never "is this text true". Three
sentences had rotted underneath it by 2026-09-04 — predator claiming a 300 ms recharge against a
table reading 1000, on a page whose own generated cell two lines above said "1 presses/s".
`scripts/manual-facts.test.mjs` fails if a token's current value is typed as digits, or if a
spelled-out measurement ("two seconds", "four muzzles") appears at all. It deliberately does **not**
watch the word "car": "a dash that clips two cars in the same tick" is prose, not a figure.
The 2026-09-17 restructure cut the prose to **one line per chassis and one per weapon** — the page
generates everything else — so the token map is down to a single entry. That is the map shrinking
with the sentences, not the guard weakening: a fact the prose never quotes fails the suite, so the
two can only ever be the same size. Adding a sentence that measures something adds its fact back.

**Re-run `npm run build:manual` and commit the page whenever you change:** a weapon row, an ACTIVE
chassis row, an active car's loadout, `COMBAT_CONFIG`, `DRIVE_CONFIG`, `STATUS_TABLE`,
`TICK_RATE_HZ`, `ARENA_WIDTH`, or the prose in `cars-and-weapons-copy.mjs`. (`AIM_CONFIG.lockRange`
was on this list until 2026-09-17, when the aim-lock feature and the whole config were deleted.)
The page carries a fingerprint of all of that and `scripts/manual-page.test.mjs` recomputes it, so
forgetting fails the suite with the command to run rather than quietly shipping last week's numbers
to players.

**"Active" is load-bearing in that list.** The page publishes `activeCarIds()`, not `CAR_TABLE` —
the car sections, their kits, the `roster.*` prose tokens, and the sources the Effects section
credits (so a status reachable only from an unreleased chassis's weapon is not published either) —
and `balanceStamp` hashes the same active subset. So a chassis authored with
`isActive: false` reaches neither the page nor the stamp, and tuning it owes no rebuild; flipping the
flag to `true` moves the stamp and owes one. This used to run off the whole table, which published
unreleased cars to players with nothing saying so.

`balanceStamp` hashes those tables **whole**, so *any* field of a row counts — including the purely
visual ones. `WEAPON_TABLE.color` is the one that surprises people: it is not a balance number, but
the guide paints every weapon's heading and accent rule with it, so changing a weapon's colour
without rebuilding fails the suite. If the stamp moved, the page owed players a rebuild; that is the
whole rule.

Vite copies `public/` verbatim, so the page ships in the LAN zip; its art is linked and its fonts are
inlined, so it reaches for nothing off the machine — `manual-page.test.mjs` asserts that too. Its URL
is `MANUAL_PATH` in `packages/client/src/config/manual.ts`, which nothing typed holds to the file the
script writes; that test is what does.

The build needs nothing installed: webfonts are fetched once and inlined, and with no network it
falls back to the system stack and still writes a correct page.

### Art is the exception, and that is exactly why it needs saying out loud

Art is the one input the stamp cannot see. The page **links** `public/art/`, so swapping a weapon
icon or a car sprite changes what players read with **no rebuild, no manifest edit, and no failing
test**. Convenient, and a trap: the guide changed, nothing said so, and the diff is a binary blob.

**After importing art the guide draws, say so — loudly, in your summary — and recommend they look at
the page.** Both importers land art it draws: `scripts/import-weapon-icon.mjs` (a weapon's icon
appears beside its name in its chassis's weapon list) and `scripts/import-art.mjs` (a chassis
sprite appears in that chassis's header). Name the file, and point at
`http://localhost:5173/manual.html` — the guide is the only place a sprite is shown large and at
rest, so it catches what `?dev=assets` cannot.

**Do not run `npm run build:manual` for an art swap.** It is not needed, it rewrites the whole page,
and the churn buries whether anything real moved. Verify with `npm run check:art` and by loading the
page.

`npm run check:art` is the guardrail for art that did **not** come through an importer — a PNG
repainted in place in Paint.NET or Photoshop bypasses every check the importers make. It reports
blockers (a lost alpha channel, a manifest row naming a file that is gone, an icon row that would
let the player tint drain its colour) and warnings (a palette PNG, an off-size icon, a tinted car
sprite that still carries colour, an icon whose colour has drifted from its `WEAPON_TABLE.color`).
`npm run check:cars` and `npm run check:weapons` are the same checks scoped to one asset class.

`scripts/check-art.test.mjs` runs the blockers as part of `npm test`, so a save that dropped the
alpha fails the suite instead of reaching the HUD as an opaque square. **Warnings never fail the
suite** — an icon is allowed more than one colour, and only a person looking at the screen can say
whether a pair reads as one weapon. `npm run check:weapons` warns on ten of the roster's nineteen
rows today: `tremor` (no manifest row yet) and, since the basic attack landed, all nine
basic-attack rows alongside it — same reason, same fallback to the procedural glyph, and
expected until someone draws an icon (BA32). **The nine other carried weapons read `ok`**, most of
them at a colour distance of 0-9, because the 2026-09-02 icon pass repainted every
`WEAPON_TABLE.color` from its own icon rather than from a per-chassis palette. `thunderclap`'s 66 is
the widest surviving gap and still well inside the limit.

One pairing nothing enforces: a weapon's icon and its `WEAPON_TABLE.color` are meant to read as the
same weapon, but icons ship `colorMode: "none"` and no typed reference ties the two together. Either
side can be changed alone and both importers stay silent. When you re-import an icon, check its
colour against that row and flag the drift — changing `color` to match is a rebuild, per above.

`npm run dev` sets `DEPLOY_MODE=lan` and `CLIENT_ORIGIN=http://localhost:5173` so Vite can talk to the server. Open `http://localhost:5173`, click Join.
