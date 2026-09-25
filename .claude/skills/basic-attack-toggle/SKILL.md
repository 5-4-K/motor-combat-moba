---
name: basic-attack-toggle
description: >-
  Use when someone asks to turn the basic attack on or off for a game mode,
  disable/enable the basic attack, "cars shouldn't have a basic attack in
  Conquer", "bring back the basic attack for Deathmatch", or otherwise wants
  the whole basic-attack mechanic switched off or on for one or more modes
  without deleting it. Flips a mode's `slots.basicAttackEnabled` override and
  carries out every step that flag change owes — HUD, manual, tests, rebuild,
  snapshot. Not for retuning the basic attack's numbers (damage, cooldown,
  range) — that is weapon-forger, editing `BASIC_ATTACK_BASE`.
---

# Basic-attack toggle

Every car carries one weapon beyond its ability kit, the basic attack (`CarDef.basicAttack`,
**fire slot 0**, bound to `LMB`) — see [`docs/combat-model.md`](../../../docs/combat-model.md#basic-attack)
and [`docs/superpowers/specs/2026-09-17-basic-attack-design.md`](../../../docs/superpowers/specs/2026-09-17-basic-attack-design.md)
(BA1–BA38) for the mechanic itself. This skill is for switching that whole mechanic off or back on,
**per game mode**, without deleting any of it — the nine `basic-attack-*` rows, `CarDef.basicAttack`,
and its `WeaponSlotState` at index 0 all stay exactly as authored either way, in every mode. How MANY
ability slots sit beside it is a different knob with its own skill:
[`ability-slot-count`](../ability-slot-count/SKILL.md).

**One flag, authored per mode:** `slots.basicAttackEnabled` (`WeaponSlotConfig`), whose base value
is `false` in [`packages/shared/src/config/weapon-slots.ts`](../../../packages/shared/src/config/weapon-slots.ts).
A mode that wants a different answer overrides it in its own `config.ts`:

```ts
// packages/shared/src/modes/<slug>/config.ts
export const YOUR_MODE_OVERRIDES: ModeOverrides = {
  slots: { basicAttackEnabled: true },
};
```

It is a **build-time** override, not a live-session setting — flipping it means editing that mode's
source and rebuilding, the same weight as flipping `CarDef.isActive`. There is no env var, join
option, or playground control for it, on purpose: this is a decision about what a given mode IS, not
a per-match or per-room setting. **All four shipped modes (Brawl, Team brawl, Deathmatch, Conquer)
ship `false` today** — none overrides `slots` — so the mechanic is off everywhere until a mode
deliberately turns it on.

## What actually reads the flag

Five places read `slots().basicAttackEnabled` under whichever mode is installed, and only five —
everything else that touches a basic attack is deliberately left unaware of the toggle (see "What
does NOT change" below).

1. **`beginFire`** (`packages/shared/src/sim/weapons/fire.ts`) refuses a press on
   `WEAPON_SLOT_CONFIG.basicAttackSlotIndex` when that mode's `basicAttackEnabled` is `false` —
   dropped exactly like a press whose bit was never set. This is *shared* sim code, so client
   prediction and the server agree by construction, under whatever mode the match is running.
2. **`chooseSlot`** (`packages/server/src/bot/brain/firing.ts`) never selects that slot either for a
   bot playing a mode where it is disabled — it does not burn its one press a tick on a weapon that
   cannot fire.
3. **`hintSlotOrder`** (`packages/client/src/config/slot-keys.ts`) drops the slot from the countdown
   action hint's order for a room running a mode where it is disabled, so the `LMB` pill never
   prints. The hint is the *only* place the basic attack's binding is taught (BA19) — hiding the
   weapon means removing that pill, not leaving a dead one on screen.
4. **`scripts/build-cars-and-weapons.mjs`**'s `carSection` skips the "Basic attack" card for every
   chassis **in that mode's tab** when its flag is off, and `balanceStamp()` hashes each active
   mode's `slots().basicAttackEnabled` alongside the tables it already hashes — so flipping one
   mode's flag without rebuilding the manual fails `npm test` by name.
5. **`carHasTurretWeapon`** (`packages/shared/src/sim/weapons/turret.ts`) skips the basic-attack fire
   slot when the mode's flag is off — but the nine basic-attack rows are the only rows in this build
   carrying `turret` (see the root `CLAUDE.md`'s mouse-aim section). So turning the basic attack ON
   in a mode also turns on turret drawing, pointer lock and the crosshair FOR THAT MODE, purely as a
   side effect of the flag flip: every chassis's basic attack becomes a turreted weapon the moment
   `basicAttackEnabled` is `true`, with no separate step to enable turrets. Say this out loud when
   flipping the flag on — it is a bigger client-side change than "the LMB pill appears."

## What does NOT change, and why that is deliberate

`fireSlotsOf` (`packages/shared/src/config/weapon-slots.ts`), the balance harness
(`packages/server/balance/stats.ts`), `npm run ttk`, `duel.fixture.ts`, and the playtest probes
(`packages/server/playtest/common/weapons.ts`, `weapons2.ts`, `geometry.ts`) **do not read the
flag**. They sweep `WEAPON_TABLE` structurally — `carrierOf(weaponId)` must always be able to find a
chassis for every one of the nine `basic-attack-*` rows, or those tools crash outright. Leave it
alone. A balance or ttk report for a mode with the flag off will still show the basic attack in the
rotation/table — a known, accepted limitation, not a bug to fix here.

`CAR_TABLE`, `WEAPON_TABLE`, the schema, and the sim's fire state machine (`newFireState`,
`tickRecharge`, `releaseShots`) are all untouched, in every mode. A disabled basic-attack slot still
recharges, still holds a stock, still occupies fire slot 0 in `FireState.slots` — it simply can
never be *pressed into* firing under that mode.

## Path to flip it, for one mode

1. Edit that mode's `slots.basicAttackEnabled` override in `packages/shared/src/modes/<slug>/config.ts`
   (add the override to turn it `true`; delete the override, or set it back to `false`, to restore
   the base). Flipping the flag for **every** mode means editing `WEAPON_SLOT_CONFIG.basicAttackEnabled`
   in `weapon-slots.ts` itself instead — the same base-vs-override choice any config edit makes.
2. `npx vitest run packages/shared/src/modes/snapshots.test.ts -u` — only your mode's snapshot file
   should move (or every mode's, if you edited the base). Commit the moved file(s).
3. Root `npm run build` (never `--workspaces` — shared must build before server inlines it).
4. `npm run build:manual` — the manual's fingerprint moved for the mode(s) you touched, so this is
   not optional.
5. `npm test` — should be clean; if `manual-page.test.mjs`'s staleness check fails, step 4 was
   skipped or ran against a stale shared `dist`.
6. `npm run check:art` — no change expected here (the nine basic-attack rows already warn
   icon-less regardless of the flag), but run it anyway since the manual rebuilt.
7. Say the playtest part out loud, per this repo's own rule: enabling or disabling the basic attack
   in a mode changes weapon reach, fire cadence, and per-press damage for every match played in it.
   Name `npm run playtest -- --mode=<that mode>` and recommend it; do not run it yourself unless
   asked, and do not edit a probe unless it fails to compile.

## Verifying it actually took

- In a running client, host a match in the mode you changed: the countdown hint reads
  `"RMB Q E to fire"` when disabled and `"LMB RMB Q E to fire"` when enabled (one pill per ability at
  this build's `N`, plus `LMB` only when enabled). A different mode's lobby/match is unaffected.
- `packages/client/public/manual.html` (or `http://localhost:5173/manual.html`), on that mode's tab:
  a "Basic attack" card appears first on each chassis when enabled, and is absent when disabled.
  Another mode's tab reflects its own flag.
- Disabled, a bot never fires a basic-attack shot in that mode; watching `?dev=playground`'s bot
  line, `slot 0` never appears as a chosen slot.
- Enabled, that mode's arena captures the pointer and draws a crosshair the moment a match starts —
  every chassis now carries a turreted weapon on fire slot 0. A different mode with the flag still
  off shows neither.
