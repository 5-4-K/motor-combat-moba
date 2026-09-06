import { describe, expect, it } from "vitest";
import {
  ArenaState,
  DRIVE_CONFIG,
  ManeuverKind,
  MS_PER_TICK,
  NET_CONFIG,
  PlayerState,
  PlayerStatus,
  RoomPhase,
  driveOf,
  forwardOf,
  lateralOf,
  toWorld,
  type InputMessage,
  type Modifiers,
  type SimBody,
} from "@motor-combat-moba/shared";
import { serverTick } from "./tick.js";

/**
 * No buffs or debuffs in play. Every expectation in this file is the unbuffed sim, and a
 * `NEUTRAL_MODIFIERS` lookup is what an empty map yields through `modifiersFor`.
 */
const NO_EFFECTS = new Map<string, Modifiers>();

const DT = MS_PER_TICK / 1000;
const UP: InputMessage = { seq: 1, steer: 0, throttle: 1, fireSlots: 0 };

/** A clear east-west corridor in arena-01: every obstacle sits at y >= 350. */
const CORRIDOR_Y = 100;

function makePlayer(
  sessionId: string,
  x: number,
  y: number,
  angle: number,
  status: PlayerStatus = PlayerStatus.IN_MATCH,
): PlayerState {
  const p = new PlayerState();
  p.sessionId = sessionId;
  p.x = x;
  p.y = y;
  p.angle = angle;
  p.status = status;
  p.carId = "mirage";
  p.lastProcessedInputSeq = 0;
  return p;
}

/** Seed a state, honouring the given insertion order into the `MapSchema`. */
function stateWith(...players: PlayerState[]): ArenaState {
  const state = new ArenaState();
  for (const p of players) state.players.set(p.sessionId, p);
  return state;
}

function poseOf(player: PlayerState): SimBody {
  return {
    x: player.x,
    y: player.y,
    angle: player.angle,
    vx: player.vx,
    vy: player.vy,
    reverseHold: player.reverseHold,
    angVel: player.angVel,
  };
}

function ups(...seqs: number[]): InputMessage[] {
  return seqs.map((seq) => ({ seq, steer: 0, throttle: 1, fireSlots: 0 }));
}

/** Throttle-neutral inputs: the car keeps whatever speed it already had, minus drag. */
function coasts(...seqs: number[]): InputMessage[] {
  return seqs.map((seq) => ({ seq, steer: 0, throttle: 0, fireSlots: 0 }));
}

