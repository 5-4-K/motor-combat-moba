import {
  RAM_CONFIG,
  ramTicks,
  SLAM_CONFIG,
  applyImpulse,
  applyStatus,
  boundsOf,
  carHullOf,
  carIdOf,
  expireStatusesFromSource,
  forwardMaxSpeedOf,
  getArena,
  hasStatus,
  hullTouchesWorld,
  isSolid,
  isWeaponId,
  ramDefenceOf,
  resolveContacts,
  toWorld,
  weaponDefOf,
  weaponTicksOf,
  type ArenaState,
  type ContactCar,
  type ContactHit,
  type Impulse,
  type Modifiers,
  type PlayerState,
  type RamResolution,
  type SpikeHit,
  type StatusRequest,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { modifiersFor, readStatuses, writeStatuses } from "./status-bridge.js";
import {
  forgetSpikeState,
  newSpikeMemory,
  recordShove,
  resolveSpikeHits,
  type SpikeMemory,
} from "./spike-bridge.js";
// Re-exported so a room can clean up a leaver's spike state alongside the rest of `ContactMemory`
// without importing a second bridge module for one function.
export { clearShover, forgetSpikeState } from "./spike-bridge.js";

/**
 * The schema half of contact: read `ArenaState` into plain objects, run the pure `resolveContacts`,
 * write the answer back.
 *
 * The split mirrors `combat-bridge.ts`. Every rule lives in `@motor-combat-moba/shared` and can be
 * tested without a Colyseus room; this file knows about `MapSchema` and holds no rules at all.
 *
 * Contact runs between driving and combat, extending what used to be a plain ram tick: a DASH pair
 * reports a hit for combat to price, and a CHARGE pair resolves a hard slam — a fixed knock plus a
 * wall-stun window this bridge tracks in room memory (spec S3, O2/O3/O18). Driving must have
 * resolved first, so contacts are measured against the poses cars actually ended the tick at;
 * combat runs after, reading the `ContactHit`s and `StatusRequest`s this produces.
 */

/**
 * One slammed victim's two independent clocks — the wall-stun window and the re-slam immunity —
 * plus the stun this slam would land, all three resolved from the slamming weapon's own
 * `ImpulseDef` at the moment the slam landed. Carrying `wallStunTicks` rather than re-deriving it
 * in the sweep is what lets the sweep stay weapon-agnostic: the record already knows everything the
 * window means, and a slam thrown by a future second charge weapon brings its own numbers with it.
 */
interface SlamRecord {
  bySessionId: string;
  wallStunUntilTick: number;
  immuneUntilTick: number;
  /** Stun length, in ticks, if this slam's victim reaches a wall inside the window. */
  wallStunTicks: number;
}

/**
 * Per-victim diminishing returns on ramming (spec P24).
 *
 * **Server-side only, and deliberately NOT a schema field.** This looks like an invariant 8
 * violation and is not: `stepSim` never reads the stack. It is consumed once, here, at the moment a
 * ram resolves, to scale the impulse and the duration BEFORE they are applied. What reaches the
 * client is the already-scaled result — a velocity change and a `reeling` status with a concrete
 * duration — both of which are networked already. It lives beside `SlamRecord`/`slammed` above,
 * which is the same shape of per-victim server map for the same reason.
 *
 * Keyed by victim and by nothing else. Who did the ramming is not recorded, because three cars
 * taking turns is the exact case this exists to defuse.
 */
export interface FalloffEntry {
  /** How many rams have landed inside the current rolling window. */
  count: number;
  /** Tick the window lapses. Each fresh ram pushes this out from itself. */
  expiresAtTick: number;
}

export type FalloffStack = Map<string, FalloffEntry>;

export interface FalloffScales {
  durationScale: number;
  impulseScale: number;
}

export function newFalloffStack(): FalloffStack {
  return new Map();
}

/**
 * Read the victim's current falloff and record this ram against it.
 *
 * MUTATES `stack` — it is both the read and the write, so a caller cannot accidentally scale a ram
 * without also counting it.
 */
export function nextFalloff(stack: FalloffStack, victimId: string, tick: number): FalloffScales {
  const standing = stack.get(victimId);
  const live = standing !== undefined && tick < standing.expiresAtTick;
  const count = live ? standing.count : 0;

  stack.set(victimId, { count: count + 1, expiresAtTick: tick + ramTicks().drWindow });

  return {
    durationScale: Math.max(
      ramTicks().durationFloor / ramTicks().uncontrol,
      RAM_CONFIG.durationDrScale ** count,
    ),
    impulseScale: Math.max(RAM_CONFIG.impulseDrFloor, RAM_CONFIG.impulseDrScale ** count),
  };
}

/** Drop lapsed entries so the map cannot grow unbounded across a long match. */
export function sweepFalloff(stack: FalloffStack, tick: number): void {
  for (const [id, entry] of stack) {
    if (tick >= entry.expiresAtTick) stack.delete(id);
  }
}

/** Room-owned state that lives across ticks and is deliberately never networked. */
export interface ContactMemory {
  /** Pairs that were in contact last tick, so contact fires on entry rather than every tick. */
  contacts: Set<string>;
  /** Every car slammed recently enough that either clock below is still running. */
  slammed: Map<string, SlamRecord>;
  /** Per-victim ram falloff (spec P24/P24a). Same lifetime and reasoning as `slammed`. */
  falloff: FalloffStack;
  /** Spike retrigger lockouts and shove attribution (AS19-AS21). Same lifetime as the rest. */
  spikes: SpikeMemory;
}

export function newContactMemory(): ContactMemory {
  return { contacts: new Set(), slammed: new Map(), falloff: newFalloffStack(), spikes: newSpikeMemory() };
}

export interface ContactTickResult {
  contactHits: ContactHit[];
  statusRequests: StatusRequest[];
  spikeHits: SpikeHit[];
}

/**
 * Reset a player to a neutral rest state: no spin, and — since the vector-drive rework merged
 * ordinary driving velocity and ram shove onto the same two fields — the car's ENTIRE velocity, not
 * merely a "knock" component distinct from it. Correct for the two call sites that use it (a fresh
 * match, a respawn), where the car needs to arrive fully at rest either way; the name and this doc
 * now say more than "knock state" to reflect that.
 *
 * Also clears the four maneuver fields, the same "nothing survives into a fresh match" rule this
 * already applies to ram state: a car must not spawn into the countdown still mid-dash or mid-charge
 * from the match that just ended.
 */
export function clearKnock(player: PlayerState): void {
  player.angVel = 0;
  player.vx = 0;
  player.vy = 0;
  player.maneuver = 0;
  player.maneuverTicksLeft = 0;
  player.maneuverAngle = 0;
  player.maneuverSpeed = 0;
}

/**
 * Zero the four maneuver fields alone, touching no velocity. Split out of `endDash` (below) for the
 * slam-attacker case: a slam is authored, not contested, so its attacker takes nothing from its own
 * hit — nothing pushes it, and a maneuver end must not stomp that back to a forced-forward speed the
 * way `endDash` deliberately does for a dash. (Through the car-physics rework's stage 3 the same
 * outcome was spelled as a zero-magnitude `attackerImpulse` applied by a per-victim impulses loop;
 * its stage 4 stopped building one, and the Unity ram port deleted that loop outright. None of it
 * changes anything here — the slam attacker has never been pushed by its own hit.)
 */
function endManeuverOnly(player: PlayerState): void {
  player.maneuver = 0;
  player.maneuverTicksLeft = 0;
  player.maneuverAngle = 0;
  player.maneuverSpeed = 0;
}

/**
 * Zero the four maneuver fields and set the car's velocity to `exitSpeed` purely forward along its
 * current heading (no lateral component). The one place a dash or a wall-blocked dash stops — the
 * bridge writing motion fields is the established ram pattern; combat still never moves a car.
 *
 * This DISCARDS whatever lateral component the car's velocity carried into the call. A wall-blocked
 * dasher (the `endDash(player, 0)` call below) loses any push it was still carrying; a dash that
 * lands its one hit exits at the drive model's cap. Neither of those two cases is Impulse-driven —
 * a dash carries no `Impulse` at all (spec: it reports a `ContactHit` and combat prices the damage),
 * so there is no reaction to preserve here the way there is for a slam's attacker (`endManeuverOnly`
 * above).
 */
function endDash(player: PlayerState, exitSpeed: number): void {
  endManeuverOnly(player);
  const v = toWorld(player.angle, exitSpeed, 0);
  player.vx = v.vx;
  player.vy = v.vy;
}

/** May this weapon's hard slam land on an already-stunned victim (O3)? `false` off any non-charge id. */
function slamsStunnedOf(weaponId: WeaponId | ""): boolean {
  if (!isWeaponId(weaponId)) return false;
  const def = weaponDefOf(weaponId);
  return def.kind === "maneuver" && def.maneuver.type === "charge" ? def.maneuver.slamsStunned : false;
}

/**
 * The push a charge weapon's slam is authored to land, paired with its tick-converted durations —
 * or `null` for a charge row that declares no `impulse` at all.
 *
 * The two halves are resolved together because absence has to be consistent across both: a row's
 * `WEAPON_TICKS` `impulse` block exists exactly when its `WeaponDef` declares one
 * (`weapon-config.test.ts` pins that in both directions), so one without the other is a config bug
 * rather than a half-configured slam. Every consumer below goes through this one function — the cap
 * that decides which slams can push, the push itself, and the bookkeeping half further down — which
 * is what keeps them agreeing about exactly which slams are impulse-bearing.
 *
 * `null` is unreachable today: `wildcharge` is the roster's only charge row and it authors an
 * impulse. Absent must mean absent (see `WeaponTicks.impulse`), so a missing block is a skip, never
 * a zero-valued default that would quietly turn every charge into a nudge.
 */
function impulseOf(weaponId: WeaponId) {
  const def = weaponDefOf(weaponId).impulse;
  const ticks = weaponTicksOf(weaponId).impulse;
  if (def === undefined || ticks === undefined) return null;
  return { def, ticks };
}

function immuneMapFrom(slammed: ReadonlyMap<string, SlamRecord>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [victimId, entry] of slammed) out.set(victimId, entry.immuneUntilTick);
  return out;
}

