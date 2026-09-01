import {
  ArenaState,
  ManeuverKind,
  NET_CONFIG,
  PlayerState,
  RoomPhase,
  WEAPON_SLOT_CONFIG,
  carIdOf,
  getArena,
  isOnField,
  otherCarHulls,
  stepSim,
  type ArenaDef,
  type ContextEntry,
  type InputMessage,
  type Modifiers,
  type SimBody,
  type StepContext,
} from "@motor-combat-moba/shared";
import { modifiersFor } from "./status-bridge.js";

/** Every bit at or beyond `maxWeaponSlots` is stripped before a wire mask ever reaches the sim. */
const SLOT_MASK = (1 << WEAPON_SLOT_CONFIG.maxWeaponSlots) - 1;

/**
 * What one `serverTick` reports about the tick it just simulated.
 */
export interface TickResult {
  /** Per session id, the validated slot bitmask that player fired with on a simulated input. */
  masks: Map<string, number>;
  /**
   * Per session id, the scalar speed the car carried INTO this tick — read before `stepSim` ran,
   * and therefore before `resolveWorld` could reflect it off anything.
   *
   * **This is the whole fix for the ram trigger bug.** `resolveWorld` runs INSIDE `stepSim`, and
   * `applyContact` rebounds a car to about -35% of its impact speed on the tick a contact resolves.
   * `ramTick` runs after `serverTick` — that ordering is a rule, because ram must measure the poses
   * cars actually ended up at — so the `speed` left on `PlayerState` is the post-bounce one. Feeding
   * that to `resolveRam` made its approach term negative on every tick a hull actually overlapped,
   * and a ram only fired on the rare tick where a pair landed inside `RAM_CONFIG.contactPad`
   * WITHOUT overlapping: a ~1.5 unit window against a 10.5-18 unit per-tick step, so 8-20% of
   * contacts. Measured in `playtest/ram.ts`, which is what found it.
   *
   * The speed carried into the tick is the right number on its own terms, not merely a workaround:
   * it is the speed at which the car covered the ground that brought it into contact. Reading it
   * here also keeps `stepSim` untouched — it stays the single lockstep both halves import, which a
   * richer return value from it would not.
   *
   * Recorded for every player in the room, including ones that are not stepped this tick: a parked
   * or silent car is still a `resolveRam` participant, and its approach term decides whether it is
   * the attacker or the victim.
   */
  approachSpeeds: Map<string, number>;
}

/**
 * Advance every player by their queued inputs. `dt` is seconds and must match the room simulation
 * interval (1 / getTickRateHz(TICK_RATE_HZ)).
 *
 * **One player is advanced without any input: a knocked one that has gone silent.** A ram writes
 * motion onto its victim from outside, and that motion has to resolve whether or not the victim is
 * still sending — otherwise an alt-tabbed or stalled player is an immovable wall carrying a
 * permanent shove. Such a player is coasted on a neutral input, without an ack and without a fire
 * mask, only while `hasKnock` holds. Every other silent player is left exactly as it was.
 *
 * `statusMods` is every player's status multipliers, already swept of expired entries by
 * `statusTick`. It reaches `stepDrive` through `StepContext.modifiers`, and a player with nothing on
 * them gets `NEUTRAL_MODIFIERS`, which reproduces the pre-effect drive model exactly.
 *
 * Cars only move during `RoomPhase.MATCH`, and only for players who are actually on the field
 * (`PlayerStatus.IN_MATCH`). Everything else — any other phase, or a lobby/post-match player who
 * keeps sending inputs mid-match — still *drains* the queue and still advances
 * `lastProcessedInputSeq`. Both halves matter: without the drain the queue grows unbounded through
 * the countdown and the car lurches the moment the gate opens, and without the seq advance the
 * client's pending-input buffer never clears, so reconciliation replays stale inputs forever.
 *
 * The mover gate here is `isOnField`; the wall gate inside `otherCarHulls` is the narrower
 * `isSolid` (`isOnField` plus "not currently phased"). They are deliberately NOT the same predicate
 * anymore — a respawning car (M14) must steer normally while passing through everyone, so it passes
 * this gate but fails the wall gate. Outside that one case the two still have to agree, or a player
 * who is not in the match would be driven around the arena while staying invisible to *their*
 * collision checks.
 *
 * `carIdOf` and `otherCarHulls` live in `@motor-combat-moba/shared` because the client's prediction
 * assembles the *same* `StepContext` (see `buildStepContext` in the client's `net/step-context.ts`).
 * `stepSim` is the single lockstep and this is its input, so anything that changes how a hull is
 * sized or which players are solid must change for both sides at once. Edit them there, not here.
 *
 * Players are stepped in sorted `sessionId` order, and resolution is sequential: each player is
 * stepped against the *current* poses of the others, so a player stepped later already sees the
 * updated positions of the players stepped before it. Sorting is what makes that reproducible;
 * `MapSchema` insertion order is not.
 *
 * Within one player, inputs are applied in *seq* order rather than arrival order, and at most
 * `NET_CONFIG.maxInputsPerTick` of them actually reach `stepSim`. See the comments in the drain
 * loop for why each of those matters.
 *
 * Returns, for every session id that asked to fire on an input this tick actually **simulated**, the
 * validated slot bitmask it fired with. Firing rides the same gate as movement rather than the raw
 * key state, so an input past the per-tick cap cannot buy a shot the sim never ran, and a lobby
 * player spamming `fire` never spawns anything. The mask itself is attacker-controlled wire data:
 * non-integers and non-positive values collapse to 0, and whatever remains is masked to
 * `WEAPON_SLOT_CONFIG.maxWeaponSlots` bits before combat ever sees it, so a hand-rolled client
 * cannot fire a slot its car does not have. Masks from several inputs simulated in one tick are
 * OR-ed together. The weapon cooldown in `runCombat`, not this map, is what limits the rate —
 * several fire inputs in one tick still yield at most one shot.
 *
 * Also returns each player's `approachSpeed`: the speed they carried INTO this tick, before
 * `resolveWorld` had a chance to reflect it. `ramTick` reads it as its approach term — see
 * `TickResult.approachSpeeds` for why it cannot use the speed left on `PlayerState`.
 */
