import { describe, expect, it } from "vitest";
import { GameMode } from "@motor-combat-moba/shared";
import { arenaCards } from "./arena-cards.js";
import { EMPTY_MANIFEST, SPRITE_DEFAULTS, type AssetManifest } from "../assets/manifest-schema.js";

const withPreview: AssetManifest = {
  sprites: { "arena.arena-02.preview": { ...SPRITE_DEFAULTS, file: "arenas/arena-02/preview.png" } },
};

describe("arenaCards (AR26)", () => {
  it("lists the mode's arenas in order, named from the def", () => {
    expect(arenaCards(GameMode.FFA_LAST_STANDING, EMPTY_MANIFEST)).toEqual([
      { id: "arena-01", name: "Arena 01", previewUrl: null },
      { id: "arena-02", name: "Arena 02", previewUrl: null },
    ]);
  });
  it("reads the preview from the manifest, null without a row (AR4)", () => {
    const cards = arenaCards(GameMode.FFA_LAST_STANDING, withPreview);
    expect(cards[0].previewUrl).toBeNull();
    expect(cards[1].previewUrl).toBe("art/arenas/arena-02/preview.png");
  });
  it("follows the room's mode, not the installed one", () => {
    expect(arenaCards(GameMode.CONQUER, EMPTY_MANIFEST).map((c) => c.id)).toEqual(["arena-03"]);
  });
});
