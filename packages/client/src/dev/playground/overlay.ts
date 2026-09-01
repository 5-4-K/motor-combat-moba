import type { Room } from "colyseus.js";
import type {
  CarId,
  PlaygroundCarSetup,
  PlaygroundSetup,
  PlaygroundState,
  PlayerState,
  WeaponId,
} from "@motor-combat-moba/shared";
import {
  BOT_SESSION_ID,
  MSG_PLAYGROUND_PAUSE,
  MSG_PLAYGROUND_SETUP,
  MSG_PLAYGROUND_SWITCH,
  defaultPlaygroundSetup,
  isArenaId,
  isCarId,
  isWeaponId,
} from "@motor-combat-moba/shared";
import { button, h } from "../../ui/dom.js";
import {
  arenaOptions,
  carOptions,
  isLoadoutLegal,
  pauseKeyAction,
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

    const backBtn = button({}, ["Back"], () => {
      subView = "menu";
      render();
    });

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

    evaluate(false); // initial legality paint only -- opening the panel must not itself send

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
      // Same guard the disabled Back button enforces (see `settingsIllegal`'s comment) -- P must not
      // be a side door out of settings while a loadout is illegal.
      if (settingsIllegal) return;
      subView = "menu";
      render();
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
