# Stage 5: Tune and Reconcile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a working port into a shipped one — values the user has actually driven, probes that
measure the model that exists, a balance baseline that means something, and docs that describe the
car the code now drives.

**Architecture:** No new mechanisms. Stages 1–4 built the model; this stage settles its numbers and
discharges every obligation the spec's §12 records. It is the stage most likely to be skipped,
because **almost nothing in it fails a test if left undone** — the four things that do are
`scripts/turn-tuning-doc.test.mjs`, `scripts/manual-page.test.mjs`, `packages/shared/src/config/config.test.ts`
and the root `npm test` as a whole, and all four can be satisfied without any of the judgement this
stage exists to collect.

**Tech Stack:** TypeScript, npm workspaces, vitest. `@motor-combat-moba/shared` is consumed as built
`dist` — rebuild it after editing (`npm run build -w @motor-combat-moba/shared`).

**Spec:** [`docs/superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md`](../../specs/2026-09-18-unity-driving-and-ram-physics-port-design.md)
— §9 (the starting values this stage settles), §12 (Obligations this work incurs — most of this
stage), §14 (Exit criteria), and decisions U2, U5, U6, U10, U25.

**Ledger:** [`interfaces.md`](interfaces.md) — outranks this plan for every shared name.

**Depends on:** Stages 1–4 complete, root `npm test` green except the three bot tests named below.

**Replaces:** [`docs/superpowers/plans/2026-09-06-car-physics/05-tune-and-reconcile.md`](../2026-09-06-car-physics/05-tune-and-reconcile.md).
That stage's Task 1 tuned a drive and ram model this port deletes — do not run it. What carries over
from it, per spec §3, is the guide rebuild, the probe honesty pass, the balance re-baseline, the
`CLAUDE.md` update, the `docs/turn-tuning.md` pass, the `wildcharge.impulse.speed` re-pitch, and the
deferred `DRIVE_CONFIG.dashSubstepMaxUnits` 16 → 8 judgement. Every one of those is a task below.

## Global Constraints

