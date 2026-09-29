import { createHash, timingSafeEqual } from "node:crypto";
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
  // Digests are fixed length, so the comparison does not leak the secret's length.
  const digest = (v: string): Buffer => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Colyseus core 0.18 answers every HTTP request ahead of Express with the caller's Origin echoed
 * into `Access-Control-Allow-Origin` plus `Allow-Credentials: true`, so any page the operator visits
 * could read the monitor with cached credentials, and its GET endpoints act on rooms. Refuse
 * cross-site requests outright and strip the reflected CORS headers from the rest.
 */
function sameSiteOnly(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  let foreign = req.headers["sec-fetch-site"] === "cross-site";
  if (!foreign && origin !== undefined) {
    try {
      foreign = new URL(origin).host !== req.headers.host;
    } catch {
      foreign = true;
    }
  }
  if (foreign) {
    res.status(403).end();
    return;
  }
  res.removeHeader("Access-Control-Allow-Origin");
  res.removeHeader("Access-Control-Allow-Credentials");
  next();
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
  if (gate === "password") app.use("/colyseus", sameSiteOnly, basicAuth(env.password as string), monitor());
  else app.use("/colyseus", sameSiteOnly, monitor());
}
