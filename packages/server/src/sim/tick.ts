import {
  ArenaState,
  DRIVE_CONFIG,
  ManeuverKind,
  NET_CONFIG,
  PlayerState,
  RoomPhase,
  WEAPON_SLOT_CONFIG,
  boundsOf,
  carIdOf,
  getArena,
  isOnField,
  otherCarHulls,
  ramDefenceOf,
  speedOf,
  stepSim,
  type ArenaDef,
  type ContextEntry,
  type InputMessage,
  type Modifiers,
  type SimBody,
  type StepContext,
} from "@motor-combat-moba/shared";
import { modifiersFor } from "./status-bridge.js";

/** Every bit at or beyond `maxFireSlots` is stripped before a wire mask ever reaches the sim. */
const SLOT_MASK = (1 << WEAPON_SLOT_CONFIG.maxFireSlots) - 1;

/**
 * What one `serverTick` reports about the tick it just simulated.
 */
export interface TickResult {
  /** Per session id, the validated slot bitmask that player fired with on a simulated input. */
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
   * and a ram only fired on the rare tick where a pair landed inside `RAM_CONFIG.contactPad`
   * WITHOUT overlapping: a ~1.5 unit window against a per-tick step that was 10.5-18 units at the
   * time this bug was found, so 8-20% of contacts. (The 2026-09-06 heavy-car pass has since cut
   * that step to 6.3-8.9 units; the fix and the window it measures are unaffected either way.)
   * Measured in `playtest/ram.ts`, which is what found it.
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
   * or silent car is still a `resolveRam` participant, and its approach term decides whether it is
   * the attacker or the victim.
   */
  approachVelocities: Map<string, { vx: number; vy: number }>;
  /**
   * Per session id, the `aimAngle` of the LAST simulated input this tick whose fire mask carried a
   * new press (spec TR23) — not the last one that happened to carry an aim. A later press in the same
   * batch overwrites an earlier one's entry, including clearing it: if THAT last pressing input
   * carried no `aimAngle`, the session is absent here, and the press then fires where the turret
   * already points (TR12).
   */
  aims: Map<string, number>;
}

/**
 * Advance every player by their queued inputs. `dt` is seconds and must match the room simulation
 * interval (1 / getTickRateHz(TICK_RATE_HZ)).
 *
 * **One player is advanced without any input: one whose client has gone quiet for long enough that
 * it is no longer predicting either.** A ram writes motion onto its victim from outside, and that
 * motion has to resolve whether or not the victim is still sending — otherwise an alt-tabbed or
 * stalled player is an immovable wall carrying a permanent shove. Such a player is coasted on a
 * neutral input, without an ack and without a fire mask, once their queue has been empty for
 * `NET_CONFIG.silentCoastGraceMs` and while `hasMotionToResolve` holds. A player whose queue merely
 * skipped a tick is left exactly as it was, because their client stepped that tick from an input
 * still in flight and the server must not step it twice. `silentTicks` is that per-session run
 * length: room-owned, server-only, and reset by any drained input.
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
 * `WEAPON_SLOT_CONFIG.maxFireSlots` bits before combat ever sees it, so a hand-rolled client
 * cannot fire a slot its car does not have. Masks from several inputs simulated in one tick are
 * OR-ed together. The weapon cooldown in `runCombat`, not this map, is what limits the rate —
 * several fire inputs in one tick still yield at most one shot.
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
  silentTicks: Map<string, number>,
): TickResult {
  const world = tickWorldOf(getArena(state.arenaId));
  const moving = phase === RoomPhase.MATCH;
  // Sorted once per tick. This same array fixes both the order players are stepped in and the order
  // of the hulls built from it, so it is threaded through rather than recomputed.
  const entries = sortedEntries(state);
  const masks = new Map<string, number>();
  const aims = new Map<string, number>();
  const approachVelocities = new Map<string, { vx: number; vy: number }>();

  for (const { sessionId, player } of entries) {
    const queue = queues.get(sessionId);
    // BEFORE any stepping, so this is the pre-collision velocity `contactTick` needs. Unconditional
    // — a player who is not stepped this tick is still a ram participant. See `TickResult`.
    //
    // A COPY, never the live schema object: `player` is mutated by `stepSim`'s write-back a few
    // lines below, so storing a reference would hand contact the POST-collision velocity — the exact
    // bug this cache exists to prevent, reintroduced through aliasing rather than through ordering.
    approachVelocities.set(sessionId, { vx: player.vx, vy: player.vy });

    // Only `carId`, `others` and `selfRamDefence` vary per player; `world` is fixed for the whole tick.
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
            selfRamDefence: ramDefenceOf(carIdOf(player)),
          }
        : null;

    if (!queue || queue.length === 0) {
      // Nothing to drain. A ram knock is motion applied from OUTSIDE this player, so it has to
      // integrate whether or not they are still talking to us: a backgrounded browser tab stops
      // sending entirely (`requestAnimationFrame` throttles hard when hidden), and without this step
      // the victim sits frozen holding a full-strength shove — unrammable, and never decaying
      // either. Found in playtest, where a parked second tab behaved as an immovable wall.
      //
      // But ONE empty tick is not silence, it is jitter, and a client that is still running has
      // already predicted this tick from its own input. Stepping it here is a step the client never
      // took, and the reconciled pose diverges by exactly that step. So the coast waits out
      // `silenceGraceTicks` of UNBROKEN silence first — the point past which the client is not
      // predicting either, and an extra server step is unobservable to it. `hasMotionToResolve`'s
      // doc has the argument in full, including why reading the body instead cannot work.
      const silentFor = (silentTicks.get(sessionId) ?? 0) + 1;
      silentTicks.set(sessionId, silentFor);
      if (ctx !== null && silentFor > silenceGraceTicks(dt) && hasMotionToResolve(player)) {
        // Coasting on a synthetic neutral input is the smallest thing that resolves the knock. The
        // ack is deliberately NOT advanced and no fire mask is reported: this step acknowledges no
        // input and grants no shot, it only lets physics finish what a ram started.
        writeBody(player, stepSim(bodyOf(player), COAST_INPUT, dt, ctx));
      }
      continue;
    }
    // They are talking to us, so the silence run ends here — whether or not anything in the batch
    // is actually simulated below. Draining is the liveness signal; stepping is not.
    silentTicks.set(sessionId, 0);

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
        if (pressed !== 0) {
          masks.set(sessionId, (masks.get(sessionId) ?? 0) | pressed);
          // The LAST pressing input in the batch decides the aim (TR23), not the last one that
          // happened to carry one: a later press with no `aimAngle` must overwrite an earlier
          // press's bearing with "none", not leave it in place.
          if (msg.aimAngle !== undefined) aims.set(sessionId, msg.aimAngle);
          else aims.delete(sessionId);
        }
      }
      player.lastProcessedInputSeq = msg.seq;
    }
  }

  return { masks, aims, approachVelocities };
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
 * How many consecutive empty-queue ticks mean the CLIENT has stopped stepping, not merely that a
 * packet is late.
 *
 * Derived from this room's own `dt` rather than from `TICK_RATE_HZ`, so a room running at a
 * non-default rate (and the 60 Hz the netcode rewrite's phase 1 brings) gets the same wall-clock
 * grace rather than the same tick count. See `NET_CONFIG.silentCoastGraceMs` for why the threshold
 * is a duration at all.
 */
