/**
 * Lobby chat limits (LC10). Every chat number in the codebase comes from here — invariant 2.
 *
 * `sendCooldownMs` is wall-clock milliseconds, not ticks, deliberately (LC20): it is an anti-spam
 * guard with no relationship to the sim, and a tick-based one would silently halve when netcode
 * phase 1 takes TICK_RATE_HZ from 30 to 60.
 */
export const CHAT_CONFIG = {
  maxLength: 100,
  maxMessages: 20,
  sendCooldownMs: 500,
} as const;
