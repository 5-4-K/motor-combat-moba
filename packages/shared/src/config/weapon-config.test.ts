import { beforeEach, describe, expect, it } from "vitest";
import { installMode } from "../modes/active.js";
import { DEFAULT_GAME_MODE, modeConfigOf } from "../modes/registry.js";
import { CAR_TABLE, forwardMaxSpeedOf, ramAttackOf, ramDefenceOf } from "./car-config.js";
import { COLOR_TABLE } from "./color-config.js";
import type { CarId } from "./types.js";
import type { StatusId } from "./status-types.js";
import { WEAPON_TABLE, explosionDamageModeOf, instanceDefOf, isWeaponId, weaponDefOf } from "./weapon-config.js";
import { slotsOf } from "./weapon-slots.js";
import { WEAPON_TICKS, msToTicks, weaponTicksOf } from "./weapon-ticks.js";
import type { ImpulseDef, WeaponDef, WeaponId } from "./weapon-types.js";
import { STATUS_CONFIG, isStatusId } from "./status-config.js";
import { RAM_CONFIG } from "./ram-config.js";
import { setTuning } from "./tuning.js";

beforeEach(() => installMode(modeConfigOf(DEFAULT_GAME_MODE)));

/**
 * The nine rows that are one weapon wearing nine ids: a plain bolt, authored once as
 * `BASIC_ATTACK_BASE` and spread nine times so a later per-chassis divergence is a one-field edit.
 *
 * **Listed here, not filtered by the shape of an id and not read out of `CAR_TABLE`.** These
 * assertions are about these nine WEAPON rows — what they are — and not about the basic-attack
 * SLOT, which any `WEAPON_TABLE` row may occupy. Pointing a chassis's `basicAttack` at some other
 * weapon must not drag that weapon in here and demand it be a plain bolt too.
 */
const PLAIN_BOLT_IDS = [
  "basic-attack-bullseye",
  "basic-attack-mirage",
  "basic-attack-bastion",
  "basic-attack-taurus",
  "basic-attack-anvil",
  "basic-attack-prowler",
  "basic-attack-cleaver",
  "basic-attack-skorpios",
  "basic-attack-caprico",
] as const satisfies readonly WeaponId[];

const plainBolts = (): WeaponDef[] => PLAIN_BOLT_IDS.map((id) => WEAPON_TABLE[id]);

