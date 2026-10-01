import {
  ArenaState,
  PlayerState,
  RoomPhase,
  boundsOf,
  carIdOf,
  getArena,
  isOnField,
  otherCarHulls,
  ramDefenceOf,
  slots,
  stepSim,
  wrapAngle,
  type ArenaDef,
  type ContextEntry,
  type Modifiers,
  type SimBody,
  type StepContext,
  type TickInputBuffer,
} from "@motor-combat-moba/shared";
import { modifiersFor } from "./status-bridge.js";

/**
 * Every bit at or beyond `maxFireSlots` is stripped before a wire mask ever reaches the sim.
 * Computed per call, never hoisted to module scope: `maxFireSlots` is a mode-bundle value, and a
 * module-level constant would freeze it at whichever mode happened to be installed at import time.
 */
function slotMaskOf(): number {
  return (1 << slots().maxFireSlots) - 1;
}

/**
 * What one `serverTick` reports about the tick it just simulated.
 */
export interface TickResult {
  /** Per session id, the validated slot bitmask of NEW presses on the input this tick simulated. */
  masks: Map<string, number>;
  /**
   * Per session id, the car's WHOLE WORLD VELOCITY carried INTO this tick — read before `stepSim`
   * ran, and therefore before `resolveWorld` could reflect it off anything.
   *
   * **This is the whole fix for the ram trigger bug.** `resolveWorld` runs INSIDE `stepSim`, and
   * `applyContact` rebounds a car to about -35% of its impact speed on the tick a contact resolves.
   * `ramTick` runs after `serverTick` — that ordering is a rule, because ram must measure the poses
   * cars actually ended up at — so the velocity left on `PlayerState` is the post-bounce one. Feeding
   * that to `resolveRam` made its approach term negative on every tick a hull actually overlapped,
   * and a ram only fired on the rare tick where a pair landed inside `ram().contactPad`
   * WITHOUT overlapping: a ~1.5 unit window against a per-tick step that was 10.5-18 units at the
   * time this bug was found, so 8-20% of contacts. (The 2026-09-06 heavy-car pass has since cut
   * that step to 6.3-8.9 units; the fix and the window it measures are unaffected either way.)
   * Measured in `playtest/common/ram.ts`, which is what found it.
   *
   * **A VECTOR, not the forward scalar it was through stage 3 Task 2.** The old field carried only
   * `forwardOf(vx, vy, angle)`, and `contactCarsOf` rebuilt a purely-forward `vx`/`vy` from it — a
   * shim that was exactly right while nothing could drive sideways into a contest, and wrong the
   * moment a lateral pre-collision component mattered. Since the vector-drive rework a car genuinely
   * carries lateral velocity (a knock, a slide out of a turn, a wall graze), and `resolveRam`'s
   * `driveInOf` dots the velocity against the contact normal itself — so it already asks the only
   * question the old "forward, not total" reasoning was protecting: a car sliding sideways PAST
   * someone dots to nothing, while one sliding sideways INTO them genuinely is closing. Widening the
   * cache is therefore what lets the contest read the approach it was always specified to read.
   *
   * Reading it here also keeps `stepSim` untouched — it stays the single lockstep both halves
   * import, which a richer return value from it would not.
   *
   * Recorded for every player in the room, including ones that are not stepped this tick: a parked
   * car is still a `resolveRam` participant, and its approach term decides whether it is the
   * attacker or the victim.
   */
  approachVelocities: Map<string, { vx: number; vy: number }>;
  /**
   * Per session id, the `aimAngle` of this tick's input when that input carried a new press (spec
   * TR23). Absent when the pressing input carried no `aimAngle`, and the press then fires where the
   * turret already points (TR12).
   */
  aims: Map<string, number>;
  /**
   * Per session id, the `viewTick` of this tick's input when that input was a REAL frame (not a
   * repeat) carrying a new press and a `viewTick` (NR35): the render tick its client was drawing
   * remotes at, which the pipeline turns into that press's compensation budget (NR36). A repeat
   * never creates a press, and a frame with no `viewTick` (a bot, a client before its clock synced)
   * records nothing.
   */
  viewTicks: Map<string, number>;
  /**
   * Per session id, how many times `stepSim` actually ran for that car this tick: 1 for a car on
   * the field in `MATCH`, 0 otherwise, and never more (NR17). Counted at the call, not derived, so
   * the netsim harness's steps-per-tick metric measures the rule rather than restating it.
   */
  steps: Map<string, number>;
}

