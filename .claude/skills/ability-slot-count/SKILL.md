---
name: ability-slot-count
description: >-
  Use when someone wants to change how many weapon slots cars have — "give
  cars four weapons", "drop to two slots for this build", "how many ability
  slots does this build have", or any request to widen or narrow the number
  of ability slots without changing any car's authored kit. Edits
  WEAPON_SLOT_CONFIG's build-time count N and carries out every step that
  change owes — rebuild, manual, bot version, tests. Not for changing WHICH
  weapons a chassis carries — that is weapon-forger.
---

# Ability-slot count

How many ABILITY slots a car has in this build is one number, `N`. The basic attack is not one of
them — it is fire slot 0 and always present, so a car fires `N + 1` weapons. See
[`docs/superpowers/specs/2026-09-20-variable-weapon-slots-design.md`](../../../docs/superpowers/specs/2026-09-20-variable-weapon-slots-design.md)
(VS1–VS34) for the design and
[`docs/combat-model.md`](../../../docs/combat-model.md#weapon) for the fire model.

`N` is **build-time**, like `BASIC_ATTACK_CONFIG.enabled`: editing the source and rebuilding, not an
env var, a join option or a playground control. It is a decision about what the shipped game IS for
this build.

## 1. The one edit

`ABILITY_SLOTS` in
[`packages/shared/src/config/weapon-slots.ts`](../../../packages/shared/src/config/weapon-slots.ts),
a module-local `const` that `WEAPON_SLOT_CONFIG.maxAbilitySlots` is seeded from. Everything else in
that object is derived: `maxFireSlots` is `N + 1` and `basicAttackSlotIndex` is the literal `0`
(the fire-slot array is `[basicAttack, ...kit]`, so nothing about `N` can move it).

**Legal range: 1 to 4**, held by `weapon-slots.test.ts`'s "separates the structural ceiling from the
tunable count" — `maxAbilitySlots >= 1` and `<= ABILITY_SLOT_CEILING`.

**`ABILITY_SLOT_CEILING` (4) is NOT the knob and is never edited by this skill.** It is structural:
it sizes `SLOT_KEYS` (`ABILITY_SLOT_CEILING + 1` rows), bounds the wire mask's width, and is the
bound `N` is validated against. Raising it is its own piece of work — see step 6.

## 2. What `N` gates

Read this list before promising what a change will do. Verified against the code, 2026-09-20:

- **Firing.** `beginFire` (`packages/shared/src/sim/weapons/fire.ts`) scans
  `min(state.slots.length, maxFireSlots)` downward, so a slot past `N` is unpressable. `slotMaskFrom`
  (`packages/client/src/config/slot-keys.ts`) also caps its scan at `maxFireSlots`, so a `SLOT_KEYS`
  row this build has no slot for never reaches the wire, and the server's `SLOT_MASK`
  (`packages/server/src/sim/tick.ts`) masks it off again.
- **The HUD box count.** `ArenaScene`'s `renderWeaponHud` sizes the bar with
  `abilityCountOf(player.weapons.length)` — the count of the car it DRAWS, which while spectating is
  not the car the viewer drives — and hands it to `slotBarLayout`
  (`packages/client/src/scenes/weapon-hud.ts`). At most `N` boxes, and fewer for a chassis whose kit
  is shorter. `localAbilityCount()` is the local player's own count and belongs to the countdown
  hint only.
- **The countdown action hint.** `hintSlotOrder(enabled, abilities)` builds `[0, 1..abilities]`.
  `N` is only the DEFAULT for that parameter: production passes the local car's ability count
  (`ArenaScene` → `actionKeysFor(this.localAbilityCount(), …)`, VS19), so the hint follows the kit.
  `movement-hint.ts` used to also export `ACTION_KEYS`/`ACTION_ALTS`, bound to `maxAbilitySlots`;
  nothing in production read them and they were deleted on 2026-09-20, so there is no `N`-bound
  hint row left to keep in step.
- **The guide.** `scripts/build-cars-and-weapons.mjs` publishes `min(kit, N)` per active chassis,
  and `balanceStamp` hashes `N` as `abilitySlots`.
- **The playground's per-seat cap.** `ui-model.ts`'s add/remove controls and
  `playground-messages.ts`'s validator both accept 1 to `maxAbilitySlots` distinct weapons, and
  `storage.ts`'s `upgradeStoredSetup` truncates a stored seat's loadout to the cap on load (VS34) —
  so lowering `N` costs a developer's saved sandbox its trailing weapons, never the whole blob.
- **The offline tools' sweep.** `npm run balance`, `npm run ttk` and the playtest probes sweep what
  is reachable at this `N` and skip-and-name what is not. `ttk.mjs`'s `carrierOf` is total and
  returns `undefined` for a row no chassis can fire, and `unreachableWeaponIds` collects them for
  the matrix's footer; `packages/server/playtest/weapons.ts` keeps its own skip reasons. Lowering
  `N` therefore lengthens those footers rather than crashing the run.

**Nothing is deleted from `CAR_TABLE`.** A chassis may author more weapons than `N`; the extras stay
in the table and `slotsFrom` truncates them **silently** for the build. That silence is deliberate
(VS11) — a four-weapon chassis in an `N = 3` build is the designed case, not an authoring error, and
warning on it would log on every boot. Only a kit longer than `ABILITY_SLOT_CEILING` warns.

## 3. Rebuild, then the manual

1. Root `npm run build` — shared → server → client, in that order. **Never `npm run build --workspaces`**:
   the server's tsup step inlines shared's `dist`, and the unordered form has been observed building
   the server before shared, producing a bundle silently running the old slot count while every test
   passes.
2. `npm run build:manual`.
3. Commit the regenerated `packages/client/public/manual.html`.

`balanceStamp` hashes `N`, so skipping step 2 fails `npm test` by name with the command to run —
the same way any other stale-manual edit does.

## 4. Bump `BOT_BRAIN_VERSION` — and get the reason right

`BOT_BRAIN_VERSION` lives in `packages/server/src/config/bot-profiles.ts` (`6.1.0` at the time of
writing) and rides in `botFingerprint`.

**The reason is not "the bot has one more weapon to choose from". It is the RNG draw count.**
`rollPersonality` (`packages/server/src/bot/brain/personality.ts`) draws exactly
`1 + WEAPON_SLOT_CONFIG.maxFireSlots` random numbers per bot: one for the archetype, then one weight
per fire slot. Change `N` and `maxFireSlots` changes, so the draw count changes, so **every seeded
RNG stream downstream of that roll is shifted**. Every bot in a seeded run behaves differently from
the first tick — not just in which weapon it favours.

Consequences to state out loud: balance and playtest reports taken before the change are **not
comparable** to ones taken after, and the balance harness's `--baseline` flag will refuse the
comparison rather than trusting a reader to remember.

**Worth one line of contrast, because it is the thing people get backwards:** the 2026-09-20 slot
work itself did **not** change the draw count. `maxFireSlots` was `3 + 1` before it and `3 + 1`
after; what moved was which slot each drawn weight landed on. That was a re-weighting. Changing `N`
is a re-seeding, and it is strictly the larger disturbance.

Evidence, measured by setting `ABILITY_SLOTS = 4` and running `npm test` (2026-09-20): two seeded
server tests that pass at `N = 3` failed at `N = 4` without any bot knob moving —
`src/bot/brain/tiers.test.ts`'s H30 ult-discipline characterisation and `balance/match.test.ts`'s
deathmatch-clock canary. Neither is a defect in the change; both are the shifted stream. Re-pin or
re-seed them deliberately, and say which you did.

## 5. Raising `N` does nothing for a chassis whose kit is shorter

A chassis's effective slot count is `min(kit.length, N)`. Going from 3 to 4 while every shipped
chassis authors three weapons changes nothing a player sees on those chassis — the HUD still draws
three boxes, the hint still teaches three abilities, and the `;`/MMB key does nothing.

Giving a car a fourth weapon is a **`CAR_TABLE` edit**, and it needs a `WEAPON_TABLE` row nobody else
carries: **weapon exclusivity (L1) is unconditional**, active chassis or not. `tremor` is the only
spare row on the table today. Authoring a new one is the `weapon-forger` skill's job, not this one.

The mirror case is worth stating too: lowering `N` below a chassis's kit length hides its trailing
weapons without deleting them. Raise `N` back and they return, untouched.

## 6. Above 4 is refused, and the HUD has no room

`weapon-slots.test.ts` fails on `N > ABILITY_SLOT_CEILING`, so the ceiling is enforced, not merely
documented. The layout backs it up: `weapon-hud.test.ts`'s "fits four slots inside the view and
would not fit five" asserts that at four boxes the last slot's name sits inside `VIEW_HEIGHT` and at
five it does not.

That test asserts the **comparison**, not the pixel values, so the numbers below are computed from
the layout constants (`SLOT_STACK_TOP_GAP_PX` 167, `SLOT_BOX_PX` 64, `GAP_PX` = 6 + 12 + 10 = 28,
a 92 px pitch) at the `topInset` of 138 the test uses, against `VIEW_HEIGHT` 720. **Recompute them
rather than trusting this paragraph if any of those constants has moved:**

| Boxes | Last box `y` | `nameY` | Name text bottom (`nameY + 12`) | Fits in 720? |
|---|---|---|---|---|
| 4 | 581 | 651 | **663** | yes |
| 5 | 673 | 743 | **755** | no |

Spec clause VS21 originally quoted "663" and "743" side by side — two different measures (the
four-box stack's `nameY + SLOT_NAME_FONT_PX` against the five-box stack's bare `nameY`). It was
corrected on 2026-09-20 and now reads 663 and **755**, matching the table above and the quantity the
test compares against `VIEW_HEIGHT`. The conclusion never changed.

Raising `ABILITY_SLOT_CEILING` is therefore a HUD layout piece of work as well as a config edit, and
is out of scope here.

## 6b. What `npm test` actually does at each `N`

Measured on 2026-09-20 by editing `ABILITY_SLOTS`, rebuilding shared and running each suite, against
a green baseline at the shipped `N = 3` of **shared 1027 / client 1069 / scripts 160 passing**:

| `N` | shared failures | client failures | script failures |
|---|---|---|---|
| 4 | 1 | 5 | 1 |
| 3 | 0 | 0 | 0 |
| 2 | 20 | 13 | 2 |
| 1 | 28 | 18 | 3 |

**Narrowing `N` breaks far more fixtures than widening it — twenty-eight shared failures at
`N = 1` against one at `N = 4`.** That asymmetry is not noise and it is not a defect in the change; it is what the
fixtures are for. Almost every one of those failures pins the **three-weapon shipped roster**: a
full kit's length, a three-bit fire mask, a three-box HUD stack, a three-row manual card, a
three-entry playground loadout. Widening leaves all of that still true — a kit shorter than `N` is
the designed case (section 5), so a three-weapon chassis in an `N = 4` build behaves exactly as it
did, and only the handful of fixtures that assert `maxAbilitySlots === 3` or a four-bit mask move.
Narrowing falsifies every one of those roster expectations at once, because the shipped kits really
are cut.

Budget the work accordingly: going **up** is an afternoon of re-pinning; going **down** is a pass
over every fixture that mentions a kit.

What is NOT expected at any `N` is a production failure — a crash, an off-by-one, a slot drawn that
cannot be fired or a slot fired that is not drawn. The spec's §11 makes that the obligation, and
these counts are the reason it does not instead promise a green suite at every count. If something
that is not a roster-pinned fixture fails, that is a real defect: fix it rather than re-pinning it.

An earlier draft of this skill listed the `N = 4` failure set and said to expect the same set at any
other `N`. That was wrong by a factor of nearly thirty on the shared suite alone, and is corrected
here (2026-09-20). The rows above are measured on the tree that shipped the variable-slot work,
including the VS34 stored-setup truncation; an earlier measurement taken before that fix read 6 / 16
/ 20 client failures, because an over-long stored loadout still discarded the whole blob.

The `N = 4` set specifically, since it is the small one and the likely direction of travel:

- shared: `src/config/weapon-slots.test.ts` — "derives the fire-slot constants from the ability
  count (BA11, VS6)" asserts `maxAbilitySlots` is 3.
- client: `src/config/slot-keys.test.ts` (the two mask-limit tests and both `hintSlotOrder` cases),
  `src/dev/playground/ui-model.test.ts`'s add/remove control, and the manual/stamp pairing once the
  page is rebuilt.
- server: `src/sim/tick.test.ts`'s two fire-mask tests, plus the two seeded tests named in step 4
  (`tiers.test.ts`'s H30 and `balance/match.test.ts`'s deathmatch-clock canary) — those two are the
  shifted RNG stream, not a slot-count defect.

Do not copy that list forward to another `N`. Run the suite and read it.

## 7. Say it loudly, and recommend the harnesses

`N` reaches `sim/weapons/fire.ts`, `WEAPON_SLOT_CONFIG` and the per-slot columns in both harnesses'
reports — weapon reach, press rates and which weapons are swept at all all move. Per this repo's
playtest rule:

- Name the change in your summary, loudly.
- **Recommend `npm run playtest` and `npm run balance`. Do not run them on the user's behalf**, and
  do not update a probe as a matter of course.
- A probe that no longer **compiles** is the one case to fix on the spot — say that you did.

## Path to change it

1. Edit `ABILITY_SLOTS` in `weapon-slots.ts`.
2. Bump `BOT_BRAIN_VERSION` (step 4).
3. Root `npm run build`, then `npm run build:manual`.
4. `npm test`, and update the tests that pin the shipped value. **How many that is depends
   enormously on which way you move `N` — see "What `npm test` actually does at each `N`" below.**
   Update each expectation to the new `N`; do not weaken an assertion into a tautology.
5. `npm run check:art` — no change expected (it is deliberately `N`-unaware), but the manual moved.
6. `npm run ttk` — confirm it prints a matrix and names the newly-unreachable rows rather than
   throwing.
7. Say the playtest/balance part out loud (section 7 above).

## Verifying it actually took

- The countdown action hint prints **`min(kit.length, N) + 1`** pills — the local car's abilities
  plus `LMB` — not `N + 1`. `ArenaScene` calls `actionKeysFor(this.localAbilityCount(), …)`, so the
  row follows the chassis, not the config. **At `N = 4` with today's three-weapon kits it still
  prints 4 pills (`LMB RMB Q E`), and that is the change working, not failing** — see section 5. Drop
  the `LMB` pill from that count if `BASIC_ATTACK_CONFIG.enabled` is `false`.
- The gutter's slot stack draws `min(kit, N)` boxes, and its TOP does not move with the count —
  the stack is top-anchored (VS20), so a shorter kit shortens it downward only.
- `?dev=playground` is the fastest check: set a seat to one weapon and to `N`, and confirm the box
  count, the hint row and the fire keys all follow.
- `packages/client/public/manual.html` lists `min(kit, N)` weapons per chassis, with the
  "Basic attack" card first.
