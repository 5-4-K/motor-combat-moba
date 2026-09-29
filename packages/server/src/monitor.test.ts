import { describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import { monitorGate, mountMonitor } from "./monitor.js";

type Env = { devTools: boolean; password: string | undefined };

async function request(
  env: Env,
  headers: Record<string, string> = {},
  opts: { auth?: string; before?: RequestHandler; sameOrigin?: boolean } = {},
): Promise<Response> {
  const app = express();
  if (opts.before) app.use(opts.before);
  mountMonitor(app, env);
  const server = createServer(app).listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    return await fetch(`http://127.0.0.1:${port}/colyseus/`, {
      headers: {
        ...(opts.auth ? { authorization: `Basic ${Buffer.from(opts.auth).toString("base64")}` } : {}),
        ...(opts.sameOrigin ? { origin: `http://127.0.0.1:${port}` } : {}),
        ...headers,
      },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const statusOf = async (env: Env, auth?: string): Promise<number> => (await request(env, {}, { auth })).status;

const PW: Env = { devTools: false, password: "s3cret" };
const OPEN: Env = { devTools: true, password: undefined };

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
    expect(await statusOf(PW)).toBe(401);
    expect(await statusOf(PW, "admin:wrong")).toBe(401);
    expect(await statusOf(PW, "admin:s3cret")).not.toBe(401);
  });

  it("does not ask for credentials in open mode", async () => {
    expect(await statusOf(OPEN)).not.toBe(401);
  });

  it("rejects malformed authorization headers", async () => {
    const noColon = await request(PW, { authorization: `Basic ${Buffer.from("nocolon").toString("base64")}` });
    expect(noColon.status).toBe(401);
    const bearer = await request(PW, { authorization: "Bearer x" });
    expect(bearer.status).toBe(401);
  });

  it("accepts a password that contains colons", async () => {
    const env = { devTools: false, password: "a:b:c" };
    expect(await statusOf(env, "admin:a:b:c")).not.toBe(401);
  });
});

describe("monitor cross-site refusal (core 0.18 reflects any Origin with credentials)", () => {
  it("403s a cross-site Origin with correct credentials, in both gates", async () => {
    const evil = { origin: "https://evil.example" };
    expect((await request(PW, evil, { auth: "admin:s3cret" })).status).toBe(403);
    expect((await request(OPEN, evil)).status).toBe(403);
  });

  it("403s Sec-Fetch-Site: cross-site", async () => {
    const h = { "sec-fetch-site": "cross-site" };
    expect((await request(PW, h, { auth: "admin:s3cret" })).status).toBe(403);
    expect((await request(OPEN, h)).status).toBe(403);
  });

  it("lets a same-origin request through", async () => {
    const res = await request(PW, { "sec-fetch-site": "same-origin" }, { auth: "admin:s3cret", sameOrigin: true });
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it("strips reflected CORS headers set by an earlier layer", async () => {
    const reflect: RequestHandler = (req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "https://evil.example");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      next();
    };
    const res = await request(OPEN, {}, { before: reflect });
    expect(res.status).not.toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
