import "dotenv/config";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@motor-arena/shared";
import { getDeployMode, getPort } from "./mode.js";
import { mountHealth } from "./health.js";
import { mountMonitor } from "./monitor.js";
import { ArenaRoom } from "./rooms/ArenaRoom.js";

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

await gameServer.listen(port);
console.log(`[server] mode=${mode} port=${port} monitor=/colyseus health=/health`);