/**
 * **The fire mask carries PRESSES, not held keys.** `fireSlots` on the wire is raw key state, so a
 * player holding the trigger sets the same bit on every input. `prevFireMasks` remembers what each
 * player's last SIMULATED input had down, and only a newly-set bit counts as a press
 * (`clean & ~prev`), evaluated per input in sequence order so a release and re-press inside one
 * tick's batch still reads as two presses. Holding the trigger therefore fires exactly once.
 *
 * Edge detection lives here rather than on the client because the client is not trusted with it: a
 * hand-rolled one could otherwise send a pulsing mask and buy back auto-fire. The weapon cooldown in
 * `runCombat` still bounds the rate on top of this.
 */
export function serverTick(
  state: ArenaState,
  queues: Map<string, InputMessage[]>,
  dt: number,
  phase: RoomPhase,
  statusMods: ReadonlyMap<string, Modifiers>,
  prevFireMasks: Map<string, number>,
): TickResult {
  const world = tickWorldOf(getArena(state.arenaId));
  const moving = phase === RoomPhase.MATCH;
  // Sorted once per tick. This same array fixes both the order players are stepped in and the order
  // of the hulls built from it, so it is threaded through rather than recomputed.
  const entries = sortedEntries(state);
  const masks = new Map<string, number>();
  const approachSpeeds = new Map<string, number>();

  for (const { sessionId, player } of entries) {
    const queue = queues.get(sessionId);
    // BEFORE any stepping, so this is the pre-collision speed `ramTick` needs. Unconditional —
    // a player who is not stepped this tick is still a ram participant. See `TickResult`.
    approachSpeeds.set(sessionId, player.speed);

    // Only `carId` and `others` vary per player; `world` is fixed for the whole tick.
    // A `null` context means "nothing about this player moves right now": drain only.
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
          }
        : null;

    if (!queue || queue.length === 0) {
      // Nothing to drain — but a ram knock is motion applied from OUTSIDE this player, so it has to
      // integrate whether or not they are still talking to us. A backgrounded browser tab stops
      // sending entirely (`requestAnimationFrame` throttles hard when hidden), and without this step
      // the victim sits frozen holding a full-strength shove: unrammable, and never decaying either.
      // Found in playtest, where a parked second tab behaved as an immovable wall.
      //
      // Coasting on a synthetic neutral input is the smallest thing that resolves the knock. The ack
      // is deliberately NOT advanced and no fire mask is reported: this step acknowledges no input
      // and grants no shot, it only lets physics finish what a ram started.
      if (ctx !== null && hasKnock(player)) {
        writeBody(player, stepSim(bodyOf(player), COAST_INPUT, dt, ctx));
      }
      continue;
    }

    // Arrival order is not seq order: `withSimulatedLatency` gives every message its own jittered
    // delay, so two inputs sent a tick apart reorder routinely at the latencies this project
    // simulates. Sorting makes the applied order a function of the client-assigned seq — which is
    // what client-side replay assumes — and guarantees the ack below ends on the highest seq drained
    // rather than on whichever packet happened to land last.
    const batch = queue.splice(0, queue.length).sort(bySeq);

    for (const [index, msg] of batch.entries()) {
      // Past the cap an input is still drained and still acked, but never simulated. Intake is
      // unbounded, so without this a client sending at 4x the tick rate would take 4x as many steps
      // per tick and simply move faster than everyone else. The cap bounds that advantage at
      // `maxInputsPerTick`x — it does not remove it — and the discarded inputs make a flooder
      // diverge from the server, so reconciliation snaps them back. See NET_CONFIG.
      if (ctx !== null && index < NET_CONFIG.maxInputsPerTick) {
        writeBody(player, stepSim(bodyOf(player), msg, dt, ctx));
        const raw = msg.fireSlots;
        const clean = Number.isInteger(raw) && raw > 0 ? raw & SLOT_MASK : 0;
        // Only bits that were NOT down on this player's previous simulated input count as a press.
        // `prev` advances per input rather than per tick, so a release and re-press inside one batch
        // is two presses, not one held key.
        const prev = prevFireMasks.get(sessionId) ?? 0;
        const pressed = clean & ~prev;
        prevFireMasks.set(sessionId, clean);
        if (pressed !== 0) masks.set(sessionId, (masks.get(sessionId) ?? 0) | pressed);
      }
      player.lastProcessedInputSeq = msg.seq;
    }
  }

  return { masks, approachSpeeds };
}

