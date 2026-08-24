import type { Express } from "express";

export function mountHealth(app: Express): void {
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
}
