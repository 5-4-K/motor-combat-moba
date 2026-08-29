import { RAM_CONFIG, canDamage, carHullOf, obbsInContact } from "@motor-combat-moba/shared";

/**
 * Local contact detection for impact feedback ONLY — a camera shake and a spark.
 *
 * The ram itself is authoritative and unpredicted: the knock arrives from the server a round trip
 * later and snaps in through reconciliation. This exists to cover that gap perceptually. A ram that
 * sparks immediately and knocks a moment later reads as impact; one that does nothing for four ticks
 * reads as a dropped input.
 *
 * **The two poses this compares do not share a timebase, and the mismatch is not corrected.** `self`
 * is the local car's PREDICTED pose (this frame, no delay); every entry in `others` is a remote's
 * INTERPOLATED pose, rendered `NET_CONFIG.interpolationDelayMs` (50 ms) in the past, and the local
 * car itself is typically running roughly RTT/2 ahead of the server's own view of it. The two clocks
 * can therefore disagree by on the order of 50-100+ ms depending on latency. At a closing speed
 * around 1080 u/s (two top-speed mirages head-on) that is on the order of 50-100+ units of
 * positional disagreement — enough that this can spark on a near-miss or miss a real graze.
 *
 * This is accepted, not fixed, and deliberately not restructured: correcting it means either lagging
 * the spark behind the local car's own prediction (which defeats the entire point of predicting the
 * feedback at all) or predicting every remote car forward instead of interpolating it, which is the
 * source spec's §9.1 netcode rework, not a change scoped to ramming. Nothing here reaches `stepSim`,
 * the schema, or the server, so the cost of getting it wrong is strictly cosmetic: one spurious spark,
 * or one missing spark on a graze that the authoritative knock (once it arrives) will correct with the
 * real outcome regardless. That is the deliberate trade — this is the "predict the feedback, wait for
 * the effect" split, and CC application is firmly on the wait side. Do not read the spark as a
 * precise hit indicator; it is a perceptual cover for network delay; nothing more.
 */

export interface ImpactPose {
  sessionId: string;
  x: number;
  y: number;
  angle: number;
  team: 0 | 1;
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
 *
 * Gated by the same `canDamage` predicate `resolveRam` itself is gated by (R15): a ram is
 * structurally impossible between teammates, so a teammate must never produce this feedback either.
 * Without this, pushing an ally through ordinary collision shakes the screen and sparks as if a ram
 * had landed, contradicting `docs/combat-model.md`'s promise that friendly contact "produces no spin,
 * no shove, and no authority loss." A teammate is still tracked as touching (so a later swap to an
 * opponent, e.g. a team change, does not misread as a fresh contact) — it simply never sparks.
 */
export function freshImpacts(
  self: ImpactPose,
  others: readonly ImpactPose[],
  tracker: ImpactTracker,
  mode: "ffa" | "team",
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
    if (!canDamage(self.sessionId, self.team, other.sessionId, other.team, mode)) continue;
    fresh.push({
      sessionId: other.sessionId,
      x: (self.x + other.x) / 2,
      y: (self.y + other.y) / 2,
    });
  }

  tracker.contacts = touching;
  return fresh;
}
