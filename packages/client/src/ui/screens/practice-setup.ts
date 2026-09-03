import {
  CAR_TABLE,
  activeCarIds,
  type BotDifficulty,
  type PracticeOpponent,
  type PracticeSetup,
} from "@motor-combat-moba/shared";
import { button, h } from "../dom.js";

/**
 * The practice settings screen (spec PR21): pick my car, pick the opponent, pick a difficulty, then
 * Start or Back. Same three-part shape as `join.ts` — controls on one baseline, an error line under
 * them, a busy state that disables input — because a capacity refusal (PRACTICE_FULL_ERROR) is
 * exactly the kind of thing a player on a LAN actually hits, and this screen is where they read it.
 */

export interface SelectOption {
  value: string;
  label: string;
}

/** Active chassis only (PR15) — a car hidden from car select must not appear here either. */
export function carOptions(): SelectOption[] {
  return activeCarIds().map((id) => ({ value: id, label: CAR_TABLE[id].name }));
}

/** The opponent list: "Random" first, then the same active chassis (PR21). The server resolves it. */
export function opponentOptions(): SelectOption[] {
  return [{ value: "random", label: "Random" }, ...carOptions()];
}

export const DIFFICULTY_OPTIONS: readonly SelectOption[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

export interface PracticeSetupHandlers {
  onStart(setup: Omit<PracticeSetup, "name">): void;
  onBack(): void;
}

export interface PracticeSetupScreen {
  root: HTMLElement;
  setError(message: string): void;
  setBusy(busy: boolean): void;
}

const SELECT_STYLE = "min-height: 52px; font-size: 18px;";

/**
 * `value` is set AFTER the options are appended, not as an `h` attr: `h` assigns properties before
 * children exist, and a `<select>`'s value setter is a no-op against options that are not there yet.
 */
function select(id: string, options: readonly SelectOption[], selected: string): HTMLSelectElement {
  const el = h(
    "select",
    { class: "input", id, style: SELECT_STYLE },
    options.map((opt) => h("option", { value: opt.value }, [opt.label])),
  );
  el.value = selected;
  return el;
}

function field(labelText: string, control: HTMLElement): HTMLElement {
  const id = control.getAttribute("id") ?? undefined;
  return h("div", { class: "field", style: "width: 240px;" }, [
    h("label", { for: id }, [labelText]),
    control,
  ]);
}

export function renderPracticeSetup(
  handlers: PracticeSetupHandlers,
  initial: PracticeSetup,
): PracticeSetupScreen {
  const carSelect = select("practice-car", carOptions(), initial.carId);
  const opponentSelect = select("practice-opponent", opponentOptions(), initial.opponentCarId);
  const difficultySelect = select("practice-difficulty", DIFFICULTY_OPTIONS, initial.difficulty);

  const value = (): Omit<PracticeSetup, "name"> => ({
    carId: carSelect.value as PracticeSetup["carId"],
    opponentCarId: opponentSelect.value as PracticeOpponent,
    difficulty: difficultySelect.value as BotDifficulty,
  });

  const startButton = button(
    {
      class: "btn btn-primary",
      style: "min-height: 52px; font-size: 18px; padding-inline: 32px;",
    },
    ["Start"],
    () => handlers.onStart(value()),
  );

  const backButton = button(
    {
      class: "btn btn-secondary",
      style: "min-height: 52px; font-size: 18px; padding-inline: 28px;",
    },
    ["Back"],
    handlers.onBack,
  );

  const error = h("div", {
    style:
      "font-size: 14px; min-height: 20px; color: var(--color-accent-700); max-width: 480px;",
  });

  const root = h(
    "div",
    {
      style:
        "position: absolute; inset: 0; display: flex; flex-direction: column; " +
        "padding: 88px 80px; justify-content: center; gap: 26px;",
    },
    [
      h("h1", { style: "font-size: 64px; line-height: 0.95; margin: 0;" }, ["Practice"]),
      h(
        "p",
        {
          style:
            "font-size: 22px; line-height: 1.4; max-width: 480px; margin: 0; color: var(--color-neutral-800);",
        },
        ["Pick your car, pick an opponent, pick a difficulty."],
      ),
      h(
        "div",
        {
          style:
            "display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-top: 12px;",
        },
        [
          field("Your car", carSelect),
          field("Opponent", opponentSelect),
          field("Difficulty", difficultySelect),
        ],
      ),
      h(
        "div",
        { style: "display: flex; align-items: center; gap: 12px;" },
        [backButton, startButton],
      ),
      error,
    ],
  );

  return {
    root,
    setError: (message) => {
      error.textContent = message;
    },
    setBusy: (busy) => {
      startButton.disabled = busy;
      backButton.disabled = busy;
      carSelect.disabled = busy;
      opponentSelect.disabled = busy;
      difficultySelect.disabled = busy;
    },
  };
}
