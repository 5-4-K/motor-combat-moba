import { describe, expect, it } from "vitest";
import { DEV_TOOLS, DEV_TOOL_MARKER, isDevToolId } from "./registry.js";

describe("dev tool registry", () => {
  it("recognises exactly its own ids", () => {
    for (const id of Object.keys(DEV_TOOLS)) expect(isDevToolId(id)).toBe(true);
    expect(isDevToolId("nonsense")).toBe(false);
    expect(isDevToolId(undefined)).toBe(false);
  });

  it("carries the known dev tool ids (PG2)", () => {
    expect(Object.keys(DEV_TOOLS)).toEqual(["assets", "playground"]);
    expect(isDevToolId("playground")).toBe(true);
  });

  it("does not treat inherited object properties as tool ids", () => {
    expect(isDevToolId("constructor")).toBe(false);
    expect(isDevToolId("toString")).toBe(false);
  });

  it("declares the marker build-release.mjs asserts absent from releases", () => {
    expect(DEV_TOOL_MARKER).toBe("MOTOR DEV TOOL");
  });
});
