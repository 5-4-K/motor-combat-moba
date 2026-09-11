import {
  SPIKE_CONFIG,
  SPIKE_TICKS,
  type SpikeContact,
  type SpikeHit,
} from "@motor-combat-moba/shared";

/**
 * Server-side hazard state. Deliberately NOT a schema field (AS17): `stepSim` never reads it, and
 * what crosses the wire is the already-applied HP. Same call the ram falloff stack made.
 */
export interface SpikeMemory {
  /** victim session id -> the first tick they may be hurt again. */
  immuneUntil: Map<string, number>;
  /** victim session id -> who last pushed them, and when. */
  lastShover: Map<string, { id: string; tick: number }>;
}

export function newSpikeMemory(): SpikeMemory {
  return { immuneUntil: new Map(), lastShover: new Map() };
}

/**
 * Remember that `attackerId` pushed `victimId`. Called for every ram and every slam, so any push
 * counts toward the credit window — the mechanic is "you put them there", not "you rammed them".
 */
export function recordShove(memory: SpikeMemory, victimId: string, attackerId: string, tick: number): void {
  if (attackerId === "" || attackerId === victimId) return;
  memory.lastShover.set(victimId, { id: attackerId, tick });
}

/**
 * Filter this tick's raw contacts down to the ones that actually hurt, and name who is credited.
 *
 * Two gates, in this order: the car must be moving INTO the surface faster than
 * `SPIKE_CONFIG.triggerSpeed` (so resting against a wall is free), and it must be out of its
 * retrigger lockout (so being pushed in does not bill thirty times a second).
 */
export function resolveSpikeHits(
  contacts: readonly SpikeContact[],
  memory: SpikeMemory,
  tick: number,
): SpikeHit[] {
  const hits: SpikeHit[] = [];
  for (const contact of contacts) {
    if (contact.speedIn < SPIKE_CONFIG.triggerSpeed) continue;
    const immuneUntil = memory.immuneUntil.get(contact.sessionId) ?? 0;
    if (tick < immuneUntil) continue;
    memory.immuneUntil.set(contact.sessionId, tick + SPIKE_TICKS.retrigger);

    const shove = memory.lastShover.get(contact.sessionId);
    const credited =
      shove !== undefined && tick - shove.tick <= SPIKE_TICKS.shoverCredit
        ? shove.id
        : contact.sessionId;
    hits.push({ targetSessionId: contact.sessionId, sourceSessionId: credited });
  }
  return hits;
}

/** Forget a car that has left the room, so neither map grows for the life of the process. */
export function forgetSpikeState(memory: SpikeMemory, sessionId: string): void {
  memory.immuneUntil.delete(sessionId);
  memory.lastShover.delete(sessionId);
}
