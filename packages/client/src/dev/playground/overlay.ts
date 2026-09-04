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
  CAR_TABLE,
  COLOR_TABLE,
  MSG_PLAYGROUND_BOT_DEBUG,
  MSG_PLAYGROUND_PAUSE,
  MSG_PLAYGROUND_SETUP,
  MSG_PLAYGROUND_SWITCH,
  MSG_PLAYGROUND_TUNING,
  defaultPlaygroundSetup,
  isArenaId,
  isBotDebugPayload,
  isBotDifficulty,
  isCarId,
  isColorId,
  isWeaponId,
  sanitizeStoredTuning,
} from "@motor-combat-moba/shared";
import { button, h } from "../../ui/dom.js";
import { loadStored, saveStored } from "./storage.js";
import { setShowHitboxes, showHitboxes } from "../../config/view-options.js";
import {
  arenaOptions,
  canStep,
  carOptions,
  isAtShipped,
  isLoadoutLegal,
  pauseKeyAction,
  shippedLoadoutOf,
  statsTabs,
  steppedValue,
  weaponOptions,
  type OverlayView,
  type StatsTabKey,
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
  min-width: 420px;
  max-height: 80vh;
  overflow-y: auto;
}
.pg-settings-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: -20px -24px 12px;
  padding: 16px 24px 10px;
  background: rgba(20, 22, 26, 0.98);
  border-bottom: 1px solid #333;
}
.pg-settings-header h2 {
  margin: 0;
}
.pg-settings-header button {
  width: auto;
  margin: 0;
  padding: 6px 16px;
}
.pg-illegal-hint {
  margin-left: auto;
  margin-right: 10px;
  font-size: 11px;
  color: #d94040;
}
.pg-car-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.pg-car-row select.pg-car {
  flex: 2;
  min-width: 0;
}
.pg-car-row select.pg-color {
  flex: 1;
  min-width: 0;
}
.pg-car-row button {
  flex: 0 0 auto;
  width: auto;
  margin: 0;
  padding: 4px 9px;
}
.pg-difficulty {
  margin-left: 10px;
  padding: 2px 4px;
  background: #1c1e22;
  color: #f0f0f0;
  border: 1px solid #555;
  border-radius: 4px;
}
.pg-difficulty:disabled {
  opacity: 0.4;
}
.pg-bot-debug {
  position: fixed;
  top: 12px;
  right: 16px;
  z-index: 999;
  pointer-events: none;
  font-family: monospace;
  font-size: 12px;
  color: #9aa0a6;
  background: rgba(20, 22, 26, 0.85);
  border: 1px solid #444;
  border-radius: 4px;
  padding: 4px 8px;
  text-align: right;
  white-space: pre;
  line-height: 1.4;
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
.pg-tabs {
  display: flex;
  gap: 6px;
  margin: 14px 0 4px;
  border-bottom: 1px solid #333;
}
.pg-tabs button {
  flex: 1;
  width: auto;
  margin: 0;
  border-radius: 4px 4px 0 0;
  border-bottom: none;
  font-size: 13px;
}
.pg-tabs button.pg-tab-active {
  background: #3a4048;
  color: #ffffff;
}
.pg-tab-empty {
  margin: 10px 0;
  font-size: 12px;
  color: #6f757c;
}
.pg-stat-row .pg-step {
  flex: 0 0 auto;
  width: auto;
  margin: 0;
  padding: 1px 6px;
  font-size: 12px;
  line-height: 1.2;
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
    botDifficulty: isBotDifficulty(room.state.botDifficulty)
      ? room.state.botDifficulty
      : fallback.botDifficulty,
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
  const colorId = isColorId(player!.colorId) ? player!.colorId : fallback.colorId;
  const weapons = player!.weapons.map((slot) => slot.weaponId);
  if (weapons.every(isWeaponId) && isLoadoutLegal(weapons)) {
    return { carId, colorId, weapons };
  }
  return { carId, colorId, weapons: fallback.weapons };
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

/** The six player colours, by name, for a car's colour select (PG31). Both cars may pick the same
 * one — there is deliberately no guard here or on the wire. */
function colorSelect(value: number): HTMLSelectElement {
  const select = selectFor(
    COLOR_TABLE.map((color) => ({ id: String(color.colorId), name: color.name })),
    String(value),
  );
  select.classList.add("pg-color");
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

  // Always on, independent of `root`'s pause-gated visibility above (H12): the bot only decides, and
  // `PlaygroundRoom` only broadcasts, while the sim is running -- a read-out that only showed while
  // paused would never show anything, since pausing is exactly what stops the ticks it reports on.
  const debugEl = h("div", { class: "pg-bot-debug" }, ["bot: off"]);
  document.body.appendChild(debugEl);
  const unbindDebug = room.onMessage(MSG_PLAYGROUND_BOT_DEBUG, (payload: unknown) => {
    if (!isBotDebugPayload(payload)) return;
    // Second line: the goal scoreboard (H12 / G9). The whole reason goals are SCORED rather than
    // picked by an if-ladder is that the losing options stay visible — "it dumped because dump beat
    // setupCc 12 to 9" is a different kind of answer from "it dumped". Sorted best-first with the
    // chosen goal marked, so the top-left of the line is the decision and the rest is the case
    // against it; goals the scorer took off the table (`-Infinity`) never arrive and are simply
    // absent. `textContent` on a `white-space: pre` element, so no markup and no escaping question.
    const scores = Object.entries(payload.goalScores)
      .sort((a, b) => b[1] - a[1])
      .map(([goal, score]) => `${goal === payload.goal ? "*" : ""}${goal} ${score}`)
      .join("  ");
    debugEl.textContent =
      `${payload.personality} | ${payload.goal} | range ${payload.preferredRange}` +
      ` | slot ${payload.firedSlot < 0 ? "-" : payload.firedSlot + 1}` +
      (scores === "" ? "" : `\n${scores}`);
  });

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
    meCarSelect.classList.add("pg-car");
    oppCarSelect.classList.add("pg-car");

    const meColorSelect = colorSelect(initial.me.colorId);
    const oppColorSelect = colorSelect(initial.opponent.colorId);

    const difficultySelect = selectFor(
      [
        { id: "easy", name: "Easy" },
        { id: "medium", name: "Medium" },
        { id: "hard", name: "Hard" },
      ],
      initial.botDifficulty,
    );
    difficultySelect.classList.add("pg-difficulty");
    // Meaningless while the other car is a target dummy, and saying so with the control itself is
    // clearer than leaving a live select that changes nothing.
    const syncDifficultyEnabled = (): void => {
      difficultySelect.disabled = !modeBot.checked;
    };
    syncDifficultyEnabled();
    for (const el of [modeAlone, modeBot]) {
      el.addEventListener("change", syncDifficultyEnabled);
    }

    /**
     * Outline what the sim actually collides with: each car's OBB, and every live weapon
     * instance's own hitbox.
     *
     * Applied on the spot rather than on leaving settings, unlike every control above it. Those
     * send a setup or a tuning override to the server, which is why they batch until `leaveSettings`
     * — this one changes nothing but what this browser paints, so making it wait would be a delay
     * with no reason behind it. It reads back from `showHitboxes()` rather than from storage so the
     * checkbox always shows what the arena is actually doing.
     */
    const hitboxToggle = h("input", {
      type: "checkbox",
      checked: showHitboxes(),
    }) as HTMLInputElement;
    hitboxToggle.addEventListener("change", () => {
      setShowHitboxes(hitboxToggle.checked);
      persist();
    });

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
        botDifficulty: isBotDifficulty(difficultySelect.value) ? difficultySelect.value : "medium",
        arenaId: arenaSelect.value,
        me: {
          carId: meCarSelect.value as CarId,
          colorId: Number(meColorSelect.value),
          weapons: meWeaponSelects.map((s) => s.value) as [WeaponId, WeaponId, WeaponId],
        },
        opponent: {
          carId: oppCarSelect.value as CarId,
          colorId: Number(oppColorSelect.value),
          weapons: oppWeaponSelects.map((s) => s.value) as [WeaponId, WeaponId, WeaponId],
        },
      };
    }

    /** Every change -- setup or overrides alike -- saves to localStorage (spec PG19), keyed off
     * whatever the controls currently show plus the current overrides map. */
    function persist(): void {
      saveStored({
        setup: readSetup(),
        overrides: { ...overrides },
        view: { showHitbox: hitboxToggle.checked },
      });
    }

    /** Re-evaluates legality (always) — toggling both loadout rows' `pg-illegal` class and
     * `illegalHint`'s visibility to match, and disabling `backBtn` while either is illegal — and,
     * when `send` is true and both loadouts are legal, ships the rebuilt setup and fires
     * `onArenaChanged` on top of an arena move. An illegal loadout never reaches `room.send` —
     * `isPlaygroundSetup` would reject it server-side anyway, silently. */
    function evaluate(send: boolean): void {
      const setup = readSetup();
      const meLegal = isLoadoutLegal(setup.me.weapons);
      const oppLegal = isLoadoutLegal(setup.opponent.weapons);
      meLoadoutRow.classList.toggle("pg-illegal", !meLegal);
      oppLoadoutRow.classList.toggle("pg-illegal", !oppLegal);
      backBtn.disabled = !meLegal || !oppLegal;
      settingsIllegal = backBtn.disabled;
      illegalHint.hidden = !backBtn.disabled;
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
      meColorSelect,
      oppColorSelect,
      difficultySelect,
      ...meWeaponSelects,
      ...oppWeaponSelects,
    ];
    for (const el of controls) el.addEventListener("change", () => evaluate(true));

    // The car/weapon selects also decide which sections `statsTabs` draws (spec PG13) -- rebuild
    // the Stats area on exactly those, on top of the `evaluate(true)` every control already gets above.
    for (const el of [meCarSelect, oppCarSelect, ...meWeaponSelects, ...oppWeaponSelects]) {
      el.addEventListener("change", () => renderStats());
    }

    const statsContainer = h("div", { class: "pg-stats" });

    /** Which stats tab is showing (PG35). Local to this settings session and NOT persisted: it opens
     * on Global every time, and `renderStats` preserves it across a car/weapon change. */
    let activeTab: StatsTabKey = "global";
    const tabBar = h("div", { class: "pg-tabs" });

    /** One slider/checkbox/select row for `field`, wired straight into the shared `overrides` map:
     * the map holds an entry iff the control's live value differs from `field.shipped` by more than
     * `isAtShipped`'s tolerance (spec PG13) -- exact `===` is not enough, because a range input snaps
     * to its `step` grid and `shipped` itself very often does not land on that grid (see
     * `isAtShipped`'s own comment in `ui-model.ts`), which would leave a phantom override every time
     * the user dragged a slider all the way back to its shipped position. Every edit re-paints the
     * readout, re-saves (spec PG19), and leaves sending to `leaveSettings`. */
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

      /** Drops the override, snaps the control AND the readout to the exact shipped number (not
       * whatever off-grid value the control happened to be showing), and saves. Shared by a drag that
       * lands within tolerance of shipped and by the row's own reset button. */
      function snapToShipped(): void {
        delete overrides[path];
        applyValue(field.shipped);
        valueSpan.textContent = String(field.shipped);
      }

      function onEdit(): void {
        const value = readValue();
        if (isAtShipped(field, value)) {
          snapToShipped();
        } else {
          overrides[path] = value;
          valueSpan.textContent = String(value);
        }
        persist();
      }
      control.addEventListener(field.kind === "number" ? "input" : "change", onEdit);

      /** Nudge by one `field.step`, clamped, then run the ordinary edit path (PG36) so the
       * `isAtShipped` tolerance, the readout and the localStorage save all behave as a drag's do.
       * Reads the control's CURRENT value — already snapped by the browser to the min/step grid —
       * rather than tracking a float here, which is what makes up-then-down a round trip. */
      function stepBy(direction: 1 | -1): void {
        const value = readValue();
        if (typeof value !== "number") return;
        applyValue(steppedValue(field, value, direction));
        onEdit();
      }

      const steppers = canStep(field)
        ? [
            button({ class: "pg-step", title: "One step down" }, ["−"], () => stepBy(-1)),
            button({ class: "pg-step", title: "One step up" }, ["+"], () => stepBy(1)),
          ]
        : [];

      const resetBtn = button({ class: "pg-reset", title: "Reset to shipped" }, ["↺"], () => {
        snapToShipped();
        persist();
      });

      return h("div", { class: "pg-row pg-stat-row" }, [
        h("label", { title: path }, [`${field.label} (shipped ${String(field.shipped)})`]),
        steppers[0] ?? null,
        control,
        steppers[1] ?? null,
        valueSpan,
        resetBtn,
      ]);
    }

    /** Rebuilds the tab bar and the active tab's rows from `statsTabs(readSetup())` — the sections
     * depend on which cars/weapons are selected (PG13/PG35), so this runs once up front and again
     * whenever a car or weapon select changes. Never called mid-drag of a range input: that would
     * tear down the element the pointer has captured. */
    function renderStats(): void {
      const tabs = statsTabs(readSetup());

      tabBar.replaceChildren();
      for (const tab of tabs) {
        const btn = button({ class: tab.key === activeTab ? "pg-tab-active" : "" }, [tab.title], () => {
          activeTab = tab.key;
          renderStats();
        });
        tabBar.appendChild(btn);
      }

      statsContainer.replaceChildren();
      const current = tabs.find((tab) => tab.key === activeTab) ?? tabs[0]!;
      if (current.groups.length === 0) {
        statsContainer.appendChild(h("div", { class: "pg-tab-empty" }, ["Nothing selected."]));
        return;
      }
      for (const group of current.groups) {
        statsContainer.appendChild(
          h("div", { class: "pg-stat-group" }, [
            h("h3", {}, [group.title]),
            ...group.fields.map(fieldRow),
          ]),
        );
      }
    }
    renderStats();

    /** Writes a chassis's shipped kit into one car's three weapon selects (PG34), then runs the
     * ordinary edit path so the send, the persistence and the stats sections all follow. Disabled
     * for a chassis whose kit is not three distinct weapons, so it can never build a loadout the
     * validator would reject. */
    function restoreButton(
      carSelect: HTMLSelectElement,
      weaponSelects: HTMLSelectElement[],
    ): HTMLButtonElement {
      const btn = button({ class: "pg-restore" }, ["↺"], () => {
        const kit = shippedLoadoutOf(carSelect.value as CarId);
        if (!kit) return;
        weaponSelects.forEach((select, i) => {
          select.value = kit[i]!;
        });
        evaluate(true);
        renderStats();
      });
      const sync = (): void => {
        const carId = carSelect.value as CarId;
        const kit = shippedLoadoutOf(carId);
        btn.disabled = kit === undefined;
        btn.title = kit
          ? `Restore ${CAR_TABLE[carId].name}'s shipped loadout`
          : "This chassis has no three-weapon kit";
      };
      sync();
      carSelect.addEventListener("change", sync);
      return btn;
    }

    const meRestoreBtn = restoreButton(meCarSelect, meWeaponSelects);
    const oppRestoreBtn = restoreButton(oppCarSelect, oppWeaponSelects);

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

    const illegalHint = h("span", { class: "pg-illegal-hint" }, ["duplicate weapon in a loadout"]);
    illegalHint.hidden = true; // avoid a flash before the first `evaluate` paints its real state

    // Deferred to here (rather than sitting where the controls are wired, above) because `evaluate`
    // now touches `illegalHint`: calling it any earlier -- before this `const` has run -- would read
    // the binding in its temporal dead zone and throw every time the panel opens.
    evaluate(false); // initial legality paint only -- opening the panel must not itself send

    const carRow = (
      label: string,
      carSelect: HTMLSelectElement,
      colorSel: HTMLSelectElement,
      restoreBtn: HTMLButtonElement,
    ): HTMLElement =>
      h("div", { class: "pg-row" }, [
        h("label", {}, [label]),
        h("div", { class: "pg-car-row" }, [carSelect, colorSel, restoreBtn]),
      ]);

    return h("div", { class: "pg-panel pg-settings" }, [
      h("div", { class: "pg-settings-header" }, [h("h2", {}, ["Settings"]), illegalHint, backBtn]),
      h("div", { class: "pg-row pg-mode" }, [
        h("label", {}, [modeAlone, " Play alone"]),
        h("label", {}, [modeBot, " Vs bot"]),
        difficultySelect,
      ]),
      row("Arena", arenaSelect),
      carRow("My car", meCarSelect, meColorSelect, meRestoreBtn),
      row("My loadout", meLoadoutRow),
      carRow("Opponent car", oppCarSelect, oppColorSelect, oppRestoreBtn),
      row("Opponent loadout", oppLoadoutRow),
      h("div", { class: "pg-row pg-view" }, [
        h("label", {}, [hitboxToggle, " Show hitboxes"]),
      ]),
      h("div", { class: "pg-stats-toolbar" }, [resetAllBtn, copyBtn]),
      tabBar,
      statsContainer,
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
    if (typeof unbindDebug === "function") unbindDebug();
    root.remove();
    debugEl.remove();
    style.remove();
  };
}
