import type { Room } from "colyseus.js";
import type {
  CarId,
  PlaygroundCarSetup,
  PlaygroundSetup,
  PlaygroundState,
  PlayerState,
  TunableField,
  TuningOverrides,
  TuningValue,
  WeaponId,
} from "@motor-combat-moba/shared";
import {
  BOT_SESSION_ID,
  MSG_PLAYGROUND_PAUSE,
  MSG_PLAYGROUND_SETUP,
  MSG_PLAYGROUND_SWITCH,
  MSG_PLAYGROUND_TUNING,
  defaultPlaygroundSetup,
  isArenaId,
  isCarId,
  isWeaponId,
  sanitizeStoredTuning,
} from "@motor-combat-moba/shared";
import { button, h } from "../../ui/dom.js";
import { loadStored, saveStored } from "./storage.js";
import {
  arenaOptions,
  carOptions,
  isLoadoutLegal,
  pauseKeyAction,
  sliderGroups,
  weaponOptions,
  type OverlayView,
} from "./ui-model.js";

/**
 * Thin, untested DOM shell (spec PG16/PG19). Everything that decides WHAT to do lives in
 * `ui-model.ts`; this module only builds nodes, wires events, and talks to the room. It parents
 * straight into `document.body` — a sibling of the Phaser canvas, not a Phaser DOM element — because
 * it must survive `PlaygroundScene`'s own scene restarts (`onArenaChanged` stops/relaunches the
 * `arena` scene; this overlay is mounted once by `PlaygroundScene` and outlives that).
 */

const CSS = `
.pg-overlay {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  pointer-events: none;
  font-family: system-ui, sans-serif;
}
.pg-panel {
  pointer-events: auto;
  background: rgba(20, 22, 26, 0.95);
  color: #f0f0f0;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 20px 24px;
  min-width: 280px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}
.pg-panel h2 {
  margin: 0 0 12px;
  font-size: 18px;
}
.pg-panel button {
  display: block;
  width: 100%;
  margin: 6px 0;
  padding: 8px 12px;
  background: #2b2f36;
  color: #f0f0f0;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.pg-panel button:hover {
  background: #3a3f47;
}
.pg-panel button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pg-settings {
  min-width: 360px;
  max-height: 80vh;
  overflow-y: auto;
}
.pg-row {
  margin: 10px 0;
}
.pg-row > label {
  display: block;
  font-size: 12px;
  color: #aaa;
  margin-bottom: 3px;
}
.pg-row select {
  width: 100%;
  padding: 4px;
  background: #1c1e22;
  color: #f0f0f0;
  border: 1px solid #555;
  border-radius: 4px;
}
.pg-loadout {
  display: flex;
  gap: 6px;
}
.pg-loadout select {
  flex: 1;
}
.pg-loadout.pg-illegal {
  outline: 2px solid #d94040;
  border-radius: 4px;
}
.pg-mode label {
  display: inline-block;
  margin-right: 14px;
  font-size: 13px;
}
.pg-stats-toolbar {
  display: flex;
  gap: 8px;
  margin: 14px 0 6px;
}
.pg-stats-toolbar button {
  flex: 1;
  width: auto;
  margin: 0;
}
.pg-stat-group {
  margin-top: 10px;
  border-top: 1px solid #333;
  padding-top: 8px;
}
.pg-stat-group h3 {
  margin: 0 0 6px;
  font-size: 13px;
  color: #cfd3d8;
}
.pg-stat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0;
  font-size: 12px;
}
.pg-stat-row > label {
  flex: 0 0 auto;
  width: 40%;
  color: #aaa;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.pg-stat-row input[type="range"] {
  flex: 1;
  min-width: 0;
}
.pg-stat-row select {
  flex: 1;
  min-width: 0;
  padding: 2px;
  background: #1c1e22;
  color: #f0f0f0;
  border: 1px solid #555;
  border-radius: 4px;
}
.pg-stat-row .pg-value {
  flex: 0 0 auto;
  min-width: 3em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.pg-stat-row .pg-reset {
  flex: 0 0 auto;
  width: auto;
  margin: 0;
  padding: 2px 6px;
  font-size: 12px;
}
.pg-copy-fallback {
  width: 100%;
  min-height: 80px;
  margin-top: 6px;
  background: #1c1e22;
  color: #f0f0f0;
  border: 1px solid #555;
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
}
`;

