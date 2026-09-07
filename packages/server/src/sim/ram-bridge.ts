import {
  RAM_CONFIG,
  RAM_TICKS,
  SLAM_CONFIG,
  applyImpulse,
  applyStatus,
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
  type StatusRequest,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { modifiersFor, readStatuses, writeStatuses } from "./status-bridge.js";

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

  stack.set(victimId, { count: count + 1, expiresAtTick: tick + RAM_TICKS.drWindow });

  return {
    durationScale: Math.max(
      RAM_TICKS.durationFloor / RAM_TICKS.uncontrol,
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
}

export function newContactMemory(): ContactMemory {
  return { contacts: new Set(), slammed: new Map(), falloff: newFalloffStack() };
}

export interface ContactTickResult {
  contactHits: ContactHit[];
  statusRequests: StatusRequest[];
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
 * way `endDash` deliberately does for a dash. (Through stage 3 the same outcome was spelled as a
 * zero-magnitude `attackerImpulse` applied by the impulses loop; stage 4 stopped building one at
 * all, which changes nothing here.)
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
      defenceMult: modifiersFor(statusMods, sessionId).ramDefence,
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
 * effect it carries. Renamed from `massFor` in stage 3 Task 3 — reads `ramDefenceOf` instead of
 * `massOf` now, which is what actually delivers the ~10x inertia-denominator drop `nextSpin`'s doc
 * comment (`sim/impulse.ts`) describes: this is production's only caller of `applyImpulse` for a ram
 * or slam, so until this function changed, the real game was still feeding it `mass`-shaped numbers
 * regardless of what the parameter was named. Both ram impulses are `defenceScaled: false` (the
 * contest already divided by `ramDefence`), so this value only reaches `applyImpulse`'s `nextSpin`
 * inertia term today. `0` for a session with no player, which `defenceFactorOf` (`sim/impulse.ts`)
 * treats as "unscaled" rather than dividing by it.
 */
function ramDefenceFor(state: ArenaState, statusMods: ReadonlyMap<string, Modifiers>, sessionId: string): number {
  const player = state.players.get(sessionId);
  if (!player) return 0;
  return ramDefenceOf(carIdOf(player)) * modifiersFor(statusMods, sessionId).ramDefence;
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
  const bounds = { width: arena.width, height: arena.height };

  const cars = contactCarsOf(state, roster, statusMods, approachVelocities, maneuverWeapons, tick);
  const { impulses, contacts, events } = resolveContacts(
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

  // Stage 3 Task 2 (car-physics rework): both halves of the pair land through `Impulse` now, EACH
  // computed independently by the contest (spec R7) rather than one being a negated, mass-scaled
  // copy of the other. `impulses` is keyed by VICTIM id and carries `attackerId` alongside both
  // resolved pushes (`ImpulseEntry.impulse`/`attackerImpulse`) — no separate lookup is needed to
  // find who threw it, since only `resolveContacts`'s own pair loop is in a position to say. The
  // victim receives `entry.impulse`; the attacker receives `entry.attackerImpulse` directly —
  // `reactionOf` would have been dead code on this path (handing the attacker a negated copy of a
  // contest-derived impulse is incoherent: the contest already decided what the attacker takes,
  // independently of what the victim took), which is why stage 3 Task 3 deletes it outright rather
  // than leaving it unreachable.
  //
  // `knock.authority` had no successor for one release; stage 3b is what reinstates ram control-loss,
  // as the `reeling` status below, scaled by the victim's own diminishing-returns stack.
  //
  // **Every entry in this map is a RAM** (stage 4), so falloff and `reeling` — ram-only by spec P24
  // — apply unconditionally here with nothing to disambiguate. A slam no longer writes an `Impulse`
  // at all: `contact.ts`'s charge branch emits a `SlamEvent` and the `events.slams` loop below
  // assembles the push from the weapon's own `ImpulseDef`. What that deletes is not just a
  // predicate but a dependency: the old `!slammedVictims.has(victimId)` inference was only correct
  // while a slam's magnitude outranked every possible ram, an ordering `resolveContacts` never
  // enforced (spec R9 forbids the ceiling that would), and it would have silently misclassified a
  // ram as a slam the day a retune inverted it.
  for (const [victimId, entry] of impulses) {
    const scales = nextFalloff(memory.falloff, victimId, tick);
    const scaledImpulse: Impulse = {
      ...entry.impulse,
      speed: entry.impulse.speed * scales.impulseScale,
      uncontrolTicks: Math.max(
        RAM_TICKS.durationFloor,
        Math.round(RAM_TICKS.uncontrol * scales.durationScale),
      ),
    };

    const victim = state.players.get(victimId);
    if (victim) {
      const next = applyImpulse(victim, ramDefenceFor(state, statusMods, victimId), scaledImpulse);
      victim.vx = next.vx;
      victim.vy = next.vy;
      victim.angVel = next.angVel;
      // Falloff scales only the victim's half, above, and `reeling` only ever lands on the victim,
      // here — never on `entry.attackerImpulse`. Falloff exists to stop a *victim* being ram-locked,
      // chained into a stunlock by repeated hits that each land at full strength. The attacker's own
      // impulse is the cost of throwing the punch: it is charged in full every time, regardless of
      // how many rams the victim has recently absorbed. Discounting it too would mean spamming rams
      // into an already-worn-down victim gets progressively *safer* for the attacker, which is the
      // opposite of what a diminishing-returns mechanic should do to the aggressor. Nothing in the
      // victim's falloff stack is even visible from the attacker's side of the contest —
      // `nextFalloff` is keyed by victim id and never consulted when building `entry.attackerImpulse`
      // — so this is not a flag to remember to check; there is no path by which the attacker's
      // impulse could be scaled by it.
      writeStatuses(
        victim,
        applyStatus(readStatuses(victim), "reeling", tick, scaledImpulse.uncontrolTicks, entry.attackerId),
      );
    }

    const attacker = state.players.get(entry.attackerId);
    if (attacker) {
      const next = applyImpulse(attacker, ramDefenceFor(state, statusMods, entry.attackerId), entry.attackerImpulse);
      attacker.vx = next.vx;
      attacker.vy = next.vy;
      attacker.angVel = next.angVel;
    }
  }

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
    // The slam's own control-loss window, off its own row — NOT `RAM_TICKS.uncontrol`, and not
    // scaled by anything. New behaviour as of stage 4: until now a slam left its victim with full
    // steering, because `contact.ts` hardcoded `uncontrolTicks: 0`. `applyStatus` refuses a
    // non-positive duration outright, so a row authoring `uncontrolMs: 0` writes nothing.
    writeStatuses(
      victim,
      applyStatus(readStatuses(victim), "reeling", tick, imp.uncontrolTicks, hit.attackerSessionId),
    );
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
      // The attacker is deliberately given NO impulse of its own: a slam is authored, not contested
      // (spec R7's independence has no "other side"), so it takes nothing from its own hit. That
      // used to be spelled as a zero-magnitude `attackerImpulse` riding the impulses map purely so
      // the bridge had one code path; with the slam off that map there is nothing to build, and the
      // absence here IS the rule — it is not an omission. `SLAM_CONFIG.selfKeepFactor`'s hand-tuned
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

  return { contactHits, statusRequests };
}
