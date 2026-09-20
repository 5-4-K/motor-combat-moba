# Variable weapon slots — design

**Date:** 2026-09-20
**Status:** approved
**Clauses:** VS1–VS34

## 1. What this adds

Two things, and they are separable:

1. **A chassis may carry 1 to 4 ability weapons instead of exactly 3.** `CarDef.weapons` stops
   being a fixed-length list every active chassis must fill.
2. **A build-time knob, `N`, caps how many ability slots this build actually has.** Weapons a
   chassis authors past `N` stay in `CAR_TABLE` — nothing is deleted — but they cannot be fired,
   get no HUD box, are not taught in the countdown hint, and are not published in the players'
   guide. Flip `N`, rebuild, and the game has that many slots.

The effective ability count for a chassis is therefore `min(kit.length, N)`, per chassis, resolved
in one place.

`N` defaults to **3**, so this work merges without changing what a player sees. The 4th slot is
capacity, switched on later by the [`ability-slot-count`](../../../.claude/skills/ability-slot-count/SKILL.md)
skill once weapons exist to fill it.

### 1.1 What does not change

- `stepSim` is still the lockstep. No new fire pipeline, no new pending slot, no new sim phase.
- **The shipped roster is untouched.** `bullseye`, `mirage` and `bastion` keep their three weapons;
  the six prototypes keep `weapons: []`. No `WEAPON_TABLE` row is added, removed or retuned.
- Weapon exclusivity (L1) stays unconditional and covers inactive chassis exactly as today.
- No drive knob, `CAR_TABLE` rating, `STATUS_TABLE` row or ram constant moves, so
  [`docs/turn-tuning.md`](../../turn-tuning.md) is untouched and `golden.test.ts` cannot move.
- The basic attack keeps its own mechanic verbatim — `CarDef.basicAttack`, `BASIC_ATTACK_CONFIG.enabled`,
  its `recoveryMs: 0`, and BA15's rule that it gets **no HUD box**. Only its *index* moves (VS5).
- Friendly fire, `canDamage`, kill attribution and spike credit are unchanged.

## 2. Two numbers, not one

**VS1. `ABILITY_SLOT_CEILING = 4` is structural and is never edited as a tuning act.** It sizes the
`SLOT_KEYS` table, bounds the wire mask's width, and is the upper bound `N` is validated against.
It is not a balance number and no skill edits it. Raising it is its own piece of work, because §6
shows the HUD gutter has no room above 4 (VS20).

**VS2. `WEAPON_SLOT_CONFIG.maxAbilitySlots` is `N`: the build-time slot count, 1 to 4, default 3.**
It keeps its current name because its current meaning — "how many weapons a chassis's kit may
present" — is exactly what it now controls. It lives where it lives today,
`packages/shared/src/config/weapon-slots.ts`.

**VS3. `maxFireSlots = N + 1` and `basicAttackSlotIndex = 0`, both derived, never typed.** The two
can then never disagree with `N` or with each other.

**VS4. A config test pins `1 <= N <= ABILITY_SLOT_CEILING`.** An out-of-range `N` fails the suite
naming the value, rather than producing a mask width or a key index that silently drops presses.

**VS5. `N` is build-time, exactly as `BASIC_ATTACK_CONFIG.enabled` is.** No env var, no join option,
no playground control, no runtime tuning-store entry. It decides what the shipped game *is* for this
build. The playground's tuning store is process-wide, so an `N` a tester could move would re-shape
every other room in the process.

## 3. Slot layout and indexing

**VS6. The basic attack moves to fire slot 0; abilities occupy 1..N.** Fire-slot order becomes
`[basicAttack, ...kit]` — the reverse of today's `[...kit, basicAttack]`.

This is the change the rest of the spec exists to support. Under the old order the basic attack sat
at `kit.length`, which was a constant only because every active kit was the same length;
`basicAttackSlotIndex` was pinned at 3 and `weapon-slots.test.ts` pinned every active chassis to
exactly 3 weapons *to keep that constant honest*. Once kits vary, `kit.length` varies, and the
basic attack's key would change when the player changed chassis. At index 0 the index is a true
constant at every kit length, the array stays dense with no holes, and `H`/LMB fires the basic
attack on every car forever.

**VS7. The fire-slot array is dense and its length is `1 + min(kit.length, N)`.** A short kit
produces a short array; it does not produce holes. `beginFire`'s existing
`usable = min(state.slots.length, maxFireSlots)` cap therefore handles every kit length with no
special case — a mask bit for an ability the chassis does not carry is simply out of range.

**VS8. `fireSlotsOf(carId)` returns `[basicAttackOf(carId), ...slotsOf(carId)]`.** Its documented
reader list (balance `stats.ts`, `scripts/ttk.mjs` ×2, `duel.fixture.ts` ×2, the playtest probes)
is unchanged in membership; only the order those readers see moves.

