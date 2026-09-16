import { isArenaId } from "../arena/registry.js";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { DEFAULT_CAR_ID, isCarId } from "../config/car-config.js";
import { isColorId } from "../config/color-config.js";
import type { CarId } from "../config/types.js";
import { isWeaponId } from "../config/weapon-config.js";
import { slotsOf } from "../config/weapon-slots.js";
import type { WeaponId } from "../config/weapon-types.js";
import { MAX_PLAYERS } from "../constants.js";

/** Dev-only room name (spec PG3). Never registered in a release build. */
export const PLAYGROUND_ROOM_NAME = "playground";

/**
 * Session id reserved for `PracticeRoom`'s single bot seat, never assignable to a real client. The
 * playground no longer has a bot session of its own to reserve this for — since the six-car widening
 * (spec PG59) every playground car, human-driven or bot-driven, is one of the six `PLAYGROUND_SEAT_IDS`
 * — so this constant is `PracticeRoom`'s alone now, not shared between the two rooms the way its name
 * might suggest.
 */
export const BOT_SESSION_ID = "bot";

export const MSG_PLAYGROUND_PAUSE = "pg_pause"; // no payload: toggle
export const MSG_PLAYGROUND_TUNING = "pg_tuning"; // payload: TuningOverrides (flat object)
export const MSG_PLAYGROUND_SETUP = "pg_setup"; // payload: PlaygroundSetup

/** Dev-only: what the bot was thinking, for the playground overlay (H12). Never sent by a client. */
export const MSG_PLAYGROUND_BOT_DEBUG = "playground-bot-debug";

const SITUATIONS = [
  "recover", "waitOut", "evade", "unpin", "punish", "reset", "fight", "close",
] as const;

export interface BotDebugPayload {
  tick: number;
  situation: string;
  targetSessionId: string;
  preferredRange: number;
  personality: string;
  /** -1 when the bot held fire; a slot index otherwise. */
  firedSlot: number;
  /** Damage per second the bot believes it is standing in front of (P16). */
  dangerEv: number;
  /** The action the planner chose, and what it scored (P45). */
  planSteer: -1 | 0 | 1;
  planThrottle: -1 | 0 | 1;
  planScore: number;
  /**
   * Per-term contributions of the winning candidate (P45), as an OPEN map rather than one wire
   * field per term.
   *
   * The server's `BotDebug.planTerms` is `Record<keyof PlanWeights, number>` — a real derivation, so
   * a seventh planner term is picked up there for free. A flattened `termMyEv`…`termThreatAvoid`
   * spread did NOT inherit that: the names were declared here, written by name in
   * `PlaygroundRoom`'s broadcast, and read by name in the overlay, and reading six named properties
   * off a wider `Record` compiles cleanly while silently dropping the seventh. That is the
   * hand-kept-mirror failure class this codebase has already been bitten by twice
   * (`PROBABILITY_FIELDS`/`UNIT_INTERVAL_FIELDS` is the other), so the mirror is gone rather than
   * guarded: the room copies `Object.entries(planTerms)` wholesale and the overlay renders whatever
   * keys arrive. Shared cannot import the server-only `PlanWeights`, so the KEYS are deliberately
   * unconstrained here; `isBotDebugPayload` still pins the SHAPE at the boundary — a plain object
   * whose every value is a finite number.
   */
  terms: Record<string, number>;
  /** Best available shot value against the tier's RESOLVED absolute threshold (P45, R-V2). */
  shotEvBest: number;
  shotEvThreshold: number;
}

/**
 * Validates the open `terms` map: a plain object (an array is not one, and neither is `null`) whose
 * every OWN enumerable value is a finite number. `Object.values` rather than a key list, because the
 * whole point of the map is that shared does not know the key set; `Number.isFinite` rather than
 * `typeof === "number"`, because `NaN` and `±Infinity` both survive `JSON` round-trips as `null` and
 * neither is a term contribution the overlay could print.
 */
function isTermMap(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => Number.isFinite(v));
}

