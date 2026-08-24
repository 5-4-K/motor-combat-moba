import { describe, expect, it } from "vitest";
import { detectServerEndpoint, isDebugEnabled } from "./client-mode.js";

describe("isDebugEnabled", () => {
  it("is on only for an explicit debug=1", () => {
    expect(isDebugEnabled("?debug=1")).toBe(true);
    expect(isDebugEnabled("?name=x&debug=1")).toBe(true);
  });

  it("is off by default and for any other value", () => {
    expect(isDebugEnabled("")).toBe(false);
    expect(isDebugEnabled("?debug")).toBe(false);
    expect(isDebugEnabled("?debug=0")).toBe(false);
    expect(isDebugEnabled("?debug=true")).toBe(false);
  });
});

describe("detectServerEndpoint", () => {
  it("maps Vite port 5173 to local Colyseus", () => {
    expect(
      detectServerEndpoint({ protocol: "http:", hostname: "localhost", port: "5173" }),
    ).toBe("ws://localhost:2567");
  });

  it("maps http hostname and port 2567 to ws", () => {
    expect(
      detectServerEndpoint({ protocol: "http:", hostname: "192.168.1.5", port: "2567" }),
    ).toBe("ws://192.168.1.5:2567");
  });

  it("maps https with no port to wss", () => {
    expect(
      detectServerEndpoint({ protocol: "https:", hostname: "example.com", port: "" }),
    ).toBe("wss://example.com");
  });
});
