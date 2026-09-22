import type { CarId, TunableField, TuningValue } from "@motor-combat-moba/shared";
import {
  CROSSHAIR_DISTANCE_KEY,
  TURRET_LENGTH_KEY,
  TURRET_VIEW_BOUNDS,
  carScaleKey,
  type TurretViewOverrides,
} from "../../scenes/turret-view.js";
import { CROSSHAIR_CONFIG } from "../../config/crosshair.js";
import { TURRET_VISUAL } from "../../config/turret-visual.js";
import { button, h } from "../../ui/dom.js";
import { stepperPair } from "./steppers.js";
import { clearTurretSimPaths, turretSimSections, type TurretSimSection } from "./turret-model.js";
import { stepInRange, type StepRange } from "./ui-model.js";

/**
 * The Turret settings panel (spec TR58–TR62). The untested DOM shell over `turret-model.ts`, built
 * in the markup the environment panel uses — collapsible `pg-fx-block` sections of `pg-stat-row`s —
 * so it is styled by the stylesheet `overlay.ts` already mounts.
 *
 * Two maps, edited in place, as every other panel edits its own:
 * - `sim` is the SAME tuning overrides map the Physics panel edits; this panel writes only its own
 *   paths into it (`turret.*`, `car.<id>.turretMount.*`), and it reaches the server on the way out
 *   (the overlay's `leaveSettings`), exactly as a Physics edit does.
 * - `view` is the client-only map `scenes/turret-view.ts` resolves; `ArenaScene` reads it every
 *   frame in a playground room, so crosshair and size edits show while the panel is still open.
 */
export interface TurretPanelOptions {
  readonly sim: Record<string, TuningValue>;
  readonly view: TurretViewOverrides;
  /** Save to localStorage. Called after every edit. */
  readonly persist: () => void;
  /** Copy the export to the clipboard. */
  readonly onCopy: () => void;
  /** Leave the panel (the overlay sends the tuning blob on the way). */
  readonly onBack: () => void;
}

interface RowSpec {
  readonly label: string;
  readonly title: string;
  readonly shipped: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly read: () => number | undefined;
  /** `undefined` drops the override. */
  readonly write: (value: number | undefined) => void;
}

function format(value: number): string {
  return String(Number(value.toPrecision(12)));
}

