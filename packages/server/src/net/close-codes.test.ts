import { describe, expect, it } from "vitest";
import { CloseCode, ErrorCode } from "@colyseus/core";
import { CLOSE_CODES } from "@motor-combat-moba/shared";

/**
 * D5 ruling A: no code the game chooses may mean something else to Colyseus. A kick sent as 4002
 * read as Colyseus's WITH_ERROR, a second-arena refusal as 4003 as FAILED_TO_RECONNECT.
 */
describe("app close codes vs Colyseus 0.18", () => {
  it("collide with no Colyseus CloseCode or ErrorCode", () => {
    const reserved = new Set<number>([...Object.values(CloseCode), ...Object.values(ErrorCode)]);
    for (const [name, code] of Object.entries(CLOSE_CODES)) {
      expect(reserved.has(code), `${name} = ${code}`).toBe(false);
    }
  });
});
