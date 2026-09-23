// `activeArenaIds()` (`registry.ts`, ~line 120) had zero tests despite being exported from the
// package index. It unions each ACTIVE mode's `arenas` list, de-duplicated, in registry order —
// three properties this file tests independently — and excludes an INACTIVE mode's arenas
// entirely, which is what stops an unpublished mode's art bloating the release zip.
//
// The real `BRAWL_TABLES`/`DEATHMATCH_TABLES` both ship `["arena-01", "arena-02"]` today, and the
// registry's one INACTIVE row (`GameMode.TEAM`) points at the same `BRAWL_TABLES` object an ACTIVE
// row already uses — so the real, un-mocked registry can never show "an inactive mode's arenas are
// excluded": whatever TEAM carries, Brawl (active) already contributes. To test that property (and
// to pin union/de-dup/order against a case the real data doesn't exercise), this file mocks
// `./build.js`'s `assembleModeConfig` so each `GameMode` id resolves to its own arena list,
// independent of which `ModeTables` object registry.ts happens to pass in. Everything else —
// `MODE_TABLE`, `MODE_ORDER`, `activeGameModes`, `activeArenaIds` — is the real, unmocked code.
import { describe, expect, it, vi } from "vitest";

const FAKE_ARENAS = vi.hoisted(
  () =>
    new Map<number, readonly string[]>([
      [0, ["arena-01", "arena-02"]], // GameMode.FFA_LAST_STANDING (Brawl) — active, first in MODE_ORDER
      [1, ["arena-02", "arena-99"]], // GameMode.TEAM (Team brawl) — INACTIVE; arena-99 is unique to it
      // GameMode.FFA_DEATHMATCH (Deathmatch) — active, last in MODE_ORDER. Its new arena is
      // "arena-00", which sorts BEFORE arena-01/02 alphabetically but must still land LAST in
      // registry order — that mismatch is what makes the order test below actually distinguish
      // "registry order" from "happens to already be sorted" (an alphabetical accident would have
      // let a `.sort()` regression through undetected).
      [2, ["arena-00", "arena-01"]],
    ]),
);

vi.mock("./build.js", () => ({
  assembleModeConfig: (id: number, _tables: unknown) => ({
    id,
    arenas: FAKE_ARENAS.get(id) ?? [],
  }),
}));

describe("activeArenaIds", () => {
  it("unions each ACTIVE mode's arenas", async () => {
    // Corrected 2026-09-22 (final review): this used to explain `vi.resetModules()` by naming a
    // `vitest.setup.ts` that side-effect-imported `./registry.js` before this file's hoisted
    // `vi.mock` took effect. That file has since been deleted, and there is no `setupFiles` entry
    // in `vitest.config.ts` any more — so that is no longer why this call is here.
    // The real reason: `registry.js` builds `MODE_TABLE` (and so runs `assembleModeConfig`, the
    // thing being mocked) once, AT MODULE LOAD. This file's four tests each do their own dynamic
    // `import("./registry.js")` below, and a module-specifier cache would hand every test after the
    // first the SAME already-evaluated module — so without a fresh reset first, only the first
    // test's import would actually run against a just-hoisted mock; every later one would silently
    // reuse whatever `MODE_TABLE` the first import built. `vi.resetModules()` forces each test's
    // `import` to re-evaluate `registry.js` (and `build.js`) from scratch, which is what makes every
    // test here independent of run order rather than only the first one being trustworthy.
    vi.resetModules();
    const { activeArenaIds } = await import("./registry.js");
    // Brawl (active): arena-01, arena-02. Deathmatch (active): arena-00, arena-01.
    // TEAM (inactive) contributes nothing, so its arena-99 must be absent.
    expect(activeArenaIds()).toEqual(["arena-01", "arena-02", "arena-00"]);
  });

  it("de-duplicates: no arena id appears twice even though both active modes carry arena-01", async () => {
    vi.resetModules();
    const { activeArenaIds } = await import("./registry.js");
    const ids = activeArenaIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "arena-01")).toHaveLength(1);
  });

  it("preserves registry order: Brawl's own arenas first, then only Deathmatch's NEW arena", async () => {
    vi.resetModules();
    const { activeArenaIds } = await import("./registry.js");
    // Brawl is first in MODE_ORDER and contributes arena-01 then arena-02, in ITS OWN list order.
    // Deathmatch is next; arena-01 is already seen, so only arena-00 is newly appended — LAST,
    // even though it would sort FIRST alphabetically. An alphabetical (or otherwise re-sorted)
    // result would read arena-00, arena-01, arena-02 instead, so this genuinely distinguishes
    // registry order from a coincidentally-sorted one.
    expect(activeArenaIds()).toEqual(["arena-01", "arena-02", "arena-00"]);
  });

  it("excludes an INACTIVE mode's arenas entirely (arena-99 belongs only to TEAM)", async () => {
    vi.resetModules();
    const { activeArenaIds } = await import("./registry.js");
    expect(activeArenaIds()).not.toContain("arena-99");
  });
});
