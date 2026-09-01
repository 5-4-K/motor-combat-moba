import "dotenv/config";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { PLAYGROUND_ROOM_NAME, ROOM_NAME } from "@motor-combat-moba/shared";
import { getDeployMode, getPort, isDevToolsEnabled } from "./mode.js";
import { mountHealth } from "./health.js";
import { mountMonitor } from "./monitor.js";
import { ArenaRoom } from "./rooms/ArenaRoom.js";
import { PlaygroundRoom } from "./rooms/PlaygroundRoom.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mode = getDeployMode();
const port = getPort();
const clientOrigin = process.env.CLIENT_ORIGIN;

const app = express();
if (clientOrigin || mode === "cloud") {
  app.use(cors({ origin: clientOrigin || true }));
}
app.use(express.json());
mountHealth(app);
mountMonitor(app);

if (mode === "lan") {
  app.use(express.static(path.resolve(__dirname, "../../client/dist")));
}

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});
gameServer.define(ROOM_NAME, ArenaRoom);
// Dev only (spec PG3). A release build leaves the name unregistered, so `?dev=playground` gets a
// plain "room not found" rather than a sandbox that can re-balance the process.
if (isDevToolsEnabled()) {
  gameServer.define(PLAYGROUND_ROOM_NAME, PlaygroundRoom);
}

await gameServer.listen(port);
console.log(
  `[server] mode=${mode} port=${port} monitor=/colyseus health=/health` +
    (isDevToolsEnabled() ? ` playground=${PLAYGROUND_ROOM_NAME}` : ""),
);
