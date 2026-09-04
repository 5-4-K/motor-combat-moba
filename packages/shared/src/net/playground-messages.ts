import { isArenaId } from "../arena/registry.js";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { DEFAULT_CAR_ID, isCarId } from "../config/car-config.js";
import { isColorId } from "../config/color-config.js";
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

/** Dev-only: what the bot was thinking, for the playground overlay (H12). Never sent by a client. */
export const MSG_PLAYGROUND_BOT_DEBUG = "playground-bot-debug";

const STANCES = [
  "engage", "brawl", "kite", "disengage", "reposition", "hunt", "recover",
] as const;

export interface BotDebugPayload {
  tick: number;
  stance: string;
  targetSessionId: string;
  preferredRange: number;
  personality: string;
  /** -1 when the bot held fire; a slot index otherwise. */
  firedSlot: number;
}

export function isBotDebugPayload(value: unknown): value is BotDebugPayload {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.tick === "number" &&
    typeof rec.stance === "string" &&
    (STANCES as readonly string[]).includes(rec.stance) &&
    typeof rec.targetSessionId === "string" &&
    typeof rec.preferredRange === "number" &&
    typeof rec.personality === "string" &&
    typeof rec.firedSlot === "number"
  );
}

/** How hard the playground's bot plays (PG27). Wire value is the literal string, not an index. */
export type BotDifficulty = "easy" | "medium" | "hard";

const BOT_DIFFICULTIES: readonly BotDifficulty[] = ["easy", "medium", "hard"];

/** Narrows a `<select>`'s string, and guards the wire. Uses `includes` over a frozen list rather
 * than an object lookup, so a prototype-chain name (`"toString"`) can never pass. */
export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return typeof value === "string" && BOT_DIFFICULTIES.includes(value as BotDifficulty);
}

export interface PlaygroundCarSetup {
  carId: CarId;
  /** Index into `COLOR_TABLE` (PG31). Purely visual: a colour change never respawns (PG32). */
  colorId: number;
  weapons: readonly [WeaponId, WeaponId, WeaponId];
}

export interface PlaygroundSetup {
  botEnabled: boolean;
  botDifficulty: BotDifficulty;
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
  if (!isColorId(rec.colorId)) return false;
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
    isBotDifficulty(rec.botDifficulty) &&
    typeof rec.arenaId === "string" &&
    isArenaId(rec.arenaId) &&
    isPlaygroundCarSetup(rec.me) &&
    isPlaygroundCarSetup(rec.opponent)
  );
}

/** The playground's opening setup (PG20/PG26): the default chassis's shipped loadout on both cars,
 * the live arena, and — since most sessions open by driving rather than fighting — the bot OFF, on
 * medium for whenever it is switched on. The two `colorId`s are the first two of `COLOR_TABLE` and
 * are deliberately distinct, so a fresh playground never opens with two identically-painted cars. */
export function defaultPlaygroundSetup(): PlaygroundSetup {
  const [slot0, slot1, slot2] = slotsOf(DEFAULT_CAR_ID);
  const weapons: readonly [WeaponId, WeaponId, WeaponId] = [slot0!, slot1!, slot2!];
  return {
    botEnabled: false,
    botDifficulty: "medium",
    arenaId: ACTIVE_ARENA_ID,
    me: { carId: DEFAULT_CAR_ID, colorId: 0, weapons },
    opponent: { carId: DEFAULT_CAR_ID, colorId: 1, weapons },
  };
}
