# Shockwave, Fury Horn, Taurus & Weapon Impulse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two weapons (`shockwave`, `fury-horn`), activate chassis `taurus` with a new kit, move `tremor` onto Bastion and `wildcharge` (renamed "Raging Bull") onto Taurus, and add a one-shot on-hit impulse usable by every weapon kind, giving `tremor` an inward pull.

**Architecture:** All balance lives in base `config/` globals, inherited by every mode. Two new `WeaponDef` rows and the `CAR_TABLE` edits are config. The impulse feature is a server-only addition to `runCombat`'s per-hit loop that reuses the existing pure `applyImpulse`; the only new sim math is a per-instance-kind radial source point. Looks are a client render pass. Each phase refreshes the artifacts it invalidates (snapshots, turn-tuning doc, generated manual) so every phase ends with `npm test` green.

**Tech Stack:** TypeScript, npm workspaces (`@motor-combat-moba/shared|server|client`), Vitest, Colyseus schema, Phaser 4 client.

**Spec:** This plan is the spec — the design was settled in the originating session. Key references: `packages/shared/src/config/weapon-types.ts` (the `WeaponDef` union, `ImpulseDef`), `packages/shared/src/sim/impulse.ts` (`applyImpulse`), `packages/shared/CLAUDE.md` and root `CLAUDE.md` (per-mode config, the owed-artifacts rules).

## Global Constraints

- **Per-mode config:** edit the base globals in `packages/shared/src/config/`; both shipped modes inherit them (neither overrides `cars`/`weapons` today). Every base edit moves **all four** mode snapshots — accept with `vitest -u` scoped to the moved files, never a blanket `-u`.
- **Weapon exclusivity (L1):** no weapon id appears on two chassis, active or inactive. `weapon-slots.test.ts` enforces it.
- **Enum/id stability (invariant 7):** never renumber. New `WeaponId` members are added, never reorder existing.
- **Shared is consumed as built `dist` (invariant 9):** after any `config/` edit run `npm run build -w @motor-combat-moba/shared` before a live room sees it; tests import `src` and do not need it.
- **Rebuild with root `npm run build`** (shared→server→client order), never `--workspaces`.
- **No model identifier** in any committed artifact (commit messages, code, docs).
- **Weapon colours** must be clear of the six `COLOR_TABLE` player hexes and dark enough to read on light floors (`weapon-config.test.ts` checks the first).
- **`impulse` application is server-only** (runCombat is server-only); the resulting velocity change reaches clients via snapshot reconciliation exactly as a ram does. Nothing new crosses the wire, so invariant 8 holds (no new schema field).

## Review Focus

- **Multi-volley beam (dormant path):** `shockwave` is the first row in the build to author `volleys: 3`. A single press must spawn exactly three disc instances 500 ms apart, each its own instance with its own damage clock. Pinned in Task 1's fire test.
- **Stock weapon (dormant path):** `fury-horn` is the first row to author `stock`. Starts at 1 (spawn default), refills one per `cooldownMs` to `max: 3`, and `refireDelayMs: 300` gates consecutive stock shots. Pinned in Task 1's fire test.
- **Non-overlapping rings:** with `range 180`, `speed 400`, `lifetimeMs 0`, one ring lives 450 ms; the next spawns at 500 ms, so at most one ring is alive at a time. Pinned in Task 1's instance test.
- **Impulse once per victim per instance:** a *ticking* beam (tremor, 400 ms damage clock) damages a held car repeatedly but must impulse it **once** on first entry, never again for that instance. Re-entry of the same instance does not re-pull. Pinned in Task 4's combat test.
- **Impulse guard relaxation doesn't leak to basic attacks:** the nine `basic-attack-*` rows must stay impulse-free; relaxing the maneuver-only guard must not let them (or any pure bolt) silently carry one. Pinned in Task 4's config test.

---