describe("serverTick", () => {
  it("drives the car forward and empties the queue", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const state = stateWith(player);
    const queues = new Map<string, InputMessage[]>([["p1", [{ ...UP, seq: 7 }]]]);

    serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map());

    expect(player.x).toBeGreaterThan(300);
    expect(player.y).toBe(CORRIDOR_Y);
    expect(forwardOf(player.vx, player.vy, player.angle)).toBeCloseTo(driveOf("mirage").accel * DT, 6);
    expect(player.lastProcessedInputSeq).toBe(7);
    expect(queues.get("p1")).toEqual([]);
  });

  it("carries speed forward between inputs, so N queued inputs accelerate N times", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const state = stateWith(player);
    const queues = new Map<string, InputMessage[]>([["p1", ups(1, 2, 3)]]);

    serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map());

    // Would be a single `accel * DT` if `vx`/`vy` were only written back after the last input.
    expect(forwardOf(player.vx, player.vy, player.angle))
      .toBeCloseTo(3 * driveOf("mirage").accel * DT, 6);
  });

  it("leaves a player with an empty or missing queue unchanged", () => {
    const emptyQ = makePlayer("empty", 1, 2, 0.1);
    emptyQ.lastProcessedInputSeq = 3;
    const missingQ = makePlayer("missing", 4, 5, 0.2);
    missingQ.lastProcessedInputSeq = 4;
    const state = stateWith(emptyQ, missingQ);

    const queues = new Map<string, InputMessage[]>([["empty", []]]);

    serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map());

    expect(poseOf(emptyQ)).toEqual({
      x: 1,
      y: 2,
      angle: 0.1,
      vx: 0,
      vy: 0,
      reverseHold: 0,
      angVel: 0,
    });
    expect(emptyQ.lastProcessedInputSeq).toBe(3);
    expect(poseOf(missingQ)).toEqual({
      x: 4,
      y: 5,
      angle: 0.2,
      vx: 0,
      vy: 0,
      reverseHold: 0,
      angVel: 0,
    });
    expect(missingQ.lastProcessedInputSeq).toBe(4);
  });

  it("sets lastProcessedInputSeq to the last seq applied when multiple messages are queued", () => {
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const state = stateWith(player);
    const queues = new Map<string, InputMessage[]>([
      [
        "p1",
        [
          { seq: 1, steer: 0, throttle: 0, fireSlots: 0 },
          { seq: 2, steer: 1, throttle: 0, fireSlots: 0 },
          { seq: 5, steer: 0, throttle: 1, fireSlots: 0b001 },
        ],
      ],
    ]);

    serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map());

    expect(player.lastProcessedInputSeq).toBe(5);
    expect(queues.get("p1")).toEqual([]);
  });

  it("integrates with the dt it is given", () => {
    const slow = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const fast = makePlayer("p1", 300, CORRIDOR_Y, 0);

    serverTick(stateWith(slow), new Map([["p1", ups(1)]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    serverTick(stateWith(fast), new Map([["p1", ups(1)]]), DT * 2, RoomPhase.MATCH, NO_EFFECTS, new Map());

    expect(forwardOf(fast.vx, fast.vy, fast.angle))
      .toBeCloseTo(forwardOf(slow.vx, slow.vy, slow.angle) * 2, 6);
    expect(fast.x - 300).toBeGreaterThan(slow.x - 300);
  });

  describe("input ordering", () => {
    // Bodies chosen so the order they integrate in genuinely changes the outcome: accelerating and
    // turning before braking does not land where braking first does.
    const BODIES = [
      { steer: 0, throttle: 1 },
      { steer: 1, throttle: 1 },
      { steer: 1, throttle: -1 },
    ] as const;

    const at = (body: number, seq: number): InputMessage => ({ ...BODIES[body]!, seq, fireSlots: 0 });

    function runWith(queue: InputMessage[]): PlayerState {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      serverTick(stateWith(player), new Map([["p1", queue]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
      return player;
    }

    it("applies inputs in seq order regardless of the order they arrived in", () => {
      // Simulated latency gives every packet its own jittered delay, so this is routine, not exotic.
      const inOrder = runWith([at(0, 1), at(1, 2), at(2, 3)]);
      const arrivedShuffled = runWith([at(2, 3), at(0, 1), at(1, 2)]);

      // Precondition: the fixture really is order-sensitive, so the equality below has teeth.
      const seqsReversed = runWith([at(2, 1), at(1, 2), at(0, 3)]);
      expect(poseOf(seqsReversed)).not.toEqual(poseOf(inOrder));

      expect(poseOf(arrivedShuffled)).toEqual(poseOf(inOrder));
      // Acking the last *arrival* would leave this at 2 while seq 3 had already been applied, and
      // Task 4's reconcile would then replay inputs the server has already integrated.
      expect(arrivedShuffled.lastProcessedInputSeq).toBe(3);
    });
  });

  it("applies at most maxInputsPerTick inputs, but still drains and acks the whole burst", () => {
    const cap = NET_CONFIG.maxInputsPerTick;
    const burst = cap * 4;

    const flooder = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const floodQueue = ups(...Array.from({ length: burst }, (_, i) => i + 1));
    serverTick(stateWith(flooder), new Map([["p1", floodQueue]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());

    const honest = makePlayer("p1", 300, CORRIDOR_Y, 0);
    serverTick(
      stateWith(honest),
      new Map([["p1", ups(...Array.from({ length: cap }, (_, i) => i + 1))]]),
      DT,
      RoomPhase.MATCH,
      NO_EFFECTS,
      new Map(),
    );

    // Flooding buys no distance *beyond the cap*: both clients here send `maxInputsPerTick`, so
    // this pins the ceiling rather than comparing a flooder against an honest client.
    expect(poseOf(flooder)).toEqual(poseOf(honest));
    expect(flooder.x).toBeGreaterThan(300);
    // ...but the whole burst is drained and acked, so the queue cannot grow and the client's
    // pending-input buffer still clears.
    expect(floodQueue).toEqual([]);
    expect(flooder.lastProcessedInputSeq).toBe(burst);
  });

  describe("phase gating", () => {
    for (const phase of [RoomPhase.LOBBY, RoomPhase.CAR_SELECT, RoomPhase.COUNTDOWN] as const) {
      it(`drains the queue and advances the seq without moving in phase ${RoomPhase[phase]}`, () => {
        const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
        const state = stateWith(player);
        const queues = new Map<string, InputMessage[]>([["p1", ups(1, 2, 9)]]);

        serverTick(state, queues, DT, phase, NO_EFFECTS, new Map());

        expect(poseOf(player)).toEqual({ x: 300, y: CORRIDOR_Y, angle: 0, vx: 0, vy: 0, reverseHold: 0, angVel: 0 });
        expect(player.lastProcessedInputSeq).toBe(9);
        expect(queues.get("p1")).toEqual([]);
      });
    }
  });

  // A mid-match joiner is READY and a knocked-out player is POST_MATCH. Stepping either would drive
  // an off-field car around the arena that real players cannot see in their own collision checks.
  for (const status of [PlayerStatus.READY, PlayerStatus.POST_MATCH] as const) {
    it(`drains a ${PlayerStatus[status]} player's queue during MATCH without moving them`, () => {
      const offField = makePlayer("p1", 300, CORRIDOR_Y, 0, status);
      const state = stateWith(offField);
      const queues = new Map<string, InputMessage[]>([["p1", ups(1, 2, 9)]]);

      serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map());

      expect(poseOf(offField)).toEqual({ x: 300, y: CORRIDOR_Y, angle: 0, vx: 0, vy: 0, reverseHold: 0, angVel: 0 });
      expect(offField.lastProcessedInputSeq).toBe(9);
      expect(queues.get("p1")).toEqual([]);
    });
  }

  describe("other cars as colliders", () => {
    /**
     * Far enough for the driver to reach the blocker, not far enough to be near a wall. 60, not 40:
     * the 2026-09-06 vector-drive rework's heavy-car pass cut mirage's accel/top speed (420/7.2 base
     * pair -> 60/1.4, 135/3.7 -> 80/2.2), so 40 ticks (1.33 s) no longer covers the 200 u to the
     * blocker at x=500 — mirage needs ~1.5 s just to reach its new 267 u/s top speed. 60 ticks (2 s)
     * clears 500 with room to spare while still resolving well short of the arena wall.
     */
    const TICKS = 60;

    function driveIntoBlocker(blockerStatus: PlayerStatus): PlayerState {
      const driver = makePlayer("a-driver", 300, CORRIDOR_Y, 0);
      const blocker = makePlayer("b-blocker", 500, CORRIDOR_Y, 0, blockerStatus);
      const state = stateWith(driver, blocker);
      for (let i = 0; i < TICKS; i++) {
        serverTick(state, new Map([["a-driver", ups(i + 1)]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
      }
      return driver;
    }

    it("stops a driver short of another player who is in the match", () => {
      const driver = driveIntoBlocker(PlayerStatus.IN_MATCH);
      expect(driver.x).toBeGreaterThan(300);
      // REPINNED for stage 2 Task 2 (mass-weighted separation): a lone `IN_MATCH` blocker with an
      // empty queue and no knock is never itself stepped (`serverTick` drains only queued or
      // knocked players), so its own `resolveWorld` call -- and its own half of the mass split --
      // never runs. Only the driver's side concedes its `shareOf` the overlap each tick, so the
      // pair's damped steady state (throttle re-driving it in, restitution pushing it back out,
      // exactly the wall equilibrium `step.test.ts`'s "single-step path" case documents) settles a
      // fraction of a unit inside the exact boundary rather than pinned flush to it -- traced at
      // ~452.07-452.13 here, oscillating tick to tick, against the exact-separation value of 452.
      // The 1-unit margin matches the slack `combat.test.ts`'s "collision deals no damage" fixture
      // already carries for the identical shape of steady state.
      expect(driver.x + DRIVE_CONFIG.carWidth).toBeLessThanOrEqual(501);
    });

    it("does not treat a player who is not in the match as a solid wall", () => {
      const driver = driveIntoBlocker(PlayerStatus.READY);
      expect(driver.x).toBeGreaterThan(500);
    });
  });

  it("steps players in sorted sessionId order, not MapSchema insertion order", () => {
    // Two overlapping cars: resolution is sequential, so who is stepped first changes both poses.
    function run(insertionOrder: "sorted" | "reversed"): SimBody[] {
      const a = makePlayer("aaa", 400, CORRIDOR_Y, 0);
      const b = makePlayer("bbb", 440, CORRIDOR_Y, 0);
      const state = insertionOrder === "sorted" ? stateWith(a, b) : stateWith(b, a);
      const queues = new Map<string, InputMessage[]>([
        ["aaa", ups(1)],
        ["bbb", ups(1)],
      ]);
      serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
      return [poseOf(a), poseOf(b)];
    }

    expect(run("reversed")).toEqual(run("sorted"));
  });

  it("steps each player against the updated poses of the players stepped before them", () => {
    // "aaa" sorts first, so it is stepped while "bbb" still sits at its start pose. It begins
    // overlapping "bbb" and coasts away hard enough to clear it in one tick. "bbb" is then resolved
    // against that *updated* pose, finds nothing in contact, and is never pushed. Resolving
    // everyone against a single pre-loop snapshot would still see "aaa" back at LEADER_X, overlap
    // "bbb", and shove it clear of the stale pose instead.
    const LEADER_X = 400;
    const FOLLOWER_X = 440; // < LEADER_X + carWidth, so the two start overlapping
    const CLEARING_SPEED = 300; // enough to open a gap in a single tick

    const leader = makePlayer("aaa", LEADER_X, CORRIDOR_Y, Math.PI);
    Object.assign(leader, toWorld(Math.PI, CLEARING_SPEED, 0));
    const follower = makePlayer("bbb", FOLLOWER_X, CORRIDOR_Y, 0);
    const state = stateWith(leader, follower);
    const queues = new Map<string, InputMessage[]>([
      ["aaa", coasts(1)],
      ["bbb", coasts(1)],
    ]);

    serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map());

    // The leader really did drive clear, so the follower's contact genuinely depends on which pose
    // it was tested against.
    expect(FOLLOWER_X - LEADER_X).toBeLessThan(DRIVE_CONFIG.carWidth);
    expect(follower.x - leader.x).toBeGreaterThan(DRIVE_CONFIG.carWidth);
    // Untouched: no drive input, and no contact once the leader's updated pose is used.
    expect(follower.x).toBe(FOLLOWER_X);
  });

  describe("ram knock state round-trip", () => {
    // `ram-bridge.test.ts` proves `ramTick` WRITES a knock onto `PlayerState`. Nothing proves the
    // NEXT `serverTick` actually READS it back: `bodyOf`/`writeBody` are the only bridge between the
    // two, and dropping a field from either (e.g. forgetting `vy` in `writeBody`) would be invisible
    // to every other test in this file, all of which use neutral knock state.
    it("carries angVel/vx/vy through bodyOf -> stepDrive -> writeBody: it moves the pose, and the fields round-trip decayed rather than dropped", () => {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      player.angVel = 2;
      player.vx = 120;
      player.vy = -60;
      const state = stateWith(player);
      // No steer, no throttle: any rotation or translation below comes solely from the knock state,
      // not from ordinary driving.
      const queues = new Map<string, InputMessage[]>([["p1", coasts(1)]]);

      serverTick(state, queues, DT, RoomPhase.MATCH, NO_EFFECTS, new Map());

      // The knock state actually reached stepDrive and moved the car.
      expect(player.angle).not.toBe(0);
      expect(player.x).toBeGreaterThan(300);
      expect(player.y).toBeLessThan(CORRIDOR_Y);

      // Round-tripped through decay, not silently dropped to neutral (angVel/vx/vy all 0) — that is
      // exactly what a missing field in `bodyOf` or `writeBody` would produce.
      expect(player.angVel).toBeGreaterThan(0);
      expect(player.angVel).toBeLessThan(2);
      // `steeringGrip` (1.0) rebuilds vx/vy from the forward/lateral split in the tick's NEW heading
      // every tick (see `stepDrive`), so a one-tick decay of that split does not mean vx itself must
      // fall: with `vy` negative here, angVel's small rotation of the nose folds a sliver of the
      // decaying lateral component onto +x. Under mirage's pre-2026-09-06 fast coast that sliver was
      // smaller than the forward decay it partly offset, so vx net decreased; mirage's much slower
      // `coastHalfLifeSeconds` (0.35 -> 1.2 s in the vector-drive rework's heavy-car pass) decays the
      // forward component far less in one tick, so the rotation now nets vx slightly ABOVE 120. Pinned
      // rather than bounded below 120, so a genuine mechanism regression (steeringGrip or the decay
      // rates) still fails this instead of the bound quietly widening to fit whatever comes out.
      expect(player.vx).toBeCloseTo(120.892, 3);
      expect(player.vy).toBeLessThan(0);
      expect(player.vy).toBeGreaterThan(-60);
    });
  });

  describe("maneuver state keeps a silent player moving", () => {
    // `hasKnock` gates the same silent-coast step that rescues a knocked player who stopped
    // sending input (see the `serverTick coasts a knocked player...` block below). A DASH is the
    // same shape of problem: motion applied from OUTSIDE the player's own inputs, via
    // `maneuverAngle`/`maneuverSpeed` rather than `shoveX`/`shoveY`. Until `hasKnock` also checks
    // `player.maneuver`, a dashing player who goes silent mid-dash freezes holding the whole
    // state instead of finishing the dash the status/ram system already committed them to.
    it("keeps stepping a silent player mid-dash — a dash is motion applied from outside", () => {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      player.maneuver = ManeuverKind.DASH;
      player.maneuverTicksLeft = 8;
      player.maneuverAngle = 0;
      player.maneuverSpeed = 1600;
      const before = player.x;

      serverTick(stateWith(player), new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());

      expect(player.x).toBeGreaterThan(before);
      expect(player.maneuverTicksLeft).toBe(7);
    });
  });

  describe("carId fallback", () => {
    function driveOneTickAs(carId: string): PlayerState {
      const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
      player.carId = carId;
      serverTick(stateWith(player), new Map([["p1", ups(1)]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
      return player;
    }

    it("drives a pre-reveal player (carId \"\") as the default chassis", () => {
      expect(poseOf(driveOneTickAs(""))).toEqual(poseOf(driveOneTickAs("mirage")));
    });

    it("does not mistake an inherited Object property for a car id", () => {
      // `"constructor" in CAR_TABLE` is true via the prototype chain; looking its stats up yields
      // undefined and NaNs the whole drive step.
      const inherited = driveOneTickAs("constructor");
      expect(Number.isFinite(inherited.x)).toBe(true);
      expect(poseOf(inherited)).toEqual(poseOf(driveOneTickAs("mirage")));
    });
  });
});

describe("serverTick fire mask reporting", () => {
  function fires(seq: number, mask: number = 0b001): InputMessage {
    return { seq, steer: 0, throttle: 0, fireSlots: mask };
  }

  function tickWith(
    player: PlayerState,
    queue: InputMessage[],
    phase: RoomPhase = RoomPhase.MATCH,
  ): Map<string, number> {
    return serverTick(stateWith(player), new Map([[player.sessionId, queue]]), DT, phase, NO_EFFECTS, new Map())
      .masks;
  }

  it("reports a HELD trigger as exactly one press, not one per tick", () => {
    // The whole point of edge detection: `fireSlots` is raw key state, so a player holding the
    // trigger sets the same bit on every input. Only the transition counts.
    const prev = new Map<string, number>();
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const tick = (mask: number) =>
      serverTick(stateWith(player), new Map([["p1", [{ seq: 1, steer: 0, throttle: 0, fireSlots: mask }]]]),
        DT, RoomPhase.MATCH, NO_EFFECTS, prev).masks.get("p1");

    expect(tick(0b001)).toBe(0b001); // key goes down: a press
    expect(tick(0b001)).toBeUndefined(); // still held: nothing
    expect(tick(0b001)).toBeUndefined(); // still held: still nothing
    expect(tick(0b000)).toBeUndefined(); // released
    expect(tick(0b001)).toBe(0b001); // pressed again: a second press
  });

  it("sees a release and re-press INSIDE one tick's batch, from an already-held key", () => {
    // `prev` advances per input, not once per tick. Seeded as already-held, the first input is not a
    // press — so the only way a press is reported here is if the release in the middle of the batch
    // was seen. Advancing `prev` once per tick instead would report nothing at all.
    const prev = new Map<string, number>([["p1", 0b001]]);
    const masks = serverTick(
      stateWith(makePlayer("p1", 300, CORRIDOR_Y, 0)),
      new Map([["p1", [fires(1, 0b001), fires(2, 0b000), fires(3, 0b001)]]]),
      DT, RoomPhase.MATCH, NO_EFFECTS, prev,
    ).masks;
    expect(masks.get("p1")).toBe(0b001);
    expect(prev.get("p1")).toBe(0b001); // the batch ended with the key down again
  });

  it("counts a second slot pressed while the first is held", () => {
    // Edge detection is per BIT, not per mask: holding slot 1 must not swallow a slot 2 press.
    const prev = new Map<string, number>();
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const tick = (mask: number) =>
      serverTick(stateWith(player), new Map([["p1", [{ seq: 1, steer: 0, throttle: 0, fireSlots: mask }]]]),
        DT, RoomPhase.MATCH, NO_EFFECTS, prev).masks.get("p1");

    expect(tick(0b001)).toBe(0b001);
    expect(tick(0b011)).toBe(0b010); // slot 1 still held, slot 2 newly down
  });

  it("reports the slot mask from an input it actually simulated", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b001)]);
    expect(masks.get("p1")).toBe(0b001);
  });

  it("masks off bits beyond maxWeaponSlots", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b1111_1111)]);
    expect(masks.get("p1")).toBe(0b111); // maxWeaponSlots = 3
  });

  it("ors the masks of every input simulated this tick", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b001), fires(2, 0b010)]);
    expect(masks.get("p1")).toBe(0b011);
  });

  it("reports nothing for a player outside the match", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, 0b001)], RoomPhase.COUNTDOWN);
    expect(masks.size).toBe(0);
  });

  it("ignores a negative or non-integer mask", () => {
    const masks = tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), [fires(1, -5 as number)]);
    expect(masks.get("p1") ?? 0).toBe(0);
  });

  it("reports nothing when no input carries a fire mask", () => {
    expect(tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), ups(1)).size).toBe(0);
  });

  it("reports nothing when the queue is empty", () => {
    expect(tickWith(makePlayer("p1", 300, CORRIDOR_Y, 0), []).size).toBe(0);
  });

  it("ignores fire from a player who is not on the field", () => {
    const bystander = makePlayer("p1", 300, CORRIDOR_Y, 0, PlayerStatus.READY);
    expect(tickWith(bystander, [fires(1)]).size).toBe(0);
  });

  it("does not credit a shot to an input past the per-tick simulate cap", () => {
    // The first `maxInputsPerTick` inputs are plain drives; only the one past the cap asks to fire,
    // and it is drained and acked but never simulated.
    const player = makePlayer("p1", 300, CORRIDOR_Y, 0);
    const queue: InputMessage[] = [
      ...ups(1, 2, 3, 4, 5).slice(0, NET_CONFIG.maxInputsPerTick),
      fires(NET_CONFIG.maxInputsPerTick + 1),
    ];
    const masks = tickWith(player, queue);
    expect(masks.size).toBe(0);
    expect(player.lastProcessedInputSeq).toBe(NET_CONFIG.maxInputsPerTick + 1);
  });

  it("names every player who fired, not just the first", () => {
    const a = makePlayer("aaa", 300, CORRIDOR_Y, 0);
    const b = makePlayer("bbb", 900, CORRIDOR_Y, 0);
    const { masks } = serverTick(
      stateWith(a, b),
      new Map([
        ["aaa", [fires(1)]],
        ["bbb", [fires(1)]],
      ]),
      DT,
      RoomPhase.MATCH,
      NO_EFFECTS,
      new Map(),
    );
    expect([...masks.keys()].sort()).toEqual(["aaa", "bbb"]);
  });
});

