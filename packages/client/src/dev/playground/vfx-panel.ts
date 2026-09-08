import type { FxChannel } from "../../fx/table.js";
import {
  FX_CHANNELS,
  FX_FIELDS,
  FX_PHASES,
  burstFor,
  fromControl,
  fxCellsFor,
  fxKey,
  isFxAtShipped,
  shippedBurstFor,
  toControl,
  type FxFieldDef,
  type FxOverrides,
  type FxPhase,
} from "../../fx/tuning.js";
import { button, h } from "../../ui/dom.js";
import { weaponOptions } from "./ui-model.js";

/**
 * The VFX settings panel (spec PG48).
 *
 * A DOM shell like `overlay.ts`, and untested for the same reason — every decision it makes comes
 * from `fx/tuning.ts`, which is tested. Its own job is nodes, events, and calling back.
 *
 * One weapon renders at a time. Eight cells of eight controls is already ~64 controls; ten weapons
 * at once would be 640, and a full rebuild on every slider input.
 */

export interface VfxPanelOptions {
  /** The live map. Mutated in place, exactly as the physics panel mutates its own `overrides`. */
  readonly overrides: FxOverrides;
  /** Save to localStorage. Called after every edit (spec PG19's rule, applied here). */
  readonly persist: () => void;
  /** Replay what is currently selected. Called after every edit and by the Fire button. */
  readonly preview: (weaponId: string, phase: FxPhase, channel: FxChannel | "all") => void;
  /** Leave the panel. Clears the replay timer and returns to the menu. */
  readonly onBack: () => void;
  /** Copy the export to the clipboard (Task 9). */
  readonly onCopy: () => void;
}

/** How a collapsed channel block states its own condition, so a weapon's shape reads at a glance. */
function channelSummary(count: number): string {
  return count > 0 ? `${count} ×` : "off";
}

export function buildVfxPanel(opts: VfxPanelOptions): HTMLElement {
  const weapons = weaponOptions();
  let weaponId: string = weapons[0]!.id;
  /** Which block is expanded, or `undefined` for none. Narrows the preview to that channel. */
  let expanded: { phase: FxPhase; channel: FxChannel } | undefined;

  const body = h("div", { class: "pg-stats" });

  const weaponSelect = h("select", {}, weapons.map((w) => h("option", { value: w.id }, [w.name])));
  weaponSelect.value = weaponId;
  weaponSelect.addEventListener("change", () => {
    weaponId = weaponSelect.value;
    expanded = undefined;
    renderBody();
    fire();
  });

  function fire(): void {
    if (expanded) opts.preview(weaponId, expanded.phase, expanded.channel);
    else for (const phase of FX_PHASES) opts.preview(weaponId, phase, "all");
  }

  /** One slider (or checkbox) for one field of one cell, wired straight into the overrides map. */
  function fieldRow(phase: FxPhase, channel: FxChannel, field: FxFieldDef): HTMLElement {
    const key = fxKey(weaponId, phase, channel, field.name);
    const shipped = shippedBurstFor(weaponId, phase, channel)[field.name];
    const current = burstFor(weaponId, phase, channel, opts.overrides)[field.name];

    const shippedControl =
      field.kind === "number" ? toControl(field, shipped as number) : (shipped as boolean);
    const currentControl =
      field.kind === "number" ? toControl(field, current as number) : (current as boolean);

    const valueSpan = h("span", { class: "pg-value" }, [readout(field, currentControl)]);

    let control: HTMLInputElement;
    let read: () => number | boolean;

    if (field.kind === "number") {
      control = h("input", {
        type: "range",
        min: String(field.min),
        max: String(field.max),
        step: String(field.step),
      }) as HTMLInputElement;
      control.value = String(currentControl);
      read = () => Number(control.value);
    } else {
      control = h("input", { type: "checkbox", checked: Boolean(currentControl) }) as HTMLInputElement;
      read = () => control.checked;
      // PG50: rendered on every row so the grid stays rectangular, live on smoke alone. An inert
      // control that looks live is worse than one that plainly is not.
      control.disabled = field.smokeOnly && channel !== "smoke";
    }

    function snapToShipped(): void {
      delete opts.overrides[key];
      control.value = String(shippedControl);
      if (field.kind === "boolean") control.checked = Boolean(shippedControl);
      valueSpan.textContent = readout(field, shippedControl);
    }

    function onEdit(): void {
      const value = read();
      if (isFxAtShipped(field, value, shippedControl)) {
        snapToShipped();
      } else {
        opts.overrides[key] = field.kind === "number" ? fromControl(field, value as number) : value;
        valueSpan.textContent = readout(field, value);
      }
      opts.persist();
      // The `count` field changes whether the cell fires at all, so its header summary goes stale.
      if (field.name === "count") renderBody();
      fire();
    }

    control.addEventListener(field.kind === "number" ? "input" : "change", onEdit);

    return h("div", { class: "pg-row pg-stat-row" }, [
      h("label", { title: key }, [`${field.label} (shipped ${readout(field, shippedControl)})`]),
      control,
      valueSpan,
      button({ class: "pg-reset", title: "Reset to shipped" }, ["↺"], () => {
        snapToShipped();
        opts.persist();
        if (field.name === "count") renderBody();
        fire();
      }),
    ]);
  }

  function readout(field: FxFieldDef, value: number | boolean): string {
    if (typeof value === "boolean") return value ? "on" : "off";
    const rounded = field.step < 1 ? value.toFixed(2) : String(Math.round(value));
    return field.degrees ? `${rounded}°` : rounded;
  }

  function channelBlock(phase: FxPhase, channel: FxChannel): HTMLElement {
    const cell = fxCellsFor(weaponId, opts.overrides).find(
      (c) => c.phase === phase && c.channel === channel,
    )!;
    const isOpen = expanded?.phase === phase && expanded.channel === channel;

    const header = button({ class: "pg-fx-head" }, [`${channel} — ${channelSummary(cell.current.count)}`], () => {
      expanded = isOpen ? undefined : { phase, channel };
      renderBody();
      fire();
    });

    const rows = isOpen ? FX_FIELDS.map((field) => fieldRow(phase, channel, field)) : [];
    return h("div", { class: "pg-fx-block" }, [header, ...rows]);
  }

  function renderBody(): void {
    body.replaceChildren(
      ...FX_PHASES.flatMap((phase) => [
        h("div", { class: "pg-fx-phase" }, [phase]),
        ...FX_CHANNELS.map((channel) => channelBlock(phase, channel)),
      ]),
    );
  }

  const resetAllBtn = button({}, ["Reset all"], () => {
    for (const key of Object.keys(opts.overrides)) delete opts.overrides[key];
    opts.persist();
    renderBody();
    fire();
  });

  renderBody();

  return h("div", { class: "pg-panel pg-settings pg-vfx" }, [
    h("div", { class: "pg-settings-header" }, [
      h("h2", {}, ["VFX settings"]),
      button({}, ["Back"], () => opts.onBack()),
    ]),
    h("div", { class: "pg-row" }, [h("label", {}, ["Weapon"]), weaponSelect]),
    h("div", { class: "pg-stats-toolbar" }, [
      resetAllBtn,
      button({}, ["Copy overrides"], () => opts.onCopy()),
      button({}, ["Fire"], () => fire()),
    ]),
    body,
  ]);
}
