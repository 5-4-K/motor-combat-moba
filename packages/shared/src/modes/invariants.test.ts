// MC42: every existing config invariant the project relies on runs PER MODE and names the
// offending mode on failure. Today both modes carry identical values, so every one of these
// passes — their value is the day someone tunes one mode and breaks a rule in it alone.
//
// MC38 (wire-width bounds): per-mode values must fit the schema types they cross the network in.
// These do not error when exceeded on the real wire — they truncate silently, producing a car
// that dies at the wrong HP with nothing in the log — which is why they are worth a test rather
// than a comment.
//
// Not every field MC38 lists has a per-mode config source to bound. `kills`, `deaths` and `team`
// are runtime counters/flags — nothing in `ModeConfig` authors a ceiling for them, so there is
// nothing mode-specific to assert; the uint8 schema type is their only guard, and it is enforced
// by Colyseus at the field declaration, not by any config value. `colorId` (`COLOR_TABLE`, MC36)
// and `maneuver` (`ManeuverKind`, `sim/maneuver.ts`) are GLOBAL, not per-mode (MC36/MC32), so they
// are asserted once below rather than inside the per-mode loop.
import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "../constants.js";
import { ABILITY_SLOT_CEILING } from "../config/weapon-slots.js";
import { COLOR_TABLE } from "../config/color-config.js";
import { ManeuverKind } from "../sim/maneuver.js";
import { PlayerState } from "../schema/PlayerState.js";
import { isArenaId, getArena } from "../arena/registry.js";
import { winRuleOf } from "../flow/modes.js";
import { activeCarIds } from "../config/car-config.js";
import { withMode } from "./active.js";
import { MODE_TABLE } from "./registry.js";

const UINT8_MAX = 255;
const UINT16_MAX = 65535;
const INT8_MIN = -128;
const INT8_MAX = 127;

