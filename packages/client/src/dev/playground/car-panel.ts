import type { CarId, PlaygroundSetup, WeaponId } from "@motor-combat-moba/shared";
import { CAR_TABLE, COLOR_TABLE, PLAYGROUND_SEAT_IDS } from "@motor-combat-moba/shared";
import { button, h } from "../../ui/dom.js";
import { carFillOf } from "../../scenes/car-visual.js";
import type { CarTintOverrides } from "../../fx/car-tint.js";
import {
  arenaOptions,
  canDisableSeat,
  carOptions,
  enabledSeats,
  isLoadoutLegal,
  nextDrivenSeat,
  shippedLoadoutOf,
  weaponOptions,
} from "./ui-model.js";

export interface CarPanelProps {
  /** The setup the panel opens on (PG83). Never mutated — the panel rebuilds a fresh one on read. */
  readonly initial: PlaygroundSetup;
  /** The live per-car tint map, mutated in place and keyed by seat id (PG84). */
  readonly tints: CarTintOverrides;
  /** Whether hitbox outlines are on, and how to set them. Applied on the spot, not on Back. */
  readonly showHitboxes: () => boolean;
  readonly setShowHitboxes: (on: boolean) => void;
  /** Ship the rebuilt setup. Called on every control change that produces a LEGAL setup. */
  readonly onSetup: (setup: PlaygroundSetup) => void;
  /** Save to localStorage. Called after every edit, tint edits included. */
  readonly persist: (setup: PlaygroundSetup) => void;
  readonly onBack: () => void;
}

export interface CarPanel {
  readonly el: HTMLElement;
  /** Whether any enabled seat's loadout is currently illegal (PG81) — the overlay's P-key exit
   * consults this so P is not a side door out while a loadout is illegal. */
  readonly isIllegal: () => boolean;
}

function selectFor(options: { id: string; name: string }[], value: string): HTMLSelectElement {
  const select = h(
    "select",
    {},
    options.map((o) => h("option", { value: o.id }, [o.name])),
  );
  select.value = value;
  return select;
}

/** `0xRRGGBB` as the `#rrggbb` string an `<input type="color">` reads and writes. Padded, because
 * the element silently rejects a short value and falls back to `#000000`. */
