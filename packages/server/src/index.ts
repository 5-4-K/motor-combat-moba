import { nodeMajorOk } from "./node-version.js";

// Clear message on old Node. ES imports are hoisted, so this runs after the imports below have
// evaluated; that is fine, it exists to say what is wrong rather than to prevent loading.
if (!nodeMajorOk(process.versions.node)) {
  console.error(
    `Motor Combat needs Node.js 22 or newer; this is ${process.versions.node}. Install it from https://nodejs.org`,
  );
  process.exit(1);
}

import "dotenv/config";
import { PLAYGROUND_ROOM_NAME, PRACTICE_ROOM_NAME, ROOM_NAME } from "@motor-combat-moba/shared";
import { getDeployMode, getPort, isDevToolsEnabled } from "./mode.js";
import { createGameServer } from "./http-app.js";
import { monitorGate } from "./monitor.js";
import { ArenaRoom } from "./rooms/ArenaRoom.js";
import { PlaygroundRoom } from "./rooms/PlaygroundRoom.js";
import { PracticeRoom } from "./rooms/PracticeRoom.js";

const mode = getDeployMode();
const port = getPort();

const { gameServer } = createGameServer({
  mode,
  clientOrigin: process.env.CLIENT_ORIGIN,
  devTools: isDevToolsEnabled(),
  monitorPassword: process.env.MONITOR_PASSWORD,
});
gameServer.define(ROOM_NAME, ArenaRoom);
// Ships (spec PR3). Practice is a player-facing feature, so unlike the playground below it carries
// no gate: a release build registers it on every process.
gameServer.define(PRACTICE_ROOM_NAME, PracticeRoom);
// Dev only (spec PG3). A release build leaves the name unregistered, so `?dev=playground` gets a
// plain "room not found" rather than a sandbox that can re-balance the process.
if (isDevToolsEnabled()) {
  gameServer.define(PLAYGROUND_ROOM_NAME, PlaygroundRoom);
}

await gameServer.listen(port);
console.log(
  `[server] mode=${mode} port=${port} monitor=${monitorGate({ devTools: isDevToolsEnabled(), password: process.env.MONITOR_PASSWORD })} health=/health` +
    (isDevToolsEnabled() ? ` playground=${PLAYGROUND_ROOM_NAME}` : ""),
);
