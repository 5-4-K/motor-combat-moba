import type { CarId, PlaygroundSetup, TunableField, TuningValue, WeaponId } from "@motor-combat-moba/shared";
import {
  ARENAS,
  cars,
  slots,
  weapons,
  basicAttackIds,
  basicAttackOf,
  slotsOf,
  tunableFields,
} from "@motor-combat-moba/shared";
import { CAR_EVENT_IDS, type CarEventId } from "../../fx/table.js";

/**
 * Pure derivations for the playground overlay (Task 10, spec PG16/PG19). `overlay.ts` is the thin,
 * untested DOM shell that wires these onto the actual panel; everything here is a plain function over
 * plain data so it can run under vitest's node environment.
 */

/**
 * `"hidden"` while the sim is unpaused; the rest are the paused sub-screens. `"cars"` is the Car
 * select panel (PG74) — the six seats plus the mode, arena and hitbox controls that used to sit at
 * the top of `"physics"`. `"turret"` is the Turret settings panel (TR58).
 */
export type OverlayView = "hidden" | "menu" | "cars" | "physics" | "vfx" | "env" | "turret";

/** Tag names that mean "the user is typing/selecting", where P must not be treated as the pause key. */
const FORM_CONTROL_TAGS: ReadonlySet<string> = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/**
 * What pressing P should do, given the overlay's current view and where keyboard focus is.
 *
 * A keystroke landing in a form control (typing in nothing here today, but a `<select>` still takes
 * focus) is never the pause key — otherwise picking a car from a dropdown with the letter "p" in its
 * name, or just tabbing through the settings panel, could toggle pause out from under the user.
 * Outside a form control: either settings panel backs out to the menu without touching pause (the sim stays
 * frozen); hidden or menu both send the toggle (P opens the menu from gameplay, and doubles for the
 * menu's own Resume while it is up).
 */
export function pauseKeyAction(
  view: OverlayView,
  targetTag: string,
): "toggle" | "back-to-menu" | "ignore" {
  if (FORM_CONTROL_TAGS.has(targetTag.toUpperCase())) return "ignore";
  // Any settings panel backs out to the menu without touching pause; the sim stays frozen.
  if (view === "cars" || view === "physics" || view === "vfx" || view === "env" || view === "turret") {
    return "back-to-menu";
  }
  return "toggle";
}

/** Which seats are on the field, in seat order (PG82). */
export function enabledSeats(setup: PlaygroundSetup): number[] {
  const seats: number[] = [];
  setup.cars.forEach((car, seat) => {
    if (car.enabled) seats.push(seat);
  });
  return seats;
}

/**
 * May this seat be switched off (PG79)?
 *
 * No, when it is the only one left on the field: `isPlaygroundSetup` rejects a payload with no
 * enabled seat, so the panel would be offering a control whose only effect is a silently-dropped
 * send — the failure `env-panel.ts` already names for `floor.*`/`floorArt.*`. Disabling an
 * already-disabled seat is trivially allowed, because it is a no-op rather than a change.
 */
export function canDisableSeat(setup: PlaygroundSetup, seat: number): boolean {
  if (!setup.cars[seat]?.enabled) return true;
  return enabledSeats(setup).length > 1;
}

/**
 * Where the wheel goes when `disabled` is switched off (PG78).
 *
 * Down to the lowest still-enabled seat, never off: `drivenSeat` may never name a disabled seat, so
 * unchecking the car you are driving has to hand the wheel somewhere rather than leaving it dangling
 * for the validator to reject. Disabling any OTHER seat leaves the wheel alone.
 *
 * The answer does not depend on whether `disabled`'s own flag has flipped yet, which is why the
 * panel's checkbox listener may call this from a `change` handler — i.e. AFTER the flip, reading a
 * setup in which that seat is already off. A seat that is not the driven one returns early either
 * way; a seat that IS returns the lowest enabled seat excluding itself, and that explicit
 * `!== disabled` filter is exactly what makes the already-flipped reading agree with the
 * not-yet-flipped one.
 *
 * When nothing else is enabled the wheel stays put — `canDisableSeat` refuses that case upstream,
 * and returning the seat unchanged is the honest answer rather than a -1 the caller must
 * special-case.
 */