for (const def of Object.values(MODE_TABLE)) {
  describe(`mode ${def.name}`, () => {
    it("carries maxAbilitySlots within [1, ABILITY_SLOT_CEILING] (MC33)", () => {
      expect(
        def.config.slots.maxAbilitySlots,
        `${def.name}: maxAbilitySlots ${def.config.slots.maxAbilitySlots}`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        def.config.slots.maxAbilitySlots,
        `${def.name}: maxAbilitySlots ${def.config.slots.maxAbilitySlots}`,
      ).toBeLessThanOrEqual(ABILITY_SLOT_CEILING);
    });

    it("derives maxFireSlots from maxAbilitySlots (MC28)", () => {
      expect(
        def.config.slots.maxFireSlots,
        `${def.name}: maxFireSlots ${def.config.slots.maxFireSlots} vs maxAbilitySlots+1 ${def.config.slots.maxAbilitySlots + 1}`,
      ).toBe(def.config.slots.maxAbilitySlots + 1);
      expect(
        def.config.slots.basicAttackSlotIndex,
        `${def.name}: basicAttackSlotIndex ${def.config.slots.basicAttackSlotIndex}`,
      ).toBe(0);
    });

    it("gives no weapon to two chassis (L1, weapon exclusivity)", () => {
      const seen = new Map<string, string>();
      for (const car of Object.values(def.config.cars)) {
        for (const w of [...car.weapons, car.basicAttack]) {
          expect(seen.has(w), `${w} on ${seen.get(w)} and ${car.id} in ${def.name}`).toBe(false);
          seen.set(w, car.id);
        }
      }
    });

    it("caps seats at MAX_PLAYERS and needs at least two (MC34)", () => {
      expect(
        def.config.maxPlayers,
        `${def.name}: maxPlayers ${def.config.maxPlayers}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        def.config.maxPlayers,
        `${def.name}: maxPlayers ${def.config.maxPlayers}`,
      ).toBeLessThanOrEqual(MAX_PLAYERS);
    });

    it("puts an impulse only on a maneuver row", () => {
      for (const w of Object.values(def.config.weapons)) {
        if ("impulse" in w && w.impulse) {
          expect(w.kind, `${w.id} in ${def.name} carries an impulse but kind is "${w.kind}"`).toBe(
            "maneuver",
          );
        }
      }
    });

    it("names at least one arena, all of them registered (MC23)", () => {
      // An empty set makes arenas[0] undefined and getArena throws MID-MATCH, killing the room;
      // an unregistered id does the same one tick later. Both must fail the suite, not the match.
      expect(def.config.arenas.length).toBeGreaterThan(0);
      for (const id of def.config.arenas) expect(isArenaId(id)).toBe(true);
    });

    it("truncates an over-long kit silently, and only warns past the ceiling", () => {
      for (const car of Object.values(def.config.cars)) {
        expect(
          car.weapons.length,
          `${def.name}: ${car.id} carries ${car.weapons.length} weapons, past the ceiling ${ABILITY_SLOT_CEILING}`,
        ).toBeLessThanOrEqual(ABILITY_SLOT_CEILING);
      }
    });

    // --- MC38: wire-width bounds -----------------------------------------------------------

    it("keeps every car's actual hp within uint16 (MC38)", () => {
      for (const car of Object.values(def.config.cars)) {
        const actualHp = car.hp * def.config.combat.hpPerRating;
        expect(
          actualHp,
          `${def.name}: ${car.id}'s actual hp ${actualHp} (rating ${car.hp} * hpPerRating ${def.config.combat.hpPerRating}) exceeds uint16`,
        ).toBeLessThanOrEqual(UINT16_MAX);
        expect(actualHp, `${def.name}: ${car.id}'s actual hp ${actualHp} is negative`).toBeGreaterThanOrEqual(0);
      }
    });

    it("keeps every weapon's unlocksAt reachable by a uint8 level (MC38)", () => {
      for (const w of Object.values(def.config.weapons)) {
        expect(
          w.unlocksAt,
          `${def.name}: ${w.id}'s unlocksAt ${w.unlocksAt} can never be reached by a uint8 level field`,
        ).toBeLessThanOrEqual(UINT8_MAX);
      }
    });

    it("keeps the highest fire-slot index within int8, so lastFiredSlot never truncates (MC38)", () => {
      const highestSlotIndex = def.config.slots.maxFireSlots - 1;
      expect(
        highestSlotIndex,
        `${def.name}: highest fire-slot index ${highestSlotIndex} overflows int8`,
      ).toBeLessThanOrEqual(INT8_MAX);
      expect(
        highestSlotIndex,
        `${def.name}: highest fire-slot index ${highestSlotIndex} underflows int8`,
      ).toBeGreaterThanOrEqual(INT8_MIN);
      // The "never fired" sentinel `lastFiredSlot` also carries — a fixed literal, not mode-derived,
      // but it shares the same wire field so it is worth pinning here too. Corrected 2026-09-22
      // (final review): this used to read `expect(-1).toBeGreaterThanOrEqual(INT8_MIN)` — two
      // literals compared against each other, which cannot fail no matter what either constant is
      // and so was not actually pinning anything. Reading the sentinel off a real `PlayerState`
      // instance instead means a future edit to the schema's own default (`@type("int8")
      // lastFiredSlot = -1`) is what this assertion actually watches.
      const neverFiredSentinel = new PlayerState().lastFiredSlot;
      expect(
        neverFiredSentinel,
        `PlayerState.lastFiredSlot's "never fired" sentinel ${neverFiredSentinel} underflows int8`,
      ).toBeGreaterThanOrEqual(INT8_MIN);
    });

    it(`${def.name}: a conquer-rule mode plays only arenas that have a zone (CQ20)`, () => {
      if (winRuleOf(def.id) !== "conquer") return;
      for (const arenaId of def.config.arenas) {
        expect(getArena(arenaId).zone, `${def.name} lists ${arenaId}, which has no zone`).toBeDefined();
      }
    });

    it(`${def.name}: a conquer-rule mode's teamSize fits its active roster (CQ27)`, () => {
      if (winRuleOf(def.id) !== "conquer") return;
      withMode(def.config, () => {
        expect(def.config.conquer.teamSize).toBeLessThanOrEqual(activeCarIds().length);
        expect(def.config.conquer.teamSize * 2).toBeLessThanOrEqual(def.config.maxPlayers);
      });
    });
  });
}

// --- MC38: the two wire-width bounds with no PER-MODE source (MC32/MC36, global) -------------
//
// `colorId` indexes the global `COLOR_TABLE` (MC36); `maneuver` holds a `ManeuverKind` value
// (MC32, an explicit/stable enum). Neither varies by mode, so each is asserted once rather than
// inside the per-mode loop above.
describe("global wire-width bounds with no per-mode source (MC38)", () => {
  it("keeps every COLOR_TABLE index within uint8 (colorId)", () => {
    expect(COLOR_TABLE.length - 1).toBeLessThanOrEqual(UINT8_MAX);
    expect(COLOR_TABLE.length - 1).toBeGreaterThanOrEqual(0);
  });

  it("keeps every ManeuverKind value within uint8 (maneuver)", () => {
    for (const value of Object.values(ManeuverKind)) {
      expect(value).toBeLessThanOrEqual(UINT8_MAX);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