**VS9. `newFireState`'s explicit-loadout path builds the same order inline**, as it does today, and
for the same reason: it accepts a caller-given `weaponIds` override that `fireSlotsOf` has no
parameter for.

**VS10. `slotsOf` and `CarDef.weapons` still mean the ABILITY kit**, and `slotsOf` now truncates to
`N`. The HUD, the guide, the playground's loadout picker, the balance seat filter, ttk's attacker
axis and the bot's reach model all ask "what kit was this chassis designed around", and all of them
must now get the answer the *player* sees, which is the truncated one.

**VS11. `slotsFrom`'s warning splits in two.** Today it warns once per car when a kit exceeds
`maxAbilitySlots`. With `N` in play that fires on the intended configuration — a chassis authoring
4 weapons in an `N = 3` build — and would be noise on every boot.

- Kit longer than `ABILITY_SLOT_CEILING`: an authoring error. Warn once per car, naming the car and
  the dropped weapons, exactly as today.
- Kit within the ceiling but longer than `N`: the designed case. Truncate **silently**.

## 4. Press priority

**VS12. `beginFire` scans fire slots from the highest index down.** The highest set bit the car can
use wins a same-tick tie, reversing today's lowest-bit-wins scan.

The basic attack at index 0 is therefore scanned last and loses every tie to an ability — which is
the behaviour CLAUDE.md and BA-era code already document, preserved through a different mechanism
now that its index moved to the bottom.

**VS13. Among abilities, the highest slot now wins a tie.** Holding every ability key on Bastion
fires `wildcharge` (slot 3) where it previously fired `thumper` (slot 0). This is a consequence of
VS12, accepted deliberately rather than worked around: a player mashing every key burns their
largest cooldown instead of their smallest. Recorded here so a future reader finds a decision rather
than a bug.

**VS14. `pressId` is unchanged.** It is still `sessionId#tick#slot`, and slot identity is still what
`lastFiredSlot` holds and what the refire lock lives on. Renumbering the indices does not change any
of that, because nothing compares a slot index across builds.

## 5. Input and keys

**VS15. `SLOT_KEYS` is reindexed and gains a fifth row, ceiling-length regardless of `N`:**

| Fire slot | Weapon | Key | Mouse |
|---|---|---|---|
| 0 | basic attack | `H` | LMB |
| 1 | ability 1 | `J` | RMB |
| 2 | ability 2 | `K` / `SHIFT` | — |
| 3 | ability 3 | `L` / `SPACE` | — |
| 4 | ability 4 | `;` | MMB |

Every binding a player already uses fires the same weapon it fires today. `H`/LMB was slot 3 and is
now slot 0; `J`/RMB was 0 and is now 1; `K`/`SHIFT` was 1 and is now 2; `L`/`SPACE` was 2 and is now
3. The renumbering is internal. `;` (`keyCode` 186) extends the `H J K L` home-row run one key to the
right, and MMB (`MouseEvent.buttons` bit value 4) is the only mouse button still free.

**VS16. The table is `ABILITY_SLOT_CEILING + 1` rows long at every `N`.** `slotMaskFrom` already
limits its scan to `maxFireSlots`, so rows past `N` are never read into a mask and the key for a
slot this build does not have simply does nothing.

**VS17. Middle-click must be suppressed.** MMB is the browser's autoscroll trigger; the pointer
handler calls `preventDefault` so pressing ability 4 does not start an autoscroll drag over the
canvas.

**VS18. `SLOT_MASK` is `(1 << maxFireSlots) - 1`**, so it narrows with `N`. A hand-rolled client
cannot press a slot this build does not have, the same defence the constant already provides.

**VS19. The countdown action hint becomes a function of the local player's kit, not a module
constant.** `ACTION_KEYS` and `ACTION_ALTS` are resolved today from `HINT_SLOT_ORDER`, a constant.
With variable kits, a 2-weapon chassis would be taught `;` for a slot it does not have. The hint
publishes `[0, 1, ..., min(kit.length, N)]` for the chassis being driven, with slot 0 dropped when
`BASIC_ATTACK_CONFIG.enabled` is false exactly as `hintSlotOrder` drops it today. The hint remains
the only place the basic attack's binding is taught (BA19).

## 6. HUD

**VS20. The slot stack is top-anchored, not centred.** `slotBarLayout` currently centres the stack
in the column below the roster panel, so adding a box pushes the stack *up*. The status strip is
anchored to the stack's top and grows upward, so at 4 boxes the strip would climb 46 px into a
roster panel it currently clears by 11 px.

Top-anchoring fixes that and buys two further properties. The stack's top no longer depends on the
count, so the strip's clearance stays exactly 11 px at every `N` and every kit length. And ability 1
keeps the same screen position on every chassis, instead of jumping when the player switches car.