Identical to stage 1 — see [`01-drive-model.md`](01-drive-model.md#global-constraints). Plus:

- **Running the tuning, and judging what the numbers should be, is the USER'S call.** Every step in
  Tasks 2, 3 and 4 that reads "present … and wait" is exactly that: present the reading, name the
  knob, and stop. An agent may drive the playground to *produce* a measurement and may type a value
  the user names; it may not pick a value because one felt better.
- **Running `npm run playtest` and `npm run balance` and deciding what the numbers mean is the
  user's call too.** Your job is that they never learn about a moved number later.
- **Never create a new playtest probe or a new scenario.** Keeping an existing one honest is
  maintenance the user can ask for; inventing coverage is not. Deleting a probe is never the answer.
- Probes **report**, they do not assert. Verdicts are `OK`, `FINDING`, `KNOWN-BY-DESIGN`.
- **Anything involving contact sweeps the sub-tick phase.** A car covers 4.5–6.3 u/tick at the
  post-port top speeds, so a single placement measures one arbitrary point on the tick grid.
- **Fix a probe's compile break on the spot.** A probe that does not build measures nothing, and
  leaving it broken is worse than leaving it stale. Say in the summary that you did.
- **Three bot tests were already red before this work started** —
  `packages/server/src/bot/brain/controller.test.ts`'s OFF-AXIS mean-offset case, and
  `packages/server/src/bot/brain/tiers.test.ts`'s P49 and P50. They are not this work's to make green
  and **never this work's to silently re-pin.**
- Do not touch `docs/ideas/` or `docs/invariants/`.

---

### Task 1: Pre-flight — prove the playground can move every knob the pass needs

**Files:**
- Read: `packages/shared/src/config/tuning-walker.ts:78-101,188-216`,
  `packages/shared/src/config/tuning.ts:124-142`, `packages/shared/src/config/ram-config.ts`
- Possibly modify: `packages/shared/src/config/ram-config.ts`, `packages/shared/src/config/tuning.ts`
- Test: `packages/shared/src/config/tuning.test.ts`

**Interfaces:**
- Consumes: stages 1–4's `DRIVE_CONFIG`, `RAM_CONFIG` and `WEAPON_TABLE.wildcharge.impulse`.
- Produces: nothing shared. A go/no-go for Tasks 2 and 3.

This task exists because the superseded stage 5 sent a user to the playground to dial
`car.<id>.coastHalfLifeSeconds`, **which the tuning walker never emitted** — `buildFields` walks only
`CAR_RATINGS` for a car (`tuning-walker.ts:188-206`), so every non-rating `CarDef` field is invisible
to the panel. Do not repeat that: check first, then spend the user's evening.

- [ ] **Step 1: Build shared and enumerate what the panel actually offers**

```bash
npm install
npm run build -w @motor-combat-moba/shared
node -e "import('./packages/shared/dist/index.js').then(({tunableFields})=>{const want=['drive.baseMaxSpeed','drive.speedPerRating','drive.baseDrag','drive.dragPerRating','drive.lateralGripRate','drive.baseTurnRate','drive.turnRatePerRating','drive.reverseAccelFactor','drive.reverseEpsilon','drive.flipSteeringInReverse','drive.restitution','drive.dashSubstepMaxUnits','ram.globalScale','ram.spinScale','ram.minRamSpeed','ram.attackerLockMs','ram.ramUncontrolMs','ram.headOnScale','ram.flankScale','ram.rearScale','ram.cornerBandUnits','ram.headOnAngleDeg','ram.spinMaxRate','ram.reelingSpinDecayRate','weapon.wildcharge.impulse.speed','weapon.wildcharge.impulse.uncontrolMs'];const have=new Set(tunableFields().map(f=>f.path));for(const p of want)console.log((have.has(p)?'ok      ':'MISSING ')+p);})"
```

Expected: every line reads `ok`. `drive.flipSteeringInReverse` comes through as
`kind: "boolean"` (`tuning-walker.ts:95-97`), so it is a toggle rather than a slider — that is
correct, not a gap.

- [ ] **Step 2: Verify the ram durations really are live now**

A path appearing in `tunableFields()` only proves the panel shows a control. It does not prove the
sim reads the new value: until stage 3, `RAM_TICKS` was frozen at module load and `setTuning` never
rebuilt it, so `ram.ramUncontrolMs` was a slider that changed nothing (spec U40). Stage 3 replaced it
with the `ramTicks()` accessor and a `rebuildRamTicks` call in `tuning.ts`. Prove it landed before
spending the user's evening on it:

```bash
node -e "import('./packages/shared/dist/index.js').then(({setTuning,ramTicks,RAM_CONFIG,TICK_RATE_HZ})=>{console.log('shipped',RAM_CONFIG.ramUncontrolMs,'->',ramTicks().uncontrol);setTuning({'ram.ramUncontrolMs':2000});console.log('overridden to 2000 ->',ramTicks().uncontrol,'(expected',Math.round(2000/1000*TICK_RATE_HZ)+')');setTuning(null);})"
```

Expected: the second figure follows the override. If it does not, stage 3 is incomplete — stop and
fix it there rather than tuning around it.

**One knob genuinely is not dialable, and that is known:** `CarDef.brakeDecel` is not emitted at all,
because `buildFields` walks `CAR_RATINGS` only (`tuning-walker.ts:188-206`). Spec §9.1 keeps the
roster's 500 / 520 / 430, so it is not expected to move — but if the user wants it moved during
Task 2 it is a source edit plus `npm run build -w @motor-combat-moba/shared` plus a restart, not a
slider. Say so when it comes up rather than letting them drag a control that is not there.

- [ ] **Step 3: Report the emitted paths to the user**

Report which of the expected paths are present and whether the ram durations followed the override.
This is a status report, not a decision: the two structural questions it used to ask were answered
before this stage started.

---

### Task 2: The playground driving pass — with the user

**Files:** none committed here. Task 5 writes the settled values down.

**Interfaces:**
- Consumes: Task 1's go/no-go.
- Produces: the user's settled `DRIVE_CONFIG.baseMaxSpeed`, `.speedPerRating`, `.baseDrag`,
  `.dragPerRating`, `.baseTurnRate`, `.turnRatePerRating`, `.lateralGripRate`, `.reverseAccelFactor`,
  `.reverseEpsilon`, `.flipSteeringInReverse`.

**This whole task is the user's. You drive the tooling; they drive the car and name the numbers.**

- [ ] **Step 1: Open the playground**

```bash
npm run dev
```

Then `http://localhost:5173/?dev=playground`. `npm run dev` sets `DEV_TOOLS=1`, which the playground
needs and a release build never has. Every `DRIVE_CONFIG` and `RAM_CONFIG` key except `carWidth` and
`carHeight` is dialable live from the settings panel with no rebuild (`tuning-walker.ts:63-69,209-215`).

The playground seats six cars with stable ids `pg-0`…`pg-5`; who you drive is the per-seat radio in
the Car select panel, and a disabled seat keeps its configuration. For this task, enable one seat
(yours) and one parked bot — a duel and a six-way are two clicks apart when Task 3 needs the second.

- [ ] **Step 2: Record the baseline before touching anything**

These are spec §9's starting values and the figures they derive to. Print them so the user can see
what "before" was, and so a later session can tell a tuned number from an untouched one:

```bash
node -e "import('./packages/shared/dist/index.js').then(({CAR_TABLE,DRIVE_CONFIG,driveOf,activeCarIds})=>{console.log('baseDrag',DRIVE_CONFIG.baseDrag,'dragPerRating',DRIVE_CONFIG.dragPerRating,'lateralGripRate',DRIVE_CONFIG.lateralGripRate,'baseTurnRate',DRIVE_CONFIG.baseTurnRate,'turnRatePerRating',DRIVE_CONFIG.turnRatePerRating,'reverseAccelFactor',DRIVE_CONFIG.reverseAccelFactor,'reverseEpsilon',DRIVE_CONFIG.reverseEpsilon,'flipSteeringInReverse',DRIVE_CONFIG.flipSteeringInReverse);for(const id of activeCarIds()){const d=driveOf(id);console.log(id.padEnd(9),'top',d.maxSpeed.toFixed(1),'push',d.engineAccel.toFixed(1),'drag',d.dragRate.toFixed(4),'t90',(Math.log(10)/d.dragRate).toFixed(2)+'s','roll',(d.maxSpeed/d.dragRate).toFixed(0)+'u','turn',d.turnRate.toFixed(3),'radius',(d.maxSpeed/d.turnRate).toFixed(1)+'u','slip',(Math.atan(d.turnRate/DRIVE_CONFIG.lateralGripRate)*180/Math.PI).toFixed(1)+'deg','rev top',(d.maxSpeed*DRIVE_CONFIG.reverseAccelFactor).toFixed(1));}})"
```

Expected at the §9 starting values (Mirage / Bullseye / Bastion):

| | top speed | engine push | drag rate | to 90% | roll | turn rate | radius | slip |
|---|---|---|---|---|---|---|---|---|
| mirage | 189.0 u/s | 242.9 u/s² | 1.2848 /s | 1.79 s | 147 u | 2.104 rad/s | 89.9 u | 16.7° |
| bullseye | 158.7 | 165.3 | 1.0416 | 2.21 s | 152 u | 1.766 | 89.9 u | 14.2° |
| bastion | 135.9 | 120.9 | 0.8896 | 2.59 s | 153 u | 1.512 | 89.9 u | 12.2° |

**Note the radius column before the user starts.** All three chassis land at the same 89.9 u — 1.5
car lengths — because §9.2 anchored `baseTurnRate`/`turnRatePerRating` on exactly that. Turn radius
stopped being a legible axis of the type triangle in the 2026-09-16 speed cut (it collapsed to a
1.5 u band) and this port does not restore it; it makes the collapse exact. **Say this to the user
up front**, because "the three cars corner the same" is a thing they may well notice in Step 5 and
mistake for a bug. Widening it back out is a per-car `handling` spread, which is a roster edit rather
than a `DRIVE_CONFIG` one.

- [ ] **Step 3: Top speed — `drive.baseMaxSpeed`, `drive.speedPerRating`**

Spec §9.1 keeps these at 60 / 1.518 deliberately: three tuning passes put the roster where it is and
the port does not re-litigate them. Start here anyway, because everything below is judged relative to
how fast the car is going.

**What to look for:** does a car crossing the 1132-unit playable width read as fast, and is the gap
between Mirage and Bastion legible from the seat rather than only on paper? At the starting values
that crossing is 6.0 s for Mirage and 8.3 s for Bastion.

**Present and wait.** If the user wants these moved, note that they are the only pair in this task
whose change is *not* expected — everything else in §9.2 is new or retuned and is meant to move.

- [ ] **Step 4: Drag — `drive.baseDrag`, `drive.dragPerRating`. This is the single biggest lever.**

**This is the one number that makes the port feel like the port.** Under one drag rate, top speed
(`engineAccel / dragRate`), the wind-up time constant and the roll distance are the same number
(U4) — a car cannot have a snappy launch and a long roll. Raising drag makes the car reach speed
sooner AND stop sooner AND (unless push is re-derived) top out lower; `engineAccelOf` is derived
from `forwardMaxSpeedOf × dragRateOf`, so in the playground top speed holds while wind-up and roll
move together. That coupling is the whole model and the user should be told it before they touch the
slider, not after they ask why the car got slower.

**What to look for, in this order:**

1. **Wind-up.** From a standing start, does the car feel like it has mass, or does it snap to speed?
   At 0.768 / 0.00608 it takes 1.79 s (Mirage) to 2.59 s (Bastion) to reach 90% of top speed. The
   spec picked that band deliberately between today's 1.06–1.54 s and Unity's 2.3 s.
2. **Roll.** Lift off at speed and watch where the car stops. Target is ~2.5 car lengths
   (147–153 u against a 60 u hull). **The failure mode to name out loud is "slow and light"**: a car
   that is not fast but also does not carry — that is drag too high, and it is what the 2026-09-16
   pass accidentally produced by cutting the ceiling without touching accel.
3. **The two together.** Drag is one knob, so a user who wants a longer roll is asking for a slower
   wind-up and must be told so. If they want both independently, that is U4 being overturned and is
   a spec change, not a tuning decision — escalate rather than adding a second knob.

**Present each trial's numbers and wait.** Re-run Step 2's script after every accepted change; the
`t90` and `roll` columns are what the user is actually judging.

- [ ] **Step 5: Turn rate — `drive.baseTurnRate`, `drive.turnRatePerRating`**

**Only after drag is settled.** Radius is `speed / turnRate`, so every drag or speed change has
already moved cornering; touching turn rate first over-corrects and nobody can tell which change did
it. That ordering is the same rule the 2026-09-06 pass wrote down and it still holds.

**What to look for:**

1. **Turning on the spot.** U9 deleted `stopTurnRatio` — a stopped car turns at the full rate now,
   where it used to turn at half. Is a stationary pivot too fast to aim with?
2. **Radius at speed.** 89.9 u at the starting values for all three, against a 1132 × 612 playable
   octagon: a full circle is 565 u across, half the arena's width. Too wide and a fight becomes two
   cars orbiting; too tight and the drift in Step 6 never shows.
3. **Reverse.** With `flipSteeringInReverse: true` a genuinely reversing car steers like a real car;
   turn the toggle off in the panel and it steers like a tank. Ask the user to try both. The flip
   needs `forwardSpeed < -reverseEpsilon`, so a car turning on the spot is unaffected either way.

**Present and wait.**

- [ ] **Step 6: Drift — `drive.lateralGripRate`**

The drift knob, and the feature U3 exists for. The steady-state slip angle holding full lock is
`atan(turnRate / lateralGripRate)` **at any speed**, which is why this tunes as "how much does the
car slide" rather than as per-speed guesswork. Lower grips less and drifts more; 0 is a hockey puck.

**What to look for:**

1. **Does the slide read as deliberate or as a loss of control?** That is spec §14's exit criterion
   verbatim, and it is the only way to judge this. 7.0 gives 12.2°–16.7° across the roster, against
   Unity's ~15°.
2. **Can you still shoot where you meant to?** A car's shots go along its heading, always
   (`docs/combat-model.md`'s "Shot direction: the heading, always"), so a drifting car's nose and its
   travel diverge by exactly the slip angle. At 17° that is a real aiming cost and it is intended; at
   35° it may make a ranged chassis unplayable.
3. **Coming out of a turn.** Does the car straighten, or does it keep sliding for an uncomfortable
   beat? That beat is `1 / lateralGripRate` seconds — 333 ms at 3.0.
4. **What a ram feels like through it.** A `reeling` car keeps only `grip: 0.6` of this rate, so its
   imposed sideways velocity rides roughly 1.7x further than a driver would slide. Ask the user to
   get rammed once here rather than waiting for Task 3 — it is the same knob showing its other face,
   and the two are tuned against each other (spec §5).

**Present and wait.**

- [ ] **Step 7: Reverse — `drive.reverseAccelFactor`, `drive.reverseEpsilon`**

Reverse top speed is emergent now: `maxSpeed × reverseAccelFactor` (U15), 0.4 at the starting values
against today's 0.65 — so reverse drops from 122.9 / 103.1 / 88.3 u/s to 75.6 / 63.5 / 54.4.

**What to look for:** backing out of a corner, and reversing as a dodge (the bot's `evade` does
this — see `docs/bot-behavior.md:190-200`). `reverseEpsilon` 6.0 u/s is the threshold where Down
stops braking and starts reversing, and also where the steering flips; `reverseHoldTicks`'s 66 ms
delay is gone (U14), so the changeover is immediate. Ask whether that reads as responsive or as
twitchy.

**Present and wait.**

- [ ] **Step 8: Record the settled set, do not commit yet**

Export from the playground's settings panel, or transcribe. Task 5 writes them into the tables in one
commit with the ram values, because `balanceStamp` and `docs/turn-tuning.md` both want a single
settled state rather than a trail of half-tuned ones.

---

### Task 3: The playground ram pass — with the user

**Files:** none committed here. Task 5 writes the settled values down.

**Interfaces:**
- Consumes: Task 2's settled drive values (a ram's magnitude is linear in drive-in speed, so tuning
  ram before drive measures a number that is about to move).
- Produces: the user's settled `RAM_CONFIG.globalScale`, `.spinScale`, `.minRamSpeed`,
  `.attackerLockMs`, `.ramUncontrolMs`, and `WEAPON_TABLE.wildcharge.impulse.speed`/`.uncontrolMs`.

**Also the user's.** Same rule: you produce the measurement, they name the number.

- [ ] **Step 1: Set the seats up and record the ram baseline**

Enable a second seat as a parked bot and a third as a moving one. Then print what the starting values
predict, so a felt "that was huge" has a number beside it:

```bash
node -e "import('./packages/shared/dist/index.js').then(({RAM_CONFIG,DRIVE_CONFIG,driveOf,ramAttackOf,ramDefenceOf,activeCarIds})=>{const I=(DRIVE_CONFIG.carWidth**2+DRIVE_CONFIG.carHeight**2)/12;console.log('inertiaRadiusSquared',I.toFixed(2),'globalScale',RAM_CONFIG.globalScale,'spinScale',RAM_CONFIG.spinScale,'minRamSpeed',RAM_CONFIG.minRamSpeed,'spinMaxRate',RAM_CONFIG.spinMaxRate);for(const a of activeCarIds())for(const v of activeCarIds()){if(a===v)continue;const drive=driveOf(a).maxSpeed;for(const [t,s] of [['flank',RAM_CONFIG.flankScale],['rear',RAM_CONFIG.rearScale],['headOn',RAM_CONFIG.headOnScale]]){const shove=drive*s*RAM_CONFIG.globalScale*ramAttackOf(a)/ramDefenceOf(v);const spin=Math.min(RAM_CONFIG.spinMaxRate,RAM_CONFIG.spinScale*(DRIVE_CONFIG.carWidth/2)*shove/I);console.log(a.padEnd(9),'->',v.padEnd(9),t.padEnd(7),'shove',shove.toFixed(0).padStart(4),'u/s   max spin',spin.toFixed(2),'rad/s');}}})"
```

At the §9.3 starting values the headline case the spec pitched `globalScale: 0.5` against is
**Bastion flanking a Bullseye at top speed → ~237 u/s**, about four car lengths of slide. Spin at a
full half-width lever arm comes out near 4.9 rad/s against the 6 rad/s clamp; a typical off-centre
hit lands nearer 3.3.

- [ ] **Step 2: `ram.globalScale` — how hard a ram throws**

**What to look for:**

1. **Flank a parked bot at full speed.** Does it read as an impact? ~237 u/s of slide is the target
   the spec pitched; more than that and a single ram deletes someone into the spike walls, less and
   the new "you stop dead" cost buys the attacker nothing.
2. **Flank a bot fleeing at your own speed.** It should barely move — drive-in is
   `max(0, dot(preCollisionVelocity, flatForward))`, so chasing someone at matched speed brings
   almost nothing into the contact. That is the rule working, not a weak knob.
3. **The spike interaction.** Spikes deal a flat 80 damage on a fresh push into the surface above
   `SPIKE_CONFIG.triggerSpeed` (25 u/s), credited to whoever last shoved within `shoverCreditMs`. A
   237 u/s punt into a wall clears that threshold by an order of magnitude, and the victim is
   `spinFree` and `grip: 0.6` for the whole ride. **Ask the user explicitly whether a ram-into-spikes
   kill reads as skilful or as cheap** — it is the single most likely way this port ships too strong,
   and no test can answer it.

**`globalScale` is the calibration knob** reconciling Unity's 1-vs-1 `strength`/`resistance` with
this roster's 45–70 `ramAttack` and 30–90 `ramDefence` (U25). Spec §9.3 says **re-measure in stage 5;
do not re-derive** — which means: change it, drive it, and re-run Step 1's script to record what the
new number produces. Do not recompute it from a formula.

**Present and wait.**

- [ ] **Step 3: `ram.spinScale` — how much a ram spins you**

Spin is `spinScale × cross(contactPoint − victimCentre, shove) / inertiaRadiusSquared`, clamped at
`spinMaxRate` 6. `inertiaRadiusSquared` is derived from the hull (433.33 at 60 × 40) and is not a
knob — it cannot drift from `carHullOf` and must not be typed.

**What to look for:** hit a bot off-centre. The victim should be visibly spun and still able to
shoot (`reeling` carries no `disarmed`), and the spin should end the instant the reel lapses — U16
made `angVel` the steering's actual yaw rate, so a car under control has exactly the rate its
steering asks for. **Ask whether the spin reads as legible or as a blender.** A dead-centre hit
imparts almost no spin by construction; that asymmetry is the feature.

Note for the user: the clamp is a playability guard, not a model term (U26). Unity has none and does
not need one at its scale. If spin is hitting 6 on ordinary rams, `spinScale` is the knob, not
`spinMaxRate`.

**Present and wait.**

- [ ] **Step 4: `ram.minRamSpeed`, `ram.attackerLockMs`, `ram.ramUncontrolMs`**

1. **`minRamSpeed` (39 u/s).** Below this, a nose-first contact is a plain bump. Ask the user to
   nudge a bot at walking pace and confirm nothing happens, then to find the speed where it starts
   to. 39 against top speeds of 135.9–189.0 is 21–29% of a chassis's ceiling.
2. **`attackerLockMs` (500 ms).** **This is the new cost and the thing most likely to surprise.**
   Landing a ram sets your own velocity to zero and gives you `ramLock` — `immobilised`,
   `steeringLocked`, `ramBlocked` — for half a second. Ask: after a successful ram, is the half
   second of being a parked car a fair price, or does it hand the fight to whoever was watching?
   Ram a bot with a third car nearby and find out.
3. **`ramUncontrolMs` (1000 ms).** The victim's `reeling`. Under U31 this is now a *total* loss of
   control — sliding, spinning, no steering, no throttle, guns still live — where before it was a
   0.4/0.4 degradation. **A second of that is a much bigger second than it used to be.** Ask whether
   it reads as "flung and fighting for grip" or as a stun.
4. **`reeling`'s `grip` multiplier (0.6).** How far the shove actually carries the victim, and the
   second half of the pair Task 2 Step 6 set (spec §5). At 0.6 of a 3.0 base that is 1.8/s, so a
   237 u/s shove rides ~132 u — about 2.2 car lengths. Lower it and a rammed car sails; raise it
   toward 1 and a ram becomes a shove-and-spin that ends where it started. **Tune this against the
   spikes specifically:** ask the user to be rammed toward a spike wall at 0.6, then at 1.0, and say
   which reads as a fair punish rather than a delete. It lives in `STATUS_TABLE.reeling.modifiers`,
   so it is a source edit and a rebuild rather than a slider unless the status table is tunable —
   check `tunableFields()` output from Task 1 before promising the user a live dial.

**If Task 1 Step 2 showed the ram durations NOT following an override**, stop: stage 3 is incomplete and items 2 and 3 below are not live sliders.
each trial is a source edit in `packages/shared/src/config/ram-config.ts`, then
`npm run build -w @motor-combat-moba/shared`, then restart `npm run dev`. Say so before the user
starts moving a slider that does nothing.

**Present each and wait.**

- [ ] **Step 5: `wildcharge.impulse.speed` and `.uncontrolMs` — the inherited re-pitch**

Stage 4 of the car-physics rework carried `speed: 520` across unchanged and marked it **provisional**;
the port's spec §9.3 sharpens the obligation rather than dropping it. Two things changed under it:

- The ram scale it has to beat is new (Step 2's `globalScale`), and
- under U31 `wildcharge`'s 1400 ms of `reeling` is now 1.4 seconds of *total* control loss, so its
  victim keeps every unit of a 520 u/s punt with no grip to bleed it sideways — into a wall, and
  often into the spikes, far more reliably than before.

**What to do:**

1. As Bastion, wildcharge a bot. Then, in the same session, land your best ordinary flank ram on the
   same bot. **Compare them directly.** Spec §14: "`wildcharge` is still clearly harder than the best
   ordinary ram." At the starting values that is 520 u/s authored against ~237 u/s contested, and a
   1400 ms total reel against a 1000 ms one.
2. Check the slam's exemptions still read right: a slam takes no falloff and is not counted into the
   stack (U6), and its attacker is neither stopped nor locked. Chain-ram a bot three times, then
   wildcharge it — the ult should land at full strength on a victim the rams have worn down.
3. **Present both readings and wait.** This is the single most likely thing in the whole port to ship
   wrong, and it is a weapon number, so it carries every obligation the root `CLAUDE.md`'s weapon
   rules impose: a `WEAPON_TABLE` edit moves `balanceStamp` and owes `npm run build:manual` (Task 5).

- [ ] **Step 6: Run the spec's own exit criteria past the user, in the playground, before leaving it**

Spec §14, as a checklist. Read each aloud, have the user confirm or reject:

- [ ] A car takes noticeably longer to reach top speed than today, and rolls about 2.5 car lengths.
- [ ] Holding full lock at speed leaves the car visibly sliding, deliberately rather than out of
      control.
- [ ] A car turns on the spot at full rate; reversing steers like a car with the flip on and like a
      tank with it off.
- [ ] Driving into a wall at any angle slides along it; nothing rebounds.
- [ ] A nose-first flank ram at speed stops the attacker dead, flings and spins the victim, and
      leaves it a passenger for about a second.
- [ ] A flank-first slide into someone does nothing but bump.
- [ ] A head-on stops both cars and reels neither.
- [ ] Chained rams fall off; three seconds later they do not.
- [ ] `wildcharge` is still clearly harder than the best ordinary ram.

Record which of these the user actually exercised and which they did not — an unticked box is
information, and the car-physics rework's `EXECUTION.md` is a standing lesson in how long unticked
hands-on criteria survive unnoticed.

---

### Task 4: The inherited `dashSubstepMaxUnits` 16 → 8 judgement

**Files:**
- Read: `packages/shared/src/config/drive-config.ts:145-216`
- Possibly modify: `packages/shared/src/config/drive-config.ts:216`,
  `packages/shared/src/sim/step.test.ts` (`MEASURED_WORST_REACHABLE`)

**Interfaces:**
- Consumes: Task 2's settled drive values.
- Produces: either an unchanged `dashSubstepMaxUnits: 16` with the decision recorded, or an 8 with
  the measurement re-run.

This is carried in from stage 2 of the **2026-09-06** rework, untouched by this port (spec §3: "it
concerns the dash and the collision resolver — and carries over unchanged"). Read the constant's own
doc comment first; the trade is already measured and must not be re-derived from scratch.

- [ ] **Step 1: Re-read the measurement table and check it still holds**

`drive-config.ts:199-205` carries it, measured against the 60 × 40 hull and the `ramDefence`-weighted
separation split:

| `dashSubstepMaxUnits` | substeps/tick | worst penetration |
|---|---|---|
| 16 (current) | 4 (13.3 u each) | 18.49 u |
| 12 | 5 (10.7 u each) | 15.87 u |
| 8 | 7 (7.6 u each) | 12.14 u |
| 6 | 9 (5.9 u each) | 9.70 u |
| 4 | 14 (3.8 u each) | 6.34 u |

**One thing this port may have moved:** the table's worst case is Mirage's `thunderclap` dash
T-boning a Bullseye, and the knob is denominated in world units, so the dash's own 1600 u/s travel
and the substep count are unchanged. But the *decay* after arrival — `18.49 → 4.33 → 1.02 → …` — is
the two cars each running `resolveWorld` and conceding their `shareOf` of the MTV, and `restitution`
is now 0. Confirm the decay figures in the doc comment by running the suite that pins them:

```bash
npm test -w @motor-combat-moba/shared -- step.test
```

Expected: PASS, with `MEASURED_WORST_REACHABLE` unchanged at `18.492296006944457`. **If it moved,
the doc comment's whole table is stale and that is a finding to report, not a number to quietly
re-pin.**

- [ ] **Step 2: Have the user judge the dash**

In the playground, as Mirage, dash into a parked Bullseye at every angle they care to try. The
question is only: **is the momentary penetration visible, and does it bother you?** It clears in
about three ticks (~100 ms). A dash into a *wall* is not the case — `thunderclap` is the only dash
in the game and `wildcharge` is a charge, which never substeps this way.

**Present the table and the reading, and wait.** The trade is 18.49 u of momentary overlap at 16
against 12.14 u at 8, for double the collision checks per dash tick.

- [ ] **Step 3: If and only if the user says 8**

Change `drive-config.ts:216` to `8`, update the `(current)` marker in the table at line 201 and the
"Lowering it to 8 is the deferred fix" paragraph at 207-215 to record that stage 5 of the Unity port
took the trade and on whose say-so, and re-measure:

```bash
npm test -w @motor-combat-moba/shared -- step.test
npm run build && npm test
```

`step.test.ts`'s `MEASURED_WORST_REACHABLE` becomes the new figure from the table. **Read the failure
and write down why the new number is right** before pasting it in.

- [ ] **Step 4: Either way, record the decision**

If the answer is 16, say so in the commit and in `EXECUTION.md` — a judgement made and recorded is
done; a judgement deferred silently is how this one survived two reworks.

---

### Task 5: Land the settled values, and reconcile what they move

**Files:**
- Modify: `packages/shared/src/config/drive-config.ts`,
  `packages/shared/src/config/ram-config.ts`, `packages/shared/src/config/weapon-config.ts`
  (`wildcharge.impulse`), `packages/shared/src/config/car-config.ts` (only if a rating moved),
  `docs/turn-tuning.md`, `packages/client/public/manual.html` (generated)
- Test: `packages/shared/src/config/config.test.ts`, `scripts/turn-tuning-doc.test.mjs`,
  `scripts/manual-page.test.mjs`

**Interfaces:**
- Consumes: Tasks 2, 3 and 4.
- Produces: the shipped config.

- [ ] **Step 1: Write the values in, with a doc comment each**

Every changed constant records what it was, what it is, and that a playground pass with the user set
it — same form the existing rows use. A value the user confirmed *unchanged* gets a line saying so;
"we looked at it and kept it" is a different fact from "nobody looked".

- [ ] **Step 2: Rebuild and run the suite**

```bash
npm run build -w @motor-combat-moba/shared && npm test
```

Expected: PASS except `scripts/turn-tuning-doc.test.mjs` (Step 3) and the three already-red bot
tests. `config.test.ts`'s rating-50 anchors from stage 1 Task 6 Step 4 will fail if the user moved
`baseTurnRate`/`turnRatePerRating` or `baseDrag`/`dragPerRating` — update the anchor numbers, not the
assertions' shape.

- [ ] **Step 3: Re-run `docs/turn-tuning.md` against the settled numbers**

Stage 1 Task 7 rewrote that page's four tables against the *starting* values; every derived cell
moves again with whatever the user settled on. The test parses the tables out of the markdown and
recomputes every cell from built shared, matching the derived table's rows **positionally**, so the
page and the test move together or the suite fails.

```bash
node -e "import('./packages/shared/dist/index.js').then(({CAR_TABLE,DRIVE_CONFIG,driveOf})=>{for(const id of Object.keys(CAR_TABLE)){const d=driveOf(id);console.log(id,d.maxSpeed.toFixed(2),d.engineAccel.toFixed(2),d.dragRate.toFixed(4),(Math.log(10)/d.dragRate).toFixed(2),(d.maxSpeed/d.dragRate).toFixed(1),(d.maxSpeed/d.turnRate).toFixed(1),(Math.atan(d.turnRate/DRIVE_CONFIG.lateralGripRate)*180/Math.PI).toFixed(1));}})"
node --test scripts/turn-tuning-doc.test.mjs
```

Expected: PASS. Then **re-read the prose**, which the test cannot see and which argues from figures
inside sentences: the turn-radius paragraphs, the time-to-top-speed history, and the drift section
stage 1 wrote. The root `CLAUDE.md:612-614` names this limitation explicitly — the page's numbers in
prose are a reader's job, not a suite's.

- [ ] **Step 4: Rebuild the players' guide**

`balanceStamp` hashes `DRIVE_CONFIG`, the active `CAR_TABLE` rows, `STATUS_TABLE` and the copy. It
does **not** hash `RAM_CONFIG` — so a pass that moved only ram knobs owes no rebuild, and one that
moved a drive knob or `wildcharge`'s row does.

```bash
npm run build -w @motor-combat-moba/shared && npm run build:manual
grep -c "NaN" packages/client/public/manual.html
npm test -- manual-page
```

Expected: the `NaN` count is `0` and `manual-page.test.mjs` passes. If the stamp did not move, the
rebuild is a no-op diff and that is fine.

Then read `scripts/cars-and-weapons-copy.mjs` for sentences this port made false. The copy is one
line per chassis and one per weapon since the 2026-09-17 restructure, so this is a short read — look
for any claim about acceleration, top speed, braking, cornering, or what a ram does to you.
`manual-facts.test.mjs` catches a token typed as digits; it cannot catch a sentence that is merely
wrong.

- [ ] **Step 5: Commit**

```bash
npm run build && npm test
git add packages/shared/src/config/ docs/turn-tuning.md scripts/ packages/client/public/manual.html
git commit -m "balance: settled Unity drive and ram values from the playground pass"
```

---

### Task 6: Make the playtest probes honest

**Files:**
- Modify: `packages/server/playtest/prediction.ts`, `packages/server/playtest/collision.ts`,
  `packages/server/playtest/ram.ts`, `packages/server/playtest/weapons2.ts`,
  `packages/server/playtest/geometry.ts`, `packages/server/playtest/world.ts`,
  `packages/server/playtest/lan.ts` — as needed, and no further.

**Interfaces:**
- Consumes: the shipped config from Task 5.
- Produces: probes that build and measure the model that exists.

> **This task is why the port does not quietly rot.** `packages/server/playtest/` measures ram trigger
> rates, weapon reach, collision depth and prediction error against the real pipeline, and **every one
> of those is invalidated.** The probes are not in `npm test` and not in the release build, so **none
> of this fails anything.** `npm run typecheck -w @motor-combat-moba/server` runs
> `playtest/tsconfig.json` as its second step, which is the only automatic guard here and it catches
> compile breaks only.

**The three rules, restated because they are the whole task:** fix compile breaks on the spot; update
an expectation **only** where this work fixed what the probe measured; hand every judgement call to
the user with the probe and the number named. Never create a probe or a scenario. Never delete one.

- [ ] **Step 1: Make them build**

```bash
npm run typecheck -w @motor-combat-moba/server
npm run playtest
```

The known compile break, and it is the first one you will hit:

- **`prediction.ts:141-152`** — `bodyOf` rebuilds a `SimBody` **field by field**, including
  `reverseHold`, which stage 1 Task 4 deleted from both `SimBody` and `PlayerState`. Drop the field
  from the parameter type and the returned object. Change nothing else in that function: it is a
  narrowing adapter and its explicit field list is deliberate.

Anything else still naming `reverseHold`, `coastPerTick`, `turnRateAtStop`, `reverseMaxSpeedOf`,
`accelOf`, `RamHit`, `RamImpulseEntry`, `impactSideOf`, `pushOf`, `impactOn`, `RAM_CONFIG.minApproachSpeed`,
`.defencePushScale`, `.inertiaCoefficient`, `.knockMaxSpeed`, `.spinHalfLifeSeconds` or
`.counterSteerHalfLifeSeconds` is a compile break of the same kind. `world.ts:97-102`'s `SpawnSpec.speed`
is **not** one — it already means "forward speed along the spawned heading" and resolves through
`toWorld`, which survives this port untouched.

- [ ] **Step 2: Work the four probes the spec names, one at a time**

**`prediction.ts`** — beyond the `bodyOf` break, `P1`'s report at lines 209-224 carries a
`STALE POST-VECTOR-DRIVE-REWORK` banner that says in as many words that "stage 5 owns re-deriving
both the distances and whether the threshold itself still means what it used to." Two parts:

- *Mechanical, fix it:* the report string at line 218-220 quotes "A mirage covers 19.2 u/tick", which
  was already wrong before this port and is now 6.3. Derive it from `forwardMaxSpeedOf("mirage") / TICK_RATE_HZ`
  rather than typing the new figure, the way `P2`'s row already derives its travel distance.
- *Judgement, hand it over:* the FINDING threshold is `DRIVE_CONFIG.carWidth` — "a correction past a
  car length is a snap the player sees". That threshold predates a 1.25× hull resize and now sits on
  top of a completely different integrator. It last read 74.26 u at 120 ms against a 60 u bar.
  **Name the probe, the threshold, the reading, and ask.** Do not move it.
- *Also worth telling the user:* `clientContext`'s comment block at lines 176-183 argues from
  `restitution` and the `ramDefence` separation split; the separation split survives, the restitution
  half does not.

**`collision.ts`** — three separate items:

- *Probe 8 (`glancingSignFlip`, lines 374-438) needs rethinking, not re-aiming.* It computes the
  predicted sign-flip angle as `atan(sqrt(DRIVE_CONFIG.restitution))` (line 396) and sweeps 5°–45°
  around it. **At `restitution: 0` that is `atan(0) = 0°`, which is outside its own sweep**, and the
  post-contact forward component `v·(sin²t − e·cos²t)` is now non-negative at every angle — the sign
  flip this probe exists to measure **cannot happen any more**. That is the port fixing what the probe
  measured (U22: a car slides along a wall instead of rebounding), so the honest edit is to keep the
  scenario, report the derived prediction as "no flip is reachable at restitution 0", and let `OK` be
  the reading. The `maxJump > 100` KNOWN-BY-DESIGN threshold stays untouched so a regression that
  re-opens the jump still trips it. **This one is a rewrite of a verdict's meaning, so present the
  proposed wording to the user before committing it.**
- *Probe 1's `maxRamShove` bound (lines 77-101)* is `260 * 1.6 = 416 u/s`, historically
  `knockMaxSpeed × massFactorMax`, and both of those constants are gone. Task 3's measurement gives
  the real roster maximum a ram can now write. Derive the bound from `RAM_CONFIG` and the roster
  rather than typing it, and **tell the user what the new number is** — the old bound was ~64% too
  high, so the probe reads more conservatively than the game behaves, which is the safe direction
  but still not a measurement.
- *Probe 9 (`ramChain`, lines 440-469) has been waiting for exactly this.* It reports "Not measurable
  in stage 1 — this probe read `victim.authority`". Its stated precondition (a successor to
  `authority`) has been met since the car-physics rework's stage 3b, and this port sharpens it
  further: the successor is now `reeling` as a **total** control loss, plus `ramLock` on the attacker.
  Writing the replacement measurement is a **scenario change**, so it is the user's call — the loop
  at lines 448-454 still exercises the path, and the verdict line is what needs a decision. Same
  dangling note in `ram.ts` R5 and in `lan.ts`. **Present all three together and ask once.**

**`ram.ts`** — the STALE banner at lines 25-42 is this task's inbox and should be rewritten to
describe the port rather than the 2026-09-06 rework. The substance:

- *The `0.9` trigger-rate floors (lines 109, 143, 239) are a real judgement and they have genuinely
  changed meaning.* Under the old model a ram fired on contact plus drive-in sign, so the floors were
  argued to be insensitive to every magnitude constant. **That argument no longer holds.** U24 made
  attacking conditional on the attacker's own struck region being `front` or `frontCorner` AND its
  drive-in reaching `RAM_CONFIG.minRamSpeed` (39 u/s) — so R1's `flank` row, which approaches from
  above at 90°, and R2's whole matrix now measure a gate that did not exist. A rate below 0.9 may now
  be the rule working. **Do not move the floors. Run the probe, report every rate, and hand the user
  the choice** of re-deriving each floor per side or splitting the report.
- *R3 (`speedBeforeAndAfterResolve`, lines 148-203) asserts the wrong shape now.* It requires
  `firedOnContactTick && rebounded`, where `rebounded` is `afterResolve < 0` — the attacker's
  post-`resolveWorld` speed going negative off a restitution reflection. **At `restitution: 0` nothing
  rebounds**, so `rebounded` is false and the probe reports a FINDING for behaviour the port
  deliberately introduced. Its underlying regression guard — "ram reads the carried-in speed, not the
  post-collision one" — is still exactly right and still worth having; what changed is the tell it
  used. The honest successor is the *attacker's velocity being set to zero by the ram rule* (§7.2)
  rather than reflected negative by the resolver. **That is a verdict-logic rewrite: propose it,
  present it, wait.** Line 194-196's "restitution 0.15 still rebounds a head-on contact to -15%"
  string is plain wrong and is a mechanical fix either way.
- *Line 187* reads `RAM_CONFIG.minApproachSpeed`, which no longer exists — a compile break; the
  successor is `minRamSpeed` and it is no longer a *combined* drive-in but the attacker's own.
- *R5 (`chaseRamLock`, lines 244-348)* already reported **0 rams landed on all 63 runs** before this
  port: its "rise in lateral velocity" counter (line 303) stopped detecting anything. The port makes
  that worse in a way worth naming — a `reeling` victim keeps only `grip: 0.6`, so lateral velocity now
  survives on drag alone instead of being bled by grip, and the victim's escape steering (line 293)
  does nothing at all while `steeringLocked`. The escape verdict itself may still be sound. **Report
  the counter as dead, propose nothing, and let the user decide** whether to fix the diagnostic or
  retire it.

**`weapons2.ts`** — `W16` (`spinningShooter`, lines 251-280) hardcodes `w.get("s").angVel = 6` twice
(lines 258, 263) with the comment "the ram spin ceiling". Read `RAM_CONFIG.spinMaxRate` instead: it is
6 today and unchanged by this port, so this is a **mechanical** fix with no verdict consequence, and it
is exactly the class of rot that bites the next time someone moves the clamp. Line 144's "8.9 u/tick"
is a quoted figure that moved again with the speed the port left alone but the drag it did not —
re-derive or correct it.

**`geometry.ts`** — one line to check (`231`, a Bastion at `forwardMaxSpeedOf("bastion")` driving into
the arena-02 spike wall). Nothing structural; confirm it still reaches the wall now that arrival speed
is unclamped and the approach is no longer bounced back.

- [ ] **Step 3: Run the whole suite and read every report**

```bash
npm run playtest
```

It writes to `packages/server/playtest/reports/<yyyy-MM-dd-NN>/` (gitignored). Start at `summary.md`.
For each probe whose output changed, classify it:

- **The port fixed what it measured** → update the expectation so the fix now reads `OK`, and say so
  in the report string. `collision.ts` probe 8 is the clearest instance.
- **The port moved a number the probe quotes** → fix the comment or string, and derive rather than
  type wherever the value is reachable from config.
- **The port broke something** → leave it as a `FINDING` and fix the code, not the probe.

Do **not** move a threshold to make a probe green. `npm run playtest` exits non-zero only when a probe
*crashed*; a run reporting six FINDINGs still exits 0, and surfacing them is the point.

- [ ] **Step 4: Hand the judgement calls to the user, in one list**

At minimum: `prediction.ts` P1's `carWidth` threshold; `ram.ts`'s three `0.9` floors and R3's verdict
logic; `collision.ts` probe 8's rewritten verdict meaning and probe 1's derived bound; the
`ramChain` / R5 / `lan.ts` measurement that has been waiting on a successor to `authority` since
2026-09-07. Each one: **the probe, the number, what it used to mean, what it means now.** No
recommendation dressed as a fact.

- [ ] **Step 5: Commit**

```bash
git add packages/server/playtest/
git commit -m "test(playtest): update the probes for the Unity physics port"
```

Then, in the session summary: **say loudly that the probes moved, name each one, and recommend a
`npm run playtest` run.** That recommendation is the root `CLAUDE.md`'s standing rule and it is not
satisfied by having run it yourself.

---

### Task 7: A fresh balance baseline

**Files:** none. Reports land in gitignored `packages/server/balance/reports/`.

**Interfaces:**
- Consumes: the shipped config from Task 5 and `BOT_BRAIN_VERSION` `6.0.0` from stage 1.
- Produces: one report, handed over.

- [ ] **Step 1: Confirm both fingerprints have moved, so nobody tries a comparison**

`configFingerprint` hashes `CAR_TABLE`, `DRIVE_CONFIG`, `RAM_CONFIG`, `WEAPON_TABLE`, `STATUS_TABLE`
and more, **whole**; `DRIVE_CONFIG` and `RAM_CONFIG` were both reshaped and `STATUS_TABLE` gained
`ramLock` and redefined `reeling`. The bot fingerprint hashes `BOT_PROFILES` and `BOT_BRAIN_VERSION`,
and stage 1 moved the latter to `6.0.0`. **So every stored baseline is incomparable**, and
`--baseline`'s refusal is correct behaviour rather than a bug to work around with `--force`.

- [ ] **Step 2: Run it**

```bash
npm run balance -- --shape=duel --matches=200
```

**Read this before starting it:** `duel` runs `--matches` matches **per ordered pair**, and there are
nine ordered pairs at the three-chassis roster — so this is **1800 matches**, not 200. Tell the user
the scale before launching, and offer `--matches=50` (450 matches) if they want a first read sooner.
The seed prints first; write it down, because it is what makes this run replayable and what a later
paired run will want.

- [ ] **Step 3: Read it against the harness's own distortions, and only those**

From `packages/server/balance/README.md`:

- **Check the mirror table first.** Three of the nine pairs are a chassis against itself and have no
  game-side reason to land anywhere but 50%. A mirror far off 50% is positional bias in the rig, and
  it makes every other cell in the matrix suspect.
- **Read the interval, not the point estimate.** Every win rate carries a Wilson interval.
- **`corroded`'s amplified damage is credited to whatever weapon lands the hit**, never to
  `magmablast`.
- **Spike damage belongs to no weapon**, and an unshoved spike death credits the victim's own chassis
  with dealing it. **This port makes that distortion materially larger** — a 237 u/s shove into a
  spike wall with the victim reeling is a new and common way to die, and the credit goes to the
  shover only within `SPIKE_CONFIG.shoverCreditMs`. Say so when handing the report over; a Bastion
  damage-dealt column that jumped is probably this.
- **Maneuver weapons get a real hit-probability solution**, so reports across a `BOT_BRAIN_VERSION`
  bump are not comparable — which this is.

- [ ] **Step 4: Hand the report to the user and stop**

Balance decisions are theirs. Report what the numbers are and what the intervals are. **Do not retune
off one run**, and do not read a chassis as weak from a single duel matrix taken immediately after a
physics change and before a bot retune.

---

### Task 8: The `bot-tuner` pass, and the three tests that were already red

**Files:**
- Modify: `packages/server/src/config/bot-profiles.ts` (only if the skill's process says so)
- Read: `.claude/skills/bot-tuner/SKILL.md`, `packages/server/src/bot/brain/planner.ts:884-903`,
  `packages/server/src/bot/brain/objectives.ts:145-163`

**Interfaces:**
- Consumes: Task 2's settled feel — **this task runs after the feel is settled, never before.** A bot
  tuned against provisional drive numbers is tuned against numbers that are about to move.
- Produces: whatever `BOT_PROFILES` the skill's process lands on. `BOT_BRAIN_VERSION` stays `6.0.0`
  (interfaces ledger: it moves in stage 1 and does not move again inside this work).

- [ ] **Step 1: Re-derive the two scoring terms calibrated on `steeringGrip === 1.0`**

This is not optional and it is not a `bot-tuner` question — it is a correctness obligation the code
itself records in capitals, and **this port is the pass those warnings were written for.**

- `packages/server/src/bot/brain/planner.ts:884-903` — `facingErrorOf`'s doc comment: "⚠ THIS TERM
  SILENTLY DEPENDS ON `DRIVE_CONFIG.steeringGrip`, WHICH IS 1.0 TODAY … **IF A FUTURE PHYSICS PASS
  LOWERS `steeringGrip`, RE-DERIVE EVERY WEIGHT IN THAT TABLE.**" The port does not lower
  `steeringGrip` — it **deletes** it (U13), and lateral velocity is now a first-class, always-present
  quantity. So `facingError` stops being binary (exactly 0 or exactly 1) and starts scoring in
  (0, 0.5] for an ordinary *turn*. The comment names the exact consequence: the term "would then
  charge a toll on turning itself, which re-creates 'turning is pure cost' (F1-F3), the exact defect
  it exists to delete". The symptom to watch for is the bot collapsing back to straight-line inputs.
- `packages/server/src/bot/brain/objectives.ts:145-163` — the weight table's derivation paragraph
  makes the same argument for `evade`'s 10 and `fight`'s 30, both derived on the headroom rule under
  the binary assumption.

**Both doc comments must be rewritten**, not patched, because their argument's premise is gone. Read
`objectives.ts`'s header table of measured term scales before touching a row, and **re-derive rather
than nudge** — that is that file's own standing instruction.

- [ ] **Step 2: Record the three already-red tests' readings before you change anything**

```bash
npm test -w @motor-combat-moba/server -- bot
```

The three, and what they were before this work started:

- `packages/server/src/bot/brain/controller.test.ts` — the OFF-AXIS mean-offset case, reading **1.36**
  against a bar of < 0.2 on the merged line (it read 0.2017 on the bigger-cars branch alone, 1.58
  after the aim-lock merge, and passes on `development/main` alone).
- `packages/server/src/bot/brain/tiers.test.ts` P49 — a time-to-kill case; hard's weapon fires at
  range 6 against a bar of 7.17.
- `packages/server/src/bot/brain/tiers.test.ts` P50 — a hit-rate case, still inverted (hard 0.765 vs
  medium 0.857).

Write down what each reads **now**, after the port. A number that moved is information for the tuner;
a number that went green is not this work's to claim.

- [ ] **Step 3: Run the `bot-tuner` skill**

```
/bot-tuner
```

Or invoke the skill by name. It tunes `BOT_PROFILES` knobs for easy/medium/hard and explicitly does
**not** rewrite the brain unless the user asks for a situation-play change. Feed it what actually
changed under the bot, because it is a lot:

- A ram now **stops the attacker dead and locks it for 500 ms**, so whether ramming is worth planning
  at all is a different question than it was.
- A rammed car is a **total passenger for a second** (`immobilised`, `steeringLocked`, `spinFree`,
  `ramBlocked`, `grip: 0.6`), so `evade` and `unpin` are reasoning about a car that cannot act.
- Cars **drift**, so the bot's own rollout no longer travels along its nose.
- Nothing **bounces**, so the wall-escape assumptions in `wallPenalty` changed shape.
- `predict.ts`'s `OBSERVATION_MODIFIERS` reaches "hold the speed it was seen at" by one mechanism
  instead of three (U34).

- [ ] **Step 4: Do not re-pin the three tests**

If the skill's pass makes one green, say which and why. If it does not, leave it red and say so. A
threshold moved to make a red test pass is the one thing this stage must never do quietly — spec §12:
"this work does not make them green and must not silently re-pin them."

- [ ] **Step 5: Commit, if anything moved**

```bash
npm run build && npm test
git add packages/server/src
git commit -m "tune(bot): re-derive the facing term and retune profiles for the Unity physics port"
```

Note in the message that `BOT_PROFILES` moved, which means the bot fingerprint moved again and
Task 7's baseline is **already superseded** if this step changed anything. If it did, tell the user
and offer to re-run Task 7 — their call, not yours.

---

### Task 9: Documentation reconciliation

**Files:**
- Modify: `docs/combat-model.md`, `docs/config-reference.md`, `docs/glossary.md`,
  `docs/bot-behavior.md`, `packages/shared/CLAUDE.md`, `CLAUDE.md`,
  `docs/superpowers/plans/2026-09-06-car-physics/EXECUTION.md`

**Interfaces:**
- Consumes: everything above.
- Produces: docs that describe the model the code has.

`docs/schema-reference.md` and `docs/networking.md` were handled in stage 1 Task 4 (the `reverseHold`
removal) and are not re-opened here. Each sub-step below names the lines that are wrong; **read them
before editing** — line numbers drift.

- [ ] **Step 1: `docs/combat-model.md`**

- **Line 20 (`## Ramming`) and the SUPERSEDED banner at 22-42.** That banner was written for the
  2026-09-06 rework and describes a contest model this port deletes. **Replace it rather than adding
  a second banner** — the file should not accumulate a stratigraphy of superseded models. The
  contest, `pushOf`/`impactOn`, the face-bonus table, the "each side computed independently" framing
  and the `mass` archaeology all go; the new text is §7's rule: nose-first above `minRamSpeed`, the
  attacker stops and locks, the victim is set to pre-collision velocity plus shove and reels.
- **Lines 53-60**, the tick-order paragraph, argues from `RAM_CONFIG.knockMaxSpeed`'s two-layer
  measurement. `knockMaxSpeed` is deleted and the second layer (a restitution rebound before
  `contactTick` runs) is gone at `restitution: 0`. The tick order itself is unchanged and still worth
  stating.
- **Line 70 (`### Wall and car deflection, and mass-weighted separation`)** — the heading still says
  `mass`, and the section at 78 quotes `restitution` "cut from 0.35 to 0.15". It is 0 now, and U22's
  point is the interesting one: the reflection formula is unchanged, the constant is what moved, and
  at 0 it is idempotent so relaxation passes can no longer compound a rebound. `shareOf`'s
  `ramDefence`-weighted separation at 83-85 survives untouched — say so explicitly.
- **Lines 101-128** (`There is no severity grade` … the face-bonus table … `minApproachSpeed`) — the
  whole passage describes the contest. Replace with §7.1's classification (five regions, the corner
  band, drive-in, `ramBlocked`) and §7.2's two tables.
- **Lines 130-173** — `Impulse`'s role. `Impulse`/`applyImpulse`/`ImpulseDef` survive **for slams
  only** (§7.4); a ram writes velocities directly in `ram-bridge.ts`. `RamHit.attackerImpulse`,
  `reactionOf`'s absence, `defenceScaled` as it applies to a ram, and the "attacker thrown backwards"
  paragraph at 163-173 all go — the last one is *answered*, not merely stale, and the answer is worth
  keeping one sentence of: there is no reflection left to throw anyone backwards, and the rammer's
  stop is authored.
- **Lines 175-212** — ram control-loss. `reeling` is unchanged as a *name* and completely changed as a
  *thing*: `flags: ["immobilised","steeringLocked","spinFree","ramBlocked"] plus grip: 0.6`,
  `modifiers: {}`, `reapply: "ignore"` (U31). Record the behaviour that costs: **a re-ram landing
  while a reel is still running no longer extends it.** Add `ramLock` beside it (U32). Falloff (U5)
  is unchanged in mechanism and now scales the shove, the spin and the reel.
- **Line 214 (`## Maneuvers and the contact pass`)**, particularly 238 and 265-274 — the slam's own
  `reeling` and its exemption from falloff survive; `wildcharge.impulse.speed`/`.uncontrolMs` may have
  moved in Task 3 Step 5.
- **Line 345** quotes the measured spike consequence "with `DRIVE_CONFIG.restitution` at 0.15, a car
  holding throttle into a wall settles at ~5 u/s inward". At 0 that measurement is void and must be
  re-taken or removed. It is load-bearing: it is the argument that a self-driven car pays the spikes
  exactly once. **Re-measure it in the playground during Task 2 rather than guessing**, and if it is
  not re-measured, say so rather than leaving a number that reads as measured.
- **Lines 838-846** (`## Damage`) — the ram summary there names the contested `Impulse`.
- **Line 886** — "one set of multipliers and **three** flags". `StatusFlag` gained `spinFree` and
  `ramBlocked`, so it is five, and `Modifiers` gained the `grip` channel alongside them.
- **Lines 917 and 936-937** — the effect-sources table. `reeling` is still the row no `applies` entry
  grants; `ramLock` joins it as a second such row, published through `EFFECT_SOURCES` (U33).

- [ ] **Step 2: `docs/config-reference.md`**

- **Lines 56 and 108** — `coastHalfLifeSeconds` on `CAR_TABLE`'s prototype rows and its 2026-09-06
  arrival note. The field is deleted (U4).
- **Lines 156-166** — the per-car resolver table. `reverseMaxSpeedOf` (156), `accelOf` (157),
  `turnRateAtStopOf` (160), "time to top" as `forwardMaxSpeedOf / accelOf` (162) and
  `coastHalfLifeSecondsOf` (166) are all gone. The successors are `dragRateOf`, `engineAccelOf`, and
  time-to-90% as `ln(10) / dragRate`.
- **Lines 184-185** — `ChassisDrive`'s field list (`turnRateAtStop`, `coastPerTick`). Seven fields
  now, per the interfaces ledger.
- **Line 441 (`## DRIVE_CONFIG`) through 578** — the largest single edit in this task. Lines 447-460
  list `steeringGrip`, `impactGripDecel`, `stopTurnRatio`, `baseAccel`, `accelPerRating`,
  `reverseSpeedRatio` and `reverseHoldTicks`, all deleted, and `restitution: 0.15`, now 0. Lines
  462-478 tabulate the deleted resolvers. Lines 505-514, 535-548 and 553-578 are the historical
  argument for `baseAccel`/`accelPerRating` and `reverseAccelFactor`'s relationship to
  `reverseSpeedRatio` — that whole argument is void under one drag rate, and 548's "0.6 is chosen
  against `reverseSpeedRatio` 0.65" is now meaningless. Keep the history where it explains a surviving
  number; delete it where it explains a deleted one.
- **Line 580 (`## RAM_CONFIG`) through 662** — 592-596's `reeling` description (it carries no
  `turnRate`/`accel` multipliers any more), 601 `minApproachSpeed`, 602 `defencePushScale`,
  605 `knockMaxSpeed`, 606 `spinScale`'s two historical re-pitches (a third is owed from Task 3),
  608 `inertiaCoefficient` (replaced by `inertiaRadiusSquared`, still hull-derived), 609-610
  `spinHalfLifeSeconds`/`counterSteerHalfLifeSeconds` (deleted with `nextAngVel`), and 637's
  "`RamDecay` … had two more (`shove`, `authority`) until stage 3b" — `RamDecay` itself is gone now.
  New rows owed: `minRamSpeed`, `headOnAngleDeg`, `cornerBandUnits`, the three type scales,
  `reelingSpinDecayRate`, `attackerLockMs`.
- **Line 682** — `SLAM_CONFIG`'s migration table entry for `victimAuthority`.
- **Line 704** — `wildcharge.impulse.uncontrolMs`'s 1400, if Task 3 moved it.
- **Line 730** — `STATUS_TABLE`'s `reeling` row: `refresh` → `ignore`, the two modifiers → none, and
  the five flags. A new `ramLock` row beside it.
- **Lines 773-775** — the channel table. `topSpeed` no longer reaches `reverseMaxSpeedOf`; `accel`
  scales `engineAccel` **and** `dragRate` by the same factor, applied as a power (U36); `turnRate`'s
  entry names `turnRateAtStopOf` and claims `reeling` scales it — `reeling` carries no modifiers now.
- **Lines 783 and 825** — both quote `CarDef.coastHalfLifeSeconds` resolving to `coastPerTick`.
- **Line 1037 (`## Tuning store`)** — stage 3 added the `rebuildRamTicks` call, so the list of rebuilt
  snapshots grows by one.
- **Line 1085** — `SPIKE_CONFIG.triggerSpeed`'s measured consequence quotes restitution 0.15, the
  same void measurement as `combat-model.md:345`. Fix both from the same re-measurement or neither.

- [ ] **Step 3: `docs/glossary.md`** (35 lines; the whole file is one table)

- **Line 21 (`Modifiers`)** — "one set of multipliers and flags" is fine, but the sentence that
  driving, ramming and combat never look at a status list is worth keeping exactly as is.
- **Lines 26, 27, 28** — Bullseye, Mirage and Bastion each quote a turn *radius* (30.2 / 31.4 /
  32.6 u). Those were already two speed cuts stale; under this port all three land at ~1.5 car
  lengths and the spread is gone. Bastion's row also still argues its identity from "hp and its two
  ram ratings", which survives — but the ram ratings now feed a one-sided shove, not a contest.
- **Line 29 (`Handling`)** — still correct (turn rate, not radius) and now *more* so: U9 made the rate
  speed-independent, so the caveat about the at-rest rate is gone.
- **Line 30 (`ChassisDrive`)** — **"The six drive numbers"**, which was already wrong at eight and is
  now wrong at seven. The spec calls this one out by name (§12). Fix the count and the list.
- **Two rows are owed**: **Drift** (the slip angle `atan(turnRate / lateralGripRate)`, a property of
  two rates and not of speed) and **Ram Lock** (the attacker's own 500 ms). Consider a **Reeling** row
  too — it is now a player-visible state with five flags and the glossary has no entry for it.

- [ ] **Step 4: `docs/bot-behavior.md`**

- **Lines 202-211** — the whole "Why a weight here is a toll rather than a ceiling" paragraph. It
  opens "`DRIVE_CONFIG.steeringGrip` is `1.0`" and closes "Re-derive the whole column if that number
  moves". The number did not move; the knob was **deleted**. Rewrite the paragraph to argue from the
  grip rate, and record what Task 8 Step 1 actually re-derived.
- **Lines 636-640** — "The 40 → 10 re-derivation stands on its headroom argument alone … with
  `steeringGrip` at 1.0 the term is binary". Same premise, same fix. Whether the conclusion survives
  is Task 8's finding, not this step's assumption.
- Check the `evade`/`unpin` situation descriptions against a victim that is now a total passenger, and
  the `coast` language at 351-352 and 456 against a model where coasting is drag rather than a branch.

- [ ] **Step 5: `packages/shared/CLAUDE.md`**

- **Lines 25-37** — the flags paragraph. `stunned` is untouched (U19), but the sentence at 27-28 says
  `bleedLateral` "still resolves" on the lateral component — `bleedLateral` is deleted (U20). The
  paragraph should gain the three new flags and the fact that `reeling` is now the roster's most
  flag-heavy row. The "every flag-carrying DEBUFF is required to be `reapply: "ignore"`" rule at 30-33
  is what forces `reeling` and `ramLock` to `"ignore"` — worth saying, since it is the rule that costs
  the re-ram extension.
- **Lines 39-43** — the applier list. `contactTick` still applies `reeling`, now off
  `RAM_CONFIG.ramUncontrolMs` scaled by falloff **and** `ramLock` off `attackerLockMs`, unscaled.
- **Lines 65-82** — the `SLAM_CONFIG` paragraph. Mostly survives; check `wildcharge`'s numbers against
  Task 3 Step 5 and that "the only row in the table declaring an `impulse` at all" is still true.
- **Lines 97-107** — **"It takes a resolved `ChassisDrive` — eight fields: `maxSpeed`,
  `reverseMaxSpeed`, `accel`, `reverseAccel`, `turnRate`, `turnRateAtStop`, … `coastPerTick` …
  `brakeDecel`"**. Seven now, and four of those eight names no longer exist. The paragraph's actual
  point — that `stepDrive` reads no roster and `golden.test.ts` pins the equation against a frozen
  fixture — survives and is more true than before, since every per-tick factor now arrives on the
  struct.

- [ ] **Step 6: The root `CLAUDE.md`**

- **Lines 5-19 (Statuses)** — `reeling`'s description at 15-19 ("`reeling` is the one row no
  `WeaponDef.applies` entry ever grants") stays true and gains `ramLock` as a second such row. What
  changes is what `reeling` *is*.
- **Lines 78-79** — "`CAR_TABLE` rows also carry `coastHalfLifeSeconds` and `brakeDecel`". Only
  `brakeDecel` now.
- **Lines 106-118, 119-131, 132-146** — the three tuning-history paragraphs. **Do not delete them**;
  they are the record of how the roster got here and this port keeps `baseMaxSpeed`/`speedPerRating`
  precisely because of them. Add a fourth paragraph for this port, and fix the forward references:
  143-146's "stage 5's re-pitch inherits a spin budget that is a quarter unspent, and
  `globalScale`/`spinScale` were measured against the old ceiling-hugging case" points at the *car
  physics rework's* stage 5, which no longer exists — it points here now, and Task 3 Step 3 is what
  answers it.
- **Lines 187-196** — the turn-rate history. `baseTurnRate`/`turnRatePerRating` were untouched from
  2026-08-31 through three speed passes; this port **retunes them** (3.6 → 0.667 and 0.054 → 0.0169
  at the starting values, whatever Task 2 settled on in the end). That streak ends here and the
  paragraph should say so.
- **Lines 197-202** — "`stepDrive` no longer reads the roster … (eight numbers as of the 2026-09-06
  vector-drive rework, which added `coastPerTick` and `brakeDecel` to the original six)". Seven.
- **Lines 402-482** — the whole car-physics-rework section. Stages 1–4 still stand and several of
  their results **survive this port and must not be undone** (spec §3: `vx`/`vy` as canonical,
  `sim/velocity.ts` as the only conversion site, the `Impulse`/`ImpulseDef` seam for slams,
  edge-triggered contacts, per-victim falloff, `ramAttack`/`ramDefence`, `ramDefence`-weighted
  separation, the spike shove-credit window). What must change: line 482's "Stage 5 (plus the
  approved restitution stage before it) is planned against revision 2 and **not started**" — both are
  superseded by this port, and the section needs a pointer to this spec.
