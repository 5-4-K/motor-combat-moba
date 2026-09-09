import { describe, expect, it } from "vitest";
import { deriveFxEvents, type FxWorldView } from "./events.js";

const car = (sessionId: string, hp: number, alive = true) => ({
  sessionId,
  x: 100,
  y: 200,
  angle: 0,
  hp,
  alive,
  carId: "mirage",
  vx: 0,
  vy: 0,
});
const shot = (id: string, weaponId: string, x = 300, y = 400) => ({
  id,
  weaponId,
  x,
  y,
  angle: 0.5,
  alive: true,
  isExplosion: false,
  extent: 0,
});
const view = (
  cars: FxWorldView["cars"],
  instances: FxWorldView["instances"] = [],
): FxWorldView => ({ cars, instances });

describe("deriveFxEvents", () => {
  it("reports nothing when nothing changed", () => {
    const v = view([car("a", 100)], [shot("s1", "thumper")]);
    expect(deriveFxEvents(v, v)).toEqual([]);
  });

  it("reports nothing on the very first view — there is no delta to read yet", () => {
    expect(deriveFxEvents(undefined, view([car("a", 100)], [shot("s1", "thumper")]))).toEqual([]);
  });

  it("fires a shotFired when an instance id appears", () => {
    const events = deriveFxEvents(view([car("a", 100)]), view([car("a", 100)], [shot("s1", "lance", 10, 20)]));
    expect(events).toEqual([{ kind: "shotFired", weaponId: "lance", x: 10, y: 20, angle: 0.5 }]);
  });

  it("fires a shotEnded at the instance's LAST KNOWN pose when its id leaves", () => {
    const events = deriveFxEvents(
      view([car("a", 100)], [shot("s1", "magmablast", 700, 800)]),
      view([car("a", 100)]),
    );
    // The pose comes from the previous view: the instance is gone from the next one, so there is
    // nowhere else to read it from (VFX12).
    expect(events).toEqual([{ kind: "shotEnded", weaponId: "magmablast", x: 700, y: 800, angle: 0.5 }]);
  });

  it("fires a damaged event carrying the amount when hp drops", () => {
    const events = deriveFxEvents(view([car("a", 100)]), view([car("a", 72)]));
    expect(events).toEqual([{ kind: "damaged", sessionId: "a", x: 100, y: 200, amount: 28 }]);
  });

  it("ignores hp going UP, so a repair pulse is not an impact", () => {
    expect(deriveFxEvents(view([car("a", 40)]), view([car("a", 90)]))).toEqual([]);
  });

  it("fires died when alive goes false, and no damaged alongside it", () => {
    const events = deriveFxEvents(view([car("a", 10)]), view([car("a", 0, false)]));
    expect(events).toEqual([{ kind: "died", sessionId: "a", x: 100, y: 200 }]);
  });

  it("ignores a car that was not in the previous view — a joiner is not a spawn effect", () => {
    expect(deriveFxEvents(view([]), view([car("b", 50)]))).toEqual([]);
  });

  it("ignores a car that left, so a disconnect does not read as a death", () => {
    expect(deriveFxEvents(view([car("a", 50)]), view([]))).toEqual([]);
  });

  it("reads several changes in one step", () => {
    const events = deriveFxEvents(
      view([car("a", 100), car("b", 100)], [shot("s1", "thumper")]),
      view([car("a", 80), car("b", 100)], [shot("s2", "lance")]),
    );
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind).sort()).toEqual(["damaged", "shotEnded", "shotFired"]);
  });

  it("fires shotEnded the moment alive flips false, not when the id is later deleted", () => {
    const before = view([car("a", 100)], [shot("s1", "magmablast", 700, 800)]);
    const after = view([car("a", 100)], [{ ...shot("s1", "magmablast", 700, 800), alive: false }]);
    expect(deriveFxEvents(before, after)).toEqual([
      { kind: "shotEnded", weaponId: "magmablast", x: 700, y: 800, angle: 0.5 },
    ]);
  });

  it("does not fire shotEnded a second time when the dead instance is finally deleted", () => {
    const dead = { ...shot("s1", "magmablast", 700, 800), alive: false };
    expect(deriveFxEvents(view([car("a", 100)], [dead]), view([car("a", 100)]))).toEqual([]);
  });

  it("gives no muzzle flash to an instance that arrives already dead", () => {
    const born = { ...shot("s1", "lance", 10, 20), alive: false };
    expect(deriveFxEvents(view([car("a", 100)]), view([car("a", 100)], [born]))).toEqual([]);
  });
});

describe("the instance view carries what a field needs (LZ36a)", () => {
  it("distinguishes a burst from the shell that threw it", () => {
    const shell = { id: "a", weaponId: "magmablast", x: 0, y: 0, angle: 0, alive: true, isExplosion: false, extent: 0 };
    const field = { id: "b", weaponId: "magmablast", x: 0, y: 0, angle: 0, alive: true, isExplosion: true, extent: 60 };
    // Both are magmablast; only `isExplosion` and `extent` say one is a 60-unit field on the ground
    // and the other a 12-unit shell in the air.
    expect(shell.isExplosion).toBe(false);
    expect(field.extent).toBe(60);
    // The view type must accept both without a cast.
    const view: FxWorldView = { cars: [], instances: [shell, field] };
    expect(view.instances).toHaveLength(2);
  });
});
