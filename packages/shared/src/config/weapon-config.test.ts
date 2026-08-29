import { describe, expect, it } from "vitest";
import { COLOR_TABLE } from "./color-config.js";
import { WEAPON_TABLE, isWeaponId, weaponDefOf } from "./weapon-config.js";
import type { WeaponDef } from "./weapon-types.js";
import { AIM_CONFIG } from "./aim-config.js";

describe("WEAPON_TABLE", () => {
  it("ships the migrated fireball with today's numbers", () => {
    const fireball = WEAPON_TABLE.fireball;
    expect(fireball.kind).toBe("projectile");
    expect(fireball.damage).toBe(50);
    expect(fireball.cooldownMs).toBe(500); // was fireRateHz: 2
    expect(fireball.speed).toBe(900);
    expect(fireball.range).toBe(900); // was lifetimeTicks: 30 == 1s of flight at 900 u/s
    expect(fireball.startUpMs).toBe(0);
    expect(fireball.recoveryMs).toBe(0);
    expect(fireball.damageFrequencyMs).toBe(0);
    expect(fireball.unlocksAt).toBe(1);
    expect(fireball.stock).toBeUndefined();
  });

  it("gives the fireball a single-target circle hitbox and no volley spread", () => {
    const fireball = WEAPON_TABLE.fireball;
    if (fireball.kind !== "projectile") throw new Error("fireball must be a projectile");
    expect(fireball.pierce).toBe(0);
    expect(fireball.hitbox).toEqual({ shape: "circle", radius: 12 });
    expect(fireball.volley).toEqual({
      volleys: 1,
      volleyIntervalMs: 0,
      pelletsPerVolley: 1,
      spreadAngleDeg: 0,
    });
  });

  it("validates every row: positive stats, unlocksAt >= 1, volley counts >= 1, cone angle in (0, 180)", () => {
    const rows: WeaponDef[] = Object.values(WEAPON_TABLE);
    for (const def of rows) {
      expect(def.unlocksAt).toBeGreaterThanOrEqual(1);
      expect(def.damage).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.range).toBeGreaterThan(0);
      expect(def.name.length).toBeGreaterThan(0);
      if (def.stock) {
        expect(def.stock.max).toBeGreaterThanOrEqual(2);
        expect(def.stock.refireDelayMs).toBeGreaterThanOrEqual(0);
      }
      if (def.kind === "projectile") {
        // Both counts are loop bounds in `spawnInstances`/`releaseShots`, and both fail silently
        // rather than loudly: `pelletsPerVolley: 0` spawns nothing at all for a press that still
        // spends its stock, and `volleys: 0` fires exactly one shot (the first release always
        // emits) instead of none.
        expect(def.volley.volleys).toBeGreaterThanOrEqual(1);
        expect(def.volley.pelletsPerVolley).toBeGreaterThanOrEqual(1);
        expect(def.volley.spreadAngleDeg).toBeGreaterThanOrEqual(0);
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
    expect(isWeaponId("fireball")).toBe(true);
    expect(isWeaponId("constructor")).toBe(false);
    expect(isWeaponId("__proto__")).toBe(false);
    expect(isWeaponId(7)).toBe(false);
  });

  it("resolves a def by id", () => {
    expect(weaponDefOf("fireball").id).toBe("fireball");
  });

  it("ships needler as the table's multi-stock reference, now carried rather than dormant", () => {
    const needler = WEAPON_TABLE.needler;
    expect(needler.kind).toBe("projectile");
    expect(needler.damage).toBe(30);
    expect(needler.cooldownMs).toBe(400);
    expect(needler.speed).toBe(1100);
    expect(needler.range).toBe(850);
    expect(needler.usesAimAssist).toBe(true);
    expect(needler.stock).toEqual({ max: 3, refireDelayMs: 130 });
    // 400ms is the whole design: tapping one dart sustains 75 DPS, dumping all three puts 90
    // damage out in 260ms and then leaves a 1.2s dry spell. See the spec's derivation rule.
    expect(needler.damage * (1000 / needler.cooldownMs)).toBe(75);
  });

  it("never lets an aim-assist weapon lock past its own reach", () => {
    // A9.3. This is the one corner case a single per-car lock leaves open: with global geometry, a
    // weapon can hold a lock on a target its own `range` cannot reach, so it fires at a visible
    // bracket and falls short. Caught at authoring time instead of in play.
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (!def.usesAimAssist) continue;
      expect(def.range).toBeGreaterThanOrEqual(AIM_CONFIG.lockRange);
    }
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

  it("ships pepperbox as the table's first burst-and-fan weapon", () => {
    const pepperbox = WEAPON_TABLE.pepperbox;
    if (pepperbox.kind !== "projectile") throw new Error("pepperbox must be a projectile");
    expect(pepperbox.volley).toEqual({
      volleys: 3,
      volleyIntervalMs: 100,
      pelletsPerVolley: 2,
      spreadAngleDeg: 10,
    });
    // 6 pellets x 28 = 168 in a 200ms window. Its all-pellets-connect sustained DPS is 83, BELOW
    // fireball's 100 — that is the burst-over-sustained trade, not a bug. See the spec's rule.
    const pellets = pepperbox.volley.volleys * pepperbox.volley.pelletsPerVolley;
    expect(pellets * pepperbox.damage).toBe(168);
    expect(pepperbox.usesAimAssist).toBe(false);
  });

  it("ships afterburner as the table's first beam, attached and ticking", () => {
    const afterburner = WEAPON_TABLE.afterburner;
    if (afterburner.kind !== "beam") throw new Error("afterburner must be a beam");
    expect(afterburner.attached).toBe(true);
    expect(afterburner.lifetimeMs).toBe(2000);
    expect(afterburner.damageFrequencyMs).toBe(200);
    expect(afterburner.hitbox).toEqual({ shape: "cone", angleDeg: 55 });
    // Total life is range/speed + lifetime == 200ms + 2000ms. At one tick per 200ms that is ~11
    // ticks == 286 max, 57% of an average car's 500 hull HP.
    expect(afterburner.range / afterburner.speed + afterburner.lifetimeMs / 1000).toBeCloseTo(2.2);
    // Forced, not chosen: range 220 < AIM_CONFIG.lockRange, and an attached beam re-derives its
    // angle from the owner every tick, so a lock would have nothing to decide.
    expect(afterburner.usesAimAssist).toBe(false);
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

  it("ships skewer piercing exactly two cars, not three", () => {
    const skewer = WEAPON_TABLE.skewer;
    if (skewer.kind !== "projectile") throw new Error("skewer must be a projectile");
    // `pierce` counts opponents passed through AFTER the first, so 1 == two cars. At `pierce: 2`
    // a 110-damage shot deals 396 on Bullseye's 1.2x attack and out-damages `lance`, the ultimate.
    expect(skewer.pierce).toBe(1);
    expect(skewer.hitbox).toEqual({ shape: "ellipse", radiusAlong: 22, radiusAcross: 5 });
    expect(skewer.startUpMs).toBe(250);
    expect(skewer.usesAimAssist).toBe(false);
  });

  it("ships lance as a detached beam with the roster's only substantial recovery", () => {
    const lance = WEAPON_TABLE.lance;
    if (lance.kind !== "beam") throw new Error("lance must be a beam");
    expect(lance.attached).toBe(false);
    expect(lance.damage).toBe(180);
    expect(lance.damageFrequencyMs).toBe(0); // one hit per car, not a ticking zone
    expect(lance.startUpMs).toBe(700);
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
    // Both are now weapons a player can fire, unlike the fireball/repeater pair this replaced.
    expect(WEAPON_TABLE.fireball.usesAimAssist).toBe(true);
    expect(WEAPON_TABLE.skewer.usesAimAssist).toBe(false);
  });

  it("keeps thumper's cooldown clear of the band the aim-assist cliff forbids", () => {
    const thumper = WEAPON_TABLE.thumper;
    expect(thumper.usesAimAssist).toBe(true);
    // The cliff guard rejects any aim-assist weapon within 15% of 1000 / lockTimeoutMs. At
    // lockTimeoutMs 800 that is 1.25 Hz, which forbids EVERY cooldownMs between 696 and 941. The
    // 900ms first drafted for this row sat inside the band and would have failed the suite.
    const forbiddenLow = 1000 / (1.25 * 1.15);
    const forbiddenHigh = 1000 / (1.25 * 0.85);
    expect(thumper.cooldownMs).toBe(1000);
    expect(thumper.cooldownMs).toBeGreaterThan(forbiddenHigh);
    expect(forbiddenLow).toBeLessThan(forbiddenHigh); // the band is a band, not a point
    expect(thumper.hitbox).toEqual({ shape: "circle", radius: 20 });
    expect(thumper.range).toBeGreaterThanOrEqual(AIM_CONFIG.lockRange);
  });

  it("ships bulwark as a detached beam that lingers and ticks", () => {
    const bulwark = WEAPON_TABLE.bulwark;
    if (bulwark.kind !== "beam") throw new Error("bulwark must be a beam");
    expect(bulwark.attached).toBe(false); // stamped into the world, unlike afterburner
    expect(bulwark.lifetimeMs).toBe(2500);
    expect(bulwark.damageFrequencyMs).toBe(400);
    // Total life is range/speed + lifetime == 1s + 2.5s. At one tick per 400ms that is ~8 ticks
    // == 280 max, matching afterburner's ceiling as L6 intends.
    expect(bulwark.range / bulwark.speed + bulwark.lifetimeMs / 1000).toBeCloseTo(3.5);
  });

  it("carries exactly nine weapons, every one a different colour", () => {
    const rows = Object.values(WEAPON_TABLE);
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((def) => def.color.toUpperCase())).size).toBe(9);
  });
});
