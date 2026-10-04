import { describe, expect, it } from "vitest";
import { isShotEnding } from "./shot-endings.js";

const live = { alive: true, isExplosion: false };
const ended = { alive: false, isExplosion: false };

describe("isShotEnding (protocol 8)", () => {
  it("is the row flipping from alive to ended", () => {
    expect(isShotEnding(live, ended)).toBe(true);
  });

  it("is a row that arrives already ended (a birth-tick ending, or one that ended out of view)", () => {
    expect(isShotEnding(undefined, ended)).toBe(true);
  });

  it("is never the same ended row seen again", () => {
    expect(isShotEnding(ended, ended)).toBe(false);
  });

  it("is never a live row, new or old — a row vanishing never reaches it at all", () => {
    expect(isShotEnding(undefined, live)).toBe(false);
    expect(isShotEnding(live, live)).toBe(false);
  });

  it("is never a burst: a shell's ending is its blast, and a lava field's expiry is a fade", () => {
    expect(isShotEnding({ alive: true, isExplosion: true }, { alive: false, isExplosion: true })).toBe(false);
    expect(isShotEnding(undefined, { alive: false, isExplosion: true })).toBe(false);
  });
});