describe("WEAPON_TABLE", () => {
  it("pins the overhaul roster's load-bearing numbers (spec 2026-09-01)", () => {
    expect(WEAPON_TABLE.magmablast).toMatchObject({ damage: 50, cooldownMs: 1600, speed: 600, range: 900 });
    expect(WEAPON_TABLE.predator.homing).toEqual({
      acquire: "proximity",
      acquireRadius: 200,
      turnRateDegPerSec: 300,
      durationMs: 2000,
    });
    expect(WEAPON_TABLE.thunderclap).toMatchObject({ damage: 90, speed: 1600, range: 400 });
    expect(WEAPON_TABLE.roadblock).toMatchObject({ damage: 100, pierce: 4 });
    expect(WEAPON_TABLE.roadblock.hitbox).toEqual({ shape: "bar", radiusAlong: 6, radiusAcross: 60 });
    expect(WEAPON_TABLE.wildcharge.maneuver).toEqual({ type: "charge", durationMs: 10000, slamsStunned: true });
    expect(WEAPON_TABLE.wildcharge.isUnInterruptable).toBe(true);
    expect(WEAPON_TABLE.thumper).toMatchObject({ bounces: true, lifetimeMs: 2900 });
    expect(WEAPON_TABLE.pepperbox.muzzles).toEqual([0, 90, 180, 270]);
    expect(WEAPON_TABLE.afterburner.muzzles).toEqual([0, 180]);
    expect(WEAPON_TABLE.lance).toMatchObject({ attached: true, lifetimeMs: 1500, holdsDuringFire: true });
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

  it("carries nineteen weapons — ten abilities plus the nine plain bolts", () => {
    expect(Object.values(WEAPON_TABLE)).toHaveLength(19);
    for (const id of PLAIN_BOLT_IDS) expect(WEAPON_TABLE, id).toHaveProperty(id);
  });

  it("gives every ability weapon its own `#RRGGBB` colour, one shared colour to the nine plain bolts, and never a player's", () => {
    const rows: WeaponDef[] = Object.values(WEAPON_TABLE);
    const colors = rows.map((def) => def.color.toUpperCase());
    for (const color of colors) expect(color).toMatch(/^#[0-9A-F]{6}$/);

    // Uniqueness is about telling two WEAPONS apart on screen, since every instance draws as a
    // plain filled hitbox. The nine basic attacks are one weapon wearing nine ids — a player must
    // not be able to tell Mirage's bolt from Bastion's — so they share one colour on purpose, and
    // this asserts BOTH halves rather than loosening the rule (BA7).
    const bolts = new Set<string>(PLAIN_BOLT_IDS);
    const abilities = rows.filter((def) => !bolts.has(def.id));
    const basics = plainBolts();
    const abilityColors = abilities.map((def) => def.color.toUpperCase());
    expect(new Set(abilityColors).size).toBe(abilities.length);
    expect(new Set(basics.map((def) => def.color.toUpperCase())).size).toBe(1);
    expect(abilityColors).not.toContain(basics[0]!.color.toUpperCase());

    // And never a player colour. A shot is not owner-coloured, so one wearing a player's paint
    // would claim an identity it does not carry.
    const players = new Set(COLOR_TABLE.map((c) => c.hex.toUpperCase()));
    for (const color of colors) expect(players.has(color)).toBe(false);
  });

  it("keeps the nine plain bolts identical, boring, and mechanic-free (BA3, BA34)", () => {
    const basics = plainBolts();
    for (const def of basics) {
      expect(def.kind, def.id).toBe("projectile");
      expect(def.applies, def.id).toBeUndefined();
      expect(def.impulse, def.id).toBeUndefined();
      expect(def.stock, def.id).toBeUndefined();
      expect(def.muzzles, def.id).toBeUndefined();
      if (def.kind === "projectile") {
        expect(def.explosion, def.id).toBeUndefined();
        expect(def.homing, def.id).toBeUndefined();
        expect(def.pierce, def.id).toBe(0);
      }
      // Every row carries the same numbers as every other. A later per-car balance pass is
      // expected to break this test deliberately, one field at a time (spec section 10).
      expect(
        { damage: def.damage, cooldownMs: def.cooldownMs, speed: def.speed, range: def.range },
        def.id,
      ).toEqual({ damage: 20, cooldownMs: 800, speed: 900, range: 960 });
    }
  });

  it("rejects prototype names as weapon ids", () => {
    expect(isWeaponId("magmablast")).toBe(true);
    expect(isWeaponId("constructor")).toBe(false);
    expect(isWeaponId("__proto__")).toBe(false);
    expect(isWeaponId(7)).toBe(false);
  });

  it("resolves a def by id", () => {
    expect(weaponDefOf("magmablast").id).toBe("magmablast");
  });

  describe("new-mechanic guards (vacuous until plan 3's rows land — they gate authoring, not code)", () => {
    it("bounds a BOUNCING row's lifetime under its own cooldown, so two never coexist", () => {
      for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
        if (def.kind !== "projectile" || !def.bounces) continue;
        expect(def.lifetimeMs).toBeDefined();
        expect(def.lifetimeMs!).toBeLessThan(def.cooldownMs);
      }
    });

    it("keeps any authored projectile lifetime positive", () => {
      for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
        if (def.kind !== "projectile" || def.lifetimeMs === undefined) continue;
        expect(def.lifetimeMs).toBeGreaterThan(0);
      }
    });
    it("bounds a charge duration under its own cooldown", () => {
      for (const def of Object.values(WEAPON_TABLE)) {
        if (def.kind === "maneuver" && def.maneuver.type === "charge") {
          expect(def.maneuver.durationMs, def.id).toBeLessThan(def.cooldownMs);
        }
      }
    });
    it("requires a dash to author positive speed and a range (its distance)", () => {
      for (const def of Object.values(WEAPON_TABLE)) {
        if (def.kind === "maneuver" && def.maneuver.type === "dash") {
          expect(def.speed, def.id).toBeGreaterThan(0);
          expect(def.range, def.id).toBeGreaterThan(0);
        }
      }
    });
    it("requires a homing row to author an acquireRadius", () => {
      for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
        if (def.kind !== "projectile" || !def.homing) continue;
        expect(def.homing.acquireRadius, `${def.id} acquires by proximity`).toBeGreaterThan(0);
      }
    });
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

  it("ships roadblock piercing everything", () => {
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
  });

  it("ships lance as an attached, held beam with the roster's only substantial recovery", () => {
    const lance = WEAPON_TABLE.lance;
    if (lance.kind !== "beam") throw new Error("lance must be a beam");
    // O10: lance became held-and-attached, superseding the old detached design — it now sweeps
    // live under the driver's own steering while the HOLD maneuver keeps the car still.
    expect(lance.attached).toBe(true);
    expect(lance.holdsDuringFire).toBe(true);
    expect(lance.damage).toBe(43); // per PULSE now, not per press — see the interval below
    expect(lance.hitbox).toEqual({ shape: "rect", width: 57.5 });
    // It ticks on contact rather than stamping 170 once, and on `afterburner`'s clock exactly, so
    // the roster's two ticking beams share one rhythm.
    expect(lance.damageFrequencyMs).toBe(500);
    expect(lance.damageFrequencyMs).toBe(WEAPON_TABLE.afterburner.damageFrequencyMs);
    expect(lance.startUpMs).toBe(700);
    // The wind-up alone is not the whole cost: a missed lance also owes a second of silence, which
    // is what makes it punishing on a 300 HP chassis (L5).
    expect(lance.recoveryMs).toBe(1000);
    const highest = Math.max(
      ...Object.values(WEAPON_TABLE).map((def) => def.recoveryMs),
    );
    expect(lance.recoveryMs).toBe(highest);
  });

  it("pays a full lance connect the same 170-ish it paid as a single stamp, and less at the tip", () => {
    const lance = WEAPON_TABLE.lance;
    if (lance.kind !== "beam") throw new Error("lance must be a beam");
    const ticks = WEAPON_TICKS.lance;
    // `instanceExpired` kills a beam once `tick - spawnTick >= flight + lifetime`, so this is the
    // number of ticks it can damage on, counting its spawn tick as 0.
    const life = ticks.flight + ticks.lifetime;
    // `resolveInstanceHits` damages on the first tick a target is covered and only then arms that
    // target's clock, so the pulse count depends on WHEN the beam first reaches them.
    const pulsesFrom = (firstContact: number) =>
      Math.floor((life - 1 - firstContact) / ticks.damageInterval) + 1;

    // A car at the muzzle is inside it from the tick it spawns: four pulses, 172 base — the old
    // single-stamp 170 within a rounding step, which is the whole point of the retune.
    expect(pulsesFrom(0)).toBe(4);
    expect(pulsesFrom(0) * lance.damage).toBe(172);
    // A car at the 1200-unit tip is not touched until the beam has grown all the way out, and its
    // fourth pulse would land one tick after expiry. Range-dependent by consequence, not by design;
    // one more tick of `lifetimeMs` would even it out. Documented in the row's comment.
    expect(pulsesFrom(ticks.flight)).toBe(3);
    expect(pulsesFrom(ticks.flight) * lance.damage).toBe(129);
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

  it("ships magmablast as an explosive shell — one volley, one pellet, a populated explosion", () => {
    // No longer even the retired aura's old id, and no longer the "plain dart" it was before Task 5
    // (2026-09-02) gave it a burst on death: `applies` stays undefined at the top level because the
    // shell itself carries no status — `explosion.applies` is where corroded actually lives.
    const sw = WEAPON_TABLE.magmablast;
    if (sw.kind !== "projectile") throw new Error("magmablast must be a projectile now");
    expect(sw.volley).toEqual({ volleys: 1, volleyIntervalMs: 0 });
    expect(sw.pellets).toEqual({ pelletsPerVolley: 1, spreadAngleDeg: 0 });
    expect(sw.damage).toBe(50);
    expect(sw.applies).toBeUndefined();
    expect(sw.explosion).toBeDefined();
    expect(sw.explosion).toMatchObject({
      radius: 60,
      damage: 15,
      lingerMs: 2000,
      damageMode: "perEntry",
    });
    expect(sw.explosion!.applies).toEqual([{ statusId: "corroded", target: "opponents", durationMs: 2000 }]);
  });

  it("keeps the field alive long enough to be driven into and out of (LZ17)", () => {
    // 2000 ms at 30 Hz. The old 150 ms was 40 units of travel at Mirage's top speed — under one
    // car length — so nothing could enter a field that was not already standing in it.
    expect(weaponTicksOf("magmablast").explosion!.lifetime).toBe(60);
  });

  it("keeps Bullseye's straight-line reach further than anything Bastion carries", () => {
    // T1's "1 beats 3" edge, asserted rather than asserted-in-prose. Bullseye's longest straight
    // reach is now `predator`'s 1800 (moved onto Bullseye's slot 1 by the 2026-09-02 loadout swap;
    // it used to be `magmablast`'s 900).
    //
    // The `bounces`-exclusion below is a DELIBERATE, documented exclusion, not a workaround:
    // `thumper.range` (1305) is the total length of a bounce PATH — 450 u/s for its `lifetimeMs`
    // (2.9s), zigzagging off whatever walls it meets — not a distance Bastion can point straight at
    // a kiting Bullseye and threaten. A poke is measured by how far a shot reaches in the direction
    // it was fired, and a bouncing shot's `range` field does not answer that question, so the guard
    // compares straight-line pokes only and excludes any `bounces`-carrying row from both sides of
    // the comparison. That exclusion still applies post-swap: `thumper` stays on Bastion, unmoved.
    //
    // Read literally, off `WEAPON_TABLE` alone and with no notion of "straight" at all, `predator`'s
    // 1800 is the single largest `range` value in the whole roster — larger than `thumper`'s bounced
    // 1305 and `lance`'s 1200. Since `predator` does not bounce, this is no longer even a "read
    // literally" curiosity: the guard's own straight-line comparison now puts the roster's biggest
    // number on Bullseye's side by a wide margin, not the narrow "longer than Bastion's" claim this
    // test used to have to settle for. `roadblock`'s cutdown-from-skewer 500 is Bastion's real
    // straight reach.
    const straightReach = (id: CarId) =>
      Math.max(
        0,
        ...slotsOf(id)
          .map((w) => weaponDefOf(w))
          .filter((def) => !(def.kind === "projectile" && def.bounces))
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
    const applied = new Set<StatusId>();
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      for (const a of def.applies ?? []) applied.add(a.statusId);
      // An explosion's statuses are reachable too — corroded's only source since 2026-09-02.
      if (def.kind === "projectile") {
        for (const a of def.explosion?.applies ?? []) applied.add(a.statusId);
      }
    }
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

  describe("explosions (spec P22-P27)", () => {
    it("requires a positive radius and something to do", () => {
      for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
        if (def.kind !== "projectile" || !def.explosion) continue;
        expect(def.explosion.radius, def.id).toBeGreaterThan(0);
        expect(def.explosion.lingerMs, def.id).toBeGreaterThan(0);
        const doesSomething =
          def.explosion.damage > 0 || (def.explosion.applies?.length ?? 0) > 0;
        expect(doesSomething, `${def.id}'s explosion must do something`).toBe(true);
      }
    });

    it("targets only opponents — self is refused by canDamage, ownerInside is a zone concept", () => {
      for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
        if (def.kind !== "projectile" || !def.explosion) continue;
        for (const a of def.explosion.applies ?? []) {
          expect(a.target, `${def.id}'s explosion`).toBe("opponents");
        }
      }
    });

    it("resolves an explosion instance to a real disc beam def, and never to another explosion", () => {
      const burst = instanceDefOf("magmablast", true);
      expect(burst.kind).toBe("beam");
      expect(burst.id).toBe("magmablast");
      expect(burst.color).toBe(WEAPON_TABLE.magmablast.color);
      if (burst.kind !== "beam") throw new Error("unreachable");
      expect(burst.hitbox).toEqual({ shape: "disc" });
      expect(burst.origin).toBe("center");
      expect(burst.attached).toBe(false);
      expect(burst.range).toBe(WEAPON_TABLE.magmablast.explosion!.radius);
      expect(burst.damage).toBe(WEAPON_TABLE.magmablast.explosion!.damage);
      expect(burst.damageFrequencyMs).toBe(0);
      // P25a: a BeamWeaponDef has no `explosion` field, so a burst cannot spawn a burst.
      expect("explosion" in burst).toBe(false);
    });

    it("returns the plain def when the instance is not an explosion", () => {
      // `toEqual`, not `toBe`: `instanceDefOf` now reads the installed mode bundle's own `weapons`
      // (MC14) — a `structuredClone` of `WEAPON_TABLE` taken once when that bundle was assembled —
      // so it is value-equal to `WEAPON_TABLE.magmablast` but no longer the identical object.
      expect(instanceDefOf("magmablast", false)).toEqual(WEAPON_TABLE.magmablast);
    });

    it("synthesizes once, so the def is referentially stable", () => {
      expect(instanceDefOf("magmablast", true)).toBe(instanceDefOf("magmablast", true));
    });

    it("makes every explosion state its damage mode (LZ5)", () => {
      for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
        if (def.kind !== "projectile" || !def.explosion) continue;
        expect(["onceEver", "perEntry"], def.id).toContain(def.explosion.damageMode);
      }
    });

    it("reads the mode back off the row, and undefined for a weapon with no explosion (LZ10a)", () => {
      expect(explosionDamageModeOf("magmablast")).toBe(WEAPON_TABLE.magmablast.explosion.damageMode);
      // `lance` is a beam and authors no explosion at all.
      expect(explosionDamageModeOf("lance")).toBeUndefined();
    });
  });
});

describe("ImpulseDef", () => {
  it("declares every status an impulse applies, naming none in code", () => {
    const imp = WEAPON_TABLE.wildcharge.impulse!;
    expect(imp.applies.map((a) => a.statusId)).toEqual(["reeling"]);
    expect(imp.applies[0]!.durationMs).toBe(1400);
    expect(imp.onWallImpact!.windowMs).toBe(500);
    expect(imp.onWallImpact!.applies.map((a) => a.statusId)).toEqual(["stunned"]);
    expect(imp.onWallImpact!.applies[0]!.durationMs).toBe(500);
  });

  it("accepts any real status id on either list — that is the point of the restructure", () => {
    for (const def of Object.values(WEAPON_TABLE)) {
      if (def.impulse === undefined) continue;
      for (const a of def.impulse.applies) expect(isStatusId(a.statusId), def.id).toBe(true);
      for (const a of def.impulse.onWallImpact?.applies ?? []) {
        expect(isStatusId(a.statusId), def.id).toBe(true);
      }
    }
  });

  it("bounds every impulse application's duration, on both lists", () => {
    // The restructure replaced a single `uncontrolMs` field with two lists and took its bound with
    // it, which left an impulse application the only status application in the table under no
    // bound at all — a row could author 60 s against a 10 s ceiling with the suite green.
    // `status-config.test.ts` walks `WEAPON_TABLE[id].applies` and does not reach here, so this is
    // where the same rule is asserted over the new shape.
    //
    // The LOWER bound is what `ram-bridge.ts` relies on: `applyStatus` refuses a non-positive
    // duration outright, so a row authoring 0 would push its victim and silently apply nothing.
    // The UPPER bound is the one `weapon-ticks.ts` now clamps — asserted here as well as clamped,
    // because a clamp that silently rewrites an author's number is a worse way to find out than a
    // failing test naming the row.
    for (const def of Object.values(WEAPON_TABLE)) {
      if (def.impulse === undefined) continue;
      const lists: [string, readonly { statusId: StatusId; durationMs: number }[]][] = [
        ["applies", def.impulse.applies],
        ["onWallImpact.applies", def.impulse.onWallImpact?.applies ?? []],
      ];
      for (const [where, list] of lists) {
        for (const a of list) {
          const label = `${def.id} impulse.${where} ${a.statusId}`;
          expect(a.durationMs, label).toBeGreaterThan(0);
          expect(a.durationMs, label).toBeLessThanOrEqual(STATUS_CONFIG.maxDurationMs);
        }
      }
    }
  });

  it("clamps an over-long impulse duration to the status ceiling, as every sibling list does", () => {
    // No shipped row authors an over-long duration — the guard above forbids it — so the clamp can
    // only be proved through the one path that can author one at runtime. This is also exactly how
    // its ABSENCE would have reached a player: the playground is where a tuner types a big number.
    //
    // (This briefly had to be proved a different way, through `resolveTicks` directly rather than
    // `setTuning`, while `setTuning` mutated the live `WEAPON_TABLE` in place but the accessors had
    // already moved onto the mode bundle. Fix round 1 rewrote `setTuning` to install a fresh bundle
    // instead, which is what makes the live-override form here correct again.)
    const over = STATUS_CONFIG.maxDurationMs + 5000;
    try {
      setTuning({
        "weapon.wildcharge.impulse.applies.0.durationMs": over,
        "weapon.wildcharge.impulse.onWallImpact.applies.0.durationMs": over,
      });
      const ticks = weaponTicksOf("wildcharge");
      expect(ticks.impulse!.applies[0]!.durationTicks).toBe(msToTicks(STATUS_CONFIG.maxDurationMs));
      expect(ticks.impulse!.onWallImpact!.applies[0]!.durationTicks).toBe(
        msToTicks(STATUS_CONFIG.maxDurationMs),
      );
      // The window is not a status duration and is deliberately left alone.
      expect(ticks.impulse!.onWallImpact!.windowTicks).toBe(msToTicks(500));
    } finally {
      setTuning(null);
    }
  });

  it("converts every impulse duration to ticks exactly once", () => {
    const ticks = WEAPON_TICKS.wildcharge.impulse!;
    expect(ticks.applies[0]!.statusId).toBe("reeling");
    expect(ticks.applies[0]!.durationTicks).toBe(msToTicks(1400));
    expect(ticks.onWallImpact!.windowTicks).toBe(msToTicks(500));
    expect(ticks.onWallImpact!.applies[0]!.durationTicks).toBe(msToTicks(500));
  });

  it("leaves onWallImpact absent rather than zeroed when a row declares none", () => {
    // Absent must mean absent — the same rule `WeaponTicks.impulse` already follows. A zero-length
    // window would arm a sweep that can never fire, which is worse than not arming one.
    const bare: ImpulseDef = {
      speed: 1, direction: "radial", spin: 0, defenceScaled: false, applies: [],
    };
    expect(bare.onWallImpact).toBeUndefined();
  });

  it("leaves rows without an impulse undefined rather than defaulted", () => {
    // Absent must mean absent. A zero-valued default would make every weapon a nudge.
    expect(WEAPON_TABLE.pepperbox.impulse).toBeUndefined();
    expect(WEAPON_TICKS.pepperbox.impulse).toBeUndefined();
  });

  it("keeps every authored direction on `radial`, the only mode with a reader", () => {
    // Tightened from "is one of the two modes" (which the type already guarantees) to the mode the
    // one implemented path actually honours. `ram-bridge.ts` NEVER CONSULTS `direction`: a slam's
    // push takes the OBB contact normal `contact.ts` measured between the two hulls, because that
    // is the one vector the bridge cannot recompute from poses. `"radial"` for a CONTACT impulse
    // (source and target touching) IS that normal, so `wildcharge` is served correctly — but an
    // `"alongAim"` maneuver row would silently receive the contact normal instead of the shooter's
    // aim, and nothing else in the codebase would notice. There is a comment at the read site
    // recording the assumption; this is what makes it fail loudly.
    for (const row of Object.values(WEAPON_TABLE)) {
      if (row.impulse === undefined) continue;
      expect(row.impulse.direction, `${row.id}: "alongAim" has no reader — see ram-bridge.ts`).toBe("radial");
    }
  });

  it("keeps every authored spin at 0, which is a balance decision and no longer a physics one", () => {
    // This guard used to say a maneuver impulse HAD no lever arm: `contact.ts` put the victim's own
    // centre on the `ContactHit`, so any authored spin produced exactly zero rotation, silently.
    // Task 2 of this stage ended that — `push.contactX/Y` is a genuine hull point from
    // `contactPointOn`, so `applyImpulse` now measures a real arm and an authored spin rotates.
    //
    // What survives is the BALANCE claim: the roster's one impulse row is `wildcharge`, a clean
    // straight punt is the ult's signature (spec P28/P31), and nothing has re-pitched it. So this
    // pins the shipped table rather than a missing mechanism, and the day someone wants a spinning
    // charge they move this assertion and the row together — deliberately, with the slam's feel
    // re-measured — instead of discovering the change in a playtest.
    for (const row of Object.values(WEAPON_TABLE)) {
      if (row.impulse === undefined) continue;
      expect(
        row.impulse.spin,
        `${row.id}: a spinning slam is a balance change — see ImpulseDef.spin`,
      ).toBe(0);
    }
  });

  it("thunderclap declares no impulse at all", () => {
    // Deliberate: it is a weapon whose effect is a status applied on contact, not a contact
    // mechanic. See spec principle C. Do not "fix" this.
    expect(WEAPON_TABLE.thunderclap.impulse).toBeUndefined();
  });

  it("keeps every declared impulse on a maneuver row, and every explosion impulse-free", () => {
    // SCOPE RULING (stage 4, Task 1): this stage deliberately does not build a generic application
    // path for a projectile/beam/explosion impulse — only a `kind: "maneuver"` row's impulse is
    // ever actually applied (wildcharge's slam, Tasks 2-3). Authoring one anywhere else would
    // silently do nothing, since the path to apply it does not exist yet; this guard names the
    // missing path instead of letting that be discovered as a silent no-op. The first branch
    // asserts for real against `wildcharge`, the roster's only `impulse` row and a `maneuver`; the
    // explosion branch is still vacuous, since no `ExplosionDef` declares one.
    for (const def of Object.values(WEAPON_TABLE) as WeaponDef[]) {
      if (def.impulse !== undefined) expect(def.kind, def.id).toBe("maneuver");
      if (def.kind === "projectile") {
        expect(def.explosion?.impulse, `${def.id}'s explosion`).toBeUndefined();
      }
    }
  });

  /**
   * The hardest ordinary ram the roster can produce, in u/s of victim Δv, derived from the live
   * config rather than typed (spec §7.2's shove formula at its extremes).
   *
   * The maximum is reachable because every term is bounded: `driveIn` by the attacker's own top
   * speed, the type scale by the largest of the three, and the rating ratio by the roster's own
   * spread. The deleted contest had no such number — it was open-ended on purpose (R9) — which is
   * exactly why `wildcharge.impulse.speed`'s old "2x the ram maximum" comment had become a claim
   * about a quantity that did not exist.
   *
   * The whole table, not `activeCarIds()`: the question is what the game's physics can produce, and a
   * prototype chassis is driven in the playground long before it is published.
   */
  function hardestOrdinaryRam(): number {
    const ids = Object.keys(CAR_TABLE) as CarId[];
    const typeScale = Math.max(RAM_CONFIG.flankScale, RAM_CONFIG.rearScale, RAM_CONFIG.headOnScale);
    let hardest = 0;
    for (const attacker of ids) {
      for (const victim of ids) {
        const shove =
          forwardMaxSpeedOf(attacker) *
          typeScale *
          RAM_CONFIG.globalScale *
          (ramAttackOf(attacker) / ramDefenceOf(victim));
        if (shove > hardest) hardest = shove;
      }
    }
    return hardest;
  }

  /**
   * The hardest ram one chassis can land on **itself** — attacker and victim fixed to the same car,
   * swept over the whole roster the same way `hardestOrdinaryRam` sweeps every attacker×victim pair.
   *
   * This exists because `wildcharge` sets `defenceScaled: false` (it ignores `ramDefence`
   * entirely — the ult punts a victim exactly as hard whoever they are), so measuring it against
   * `hardestOrdinaryRam()` compares a defence-blind constant against the one matchup where defence
   * helps an ORDINARY ram the most: the roster's lowest-`ramDefence` chassis as victim, which is
   * always the same car regardless of attacker. Fixing attacker = victim drops that spread out of
   * the comparison — each car's own `ramAttack`/`ramDefence` still differ from each other, so this
   * is not "defence removed", only "the roster-wide defence SPREAD removed" — which is the one
   * degree of freedom `wildcharge` itself does not have.
   */
  function hardestMirrorRam(): number {
    const ids = Object.keys(CAR_TABLE) as CarId[];
    const typeScale = Math.max(RAM_CONFIG.flankScale, RAM_CONFIG.rearScale, RAM_CONFIG.headOnScale);
    let hardest = 0;
    for (const id of ids) {
      const shove =
        forwardMaxSpeedOf(id) * typeScale * RAM_CONFIG.globalScale * (ramAttackOf(id) / ramDefenceOf(id));
      if (shove > hardest) hardest = shove;
    }
    return hardest;
  }

  it("punts at least as hard as anything driving alone can produce", () => {
    // RULING T5-b (stage 5 Task 5). This used to be one assertion doing two jobs — "is this still an
    // ult" and "is this the hardest thing in the game" — and only the first was ever the design
    // goal, so it is now two assertions with two different bars. This one is the FLOOR: nowhere in
    // the roster does plain driving beat the ult. It is deliberately the weaker of the two bars —
    // see the identity assertion below for the one that actually guards the ult's IDENTITY.
    //
    // Not hashed by `balanceStamp` (`RAM_CONFIG` is outside its coverage), so a stage-5-style retune
    // of `globalScale` or `flankScale` moves every ram in the game with no page rebuild and no other
    // failing test — this and the assertion below are what notice.
    const slam = WEAPON_TABLE.wildcharge.impulse!;
    expect(slam.speed).toBeGreaterThanOrEqual(hardestOrdinaryRam());
  });

  it("punts meaningfully harder than the hardest ram a chassis can land on its own mirror", () => {
    // RULING T5-b, continued. The IDENTITY bar: at least 1.5x the hardest RAM available on the one
    // matchup where `defenceScaled: false` costs `wildcharge` nothing extra to compare against — a
    // chassis ramming its own mirror, where the roster-wide `ramDefence` spread `wildcharge` ignores
    // has already dropped out (see `hardestMirrorRam`'s own comment). Measured against the best
    // ordinary ram on the SAME victim instead, the settled values put the ult at 1.85x vs Mirage and
    // 3.33x vs Bastion — this bar is the conservative one of the two, not the tight one.
    //
    // The user considered raising `wildcharge.impulse.speed` to satisfy the OLD single bar
    // (`hardestOrdinaryRam() * 1.5`, which the settled `globalScale` raise moved to 701.77) and
    // declined (ruling T5-a): that would need 702 as a floor or 936 to restore the old 2.00x
    // headline, either of which extends the ult's 500 ms wall-stun reach and its punt against the
    // roster's softest chassis specifically — a design change, not a guard fix. 520 stays, and the
    // guard is re-aimed at the bar that was always the actual design goal instead.
    //
    // THIS BAR HAS ONLY ~8% HEADROOM (520 vs 481.96 = `hardestMirrorRam() * 1.5`) — recorded so the
    // next reader does not mistake a future failure here for flakiness: a further ram-power increase
    // (a `globalScale`/`flankScale` raise, or a `ramAttack` buff) trips this on the first pass that
    // narrows the gap, and that is a true positive, not a false one.
    const slam = WEAPON_TABLE.wildcharge.impulse!;
    expect(slam.speed).toBeGreaterThanOrEqual(hardestMirrorRam() * 1.5);
  });

  it("leaves its victim reeling for longer than a full-strength ram does", () => {
    // Both durations mean the same thing since spec U31: `reeling` is a total loss of control, not a
    // 60% steering debuff. An ult on a 20 s cooldown must outlast the thing anyone can do by driving.
    // A slam is also never falloff-scaled (U6), so this is the floor as well as the ceiling.
    const slam = WEAPON_TABLE.wildcharge.impulse!;
    const reel = slam.applies.find((a) => a.statusId === "reeling")!;
    expect(reel.durationMs).toBeGreaterThan(RAM_CONFIG.ramUncontrolMs);
  });
});
