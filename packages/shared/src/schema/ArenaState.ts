import { Schema, MapSchema, type } from "@colyseus/schema";
import { RoomPhase, GameMode } from "../constants.js";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { PlayerState } from "./PlayerState.js";
import { WeaponInstanceState } from "./WeaponInstanceState.js";

export class ArenaState extends Schema {
  @type("uint8") phase: RoomPhase = RoomPhase.LOBBY;
  @type("uint32") tick = 0;
  @type("string") hostSessionId = "";
  @type("uint8") mode: GameMode = GameMode.FFA_LAST_STANDING;
  @type("string") arenaId = ACTIVE_ARENA_ID;
  @type("uint32") carSelectDeadlineTick = 0;
  /** When the reveal grid gives way to the countdown. Server-authoritative so all clients leave together. */
  @type("uint32") revealEndsTick = 0;
  @type("uint32") countdownEndsTick = 0;
  /**
   * The tick the match began, so results can show a duration every client agrees on. Display only —
   * `stepSim` never reads it. A local stopwatch would start whenever each machine loaded the arena
   * and drift apart over a match; this is one number, set once, patched to everyone.
   */
  @type("uint32") matchStartedAtTick = 0;
  @type("int8") winnerTeam = -1;
  @type("string") winnerSessionId = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: WeaponInstanceState }) weapons = new MapSchema<WeaponInstanceState>();
}