export function nextDrivenSeat(setup: PlaygroundSetup, disabled: number): number {
  if (setup.drivenSeat !== disabled) return setup.drivenSeat;
  const next = enabledSeats(setup).find((seat) => seat !== disabled);
  return next ?? disabled;
}

/** All cars, active or not — the playground can drive a retired/unreleased chassis (PG18/PG20). */
export function carOptions(): { id: CarId; name: string }[] {
  return Object.values(cars()).map((row) => ({ id: row.id, name: row.name }));
}

/**
 * The weapons a playground seat may be given in an ABILITY slot (BA37). A weapon some chassis
 * carries as its basic attack is left out: that slot is a property of the chassis, not of the
 * loadout, so it is never picked here — `newFireState` prepends the driven car's own (it appended
 * it until the 2026-09-20 index flip; either way the panel never offers it).
 *
 * The excluded set comes from `cars()`, not from the shape of an id. Which weapons are basic
 * attacks is a fact about the roster's slots, and the roster is the only thing that knows it.
 */
export function weaponOptions(): { id: WeaponId; name: string }[] {
  const basics = basicAttackIds();
  return Object.values(weapons())
    .filter((row) => !basics.has(row.id))
    .map((row) => ({ id: row.id, name: row.name }));
}

/** How each `CarEventId` reads in the VFX panel's weapon/subject select. */
const CAR_EVENT_NAMES: Record<CarEventId, string> = {
  carDamage: "Car: damage",
  carDeath: "Car: death",
};

/** Every subject the VFX panel can edit: the ten weapons, then every car event (EV20). Drawn from
 * `CAR_EVENT_IDS` rather than repeating its two ids here, so a rename or an added event id shows up
 * in this list (and stays recognised by `isCarEventId`) without a second edit. */
export function fxSubjectOptions(): { id: string; name: string }[] {
  return [
    ...Object.values(weapons()).map((row) => ({ id: row.id as string, name: row.name })),
    ...CAR_EVENT_IDS.map((id) => ({ id: id as string, name: CAR_EVENT_NAMES[id] })),
  ];
}

/** Registered arena ids, for the arena `<select>`. */
export function arenaOptions(): string[] {
  return Object.keys(ARENAS);
}

/**
 * A seat's slot picks are legal iff there is at least one, no more than this build's `N`
 * (`slots().maxAbilitySlots`), and they are pairwise distinct (PG17, VS34 — the same
 * weapon on ANOTHER seat is fine; only a dupe within one seat is rejected). Mirrors
 * `isPlaygroundSetup`'s own per-seat check so the overlay catches an illegal pick locally, before
 * building a payload the server would silently reject.
 *
 * No longer a type predicate: a variable-length loadout has no tuple type to narrow to.
 */
export function isLoadoutLegal(weaponIds: readonly WeaponId[]): boolean {
  return (
    weaponIds.length >= 1 &&
    weaponIds.length <= slots().maxAbilitySlots &&
    new Set(weaponIds).size === weaponIds.length
  );
}

/** May the Car select panel's ＋ button add another row to this seat's loadout (VS34)? */
export function canAddWeaponSlot(weaponIds: readonly WeaponId[]): boolean {
  return weaponIds.length < slots().maxAbilitySlots;
}

/** May the Car select panel's − button remove a row from this seat's loadout (VS34)? A seat may
 * never be left with zero weapons, so this is refused at exactly one entry. */
export function canRemoveWeaponSlot(weaponIds: readonly WeaponId[]): boolean {
  return weaponIds.length > 1;
}

/**
 * What a freshly-added row should start on: the first option this seat does not already carry, so
 * the new row does not open on an immediate duplicate the user has to notice and fix. Falls back to
 * the first option at all when every option is already in use — the panel's own legality check
 * still catches that seat, but this function makes no claim to prevent it.
 */