- **Lines 604-613** — the `docs/turn-tuning.md` update list. It names `coastHalfLifeSeconds`,
  `stopTurnRatio`, `reverseSpeedRatio`, `steeringGrip` and `impactGripDecel`, all deleted, and says
  "`reeling`'s (0.4) is the one shipped today, and it has its own 'Rate while reeling' row in the
  derived table" — `reeling` carries no `turnRate` now and that row is gone. The successors owed to
  the list: `baseDrag`, `dragPerRating`, `lateralGripRate`, `reverseEpsilon`, `flipSteeringInReverse`.
  The parenthetical at 612-614 about knobs the test cannot see should name whichever of the new ones
  appear only in prose.
- **The "Read the right doc" table at 330** — add a row for this spec and this plan directory.

- [ ] **Step 7: `docs/superpowers/plans/2026-09-06-car-physics/EXECUTION.md`**

That file still routes a reader into a stage that no longer exists. Three edits, and no more — it is
a historical state file and this is an annotation, not a rewrite:

- **Line 152**, the stage table's row 5: `| 5 | 05-tune-and-reconcile.md | Revised for revision 2. Not
  started. ← next |` becomes **superseded**, naming
  `docs/superpowers/specs/2026-09-18-unity-driving-and-ram-physics-port-design.md` §3 and this plan.
- **Line 328 (`## Resume here`)** and the paragraphs to 361 — they say "**Stage 5**
  (`05-tune-and-reconcile.md`)" is next, that it inherits the `speed: 520` re-pitch, and that it
  carries the deferred hands-on criteria. Redirect all of it here, and keep the substance: the
  `speed: 520` re-pitch is Task 3 Step 5, the `dashSubstepMaxUnits` judgement is Task 4, and the
  user's standing instruction that the 3b hands-on criteria become **probes written after the physics
  work is complete, not piecemeal** still binds — note that this port's Task 6 deliberately writes no
  new probe, so that obligation is still open and still the user's to schedule.