function hexOf(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

/** The six player colours, by name, for a car's colour select (PG31). Any two seats may pick the
 * same one — there is deliberately no guard here or on the wire. */
function colorSelect(value: number): HTMLSelectElement {
  const select = selectFor(
    COLOR_TABLE.map((color) => ({ id: String(color.colorId), name: color.name })),
    String(value),
  );
  select.classList.add("pg-color");
  return select;
}

/**
 * The Car select panel (spec PG74-PG84): six seats, the alone/vs-bot mode, the arena and the hitbox
 * toggle.
 *
 * Its own module, alongside `vfx-panel.ts` and `env-panel.ts`, for the same reason those are: it is
 * a few hundred lines of DOM with no decisions in it, and `overlay.ts` was already the longest file
 * in the package before this feature widened it. Every decision this panel makes lives in
 * `ui-model.ts` as a pure function — which seats are on, whether the last one may be switched off,
 * where the wheel goes — so what is left here is nodes and listeners.
 *
 * Holds NO reference to the room. Everything that leaves this module leaves through a callback, the
 * same contract the two sibling panels have, so the panel can be rebuilt without re-wiring the room
 * and so nothing here can send a message the overlay did not route.
 */
export function buildCarPanel(props: CarPanelProps): CarPanel {
  // -- shared controls -------------------------------------------------------------------------
  const modeAlone = h("input", {
    type: "radio",
    name: "pg-mode",
    value: "alone",
    checked: !props.initial.botEnabled,
  }) as HTMLInputElement;
  const modeBot = h("input", {
    type: "radio",
    name: "pg-mode",
    value: "bot",
    checked: props.initial.botEnabled,
  }) as HTMLInputElement;

  const difficultySelect = selectFor(
    [
      { id: "easy", name: "Easy" },
      { id: "medium", name: "Medium" },
      { id: "hard", name: "Hard" },
    ],
    props.initial.botDifficulty,
  );
  difficultySelect.classList.add("pg-difficulty");
  // Meaningless while every other car is a target dummy, and saying so with the control itself is
  // clearer than leaving a live select that changes nothing.
  const syncDifficultyEnabled = (): void => {
    difficultySelect.disabled = !modeBot.checked;
  };

  const arenaSelect = selectFor(
    arenaOptions().map((id) => ({ id, name: id })),
    props.initial.arenaId,
  );

  /**
   * Outline what the sim actually collides with: each car's OBB, and every live weapon instance's
   * own hitbox.
   *
   * The one control here that does NOT go through `evaluate`. Everything else sends a setup to the
   * server, which is why it batches behind a legality check — this changes nothing but what this
   * browser paints, so making it wait would be a delay with no reason behind it. It reads back from
   * `props.showHitboxes()` rather than from storage so the checkbox always shows what the arena is
   * actually doing.
   */
  const hitboxToggle = h("input", {
    type: "checkbox",
    checked: props.showHitboxes(),
  }) as HTMLInputElement;

  // -- one row of state per seat ---------------------------------------------------------------
  /**
   * One row of live controls per seat. `drive` inputs all carry `name: "pg-drive"` so the browser
   * enforces "exactly one seat is driven" for us — checking a new one unchecks the old, which is
   * what makes `readSetup`'s `findIndex` over `drive.checked` always find exactly one.
   */
  interface SeatRow {
    enabled: HTMLInputElement;
    drive: HTMLInputElement;
    car: HTMLSelectElement;
    color: HTMLSelectElement;
    weapons: HTMLSelectElement[];
    loadoutRow: HTMLElement;
    body: HTMLElement;
    title: HTMLElement;
    syncTint: () => void;
  }
  const rows: SeatRow[] = [];

  /** The setup the live controls currently describe. Rebuilt from the DOM every time, never from a
   * cached draft — the panel the user is looking at IS the source of truth for what gets sent. */
  function readSetup(): PlaygroundSetup {
    return {
      botEnabled: modeBot.checked,
      botDifficulty: difficultySelect.value as PlaygroundSetup["botDifficulty"],
      arenaId: arenaSelect.value,
      cars: rows.map((row) => ({
        carId: row.car.value as CarId,
        colorId: Number(row.color.value),
        weapons: row.weapons.map((s) => s.value) as [WeaponId, WeaponId, WeaponId],
        enabled: row.enabled.checked,
      })),
      drivenSeat: rows.findIndex((row) => row.drive.checked),
    };
  }

  const illegalHint = h("span", { class: "pg-illegal-hint" }, ["duplicate weapon in a loadout"]);
  illegalHint.hidden = true; // avoid a flash before the first `evaluate` paints its real state
  const backBtn = button({}, ["Back"], () => props.onBack());
  let illegal = false;

  /** Which seat bodies are open. Local to this panel session and NOT persisted — a collapse is a
   * scroll convenience, the same ruling `activeTab` already carries (PG35/PG76). */
  const open = new Set<number>(enabledSeats(props.initial));

  /**
   * Re-evaluate legality (always) and, when `send` is true and everything is legal, ship the setup.
   *
   * Legality is checked over EVERY seat, not only the enabled ones: `isPlaygroundSetup` rejects a
   * duplicate loadout wherever it sits, so a parked seat with two Lances would make every later send
   * fail silently. The outline goes on whichever rows are actually illegal, so the user is pointed at
   * the seat that is wrong rather than at the panel.
   */
  function evaluate(send: boolean): void {
    const setup = readSetup();
    illegal = false;
    setup.cars.forEach((car, seat) => {
      const bad = !isLoadoutLegal(car.weapons);
      rows[seat]!.loadoutRow.classList.toggle("pg-illegal", bad);
      // A parked seat's illegal loadout still blocks the send, so open its section rather than
      // hiding the thing the user has to fix behind a collapsed header.
      if (bad && !car.enabled) open.add(seat);
      illegal ||= bad;
    });
    backBtn.disabled = illegal;
    illegalHint.hidden = !illegal;
    if (!send || illegal) return;
    props.onSetup(setup);
    props.persist(setup);
  }

  /**
   * Repaint everything that depends on WHICH seats are on: collapse state, header titles, and the
   * last-seat lock (PG76/PG79). Runs after any enable or drive change, never after a plain chassis
   * or weapon edit — those cannot change which seats exist.
   */
  function syncSeats(): void {
    const setup = readSetup();
    rows.forEach((row, seat) => {
      const on = row.enabled.checked;
      row.body.hidden = !open.has(seat);
      row.title.textContent = `Car ${seat + 1} — ${CAR_TABLE[row.car.value as CarId].name}`;
      row.title.parentElement?.classList.toggle("pg-seat-off", !on);
      // The last car on the field cannot be switched off (PG79): the wire rejects a setup with no
      // enabled seat, and a control whose only effect is a silently-dropped send is worse than one
      // that says why.
      const locked = !canDisableSeat(setup, seat);
      row.enabled.disabled = locked;
      row.enabled.title = locked ? "the last car on the field cannot be switched off" : "";
      row.syncTint();
    });
  }

  /**
   * A free tint for ONE car: the browser's own colour picker, plus the hex it landed on and a
   * button back to the palette.
   *
   * Deliberately does NOT run `evaluate`. That sends `MSG_PLAYGROUND_SETUP` and respawns any car
   * whose chassis or loadout moved — a colour is a client-side render override that the server has
   * no opinion about, so routing it through there would respawn cars on every drag of the picker
   * AND accomplish nothing, since `PlaygroundSetup` carries a `colorId` and has nowhere to put a
   * free colour. It saves, because the map is persisted; `ArenaScene` re-reads the map at draw
   * time, so an edit needs no other announcement.
   *
   * Keyed by SEAT id (PG84), not by a Colyseus session id: a seat outlives a connection, which is
   * what lets a tint survive a page reload at all.
   *
   * The hex is shown as text because the native picker hides it the moment it closes, and reading
   * it off is the whole point: a colour that survives this panel gets typed into `COLOR_TABLE` by
   * hand.
   */
  function tintPicker(
    seatId: string,
    colorSel: HTMLSelectElement,
  ): { el: HTMLElement; sync: () => void } {
    const toggle = h("input", { type: "checkbox", class: "pg-tint-on" }) as HTMLInputElement;
    const input = h("input", { type: "color", class: "pg-tint" }) as HTMLInputElement;
    const readout = h("span", { class: "pg-tint-hex" }, []);

    /**
     * Paint both sides from the map, and mark whichever one is NOT driving the car.
     *
     * Exactly one of the palette dropdown and this picker paints a car, and a control that
     * silently does nothing is worse than one that says why — the rule `env-panel.ts` already
     * applies to `floor.*`/`floorArt.*`. So the inert side is dimmed and titled, in whichever
     * direction the toggle currently points.
     *
     * With no tint yet the picker OPENS on the slot colour, so a first pick starts from what the
     * car is actually wearing rather than from black.
     */
    function sync(): void {
      const tint = props.tints[seatId];
      const on = tint?.on === true;
      const shown = tint?.hex ?? carFillOf(Number(colorSel.value));
      toggle.checked = on;
      input.value = hexOf(shown);
      readout.textContent = hexOf(shown).toUpperCase();
      readout.classList.toggle("pg-tint-off", !on);
      input.classList.toggle("pg-tint-off", !on);
      colorSel.classList.toggle("pg-tint-off", on);
      colorSel.title = on ? "inert — this car is painted by its tint" : "";
      const inertTint = "inert — this car is painted by its palette colour";
      input.title = on ? "" : inertTint;
      readout.title = on ? "" : inertTint;
    }

    /** Write the tint, keeping the colour whatever the toggle does: switching OFF must not discard
     * a candidate, or comparing one against the palette would mean retyping the hex every time. */
    function write(hex: number, on: boolean): void {
      props.tints[seatId] = { hex, on };
      sync();
      props.persist(readSetup());
    }

    toggle.addEventListener("change", () =>
      write(Number.parseInt(input.value.slice(1), 16), toggle.checked),
    );
    // Picking a colour switches the tint on: reaching for the picker IS asking for it to paint the
    // car, and making that a second click would be a control that does nothing on first use.
    input.addEventListener("input", () => write(Number.parseInt(input.value.slice(1), 16), true));
    // Following the slot select matters only while the tint is off: the readout would otherwise
    // keep offering the colour of a slot this car no longer wears as its starting point.
    colorSel.addEventListener("change", sync);
    sync();
    return { el: h("div", { class: "pg-tint-row" }, [toggle, input, readout]), sync };
  }

  // -- the six seat sections -------------------------------------------------------------------
  // Both option lists are built once and reused across the six sections: `carOptions()` and
  // `weaponOptions()` walk their whole table on every call, and nothing in a section can change
  // what is in either.
  const cars = carOptions();
  const weapons = weaponOptions();

  const sections = PLAYGROUND_SEAT_IDS.map((seatId, seat) => {
    const car = props.initial.cars[seat]!;

    const enabledBox = h("input", {
      type: "checkbox",
      checked: car.enabled,
    }) as HTMLInputElement;
    const driveRadio = h("input", {
      type: "radio",
      name: "pg-drive",
      value: String(seat),
      checked: seat === props.initial.drivenSeat,
    }) as HTMLInputElement;

    const carSelect = selectFor(cars, car.carId);
    carSelect.classList.add("pg-car");
    const colorSel = colorSelect(car.colorId);
    const weaponSelects = car.weapons.map((w) => selectFor(weapons, w));
    const loadoutRow = h("div", { class: "pg-loadout" }, weaponSelects);
    const tint = tintPicker(seatId, colorSel);

    /** Writes this chassis's shipped kit into the three weapon selects (PG34), then runs the
     * ordinary edit path so the send and the persistence follow. Disabled for a chassis whose kit
     * is not three distinct weapons, so it can never build a loadout the validator would reject —
     * which is every unreleased prototype today, since they all carry `weapons: []`. */
    const restoreBtn = button({ class: "pg-restore" }, ["↺"], () => {
      const kit = shippedLoadoutOf(carSelect.value as CarId);
      if (!kit) return;
      weaponSelects.forEach((select, i) => {
        select.value = kit[i]!;
      });
      evaluate(true);
    });
    const syncRestore = (): void => {
      const carId = carSelect.value as CarId;
      const kit = shippedLoadoutOf(carId);
      restoreBtn.disabled = kit === undefined;
      restoreBtn.title = kit
        ? `Restore ${CAR_TABLE[carId].name}'s shipped loadout`
        : "This chassis has no three-weapon kit";
    };
    syncRestore();

    // Text and the `pg-seat-off` dimming are both `syncSeats`'s to paint; this only has to exist
    // before the first one runs.
    const headBtn = button({ class: "pg-fx-head" }, [], () => {
      if (open.has(seat)) open.delete(seat);
      else open.add(seat);
      syncSeats();
    });

    const body = h("div", { class: "pg-seat-body" }, [
      h("div", { class: "pg-row" }, [
        h("label", {}, ["Chassis"]),
        h("div", { class: "pg-car-row" }, [carSelect, colorSel, restoreBtn, tint.el]),
      ]),
      h("div", { class: "pg-row" }, [h("label", {}, ["Loadout"]), loadoutRow]),
    ]);

    enabledBox.addEventListener("change", () => {
      if (!enabledBox.checked) {
        // PG78: the wheel has to land somewhere, or `drivenSeat` would name a car that is not there.
        // `readSetup()` here already reflects the unchecked box — a `change` listener runs after the
        // flip — which `nextDrivenSeat` handles either way: this seat is no longer in `enabledSeats`,
        // so the `find` returns the lowest one that is. All six drive radios share one `name`, so
        // checking the new one unchecks this one for free.
        const next = nextDrivenSeat(readSetup(), seat);
        rows[next]!.drive.checked = true;
        open.delete(seat);
      } else {
        open.add(seat);
      }
      syncSeats();
      evaluate(true);
    });

    driveRadio.addEventListener("change", () => {
      // PG77: reaching for "drive this one" on a parked seat is asking for it to be on the field.
      // Making that a second click would be a control that does nothing on first use — the same
      // ruling the tint picker already carries for its own first pick.
      if (!enabledBox.checked) {
        enabledBox.checked = true;
        open.add(seat);
      }
      syncSeats();
      evaluate(true);
    });

    carSelect.addEventListener("change", () => {
      syncRestore();
      syncSeats();
      evaluate(true);
    });

    for (const select of [colorSel, ...weaponSelects]) {
      select.addEventListener("change", () => evaluate(true));
    }

    rows.push({
      enabled: enabledBox,
      drive: driveRadio,
      car: carSelect,
      color: colorSel,
      weapons: weaponSelects,
      loadoutRow,
      body,
      title: headBtn,
      syncTint: tint.sync,
    });

    return h("div", { class: "pg-fx-block" }, [
      h("div", { class: "pg-seat-head" }, [
        h("label", {}, [enabledBox, " On"]),
        headBtn,
        h("label", {}, [driveRadio, " Drive"]),
      ]),
      body,
    ]);
  });

  // -- shared control wiring -------------------------------------------------------------------
  for (const radio of [modeAlone, modeBot]) {
    radio.addEventListener("change", () => {
      syncDifficultyEnabled();
      evaluate(true);
    });
  }
  for (const select of [difficultySelect, arenaSelect]) {
    select.addEventListener("change", () => evaluate(true));
  }
  hitboxToggle.addEventListener("change", () => props.setShowHitboxes(hitboxToggle.checked));

  const el = h("div", { class: "pg-panel pg-settings" }, [
    h("div", { class: "pg-settings-header" }, [h("h2", {}, ["Car select"]), illegalHint, backBtn]),
    h("div", { class: "pg-row pg-mode" }, [
      h("label", {}, [modeAlone, " Play alone"]),
      h("label", {}, [modeBot, " Vs bot"]),
      difficultySelect,
    ]),
    h("div", { class: "pg-row" }, [h("label", {}, ["Arena"]), arenaSelect]),
    h("div", { class: "pg-row pg-view" }, [h("label", {}, [hitboxToggle, " Show hitboxes"])]),
    ...sections,
  ]);

  syncDifficultyEnabled();
  syncSeats();
  evaluate(false); // initial legality paint only — opening the panel must not itself send

  return { el, isIllegal: () => illegal };
}
