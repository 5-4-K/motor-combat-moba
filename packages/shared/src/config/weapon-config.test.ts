import { describe, expect, it } from "vitest";
import { CAR_TABLE } from "./car-config.js";
import { COLOR_TABLE } from "./color-config.js";
import type { CarId } from "./types.js";
import { WEAPON_TABLE, isWeaponId, weaponDefOf } from "./weapon-config.js";
import { slotsOf } from "./weapon-slots.js";
import { weaponTicksOf } from "./weapon-ticks.js";
import type { WeaponDef } from "./weapon-types.js";
import { AIM_CONFIG } from "./aim-config.js";

describe("WEAPON_TABLE", () => {
  it("ships the migrated fireball with today's numbers", () => {
    const fireball = WEAPON_TABLE.fireball;
    expect(fireball.kind).toBe("projectile");
    expect(fireball.damage).toBe(50);
    // Was fireRateHz: 2 == 500ms; T14 put it up 10% to pay for shockwave arriving in Mirage's
    // slot 2, which is what moved the headline kill from 5.0 s to 5.5 s.
    expect(fireball.cooldownMs).toBe(2000);
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
    expect(fireball.volley).toEqual({ volleys: 1, volleyIntervalMs: 0 });
    expect(fireball.pellets).toEqual({ pelletsPerVolley: 1, spreadAngleDeg: 0 });
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
    expect(isWeaponId("fireball")).toBe(true);
    expect(isWeaponId("constructor")).toBe(false);
    expect(isWeaponId("__proto__")).toBe(false);
    expect(isWeaponId(7)).toBe(false);
  });

  it("resolves a def by id", () => {
    expect(weaponDefOf("fireball").id).toBe("fireball");
  });

  it("ships needler as a plain single-shot dart, its magazine removed", () => {
    const needler = WEAPON_TABLE.needler;
    expect(needler.kind).toBe("projectile");
    expect(needler.damage).toBe(22);
    expect(needler.cooldownMs).toBe(600);
    expect(needler.speed).toBe(1300);
    expect(needler.range).toBe(850);
    expect(needler.usesAimAssist).toBe(true);
    // The 2026-08-30 pass took the magazine off. This row was the table's ONLY multi-stock weapon,
    // so `StockDef` now ships carried by nothing — see the row's own comment.
    expect(needler.stock).toBeUndefined();
    // 22 per 600ms is 36.67 sustained DPS, half the 73 it held while it could bank three darts.
    expect(needler.damage * (1000 / needler.cooldownMs)).toBeCloseTo(36.7, 1);
    // T11 took `spiked` off this row and gave it to `bulwark`: a spam weapon that also applied a
    // refreshing debuff was doing slot 3's job from slot 1.
    expect(needler.applies).toBeUndefined();
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

  it("ships pepperbox as a single fan rather than a sequential burst", () => {
    const pepperbox = WEAPON_TABLE.pepperbox;
    if (pepperbox.kind !== "projectile") throw new Error("pepperbox must be a projectile");
    // T12 collapsed 3 volleys of 2 into 1 volley of 3. The steer-through-the-burst skill expression
    // went with it, deliberately: one volley means the fan is decided entirely at the press.
    expect(pepperbox.volley).toEqual({ volleys: 1, volleyIntervalMs: 0 });
    expect(pepperbox.pellets).toEqual({ pelletsPerVolley: 3, spreadAngleDeg: 12 });
    // 3 pellets x 45 = 135 on one tick, against the old 168 across 200ms. 135 per 1800ms is 75
    // sustained DPS, level with needler's 73 — the pair is Bullseye's mid-range pressure, so
    // neither should out-sustain the other.
    const pellets = pepperbox.volley.volleys * pepperbox.pellets.pelletsPerVolley;
    expect(pellets * pepperbox.damage).toBe(135);
    expect(pepperbox.usesAimAssist).toBe(true);
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
    // a 110-damage shot puts 3 x 101 == 303 into a line off a 2.4s cooldown, which is
    // ultimate-scale output from a slot that is not Bastion's ultimate.
    expect(skewer.pierce).toBe(1);
    expect(skewer.hitbox).toEqual({ shape: "ellipse", radiusAlong: 22, radiusAcross: 5 });
    expect(skewer.startUpMs).toBe(250);
    // T17 reversed the "assist off by choice" argument that used to sit on this row: it held for an
    // 1100-unit poke on a precise skirmisher and does not for a 650-unit lunge on the slowest
    // chassis. The lock still only reaches AIM_CONFIG.lockRange of the 650.
    expect(skewer.range).toBe(650);
    expect(skewer.speed).toBe(1000);
    expect(skewer.usesAimAssist).toBe(true);
  });

  it("ships lance as a detached beam with the roster's only substantial recovery", () => {
    const lance = WEAPON_TABLE.lance;
    if (lance.kind !== "beam") throw new Error("lance must be a beam");
    expect(lance.attached).toBe(false);
    expect(lance.damage).toBe(170); // T13 trimmed 180 to pay for +15% width AND the lock
    expect(lance.hitbox).toEqual({ shape: "rect", width: 57.5 });
    expect(lance.damageFrequencyMs).toBe(0); // one hit per car, not a ticking zone
    expect(lance.startUpMs).toBe(700);
    // Legal because the "no assist on a beam" guard refuses ATTACHED beams only, and this one
    // stamps at its fire-tick pose. Range 1200 clears lockRange three times over, so the assist
    // covers only the near third of the beam's reach.
    expect(lance.usesAimAssist).toBe(true);
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
    // Both are weapons a player can fire. The redistribution tipped assist into the majority (six
    // of nine), and `skewer` — which used to hold the "off" half here — flipped on with T17, so
    // this reaches for `afterburner` instead: Mirage's slot 3, and off by the attached-beam guard.
    expect(WEAPON_TABLE.fireball.usesAimAssist).toBe(true);
    expect(WEAPON_TABLE.afterburner.usesAimAssist).toBe(false);
    const off = Object.values(WEAPON_TABLE).filter((d) => !d.usesAimAssist);
    expect(off.map((d) => d.id).sort()).toEqual(["afterburner", "bulwark", "shockwave"]);
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
    expect(thumper.range).toBeGreaterThanOrEqual(AIM_CONFIG.lockRange);
  });

  it("ships bulwark as a detached beam that lingers and ticks", () => {
    const bulwark = WEAPON_TABLE.bulwark;
    if (bulwark.kind !== "beam") throw new Error("bulwark must be a beam");
    expect(bulwark.attached).toBe(false); // stamped into the world, unlike afterburner
    expect(bulwark.lifetimeMs).toBe(2875); // T18: +15%, and it is the +15% that crosses a tick
    expect(bulwark.damageFrequencyMs).toBe(400);
    // `range` and `speed` rise together, so the zone is 10% bigger and still grows out in exactly
    // one second: total life is range/speed + lifetime == 1s + 2.875s.
    expect(bulwark.range / bulwark.speed).toBe(1);
    expect(bulwark.range / bulwark.speed + bulwark.lifetimeMs / 1000).toBeCloseTo(3.875);
    // The damage ceiling, spelled out because the arithmetic is not the obvious one:
    // `resolveInstanceHits` damages on the first covered tick and only THEN arms the clock, so the
    // opening tick is free. 117 total ticks against a 12-tick interval is floor(116/12)+1 == 10.
    const life = weaponTicksOf("bulwark");
    expect(life.flight + life.lifetime).toBe(117);
    expect(life.damageInterval).toBe(12);
    const ticks = Math.floor((life.flight + life.lifetime - 1) / life.damageInterval) + 1;
    expect(ticks).toBe(10);
    expect(ticks * bulwark.damage).toBe(350);
  });

  it("carries exactly nine weapons, every one a different colour", () => {
    const rows = Object.values(WEAPON_TABLE);
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((def) => def.color.toUpperCase())).size).toBe(9);
  });

  it("ships shockwave as a three-wave aura whose last wave carries the debuff", () => {
    const sw = WEAPON_TABLE.shockwave;
    if (sw.kind !== "beam") throw new Error("shockwave must be a beam");
    expect(sw.volley).toEqual({ volleys: 3, volleyIntervalMs: 250 });
    expect(sw.damage).toBe(45); // 135 if all three connect, against the old single 100
    expect(sw.applies).toEqual([
      { statusId: "corroded", target: "opponents", durationMs: 2500, onWave: "final" },
    ]);
    // The stun moved to `thumper` with Type 3's CC identity. It must not linger here.
    expect((sw.applies ?? []).some((a) => a.statusId === "stunned")).toBe(false);
  });

  it("keeps Bullseye reaching further than anything Bastion carries", () => {
    // T1's "1 beats 3" edge, asserted rather than asserted-in-prose. Cutting skewer's range is the
    // whole reason the kite works; at its old 1100 the tank out-ranged two thirds of the kiter's kit.
    const reach = (id: CarId) => Math.max(...slotsOf(id).map((w) => weaponDefOf(w).range));
    expect(reach("bullseye")).toBeGreaterThan(reach("bastion"));
    expect(WEAPON_TABLE.skewer.range).toBe(650);
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