function bySeq(a: InputMessage, b: InputMessage): number {
  return a.seq - b.seq;
}

/**
 * The synthetic input a knocked-but-silent player is coasted on: no steering, no throttle, no fire.
 * `seq` is never read by `stepSim` and this input is never acked, so the value is immaterial.
 */
const COAST_INPUT: InputMessage = { seq: 0, steer: 0, throttle: 0, fireSlots: 0 };

/**
 * Does this player still carry knock state that needs integrating?
 *
 * Neutral is `angVel 0, shove 0/0, authority 1`, and `stepDrive`'s decay snaps to exactly those
 * values inside its epsilons rather than approaching them asymptotically. So this goes false on its
 * own after a bounded number of ticks and the coast stops — a silent player is stepped only while a
 * knock is actually resolving, never indefinitely.
 */
function hasKnock(player: PlayerState): boolean {
  return (
    player.angVel !== 0 || player.shoveX !== 0 || player.shoveY !== 0 || player.authority !== 1 ||
    // A maneuver is also motion applied from outside the player's own inputs: a dashing or held
    // car must keep integrating when its owner goes silent, or it freezes mid-dash holding the
    // whole state. Ends on its own when the ticks run out, exactly as the knock decays do.
    player.maneuver !== ManeuverKind.NONE
  );
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
  return { obstacles: arena.obstacles, bounds: { width: arena.width, height: arena.height } };
}

function bodyOf(player: PlayerState): SimBody {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    speed: player.speed,
    reverseHold: player.reverseHold,
    angVel: player.angVel,
    shoveX: player.shoveX,
    shoveY: player.shoveY,
    authority: player.authority,
    // Reading/writing the four fields here is what makes stepDrive's DASH/HOLD/CHARGE integration
    // and fullStop take hold once something upstream sets them (a weapon or status effect, not yet
    // wired), without this bridge needing to change again. `hasKnock` below also treats a live
    // maneuver as motion that must keep integrating even when the player goes silent.
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
  player.speed = body.speed;
  player.reverseHold = body.reverseHold;
  player.angVel = body.angVel;
  player.shoveX = body.shoveX;
  player.shoveY = body.shoveY;
  player.authority = body.authority;
  player.maneuver = body.maneuver;
  player.maneuverTicksLeft = body.maneuverTicksLeft;
  player.maneuverAngle = body.maneuverAngle;
  player.maneuverSpeed = body.maneuverSpeed;
}