- **Lines 540-620 (`## What has never been verified`)** — the probe bullets there are a live list of
  exactly what Task 6 just worked. Annotate each with what this port did to it rather than deleting
  them; the `collision.ts` probe 1 bound, `ram.ts` R5's dead counter and `prediction.ts` P1's
  threshold are all named there and all named again above.
- Update the **Last updated** line at 7-16 to say the file is now historical for stage 5 purposes.

- [ ] **Step 8: Verify nothing names a deleted knob**

```bash
grep -rn "steeringGrip\|impactGripDecel\|stopTurnRatio\|reverseSpeedRatio\|reverseHoldTicks\|coastHalfLifeSeconds\|coastPerTick\|turnRateAtStop\|reverseMaxSpeedOf\|minApproachSpeed\|defencePushScale\|knockMaxSpeed\|inertiaCoefficient\|spinHalfLifeSeconds\|counterSteerHalfLifeSeconds\|RamDecay" docs packages/shared/CLAUDE.md packages/server/CLAUDE.md packages/client/CLAUDE.md CLAUDE.md --include=*.md | grep -v "superpowers/specs" | grep -v "superpowers/plans"
```

Expected: nothing, or only sentences that deliberately record a name as deleted. **`docs/ideas/` and
`docs/invariants/` are excluded by not being searched — do not widen this grep to `docs/**` without
`--exclude-dir=ideas --exclude-dir=invariants`.**