export function addedWeaponPick(
  current: readonly WeaponId[],
  options: readonly { id: WeaponId }[],
): WeaponId {
  const used = new Set(current);
  return options.find((o) => !used.has(o.id))?.id ?? options[0]!.id;
}

/** This seat's loadout with one more entry appended (VS34). A no-op at `maxAbilitySlots` — callers
 * should disable the ＋ control via `canAddWeaponSlot` rather than rely on this silently refusing. */
export function withAddedWeaponSlot(
  weaponIds: readonly WeaponId[],
  options: readonly { id: WeaponId }[],
): readonly WeaponId[] {
  if (!canAddWeaponSlot(weaponIds)) return weaponIds;
  return [...weaponIds, addedWeaponPick(weaponIds, options)];
}

/** This seat's loadout with the entry at `index` removed (VS34). A no-op at one entry left —
 * callers should disable the − control via `canRemoveWeaponSlot` rather than rely on this silently
 * refusing. */
export function withRemovedWeaponSlot(
  weaponIds: readonly WeaponId[],
  index: number,
): readonly WeaponId[] {
  if (!canRemoveWeaponSlot(weaponIds)) return weaponIds;
  return weaponIds.filter((_, i) => i !== index);
}

export type StatsTabKey = "global" | "cars" | "weapons";

export interface StatsGroup {
  title: string;
  fields: TunableField[];
}

export interface StatsTab {
  key: StatsTabKey;
  title: string;
  groups: StatsGroup[];
}

/**
 * The Stats area's three tabs (PG35), replacing the single flat scroll the panel used to render.
 *
 * The FILTER is unchanged from spec PG13: only what is actually on the field is tunable — the
 * up-to-six enabled chassis and the up-to-eighteen weapons they carry, and the global drive/ram/
 * combat rows. It reads the ENABLED seats only — a seat parked off the field is not tunable, because
 * tuning a chassis that is not spawned changes nothing observable, so widening this would only
 * lengthen the scroll.
 *
 * All three tabs are ALWAYS returned, in this order, even when a tab's group list is empty: the tab
 * bar's shape must not change under the pointer. Row order within a group, and group order within a
 * tab, follow `tunableFields()`'s own order, since this only filters and never re-sorts.
 */
export function statsTabs(setup: PlaygroundSetup): StatsTab[] {
  const fields = tunableFields();

  const seats = enabledSeats(setup).map((seat) => setup.cars[seat]!);
  const carIds = [...new Set(seats.map((car) => car.carId))];
  const carGroups: StatsGroup[] = [];
  for (const carId of carIds) {
    const carFields = fields.filter((f) => f.group === "car" && f.ownerId === carId);
    if (carFields.length > 0) carGroups.push({ title: cars()[carId].name, fields: carFields });
  }

  // Each seat's three abilities AND its chassis's basic attack (BA38). The panel is built from the
  // seats' own loadouts rather than from `weapons()`, so a weapon nobody seated has no group —
  // and a basic attack would have no group at all unless it is added here, which would leave BA36's
  // expected retune with no knob to reach for.
  const weaponIds = [
    ...new Set(seats.flatMap((car) => [...car.weapons, basicAttackOf(car.carId)])),
  ];
  const weaponGroups: StatsGroup[] = [];
  for (const weaponId of weaponIds) {
    const weaponFields = fields.filter((f) => f.group === "weapon" && f.ownerId === weaponId);
    if (weaponFields.length > 0) {
      // Nine rows share the name "Basic Attack" (BA5), so a shared name falls back to the id — the
      // smallest fix, and one that needs no second name field on `weapons()`.
      const name = weapons()[weaponId].name;
      const shared = Object.values(weapons()).filter((row) => row.name === name).length > 1;
      weaponGroups.push({ title: shared ? weaponId : name, fields: weaponFields });
    }
  }

  return [
    {
      key: "global",
      title: "Global",
      groups: [
        {
          title: "Global",
          fields: fields.filter(
            (f) =>
              f.group === "drive" || f.group === "ram" || f.group === "combat" || f.group === "impulse",
          ),
        },
      ],
    },
    { key: "cars", title: "Cars", groups: carGroups },
    { key: "weapons", title: "Weapons", groups: weaponGroups },
  ];
}