/** Best-effort read of the currently-live setup off the room's schema, for seeding the settings
 * panel's controls when it opens. Falls back to `defaultPlaygroundSetup()` piece by piece when a
 * player row is not yet populated (a fresh join, mid-flight to the server) rather than crashing on
 * an empty `carId` or a short weapons array. */
function setupFromState(room: Room<PlaygroundState>): PlaygroundSetup {
  const fallback = defaultPlaygroundSetup();
  return {
    botEnabled: room.state.botEnabled,
    arenaId: isArenaId(room.state.arenaId) ? room.state.arenaId : fallback.arenaId,
    me: carSetupFromPlayer(room.state.players.get(room.sessionId), fallback.me),
    opponent: carSetupFromPlayer(room.state.players.get(BOT_SESSION_ID), fallback.opponent),
  };
}

function carSetupFromPlayer(
  player: PlayerState | undefined,
  fallback: PlaygroundCarSetup,
): PlaygroundCarSetup {
  const carId = player?.carId;
  if (!carId || !isCarId(carId)) return fallback;
  const weapons = player!.weapons.map((slot) => slot.weaponId);
  if (weapons.every(isWeaponId) && isLoadoutLegal(weapons)) {
    return { carId, weapons };
  }
  return { carId, weapons: fallback.weapons };
}

/** Best-effort read of the currently-active tuning off `PlaygroundState.tuningJson` (empty string
 * means "no overrides"), for seeding the Stats area's overrides map when settings opens. Runs the
 * same lenient `sanitizeStoredTuning` the localStorage path uses -- the server already validated this
 * blob before broadcasting it, but a mid-flight schema patch or an unparseable string is still
 * handled by falling back to `{}` rather than throwing while building the panel. */
function overridesFromState(room: Room<PlaygroundState>): TuningOverrides {
  const json = room.state.tuningJson;
  if (!json) return {};
  try {
    return sanitizeStoredTuning(JSON.parse(json));
  } catch {
    return {};
  }
}

function selectFor(
  options: { id: string; name: string }[],
  value: string,
): HTMLSelectElement {
  const select = h(
    "select",
    {},
    options.map((o) => h("option", { value: o.id }, [o.name])),
  );
  select.value = value;
  return select;
}

