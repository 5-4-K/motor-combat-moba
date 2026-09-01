import { describe, expect, it } from "vitest";
import { CAR_TABLE } from "./car-config.js";
import { COLOR_TABLE } from "./color-config.js";
import type { CarId } from "./types.js";
import { WEAPON_TABLE, isWeaponId, weaponDefOf } from "./weapon-config.js";
import { slotsOf } from "./weapon-slots.js";
import type { WeaponDef } from "./weapon-types.js";
import { AIM_CONFIG } from "./aim-config.js";

describe("WEAPON_TABLE", () => {
  it("pins the overhaul roster's load-bearing numbers (spec 2026-09-01)", () => {
    expect(WEAPON_TABLE.shockwave).toMatchObject({ damage: 22, cooldownMs: 600, speed: 900, range: 900 });
    expect(WEAPON_TABLE.predator.homing).toEqual({ turnRateDegPerSec: 120, durationMs: 1200 });
    expect(WEAPON_TABLE.thunderclap).toMatchObject({ damage: 90, speed: 1600, aimRangeUnits: 400 });
    expect(WEAPON_TABLE.roadblock).toMatchObject({ damage: 100, pierce: 4 });
    expect(WEAPON_TABLE.roadblock.hitbox).toEqual({ shape: "bar", radiusAlong: 6, radiusAcross: 60 });
    expect(WEAPON_TABLE.wildcharge.maneuver).toEqual({ type: "charge", durationMs: 10000, slamsStunned: true });
    expect(WEAPON_TABLE.wildcharge.isUnInterruptable).toBe(true);
    expect(WEAPON_TABLE.thumper.bounce).toEqual({ lifetimeMs: 2900 });
    expect(WEAPON_TABLE.pepperbox.muzzles).toEqual([0, 90, 180, 270]);
    expect(WEAPON_TABLE.afterburner.muzzles).toEqual([0, 180]);
    expect(WEAPON_TABLE.lance).toMatchObject({ attached: true, lifetimeMs: 1500, holdsDuringFire: true, usesAimAssist: false });
  });

  it("keeps maneuver rows single-volley", () => {
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (def.kind === "maneuver") expect(def.volley.volleys, def.id).toBe(1);
    }
  });

  it("validates every row: positive stats, unlocksAt >= 1, volley counts >= 1, cone angle in (0, 180)", () => {
    const rows: WeaponDef[] = Object.values(WEAPON_TABLE);
    for (const def of rows) {
      expect(def.unlocksAt).toBeGreaterThanOrEqual(1);
      expect(def.damage).toBeGreaterThan(0);
      if (def.kind !== "maneuver") {
        expect(def.speed).toBeGreaterThan(0);
        expect(def.range).toBeGreaterThan(0);
      }
      expect(def.name.length).toBeGreaterThan(0);
      if (def.stock) {
        expect(def.stock.max).toBeGreaterThanOrEqual(2);
        expect(def.stock.refireDelayMs).toBeGreaterThanOrEqual(0);
      }
      // A loop bound in `releaseShots`, and it fails silently rather than loudly: `volleys: 0`
      // fires exactly one shot (the first release always emits) instead of none. Applies to every
      // row now that `VolleyDef` lives on `WeaponBase`, not just projectiles.
      expect(def.volley.volleys).toBeGreaterThanOrEqual(1);
      if (def.kind === "projectile") {
        // A loop bound in `spawnInstances`, and it fails silently rather than loudly:
        // `pelletsPerVolley: 0` spawns nothing at all for a press that still spends its stock.
        expect(def.pellets.pelletsPerVolley).toBeGreaterThanOrEqual(1);
        expect(def.pellets.spreadAngleDeg).toBeGreaterThanOrEqual(0);
      }
      // Dormant until the first beam row ships, and deliberately written now rather than then: a
      // cone's half-angle goes through `Math.tan`, so `angleDeg: 180` yields an infinite spread and
      // an all-NaN polygon that SAT silently reports as hitting nothing, and `0` a zero-area cone.
      if (def.kind === "beam" && def.hitbox.shape === "cone") {
        expect(def.hitbox.angleDeg).toBeGreaterThan(0);
        expect(def.hitbox.angleDeg).toBeLessThan(180);
      }
    }
  });

  it("gives every weapon its own `#RRGGBB` colour, and never a player's", () => {
    const rows: WeaponDef[] = Object.values(WEAPON_TABLE);
    const colors = rows.map((def) => def.color.toUpperCase());
    for (const color of colors) expect(color).toMatch(/^#[0-9A-F]{6}$/);
    // Unique per weapon: the colour is the only thing telling two shots apart on screen, since
    // every instance draws as a plain filled hitbox.
    expect(new Set(colors).size).toBe(rows.length);
    // And never a player colour. A shot is not owner-coloured, so one wearing a player's paint
    // would claim an identity it does not carry.
    const players = new Set(COLOR_TABLE.map((c) => c.hex.toUpperCase()));
    for (const color of colors) expect(players.has(color)).toBe(false);
  });

  it("rejects prototype names as weapon ids", () => {
    expect(isWeaponId("shockwave")).toBe(true);
    expect(isWeaponId("constructor")).toBe(false);
    expect(isWeaponId("__proto__")).toBe(false);
    expect(isWeaponId(7)).toBe(false);
  });

  it("resolves a def by id", () => {
    expect(weaponDefOf("shockwave").id).toBe("shockwave");
  });

  describe("per-weapon aim range (spec S1)", () => {
    it("pairs aimRangeUnits with usesAimAssist, both ways", () => {
      for (const def of Object.values(WEAPON_TABLE)) {
        if (def.usesAimAssist) {
          expect(def.aimRangeUnits, `${def.id} uses aim assist and must author aimRangeUnits`).toBeGreaterThan(0);
        } else {
          expect(def.aimRangeUnits, `${def.id} must not author aimRangeUnits without usesAimAssist`).toBeUndefined();
        }
      }
    });

    it("keeps every assisted weapon's range at or beyond its own aim range", () => {
      // Replaces the old `range >= AIM_CONFIG.lockRange` guard: the lock is now bounded per weapon.
      for (const def of Object.values(WEAPON_TABLE)) {
        if (!def.usesAimAssist || def.kind === "maneuver") continue;
        expect(def.range, `${def.id}`).toBeGreaterThanOrEqual(def.aimRangeUnits!);
      }
    });
  });

  describe("new-mechanic guards (vacuous until plan 3's rows land — they gate authoring, not code)", () => {
    it("keeps multi-muzzle weapons off aim assist", () => {
      for (const def of Object.values(WEAPON_TABLE)) {
        if ((def.muzzles?.length ?? 1) > 1) expect(def.usesAimAssist, def.id).toBe(false);
      }
    });
    it("requires aim assist on homing weapons", () => {
      for (const def of Object.values(WEAPON_TABLE)) {
        if (def.kind === "projectile" && def.homing) expect(def.usesAimAssist, def.id).toBe(true);
      }
    });
    it("bounds a bounce lifetime under its own cooldown, so two instances never coexist", () => {
      for (const def of Object.values(WEAPON_TABLE)) {
        if (def.kind === "projectile" && def.bounce) expect(def.bounce.lifetimeMs, def.id).toBeLessThan(def.cooldownMs);
      }
    });
    it("bounds a charge duration under its own cooldown", () => {
      for (const def of Object.values(WEAPON_TABLE)) {
        if (def.kind === "maneuver" && def.maneuver.type === "charge") {
          expect(def.maneuver.durationMs, def.id).toBeLessThan(def.cooldownMs);
        }
      }
    });
    it("requires a dash to author positive speed and an aim range (its distance)", () => {
      for (const def of Object.values(WEAPON_TABLE)) {
        if (def.kind === "maneuver" && def.maneuver.type === "dash") {
          expect(def.speed, def.id).toBeGreaterThan(0);
          expect(def.aimRangeUnits, def.id).toBeGreaterThan(0);
        }
      }
    });
  });

  it("keeps aim-assist weapons off the behavioural cliff", () => {
    // A9.4. `lockTimeoutMs` splits weapons into two targeting classes at `1000 / lockTimeoutMs`:
    // above it presses keep refreshing the timer and the 25% steal margin governs; below it the
    // timer lapses between shots and every shot re-picks the best target. A weapon authored near
    // the boundary flips between the two depending on how metronomically the player fires.
    //
    // The cliff is DERIVED, not hardcoded, so retuning `lockTimeoutMs` moves this guard with it
    // rather than stranding a stale range. Sustained rate is `1000 / cooldownMs` for every weapon:
    // a stocked weapon still needs one full `cooldownMs` per stock, and `refireDelayMs` only spaces
    // a burst. Per-row and therefore conservative -- a multi-slot car presses MORE often, which
    // moves it away from the cliff, never toward it.
    const cliffHz = 1000 / AIM_CONFIG.lockTimeoutMs;
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (!def.usesAimAssist) continue;
      const sustainedHz = 1000 / def.cooldownMs;
      const distance = Math.abs(sustainedHz - cliffHz) / cliffHz;
      expect(distance).toBeGreaterThan(0.15);
    }
  });

  it("ships pepperbox as a single fan repeated across four muzzles", () => {
    const pepperbox = WEAPON_TABLE.pepperbox;
    if (pepperbox.kind !== "projectile") throw new Error("pepperbox must be a projectile");
    // T12 collapsed 3 volleys of 2 into 1 volley of 3; the 2026-09-01 overhaul (O9) then repeated
    // that one volley across four muzzles instead of reintroducing sequential fire.
    expect(pepperbox.volley).toEqual({ volleys: 1, volleyIntervalMs: 0 });
    expect(pepperbox.pellets).toEqual({ pelletsPerVolley: 3, spreadAngleDeg: 12 });
    expect(pepperbox.muzzles).toEqual([0, 90, 180, 270]);
    // 3 pellets x 45 = 135 per fan, the same per-target ceiling a press has always landed — the
    // four muzzles are 90 degrees apart, so at most one fan lines up with a single target.
    const pellets = pepperbox.volley.volleys * pepperbox.pellets.pelletsPerVolley;
    expect(pellets * pepperbox.damage).toBe(135);
    // Multi-muzzle forces assist off (O9): a lock cannot steer a four-way spray.
    expect(pepperbox.usesAimAssist).toBe(false);
    expect(pepperbox.aimRangeUnits).toBeUndefined();
  });

  it("ships afterburner as the table's first beam, attached and ticking", () => {
    const afterburner = WEAPON_TABLE.afterburner;
    if (afterburner.kind !== "beam") throw new Error("afterburner must be a beam");
    expect(afterburner.attached).toBe(true);
    expect(afterburner.lifetimeMs).toBe(2000);
    expect(afterburner.damageFrequencyMs).toBe(500);
    expect(afterburner.hitbox).toEqual({ shape: "cone", angleDeg: 55 });
    // Total life is range/speed + lifetime == 200ms + 2000ms. At one pulse per 500ms that is 5
    // pulses == 245 base max, about a third of an average car's hull HP.
    expect(afterburner.range / afterburner.speed + afterburner.lifetimeMs / 1000).toBeCloseTo(2.2);
    // Forced, not chosen: range 220 < AIM_CONFIG.lockRange, and an attached beam re-derives its
    // angle from the owner every tick, so a lock would have nothing to decide.
    expect(afterburner.usesAimAssist).toBe(false);
  });

  it("keeps every capsule long enough for its own nose cap", () => {
    // A capsule's nose is a semicircle of `radiusAcross` centred at `radiusAlong - radiusAcross`.
    // Author it shorter than it is wide and that centre moves behind the tail, the cap wraps past
    // the flat edge, and the polygon stops being convex — which SAT does not reject, it just
    // silently answers the wrong question about what the shot hit.
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (def.kind !== "projectile" || def.hitbox.shape !== "capsule") continue;
      expect(def.hitbox.radiusAlong).toBeGreaterThanOrEqual(def.hitbox.radiusAcross);
    }
  });

  it("keeps bar hitboxes wider than they are thick", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      if (def.kind === "projectile" && def.hitbox.shape === "bar") {
        expect(def.hitbox.radiusAcross, def.id).toBeGreaterThanOrEqual(def.hitbox.radiusAlong);
      }
    }
  });

  it("refuses aim assist on an attached beam", () => {
    // A12. An attached beam re-derives its origin and angle from the owner's pose every tick, so it
    // would snap to the lock at birth and immediately re-weld to the car's nose. Dormant until the
    // first beam row ships, and written now rather than then: making an attached beam track the
    // lock every tick is a far stronger weapon than its numbers suggest, and not a decision anyone
    // should make implicitly.
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (def.kind !== "beam" || !def.attached) continue;
      expect(def.usesAimAssist).toBe(false);
    }
  });

  it("ships roadblock piercing everything, aim assist deliberately off", () => {
    const roadblock = WEAPON_TABLE.roadblock;
    if (roadblock.kind !== "projectile") throw new Error("roadblock must be a projectile");
    // pierce counts cars hit AFTER the first, so pierce: 4 reaches all 5 possible opponents in a
    // 6-player game once the shooter is excluded — the wall passes through the whole lobby.
    // (pierce: 5 would reach a sixth car, which cannot exist once the shooter is excluded.)
    expect(roadblock.pierce).toBe(4);
    expect(roadblock.hitbox).toEqual({ shape: "bar", radiusAlong: 6, radiusAcross: 60 });
    // The wall stops for nothing — walls included. Without this the 60u wingtips killed the shot
    // in `hitsWorld` on its own spawn tick whenever Bastion fired within a wingtip of a wall.
    expect(roadblock.piercesWalls).toBe(true);
    // A 120-unit face aims itself; skewer's old "help the slowest chassis" argument is answered by
    // width here instead of by a lock.
    expect(roadblock.usesAimAssist).toBe(false);
    expect(roadblock.aimRangeUnits).toBeUndefined();
  });

  it("ships lance as an attached, held beam with the roster's only substantial recovery", () => {
    const lance = WEAPON_TABLE.lance;
    if (lance.kind !== "beam") throw new Error("lance must be a beam");
    // O10: lance became held-and-attached, superseding the old detached-with-a-lock design — it
    // now sweeps live under the driver's own steering while the HOLD maneuver keeps the car still.
    expect(lance.attached).toBe(true);
    expect(lance.holdsDuringFire).toBe(true);
    expect(lance.damage).toBe(170); // T13 trimmed 180 to pay for +15% width AND the lock
    expect(lance.hitbox).toEqual({ shape: "rect", width: 57.5 });
    expect(lance.damageFrequencyMs).toBe(0); // one hit per car, not a ticking zone
    expect(lance.startUpMs).toBe(700);
    // O10 supersedes T13's aim-assist argument: sweeping live under manual steering while held is a
    // strictly stronger form of aim than a lock, so assist is off and the field is deleted with it.
    expect(lance.usesAimAssist).toBe(false);
    expect(lance.aimRangeUnits).toBeUndefined();
    // The wind-up alone is not the whole cost: a missed lance also owes a second of silence, which
    // is what makes it punishing on a 300 HP chassis (L5).
    expect(lance.recoveryMs).toBe(1000);
    const highest = Math.max(
      ...Object.values(WEAPON_TABLE).map((def) => def.recoveryMs),
    );
    expect(lance.recoveryMs).toBe(highest);
  });

  it("keeps both branches of usesAimAssist populated by carried weapons", () => {
    // The pair that makes `usesAimAssist` a real switch rather than a global: one row on, one off.
    // Both are weapons a player can fire. The 2026-09-01 overhaul flipped the majority off (five of
    // nine): the multi-muzzle and held-beam guards forced `pepperbox`, `lance` and `afterburner`
    // off, and `roadblock` opts out by choice — the same "aim yourself" argument `bulwark` used to
    // carry.
    expect(WEAPON_TABLE.shockwave.usesAimAssist).toBe(true);
    expect(WEAPON_TABLE.roadblock.usesAimAssist).toBe(false);
    const off = Object.values(WEAPON_TABLE).filter((d) => !d.usesAimAssist);
    expect(off.map((d) => d.id).sort()).toEqual([
      "afterburner",
      "lance",
      "pepperbox",
      "roadblock",
      "tremor", // a zone is aimed at ground — bulwark's old argument, inherited with its shape
      "wildcharge",
    ]);
  });

  it("keeps thumper's cooldown clear of the band the aim-assist cliff forbids", () => {
    const thumper = WEAPON_TABLE.thumper;
    expect(thumper.usesAimAssist).toBe(true);
    // The cliff guard rejects any aim-assist weapon within 15% of 1000 / lockTimeoutMs. At
    // lockTimeoutMs 800 that is 1.25 Hz, which forbids EVERY cooldownMs between 696 and 941. The
    // 900ms first drafted for this row sat inside the band and would have failed the suite.
    const forbiddenLow = 1000 / (1.25 * 1.15);
    const forbiddenHigh = 1000 / (1.25 * 0.85);
    expect(thumper.cooldownMs).toBe(3000);
    expect(thumper.cooldownMs).toBeGreaterThan(forbiddenHigh);
    expect(forbiddenLow).toBeLessThan(forbiddenHigh); // the band is a band, not a point
    expect(thumper.hitbox).toEqual({ shape: "capsule", radiusAlong: 24, radiusAcross: 15 });
  });

  it("carries ten weapons — nine on the roster plus the unassigned tremor — every one a different colour", () => {
    const rows = Object.values(WEAPON_TABLE);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((def) => def.color.toUpperCase())).size).toBe(10);
  });

  it("puts ownerInside applications on beams only — a zone is a place to stand", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      for (const application of def.applies ?? []) {
        if (application.target === "ownerInside") {
          expect(def.kind, `${def.id} authors ownerInside on a non-beam`).toBe("beam");
        }
      }
    }
  });

  it("ships shockwave as a plain single-shot dart, the retired aura's id and nothing else", () => {
    const sw = WEAPON_TABLE.shockwave;
    if (sw.kind !== "projectile") throw new Error("shockwave must be a projectile now");
    expect(sw.volley).toEqual({ volleys: 1, volleyIntervalMs: 0 });
    expect(sw.damage).toBe(22);
    expect(sw.applies).toBeUndefined();
  });

  it("keeps Bullseye's straight-line reach further than anything Bastion carries", () => {
    // T1's "1 beats 3" edge, asserted rather than asserted-in-prose.
    //
    // This is a DELIBERATE, documented exclusion, not a workaround: `thumper.range` (1305) is the
    // total length of a bounce PATH — 450 u/s for `bounce.lifetimeMs` (2.9s), zigzagging off
    // whatever walls it meets — not a distance Bastion can point straight at a kiting Bullseye and
    // threaten. A poke is measured by how far a shot reaches in the direction it was fired, and a
    // bouncing shot's `range` field does not answer that question, so the guard compares
    // straight-line pokes only and excludes any `bounce`-carrying row from both sides of the
    // comparison.
    //
    // Read literally, off `WEAPON_TABLE` alone and with no notion of "straight" at all, `thumper`'s
    // 1305 is now the single largest `range` value in the whole roster — larger than `lance`'s 1200
    // and `predator`'s 900. That is a real number on the page (the guide prints it, unqualified,
    // wherever it prints "Reach"), and whether a bouncing 1305 is worth more or less than a straight
    // 1200 in actual play is a genuine open balance question this test does not settle — it only
    // pins the narrower, uncontroversial claim that Bullseye's straight threat range is longer than
    // Bastion's. Surfaced here for the owner's next tuning pass rather than decided unilaterally.
    // `roadblock`'s cutdown-from-skewer 500 is Bastion's real straight reach.
    const straightReach = (id: CarId) =>
      Math.max(
        0,
        ...slotsOf(id)
          .map((w) => weaponDefOf(w))
          .filter((def) => !(def.kind === "projectile" && def.bounce))
          .map((def) => def.range),
      );
    expect(straightReach("bullseye")).toBeGreaterThan(straightReach("bastion"));
    expect(WEAPON_TABLE.roadblock.range).toBe(500);
    // `slotsOf` truncates to the slot limit, so measure that it is the whole authored kit above.
    expect(slotsOf("bastion")).toEqual([...CAR_TABLE.bastion.weapons]);
  });

  it("keeps Bastion's crowd control the longest in the roster", () => {
    // T20: per-chassis CC duration needs no mechanism, because kits are exclusive and the applier
    // owns the duration. This is what makes that true rather than merely claimed.
    const longestCc = (id: CarId) =>
      Math.max(
        0,
        ...slotsOf(id).flatMap((w) =>
          (weaponDefOf(w).applies ?? [])
            .filter((a) => a.target === "opponents")
            .map((a) => a.durationMs),
        ),
      );
    expect(longestCc("bastion")).toBeGreaterThan(longestCc("mirage"));
    expect(longestCc("bastion")).toBeGreaterThan(longestCc("bullseye"));
  });

  it("keeps every status in the table reachable from some weapon", () => {
    const applied = new Set(
      Object.values(WEAPON_TABLE).flatMap((d) => (d.applies ?? []).map((a) => a.statusId)),
    );
    for (const id of ["overheated", "corroded", "stunned", "spiked", "fortified"] as const) {
      expect(applied.has(id)).toBe(true);
    }
    // `overhauled` is the pickup row and is deliberately applied by nothing.
    expect(applied.has("overhauled")).toBe(false);
  });

  it("defaults every status application to firing on all waves", () => {
    // `onWave` absent must mean today's behaviour, so adding the field cannot change any row that
    // does not opt in.
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      for (const a of def.applies ?? []) {
        if (a.onWave === undefined) continue;
        expect(["all", "final"]).toContain(a.onWave);
      }
    }
  });
});
