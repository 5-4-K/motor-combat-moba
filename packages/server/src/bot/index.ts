/**
 * The bot, as every host sees it.
 *
 * Mode-agnostic by construction: nothing here imports a room type, because the same bot serves the
 * dev playground, the shipped practice room, the balance harness, and whatever multiplayer bot
 * deployment comes next (B13). Server-side only — a bot authors `InputMessage`s, and only the
 * server authors inputs (invariant 3, B14).
 */
export * from "./brain/controller.js";
export * from "./rng.js";
export * from "./types.js";
export * from "./view.js";
export * from "./view-ring.js";
export { BOT_PROFILES, BRAIN_CONSTANTS, BOT_BRAIN_VERSION } from "../config/bot-profiles.js";
export type { BotProfile } from "../config/bot-profiles.js";