The anchor is `topInset + SLOT_STACK_TOP_GAP_PX`, a named constant beside the other layout
constants — not a literal 305, which would be a magic number and would silently decouple from
`rosterPanelLayout` the day the panel's height changes. Its value is chosen so that at `N = 3` the
stack lands exactly where the centred layout puts it today, and a test asserts that pixel-identity
rather than leaving it as a claim.

**VS21. Four boxes is the layout's limit, and the test says so.** At the shipped constants —
`SLOT_BOX_PX` 64, `GAP_PX` 28, `SLOT_NAME_FONT_PX` 12, `VIEW_HEIGHT` 720 — a 4-slot stack's last
name baseline lands at 663, clearing the view by 57 px. A 5th would land at 743 and overflow.
`weapon-hud.test.ts`'s gutter-budget block asserts both, so raising `ABILITY_SLOT_CEILING` fails
loudly with the reason rather than clipping a label off-screen.

**VS22. The slot bar draws one box per ABILITY slot, and the caller must stop passing an array
length.** Today `slotBarLayout` is handed `weapons.length` and clamps it with
`min(count, maxAbilitySlots)`, which worked only because the basic attack was the array's last
element and the clamp happened to cut it off. At index 0 that clamp would drop ability `N` and draw
the basic attack instead. The caller therefore passes the ability count — the fire-slot array length
minus one — and `slotBarLayout` clamps to `maxAbilitySlots` as a guard rather than as the mechanism.
BA15 is preserved by construction: the basic attack is not an ability slot, so it is never a box. If
it ever needs a readout it gets its own.

**VS23. Key pills read `SLOT_KEYS[abilityIndex + 1]`.** The `+ 1` is the one place the basic
attack's index-0 position leaks into the HUD, and it is written once.

## 7. Authoring rules

**VS24. An active chassis carries 1 to `ABILITY_SLOT_CEILING` weapons.** `weapon-slots.test.ts`'s
"gives every ACTIVE car exactly a full kit" relaxes to that range. The guard it doubled as — a
weapon silently dropped from a shipped loadout — is not lost: "gives each chassis the kit its type
calls for" already pins all three shipped kits element by element, which catches a dropped weapon
more precisely than any count.

**VS25. An inactive chassis may still carry no weapons at all.** Unchanged. That is the shape a
prototype is driven in.

**VS26. A kit may exceed `N` but never `ABILITY_SLOT_CEILING`.** The first is the designed case
(VS11); the second fails the suite.

**VS27. `basicAttackSlotIndex` is 0 for every chassis at every kit length, and a test says so.**
This is the invariant that was previously true only by coincidence, and it is the reason the
"exactly a full kit" assertion could be relaxed at all.

## 8. Players' guide and `balanceStamp`

**VS28. The guide publishes `min(kit.length, N)` weapons per active chassis.** The "Basic attack"
card is unaffected — it is published whenever `BASIC_ATTACK_CONFIG.enabled`, independent of `N`.
A status reachable only from a weapon parked past `N` is not published in the Effects section, the
same rule that already excludes a status reachable only from an inactive chassis.