/**
 * Only living roster members who are `isSolid` can contact or be contacted. A lobby player standing
 * in the room is not part of the fight. A wreck is no longer merely "scenery that still collides" —
 * it is not solid either, the same as a lobby player — and neither, now, is a car mid-phase (M14): a
 * respawning car is driveable but must pass through everyone without dealing or taking a ram, a
 * slam, or a dash hit.
 */
function contactCarsOf(
  state: ArenaState,
  roster: ReadonlySet<string>,
  statusMods: ReadonlyMap<string, Modifiers>,
  approachVelocities: ReadonlyMap<string, { vx: number; vy: number }>,
  maneuverWeapons: ReadonlyMap<string, WeaponId | "">,
  tick: number,
): ContactCar[] {
  const cars: ContactCar[] = [];
  state.players.forEach((player, sessionId) => {
    if (!roster.has(sessionId)) return;
    if (!isSolid(player, tick)) return;
    const maneuverWeaponId = maneuverWeapons.get(sessionId) ?? "";
    const mods = modifiersFor(statusMods, sessionId);
    cars.push({
      sessionId,
      team: player.team === 1 ? 1 : 0,
      x: player.x,
      y: player.y,
      angle: player.angle,
      // The PRE-COLLISION world velocity, straight through — no reconstruction. Stage 3 Task 2's
      // shim rebuilt a purely-forward `vx`/`vy` from a forward scalar with `toWorld`; Task 4 widened
      // `TickResult.approachVelocities` to the real vector and deleted it, so a car carrying lateral
      // velocity into a contact (a knock, a slide out of a turn, a wall graze) now brings that
      // component to the contest instead of having it silently dropped. The `??` fallback only
      // covers a session the cache has never seen, which `serverTick` records unconditionally.
      ...(approachVelocities.get(sessionId) ?? { vx: player.vx, vy: player.vy }),
      carId: carIdOf(player),
      defenceMult: mods.ramDefence,
      // Spec §8: may this car throw a punch at all? One flag covers both a car still reeling from a
      // ram it took and one inside its own attacker lock, which is what stops a ram chain paying its
      // winner twice. It gates the ATTACKER side only — a blocked car can still be rammed.
      ramBlocked: mods.ramBlocked,
      maneuver: player.maneuver,
      maneuverWeaponId,
      stunned: hasStatus(readStatuses(player), "stunned", tick),
      slamsStunned: slamsStunnedOf(maneuverWeaponId),
    });
  });
  return cars;
}

