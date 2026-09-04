import { weaponDefOf } from "@motor-combat-moba/shared";
import type { BotSlotView } from "../types.js";

/**
 * Tactics a kit can actually run, derived from live `WeaponDef` rows (G10).
 *
 * No new weapon-table fields: a new weapon inherits behaviour from `applies`, `kind`,
 * `usesAimAssist`, `homing`, `explosion`, pellets, and `holdsDuringFire`. Slot indices are what
 * `chooseSlot` has to press; the arrays are what scoring/lock-wait consults.
 */
export interface KitRoles {
  setupCcSlot: number | undefined;
  contactSlot: number | undefined;
  lockAimSlots: readonly number[];
  lockHomingSlots: readonly number[];
  shotgunSlots: readonly number[];
  explosionSlots: readonly number[];
  holdBeamSlots: readonly number[];
  slowSlot: number | undefined;
}

const EMPTY: KitRoles = {
  setupCcSlot: undefined,
  contactSlot: undefined,
  lockAimSlots: [],
  lockHomingSlots: [],
  shotgunSlots: [],
  explosionSlots: [],
  holdBeamSlots: [],
  slowSlot: undefined,
};

function appliesStatus(
  def: ReturnType<typeof weaponDefOf>,
  statusId: string,
  target: "opponents",
): boolean {
  return def.applies?.some((a) => a.statusId === statusId && a.target === target) === true;
}

export function rolesOf(slots: readonly BotSlotView[]): KitRoles {
  const lockAimSlots: number[] = [];
  const lockHomingSlots: number[] = [];
  const shotgunSlots: number[] = [];
  const explosionSlots: number[] = [];
  const holdBeamSlots: number[] = [];
  let setupCcSlot: number | undefined;
  let contactSlot: number | undefined;
  let slowSlot: number | undefined;

  for (let i = 0; i < slots.length; i++) {
    const def = weaponDefOf(slots[i]!.weaponId);
    if (appliesStatus(def, "stunned", "opponents") && setupCcSlot === undefined) setupCcSlot = i;
    if (def.kind === "maneuver" && contactSlot === undefined) contactSlot = i;
    if (def.usesAimAssist) lockAimSlots.push(i);
    if (def.kind === "projectile" && def.homing?.acquire === "lock") lockHomingSlots.push(i);
    if (def.kind === "projectile" && def.pellets.pelletsPerVolley > 1) shotgunSlots.push(i);
    if (def.kind === "projectile" && def.explosion) explosionSlots.push(i);
    if (def.kind === "beam" && def.holdsDuringFire) holdBeamSlots.push(i);
    if (appliesStatus(def, "spiked", "opponents") && slowSlot === undefined) slowSlot = i;
  }

  if (
    setupCcSlot === undefined && contactSlot === undefined && slowSlot === undefined &&
    lockAimSlots.length === 0 && lockHomingSlots.length === 0 && shotgunSlots.length === 0 &&
    explosionSlots.length === 0 && holdBeamSlots.length === 0
  ) {
    return EMPTY;
  }

  return {
    setupCcSlot, contactSlot, lockAimSlots, lockHomingSlots,
    shotgunSlots, explosionSlots, holdBeamSlots, slowSlot,
  };
}
