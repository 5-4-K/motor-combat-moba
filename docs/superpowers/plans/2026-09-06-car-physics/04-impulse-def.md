# Stage 4: The `ImpulseDef` Seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let any weapon declare a push, move wildcharge's hard slam onto that seam, and dissolve
`SLAM_CONFIG` — so `contact.ts` stops special-casing slams and gets smaller.

**Architecture:** `impulse?: ImpulseDef` is added to `WeaponBase` and `ExplosionDef`, mirroring the
existing optional `applies?: readonly StatusApplication[]` on both. Weapon impulses are applied where
statuses are applied, not inside the contact pass, which already emits the `slams` event this needs.

**Tech Stack:** TypeScript, npm workspaces, Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-06-car-physics-rework-design.md`](../../specs/2026-09-06-car-physics-rework-design.md) (P26–P31)

**Ledger:** [`interfaces.md`](interfaces.md)

**Depends on:** Stages 1–3. `Impulse` and `applyImpulse` exist; the slam already builds an `Impulse`
inline in `contact.ts`; `reeling` exists.

## Global Constraints

Identical to stage 1 — see [`01-vector-drive.md`](01-vector-drive.md#global-constraints). Plus, for
this stage specifically:

- Durations authored in `WEAPON_TABLE` are converted to ticks **once**, in `WEAPON_TICKS`, at module
  load — never per-press.
- Weapon kits are exclusive: no weapon id appears on two chassis.
- Adding a field to `WEAPON_TABLE` moves `balanceStamp`. Stage 5 rebuilds the players' guide; do not
  do it here or the churn will bury the real diff.

---

## Task 1: The `ImpulseDef` type

**Files:**
- Modify: `packages/shared/src/config/weapon-types.ts`
- Modify: `packages/shared/src/config/weapon-ticks.ts`
- Test: `packages/shared/src/config/weapon-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ImpulseDef`; `WeaponBase.impulse?`; `ExplosionDef.impulse?`;
  `WEAPON_TICKS[id].impulse?: { uncontrol: number; wallStunWindow: number; wallStunDuration: number; retriggerImmunity: number }`.

- [ ] **Step 1: Write the failing test**

```ts
describe("ImpulseDef", () => {
  it("converts every authored duration to ticks exactly once", () => {
    const ticks = WEAPON_TICKS.wildcharge.impulse;
    expect(ticks).toBeDefined();
    expect(ticks!.uncontrol).toBe(msToTicks(WEAPON_TABLE.wildcharge.impulse!.uncontrolMs));
  });

  it("leaves rows without an impulse undefined rather than defaulted", () => {
    // Absent must mean absent. A zero-valued default would make every weapon a nudge.
    expect(WEAPON_TICKS.pepperbox.impulse).toBeUndefined();
  });

  it("rejects a non-unit direction mode", () => {
    for (const row of Object.values(WEAPON_TABLE)) {
      if (row.impulse === undefined) continue;
      expect(["radial", "alongAim"]).toContain(row.impulse.direction);
    }
  });

  it("requires a non-negative uncontrol duration on every impulse", () => {
    for (const row of Object.values(WEAPON_TABLE)) {
      if (row.impulse === undefined) continue;
      expect(row.impulse.uncontrolMs).toBeGreaterThanOrEqual(0);
      expect(row.impulse.uncontrolMs).toBeLessThanOrEqual(STATUS_CONFIG.maxDurationMs);
    }
  });

  it("thunderclap declares no impulse at all", () => {
    // Deliberate: it is a weapon whose effect is a status applied on contact, not a contact
    // mechanic. See spec principle C. Do not "fix" this.
    expect(WEAPON_TABLE.thunderclap.impulse).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/config/weapon-config.test.ts -t "ImpulseDef"`
Expected: FAIL — `impulse` is not a property of a weapon row.

- [ ] **Step 3: Add the type**

In `weapon-types.ts`, beside `StatusApplication`:

```ts
/**
 * One push a weapon imparts, and to whom, and how hard. The declarative sibling of `applies`.
 *
 * Ram and weapons derive their impulses completely differently and share only how one LANDS
 * (`applyImpulse`). This type is the *authored* half — fixed numbers a designer writes on a row —
 * while ram builds its `Impulse` from a contest between both cars' `ramAttack`/`ramDefence` (stage
 * 3, spec R1–R9), a side bonus, and a falloff stack (stage 3b, spec P24). Neither derivation
 * constrains the other, which is what keeps ram feel and weapon feel independently tunable. See
 * spec principle D.
 */
export interface ImpulseDef {
  /** Magnitude as a Δv in u/s. Negative pulls the victim toward the source. */
  speed: number;
  /**
   * `"radial"` pushes away from a source point through the victim — the attacker's hull for a
   * contact impulse, the blast centre for an explosion, the impact point for a shell. That source
   * point is DERIVED from the weapon's own geometry and never declared here.
   *
   * `"alongAim"` punches every target the same way instead of splaying them, which is what a
   * shotgun wants.
   */
  direction: "radial" | "alongAim";
  /** Torque scale from the contact-point lever arm. 0 = a clean straight punt, no rotation. */
  spin: number;
  /**
   * Does the target's `ramDefence` reduce this push? **Renamed from `massScaled` (spec R10) — `mass`
   * no longer exists.** Ram: yes, conceptually — a defensive chassis is meant to be harder to shove.
   * A hard slam: no, it punts every chassis identically.
   *
   * The designer's escape hatch, and the place where "weapons get to break physics" becomes a
   * checkbox instead of a special case.
   *
   * **Do not confuse this with the runtime `Impulse.defenceScaled` field ram itself produces.** Ram's
   * own `Impulse`s (`sim/ram.ts`) are always built with `defenceScaled: false`, even though the
   * *concept* above says "ram: yes" — the contest already divides by the victim's own `ramDefence`
   * while computing the impulse's magnitude (spec R5), so letting `applyImpulse` divide a second time
   * would apply it twice. This `ImpulseDef` field is the authored escape hatch for a WEAPON's own
   * fixed push (wildcharge's slam, and any future explosion or shell); it has no reader in `ram.ts`
   * at all. See `03-ram.md`'s Task 2, Step 5 note ("Why `defenceScaled: false` on a ram").
   */
  defenceScaled: boolean;
  /** How long the victim is left `reeling`. Converted to ticks once, in `WEAPON_TICKS`. */
  uncontrolMs: number;
  /** Being driven into level geometry by this push stuns. Omit for an impulse that cannot. */
  wallStun?: { windowMs: number; durationMs: number };
  /** A car pushed by this cannot be pushed by it again within this. */
  retriggerImmunityMs?: number;
}
```

Add `impulse?: ImpulseDef;` to **both** `WeaponBase` and `ExplosionDef`, each documented as optional
with absent meaning "this weapon pushes nothing", exactly as `applies?` is.

> **Deliberately not on this type:** the front/flank/rear side bonus (a positioning reward specific
> to ramming — a weapon has no business caring which face it strikes) and falloff (ram-only, per the
> user's call). Both are one optional field away if that ever changes; neither is wanted now.

- [ ] **Step 4: Convert the durations once**

In `weapon-ticks.ts`, add an `impulse` block to each resolved row, present only when the source row
declares one:

```ts
  impulse:
    def.impulse === undefined
      ? undefined
      : Object.freeze({
          uncontrol: msToTicks(def.impulse.uncontrolMs),
          wallStunWindow: msToTicks(def.impulse.wallStun?.windowMs ?? 0),
          wallStunDuration: msToTicks(def.impulse.wallStun?.durationMs ?? 0),
          retriggerImmunity: msToTicks(def.impulse.retriggerImmunityMs ?? 0),
        }),
```

- [ ] **Step 5: Run and commit**

Run: `npx vitest run packages/shared/src/config/`
Expected: PASS.

```bash
git add packages/shared/src/config/weapon-types.ts packages/shared/src/config/weapon-ticks.ts packages/shared/src/config/weapon-config.test.ts
git commit -m "feat(weapons): add ImpulseDef to WeaponBase and ExplosionDef"
```

---

## Task 2: Author wildcharge, dissolve `SLAM_CONFIG`

**Files:**
- Modify: `packages/shared/src/config/weapon-config.ts`
- Modify: `packages/shared/src/config/slam-config.ts`
- Modify: `packages/shared/src/sim/contact.ts`
- Test: `packages/shared/src/sim/contact.test.ts`

**Interfaces:**
- Consumes: `ImpulseDef` from Task 1.
- Produces: `SLAM_CONFIG` reduced to `{ wallContactPad }`. `SLAM_TICKS` **deleted**.
  `ContactCar` gains `impulse?: ImpulseDef` (resolved from its maneuver weapon), replacing
  `slamsStunned`-adjacent config reads.

- [ ] **Step 1: Author the row**

In `weapon-config.ts`, add to `wildcharge`:

```ts
    impulse: {
      /**
       * Was `SLAM_CONFIG.knockSpeed`, authored as "2x RAM_CONFIG.knockMaxSpeed" — a by-hand
       * relationship, not a derived one, and now doubly stale. `RAM_CONFIG.knockMaxSpeed` itself is
       * gone (deleted with `mass`, spec R1): ram impulses no longer come from a capped speed at all,
       * they come from the `ramAttack`/`ramDefence` contest (R2–R5), whose whole point is to be
       * open-ended rather than saturating (R9). "2x the ram maximum" is not merely a stale number now
       * — it names a quantity ("the ram maximum") that the contest does not produce, since nothing in
       * it saturates. NOTHING FAILS if this is left alone: a 20-second ult can quietly end up weaker
       * than an ordinary flank ram. Stage 5 re-pitches it — against a measured typical/strong contest
       * outcome, not against a maximum that no longer exists. Until then, treat this number as
       * provisional.
       */
      speed: 520,
      direction: "radial",
      /**
       * A clean straight punt, no rotation — deliberate, not an omission. Every other impact in
       * this game now spins the victim via the lever arm, so a slam that does not is inconsistent
       * unless it is understood as the ult's signature: predictable, readable, and yours to aim.
       */
      spin: 0,
      /**
       * A slam punts every chassis identically — unaffected by the target's `ramDefence`. Was
       * `massScaled: false` ("No mass factor, no side bonus"); renamed by spec R10, same meaning.
       */
      defenceScaled: false,
      /** Longer than a full-strength ram's 1000ms (`RAM_CONFIG.ramUncontrolMs`, stage 3b). This is an ult on a 20s cooldown. */
      uncontrolMs: 1400,
      wallStun: { windowMs: 500, durationMs: 500 },
      retriggerImmunityMs: 600,
    },
```

- [ ] **Step 2: Reduce `SLAM_CONFIG`**

Delete `knockSpeed`, `victimAuthority`, `selfKeepFactor`, `wallStunWindowMs`, `wallStunDurationMs`
and `reslamImmunityMs`, along with the whole `SLAM_TICKS` export. What survives:

```ts
/**
 * What remains of hard-slam tuning after the 2026-09-06 physics rework moved every slam-specific
 * number onto `wildcharge`'s own `ImpulseDef`. This one is not a slam property at all — it is how
 * much a hull is inflated when asking "is this touching level geometry", which any impulse with a
 * `wallStun` needs.
 */
export const SLAM_CONFIG = {
  wallContactPad: 1,
} as const;
```

- [ ] **Step 3: Update `contact.ts`**

`ContactCar` gains the resolved def — keeping the module table-free, exactly as `slamsStunned` and
`maneuverWeaponId` already are:

```ts
  /** The `ImpulseDef` behind this car's current maneuver, or undefined when it has none. */
  impulse?: ImpulseDef;
```

The slam branch stops reading `SLAM_CONFIG` and builds its `Impulse` from `attacker.impulse`. The
`tick < slamImmuneUntil` guard now reads the def's `retriggerImmunityMs`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS. `slam-config.test.ts` will have assertions on the deleted fields — remove them; the
behaviour they guarded is now guarded by `weapon-config.test.ts` in Task 1.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/config/ packages/shared/src/sim/contact.ts
git commit -m "refactor(weapons)!: move the hard slam onto wildcharge's ImpulseDef"
```

---

## Task 3: Apply weapon impulses where statuses are applied

**Files:**
- Modify: `packages/shared/src/sim/combat.ts`
- Modify: `packages/server/src/sim/ram-bridge.ts`
- Test: `packages/shared/src/sim/combat.test.ts`

**Interfaces:**
- Consumes: `WEAPON_TICKS[id].impulse`, `applyImpulse`. **Not `reactionOf`** — stage 3 deleted it
  outright (spec R7); there is no equal-and-opposite reaction left anywhere in the sim.
- Produces: nothing new exported. `contact.ts` no longer builds any `Impulse` itself.

- [ ] **Step 1: Write the failing test**

```ts
describe("weapon impulses", () => {
  it("pushes a car hit by a weapon that declares an impulse", () => {
    const out = fireAt("wildcharge", victimAt(640, 300));
    expect(speedOf(out.victim.vx, out.victim.vy)).toBeGreaterThan(0);
  });

  it("leaves a car hit by a weapon that declares none exactly where it was", () => {
    const out = fireAt("pepperbox", victimAt(640, 300));
    expect(out.victim.vx).toBe(0);
    expect(out.victim.vy).toBe(0);
  });

  it("applies reeling for the def's own duration, not the ram's", () => {
    const out = fireAt("wildcharge", victimAt(640, 300));
    expect(out.statusTicks("reeling")).toBe(WEAPON_TICKS.wildcharge.impulse!.uncontrol);
  });

  it("does not run a weapon impulse through the ram falloff stack", () => {
    // Explicitly per the user's call: falloff is ram-only. Two slams in a row both land full.
    const out = fireTwice("wildcharge", victimAt(640, 300));
    expect(out.second.uncontrolTicks).toBe(out.first.uncontrolTicks);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/shared/src/sim/combat.test.ts -t "weapon impulses"`
Expected: FAIL — no weapon impulse is ever applied.

- [ ] **Step 3: Apply the impulse beside the status**

Find where `combat.ts` applies `def.applies` to a damaged target. Immediately beside it, resolve and
emit the impulse. Direction comes from the weapon's geometry, never from the def:

```ts
/**
 * Where a weapon's push points and where it originates. Derived from the weapon's own geometry —
 * the attacker's hull for a contact impulse, the blast centre for an explosion, the impact point
 * for a shell — which is why `ImpulseDef` declares a MODE rather than a vector.
 */
function impulseFrom(def: ImpulseDef, source: Vec2, target: Vec2, aimAngle: number): Impulse {
  const dir =
    def.direction === "alongAim"
      ? { x: Math.cos(aimAngle), y: Math.sin(aimAngle) }
      : normalize({ x: target.x - source.x, y: target.y - source.y });

  return {
    dirX: dir.x, dirY: dir.y,
    speed: def.speed, spin: def.spin, defenceScaled: def.defenceScaled,
    uncontrolTicks: ticksFor(def).uncontrol,
    contactX: target.x, contactY: target.y,
  };
}
```

Emit it on `CombatOutput` alongside the existing status requests so the bridge applies it — combat is
pure and does not write bodies.

- [ ] **Step 4: A weapon's attacker takes nothing — there is no reaction to apply**

**Stale as of revision 2: `reactionOf` does not exist.** An earlier draft of this task gated a
`reactionOf` call on whether the impulse's source was the attacker's own hull versus a detached
explosion (spec P16). R7 deletes that mechanism outright, for rams and for everything else — there is
no equal-and-opposite reaction anywhere in the sim any more, contact or otherwise.

Stage 3's own slam branch (`03-ram.md`, Task 2 Step 6) already establishes the pattern to follow: *"A
slam is authored, not contested, so the attacker takes nothing from it: build a zero-magnitude
impulse rather than skipping the field, so the bridge has one code path."* Apply the same rule here —
a weapon impulse's `attackerImpulse` (wherever this bridge's `ImpulseEntry`-shaped result carries one)
is a zero-magnitude `Impulse`, always, regardless of whether the source was a maneuver's own hull or a
detached explosion. An attacker paying a cost for firing its own weapon is a decision for that
weapon's own author to make explicitly (a separate, future mechanism — e.g. an authored recoil field),
never an automatic physical consequence the way it was under revision 1's equal-and-opposite model.

- [ ] **Step 5: Delete the slam's inline knock-building from `contact.ts`**

This is the payoff. `resolvePair`'s charge branch stops constructing an `Impulse`; it pushes a
`slams` event and nothing else, exactly as its dash branch already does. The whole
`best`/severity-contest apparatus in `contact.ts` now serves rams alone.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sim/ packages/server/src/sim/
git commit -m "feat(weapons): apply declared impulses where statuses are applied"
```

---

## Stage 4 exit criteria

- [ ] `npm test` passes from the repo root.
- [ ] `contact.ts` is shorter than it was at the start of this stage.
- [ ] `SLAM_CONFIG` holds one field; `SLAM_TICKS` is gone.
- [ ] `npm run dev` → Practice as Bastion: wildcharge slams identically regardless of the victim's
      chassis, and does not spin them.
- [ ] Slamming a bot into a wall still stuns it.
- [ ] `thunderclap` behaves exactly as it did before this whole rework began.

**Deliberately not done:** `magmablast` gets no impulse yet. Author one only after the feel is
confirmed in the playground — every row that *can* push is a new way to build an accidental juggle.