**VS29. `{roster.slotsPerCar}` is deleted.** It resolves `slotsOf(carIds[0]).length` — one number
asserting a uniformity that no longer holds. The two chassis lines quoting it ("Two of its
{roster.slotsPerCar:words} weapons …") are rewritten not to quote a roster-wide count.
`manual-facts.test.ts`'s assertion on the token goes with it. This shrinks the token map, which is
the map tracking the sentences rather than the guard weakening — a fact the prose never quotes
cannot rot.

**VS30. `balanceStamp` folds `N` in**, exactly as it folds `BASIC_ATTACK_CONFIG.enabled`. Changing
`N` without `npm run build:manual` then fails `npm test` with the command to run, rather than
shipping a guide that advertises slots the build does not have.

## 9. Offline tools

**VS31. `balance`, `ttk` and the playtest probes respect `N`.** They sweep only what a player can
press. This diverges from the basic-attack toggle's precedent — where the tools are deliberately
flag-unaware — and the divergence is the point: an unreachable basic attack is one weapon of
nineteen, while an unreachable ability slot can be a quarter of the game's firepower, and a balance
report that measured it would describe a game nobody plays.

**VS32. `carrierOf` must skip and name unreachable rows rather than assume a carrier exists.** This
is the hazard VS31 creates. `carrierOf` in `playtest/weapons.ts`, `weapons2.ts` and `geometry.ts`,
and ttk's equivalent, currently crash the whole run when a `WEAPON_TABLE` row has no chassis — the
documented reason those tools ignore `BASIC_ATTACK_CONFIG.enabled`. A weapon parked past `N` has no
*reachable* carrier, so each tool skips it and names it in its report, the way ttk's matrix already
names the chassis it left off.

**VS33. `npm run check:art` stays `N`-unaware.** It already covers inactive rows, marking them
rather than skipping them, for the reason that missing art is worth learning before release. A
weapon parked past `N` is in exactly that position.

## 10. Playground and bot

**VS34. The playground's per-seat loadout becomes variable-length.** `shippedLoadoutOf`'s
`[WeaponId, WeaponId, WeaponId]` tuple becomes `readonly WeaponId[]`; `isLoadoutLegal` accepts 1 to
`N` distinct weapons instead of exactly 3 distinct; `PlaygroundSetup`'s per-seat `weapons` carries a
variable-length list, and the Car select panel gains add/remove beside each seat's weapon rows. A
persisted localStorage setup written by an older build — three entries, no length field — must still
load; it is already a legal loadout at any `N >= 3` and is truncated by the same rule as a roster kit
below that.

**The bot needs no behavioural change, but `BOT_BRAIN_VERSION` must be bumped.**
`personality.ts` draws `1 + maxFireSlots` random numbers per bot, always. `N` changes `maxFireSlots`,
so it changes the draw count, so it shifts every seeded RNG stream downstream of it. No bot decides
anything differently, and yet every bot in a seeded run behaves differently. `chooseSlot` needs only
the moved `basicAttackSlotIndex` constant; `reach.ts` and `solution.ts` read `slotsOf` and get the
truncated kit for free.

**Balance and playtest reports are not comparable across a change to `N`, or across this merge.**
The bot fingerprint will say so, and the harness's own `--baseline` flag will refuse the comparison
rather than trust a reader to remember. No baseline run is being taken before this work.

## 11. Testing

- `weapon-slots.test.ts`: the relaxed active-kit range (VS24), the ceiling (VS26), `N`'s own range
  (VS4), `basicAttackSlotIndex === 0` at kit lengths 1 through 4 (VS27), the split truncation
  warning (VS11), and `fireSlotsOf`'s order (VS8).
- `fire.ts` tests: highest-index-wins (VS12), the basic attack losing a tie from index 0 (VS12),
  ability inversion asserted rather than discovered (VS13), and a 1-weapon and a 4-weapon chassis
  both firing every slot they have (VS7).
- `slot-keys.test.ts`: the reindexed table (VS15), the narrowed mask at each `N` (VS18), and the
  kit-length-aware hint order (VS19).
- `weapon-hud.test.ts`: the top anchor (VS20), pixel-identity with today's layout at `N = 3`
  (VS20), the 4-slot fit and the 5-slot overflow (VS21), and the strip's 11 px clearance holding at
  every count (VS20).
- `manual-page.test.mjs` / `manual-facts.test.mjs`: the guide publishing `min(kit, N)` (VS28), the
  deleted token (VS29), and the stamp moving with `N` (VS30).
- The suite must be green at `N = 1, 2, 3, 4`, not only at the shipped default. `N` is a
  build-time constant and a test cannot move it, so **every function whose behaviour depends on `N`
  takes it as a parameter and is re-exported with the live value bound** — the shape
  `hintSlotOrder(enabled)` / `HINT_SLOT_ORDER` already uses. That covers `slotsFrom`, the hint
  order, the mask limit and the HUD's clamp. Production code reads the bound form; tests call the
  parameterised one across the whole range. A function that reads `WEAPON_SLOT_CONFIG` directly is
  a function no test can exercise at another `N`, which is how a slot count that only works at 3
  would ship.

## 12. The skill

`.claude/skills/ability-slot-count/SKILL.md`, mirroring
[`basic-attack-toggle`](../../../.claude/skills/basic-attack-toggle/SKILL.md): takes the new `N`,
edits the one constant, and walks every step that edit owes — rebuild shared, server and client in
that order; `npm run build:manual` and commit the page; which suites are expected to move; the
`BOT_BRAIN_VERSION` bump; and the warning that balance and playtest reports do not survive the
change.

## 13. Out of scope

- **Giving any shipped chassis a fourth weapon.** That needs new exclusive `WEAPON_TABLE` rows —
  only `tremor` is spare against three chassis — plus icons and a balance pass. It is a
  `weapon-forger` piece of work, and `N` exists so it is a data edit when it comes.
- **Any compensation for carrying fewer weapons.** A 1-weapon chassis is strictly weaker than a
  4-weapon one at equal ratings, and nothing in `CarDef` pays for the difference. If kit size is
  ever meant to be a real design axis rather than authoring freedom, that is its own spec.
- **Raising `ABILITY_SLOT_CEILING` above 4.** The gutter has no room (VS21).
- **Per-room or per-match `N`.** VS5.