export function buildTurretPanel(opts: TurretPanelOptions): HTMLElement {
  /** Which block is open. The global knobs open first: they are what a feel test reaches for. */
  let expanded: string | undefined = "global";
  const body = h("div", { class: "pg-stats" });

  /**
   * One slider row. Within half a step of shipped counts as shipped and drops the override — the
   * Physics panel's `isAtShipped` rule, for the same off-grid reason. Never re-renders the panel on
   * input: a range input fires per pointer move, and replacing it mid-drag strands the pointer.
   */
  function numberRow(spec: RowSpec, refreshHeader: () => void): HTMLElement {
    const value = spec.read() ?? spec.shipped;
    const readout = h("span", { class: "pg-value" }, [format(value)]);
    const input = h("input", {
      type: "range",
      min: String(spec.min),
      max: String(spec.max),
      step: String(spec.step),
    }) as HTMLInputElement;
    input.value = String(value);

    function snapToShipped(): void {
      spec.write(undefined);
      input.value = String(spec.shipped);
      readout.textContent = format(spec.shipped);
    }

    function commit(next: number): void {
      if (Math.abs(next - spec.shipped) < spec.step / 2) snapToShipped();
      else {
        spec.write(next);
        readout.textContent = format(next);
      }
      opts.persist();
      refreshHeader();
    }
    input.addEventListener("input", () => commit(Number(input.value)));

    const steppers = stepperPair((direction) => {
      input.value = String(stepInRange(spec, Number(input.value), direction));
      commit(Number(input.value));
    });
    const resetBtn = button({ class: "pg-reset", title: "Reset to shipped" }, ["↺"], () => {
      snapToShipped();
      opts.persist();
      refreshHeader();
    });

    return h("div", { class: "pg-row pg-stat-row" }, [
      h("label", { title: spec.title }, [`${spec.label} (shipped ${format(spec.shipped)})`]),
      steppers[0],
      input,
      steppers[1],
      readout,
      resetBtn,
    ]);
  }

  function simRow(field: TunableField, label: string): RowSpec {
    return {
      label,
      title: `${field.path} — reaches the server when you leave this panel`,
      shipped: field.shipped as number,
      min: field.min!,
      max: field.max!,
      step: field.step!,
      read: () => {
        const v = opts.sim[field.path];
        return typeof v === "number" ? v : undefined;
      },
      write: (v) => {
        if (v === undefined) delete opts.sim[field.path];
        else opts.sim[field.path] = v;
      },
    };
  }

  function viewRow(key: string, label: string, shipped: number, bounds: StepRange): RowSpec {
    return {
      label,
      title: `${key} — client-only, live`,
      shipped,
      min: bounds.min,
      max: bounds.max,
      step: bounds.step,
      read: () => opts.view[key],
      write: (v) => {
        if (v === undefined) delete opts.view[key];
        else opts.view[key] = v;
      },
    };
  }

  const SIM_LABELS: Readonly<Record<string, string>> = {
    turnRateDegPerSec: "turn rate (deg/s)",
    maxSwingDeg: "swing arc (deg)",
    "turretMount.x": "mount x (forward)",
    "turretMount.y": "mount y (side)",
  };

  /** The block's rows, and how many of them are overridden right now. */
  function blockRows(section: TurretSimSection | "drawing"): RowSpec[] {
    if (section === "drawing") {
      return [
        viewRow(CROSSHAIR_DISTANCE_KEY, "crosshair max distance", CROSSHAIR_CONFIG.maxDistance, TURRET_VIEW_BOUNDS.crosshairMaxDistance),
        viewRow(TURRET_LENGTH_KEY, "turret length (all cars)", TURRET_VISUAL.lengthUnits, TURRET_VIEW_BOUNDS.lengthUnits),
      ];
    }
    const rows = section.fields.map((f) => simRow(f, SIM_LABELS[f.label] ?? f.label));
    if (section.carId !== undefined) {
      rows.push(viewRow(carScaleKey(section.carId), "turret size (x global length)", 1, TURRET_VIEW_BOUNDS.carScale));
    }
    return rows;
  }

  function block(id: string, title: string, rows: RowSpec[]): HTMLElement {
    const isOpen = expanded === id;
    const label = (): string => {
      const n = rows.filter((r) => r.read() !== undefined).length;
      return `${title} — ${n === 0 ? "shipped" : `${n} changed`}`;
    };
    const header = button({ class: "pg-fx-head" }, [label()], () => {
      expanded = isOpen ? undefined : id;
      renderBody();
    });
    const refreshHeader = (): void => {
      header.textContent = label();
    };
    const resetBlock = (): void => {
      for (const row of rows) row.write(undefined);
      opts.persist();
      renderBody();
    };
    const headRow = h("div", { class: "pg-fx-headrow" }, [
      header,
      button({ class: "pg-reset", title: `Reset ${title} to shipped` }, ["↺"], resetBlock),
    ]);
    return h("div", { class: "pg-fx-block" }, [
      headRow,
      ...(isOpen ? rows.map((row) => numberRow(row, refreshHeader)) : []),
    ]);
  }

  function renderBody(): void {
    const sections = turretSimSections();
    const [global, ...cars] = sections;
    body.replaceChildren(
      block("global", "Turret (sim)", blockRows(global!)),
      block("drawing", "Crosshair & turret drawing", blockRows("drawing")),
      ...cars.map((section) =>
        block(
          section.carId as CarId,
          `${section.title}${section.inactive ? " (inactive)" : ""}`,
          blockRows(section),
        ),
      ),
    );
  }

  /** Every turret knob back to shipped: this panel's sim paths (the Physics panel's stay) and the
   * whole client map. */
  const resetAll = (): void => {
    clearTurretSimPaths(opts.sim);
    for (const key of Object.keys(opts.view)) delete opts.view[key];
    opts.persist();
    renderBody();
  };

  renderBody();

  return h("div", { class: "pg-panel pg-settings pg-env" }, [
    h("div", { class: "pg-settings-header" }, [h("h2", {}, ["Turret settings"]), button({}, ["Back"], opts.onBack)]),
    h("div", { class: "pg-stats-toolbar" }, [
      button({}, ["Reset all"], resetAll),
      button({}, ["Copy export"], opts.onCopy),
    ]),
    h("div", { class: "pg-tab-empty" }, [
      "Turn rate, swing and mounts reach the server when you leave this panel. Crosshair and turret size are live.",
    ]),
    body,
  ]);
}
