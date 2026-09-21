---
name: basic-attack-toggle
description: >-
  Use when someone asks to turn the basic attack on or off, disable/enable the
  basic attack, "cars shouldn't have a basic attack for this build", "bring
  back the basic attack", or otherwise wants the whole basic-attack mechanic
  switched off or on without deleting it. Flips BASIC_ATTACK_CONFIG.enabled
  and carries out every step that flag change owes — HUD, manual, tests,
  rebuild. Not for retuning the basic attack's numbers (damage, cooldown,
  range) — that is weapon-forger, editing BASIC_ATTACK_BASE.
---

# Basic-attack toggle

Every car carries one weapon beyond its ability kit, the basic attack (`CarDef.basicAttack`,
**fire slot 0**, bound to `LMB` and nothing else since the 2026-09-21 one-layout change — it moved
from last to first in the 2026-09-20 variable-slot work; it ships enabled as of 2026-09-21) —
see [`docs/combat-model.md`](../../../docs/combat-model.md#basic-attack) and
[`docs/superpowers/specs/2026-09-17-basic-attack-design.md`](../../../docs/superpowers/specs/2026-09-17-basic-attack-design.md)
(BA1–BA38) for the mechanic itself. This skill is for switching that whole mechanic off or back on
**without deleting any of it** — the nine `basic-attack-*` rows, `CarDef.basicAttack`, and its
`WeaponSlotState` at index 0 all stay exactly as authored either way. How MANY ability slots sit
beside it is a different knob with its own skill:
[`ability-slot-count`](../ability-slot-count/SKILL.md).

**One flag, one place:** `BASIC_ATTACK_CONFIG.enabled` in
[`packages/shared/src/config/weapon-config.ts`](../../../packages/shared/src/config/weapon-config.ts),
beside `BASIC_ATTACK_BASE`. It is a **build-time** flag, not a live-session setting — flipping it
means editing the source and rebuilding, the same weight as flipping `CarDef.isActive`. There is no
env var, join option, or playground control for it, on purpose: this is a decision about what the
shipped game IS for this build, not a per-match or per-room setting.

## What actually reads the flag

Four places, and only four — everything else that touches a basic attack is deliberately left
unaware of the toggle (see "What does NOT change" below).

1. **`beginFire`** (`packages/shared/src/sim/weapons/fire.ts`) refuses a press on
   `WEAPON_SLOT_CONFIG.basicAttackSlotIndex` when disabled — dropped exactly like a press whose bit
   was never set, not like a slot that exists but always fails a later gate. This is *shared* sim
   code, so client prediction and the server agree by construction: no misprediction, no ghost shot
   that fires locally and reconciles away.
2. **`chooseSlot`** (`packages/server/src/bot/brain/firing.ts`) never selects that slot either. This
   is not cosmetic parity with a human's dead key — a bot that "chose" to press a disabled basic
   attack would burn its one press for the tick on nothing, when an actual ability might have been
   worth firing instead.
3. **`hintSlotOrder`** (`packages/client/src/config/slot-keys.ts`) drops the slot from the countdown
   action hint's order entirely when disabled, so `HINT_SLOT_ORDER` (resolved once from the flag at
   module load) has `N` entries instead of `N + 1` and the `LMB` pill never prints. The hint is the
   *only* place the basic attack's binding is taught (BA19) — hiding the weapon means removing that
   pill, not leaving a dead one on screen.
4. **`scripts/build-cars-and-weapons.mjs`**'s `carSection` skips the "Basic attack" card for every
   chassis, and `balanceStamp()` hashes `BASIC_ATTACK_CONFIG.enabled` alongside the tables it already
   hashes — so flipping the flag without rebuilding the manual fails `npm test` by name, the same way
   any other stale-manual edit does.

## What does NOT change, and why that is deliberate

`fireSlotsOf` (`packages/shared/src/config/weapon-slots.ts`), the balance harness
(`packages/server/balance/stats.ts`), `npm run ttk`, `duel.fixture.ts`, and the playtest probes
(`packages/server/playtest/weapons.ts`, `weapons2.ts`, `geometry.ts`) **do not read the flag**. They
sweep `WEAPON_TABLE` structurally — `carrierOf(weaponId)` must always be able to find a chassis for
every one of the nine `basic-attack-*` rows, or those tools crash outright (`.find()` returning
`undefined` where a `CarId` is expected). Gating `fireSlotsOf` itself was tried in this skill's own
design pass and rejected for exactly that reason. Leave it alone. A balance or ttk report taken with
the flag off will still show the basic attack in the rotation/table — a known, accepted limitation,
not a bug to fix here.

`CAR_TABLE`, `WEAPON_TABLE`, the schema, and the sim's fire state machine (`newFireState`,
`tickRecharge`, `releaseShots`) are all untouched. A disabled basic-attack slot still recharges,
still holds a stock, still occupies fire slot 0 in `FireState.slots` — it simply can never be
*pressed into* firing.

## Path to flip it

1. Edit `BASIC_ATTACK_CONFIG.enabled` in `weapon-config.ts` (`true` → `false`, or back).
2. Root `npm run build` (never `--workspaces` — shared must build before server inlines it).
3. `npm run build:manual` — the manual's fingerprint moved, so this is not optional.
4. `npm test` — should be clean; if `manual-page.test.mjs`'s staleness check fails, step 3 was
   skipped or ran against a stale shared `dist`.
5. `npm run check:art` — no change expected here (the nine basic-attack rows already warn
   icon-less regardless of the flag), but run it anyway since the manual rebuilt.
6. Say the playtest part out loud, per this repo's own rule: disabling the basic attack changes
   weapon reach, fire cadence, and per-press damage for every match the probes measure. Name
   `npm run playtest` and recommend it; do not run it yourself unless asked, and do not edit a probe
   unless it fails to compile.

## Verifying it actually took

- In a running client, the countdown hint reads `"RMB Q E to fire"` when disabled and
  `"LMB RMB Q E to fire"` when enabled — one pill per ability at this build's `N`, plus `LMB` only
  when enabled. Disabled, pressing LMB does nothing once the match starts; LMB is bound to nothing
  else, so a dead LMB is the disabled state working.
- `packages/client/public/manual.html` (or `http://localhost:5173/manual.html`) shows each
  chassis's ability cards only — no "Basic attack" card first.
- Disabled, a bot never fires a basic-attack shot; watching `?dev=playground`'s bot line, `slot 0` never appears
  as a chosen slot.