## Task 1: Two new weapons — `shockwave` and `fury-horn`

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts` (add two `WeaponId` members)
- Modify: `packages/shared/src/config/weapon-config.ts` (two `WEAPON_TABLE` rows)
- Test: `packages/shared/src/config/weapon-config.test.ts`, `packages/shared/src/sim/weapons/fire.test.ts`, `packages/shared/src/sim/weapons/instances.test.ts`
- Update: `packages/shared/src/modes/__snapshots__/*.tables.json` (via `vitest -u`)

**Interfaces:**
- Produces: `WeaponId` gains `"shockwave" | "fury-horn"`; `WEAPON_TABLE.shockwave` (a `BeamWeaponDef`) and `WEAPON_TABLE["fury-horn"]` (a `ProjectileWeaponDef`). Both uncarried at the end of this task (legal, like `tremor`).

- [ ] **Step 1: Write failing fire/instance tests**

In `fire.test.ts`: `"fury-horn starts with one stock, refills to three, and gates refire at 300ms"` — spawn a slot carrying `fury-horn`, assert `stocks === 1` at spawn; advance `cooldownMs` ticks, assert `stocks` climbs by one each interval to `3` and stops; fire twice within 300 ms and assert the second press is refused by the refire lock.

In `fire.test.ts`: `"shockwave fires three beam volleys 500ms apart from one press"` — one press, assert three instances emit at 0 / 500 / 1000 ms, each with its own `spawnTick`.

In `instances.test.ts`: `"a shockwave ring grows to 180u in 450ms and dies before the next spawns"` — step one ring, assert `extent` reaches `range` at `range/speed` and `alive` flips false by 450 ms (`lifetimeMs 0`), so no two rings overlap at the 500 ms cadence.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -w @motor-combat-moba/shared -- fire.test.ts instances.test.ts`
Expected: FAIL — `shockwave` / `fury-horn` not in `WeaponId`.

- [ ] **Step 3: Add the two ids to the `WeaponId` union**

In `weapon-types.ts`, add `| "shockwave"` and `| "fury-horn"` to the union (after `tremor`, before the basic-attack ids). Fix every resulting compile error — these are exhaustive `WEAPON_TABLE` / switch sites the compiler now flags.

- [ ] **Step 4: Author the two rows in `WEAPON_TABLE`**

`shockwave` (`BeamWeaponDef`): `kind: "beam"`, `name: "Shockwave"`, `color: "#2F6BFF"`, `unlocksAt: 1`, `damage: 30`, `damageFrequencyMs: 0`, `speed: 400`, `range: 180`, `startUpMs: 0`, `cooldownMs: 5000`, `recoveryMs: 0`, `hitbox: { shape: "disc" }`, `attached: true`, `origin: "center"`, `lifetimeMs: 0`, `volley: { volleys: 3, volleyIntervalMs: 500 }`, `applies: [{ statusId: "spiked", target: "opponents", durationMs: 600, onWave: "all" }]`.

`fury-horn` (`ProjectileWeaponDef`): `kind: "projectile"`, `name: "Fury Horn"`, `color: "#C0C8D0"`, `unlocksAt: 1`, `damage: 50`, `damageFrequencyMs: 0`, `speed: 600`, `range: 900`, `startUpMs: 0`, `cooldownMs: 1000`, `recoveryMs: 0`, `hitbox: { shape: "ellipse", radiusAlong: 8, radiusAcross: 16 }`, `pierce: 0`, `stock: { max: 3, refireDelayMs: 300 }`, `volley: { volleys: 1, volleyIntervalMs: 0 }`, `pellets: { pelletsPerVolley: 1, spreadAngleDeg: 0 }`.

Neither authors `impulse` (that is Task 4). Neither is carried yet.

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test -w @motor-combat-moba/shared -- fire.test.ts instances.test.ts weapon-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Refresh snapshots (base weapon table moved every mode)**

Run: `npm test -w @motor-combat-moba/shared -- snapshots.test.ts` → expect FAIL (every `*.tables.json` moved). Then `npx vitest -u run src/modes/snapshots.test.ts` from `packages/shared`. Re-run without `-u`, expect PASS. Review the four diffs show only the two added rows.

- [ ] **Step 7: Build shared, then full shared suite**

Run: `npm run build -w @motor-combat-moba/shared && npm test -w @motor-combat-moba/shared`
Expected: PASS. (A `manual-page`/stamp failure here belongs to Task 5 only if these weapons were carried — they are not — so the shared suite should be clean.)

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/config/weapon-types.ts packages/shared/src/config/weapon-config.ts packages/shared/src/sim/weapons/*.test.ts packages/shared/src/modes/__snapshots__
git commit -m "feat(weapons): add shockwave (3-ring disc beam) and fury-horn (3-stock lens)"
```

---

## Task 2: Kit + roster — tremor→Bastion, wildcharge→Taurus (Raging Bull), activate Taurus

**Files:**
- Modify: `packages/shared/src/config/car-config.ts` (Bastion kit; Taurus `isActive`, `weapons`, stats)
- Modify: `packages/shared/src/config/weapon-config.ts` (`wildcharge.name`)
- Modify: `packages/server/src/config/bot-profiles.ts` (`BOT_BRAIN_VERSION`, currently `"6.3.0"` at line ~819) — version bump
- Modify: `docs/turn-tuning.md` (Taurus column in the three tables, per active mode)
- Regenerate: `packages/client/public/manual.html` (via `npm run build:manual`)
- Update: `packages/shared/src/modes/__snapshots__/*.tables.json` (via `vitest -u`)
- Test: `packages/shared/src/config/weapon-slots.test.ts`, `packages/shared/src/modes/invariants.test.ts`, `scripts/turn-tuning-doc.test.mjs`, `scripts/manual-page.test.mjs`

**Interfaces:**
- Consumes: `tremor`, `wildcharge`, `shockwave`, `fury-horn` rows from Task 1 and the base table.
- Produces: `CAR_TABLE.bastion.weapons = ["thumper", "roadblock", "tremor"]`; `CAR_TABLE.taurus` active with `weapons = ["fury-horn", "shockwave", "wildcharge"]` and new ratings; `WEAPON_TABLE.wildcharge.name = "Raging Bull"` (id unchanged).

- [ ] **Step 1: Write/adjust failing kit + activation assertions**

In `weapon-slots.test.ts`, there are **two** hardcoded Bastion kit assertions — update **both** to `["thumper", "roadblock", "tremor"]`:
- the `CAR_TABLE.bastion.weapons` `.toEqual([...])` in `"gives each chassis the kit its type calls for"` (~line 40), and
- the `slotsOf("bastion")` `.toEqual([...])` in `"returns the car's list in slot order"` (~line 72).

In the same `"gives each chassis the kit its type calls for"` test, add `expect(CAR_TABLE.taurus.weapons).toEqual(["fury-horn", "shockwave", "wildcharge"])`. The existing exclusivity test (`"shares no weapon between two chassis"`, ~line 43) and active-count test (`"gives every ACTIVE car between one and the ceiling's worth of weapons"`, ~line 18) now cover Taurus automatically — run them, don't rewrite them.

Add an assertion (in whichever test holds the active roster) that `activeCarIds()` now includes `"taurus"`.

- [ ] **Step 2: Run, verify fail**

Run: `npm test -w @motor-combat-moba/shared -- weapon-slots.test.ts`
Expected: FAIL (kits/activation not yet changed).

- [ ] **Step 3: Edit `CAR_TABLE`**

Bastion: `weapons: ["thumper", "roadblock", "tremor"]`.
Taurus: `isActive: true`, `weapons: ["fury-horn", "shockwave", "wildcharge"]`, `speed: 58`, `accel: 33`, `handling: 58`, `attack: 52`, `hp: 80`, `ramAttack: 62`, `ramDefence: 70`, `brakeDecel: 430` (unchanged).

- [ ] **Step 4: Rename wildcharge (display only)**

In `weapon-config.ts` set `WEAPON_TABLE.wildcharge.name = "Raging Bull"`. Leave `id: "wildcharge"` and every reference untouched.

- [ ] **Step 5: Bump `BOT_BRAIN_VERSION`**

The kit change and the new active chassis change the bot's reach model, so the fingerprint must move even though bot *tuning* is deferred to a later session. In `packages/server/src/config/bot-profiles.ts`, change `BOT_BRAIN_VERSION` from `"6.3.0"` to `"6.4.0"`. (Bot profile/behaviour work is explicitly out of scope for this plan.)

**Expect server-side ripples from moving wildcharge off Bastion.** Fixtures and matrices that assume Bastion's kit — `packages/server/src/bot/brain/duel.fixture.ts`, `scripts/ttk.mjs`, and `packages/server/balance/` seat filters/DPS expectations (CLAUDE.md notes Bastion's sustained-DPS ceiling figure) — may now carry stale expectations. These are resolved by **updating the expectation to the new kit**, never by reverting the roster change. Task 2's full `npm test` (Step 10) is where they surface.

- [ ] **Step 6: Run sim suite, fix exclusivity/invariants**

Run: `npm test -w @motor-combat-moba/shared -- weapon-slots.test.ts invariants.test.ts`
Expected: PASS. If `invariants.test.ts` flags Taurus's `maxPlayers`/kit-length, resolve per the invariant (kit length 3 ≤ N).

- [ ] **Step 7: Refresh snapshots**

Run `npx vitest -u run src/modes/snapshots.test.ts` in `packages/shared`; re-run without `-u` → PASS. Diffs should show Bastion's kit, Taurus's row, and the wildcharge name across the modes that render them.

- [ ] **Step 8: Update `docs/turn-tuning.md` and pass its test**

Add a Taurus column to each of the three tables, under every active mode's `##` heading, using the derived-value snippet in the page's "Keeping this page honest" section (do not hand-type derived cells). Also fix the now-stale **prose** that lists Taurus as an inactive prototype (the "placeholder STAT CLONE … Taurus, Anvil and Caprico of Bastion" sentence) — Taurus is active now; the test can't see prose, so this is on you. Run: `npm run test:scripts -- turn-tuning-doc.test.mjs` (or `node --test scripts/turn-tuning-doc.test.mjs`). Expected: PASS, naming no mismatched Taurus cell.

- [ ] **Step 9: Rebuild the manual and pass its stamp test**

Run: `npm run build:manual`, then `npm run test:scripts -- manual-page.test.mjs`. Expected: PASS (the stamp now matches: Taurus published, Bastion's kit changed, Raging Bull's name). Commit the regenerated `manual.html`.

- [ ] **Step 10: Build shared + full shared suite**

Run: `npm run build -w @motor-combat-moba/shared && npm test`
Expected: PASS across all three packages.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/config/car-config.ts packages/shared/src/config/weapon-config.ts packages/shared/src/config/*bot* packages/shared/src/modes/__snapshots__ docs/turn-tuning.md packages/client/public/manual.html packages/shared/src/config/weapon-slots.test.ts
git commit -m "feat(roster): activate Taurus, move tremor to Bastion, wildcharge to Taurus as Raging Bull"
```

---

## Task 3: Looks — shockwave ring, fury-horn lens glow

**Files:**
- Modify: `packages/client/src/scenes/combat-visual.ts` (the three style tables — `BeamStyle` for shockwave, `GlowStyle` for fury-horn)
- Test: `combat-visual` unit tests if present; otherwise visual verification in-app

**Interfaces:**
- Consumes: `shockwave` / `fury-horn` `weaponId`s and their `color`s from Task 1.

**Sub-skill:** Use the `weapon-look` skill to author both looks; respect its inside-the-hitbox rule and the per-frame cost budget in `packages/client/CLAUDE.md`.

- [ ] **Step 1: Author shockwave's beam look** — a hollow expanding **ring outline + wash**, not a filled disc fill, tinted `#2F6BFF`. The hitbox stays the filled disc from Task 1; this is draw-only. (Reference: the combat-visual comment that old shockwave "was drawn as a ring and a wash".)

- [ ] **Step 2: Author fury-horn's projectile look** — a **lens silhouette**, convex face toward travel, with a **glowy white core and silver outer ramp** (`GlowStyle`, same mechanism as magmablast's fireball ramp).

- [ ] **Step 3: Verify look cost** against the per-frame budget; confirm neither look allocates per-frame or exceeds the shot-detail allowance.

- [ ] **Step 4: Build client and eyeball both** — `npm run build -w @motor-combat-moba/client`; load a playground seat carrying each weapon and confirm the ring reads as a ring and the lens reads white-cored. (No stamp impact: look tables are client render, not hashed by `balanceStamp`.)

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/scenes/combat-visual.ts
git commit -m "feat(fx): shockwave ring-and-wash look, fury-horn white-core lens glow"
```

---

## Task 4: One-shot impulse for all weapon kinds, and tremor's inward pull

**Files:**
- Create: `packages/shared/src/sim/weapons/impulse-source.ts` (per-instance radial source)
- Modify: `packages/shared/src/sim/combat.ts` (apply impulse in the per-hit loop)
- Modify: `packages/shared/src/sim/weapons/hits.ts` or the `WeaponInstance` type (add server-only `impulsedVictims`)
- Modify: `packages/shared/src/config/weapon-config.ts` (`tremor.impulse`)
- Modify: `packages/shared/src/config/weapon-config.test.ts` (relax the maneuver-only guard)
- Test: `packages/shared/src/sim/weapons/impulse-source.test.ts`, `packages/shared/src/sim/combat.test.ts`, `weapon-config.test.ts`
- Update: snapshots (`vitest -u`), manual rebuild (tremor now Bastion-carried → stamp moves)

**Interfaces:**
- Consumes: `applyImpulse(body, ramDefence, imp): SimBody` and the `Impulse` struct from `sim/impulse.ts`; the resolved `WeaponTicks.impulse` from `weapon-ticks.ts` (already converts `impulse` for any kind); the per-hit loop in `combat.ts` (`for (const hit of outcome.damaged)`).
- Produces: `radialSourceOf(instance): { x: number; y: number }` and, for a victim, the direction and contact point feeding a built `Impulse`; `tremor` carries an `ImpulseDef`.

- [ ] **Step 1: Write failing source-helper tests**

In `impulse-source.test.ts`:
- `"a beam cone/rect sources the perpendicular foot on its fire axis"` — a beam instance at origin O with fire `angle`, a victim off-axis; assert `radialSourceOf` returns the foot of the perpendicular from the victim onto the axis line O+t·dir. (So `radial` with **negative speed** pulls the victim toward the axis — the centerline pull.)
- `"a disc beam sources its own centre"` — assert the disc's centre (its origin point) is returned.
- `"a projectile/explosion sources its muzzle/blast origin"` — assert the instance's own position is returned.

- [ ] **Step 2: Write failing combat integration tests**

In `combat.test.ts`:
- `"tremor pulls a caught car toward the cone axis once, on first entry"` — place a car inside a live tremor instance; after the tick, assert the car's `vx/vy` changed by `~speed` toward the axis foot and `angVel` unchanged (`spin 0`).
- `"tremor does not re-pull a car it keeps damaging"` — hold the car in the zone across two damage ticks (400 ms apart); assert the impulse applied on the first damage only; velocity is nudged once, not twice, by the pull.
- `"a car that leaves and re-enters the same tremor instance is not pulled again"` — assert no second impulse for the same instance.

- [ ] **Step 3: Write failing guard-relaxation test**

In `weapon-config.test.ts`, replace the maneuver-only assertion (`def.impulse !== undefined → kind === "maneuver"`) with: an `impulse` is legal on `kind` in `{maneuver, projectile, beam}` and on `ExplosionDef`; the nine `basic-attack-*` rows and every plain bolt remain `impulse === undefined` (keep the `plainBolts()` check). Keep the existing `applies`/duration-bound validations for every row that has an `impulse`.

- [ ] **Step 4: Run, verify all fail**

Run: `npm test -w @motor-combat-moba/shared -- impulse-source.test.ts combat.test.ts weapon-config.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement `radialSourceOf` + the direction/contact derivation**

In `impulse-source.ts`: projectile/explosion → instance position; beam `disc` → instance origin/centre; beam `rect`/`cone` → perpendicular foot of the victim onto the fire axis (point-to-line projection from stored origin + `angle`). Return the source point; the caller builds the `Impulse` direction as `normalize(victim − source)` (so negative `speed` pulls inward), with `contactX/Y` = victim centre (spin stays 0 for tremor; lever-arm only matters for a non-zero-spin future row).

- [ ] **Step 6: Add the one-shot guard and the combat hook**

Add a server-only `impulsedVictims: Set<string>` to the `WeaponInstance` (mirror `damageClock`: not networked; runCombat is server-only). In `combat.ts`, inside the `for (const hit of outcome.damaged)` loop, after `applyOpponentStatuses`: if the weapon has a resolved `impulse` and `!impulsedVictims.has(hit.sessionId)`, build the `Impulse` (Step 5), call `applyImpulse(target, ramDefenceOf(target), imp)`, write back `target.vx/vy/angVel`, apply the impulse's `applies` statuses server-side (reuse `ram-bridge.ts`'s status-application pattern; `uncontrolTicks` from the resolved ticks — `0` for tremor), then add the victim to `impulsedVictims`. `onWallImpact` stays out of this path (maneuver-only, per spec).

- [ ] **Step 7: Author `tremor.impulse`**

`impulse: { speed: -260, direction: "radial", spin: 0, defenceScaled: false, applies: [] }`. (Negative speed + beam axis source = inward pull to the centerline. `-260` is half of wildcharge's `520`; note it is a strong single yank, tune later if it over-performs.)

- [ ] **Step 8: Run the three test files, verify pass**

Run: `npm test -w @motor-combat-moba/shared -- impulse-source.test.ts combat.test.ts weapon-config.test.ts`
Expected: PASS.

- [ ] **Step 9: Refresh snapshots + rebuild manual**

`tremor` now carries an impulse and is Bastion-carried (active) → base table moved and the manual stamp moved. Run `npx vitest -u run src/modes/snapshots.test.ts` (review diffs = tremor's impulse only), then `npm run build:manual` and `npm run test:scripts -- manual-page.test.mjs`.

- [ ] **Step 10: Build + full suite + playtest flag**

Run: `npm run build && npm test`. Expected: PASS. **Then state loudly in the task summary:** the contact/impulse surface changed — `tremor` now pushes, and projectiles/beams/explosions *can* push — so the playtest probes measuring contact should be re-run (`npm run playtest -- --scope=all`); recommend the run, do not silently edit probes.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/sim/weapons/impulse-source.ts packages/shared/src/sim/combat.ts packages/shared/src/sim/weapons/hits.ts packages/shared/src/config/weapon-config.ts packages/shared/src/config/weapon-config.test.ts packages/shared/src/sim/weapons/*.test.ts packages/shared/src/modes/__snapshots__ packages/client/public/manual.html
git commit -m "feat(sim): one-shot on-hit impulse for all weapon kinds; tremor pulls inward"
```

---

## Task 5: Authoritative manual rebuild + full verification

**Files:**
- Regenerate: `packages/client/public/manual.html`
- Verify only (no new source)

- [ ] **Step 1: Final manual rebuild** — `npm run build:manual`; confirm the page shows Taurus's tab/kit, Bastion's new kit, Raging Bull's name, and that `tremor`/`shockwave`/`fury-horn` read correctly. (Icons are expected to warn/fall back to glyphs — no art imported; same as `tremor` today.)

- [ ] **Step 2: Full build + full suite** — `npm run build && npm test`. Expected: PASS everywhere, including `manual-page.test.mjs` and `turn-tuning-doc.test.mjs`.

- [ ] **Step 3: Full-scope playtest (recommend to user)** — recommend `npm run playtest -- --scope=all` and a balance pass; these are the user's call to run and read, not a plan step to assert on.

- [ ] **Step 4: Commit any regenerated manual delta**

```bash
git add packages/client/public/manual.html
git commit -m "chore(manual): authoritative rebuild for new roster and weapons"
```

- [ ] **Step 5: Push** — `git push -u origin development/main` (retry with backoff on network error).

---

## Deferred (explicitly out of scope)

- **Bot tuning / profiles** — separate session, per the user. This plan only bumps `BOT_BRAIN_VERSION` so fingerprints stay honest; it does not retune `BOT_PROFILES` or teach the bot the new weapons.
- **Weapon HUD icons** for `shockwave` / `fury-horn` — not imported; glyph fallback is expected and `check:weapons` will warn, as it does for `tremor`.
- **Refining the projectile/explosion radial source** from "muzzle for now" to something shape-specific — deferred; no shipping projectile/explosion carries an impulse yet, so the path is built and unit-tested but unexercised by the roster.
- **Balance** of Taurus (mid-on-every-axis) and tremor's `-260` pull — a harness question for after the branch lands.