/**
 * A knock is motion applied from OUTSIDE the victim. It has to integrate whether or not that victim
 * is still sending inputs — otherwise an alt-tabbed, AFK, or briefly-stalled player is an immovable
 * wall that no amount of ramming can shift, and the knock written onto them never decays either.
 *
 * Found in playtest: a second browser tab in the background stops sending (rAF throttles hard when
 * hidden), so the victim was skipped entirely and sat frozen with a full-strength shove on it.
 */
describe("serverTick coasts a knocked player who has stopped sending input", () => {
  /**
   * `angVel` is always given a nonzero starting value alongside the shove. `hasKnock` gates the
   * coast on `lateralOf(vx, vy, angle)` rather than raw `vx`/`vy` (see `hasKnock`'s own comment in
   * `tick.ts`), and this fixture's shove (`vx = 300` at `angle = 0`) is aligned with the car's own
   * heading — exactly the "dead-on rear-end" case `lateralOf` cannot see, by design (a car's own
   * steering grip means only a LATERAL component is unambiguously external). The `angVel` companion
   * is not decorative here: it is what keeps `hasKnock` true for this fixture at all. A real ram's
   * `spinOf` is a continuous function of contact geometry that is essentially never exactly 0, so
   * pairing a shove with spin reflects production reality — but it also means this fixture alone does
   * not exercise `lateralOf`'s own detection path, which no test here isolates directly.
   */
  function knocked(over: Partial<PlayerState> = {}): PlayerState {
    const p = makePlayer("v", 500, 400, 0);
    p.vx = 300;
    p.angVel = 2;
    Object.assign(p, over);
    return p;
  }

  it("moves a knocked player whose queue is empty", () => {
    const player = knocked();
    const state = stateWith(player);
    serverTick(state, new Map([["v", []]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(player.x).toBeGreaterThan(500);
  });

  it("moves a knocked player who is absent from the queue map entirely", () => {
    const player = knocked();
    const state = stateWith(player);
    serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(player.x).toBeGreaterThan(500);
  });

  it("decays the knock rather than freezing it at full strength", () => {
    const player = knocked();
    const state = stateWith(player);
    serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(player.vx).toBeLessThan(300);
    expect(player.vx).toBeGreaterThan(0);
  });

  it("carries every knock component, not just shove", () => {
    const player = knocked({ vx: 0, vy: 0, angVel: 3 });
    const state = stateWith(player);
    serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(player.angVel).toBeLessThan(3);
    expect(player.angVel).toBeGreaterThan(0);
    expect(player.angle).not.toBe(0);
  });

  it("settles angVel to exact neutral, then freezes the residual forward-aligned velocity", () => {
    // This fixture's shove (`vx = 300` at `angle = 0`) is aligned with the car's own heading, so
    // `lateralOf` reads exactly 0 for it from the very first tick (`DRIVE_CONFIG.steeringGrip` is
    // 1.0, so the rebuilt velocity always re-decomposes with zero lateral component too) — only the
    // paired `angVel` keeps `hasKnock` true at all, and it rotates the heading out from under the
    // velocity as it spins down. Once `angVel` snaps to exactly 0 (its own epsilon), `hasKnock` goes
    // false and the coast stops for good — this is `hasKnock`'s documented, accepted gap (a knock
    // landing purely along the victim's own heading is invisible to `lateralOf`), not a bug: it
    // reduces to the pre-rework `speed` behaviour of freezing rather than decaying to true rest.
    // What must still hold is that it settles ONCE and stays settled, rather than oscillating or
    // running forever — that is the "stops moving the car" half of this test's name.
    const player = knocked({ angVel: 3 });
    const state = stateWith(player);
    for (let i = 0; i < 300; i++) serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(player.angVel).toBe(0);
    // Residual velocity is real (the known gap), not exact rest — but it is small relative to the
    // original 300 u/s shove, because plenty of ticks of coasting ran before angVel expired. "Small"
    // moved from <10 to <20 (pinned at ~19.72) in the vector-drive rework's heavy-car pass: mirage's
    // `coastHalfLifeSeconds` went 0.35 -> 1.2 s, so the SAME number of ticks (angVel's decay is
    // unrelated to coasting) now bleeds off much less of the forward component before it expires.
    //
    // REPINNED for stage 2 Task 1 (2026-09-06): this fixture's spin (`angVel: 3`) drags the heading
    // through more than a quarter turn while `vx/vy` stays fixed in world space (steeringGrip snaps
    // driven velocity onto the CURRENT heading each tick, but this car has no throttle, so nothing
    // re-aligns it), so it genuinely curves and, around tick 80, clips the arena's bottom wall — a
    // real contact this test's comment never previously named, because the OLD physics (restitution
    // 0.35, reflected direction discarded and rebuilt along the unchanged heading) happened to land
    // on the same ~19.72 this test had already pinned, masking that a bounce was even in the
    // trajectory. Whole-vector reflection at the lower 0.15 restitution (Task 1) genuinely damps that
    // one contact differently, so the number this test pins moved along with it — not a second
    // bounce, not a new code path, the same single wall contact under the new rule. Still comfortably
    // under 7% of the original 300 u/s, so "small" still holds.
    const residualSpeed = Math.hypot(player.vx, player.vy);
    expect(residualSpeed).toBeGreaterThan(0);
    expect(residualSpeed).toBeCloseTo(8.376, 2);
    const restingX = player.x;
    const restingVx = player.vx;
    const restingVy = player.vy;
    serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    // Frozen, not merely slow: one more silent tick moves nothing, because `hasKnock` is now false.
    expect(player.x).toBe(restingX);
    expect(player.vx).toBe(restingVx);
    expect(player.vy).toBe(restingVy);
  });

  it("leaves a truly resting, unknocked player exactly where it is", () => {
    // Zero velocity, zero spin, no maneuver: `hasKnock` is false and the player is never stepped at
    // all while silent.
    const player = makePlayer("v", 500, 400, 0);
    const state = stateWith(player);
    serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(player.x).toBe(500);
    expect(player.vx).toBe(0);
  });

  it(
    "leaves a merely-driving (unrammed) silent player frozen, exactly as before this rework",
    () => {
      // This is the property client prediction depends on. `hasKnock` reads `lateralOf`, not raw
      // `vx`/`vy`: a car's own steering grip aligns its motion with its nose (see `SimBody`'s doc),
      // so a car driving straight ahead has zero lateral component and is by definition NOT
      // externally imposed motion. On an empty-queue tick both the server (this function) and the
      // client's `PredictionBuffer` must take exactly zero extra steps, or the reconciled pose
      // diverges from what the client already predicted purely from ordinary packet jitter — see
      // `hasKnock`'s own comment in `tick.ts`.
      const player = makePlayer("v", 500, 400, 0);
      player.vx = 200;
      const state = stateWith(player);
      serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
      expect(player.x).toBe(500);
      expect(player.vx).toBe(200);
    },
  );

  it(
    "leaves a merely-driving, recently-turned silent player frozen despite sin/cos residue in lateralOf",
    () => {
      // Regression for the Critical finding on `hasKnock`: `stepDrive` rebuilds vx/vy at the car's
      // NEW heading every tick (`DRIVE_CONFIG.steeringGrip` is 1.0 — "on rails"). That round-trip
      // through `Math.sin`/`Math.cos` does not return a bit-exact zero lateral component for a car
      // that has turned, even though nothing ever shoved it. A car that steers, then drives straight,
      // is left carrying a stable, nonzero `lateralOf` residue on the order of 1e-14 — far below any
      // real knock, but enough to make the OLD `!== 0` comparison call this ordinary driving an
      // externally-imposed knock forever, coasting a silent player's queue that client prediction
      // never runs. `hasKnock` must compare against `DRIVE_CONFIG.stopEpsilon`, not exact zero.
      const player = makePlayer("v", 300, CORRIDOR_Y, 0);
      const state = stateWith(player);
      let seq = 1;
      const turning = (steer: number): InputMessage[] => [
        { seq: seq++, steer, throttle: 1, fireSlots: 0 },
      ];
      // Turning circle at cruise speed is ~32.6u for this chassis (mirage, as of the 2026-09-06
      // heavy-car pass) — well clear of arena-01's walls and its obstacles (all at y >= 350) from
      // this corridor spot, so nothing here ever collides.
      for (let i = 0; i < 200; i++) {
        serverTick(state, new Map([["v", turning(1)]]), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
      }

      const residue = lateralOf(player.vx, player.vy, player.angle);
      // The whole point: nonzero, but nowhere near a real knock.
      expect(residue).not.toBe(0);
      expect(Math.abs(residue)).toBeLessThan(DRIVE_CONFIG.stopEpsilon);

      const restingX = player.x;
      const restingY = player.y;
      const restingVx = player.vx;
      const restingVy = player.vy;
      serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
      expect(player.x).toBe(restingX);
      expect(player.y).toBe(restingY);
      expect(player.vx).toBe(restingVx);
      expect(player.vy).toBe(restingVy);
    },
  );

  it("does not advance the input ack — a coast step acknowledges nothing", () => {
    const player = knocked({ lastProcessedInputSeq: 7 });
    const state = stateWith(player);
    serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(player.lastProcessedInputSeq).toBe(7);
  });

  it("reports no fire mask for a coast step", () => {
    const state = stateWith(knocked());
    expect(serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map()).masks.size).toBe(0);
  });

  it("does not coast outside MATCH", () => {
    const player = knocked();
    const state = stateWith(player);
    serverTick(state, new Map(), DT, RoomPhase.COUNTDOWN, NO_EFFECTS, new Map());
    expect(player.x).toBe(500);
  });

  it("does not coast a player who is not on the field", () => {
    const player = knocked({ status: PlayerStatus.POST_MATCH });
    const state = stateWith(player);
    serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(player.x).toBe(500);
  });

  it("still resolves the coasting car against other cars", () => {
    // Shoved straight into a stationary neighbour: it must be pushed clear, not driven through.
    const victim = knocked({ vx: 600 });
    const wall = makePlayer("w", 560, 400, 0);
    const state = stateWith(victim, wall);
    for (let i = 0; i < 5; i++) serverTick(state, new Map(), DT, RoomPhase.MATCH, NO_EFFECTS, new Map());
    expect(victim.x).toBeLessThan(560 - 40);
  });
});
