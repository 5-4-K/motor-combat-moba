import { describe, expect, it } from "vitest";
import { weaponDefOf, type WeaponId } from "@motor-combat-moba/shared";
import type { BotSlotView } from "../types.js";
import { rolesOf } from "./roles.js";

function slot(weaponId: WeaponId): BotSlotView {
  return {
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  };
}

function has(list: readonly number[], index: number): boolean {
  return list.includes(index);
}

describe("rolesOf", () => {
  it("classifies every current weapon id (G10)", () => {
    const ids = [
      "predator", "thunderclap", "afterburner", "magmablast", "pepperbox",
      "lance", "thumper", "roadblock", "wildcharge", "tremor",
    ] as const satisfies readonly WeaponId[];

    const expected: Record<WeaponId, {
      setupCc: boolean; contact: boolean; lockAim: boolean; lockHoming: boolean;
      shotgun: boolean; explosion: boolean; holdBeam: boolean; slow: boolean;
    }> = {
      predator: { setupCc: false, contact: false, lockAim: true, lockHoming: false, shotgun: false, explosion: false, holdBeam: false, slow: false },
      thunderclap: { setupCc: true, contact: true, lockAim: true, lockHoming: false, shotgun: false, explosion: false, holdBeam: false, slow: false },
      afterburner: { setupCc: false, contact: false, lockAim: false, lockHoming: false, shotgun: false, explosion: false, holdBeam: false, slow: false },
      magmablast: { setupCc: false, contact: false, lockAim: true, lockHoming: false, shotgun: false, explosion: true, holdBeam: false, slow: false },
      pepperbox: { setupCc: false, contact: false, lockAim: false, lockHoming: false, shotgun: true, explosion: false, holdBeam: false, slow: false },
      lance: { setupCc: false, contact: false, lockAim: false, lockHoming: false, shotgun: false, explosion: false, holdBeam: true, slow: false },
      thumper: { setupCc: false, contact: false, lockAim: true, lockHoming: false, shotgun: false, explosion: false, holdBeam: false, slow: true },
      roadblock: { setupCc: true, contact: false, lockAim: false, lockHoming: false, shotgun: false, explosion: false, holdBeam: false, slow: false },
      wildcharge: { setupCc: false, contact: true, lockAim: false, lockHoming: false, shotgun: false, explosion: false, holdBeam: false, slow: false },
      tremor: { setupCc: false, contact: false, lockAim: false, lockHoming: false, shotgun: false, explosion: false, holdBeam: false, slow: true },
    };

    for (const id of ids) {
      const roles = rolesOf([slot(id)]);
      const want = expected[id];
      expect(roles.setupCcSlot === 0, `${id} setupCc`).toBe(want.setupCc);
      expect(roles.contactSlot === 0, `${id} contact`).toBe(want.contact);
      expect(has(roles.lockAimSlots, 0), `${id} lockAim`).toBe(want.lockAim);
      expect(has(roles.lockHomingSlots, 0), `${id} lockHoming`).toBe(want.lockHoming);
      expect(has(roles.shotgunSlots, 0), `${id} shotgun`).toBe(want.shotgun);
      expect(has(roles.explosionSlots, 0), `${id} explosion`).toBe(want.explosion);
      expect(has(roles.holdBeamSlots, 0), `${id} holdBeam`).toBe(want.holdBeam);
      expect(roles.slowSlot === 0, `${id} slow`).toBe(want.slow);
    }
  });

  it("reports slot indices on a mixed kit, not just the first weapon", () => {
    // Bastion: thumper, roadblock, wildcharge
    const roles = rolesOf([slot("thumper"), slot("roadblock"), slot("wildcharge")]);
    expect(roles.setupCcSlot).toBe(1);
    expect(roles.contactSlot).toBe(2);
    expect(roles.slowSlot).toBe(0);
    expect(roles.lockAimSlots).toEqual([0]);
  });
});
