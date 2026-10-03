import { PlayerStatus } from "@motor-combat-moba/shared";
import { carInView, type Roster, type ViewTagged } from "../net/in-view.js";
import type { FxCarView } from "./events.js";

/** What `fxCarViews` reads off one roster row (a `PlayerState`, or a plain object in a test). */
export interface FxCarSource extends ViewTagged {
  readonly status: number;
  readonly hp: number;
  readonly alive: boolean;
  readonly carId: string;
  readonly vx: number;
  readonly vy: number;
}

/**
 * The cars half of the fx world (`FxWorldView.cars`), copied out of the roster (VFX11): every car on
 * the field that is IN VIEW (NR48), at the pose `poseOf` says it is drawn at.
 *
 * A car not in view is left out entirely, not copied with its `undefined` pose and hp. `deriveFxEvents`
 * skips a car present in only one of two consecutive views, so a car turning hidden, dying while
 * hidden, or coming back with less hp than it left with spawns no `died` and no `damaged`: the fx
 * layer only ever sees what this client can see. (The kill feed is not fx; a death is public.)
 */
export function fxCarViews<P extends FxCarSource>(
  players: Roster<P>,
  drivenSid: string,
  poseOf: (player: P, sessionId: string) => { x: number; y: number; angle: number },
): FxCarView[] {
  const cars: FxCarView[] = [];
  players.forEach((player, sessionId) => {
    if (player.status !== PlayerStatus.IN_MATCH) return;
    if (!carInView(sessionId, player, drivenSid)) return;
    const pose = poseOf(player, sessionId);
    cars.push({
      sessionId,
      x: pose.x,
      y: pose.y,
      angle: pose.angle,
      hp: player.hp,
      alive: player.alive,
      carId: player.carId,
      // Velocity stays AUTHORITATIVE — it is not a position, `speedOf` wants the server's answer,
      // and a render pose carries no velocity of its own to take it from.
      vx: player.vx,
      vy: player.vy,
    });
  });
  return cars;
}
