import { RAM_CONFIG, carHullOf, obbsInContact } from "@motor-combat-moba/shared";

/**
 * Local contact detection for impact feedback ONLY — a camera shake and a spark.
 *
 * The ram itself is authoritative and unpredicted: the knock arrives from the server a round trip
 * later and snaps in through reconciliation. This exists to cover that gap perceptually. A ram that
 * sparks immediately and knocks a moment later reads as impact; one that does nothing for four ticks
 * reads as a dropped input.
 *
 * Nothing here reaches `stepSim`, the schema, or the server, so a false positive costs one spurious
 * spark and nothing else. That is the deliberate trade — this is the "predict the feedback, wait for
 * the effect" split, and CC application is firmly on the wait side.
 */

export interface ImpactPose {
  sessionId: string;
  x: number;
  y: number;
  angle: number;
}

export interface ImpactTracker {
  contacts: Set<string>;
}

export interface Impact {
  sessionId: string;
  x: number;
  y: number;
}

export function newImpactTracker(): ImpactTracker {
  return { contacts: new Set() };
}

/**
 * Contacts that BEGAN this frame, between the local car and each remote.
 *
 * Edge triggered against the tracker so a sustained grind sparks once rather than every frame. Cars
 * that vanish from `others` drop out of the tracker, so a reconnecting player is not remembered as
 * still touching and silently denied their next spark.
 */
export function freshImpacts(
  self: ImpactPose,
  others: readonly ImpactPose[],
  tracker: ImpactTracker,
): Impact[] {
  const selfHull = carHullOf(self.x, self.y, self.angle);
  const touching = new Set<string>();
  const fresh: Impact[] = [];

  for (const other of others) {
    if (other.sessionId === self.sessionId) continue;
    const inContact = obbsInContact(
      selfHull,
      carHullOf(other.x, other.y, other.angle),
      RAM_CONFIG.contactPad,
    );
    if (!inContact) continue;
    touching.add(other.sessionId);
    if (tracker.contacts.has(other.sessionId)) continue;
    fresh.push({
      sessionId: other.sessionId,
      x: (self.x + other.x) / 2,
      y: (self.y + other.y) / 2,
    });
  }

  tracker.contacts = touching;
  return fresh;
}
