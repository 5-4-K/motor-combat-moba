import { describe, expect, it } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { monitorGate, mountMonitor } from "./monitor.js";

async function statusOf(env: { devTools: boolean; password: string | undefined }, auth?: string): Promise<number> {
  const app = express();
  mountMonitor(app, env);
  const server = createServer(app).listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/colyseus/`, {
      headers: auth ? { authorization: `Basic ${Buffer.from(auth).toString("base64")}` } : {},
    });
    return res.status;
  } finally {
    server.close();
  }
}

describe("monitorGate (NR53)", () => {
  it("is open with dev tools, password-gated with a password, off otherwise", () => {
    expect(monitorGate({ devTools: true, password: undefined })).toBe("open");
    expect(monitorGate({ devTools: false, password: "s3cret" })).toBe("password");
    expect(monitorGate({ devTools: false, password: undefined })).toBe("off");
    expect(monitorGate({ devTools: false, password: "" })).toBe("off");
  });

  it("serves 404 when off", async () => {
    expect(await statusOf({ devTools: false, password: undefined })).toBe(404);
  });

  it("asks for credentials when password-gated and accepts the right ones", async () => {
    expect(await statusOf({ devTools: false, password: "s3cret" })).toBe(401);
    expect(await statusOf({ devTools: false, password: "s3cret" }, "admin:wrong")).toBe(401);
    expect(await statusOf({ devTools: false, password: "s3cret" }, "admin:s3cret")).not.toBe(401);
  });
});
