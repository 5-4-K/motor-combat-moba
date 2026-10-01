// packages/shared/src/net/tick-input.ts
import { NET_CONFIG } from "../config/net-config.js";
import { ABILITY_SLOT_CEILING } from "../config/weapon-slots.js";
import { msToTicks } from "../config/weapon-ticks.js";

/** What a player's hands are doing on one tick. `stepSim` reads only these. */
export interface InputKeys {
  steer: -1 | 0 | 1;
  throttle: -1 | 0 | 1;
  /** Slot bitmask, bit 0 = the basic attack (VS15); the server masks it to the car's real slots. */
  fireSlots: number;
  /** World bearing from the turret pivot to the crosshair (TR21); read only on a new press (TR23). */
  aimAngle?: number;
}

/** One tick's input, stamped with the tick it is FOR (NR17, NR25). The tick is the sequence number. */
export interface InputFrame extends InputKeys {
  tick: number;
  /** The render tick the client was drawing remotes at when it produced this frame (NR35). */
  viewTick?: number;
}

/** The newest frame plus up to three before it, oldest first (NR24). */
export interface InputPacket {
  inputs: InputFrame[];
}

export const NEUTRAL_KEYS: Readonly<InputKeys> = Object.freeze({ steer: 0, throttle: 0, fireSlots: 0 });
export const MAX_FRAMES_PER_PACKET = 4;

const isAxis = (n: unknown): n is -1 | 0 | 1 => n === -1 || n === 0 || n === 1;
/** Widest legal wire mask: the basic attack (bit 0) plus the structural ability ceiling. */
const MAX_FIRE_MASK = (1 << (ABILITY_SLOT_CEILING + 1)) - 1;
const isMask = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_FIRE_MASK;
const isTick = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

function isInputFrame(v: unknown): v is InputFrame {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    isTick(r.tick) &&
    isAxis(r.steer) &&
    isAxis(r.throttle) &&
    isMask(r.fireSlots) &&
    (r.aimAngle === undefined || (typeof r.aimAngle === "number" && Number.isFinite(r.aimAngle))) &&
    (r.viewTick === undefined || isTick(r.viewTick))
  );
}

function allFrames(inputs: unknown[]): boolean {
  // An index loop, not `every`: `every` skips holes, so a sparse array would pass unchecked.
  for (let i = 0; i < inputs.length; i++) if (!isInputFrame(inputs[i])) return false;
  return true;
}

/** Wire validation. Everything a client sends is untrusted. */
export function isInputPacket(msg: unknown): msg is InputPacket {
  if (msg === null || typeof msg !== "object") return false;
  const inputs = (msg as Record<string, unknown>).inputs;
  return (
    Array.isArray(inputs) &&
    inputs.length >= 1 &&
    inputs.length <= MAX_FRAMES_PER_PACKET &&
    allFrames(inputs)
  );
}

export type OfferResult = "accepted" | "duplicate" | "late" | "early";

export interface TakenInput {
  keys: InputKeys;
  /** The real frame for this tick, when one arrived in time. */
  frame: InputFrame | undefined;
  /** True when this tick ran on a repeated or neutral input (NR22). */
  repeated: boolean;
}

const SLACK_WINDOW = 30;

/**
 * One player's inputs, keyed by the tick they are for (NR22). The server takes exactly one per tick,
 * so no amount of sending moves a car further than one step per tick (F1). A missing tick repeats
 * the last real input — held keys stay held, and because press detection compares against the
 * previous consumed mask, a repeat can never create a fire press — for `repeatTicks`, then goes
 * neutral so a vanished client's car coasts and stays rammable.
 */
export class TickInputBuffer {
  private readonly frames = new Map<number, InputFrame>();
  private last: InputKeys = NEUTRAL_KEYS;
  private lastRealTick = Number.NEGATIVE_INFINITY;
  private readonly slacks: number[] = [];
  /** Highest tick ever accepted or counted late — so a tick feeds the slack window at most once. */
  private highestSeenTick = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly repeatTicks: number,
    private readonly maxLeadTicks: number,
  ) {}

  offer(frame: InputFrame, lastCompletedTick: number): OfferResult {
    const next = lastCompletedTick + 1;
    if (frame.tick < next) {
      // A frame's FIRST copy arriving late is exactly the sample the slack loop needs to see (fix
      // round I3): it is the input that made this tick repeat. Its redundant copies in later packets,
      // and late copies of ticks already accepted, are not samples — the in-order wire means a tick
      // above everything seen so far is a first copy.
      if (frame.tick > this.highestSeenTick) {
        this.highestSeenTick = frame.tick;
        this.recordSlack(frame.tick - next);
      }
      return "late";
    }
    if (frame.tick > next + this.maxLeadTicks) return "early";
    if (this.frames.has(frame.tick)) return "duplicate";
    // Copy only the whitelisted fields: the parsed wire object may carry anything else.
    const copy: InputFrame = { tick: frame.tick, steer: frame.steer, throttle: frame.throttle, fireSlots: frame.fireSlots };
    if (frame.aimAngle !== undefined) copy.aimAngle = frame.aimAngle;
    if (frame.viewTick !== undefined) copy.viewTick = frame.viewTick;
    this.frames.set(frame.tick, copy);
    if (frame.tick > this.highestSeenTick) this.highestSeenTick = frame.tick;
    this.recordSlack(frame.tick - next);
    return "accepted";
  }

  take(tick: number): TakenInput {
    const frame = this.frames.get(tick);
    for (const key of this.frames.keys()) if (key <= tick) this.frames.delete(key);
    if (frame) {
      this.last = frame;
      this.lastRealTick = tick;
      return { keys: frame, frame, repeated: false };
    }
    const keys = tick - this.lastRealTick <= this.repeatTicks ? this.last : NEUTRAL_KEYS;
    return { keys, frame: undefined, repeated: true };
  }

  private recordSlack(ticks: number): void {
    this.slacks.push(ticks);
    if (this.slacks.length > SLACK_WINDOW) this.slacks.shift();
  }

  slackMeanTicks(): number {
    if (this.slacks.length === 0) return 0;
    return this.slacks.reduce((s, v) => s + v, 0) / this.slacks.length;
  }

  slackStdTicks(): number {
    if (this.slacks.length === 0) return 0;
    const m = this.slackMeanTicks();
    return Math.sqrt(this.slacks.reduce((s, v) => s + (v - m) ** 2, 0) / this.slacks.length);
  }
}

export function newTickInputBuffer(): TickInputBuffer {
  return new TickInputBuffer(msToTicks(NET_CONFIG.inputRepeatMs), msToTicks(NET_CONFIG.maxInputLeadMs));
}

/** Time-sync request (NR18): the client's send time in, a `TimePong` out. Additive on every room. */
export const MSG_TIME = "time";
/** Server-initiated RTT probe (NR19): the server sends `{ s }`, the client echoes it back unchanged. */
export const MSG_PING = "ping";

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function isTimeRequest(msg: unknown): msg is { c: number } {
  return msg !== null && typeof msg === "object" && isFiniteNumber((msg as Record<string, unknown>).c);
}

export function isPingEcho(msg: unknown): msg is { s: number } {
  return msg !== null && typeof msg === "object" && isFiniteNumber((msg as Record<string, unknown>).s);
}