- [ ] **Step 9: Commit**

```bash
git add docs packages/shared/CLAUDE.md CLAUDE.md
git commit -m "docs: reconcile every model description with the Unity physics port"
```

---

### Task 10: The stage's exit — a full green run and the two state files

**Files:**
- Modify: `packages/client/public/manual.html` (generated), `EXECUTION.md` (this plan directory)

**Interfaces:**
- Consumes: everything.
- Produces: a shipped stage.

- [ ] **Step 1: Rebuild the guide one last time**

Tasks 5 and 8 may both have moved `balanceStamp` inputs after Task 5's rebuild. Rebuilding twice
costs nothing; shipping a stale page costs players.

```bash
npm run build -w @motor-combat-moba/shared && npm run build:manual
grep -c "NaN" packages/client/public/manual.html
```

Expected: `0`. Then load `http://localhost:5173/manual.html` and look at it — the Effects section
should now list **Ram Lock** beside Reeling, and Reeling's own description should read as a total
loss of control rather than a slow.

- [ ] **Step 2: The full verification**

```bash
npm install
npm run build
npm test
npm run typecheck -w @motor-combat-moba/server
npm run check:art
grep -n "shared/dist" packages/server/dist/index.js | head -3
```

Expected: build green; `npm test` green except whatever Task 8 left red, with each one's reading
recorded; typecheck green (this is what covers `playtest/` and `balance/`); `check:art` unchanged by
this work; and the inlined path reads `// ../shared/dist/…`, **not** an escaped
`// ../../../../../packages/shared/dist/…` — that second form means this worktree is running the main
checkout's shared build and every number above was measured against the wrong sim.