/**
 * Advance every player by exactly one input: the one its owner sent FOR this tick (NR17, NR22).
 * `state.tick` is the tick being simulated, and `dt` is seconds and must match the room simulation
 * tick (`MS_PER_TICK / 1000`; the room's `FixedStepper` runs one tick per `MS_PER_TICK` of wall clock).
 *
 * Each player's `TickInputBuffer` hands back one input per tick whatever arrived: the real frame for
 * `state.tick` when it came in time, otherwise the last real input repeated for
 * `NET_CONFIG.inputRepeatMs` and then neutral keys. So a car steps once per tick however many frames
 * its client sent (no flooding past one step — F1), and a car whose owner has gone quiet keeps
 * integrating (a ram's knock still resolves on an alt-tabbed player) without any separate
 * silent-coast branch. `ackRepeated` tells the owner which ticks ran on a fill, and `inputSlack` (NR21)
 * how far ahead its frames have been landing, so its scheduler can steer its lead.
 *
 * `statusMods` is every player's status multipliers, already swept of expired entries by
 * `statusTick`. It reaches `stepDrive` through `StepContext.modifiers`, and a player with nothing on
 * them gets `NEUTRAL_MODIFIERS`, which reproduces the pre-effect drive model exactly.
 *
 * Cars only move during `RoomPhase.MATCH`, and only for players who are actually on the field
 * (`PlayerStatus.IN_MATCH`). Everything else — any other phase, or a lobby/post-match player who
 * keeps sending inputs mid-match — still *takes* this tick's input from the buffer, so the buffer
 * never holds a stale frame into the moment the gate opens, but nothing is simulated and no fire is
 * reported.
 *
 * The mover gate here is `isOnField`; the wall gate inside `otherCarHulls` is the narrower
 * `isSolid` (`isOnField` plus "not currently phased"). They are deliberately NOT the same predicate
 * anymore — a respawning car (M14) must steer normally while passing through everyone, so it passes
 * this gate but fails the wall gate. Outside that one case the two still have to agree, or a player
 * who is not in the match would be driven around the arena while staying invisible to *their*
 * collision checks.
 *
 * `carIdOf` and `otherCarHulls` live in `@motor-combat-moba/shared` because the client's prediction
 * assembles the *same* `StepContext` (see `buildStepContext` in shared's `net/step-context.ts`).
 * `stepSim` is the single lockstep and this is its input, so anything that changes how a hull is
 * sized or which players are solid must change for both sides at once. Edit them there, not here.
 *
 * Players are stepped in sorted `sessionId` order, and resolution is sequential: each player is
 * stepped against the *current* poses of the others, so a player stepped later already sees the
 * updated positions of the players stepped before it. Sorting is what makes that reproducible;
 * `MapSchema` insertion order is not.
 *
 * Returns, for every session id whose SIMULATED input this tick carried a new press, the validated
 * slot bitmask of those presses. Firing rides the same gate as movement rather than the raw key
 * state, so a lobby player spamming `fire` never spawns anything. The mask itself is
 * attacker-controlled wire data: non-integers and non-positive values collapse to 0, and whatever
 * remains is masked to `slots().maxFireSlots` bits before combat ever sees it, so a hand-rolled
 * client cannot fire a slot its car does not have. The weapon cooldown in `runCombat` bounds the
 * rate on top of that.
 *
 * Also returns each player's `approachVelocity`: the whole world velocity they carried INTO this
 * tick, before `resolveWorld` had a chance to reflect it. `contactTick` reads it as its drive-in
 * term — see `TickResult.approachVelocities` for why it cannot use the velocity left on
 * `PlayerState`.
 */
/**
 * **The fire mask carries PRESSES, not held keys.** `fireSlots` on the wire is raw key state, so a
 * player holding the trigger sets the same bit on every input. `prevFireMasks` remembers what each
 * player's last SIMULATED input had down, and only a newly-set bit counts as a press
 * (`clean & ~prev`). Holding the trigger therefore fires exactly once — and so does a repeated
 * input (NR22): a tick filled with the last input carries the same bits, so it can never create a
 * press, and a release that arrives after the fill still reads as a release.
 *
 * Edge detection lives here rather than on the client because the client is not trusted with it: a
 * hand-rolled one could otherwise send a pulsing mask and buy back auto-fire.
 */
