---
name: weapon-forger
description: Use when someone wants to add, create, design, or author a new weapon for this game — a gun, cannon, shotgun, beam, laser, flamethrower, missile, mine, or anything else a car can fire — including when they give only a name or a vibe and expect to be asked for the rest. Also use when re-tuning, rebalancing, buffing, or nerfing a weapon that already exists, changing its damage, range, cooldown, spread or hitbox, or changing which weapons a chassis carries.
---

# Weapon forger

Two jobs: **forge** a weapon that does not exist yet, or **re-tune** one that does. Both start the
same way — the design belongs to the person asking, so you recommend numbers and they confirm them.
**You do not invent stats and you do not decide loadouts.**

The rules a weapon's stats are interpreted by live in
[`docs/combat-model.md`](../../../docs/combat-model.md). Read its "Authoring a weapon" section and
the sections above it before editing. This skill is the process wrapped around them.

| They want | Path |
|---|---|
| A weapon that does not exist yet | A — Forge |
| Different numbers on an existing weapon | B — Re-tune |
| An existing weapon on a different chassis | B, loadout part only |

## Both paths — agree the numbers first

Recommend a value for **every** field in play, derived from the archetype they named and compared
against a weapon already in the table. Someone saying "shotgun" should be answering "is 6 pellets
right?", not inventing a number from nothing. Someone saying "a bit more reach" should be confirming
"+20%, so 1080?" — a vague brief is a question, not permission to pick.

Present the proposal as a table with a one-line reason per number, then ask **one question at a
time** about whatever their brief genuinely left open. Wait for each answer. **Do not edit a file
until they have confirmed the numbers.**

## Path A — Forge a new weapon

Fields to recommend, in order. Stop early once nothing is undetermined.

| # | Field | Notes for your recommendation |
|---|---|---|
| 1 | Id and display name | Id is the `WeaponId` union member, lowercase, no spaces |
| 2 | Projectile or beam | Projectiles travel and freeze at exit; beams grow, linger, can weld to the car |
| 3 | Damage, and `damageFrequencyMs` | 0 is one hit per target ever; positive re-arms on that interval |
| 4 | Speed and range | Together they set flight time — `range ÷ speed`. `magmablast` is 900/900 = 1 s |
| 5 | Hitbox | Projectile: circle radius, ellipse along/across, or capsule along/across (rounded nose, flat tail; needs along >= across). Beam: rect width, cone angle, or disc |
| 6 | Cooldown, and stocks | A flat `cooldownMs`, or a `stock` block holding charges. No shipped row currently authors one — stocks are dormant machinery, still real in `fire.ts` (the retired `needler` was the one example). Note what stocks actually buy: the recharge starts at the **first** shot of a dump, so a magazine moves damage earlier without costing sustained DPS |
| 7 | Wind-up and recovery | `startUpMs` delays the shot; `recoveryMs` gates the car's **other** slots |
| 8 | `volley` — **both kinds** | `volleys` + `volleyIntervalMs`, on `WeaponBase`. A **beam** can burst too: `shockwave` is three aura waves 500 ms apart, each its own instance with its own `spawnTick` and damage clock. A single shot is `{ volleys: 1, volleyIntervalMs: 0 }` |
| 8b | `pellets` (projectiles only) | `pelletsPerVolley` + `spreadAngleDeg` for a shotgun fan. Split off `VolleyDef` deliberately, so a beam never has to author `pelletsPerVolley: 1` |
| 9 | Pierce (projectiles) | Extra opponents passed through after damaging one; 0 dies on the first |
| 10 | Beam only | `lifetimeMs` after full extension; `attached: true` sweeps with the car |
| 11 | Targeting — `usesAimAssist` | Required, no default. `true` fires at the car's ambient lock instead of its heading; ask whether this weapon should feel assisted (like `predator`) or purely manual (like `roadblock`) — this is the whole reason the field is required rather than optional |
| 12 | `color` | The `#RRGGBB` its shots draw in — per weapon, never per player. Must be unique among weapons, must not be a `COLOR_TABLE` player colour, and must read against a light floor |
| 12 | **Which chassis, which slot** | Ask outright whether it **replaces** an existing weapon or is **added** alongside — never decide this |

Then edit six files, in this order:

1. **`config/weapon-types.ts`** — add the id to the `WeaponId` union. Nothing else compiles until
   the row exists, which is the point.
2. **`config/weapon-config.ts`** — the row. The union decides which fields are writable:
   `pierce`/`pellets` on a projectile, `attached`/`lifetimeMs` on a beam, and `volley` on **both**
   because it lives on `WeaponBase`. Durations are **milliseconds** — never write ticks. If the
   weapon applies a status and is multi-wave, `StatusApplication.onWave` (`"all" | "final"`, absent
   means `"all"`) decides whether the status rides every wave or only the last — `shockwave`'s
   `corroded` is `"final"`, so the first two waves are the commitment and the debuff is the payoff.
3. **`config/car-config.ts`** — add the id to that chassis's `weapons` array. Index is the slot;
   `maxWeaponSlots` is 3.
4. **`config/weapon-slots.test.ts`** — it pins each car's loadout by value, so a loadout change
   fails it by design. Update it in the same edit.
5. **`docs/config-reference.md`** — the `WEAPON_TABLE` and `CAR_TABLE` tables.
6. **`docs/combat-model.md`** — the roster sentence under "## Weapon", **and any claim your weapon
   falsifies**. Its coverage list names paths that are still only *tested* through a borrowed row;
   a weapon that exercises one for real makes that entry untrue. Grep the docs for the mechanic you
   introduced.