function silenceGraceTicks(dt: number): number {
  return Math.ceil(NET_CONFIG.silentCoastGraceMs / (dt * 1000));
}

/**
 * Is there anything left on this player's body to integrate?
 *
 * A cheap "would a coast step do anything" test, and nothing more — it is the SECOND half of the
 * silent-coast gate, never the whole of it. The first half is elapsed silence, and the two are not
 * interchangeable. Read `silenceGraceTicks`'s doc and `NET_CONFIG.silentCoastGraceMs` before
 * touching either.
 *
 * **Why this is no longer a knock predicate, and why nothing may turn it back into one.** Through
 * the 2026-09-06 car-physics rework this was `hasKnock`, which tried to answer "is this motion
 * externally imposed" from the body alone, and did it in two steps: before the vector-drive rework
 * by reading the dedicated `shoveX`/`shoveY`/`authority` fields, and after it by reading
 * `lateralOf(vx, vy, angle)` against `DRIVE_CONFIG.stopEpsilon` — on the argument that
 * `DRIVE_CONFIG.steeringGrip` was 1.0, "on rails", so a car never drove itself sideways and any
 * lateral component had to have come from outside. **Both premises are gone.** The Unity drive-model
 * port DELETED `steeringGrip`, moving the model to that knob's 0 end: lateral velocity is now the
 * DRIFT every cornering car carries, tens of u/s at full lock (Mirage settles around 26° of slip),
 * against a `stopEpsilon` of 1e-3. And under U16 `angVel` no longer means "residual ram spin" — the
 * ordinary `stepDrive` branch writes the steering rate into it every tick, so `angVel !== 0` now
 * reads "is this player steering". Between them the old predicate fired for essentially every
 * cornering player, on a tick type its own comment called routine at these latencies.
 *
 * **The requirement was never a definition of "knock"; it is lockstep with the client, and the
 * client settles it.** `ArenaScene.sendInputTick` produces exactly one input per sim tick and calls
 * `PredictionBuffer.predict` once for it (`packages/client/src/net/prediction.ts`); there is no
 * coast path in that file at all. **A running client never steps a tick it did not send an input
 * for.** So while the client is running, ANY extra server step is a desync — whatever the body looks
 * like — and once the client has stopped producing inputs, NO extra server step is observable to it.
 * That makes elapsed silence the only sound discriminator, and it is what the gate now reads.
 *
 * That also closes the gap the old predicate documented as accepted and open: a shove landing along
 * the victim's own heading (a dead-on rear-end) was invisible to `lateralOf`, so a disconnected
 * victim froze holding it — measured at 287.4 u/s of a 300 u/s shove, 96% of it, once the port left
 * drag as the only thing removing velocity. Silence does not care which way the push pointed.
 *
 * `maneuver` stays in the test for the same reason it always was: a dash or a hold is state that
 * must be run down, and a car frozen mid-dash keeps the whole of it.
 */
function hasMotionToResolve(player: PlayerState): boolean {
  return (
    speedOf(player.vx, player.vy) > DRIVE_CONFIG.stopEpsilon ||
    player.angVel !== 0 ||
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
    // and fullStop take hold once something upstream sets them (a weapon or status effect, not yet
    // wired), without this bridge needing to change again. `hasMotionToResolve` below also treats a
    // live maneuver as motion that must keep integrating once the player has gone silent.
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
