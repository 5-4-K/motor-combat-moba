import { describe, expect, it } from "vitest";
import { nodeMajorOk } from "./node-version.js";

describe("nodeMajorOk", () => {
  it("accepts Node 22 and newer, with or without a leading v", () => {
    expect(nodeMajorOk("22.0.0")).toBe(true);
    expect(nodeMajorOk("v22.11.1")).toBe(true);
    expect(nodeMajorOk("24.1.0")).toBe(true);
  });
  it("rejects older or unparseable versions", () => {
    expect(nodeMajorOk("20.19.0")).toBe(false);
    expect(nodeMajorOk("v21.9.0")).toBe(false);
    expect(nodeMajorOk("")).toBe(false);
    expect(nodeMajorOk("banana")).toBe(false);
  });
});
