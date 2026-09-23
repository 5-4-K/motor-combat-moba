/**
 * Which rows every mode carries, unioned, for the art sweep (MC5).
 *
 * Art is per-id and GLOBAL: `weapon-icon.predator` is one file whoever draws it, and `car.mirage`
 * is one sprite whichever mode seats that chassis. So `npm run check:art` stays ONE sweep, not one
 * per mode — what went per-mode underneath it is which ids exist at all, and which of them are
 * CARRIED. A chassis published in Brawl and shelved in Deathmatch, or a weapon slotted in one kit
 * and not the other, must not read as unreleased just because the mode this tool happened to look
 * at does not carry it.
 *
 * Every helper here resolves its own `withMode` scope per mode (MC12) and hands back plain data, so
 * `check-cars.mjs` and `check-weapons.mjs` — and their unit tests, which call `checkCars`/
 * `checkWeapons` with no bundle installed — need no scope of their own.
 *
 * EVERY mode in `MODE_TABLE`, published or not. `MODE_TABLE.isActive` is the LOBBY's publish gate,
 * and this file follows the same rule `checkCars` already follows for an unreleased CHASSIS: art
 * missing from something nobody can reach yet is exactly the thing to learn before release, not
 * after. `parseModeArg` accepts an inactive mode for the same reason.
 */
import { MODE_TABLE, cars, fireSlotsOf, modeConfigOf, weapons, withMode } from "../packages/shared/dist/index.js";

/** Every mode's wire id, numeric ascending — the order a union below is built in. */
export function everyMode() {
  return Object.keys(MODE_TABLE)
    .map((key) => Number(key))
    .sort((a, b) => a - b);
}

/** A mode's display name, as `MODE_TABLE` spells it — what a `(mode: ...)` label prints. */
export function modeNameOf(mode) {
  return MODE_TABLE[mode].name;
}

/**
 * Union of every mode's chassis ids, each with the modes that PUBLISH it (`CarDef.isActive`).
 *
 * Union ORDER is first-seen across `everyMode()`, so the default mode's own table order leads and a
 * chassis only some later mode authors lands after it — the same shape `activeArenaIds()` uses.
 * `publishedIn` is empty for a prototype no mode publishes; that is the row `reportCars` has always
 * marked `(inactive)`.
 */
export function carRoster() {
  const byId = new Map();
  for (const mode of everyMode()) {
    withMode(modeConfigOf(mode), () => {
      for (const carId of Object.keys(cars())) {
        const entry = byId.get(carId) ?? { id: carId, publishedIn: [] };
        if (cars()[carId].isActive) entry.publishedIn.push(mode);
        byId.set(carId, entry);
      }
    });
  }
  return [...byId.values()];
}

/**
 * Union of every mode's weapon ids, each with the modes in which some chassis can FIRE it
 * (`fireSlotsOf`, so a basic attack counts exactly as an ability does) and the `color` its icon is
 * checked for drift against.
 *
 * Carriage is asked of the mode's WHOLE car table, inactive chassis included, for the same reason
 * this tool checks an unreleased chassis's sprite: a kit authored ahead of release still owes its
 * icons. A row nobody fires anywhere (`tremor`) has an empty `carriedIn` and is swept all the same.
 *
 * `color` is a PER-MODE field that one icon file cannot satisfy twice, so it is taken from the
 * first mode in `everyMode()` order that has the row — the default mode for every row shipped
 * today. A mode that repainted a row it shares would need its own icon to differ from, which is not
 * something this namespace can express; that is a limit of art being global, not of this sweep.
 */
export function weaponRoster() {
  const byId = new Map();
  for (const mode of everyMode()) {
    withMode(modeConfigOf(mode), () => {
      const fired = new Set(Object.keys(cars()).flatMap((carId) => [...fireSlotsOf(carId)]));
      for (const [weaponId, def] of Object.entries(weapons())) {
        const entry = byId.get(weaponId) ?? { id: weaponId, color: def.color, carriedIn: [] };
        if (fired.has(weaponId)) entry.carriedIn.push(mode);
        byId.set(weaponId, entry);
      }
    });
  }
  return [...byId.values()];
}

/**
 * Which chassis can FIRE one weapon, unioned across every mode, each with the modes it fires it in.
 *
 * The importer's "drive X and check the HUD slot bar" line is the one caller. It read raw
 * `CAR_TABLE[carId].weapons` until 2026-09-23 — the last mode-blind carriage query in the tree —
 * so a weapon carried only in a diverged mode's kit printed `no car carries "<id>"` at the very
 * moment someone had just drawn its icon. Same union, same `fireSlotsOf` question, same scoping
 * rule as `weaponRoster` above: a basic attack counts, and an inactive chassis counts, because a
 * kit authored ahead of release still owes its icons.
 *
 * Union order is first-seen across `everyMode()`. Empty for a row nobody fires anywhere (`tremor`).
 */
export function weaponCarriers(weaponId) {
  const byCar = new Map();
  for (const mode of everyMode()) {
    withMode(modeConfigOf(mode), () => {
      for (const carId of Object.keys(cars())) {
        if (!fireSlotsOf(carId).includes(weaponId)) continue;
        const entry = byCar.get(carId) ?? { carId, modes: [] };
        entry.modes.push(mode);
        byCar.set(carId, entry);
      }
    });
  }
  return [...byCar.values()];
}

/**
 * The suffix a report line carries for a row the modes DISAGREE about: `(mode: Brawl)`, naming
 * every mode that carries it. Empty when every mode agrees it is carried — the common case, and one
 * that must stay unmarked or the marker would be noise on every line.
 *
 * `noneLabel` is what a row NO mode carries prints, and the two sweeps want different answers: a
 * chassis no mode publishes is the `(inactive)` prototype `reportCars` has always named, while a
 * weapon no chassis fires is a legal, documented state (`tremor`) — but legal is not the same as
 * invisible. Until 2026-09-23 the weapon sweep passed `""` here, so `tremor` and a row
 * ACCIDENTALLY dropped from every kit printed identically, as an unmarked line among eighteen
 * others. It passes `(uncarried)` now: the state stays legal and unfailed, and a row that fell out
 * of a loadout says so on its own line instead of hiding among the ones that never had one.
 */
export function carriageLabel(carriedIn, noneLabel = "") {
  if (carriedIn.length === 0) return noneLabel;
  if (carriedIn.length === everyMode().length) return "";
  return `(mode: ${carriedIn.map(modeNameOf).join(", ")})`;
}