export function serverTick(
  state: ArenaState,
  buffers: ReadonlyMap<string, TickInputBuffer>,
  dt: number,
  phase: RoomPhase,
  statusMods: ReadonlyMap<string, Modifiers>,
  prevFireMasks: Map<string, number>,
): TickResult {
  const world = tickWorldOf(getArena(state.arenaId));
  const moving = phase === RoomPhase.MATCH;
  const slotMask = slotMaskOf();
  // Sorted once per tick. This same array fixes both the order players are stepped in and the order
  // of the hulls built from it, so it is threaded through rather than recomputed.
  const entries = sortedEntries(state);
  const masks = new Map<string, number>();
  const aims = new Map<string, number>();
  const viewTicks = new Map<string, number>();
  const approachVelocities = new Map<string, { vx: number; vy: number }>();
  const steps = new Map<string, number>();

  for (const { sessionId, player } of entries) {
    // BEFORE any stepping, so this is the pre-collision velocity `contactTick` needs. Unconditional
    // — a player who is not stepped this tick is still a ram participant. See `TickResult`.
    //
    // A COPY, never the live schema object: `player` is mutated by `stepSim`'s write-back a few
    // lines below, so storing a reference would hand contact the POST-collision velocity — the exact
    // bug this cache exists to prevent, reintroduced through aliasing rather than through ordering.
    approachVelocities.set(sessionId, { vx: player.vx, vy: player.vy });
    steps.set(sessionId, 0);

    // Only `carId`, `others` and `selfRamDefence` vary per player; `world` is fixed for the whole tick.
    // A `null` context means "nothing about this player moves right now": take the input, step nothing.
    const ctx: StepContext | null =
      moving && isOnField(player)
        ? {
            ...world,
            carId: carIdOf(player),
            others: otherCarHulls(entries, sessionId, state.tick),
            // Swept and derived once for the whole tick by `statusTick`, never per player here: a
            // second derivation is a second chance for the two halves of the lockstep to disagree,
            // and the client builds its own from the same list through the same shared function.
            modifiers: modifiersFor(statusMods, sessionId),
            selfRamDefence: ramDefenceOf(carIdOf(player)),
          }
        : null;

    // A player with no buffer (a spectator seat, a harness row) has no hands: nothing to take.
    const buffer = buffers.get(sessionId);
    if (!buffer) {
      player.lastSteer = 0;
      player.lastThrottle = 0;
      continue;
    }
    const taken = buffer.take(state.tick);
    // NR33: every car, every tick, stepped or not — what dead reckoning on a client will feed stepSim.
    player.lastSteer = taken.keys.steer;
    player.lastThrottle = taken.keys.throttle;
    player.ackRepeated = taken.repeated;
    player.inputSlack = buffer.slackMeanTicks();
    player.inputSlackStd = buffer.slackStdTicks();
    if (ctx === null) continue;

    writeBody(player, stepSim(bodyOf(player), taken.keys, dt, ctx));
    steps.set(sessionId, (steps.get(sessionId) ?? 0) + 1);
    const raw = taken.keys.fireSlots;
    const clean = Number.isInteger(raw) && raw > 0 ? raw & slotMask : 0;
    // Only bits that were NOT down on this player's previous simulated input count as a press.
    const prev = prevFireMasks.get(sessionId) ?? 0;
    const pressed = clean & ~prev;
    prevFireMasks.set(sessionId, clean);
    if (pressed !== 0) {
      masks.set(sessionId, pressed);
      // Normalised through `wrapAngle` before it is stored: a client is untrusted input (local
      // invariant), and an absurd-but-finite value (say, 1e300) would otherwise ride all the way
      // to `PlayerState.aimBearing` and the turret/lead math built on top of it unnormalised.
      if (taken.keys.aimAngle !== undefined) aims.set(sessionId, wrapAngle(taken.keys.aimAngle));
      if (taken.frame?.viewTick !== undefined) viewTicks.set(sessionId, taken.frame.viewTick);
    }
  }

  return { masks, aims, viewTicks, approachVelocities, steps };
}

/**
 * Players paired with their session id, sorted by it. Deterministic iteration order — `MapSchema`
 * hands back insertion order, which the room controls. The `PlayerState` values ride along so the
 * drain loop can write back to them, and the array doubles as the `ContextEntry[]` that
 * `otherCarHulls` orders its output by.
 */
function sortedEntries(state: ArenaState): Array<ContextEntry & { player: PlayerState }> {
  return [...state.players.entries()]
    .map(([sessionId, player]) => ({ sessionId, player }))
    .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
}

/** The parts of a `StepContext` that are identical for every player on this tick. */
type TickWorld = Pick<StepContext, "obstacles" | "bounds">;

function tickWorldOf(arena: ArenaDef): TickWorld {
  return { obstacles: arena.obstacles, bounds: boundsOf(arena) };
}

function bodyOf(player: PlayerState): SimBody {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    vx: player.vx,
    vy: player.vy,
    angVel: player.angVel,
    // Reading/writing these fields here is what makes stepDrive's DASH/HOLD/CHARGE integration
    // and fullStop take hold once something upstream sets them, without this bridge needing to
    // change again.
    maneuver: player.maneuver,
    maneuverTicksLeft: player.maneuverTicksLeft,
    maneuverAngle: player.maneuverAngle,
    maneuverSpeed: player.maneuverSpeed,
  };
}

function writeBody(player: PlayerState, body: SimBody): void {
  player.x = body.x;
  player.y = body.y;
  player.angle = body.angle;
  player.vx = body.vx;
  player.vy = body.vy;
  player.angVel = body.angVel;
  player.maneuver = body.maneuver;
  player.maneuverTicksLeft = body.maneuverTicksLeft;
  player.maneuverAngle = body.maneuverAngle;
  player.maneuverSpeed = body.maneuverSpeed;
}