/**
 * This player's `ramDefence` as `applyImpulse` sees it: chassis rating scaled by whatever `ramDefence`
 * effect it carries. Renamed from `massFor` in stage 3 Task 3 of the car-physics rework — it reads
 * `ramDefenceOf` instead of `massOf`, which is what actually delivers the ~10x inertia-denominator
 * drop `nextSpin`'s doc comment (`sim/impulse.ts`) describes.
 *
 * **Only the SLAM path reaches this now.** Its doc used to add that "both ram impulses are
 * `defenceScaled: false`, so this value only reaches `applyImpulse`'s `nextSpin` inertia term" — the
 * Unity port's stage 3 deleted the ram contest and with it every `Impulse` a ram ever built, so
 * `sim/ram.ts` produces no impulse at all today and a ram divides by the victim's `ramDefence` inside
 * `shoveOf` instead. What survives here is `wildcharge`'s authored push, whose own `defenceScaled`
 * flag decides whether this value scales it. `0` for a session with no player, which
 * `defenceFactorOf` (`sim/impulse.ts`) treats as "unscaled" rather than dividing by it.
 */
function ramDefenceFor(state: ArenaState, statusMods: ReadonlyMap<string, Modifiers>, sessionId: string): number {
  const player = state.players.get(sessionId);
  if (!player) return 0;
  return ramDefenceOf(carIdOf(player)) * modifiersFor(statusMods, sessionId).ramDefence;
}