export function isBotDebugPayload(value: unknown): value is BotDebugPayload {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.tick === "number" &&
    typeof rec.situation === "string" &&
    (SITUATIONS as readonly string[]).includes(rec.situation) &&
    typeof rec.targetSessionId === "string" &&
    typeof rec.preferredRange === "number" &&
    typeof rec.personality === "string" &&
    typeof rec.firedSlot === "number" &&
    typeof rec.dangerEv === "number" &&
    (rec.planSteer === -1 || rec.planSteer === 0 || rec.planSteer === 1) &&
    (rec.planThrottle === -1 || rec.planThrottle === 0 || rec.planThrottle === 1) &&
    typeof rec.planScore === "number" &&
    isTermMap(rec.terms) &&
    typeof rec.shotEvBest === "number" &&
    typeof rec.shotEvThreshold === "number"
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

/**
 * How many cars the playground seats (spec PG56).
 *
 * DERIVED from `MAX_PLAYERS` rather than typed as `6`, so hard invariant 10 and the sandbox's
 * capacity cannot drift apart — a playground that seated more cars than the game allows would be
 * measuring a match that cannot happen.
 */
export const PLAYGROUND_SEATS = MAX_PLAYERS;

/**
 * The six seats' session ids, in seat order (spec PG56/PG57).
 *
 * STABLE, and owned by the seat rather than by a connection: the human's client `sessionId` names
 * no car in this room. That is what makes handing the wheel to another car a single field write on
 * `controlledSessionId` instead of re-keying a row in `state.players`, and it is what lets a
 * client-side per-car override (the tint map in `fx/car-tint.ts`) survive a page reload — keyed on a
 * Colyseus session id, the human's own tint was silently lost on every reconnect.
 *
 * Deliberately not `"bot"`-prefixed: a seat is a seat whether a human or a bot is driving it, and
 * `BOT_SESSION_ID` belongs to `PracticeRoom`, which is untouched by any of this (PG59).
 */
export const PLAYGROUND_SEAT_IDS: readonly string[] = Object.freeze(
  Array.from({ length: PLAYGROUND_SEATS }, (_, i) => `pg-${i}`),
);

export interface PlaygroundCarSetup {
  carId: CarId;
  /** Index into `COLOR_TABLE` (PG31). Purely visual: a colour change never respawns (PG32). */
  colorId: number;
  weapons: readonly [WeaponId, WeaponId, WeaponId];
  /**
   * Is this seat on the field (PG60)?
   *
   * A disabled seat still carries a full, valid configuration (PG62) — unchecking a car parks it,
   * it does not discard it. That is what makes "five cars, then a duel, then back" two clicks, and
   * it is what lets the localStorage codec be a plain round-trip rather than a merge.
   */
  enabled: boolean;
}

export interface PlaygroundSetup {
  botEnabled: boolean;
  botDifficulty: BotDifficulty;
  arenaId: string;
  /** Exactly `PLAYGROUND_SEATS` entries, in seat order. The index IS the seat (PG61). */
  cars: readonly PlaygroundCarSetup[];
  /** Which seat the human drives. In range, and always an ENABLED seat (PG63). */
  drivenSeat: number;
}

/**
 * One seat's chassis, colour, three-slot loadout and on/off flag.
 *
 * `carId` may be ANY valid `CarId`, not only an active one — spec PG20 lets the playground drive a
 * chassis the live roster has retired or not yet activated, which is most of the table as of
 * 2026-09-16. The three weapons must be real and pairwise DISTINCT within this seat; the same weapon
 * on another seat is legal (PG17), and so is the same `colorId` (PG31).
 */
function isPlaygroundCarSetup(value: unknown): value is PlaygroundCarSetup {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (!isCarId(rec.carId)) return false;
  if (!isColorId(rec.colorId)) return false;
  if (typeof rec.enabled !== "boolean") return false;
  const weapons = rec.weapons;
  if (!Array.isArray(weapons) || weapons.length !== 3) return false;
  if (!weapons.every((w) => isWeaponId(w))) return false;
  return new Set(weapons).size === weapons.length;
}

/**
 * Validates a `pg_setup` payload off the wire (PG63). Reject-whole, as PG13 has always required: one
 * bad seat discards the blob rather than applying the good five, so the client's view of what is
 * live can never disagree with the room seat by seat.
 *
 * There is no MAXIMUM to check. Six is structural — there are six seats — so "at most six cars"
 * falls out of the length check rather than being counted anywhere (PG64). The only floor is that at
 * least one seat is enabled, because a room with no cars has nothing to drive and `drivenSeat` would
 * have nothing legal to name.
 *
 * `isCarId`/`isWeaponId`/`isArenaId` all reject an id that exists only via the prototype chain
 * (`"toString"`, `"constructor"`), so this does too.
 */
export function isPlaygroundSetup(msg: unknown): msg is PlaygroundSetup {
  if (msg === null || typeof msg !== "object") return false;
  const rec = msg as Record<string, unknown>;
  if (typeof rec.botEnabled !== "boolean") return false;
  if (!isBotDifficulty(rec.botDifficulty)) return false;
  if (typeof rec.arenaId !== "string" || !isArenaId(rec.arenaId)) return false;

  const cars = rec.cars;
  if (!Array.isArray(cars) || cars.length !== PLAYGROUND_SEATS) return false;
  if (!cars.every(isPlaygroundCarSetup)) return false;
  if (!cars.some((car) => car.enabled)) return false;

  const driven = rec.drivenSeat;
  if (!Number.isInteger(driven)) return false;
  const seat = driven as number;
  if (seat < 0 || seat >= PLAYGROUND_SEATS) return false;
  // The driven seat must be ON the field. The panel already maintains this (PG78 moves the wheel
  // down when the driven seat is unchecked), so this asserts the rule rather than discovering it —
  // but the wire is not allowed to trust the panel.
  return cars[seat]!.enabled === true;
}

/**
 * The playground's opening setup (PG65) — the same sandbox it has always opened on, expressed in
 * seats: the default chassis's shipped loadout everywhere, seats 0 and 1 on the field, seat 0 driven,
 * the live arena, and the bot OFF (on medium for whenever it is switched on) because most sessions
 * open by driving rather than by fighting.
 *
 * Every seat gets a DISTINCT colour. There are exactly as many `COLOR_TABLE` rows as seats, so this
 * costs nothing and means a freshly-enabled fourth car is never a twin of one already out there.
 * Nothing enforces distinctness beyond this default (PG31).
 */
export function defaultPlaygroundSetup(): PlaygroundSetup {
  const [slot0, slot1, slot2] = slotsOf(DEFAULT_CAR_ID);
  const weapons: readonly [WeaponId, WeaponId, WeaponId] = [slot0!, slot1!, slot2!];
  return {
    botEnabled: false,
    botDifficulty: "medium",
    arenaId: ACTIVE_ARENA_ID,
    cars: PLAYGROUND_SEAT_IDS.map((_, seat) => ({
      carId: DEFAULT_CAR_ID,
      colorId: seat,
      weapons,
      enabled: seat < 2,
    })),
    drivenSeat: 0,
  };
}