/**
 * Can this row's value be nudged a step at a time (PG36)? Only a `number` row with a full
 * `min`/`max`/`step` grid — all three are optional on `TunableField`, and a boolean or enum row has
 * nothing to step. The overlay omits the buttons entirely when this is false, rather than rendering
 * a pair that does nothing.
 */
export function canStep(field: TunableField): boolean {
  return (
    field.kind === "number" &&
    typeof field.min === "number" &&
    typeof field.max === "number" &&
    typeof field.step === "number" &&
    field.step > 0
  );
}

/**
 * `current` moved one `step` in `direction`, clamped into `[min, max]` (PG36).
 *
 * The caller passes the range input's CURRENT value — already snapped by the browser to the
 * `min`/`step` grid — rather than a float the buttons track themselves, which is what makes
 * up-then-down a round trip instead of a slow drift. Returns `current` untouched for a row that
 * `canStep` rejects.
 */
export function steppedValue(field: TunableField, current: number, direction: 1 | -1): number {
  if (!canStep(field)) return current;
  return stepInRange({ min: field.min!, max: field.max!, step: field.step! }, current, direction);
}

/** The three numbers a `<input type=range>` is built from — all a nudge needs to know. */
export interface StepRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * `current` moved one `step` in `direction`, clamped into `[min, max]`.
 *
 * The generic half of `steppedValue`, so the VFX and environment panels can nudge their own rows
 * (`FxFieldDef` and `EnvFieldDef` carry the same three numbers under different types) without a
 * second copy of the clamp. Deliberately does NOT snap the result onto the `min`/`step` grid: a
 * caller may hand in an off-grid value (a shipped number very often is one), and snapping would
 * make the first nudge jump somewhere the user did not ask for instead of moving by one step.
 *
 * The `toPrecision` trim is the 0.1 + 0.2 = 0.30000000000000004 case: env steps go down to 1e-5, and
 * without it a few nudges leave a binary-float tail that the readout and the pasteable export both
 * print.
 */
export function stepInRange(range: StepRange, current: number, direction: 1 | -1): number {
  const next = current + direction * range.step;
  const clamped = Math.min(range.max, Math.max(range.min, next));
  return Number(clamped.toPrecision(12));
}

/**
 * A chassis's shipped kit (PG34) — what the "restore loadout" button beside each seat writes.
 * `undefined` when the kit is not a legal loadout (an inactive prototype carrying nothing), so the
 * button disables rather than producing a setup `isPlaygroundSetup` rejects.
 */
export function shippedLoadoutOf(carId: CarId): readonly WeaponId[] | undefined {
  const kit = slotsOf(carId);
  return isLoadoutLegal(kit) ? kit : undefined;
}

/**
 * Whether `value` should count as "shipped" for `field` -- i.e. whether the overrides map should
 * hold NO entry for this row (Task 11 review finding). A `number` field's `<input type=range>` snaps
 * to a `min`/`step` grid, and `numberRange` (`tuning-walker.ts`) sets `step = max/100` with
 * `max = shipped * 3` for most rows: `shipped` then sits at `33.33` steps from `min`, off the grid
 * the control can actually land on. Exact `===` against `shipped` is therefore false for ~70% of the
 * numeric fields even when the user dragged the slider all the way back to the shipped position, and
 * the map would keep a phantom entry Copy overrides exports and the sim runs under. A number counts
 * as shipped when it lands within half a step of it -- the same tolerance a snapped grid position
 * would land within -- so dragging back to shipped always clears the override. `boolean`/`enum`
 * fields have no grid to snap to and keep strict equality.
 */
export function isAtShipped(field: TunableField, value: TuningValue): boolean {
  if (field.kind !== "number" || typeof value !== "number" || typeof field.shipped !== "number") {
    return value === field.shipped;
  }
  const step = field.step ?? 0;
  if (step <= 0) return value === field.shipped;
  return Math.abs(value - field.shipped) < step / 2;
}
