import { isArenaId } from "../arena/registry.js";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { DEFAULT_CAR_ID, isCarId } from "../config/car-config.js";
import type { CarId } from "../config/types.js";
import { isWeaponId } from "../config/weapon-config.js";
import { slotsOf } from "../config/weapon-slots.js";
import type { WeaponId } from "../config/weapon-types.js";

/** Dev-only room name (spec PG3). Never registered in a release build. */
export const PLAYGROUND_ROOM_NAME = "playground";

/** Session id reserved for the playground's own bot car, never assignable to a real client. */
export const BOT_SESSION_ID = "bot";

export const MSG_PLAYGROUND_PAUSE = "pg_pause"; // no payload: toggle
export const MSG_PLAYGROUND_SWITCH = "pg_switch"; // no payload: flip control
export const MSG_PLAYGROUND_TUNING = "pg_tuning"; // payload: TuningOverrides (flat object)
export const MSG_PLAYGROUND_SETUP = "pg_setup"; // payload: PlaygroundSetup

export interface PlaygroundCarSetup {
  carId: CarId;
  weapons: readonly [WeaponId, WeaponId, WeaponId];
}

export interface PlaygroundSetup {
  botEnabled: boolean;
  arenaId: string;
  me: PlaygroundCarSetup;
  opponent: PlaygroundCarSetup;
}

/**
 * A car's chosen carId plus a 3-slot loadout, ANY valid `CarId` (not just an active one — spec PG20
 * lets the playground drive a chassis the live roster has retired or not yet activated) with three
 * real, distinct weapon ids in its own slots. The same weapon on the OTHER car is legal — only a
 * dupe within one car's own three slots is rejected (spec PG17).
 */
function isPlaygroundCarSetup(value: unknown): value is PlaygroundCarSetup {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (!isCarId(rec.carId)) return false;
  const weapons = rec.weapons;
  if (!Array.isArray(weapons) || weapons.length !== 3) return false;
  if (!weapons.every((w) => isWeaponId(w))) return false;
  return new Set(weapons).size === weapons.length;
}

/** Validates a `pg_setup` payload off the wire. `isCarId`/`isWeaponId`/`isArenaId` all reject an id
 * that only exists via the prototype chain (`"toString"`, `"constructor"`), so this does too. */
export function isPlaygroundSetup(msg: unknown): msg is PlaygroundSetup {
  if (msg === null || typeof msg !== "object") return false;
  const rec = msg as Record<string, unknown>;
  return (
    typeof rec.botEnabled === "boolean" &&
    typeof rec.arenaId === "string" &&
    isArenaId(rec.arenaId) &&
    isPlaygroundCarSetup(rec.me) &&
    isPlaygroundCarSetup(rec.opponent)
  );
}

/** The playground's opening setup (spec PG20): the default chassis's shipped loadout on both cars,
 * the live arena, bot on. */
export function defaultPlaygroundSetup(): PlaygroundSetup {
  const [slot0, slot1, slot2] = slotsOf(DEFAULT_CAR_ID);
  const weapons: readonly [WeaponId, WeaponId, WeaponId] = [slot0!, slot1!, slot2!];
  return {
    botEnabled: true,
    arenaId: ACTIVE_ARENA_ID,
    me: { carId: DEFAULT_CAR_ID, weapons },
    opponent: { carId: DEFAULT_CAR_ID, weapons },
  };
}
