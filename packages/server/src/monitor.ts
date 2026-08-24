import { monitor } from "@colyseus/monitor";
import type { Express } from "express";

export function mountMonitor(app: Express): void {
  app.use("/colyseus", monitor());
}