- [ ] **Step 3: Time-to-kill, for the record**

```bash
npm run ttk
```

The port does not touch weapons, but it changes how long two cars spend in each other's range, and
`ttk`'s defender axis covers the whole table including the six inactive prototypes. Record the matrix
and hand it over; do not act on it.

- [ ] **Step 4: Commit and write the state file**

```bash
git add -A
git commit -m "docs(manual): final guide rebuild for the Unity physics port"
```

Update this directory's [`EXECUTION.md`](EXECUTION.md) **in the same commit**: stage 5 to **Landed**,
the settled values and what the user said about each, which of spec §14's exit criteria were actually
driven and which were not, the three bot tests' final readings, the balance baseline's seed and
folder, every judgement call handed to the user and what they answered, and the
`dashSubstepMaxUnits` decision.

- [ ] **Step 5: Say the loud things in the session summary**

Three standing obligations from the root `CLAUDE.md`, none of which a test enforces:

1. **The playtest probes moved.** Name each probe and each number, and **recommend a
   `npm run playtest` run.** Running it yourself does not discharge this.
2. **The balance fingerprints both moved**, every stored baseline is incomparable, and the fresh
   baseline is handed over rather than acted on.
3. **Every judgement call still open** goes in the summary as a list, not buried in a commit message.

