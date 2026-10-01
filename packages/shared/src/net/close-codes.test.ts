import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../constants.js";
import { CLOSE_CODES, protocolRefusal } from "./close-codes.js";

describe("CLOSE_CODES (D5 ruling A)", () => {
  it("are unique and sit in the app block 4100-4199", () => {
    const codes = Object.values(CLOSE_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) {
      expect(c).toBeGreaterThanOrEqual(4100);
      expect(c).toBeLessThan(4200);
    }
  });
});

describe("protocolRefusal (NR55)", () => {
  it("accepts the current protocol", () => {
    expect(protocolRefusal({ protocol: PROTOCOL_VERSION, name: "a" })).toBeUndefined();
  });
  it("refuses an older protocol with the readable message", () => {
    expect(protocolRefusal({ protocol: PROTOCOL_VERSION - 1 })).toBe(
      `Client and server are different versions (client protocol ${PROTOCOL_VERSION - 1}, server ${PROTOCOL_VERSION}). Refresh the page.`,
    );
  });
  it("refuses a client that sends no protocol at all (pre-D5 builds)", () => {
    for (const opts of [undefined, null, {}, { name: "x" }, { protocol: "1" }]) {
      expect(protocolRefusal(opts)).toMatch(new RegExp(`client protocol none, server ${PROTOCOL_VERSION}\\). Refresh the page\\.$`));
    }
  });
});
