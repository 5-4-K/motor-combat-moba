import { describe, expect, it } from "vitest";
import { WsRtt, pingSocketOf, type PingSocket } from "./ws-rtt.js";

/** A `ws` socket double: records pings, and lets the test deliver pongs by hand. */
class FakeSocket implements PingSocket {
  readonly pings: Buffer[] = [];
  private listeners: Array<(data: Buffer) => void> = [];
  ping(data?: unknown): void {
    this.pings.push(data as Buffer);
  }
  on(_e: "pong", l: (data: Buffer) => void): this {
    this.listeners.push(l);
    return this;
  }
  off(_e: "pong", l: (data: Buffer) => void): this {
    this.listeners = this.listeners.filter((x) => x !== l);
    return this;
  }
  pong(data: Buffer): void {
    for (const l of this.listeners) l(data);
  }
  get listenerCount(): number {
    return this.listeners.length;
  }
}

function rig() {
  let now = 1000;
  const ws = new WsRtt(() => now);
  const socket = new FakeSocket();
  ws.attach("a", socket);
  return { ws, socket, at: (t: number) => (now = t) };
}

describe("WsRtt (NR36 fix round 1: the transport ping bounds the compensation RTT)", () => {
  it("times a pong carrying a probe's own payload", () => {
    const { ws, socket, at } = rig();
    ws.probe("a");
    at(1030);
    socket.pong(socket.pings[0]!);
    expect(ws.rttMs("a")).toBe(30);
  });

  it("ignores the transport heartbeat's empty pongs, invented payloads and a repeated pong", () => {
    const { ws, socket, at } = rig();
    ws.probe("a");
    at(1020);
    socket.pong(Buffer.alloc(0));
    socket.pong(Buffer.from("999"));
    socket.pong(Buffer.from("x"));
    expect(ws.rttMs("a")).toBeUndefined();
    socket.pong(socket.pings[0]!);
    at(5000);
    socket.pong(socket.pings[0]!); // answered once already
    expect(ws.rttMs("a")).toBe(20);
  });

  it("is the median of recent pongs", () => {
    const { ws, socket, at } = rig();
    for (const [i, rtt] of [10, 50, 12].entries()) {
      at(1000 * (i + 2));
      ws.probe("a");
      at(1000 * (i + 2) + rtt);
      socket.pong(socket.pings[i]!);
    }
    expect(ws.rttMs("a")).toBe(12);
  });

  it("stamps a probe at the call, before the injected outgoing delay, as the app ping is stamped", () => {
    const { ws, socket, at } = rig();
    let later: (() => void) | undefined;
    ws.probe("a", (fn) => (later = fn));
    expect(socket.pings).toHaveLength(0);
    at(1040); // the simulated outgoing leg: 40 ms
    later!();
    at(1080); // the pong back: 40 ms more
    socket.pong(socket.pings[0]!);
    // The full injected round trip, matching the app RTT the same link would read (80), not 40.
    expect(ws.rttMs("a")).toBe(80);
  });

  it("drop detaches the listener and forgets the session", () => {
    const { ws, socket } = rig();
    ws.drop("a");
    expect(socket.listenerCount).toBe(0);
    expect(ws.attached("a")).toBe(false);
    ws.probe("a");
    expect(socket.pings).toHaveLength(0);
  });

  it("finds the ws socket on a Colyseus WebSocketClient's ref, and nothing on a test double", () => {
    const socket = new FakeSocket();
    expect(pingSocketOf({ sessionId: "a", ref: socket })).toBe(socket);
    expect(pingSocketOf({ sessionId: "a" })).toBeUndefined();
    expect(pingSocketOf({ ref: { ping: 1 } })).toBeUndefined();
  });
});