---

## Stage 5 exit criteria

- [ ] `npm run build` (root) succeeds, and `packages/server/dist/index.js` inlines the shared dist
      from `// ../shared/dist/…`, not from an escaped worktree path.
- [ ] `npm test` passes from the repo root, except bot tests whose readings are recorded and which
      were not re-pinned.
- [ ] `npm run typecheck -w @motor-combat-moba/server` passes, so `playtest/` and `balance/` build.
- [ ] `npm run playtest` completes with no crashed probe, and every remaining `FINDING` is either
      understood or handed to the user by name and number.
- [ ] A fresh `--shape=duel` balance baseline exists, its seed is recorded, and it has been handed
      over without being acted on.
- [ ] `docs/turn-tuning.md` recomputes clean against the settled values, and its prose was re-read.
- [ ] `manual.html` is rebuilt, contains no `NaN`, and publishes `ramLock` in its Effects section.
- [ ] No doc under `docs/` or any `CLAUDE.md` names a knob this port deleted, except where it
      deliberately records the deletion.
- [ ] The car-physics rework's `EXECUTION.md` says its stage 5 was superseded here, and points at
      this spec.
- [ ] The `dashSubstepMaxUnits` judgement is **decided and recorded**, either way.
- [ ] This directory's `EXECUTION.md` records the settled values, the user's verdicts, and every
      open judgement call.

## Port exit criteria (spec §14 — the user's to tick, in the playground)

- [ ] A car takes noticeably longer to reach top speed than today, and rolls about two and a half car
      lengths after the throttle is released.
- [ ] Holding full lock at speed leaves the car visibly sliding, at a slip angle that reads as
      deliberate rather than as a loss of control.
- [ ] A car turns on the spot at full rate; reversing steers like a real car with
      `flipSteeringInReverse` on and like a tank with it off.
- [ ] Driving into a wall at any angle slides along it; nothing rebounds.
- [ ] A nose-first flank ram at speed stops the attacker dead, flings and spins the victim, and
      leaves it a passenger for about a second. A flank-first slide into someone does nothing but
      bump.
- [ ] A head-on stops both cars and reels neither.
- [ ] Chained rams fall off; three seconds later they do not.
- [ ] `wildcharge` is still clearly harder than the best ordinary ram.
- [ ] The same inputs at 30 Hz and 60 Hz produce the same trajectory within tolerance (pinned by
      `drive-rate.test.ts` in stage 1; nothing in this stage may widen its tolerance).
