import { timingSafeEqual } from "node:crypto";
import { monitor } from "@colyseus/monitor";
import type { Express, NextFunction, Request, Response } from "express";

/**
 * Who may open `/colyseus` (spec NR53). The monitor shows every room's full state and can dispose
 * rooms, so on a public server it is either behind a password or not mounted at all.
 */
export function monitorGate(env: { devTools: boolean; password: string | undefined }): "open" | "password" | "off" {
  if (env.devTools) return "open";
  if (env.password) return "password";
  return "off";
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function basicAuth(password: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? "";
    const decoded = header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64").toString() : "";
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (decoded.includes(":") && sameSecret(supplied, password)) return next();
    res.setHeader("WWW-Authenticate", 'Basic realm="colyseus-monitor"');
    res.status(401).end();
  };
}

export function mountMonitor(app: Express, env: { devTools: boolean; password: string | undefined }): void {
  const gate = monitorGate(env);
  if (gate === "off") return;
  if (gate === "password") app.use("/colyseus", basicAuth(env.password as string), monitor());
  else app.use("/colyseus", monitor());
}
