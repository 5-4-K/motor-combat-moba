import {
  RAM_CONFIG,
  carHullOf,
  obbsInContact,
  resolveRam,
  speedOf,
  type RamCar,
} from "@motor-combat-moba/shared";

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
 * around 1152 u/s (two top-speed mirages head-on) that is on the order of 50-100+ units of
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

/**
 * What this pass needs to know about one car — which is exactly what the sim's own ram resolver
 * needs, so it is that type rather than a parallel one.
 *
 * It was a bare pose (`{sessionId, x, y, angle, team}`) while the gate was "are these hulls
 * touching and are they enemies". The Unity ram rule reads velocity, heading and the ram flags too
 * (spec §7.1), and a second copy of that rule on the client is precisely the drift this alias
 * exists to make impossible.
 */
export type ImpactPose = RamCar;

export interface ImpactTracker {
  contacts: Set<string>;
}

export interface Impact {
  sessionId: string;
  x: number;
  y: number;
  /** The shove the sim will apply, in u/s — what the shake scales with. */
  closingSpeed: number;
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
 * The team gate is no longer this file's own — it lives inside `resolveRam`, which is gated by the
 * same friendly-fire predicate a ram itself is gated by (R15): a ram is structurally impossible
 * between teammates, so a teammate must never produce this feedback either. `resolveRam` returning
 * `null` for a teammate pair is the stronger version of that same claim, since it also covers
 * everything else that disqualifies a contact as a ram. Without it, pushing an ally through ordinary
 * collision would shake the screen and spark as if a ram had landed, contradicting
 * `docs/combat-model.md`'s promise that friendly contact "produces no spin, no shove, and no
 * authority loss." A teammate is still tracked as touching (so a later swap to an opponent, e.g. a
 * team change, does not misread as a fresh contact) — it simply never sparks.
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
    // Tracking is still plain hull contact, deliberately WIDER than the spark: `applyRams` records
    // a contact for every touching pair, ram or not, so that holding against someone and then
    // accelerating cannot re-trigger without separating first. Narrowing this to rams would hand
    // back exactly that exploit.
    const inContact = obbsInContact(
      selfHull,
      carHullOf(other.x, other.y, other.angle),
      RAM_CONFIG.contactPad,
    );
    if (!inContact) continue;
    touching.add(other.sessionId);
    if (tracker.contacts.has(other.sessionId)) continue;

    // The sim's own answer, not a second reading of it. `resolveRam` applies the friendly-fire
    // check, the front/frontCorner attack region, `RAM_CONFIG.minRamSpeed` and the ram-blocked check
    // itself — so a flank-first slide, a crawl and a car inside its own `ramLock` all come back
    // `null`, and the spark stays a cue for the one contact that actually costs somebody something.
    const ram = resolveRam(self, other, mode);
    if (ram === null) continue;
    // Neither "the other car's side" (`s.sessionId !== self.sessionId`) is safe here — it can pick
    // the attacker's architecturally-zero side when self is the victim of a one-way ram — nor is
    // "the non-attacker side" (`s.sessionId !== ram.attackerId`): that fixes the one-way case but
    // still breaks on a head-on, where `attackerId` is `""` (U27) and `sides.find` matches whichever
    // side sits at index 0 regardless of who actually got hit. A stationary car head-on'd by a fast
    // one is a real example: `headOnResolution`'s two sides are cross-attributed from the OTHER
    // car's speed (`ontoA`/`ontoB`), so the stationary car's own side is exactly zero while the
    // moving car's side carries the real push — the reverse of the one-way case.
    //
    // This is not "the shove self is about to take" for every shape `RamResolution` produces — it is
    // the LARGER of the two `RamSide` magnitudes, used as a hit-magnitude proxy. For a one-way ram
    // that is exact: the attacker's side is architecturally always zero, so the max is always the
    // victim's real shove, whoever the victim is. For a head-on with an unequal pair of speeds it is
    // only an aggregate — it can report the OTHER car's shove rather than self's own velocity change
    // — which is an acceptable proxy for "how big was this hit" given this file's own header comment
    // ("do not read the spark as a precise hit indicator"), not a claim that it is self's exact Δv.
    const closingSpeed = Math.max(...ram.sides.map((s) => speedOf(s.shoveX, s.shoveY)));
    fresh.push({
      sessionId: other.sessionId,
      x: (self.x + other.x) / 2,
      y: (self.y + other.y) / 2,
      closingSpeed,
    });
  }

  tracker.contacts = touching;
  return fresh;
}