/** The other car named by a head-on resolution — the one that put this car where it is. */
function otherSideOf(ram: RamResolution, sessionId: string): string {
  const other = ram.sides.find((s) => s.sessionId !== sessionId);
  return other?.sessionId ?? sessionId;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * What one car takes from EVERY ram naming it this tick, accumulated before anything is written.
 *
 * A car can appear in more than one `RamResolution` in a single tick — rammed by two attackers at
 * once, or an attacker in one resolution and a victim in another (A rams B while B rams C:
 * `ramBlocked` is sampled from `statusMods`, computed before `serverTick`, so B is not yet blocked).
 * Writing each side straight onto the body as it came would ASSIGN from the same immutable
 * pre-collision cache entry twice, so the last write silently replaced every earlier one.
 */
interface RamWrite {
  /** Pre-collision velocity, the base unless some resolution replaces it. */
  baseX: number;
  baseY: number;
  /** Did ANY resolution this tick tell this car to replace its velocity? */
  replaced: boolean;
  /** Every falloff-scaled shove, summed. */
  shoveX: number;
  shoveY: number;
  /** Every falloff-scaled spin delta, summed. Clamped once, where the sum is written. */
  spin: number;
}

/**
 * Write one ram onto the cars it names (spec §7.2). This is the whole of what a ram does: no damage
 * (U28), no `Impulse`, no contest — `sim/ram.ts` already decided who is shoved and by how much, and
 * everything here is the application of that decision plus the three things the spec deliberately
 * keeps out of a pure classifier (the spin clamp, diminishing returns, and the statuses themselves).
 *
 * Three rows, one loop:
 *
 * - **Attacker** (flank/rear): `replacesVelocity` with a zero shove, so it stops DEAD — not slowed,
 *   not bounced. `ramLock` for `RAM_CONFIG.attackerLockMs`. Its spin is untouched.
 * - **Victim** (flank/rear): pre-collision velocity plus the shove, pre-collision spin plus the spin
 *   delta, `reeling` for a falloff-scaled `ramUncontrolMs`, and the shove credited for the spikes.
 * - **Head-on**: both cars replace their velocity with the shove the OTHER authored, both lock,
 *   neither spins and neither reels (U27).
 *
 * Deliberately takes no `statusMods`. A ram has two status inputs and BOTH are consumed before a
 * resolution exists: `ramBlocked` gated who was allowed to attack, back in `participantOf`, and the
 * victim's `ramDefence` multiplier was already divided out inside `shoveOf`. Both reached
 * `sim/ram.ts` on the `ContactCar` this file builds (`ramBlocked` and `defenceMult`), so by the time
 * a `RamResolution` arrives here there is nothing left for a modifier to change — reading either one
 * again would double-count it.
 *
 * **Velocity is ACCUMULATED into `writes`, not written here** — see `RamWrite` above and
 * `flushRamWrites` below. Everything that is not velocity (the falloff read, `reeling`, `ramLock`,
 * the spike credit) stays where it is, applied immediately and in event order. Velocity was the only
 * one of them that a second resolution could destroy: falloff is counted once per shoved side
 * whichever resolution carried it, and `reeling`/`ramLock` are both `reapply: "ignore"`, so the
 * first application for a car wins — and it wins with the count-0 duration whichever resolution
 * happened to be first, since falloff and the status are read on the same side.
 */
function applyRamResolution(
  state: ArenaState,
  memory: ContactMemory,
  approachVelocities: ReadonlyMap<string, { vx: number; vy: number }>,
  ram: RamResolution,
  tick: number,
  writes: Map<string, RamWrite>,
): void {
  for (const side of ram.sides) {
    const player = state.players.get(side.sessionId);
    if (!player) continue;

    const shoved = side.shoveX !== 0 || side.shoveY !== 0;
    // Falloff is READ only for a car that actually takes a push, so an attacker's own dead stop
    // never counts a ram against its stack — and an attacker therefore pays full cost for every
    // punch it throws. Discounting its half too would make chain-ramming a worn-down victim
    // progressively SAFER for the aggressor, the exact inverse of what diminishing returns are for.
    // It scales the shove AND the spin (spec §7.3): a chained ram neither throws nor spins at full
    // strength.
    const scales = shoved
      ? nextFalloff(memory.falloff, side.sessionId, tick)
      : { impulseScale: 1, durationScale: 1 };

    // The PRE-COLLISION velocity, from the same cache `contactCarsOf` reads — NOT whatever
    // `resolveWorld` left on the body earlier this tick. A shove added to a post-resolution velocity
    // would be added to a number the contact pass has already reflected or zeroed.
    const pre = approachVelocities.get(side.sessionId) ?? { vx: player.vx, vy: player.vy };
    const write = writes.get(side.sessionId) ?? {
      baseX: pre.vx, baseY: pre.vy, replaced: false, shoveX: 0, shoveY: 0, spin: 0,
    };
    write.replaced ||= side.replacesVelocity;
    write.shoveX += side.shoveX * scales.impulseScale;
    write.shoveY += side.shoveY * scales.impulseScale;
    // `RamSide.spin` is always a DELTA and is always ADDED, whatever `replacesVelocity` says — that
    // flag governs velocity alone (controller ruling S3-g). §7.2's attacker row reads "spin
    // unchanged" and its head-on row "neither car spins", and since `spin` is 0 in both of those
    // cases, adding is exactly what preserves the yaw the car was already carrying.
    write.spin += side.spin * scales.impulseScale;
    writes.set(side.sessionId, write);

    if (ram.reeled.includes(side.sessionId)) {
      const ticks = Math.max(
        ramTicks().durationFloor,
        Math.round(ramTicks().uncontrol * scales.durationScale),
      );
      writeStatuses(player, applyStatus(readStatuses(player), "reeling", tick, ticks, ram.attackerId));
    }

    if (ram.locked.includes(side.sessionId)) {
      writeStatuses(
        player,
        applyStatus(readStatuses(player), "ramLock", tick, ramTicks().attackerLock, ram.attackerId),
      );
    }

    // AS20: whoever put you here owns what happens to you in the spikes. On a head-on that is the
    // other car, which is why this reads the shover off the resolution rather than off `attackerId`
    // — a head-on has none, and `recordShove` would drop an empty id on the floor (U38).
    if (shoved) {
      const shover = ram.attackerId !== "" ? ram.attackerId : otherSideOf(ram, side.sessionId);
      recordShove(memory.spikes, side.sessionId, shover, tick);
    }
  }
}

/**
 * Write every accumulated ram outcome onto the bodies, once per car.
 *
 * **The composition rule is `(any replaced ? 0 : pre) + every shove`, and it is an IMPLEMENTATION
 * DECISION with no spec backing** (controller ruling S3-o). §7.2 answers what one ram does to one
 * car; nothing in the spec says what happens to a car named by two rams on the same tick, and the
 * case is real in both shapes — two attackers converging on one victim, and a car that rams while
 * being rammed (A rams B, B rams C). The rule is the two statements composing: "your own ram stops
 * you" zeroes the base, "the shove you took is added" adds every push. It is order-independent,
 * which the naive sequential write was not — the answer used to be decided by the alphabetical order
 * of session ids. Do not read it as a ported Unity rule.
 *
 * Diminishing returns keeps its per-shoved-side behaviour: spec §7.3 is per victim and across
 * attackers, so a victim taking two pushes in one tick legitimately has the second scaled. It still
 * lands strictly more than one ram would, which is what `sim/contact.ts` promises.
 *
 * The spin clamp lives here (U26): a playability guard applied where a value is written onto a body,
 * because a clamp inside the pure classifier would make a resolution's meaning depend on the car it
 * is later applied to. Clamping the SUM once rather than after each ram is the same reasoning one
 * step further — there is exactly one write per car per tick now, so there is exactly one clamp.
 */
function flushRamWrites(state: ArenaState, writes: ReadonlyMap<string, RamWrite>): void {
  for (const [sessionId, write] of writes) {
    const player = state.players.get(sessionId);
    if (!player) continue;
    player.vx = (write.replaced ? 0 : write.baseX) + write.shoveX;
    player.vy = (write.replaced ? 0 : write.baseY) + write.shoveY;
    player.angVel = clamp(player.angVel + write.spin, -RAM_CONFIG.spinMaxRate, RAM_CONFIG.spinMaxRate);
  }
}

/**
 * `approachVelocities` comes from `serverTick`'s `TickResult`: each car's whole world velocity as it
 * entered the tick, before `resolveWorld` could reflect it. It is a required parameter rather than
 * an optional one defaulting to the player's current `vx`/`vy`, deliberately — a default here would
 * silently reinstate the trigger bug for any caller that forgot it, and the failure mode is a ram
 * that fires on 8-20% of contacts rather than an error anyone would notice. That reasoning is
 * unchanged by Task 4's widening from a forward scalar to a vector: the parameter's shape moved, the
 * reason it cannot be defaulted did not.
 */
export function contactTick(
  state: ArenaState,
  roster: ReadonlySet<string>,
  memory: ContactMemory,
  mode: "ffa" | "team",
  statusMods: ReadonlyMap<string, Modifiers>,
  approachVelocities: ReadonlyMap<string, { vx: number; vy: number }>,
  maneuverWeapons: ReadonlyMap<string, WeaponId | "">,
  tick: number,
): ContactTickResult {
  const arena = getArena(state.arenaId);
  const bounds = boundsOf(arena);

  const cars = contactCarsOf(state, roster, statusMods, approachVelocities, maneuverWeapons, tick);
  const { contacts, events } = resolveContacts(
    cars,
    memory.contacts,
    mode,
    tick,
    immuneMapFrom(memory.slammed),
    arena.obstacles,
    bounds,
  );
  memory.contacts = contacts;
  sweepFalloff(memory.falloff, tick);

  // Every ram this tick. The loop writes velocities DIRECTLY rather than through `applyImpulse`,
  // because Unity's model SETS velocity where ours added to it: an attacker stops dead, a head-on
  // replaces both cars' velocity with the shove they took, and only a flank or rear victim keeps
  // what it was carrying. `applyImpulse` still serves the slam path below, unchanged — and after
  // this stage the slam is its ONLY production caller.
  //
  // Two passes, not one: the rams ACCUMULATE onto `ramWrites` and `flushRamWrites` lands them, so a
  // car named by two resolutions in one tick takes both pushes instead of only the last. See
  // `flushRamWrites` for the composition rule (controller ruling S3-o) and why it is not the spec's.
  //
  // (Through the car-physics rework this was a loop over a per-victim `Impulse` map, where the ram
  // contest handed each side its own independently computed push. The Unity port deleted the
  // contest: the attacker's outcome is a rule — "you stop" — not a number, so there is nothing left
  // to accumulate and `resolveContacts` returns a `RamResolution` per pair instead. Keeping the
  // `Impulse` seam here would have meant expressing "set to" as "add the difference", which is the
  // dishonesty spec §7.4 moved the write out of the classifier to avoid.)
  //
  // **Every entry is a RAM**, so falloff and `reeling` — ram-only by spec §7.3 — apply here with
  // nothing to disambiguate. A slam writes no `RamResolution`: `contact.ts`'s charge branch emits a
  // `SlamEvent` and the `events.slams` loop below assembles the push from the weapon's own
  // `ImpulseDef`. That separation is not merely tidy — the old `!slammedVictims.has(victimId)`
  // inference it replaced was only correct while a slam's magnitude outranked every possible ram, an
  // ordering nothing enforced, and would have misclassified a ram the day a retune inverted it.
  const ramWrites = new Map<string, RamWrite>();
  for (const ram of events.rams) {
    applyRamResolution(state, memory, approachVelocities, ram, tick, ramWrites);
  }
  flushRamWrites(state, ramWrites);

  // ---- the slams pass, FIRST HALF: the push and the `reeling` that rides with it ----
  //
  // The slam's impulse is assembled and applied HERE, beside the status that same slam applies
  // (spec P30), rather than in the contact pass — from the weapon's authored `ImpulseDef` plus the
  // contact geometry `contact.ts` carried on the event, which is the one input this file cannot
  // recompute (an OBB contact normal needs both hulls; poses give centre-to-centre, a different
  // vector on any hit that is not dead-on).
  //
  // **THE PASS IS DELIBERATELY SPLIT IN TWO, AT DIFFERENT POINTS IN THE TICK.** Everything else a
  // slam does — `memory.slammed`, `endManeuverOnly` and the attacker's self-status expiry, and the
  // `contactHits.push` — is in the second half, below the two `endDash` sweeps, where the whole
  // loop used to sit. Only the push and its `reeling` are hoisted above them, and that is not
  // tidiness:
  //
  //   `endDash` OVERWRITES velocity outright — it discards whatever the car was carrying and sets a
  //   purely-forward exit speed (see its doc comment). Through stage 3 a slam's push rode
  //   `resolveContacts`'s `best` map and was therefore applied by the impulses loop directly above,
  //   BEFORE both `endDash` calls, so a slam landing on a car that also ended a dash this tick was
  //   erased by that car's own dash exit. `resolvePair` explicitly supports that pairing: a dashing
  //   car and a charging car resolve to BOTH a dashHit from the dasher and a slam on that same
  //   dasher, which makes this the marquee thunderclap-vs-wildcharge clash rather than a corner
  //   case. Applying the push after `endDash` instead would let the slam survive where it has
  //   always been wiped — a real, player-visible buff to wildcharge in the one matchup it matters
  //   most in. Stage 4 is a seam move and is not making that balance change, so the ordering is
  //   restored rather than inherited from wherever the refactor happened to leave the loop.
  //
  // (Whether the erasure is the *better* game is a live question, deliberately left open for stage
  // 5: a slam that a victim's own dash silently deletes is an artifact of loop order, not a design.
  // But that is a balance decision about the game's headline ult clash and it belongs to a human,
  // not to a refactor.)
  //
  // Falloff never touches a slam (spec P24: weapon impulses "do not participate and do not share
  // the stack"), so `nextFalloff` is deliberately not called here and the slam is not counted into
  // it — an ult must not be quietly discounted by how many ordinary rams its victim has just
  // absorbed, nor discount the next real ram.
  //
  // ONE PUSH PER VICTIM PER TICK, LAST SLAM WINS. Two chargers landing on the same victim on the
  // same tick apply ONE impulse and ONE `reeling`, not two. This cap is deliberate and it is a
  // RESTORATION, not a new rule: the `best` map above held exactly one entry per victim and
  // resolved a tie with `>=` (so the later slam displaced the earlier), and the cap fell out of that
  // single-slot-per-victim structure for free. Stage 4 took slams off the map — which is what lets a
  // victim slammed by A and rammed by B in one tick take BOTH pushes, the one stacking case the
  // spec authorizes — and the slam-plus-slam cap had to become explicit or it would have been lost
  // with the map. Uncapped, two Wild Charges land 2x the authored `speed` on one car in one tick,
  // roughly 5.5x Bastion's top speed, plus a doubled `reeling`: an accidental juggle of exactly the
  // kind this stage's plan warns about.
  //
  // `lastSlamAt` reproduces the old `>=` tie-break exactly — the last event for a victim in
  // pair-enumeration order is the one that lands — and it is built from IMPULSE-BEARING slams only.
  // A charge row declaring no `impulse` pushes nothing, so letting one claim the victim's single
  // slot would suppress an earlier charger's push as well as landing none of its own, and the victim
  // would take nothing from either. The cap has to mean "the last slam that can actually push".
  //
  // O18's re-slam immunity CANNOT cover any of this: `memory.slammed` is written in the second half
  // below, after `resolveContacts` has already resolved the whole tick, so within a single tick both
  // slams have been decided and neither can see the other's record.
  const lastSlamAt = new Map<string, number>();
  events.slams.forEach((hit, index) => {
    if (impulseOf(hit.weaponId) === null) return;
    lastSlamAt.set(hit.targetSessionId, index);
  });

  for (const [index, hit] of events.slams.entries()) {
    // One test covers both filters: a slam that is not its victim's last impulse-bearing slam this
    // tick lands no push at all.
    if (lastSlamAt.get(hit.targetSessionId) !== index) continue;
    const authored = impulseOf(hit.weaponId);
    const victim = state.players.get(hit.targetSessionId);
    if (authored === null || !victim) continue;
    const imp: Impulse = {
      // `authored.def.direction` is deliberately NOT consulted here. The slam's direction is the
      // OBB contact normal `contact.ts` measured between the two hulls and carried on the event —
      // the one vector this file cannot recompute. That is correct for every row on this path today
      // because `wildcharge` declares `"radial"`, and radial for a CONTACT impulse (source and
      // target touching) IS the contact normal: centre-to-centre and normal agree to within the hull
      // geometry, and the normal is the more honest of the two on a glancing hit. A future charge
      // row authoring `"alongAim"` would silently get the contact normal instead — no runtime branch
      // is wanted (there is no second mode to implement for a contact impulse and no row that needs
      // one), so `weapon-config.test.ts` asserts every authored `impulse` is `"radial"` and fails
      // loudly the day that stops being true, and this comment is what the reader lands on.
      dirX: hit.dirX,
      dirY: hit.dirY,
      speed: authored.def.speed,
      // Inert on this path, and authored `0` on the only row that reaches it. `contactX`/`contactY`
      // below are the VICTIM'S CENTRE, so `applyImpulse`'s lever arm is exactly zero and no `spin`
      // value can rotate a slam's victim. See `SlamEvent`'s doc comment and `ImpulseDef.spin`;
      // `weapon-config.test.ts` guards the day a row authors a non-zero one.
      spin: authored.def.spin,
      defenceScaled: authored.def.defenceScaled,
      uncontrolTicks: authored.ticks.uncontrol,
      contactX: hit.contactX,
      contactY: hit.contactY,
    };
    const next = applyImpulse(victim, ramDefenceFor(state, statusMods, hit.targetSessionId), imp);
    victim.vx = next.vx;
    victim.vy = next.vy;
    victim.angVel = next.angVel;
    // The slam's own control-loss window, off its own row — NOT `ramTicks().uncontrol`, and not
    // scaled by anything. New behaviour as of stage 4: until now a slam left its victim with full
    // steering, because `contact.ts` hardcoded `uncontrolTicks: 0`. `applyStatus` refuses a
    // non-positive duration outright, so a row authoring `uncontrolMs: 0` writes nothing.
    writeStatuses(
      victim,
      applyStatus(readStatuses(victim), "reeling", tick, imp.uncontrolTicks, hit.attackerSessionId),
    );
    // AS20: a slam shoves its victim exactly as a ram does, so it counts toward spike credit too.
    recordShove(memory.spikes, hit.targetSessionId, hit.attackerSessionId, tick);
  }

  // A dash into a wall exits stopped, not at cap.
  for (const sessionId of events.wallBlockedDashers) {
    const player = state.players.get(sessionId);
    if (player) endDash(player, 0);
  }

  const contactHits: ContactHit[] = [];

  // One target per dash (O12): only the FIRST hit a dasher lands this tick counts, and the dash ends
  // there — a dasher that clips two cars in the same tick does not get to hit both. `events.dashHits`
  // is produced by `resolvePair`'s per-pair loop, so a dasher touching several cars at once can
  // appear more than once here; every entry after the first for a given attacker is dropped.
  const dashedThisTick = new Set<string>();
  for (const hit of events.dashHits) {
    if (dashedThisTick.has(hit.attackerSessionId)) continue;
    dashedThisTick.add(hit.attackerSessionId);
    const attacker = state.players.get(hit.attackerSessionId);
    if (attacker) {
      // Exit at the drive model's cap, the same way natural dash expiry does — not the unmodified
      // rating, so a dash that ends on a hit while `topSpeed` is debuffed (or buffed) exits at the
      // speed the car would actually be capped to that tick.
      const mods = modifiersFor(statusMods, hit.attackerSessionId);
      endDash(attacker, forwardMaxSpeedOf(carIdOf(attacker)) * mods.topSpeed);
    }
    contactHits.push(hit);
  }

  // ---- the slams pass, SECOND HALF: everything that is not the push ----
  //
  // The push and its `reeling` ran further up, ABOVE the two `endDash` sweeps — see the long comment
  // there for why the pass is split and why that half specifically has to precede them. Nothing in
  // this half touches velocity, so none of it cares where `endDash` falls; it stays here so
  // `contactHits` keeps the order combat has always been handed — every dash hit, then every slam.
  //
  // NOTHING HERE IS CAPPED. The one-push-per-victim cap above is a physics cap, not a damage cap, so
  // all of the following runs for EVERY slam in the tick: `memory.slammed` (last write wins, exactly
  // as it did when a slam rode the `best` map), `endManeuverOnly` plus the self-status expiry on
  // each attacker (both chargers spent their ult and both must end), and `contactHits.push` (combat
  // prices both hits).
  for (const hit of events.slams) {
    // A charge weapon that declares no `impulse` opens neither clock — but still ends its maneuver
    // and expires its own statuses below, because those are maneuver rules, not impulse rules.
    // Unreachable today; see `impulseOf`.
    const authored = impulseOf(hit.weaponId);
    if (authored !== null) {
      memory.slammed.set(hit.targetSessionId, {
        bySessionId: hit.attackerSessionId,
        wallStunUntilTick: tick + authored.ticks.wallStunWindow,
        immuneUntilTick: tick + authored.ticks.retriggerImmunity,
        wallStunTicks: authored.ticks.wallStunDuration,
      });
    }
    const attacker = state.players.get(hit.attackerSessionId);
    if (attacker) {
      // O2: the charge ends on its first slam, taking its own self-applied statuses with it — a
      // power whose window closes early cannot leave a buff running past the thing that ended it.
      // The attacker is deliberately given NO impulse of its own: a slam is authored, not contested,
      // so it takes nothing from its own hit. That used to be spelled as a zero-magnitude
      // `attackerImpulse` riding a per-victim impulses map purely so the bridge had one code path;
      // the car-physics rework's stage 4 took the slam off that map and the Unity ram port removed
      // the map itself, so there is nothing left to build and the absence here IS the rule — it is
      // not an omission. (A RAM attacker does now have an authored outcome, but it is the opposite
      // one: spec §7.2 stops it dead. A slam attacker keeps its velocity; the two must not be
      // conflated.) `SLAM_CONFIG.selfKeepFactor`'s hand-tuned
      // forward-only restore was replaced outright rather than reproduced, so the attacker's
      // post-slam velocity is entirely whatever `resolveWorld`'s restitution already reflected off
      // it this tick. Only the maneuver fields need clearing, so `endManeuverOnly`, not `endDash`.
      endManeuverOnly(attacker);
      writeStatuses(
        attacker,
        expireStatusesFromSource(readStatuses(attacker), hit.attackerSessionId, tick),
      );
    }
    contactHits.push(hit);
  }

  // Wall-stun sweep (O2 window): a car shoved by a slam that lands against level geometry within
  // the impulse's own `wallStun.windowMs` stuns once. Immunity and the stun window are independent
  // clocks — the stun firing closes only its own window, so re-slam immunity keeps running
  // underneath it. All three numbers were stamped onto the record from the slamming weapon's row
  // when the slam landed, so this sweep needs no weapon lookup of its own — and a stun that fires
  // is the length the weapon that threw it authored, even if the tuning store has been rewritten
  // since (playground only, but the record is the honest source either way).
  const statusRequests: StatusRequest[] = [];
  for (const [victimId, entry] of [...memory.slammed]) {
    if (tick >= entry.wallStunUntilTick && tick >= entry.immuneUntilTick) {
      memory.slammed.delete(victimId);
      continue;
    }
    if (tick >= entry.wallStunUntilTick) continue;
    // `isSolid`, not `isOnField`: a victim who died and respawned phased inside the window is not
    // in the world (M13/M14), and spawn protection must not be broken by a stun from the old life.
    const player = state.players.get(victimId);
    if (!player || !isSolid(player, tick)) continue;
    if (!hullTouchesWorld(carHullOf(player.x, player.y, player.angle), arena.obstacles, bounds, SLAM_CONFIG.wallContactPad)) {
      continue;
    }
    statusRequests.push({
      targetSessionId: victimId,
      statusId: "stunned",
      durationTicks: entry.wallStunTicks,
      sourceSessionId: entry.bySessionId,
    });
    // Closes THIS window only, so the stun fires once per slam; immunity keeps its own clock.
    entry.wallStunUntilTick = tick;
  }

  // Resolved last, after every push this tick has been recorded (both the ram loop and the slam
  // loop above call `recordShove`): a slam that shoves a victim straight onto a strip in the same
  // tick must still be able to credit that slam's attacker.
  const spikeHits = resolveSpikeHits(events.spikeContacts, memory.spikes, tick);

  return { contactHits, statusRequests, spikeHits };
}

/**
 * Drop one session's contact memory entirely (spec PG67).
 *
 * The three maps are ordinary per-victim state. `contacts` is the one worth naming: it holds pair
 * keys so a ram fires on ENTRY rather than on every tick of an overlap, so a key left behind after a
 * car is removed would make the NEXT genuine contact between those two cars read as a continuing one
 * and land no ram at all. Deleting from a `Set` while iterating it is well-defined in JS — an entry
 * removed at or before the cursor is simply not revisited.
 */
export function forgetContactPlayer(memory: ContactMemory, sessionId: string): void {
  memory.slammed.delete(sessionId);
  memory.falloff.delete(sessionId);
  forgetSpikeState(memory.spikes, sessionId);
  for (const key of memory.contacts) {
    const [a, b] = key.split("|");
    if (a === sessionId || b === sessionId) memory.contacts.delete(key);
  }
}
