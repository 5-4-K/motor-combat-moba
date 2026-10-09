import { Schema, MapSchema, ArraySchema, type, view } from "@colyseus/schema";
import { RoomPhase, GameMode } from "../constants.js";
import { ACTIVE_ARENA_ID } from "../config/arena-config.js";
import { DEFAULT_GAME_MODE } from "../modes/registry.js";
import { PlayerState } from "./PlayerState.js";
import { WeaponInstanceState } from "./WeaponInstanceState.js";
import { ChatMessageState } from "./ChatMessageState.js";

export class ArenaState extends Schema {
  @type("uint8") phase: RoomPhase = RoomPhase.LOBBY;
  @type("uint32") tick = 0;
  @type("string") hostSessionId = "";
  @type("uint8") mode: GameMode = DEFAULT_GAME_MODE;
  @type("string") arenaId = ACTIVE_ARENA_ID;
  @type("uint32") carSelectDeadlineTick = 0;
  /** When the reveal grid gives way to the countdown. Server-authoritative so all clients leave together. */
  @type("uint32") revealEndsTick = 0;
  @type("uint32") countdownEndsTick = 0;
  /**
   * Arena select (AR11). Room-flow display state only — `stepSim` reads none of these. The arena
   * the host's highlight sits on, mirrored to every client so watchers see it move.
   */
  @type("string") arenaHighlightId = "";
  /** When the host's choosing clock runs out. */
  @type("uint32") arenaSelectDeadlineTick = 0;
  /** 0 while choosing; the tick the reveal ends once a pick has landed. */
  @type("uint32") arenaRevealEndsTick = 0;
  /** The pick came from Select random, so clients play the roulette before the reveal. */
  @type("boolean") arenaPickRandom = false;
  /**
   * The tick the match began, so results can show a duration every client agrees on. Display only —
   * `stepSim` never reads it. A local stopwatch would start whenever each machine loaded the arena
   * and drift apart over a match; this is one number, set once, patched to everyone.
   */
  @type("uint32") matchStartedAtTick = 0;
  /**
   * The tick a Deathmatch ends on, or 0 in every other mode. Stamped on the same edge into MATCH
   * that `matchStartedAtTick` is, and for the same reason: one number patched to everyone beats a
   * local stopwatch per machine, which would start whenever each client loaded the arena.
   */
  @type("uint32") matchEndsTick = 0;
  @type("int8") winnerTeam = -1;
  @type("string") winnerSessionId = "";
  /** Conquer (CQ43): accumulated fill ticks per team. Written by the room only; not read by stepSim. */
  @type("uint16") controlTicksA = 0;
  @type("uint16") controlTicksB = 0;
  /** Conquer: the team whose capture streak is running, or -1. */
  @type("int8") zoneHolder = -1;
  /** Conquer: that streak, saturating at the capture delay. */
  @type("uint16") zoneStreakTicks = 0;
  @type("boolean") zoneContested = false;
  @type("boolean") overtime = false;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  /**
   * Live weapon instances. A `@view()` map (NR42): a client receives only the rows its `StateView`
   * holds, so the server adds every row to every view that may see it (G2: all of them).
   */
  @view() @type({ map: WeaponInstanceState }) weapons = new MapSchema<WeaponInstanceState>();
  /**
   * The lobby chat buffer, capped at `CHAT_CONFIG.maxMessages` by the server (LC4). Oldest first.
   * Display-only — `stepSim` never reads it. Never cleared by any phase transition (LC5): a message
   * leaves only by being the oldest of twenty-one, and the whole buffer dies with the room.
   */
  @type([ChatMessageState]) chat = new ArraySchema<ChatMessageState>();
}