7. **The players' guide** — run `npm run build:manual` and commit
   `packages/client/public/manual.html`. It is generated from the tables but committed, so a new
   weapon does not reach players on its own. See "Rebuild the guide" below.

Validation the row must satisfy: `unlocksAt >= 1`, positive `damage`/`speed`/`range`,
`stock.max >= 2` when present, volley counts `>= 1`, cone `angleDeg` strictly inside 0–180, a
`color` that is a unique `#RRGGBB` and not a player colour, and `usesAimAssist` set. If
`usesAimAssist` is `true`: `range` must be at least `AIM_CONFIG.lockRange`, and the weapon's
sustained fire rate (`1000 / cooldownMs`) must sit outside ±15% of the
`1000 / AIM_CONFIG.lockTimeoutMs` behavioural cliff.

## Path B — Re-tune an existing weapon

The weapon already has an id and a union entry. Skip straight to the numbers.

Edit `config/weapon-config.ts`, then `docs/config-reference.md`. Touch `config/car-config.ts` and
`config/weapon-slots.test.ts` **only** if the loadout is changing. Either way you still owe the
players' guide a rebuild — see "Rebuild the guide" below.

**Then expect guard tests to fail, and read each failure before touching it.** Several tests read the
real table at run time and hard-code numbers derived from it, so a re-tune breaks them on purpose or
by accident — the suite is how you find out which:

| File | Why it breaks |
|---|---|
| `config/weapon-config.test.ts` | Pins `magmablast`'s stats digit-for-digit — the per-row zero-balance-change guard |
| `config/weapon-config.test.ts` | "keeps aim-assist weapons off the behavioural cliff" — an aim-assist weapon's sustained rate (`1000 / cooldownMs`) must stay outside ±15% of `1000 / AIM_CONFIG.lockTimeoutMs` |
| `config/weapon-ticks.test.ts` | Pins the tick counts derived from them (`cooldown`, `flight`) |
| `sim/weapons/fire.test.ts` | Simulates recharge tick-by-tick across a hard-coded window |
| `sim/weapons/instances.test.ts` | Beam tests hand-build a synthetic beam over `magmablast`'s numbers rather than reading a real beam row like `afterburner` |
| `sim/combat.test.ts` | Its `50.5` fixture is derived from hitbox radius — only if you change the hitbox |

A failure here is usually the guard doing its job, not a bug: update the assertion in the same
commit. If a test fails for a reason you cannot explain from your own change, stop and say so.

**Retuning `cooldownMs` on an aim-assist weapon can walk it onto the cliff even without
intending to.** The cliff sits at `1000 / AIM_CONFIG.lockTimeoutMs` (1.25 Hz today); a guard rejects
any sustained rate within 15% of it — the band runs 696–941 ms, which is why `thumper` (an aim-assist
row) ships at 3000 ms rather than the 900 ms first drafted for it. Check the new `cooldownMs` against
the cliff before proposing the number, not after the test fails.

**One stat reaches other weapons.** `recoveryMs` gates how soon that car's **other** slots may fire.
Raising it on one weapon slows down every other weapon on any chassis carrying it — say so out loud
before changing it.

## Rebuild the guide — both paths

```bash
npm run build:manual   # then commit packages/client/public/manual.html
```

`packages/client/public/manual.html` is the cars-and-weapons guide the join screen opens. It prints
each weapon's damage, recharge, reach, hitbox, lock-on and derived DPS, plus each chassis's kit — so
**every** number you just agreed appears on it, and so does a loadout move. It is generated from the
tables but **committed**, which means nothing rebuilds it for you: skip this and players read the
numbers you just replaced.

You do not have to remember: the page carries a fingerprint of the tables and the manual's prose, and
`scripts/manual-page.test.mjs` recomputes it, so a stale page fails `npm test` naming this command.
Do not hand-edit the page. It is generated; the fix for a wrong number on it is the table, and the
fix for wrong wording is `scripts/cars-and-weapons-copy.mjs`.

Art is the one thing that does **not** need this: the page links `public/art/`, so an icon added
after the fact shows up on its own.

## Verify — both paths

```bash
npm run build   # root only — never --workspaces; the server bundle inlines shared's dist
npm test
```

Then confirm the running server would actually see the change, rather than a stale `dist`:

```bash
grep -c "<a new or changed value>" packages/server/dist/index.js
```

For a genuinely new mechanic — one this table has never shipped, unlike beams, multi-pellet volleys,
wind-ups and non-zero recovery, which all ship today (see `afterburner`, `pepperbox`, `lance`) — the
suites are not enough alone: a path with only unit tests has never run in live play.
Drive it through `runCombat` in a scenario test at two or three ranges and check the damage curve
matches what you agreed.

## Icon — forge only

The HUD draws a procedural glyph when a weapon has no art, permanently, so a weapon is fully playable
without one. Offer the `process-weapon-icon` skill; do not block on it.

## Common mistakes

| Mistake | Instead |
|---|---|
| Picking stats yourself because the archetype implies them | Recommend each number, let them confirm |
| Reading "a bit more reach" as permission to choose | It is a question — propose a figure and ask |
| Deciding whether a weapon replaces or joins a slot | Path A question 11 — ask |
| Walking a re-tune through the id and union steps | Path B starts at the numbers |
| Assuming only the two config tests guard a re-tune | Four files hard-code table values; run the suite |
| Writing tick counts | Author milliseconds; `WEAPON_TICKS` converts once |
| Leaving a doc claim the new weapon falsified | Grep the docs for the mechanic you introduced |
| Shipping numbers the players' guide still contradicts | `npm run build:manual`, commit the page |
| Hand-editing `manual.html` to match | It is generated — fix the table or the copy, then rebuild |
| `npm run build --workspaces` | Root `npm run build` — order matters |
