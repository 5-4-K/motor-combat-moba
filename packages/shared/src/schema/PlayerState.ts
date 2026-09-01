import { ArraySchema, Schema, type } from "@colyseus/schema";
import { PlayerStatus } from "../constants.js";
import { StatusState } from "./StatusState.js";
import { WeaponSlotState } from "./WeaponSlotState.js";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") angle = 0;
  @type("uint8") status: PlayerStatus = PlayerStatus.READY;
  @type("uint32") lastProcessedInputSeq = 0;
  @type("string") name = "";
  @type("uint8") colorId = 0;
  @type("uint8") team = 0;
  @type("uint32") joinedAtTick = 0;
  @type("string") carId = "";
  @type("number") speed = 0;
  @type("uint16") reverseHold = 0;
  /**
   * Ram knock state. Networked because `stepDrive` reads all four (invariant 8), and reconciled by
   * snapping rather than easing — they feed the next integration, so a half-eased value would poison
   * every subsequent step rather than merely look wrong.
   *
   * `authority` defaults to 1. A Schema numeric default of 0 would mean "no steering" for every
   * player who has never been touched, which presents as a completely undriveable car on first spawn.
   */
  @type("number") angVel = 0;
  @type("number") shoveX = 0;
  @type("number") shoveY = 0;
  @type("number") authority = 1;
  @type("uint16") hp = 0;
  @type("boolean") alive = true;
  /**
   * The tick this car's hp reached 0, or 0 while it lives. Drives the client's death fade.
   *
   * Networked rather than derived client-side from `alive` flipping, so a spectator or a late
   * joiner sees the right thing: without it, a client that never observed the transition would draw
   * a dead car parked on the field forever. Render-only — `stepSim` never reads it.
   */
  @type("uint32") diedAtTick = 0;
  /**
   * Kills and deaths this match. Counted in every mode; only Deathmatch decides a winner from them
   * (M11), and the results scoreboard has been drawing placeholder zeroes for both since it shipped.
   *
   * `uint8` is ample: six players over a five-minute match cannot approach 255.
   */
  @type("uint8") kills = 0;
  @type("uint8") deaths = 0;
  /**
   * Who landed the killing blow, or `""` while alive. Render-only — `stepSim` never reads it — and
   * networked for the same reason `diedAtTick` is: a spectator or a late joiner who never observed
   * the death still has to be able to name the killer.
   *
   * Survives until the respawn clears it, which is also what dismisses the "killed you" banner.
   */
  @type("string") killedBySessionId = "";
  @type("boolean") selectLocked = false;
  @type([WeaponSlotState]) weapons = new ArraySchema<WeaponSlotState>();
  @type("uint32") switchLockUntilTick = 0;
  @type("uint8") level = 1;
  /**
   * Tick the car's committed press next puts a shot out — a wind-up or the next volley of a burst.
   * `0` means nothing is pending, and so does any tick already passed: the HUD reads "this car is
   * mid-press" as `tick < pendingUntilTick`, which stays right between two patches at 20 Hz.
   */
  @type("uint32") pendingUntilTick = 0;
  /**
   * Slot index the car most recently committed to firing, or `-1` before its first shot — hence
   * `int8` rather than a uint8 sentinel: -1 is the natural "never" for an index, and slot counts are
   * capped at `WEAPON_SLOT_CONFIG.maxWeaponSlots` (3), nowhere near the type's range.
   */
  @type("int8") lastFiredSlot = -1;
  /**
   * Session id of this car's current aim-assist target, or `""` for none (A14).
   *
   * The only part of the lock that crosses the wire. The machine behind it -- the commit timer, the
   * sight grace, the last press -- stays server-side, exactly as `pending` does: the client is told
   * the result, never the rules. All the HUD needs is which car to draw a bracket on.
   */
  @type("string") lockTargetSessionId = "";
  /**
   * The statuses this car is currently in, capped at `STATUS_CONFIG.maxActive`.
   *
   * Networked because `stepSim` reads it (invariant 8) — `modifiersOf` turns this list into the
   * multipliers `stepDrive` applies, so the client must hold the same list to predict the same car.
   * Unlike the ram's four knock fields, this is not reconciled by snapping: it is not a value being
   * integrated, it is the *rules* the integration runs under, and both sides derive it from the
   * same tick through the same shared function.
   *
   * Rows are unordered as far as any reader is concerned — `modifiersOf` multiplies and OR-s, both
   * of which commute — but the sim keeps them sorted by `statusId` so a patch carries a diff rather
   * than a reshuffle.
   */
  @type([StatusState]) statuses = new ArraySchema<StatusState>();
}
