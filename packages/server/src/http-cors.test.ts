import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { Room, matchMaker } from "@colyseus/core";
import { createGameServer, restrictMatchmakerCors } from "./http-app.js";

/**
 * D5 ruling B, end to end: a real Colyseus server on a real port, asked the way a browser asks — a
 * CORS preflight and a matchmake POST, each carrying a foreign page's Origin.
 */
class EmptyRoom extends Room {}

const GOOD = "http://game.example";
const EVIL = "http://evil.example";

describe("restrictMatchmakerCors", () => {
  it("replaces the reflected origin with CLIENT_ORIGIN, and leaves the controller alone when unset", () => {
    const reflect = (h: Headers) => ({ "Access-Control-Allow-Origin": h.get("origin") ?? "*" });
    const unset = { getCorsHeaders: reflect };
    restrictMatchmakerCors(undefined, unset);
    expect(unset.getCorsHeaders).toBe(reflect);
    const set = { getCorsHeaders: reflect };
    restrictMatchmakerCors(GOOD, set);
    expect(set.getCorsHeaders(new Headers({ origin: EVIL }))["Access-Control-Allow-Origin"]).toBe(GOOD);
  });
});

describe("matchmaker CORS on a live server", () => {
  const original = matchMaker.controller.getCorsHeaders;
  let base = "";
  let shutdown: () => Promise<void> = async () => {};
  /** Which CLIENT_ORIGIN the controller currently runs with; the server is shared by both cases. */
  const configure = (clientOrigin: string | undefined): void => {
    matchMaker.controller.getCorsHeaders = original;
    restrictMatchmakerCors(clientOrigin);
  };

  beforeAll(async () => {
    const { httpServer, gameServer } = createGameServer({
      mode: "lan",
      clientOrigin: undefined,
      devTools: false,
      monitorPassword: undefined,
    });
    gameServer.define("cors_probe", EmptyRoom);
    await gameServer.listen(0);
    base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    shutdown = () => gameServer.gracefullyShutdown(false);
  });

  afterAll(async () => {
    matchMaker.controller.getCorsHeaders = original;
    await shutdown();
  });

  const preflight = (origin: string) =>
    fetch(`${base}/matchmake/joinOrCreate/cors_probe`, {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "POST" },
    });
  const matchmake = (origin: string) =>
    fetch(`${base}/matchmake/joinOrCreate/cors_probe`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    });

  it("CLIENT_ORIGIN unset (LAN release): today's behaviour — any origin is reflected", async () => {
    configure(undefined);
    expect((await preflight(EVIL)).headers.get("access-control-allow-origin")).toBe(EVIL);
    expect((await matchmake(EVIL)).headers.get("access-control-allow-origin")).toBe(EVIL);
  });

  it("CLIENT_ORIGIN set: only that origin is ever allowed, whoever asks", async () => {
    configure(GOOD);
    expect((await preflight(EVIL)).headers.get("access-control-allow-origin")).toBe(GOOD);
    const res = await matchmake(EVIL);
    expect(res.headers.get("access-control-allow-origin")).toBe(GOOD);
    expect((await preflight(GOOD)).headers.get("access-control-allow-origin")).toBe(GOOD);
    // Same rule on the Express routes behind it.
    expect((await fetch(`${base}/health`, { headers: { origin: EVIL } })).headers.get("access-control-allow-origin")).toBe(GOOD);
  });
});