export function mountPlaygroundOverlay(
  room: Room<PlaygroundState>,
  onArenaChanged: () => void,
): () => void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = h("div", { class: "pg-overlay" });
  document.body.appendChild(root);

  let subView: "menu" | "settings" = "menu";
  let wasPaused = room.state.paused;
  let lastSentArenaId = isArenaId(room.state.arenaId)
    ? room.state.arenaId
    : defaultPlaygroundSetup().arenaId;
  /** Mirrors `backBtn.disabled` (set alongside it in `buildSettings`'s `evaluate`) so the P-key
   * "back-to-menu" action honours the same disabled-Back guard as the mouse: an illegal loadout must
   * trap the user in settings either way, not just when they're not reaching for the keyboard. */
  let settingsIllegal = false;
  /** Reassigned every `buildSettings()` call so it closes over that settings session's own overrides
   * map -- the single exit point for "leaving the settings view" (spec PG13/PG16), reached from both
   * the Back button's click and the P-key's "back-to-menu" action, so the tuning blob is sent exactly
   * once per exit rather than once per input event. The default here is never reached in practice
   * (`pauseKeyAction` only returns "back-to-menu" while `view === "settings"`, which requires
   * `buildSettings` to have already run and reassigned this), but keeps the binding safely typed. */
  let leaveSettings: () => void = () => {
    subView = "menu";
    render();
  };

  function effectiveView(): OverlayView {
    return room.state.paused ? subView : "hidden";
  }

  function render(): void {
    root.replaceChildren();
    const view = effectiveView();
    root.style.display = view === "hidden" ? "none" : "flex";
    if (view === "menu") root.appendChild(buildMenu());
    else if (view === "settings") root.appendChild(buildSettings());
  }

  function buildMenu(): HTMLElement {
    return h("div", { class: "pg-panel" }, [
      h("h2", {}, ["Paused"]),
      button({}, ["Resume"], () => room.send(MSG_PLAYGROUND_PAUSE)),
      button({}, ["Switch car"], () => room.send(MSG_PLAYGROUND_SWITCH)),
      button({}, ["Settings"], () => {
        subView = "settings";
        render();
      }),
    ]);
  }

  function buildSettings(): HTMLElement {
    const initial = setupFromState(room);

    const modeAlone = h("input", {
      type: "radio",
      name: "pg-mode",
      value: "alone",
      checked: !initial.botEnabled,
    });
    const modeBot = h("input", {
      type: "radio",
      name: "pg-mode",
      value: "bot",
      checked: initial.botEnabled,
    });

    const arenaOpts = arenaOptions().map((id) => ({ id, name: id }));
    const arenaSelect = selectFor(arenaOpts, initial.arenaId);

    const cars = carOptions();
    const meCarSelect = selectFor(cars, initial.me.carId);
    const oppCarSelect = selectFor(cars, initial.opponent.carId);

    const weapons = weaponOptions();
    const meWeaponSelects = initial.me.weapons.map((w) => selectFor(weapons, w));
    const oppWeaponSelects = initial.opponent.weapons.map((w) => selectFor(weapons, w));

    const meLoadoutRow = h("div", { class: "pg-loadout" }, meWeaponSelects);
    const oppLoadoutRow = h("div", { class: "pg-loadout" }, oppWeaponSelects);

    /** This settings session's own overrides map (spec PG13/PG14/PG20) -- holds ONLY entries that
     * differ from shipped, seeded from whatever tuning is currently live on the room. A slider drag
     * mutates this in place and re-saves to localStorage; nothing is sent to the server until the
     * user leaves the settings view (`leaveSettings` below), matching the session ruling that tuning
     * hot-applies on resume, not on every drag tick. */
    const overrides: Record<string, TuningValue> = { ...overridesFromState(room) };

    const backBtn = button({}, ["Back"], () => leaveSettings());

    /** Rebuilt from the live control values every single time, never from a cached draft — the
     * DOM the panel is currently showing IS the source of truth for what gets sent. */
    function readSetup(): PlaygroundSetup {
      return {
        botEnabled: modeBot.checked,
        arenaId: arenaSelect.value,
        me: {
          carId: meCarSelect.value as CarId,
          weapons: meWeaponSelects.map((s) => s.value) as [WeaponId, WeaponId, WeaponId],
        },
        opponent: {
          carId: oppCarSelect.value as CarId,
          weapons: oppWeaponSelects.map((s) => s.value) as [WeaponId, WeaponId, WeaponId],
        },
      };
    }

    /** Every change -- setup or overrides alike -- saves to localStorage (spec PG19), keyed off
     * whatever the controls currently show plus the current overrides map. */
    function persist(): void {
      saveStored({ setup: readSetup(), overrides: { ...overrides } });
    }

    /** Re-evaluates legality (always) and, when `send` is true and both loadouts are legal, ships
     * the rebuilt setup and fires `onArenaChanged` on top of an arena move. An illegal loadout never
     * reaches `room.send` — `isPlaygroundSetup` would reject it server-side anyway, silently. */
    function evaluate(send: boolean): void {
      const setup = readSetup();
      const meLegal = isLoadoutLegal(setup.me.weapons);
      const oppLegal = isLoadoutLegal(setup.opponent.weapons);
      meLoadoutRow.classList.toggle("pg-illegal", !meLegal);
      oppLoadoutRow.classList.toggle("pg-illegal", !oppLegal);
      backBtn.disabled = !meLegal || !oppLegal;
      settingsIllegal = backBtn.disabled;
      if (!send || !meLegal || !oppLegal) return;

      const arenaChanged = setup.arenaId !== lastSentArenaId;
      room.send(MSG_PLAYGROUND_SETUP, setup);
      persist();
      if (arenaChanged) {
        lastSentArenaId = setup.arenaId;
        onArenaChanged();
      }
    }

    const controls: (HTMLInputElement | HTMLSelectElement)[] = [
      modeAlone,
      modeBot,
      arenaSelect,
      meCarSelect,
      oppCarSelect,
      ...meWeaponSelects,
      ...oppWeaponSelects,
    ];
    for (const el of controls) el.addEventListener("change", () => evaluate(true));

    // The car/weapon selects also decide which sections `sliderGroups` draws (spec PG13) -- rebuild
    // the Stats area on exactly those, on top of the `evaluate(true)` every control already gets above.
    for (const el of [meCarSelect, oppCarSelect, ...meWeaponSelects, ...oppWeaponSelects]) {
      el.addEventListener("change", () => renderStats());
    }

    evaluate(false); // initial legality paint only -- opening the panel must not itself send

    const statsContainer = h("div", { class: "pg-stats" });

    /** One slider/checkbox/select row for `field`, wired straight into the shared `overrides` map:
     * the map holds an entry iff the control's live value differs from `field.shipped` (spec PG13),
     * and every edit re-paints the readout, re-saves (spec PG19), and leaves sending to
     * `leaveSettings`. */
    function fieldRow(field: TunableField): HTMLElement {
      const path = field.path;
      const hasOverride = Object.prototype.hasOwnProperty.call(overrides, path);
      const current = hasOverride ? overrides[path]! : field.shipped;

      let control: HTMLElement;
      let readValue: () => TuningValue;
      let applyValue: (value: TuningValue) => void;

      if (field.kind === "number") {
        const input = h("input", {
          type: "range",
          min: String(field.min!),
          max: String(field.max!),
          step: String(field.step!),
        }) as HTMLInputElement;
        input.value = String(current);
        control = input;
        readValue = () => Number(input.value);
        applyValue = (value) => {
          input.value = String(value);
        };
      } else if (field.kind === "boolean") {
        const input = h("input", { type: "checkbox", checked: Boolean(current) }) as HTMLInputElement;
        control = input;
        readValue = () => input.checked;
        applyValue = (value) => {
          input.checked = Boolean(value);
        };
      } else {
        const select = selectFor(
          (field.options ?? []).map((o) => ({ id: o, name: o })),
          String(current),
        );
        control = select;
        readValue = () => select.value;
        applyValue = (value) => {
          select.value = String(value);
        };
      }

      const valueSpan = h("span", { class: "pg-value" }, [String(current)]);

      function onEdit(): void {
        const value = readValue();
        if (value === field.shipped) delete overrides[path];
        else overrides[path] = value;
        valueSpan.textContent = String(value);
        persist();
      }
      control.addEventListener(field.kind === "number" ? "input" : "change", onEdit);

      const resetBtn = button({ class: "pg-reset", title: "Reset to shipped" }, ["↺"], () => {
        delete overrides[path];
        applyValue(field.shipped);
        valueSpan.textContent = String(field.shipped);
        persist();
      });

      return h("div", { class: "pg-row pg-stat-row" }, [
        h("label", { title: path }, [`${field.label} (shipped ${String(field.shipped)})`]),
        control,
        valueSpan,
        resetBtn,
      ]);
    }

    /** Rebuilds the whole Stats area from `sliderGroups(readSetup())` -- the section list depends on
     * which cars/weapons are currently selected (spec PG13), so this is called both once up front and
     * again whenever a car/weapon select changes. Never called mid-drag of a range input: that would
     * tear down the very element the pointer has captured. */
    function renderStats(): void {
      statsContainer.replaceChildren();
      for (const group of sliderGroups(readSetup())) {
        statsContainer.appendChild(
          h("div", { class: "pg-stat-group" }, [h("h3", {}, [group.title]), ...group.fields.map(fieldRow)]),
        );
      }
    }
    renderStats();

    const resetAllBtn = button({}, ["Reset all"], () => {
      for (const path of Object.keys(overrides)) delete overrides[path];
      persist();
      renderStats();
    });

    const copyBtn = button({}, ["Copy overrides"], () => {
      const json = JSON.stringify(overrides, null, 2);
      const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
      if (clipboard && typeof clipboard.writeText === "function") {
        void clipboard.writeText(json);
        return;
      }
      // No Clipboard API (older browser, insecure context) -- fall back to a selectable textarea plus
      // a console dump, so the JSON is still reachable by hand.
      console.log(json);
      const existing = statsContainer.parentElement?.querySelector(".pg-copy-fallback");
      existing?.remove();
      const ta = h("textarea", { class: "pg-copy-fallback", readonly: true }) as HTMLTextAreaElement;
      ta.value = json;
      statsContainer.before(ta);
      ta.select();
    });

    /** The single exit point for leaving the settings view (spec PG13/PG16): sends the current
     * overrides map exactly once (an empty map is a deliberate, valid reset-to-shipped send), saves
     * one last time, and returns to the menu. Guarded the same way the disabled Back button already
     * was -- an illegal loadout traps the user in settings regardless of how they tried to leave. */
    leaveSettings = () => {
      if (settingsIllegal) return;
      room.send(MSG_PLAYGROUND_TUNING, { ...overrides });
      persist();
      subView = "menu";
      render();
    };

    const row = (label: string, control: Node): HTMLElement =>
      h("div", { class: "pg-row" }, [h("label", {}, [label]), control]);

    return h("div", { class: "pg-panel pg-settings" }, [
      h("h2", {}, ["Settings"]),
      h("div", { class: "pg-row pg-mode" }, [
        h("label", {}, [modeAlone, " Play alone"]),
        h("label", {}, [modeBot, " Vs bot"]),
      ]),
      row("Arena", arenaSelect),
      row("My car", meCarSelect),
      row("My loadout", meLoadoutRow),
      row("Opponent car", oppCarSelect),
      row("Opponent loadout", oppLoadoutRow),
      h("div", { class: "pg-stats-toolbar" }, [resetAllBtn, copyBtn]),
      statsContainer,
      backBtn,
    ]);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return; // holding P must not machine-gun the pause toggle at OS repeat rate
    if (e.key !== "p" && e.key !== "P") return;
    const tag = (e.target as HTMLElement | null)?.tagName ?? "";
    const action = pauseKeyAction(effectiveView(), tag);
    if (action === "toggle") {
      room.send(MSG_PLAYGROUND_PAUSE);
    } else if (action === "back-to-menu") {
      // Same exit point the Back button's click uses -- `leaveSettings` itself re-checks
      // `settingsIllegal` (see its own comment), so P is not a side door out of settings while a
      // loadout is illegal, and the tuning blob is sent exactly once either way.
      leaveSettings();
    }
  }
  window.addEventListener("keydown", onKeyDown);

  function onState(): void {
    if (room.state.paused === wasPaused) return;
    wasPaused = room.state.paused;
    // Always land back on the menu next time the sim pauses -- the settings sub-view is local and
    // has no business surviving a resume (its own Back button is the only way out otherwise).
    if (!wasPaused) subView = "menu";
    render();
  }
  room.onStateChange(onState);

  render();

  return function unmount(): void {
    window.removeEventListener("keydown", onKeyDown);
    room.onStateChange.remove(onState);
    root.remove();
    style.remove();
  };
}
