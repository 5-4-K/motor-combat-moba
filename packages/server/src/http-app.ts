import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { DeployMode } from "@motor-combat-moba/shared";
import { mountHealth } from "./health.js";
import { mountMonitor } from "./monitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Largest WebSocket frame a client may send (NR54): 4 KiB. An input packet is ~200 bytes. */
export const MAX_WS_PAYLOAD_BYTES = 4096;

export interface HttpEnv {
  mode: DeployMode;
  /** `CLIENT_ORIGIN`: the one origin a browser client is served from, when it is not this server. */
  clientOrigin: string | undefined;
  devTools: boolean;
  monitorPassword: string | undefined;
}

type CorsController = { getCorsHeaders(headers: Headers): Record<string, string> };

/**
 * D5 ruling B. Colyseus core 0.18 answers every HTTP request — the matchmaker's `/matchmake/*`
 * included — ahead of Express, with the request's own Origin reflected into
 * `Access-Control-Allow-Origin` beside `Allow-Credentials: true`, so any page could drive the
 * matchmaker from a player's browser. With `CLIENT_ORIGIN` set, that reflection is replaced by the one
 * allowed origin, which a browser on any other origin refuses to read. Unset (the LAN release, where
 * the client is served from this same origin, or a dev run without the variable) today's behaviour
 * stands. `/colyseus` keeps its own same-site guard (`monitor.ts`) either way.
 */
export function restrictMatchmakerCors(
  clientOrigin: string | undefined,
  controller: CorsController = matchMaker.controller,
): void {
  if (!clientOrigin) return;
  controller.getCorsHeaders = () => ({ "Access-Control-Allow-Origin": clientOrigin, Vary: "Origin" });
}

/** The Express half: CORS for the non-matchmaker routes, JSON, `/health`, the monitor, the LAN client. */
export function createHttpApp(env: HttpEnv): Express {
  const app = express();
  if (env.clientOrigin || env.mode === "cloud") {
    app.use(cors({ origin: env.clientOrigin || true }));
  }
  app.use(express.json());
  mountHealth(app);
  mountMonitor(app, { devTools: env.devTools, password: env.monitorPassword });
  if (env.mode === "lan") {
    app.use(express.static(path.resolve(__dirname, "../../client/dist")));
  }
  return app;
}

/** The HTTP server and the Colyseus server on it, rooms not yet defined and not yet listening. */
export function createGameServer(env: HttpEnv): { httpServer: HttpServer; gameServer: Server } {
  restrictMatchmakerCors(env.clientOrigin);
  const httpServer = createServer(createHttpApp(env));
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer, maxPayload: MAX_WS_PAYLOAD_BYTES }),
  });
  return { httpServer, gameServer };
}
