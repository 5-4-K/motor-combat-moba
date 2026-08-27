---
name: create-weapon
description: Use when someone wants to add, create, design, or author a new weapon for this game — a gun, cannon, shotgun, beam, laser, flamethrower, missile, mine, or anything else a car can fire — including when they give only a name or a vibe and expect to be asked for the rest. Also use when putting an existing weapon into a car's loadout, changing which weapons a chassis carries, or re-tuning a weapon's stats.
---

# Create a weapon

Author a new weapon in `WEAPON_TABLE`, give it to a chassis, and leave the repo green and its docs
true. The weapon's design belongs to the person asking — **you elicit it, you do not invent it.**

The rules a weapon's stats are interpreted by live in
[`docs/combat-model.md`](../../../docs/combat-model.md); read its "Authoring a weapon" section and
the sections above it before editing. This skill is the interactive process wrapped around them.

## Step 1 — Elicit the design

Work through every field below and **recommend a value for each**, derived from the archetype they
named and compared against a weapon already in the table. A person saying "shotgun" should be
answering "is 6 pellets right?", not inventing a number from nothing.

Then present the whole proposed row back as a table, with a one-line reason per number, and ask
**one question at a time** about whatever their brief genuinely left open — question 11 is almost
always one of them. Wait for each answer before the next question. Do not edit a file until they
have confirmed the row.

| # | Question | Notes for your recommendation |
|---|---|---|
| 1 | Id and display name | Id is the `WeaponId` union member, lowercase, no spaces |
| 2 | Projectile or beam? | Projectiles travel and freeze at exit; beams grow, linger, and can be welded to the car |
| 3 | Damage, and how often it applies | `damageFrequencyMs: 0` is one hit per target ever; a positive value re-arms on that interval |
| 4 | Speed and range | Together these set flight time — `range ÷ speed`. Compare against `cannon` (900 / 900 = 1 s) |
| 5 | Hitbox shape and size | Projectile: circle radius, or ellipse along/across. Beam: rect width, or cone angle |
| 6 | Cooldown, and stocks | One flat cooldown, or a `stock` block holding charges — see `repeater` |
| 7 | Wind-up and recovery | `startUpMs` delays the shot; `recoveryMs` gates the car's **other** slots |
| 8 | Volley shape (projectiles) | `pelletsPerVolley` + `spreadAngleDeg` for a shotgun; `volleys` + `volleyIntervalMs` for a burst |
| 9 | Pierce (projectiles) | Extra opponents passed through after damaging one; 0 dies on the first |
| 10 | Beam-only: linger and anchoring | `lifetimeMs` after full extension; `attached: true` sweeps with the car |
| 11 | **Which chassis carries it, in which slot** | Ask outright whether it **replaces** an existing weapon or is **added** alongside — never decide this yourself |

Then state the full proposed row back as a table and get a yes before you edit anything. Numbers are
cheaper to change in a message than in five files.

## Step 2 — Make the edits

Six files, in this order. The first four are the weapon; the last two keep the repo honest.

1. **`packages/shared/src/config/weapon-types.ts`** — add the id to the `WeaponId` union. Everything
   else fails to compile until the row exists, which is the point.
2. **`packages/shared/src/config/weapon-config.ts`** — add the row. The union decides which fields
   are writable: `pierce`/`volley` on a projectile, `attached`/`lifetimeMs` on a beam. Every duration
   is **milliseconds** — never write ticks.
3. **`packages/shared/src/config/car-config.ts`** — add the id to that chassis's `weapons` array.
   Array index is the slot index; `maxWeaponSlots` is 3.
4. **`packages/shared/src/config/weapon-slots.test.ts`** — it pins each car's loadout by value, so a
   loadout change fails it by design. Update the assertion in the same edit.
5. **`docs/config-reference.md`** — the `WEAPON_TABLE` and `CAR_TABLE` tables.
6. **`docs/combat-model.md`** — the roster sentence under "## Weapon", *and* any claim your weapon
   just falsified. The test-coverage list there names paths "no shipped weapon exercises"; a beam or
   a multi-pellet weapon makes some of that false. Grep the docs for the mechanic you added.

Validation the row must satisfy (enforced by the per-row loop in `weapon-config.test.ts`):
`unlocksAt >= 1`, positive `damage`/`speed`/`range`, `stock.max >= 2` when present, volley counts
`>= 1`, cone `angleDeg` strictly inside 0–180.

## Step 3 — Verify

```bash
npm run build   # root only — never --workspaces; the server bundle inlines shared's dist
npm test
```

Shared must be rebuilt for the new row to reach a running server, which the root build does.

For a weapon using a mechanic no shipped weapon has used yet — a beam, a multi-pellet volley, a
wind-up, a non-zero recovery — the suites are not enough on their own: those paths have unit tests
but have never run in live play. Drive it through `runCombat` in a scenario test at two or three
ranges and confirm the damage curve matches the archetype you agreed in Step 1.

## Step 4 — Offer an icon

The HUD draws a procedural glyph when a weapon has no art, permanently — the weapon is fully
playable without one. Offer the `process-weapon-icon` skill; do not block on it.

## Common mistakes

| Mistake | Instead |
|---|---|
| Picking the stats yourself because the archetype implies them | Recommend each number, let them confirm it |
| Deciding whether the weapon replaces or joins an existing slot | Question 11 exists for this — ask |
| Editing the table before the design is agreed | State the whole row back, get a yes, then edit |
| Writing tick counts | Author milliseconds; `WEAPON_TICKS` converts once |
| Leaving the loadout test red | It pins loadouts by value; update it in the same edit |
| Leaving a doc claim your weapon just falsified | Grep the docs for the mechanic you introduced |
| `npm run build --workspaces` | Root `npm run build` — order matters |
