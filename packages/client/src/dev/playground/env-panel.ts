import {
  ENV_FIELDS,
  envKey,
  isEnvAtShipped,
  shippedEnvValue,
  type EnvFieldDef,
  type EnvOverrides,
  type EnvSection,
} from "../../fx/env-tuning.js";
import { button, h } from "../../ui/dom.js";
import { stepperPair } from "./steppers.js";
import { stepInRange } from "./ui-model.js";

/**
 * The environment settings panel (spec EV31).
 *
 * Sections are ordered by how often they are reached for, not alphabetically: the grade and the
 * vignette are the two things VFX27 calls "a large fraction of what reads as gritty", and the floor
 * and markings are the ones nobody retunes twice in a session.
 */
const SECTION_ORDER: readonly EnvSection[] = [
  "grade",
  "vignette",
  "shake",
  "hitStop",
  "decals",
  "occlusion",
  "lava",
  "floor",
  "markings",
  "carBursts",
];

const SECTION_LABELS: Record<EnvSection, string> = {
  grade: "Colour grade",
  vignette: "Vignette",
  shake: "Camera shake",
  hitStop: "Hit stop",
  decals: "Decals",
  occlusion: "Smoke occlusion",
  lava: "Lava field",
  floor: "Floor texture",
  markings: "Painted markings",
  carBursts: "Car burst scaling",
};

/**
 * `lava` knobs baked into the crust texture. The other six in that section are live (LZ38), so
 * this is a field list rather than a section name — unlike `floor`, which is regenerate-only in
 * full (EV27).
 */
export const LAVA_REGENERATE_FIELDS: ReadonlySet<string> = new Set([
  "cells",
  "octaves",
  "seamWidth",
  "featherStart",
]);

export interface EnvPanelOptions {
  /** The live map. Mutated in place, exactly as the physics and VFX panels mutate their own. */
  readonly overrides: EnvOverrides;
  /** Save to localStorage. Called after every edit. */
  readonly persist: () => void;
  /**
   * Announce the edit and re-apply it. Called after every edit with the section that changed (and
   * the field, when the edit is a single row), so the panel can ask for the right kind of apply:
   * `floor` is a rebuild, `occlusion` is a rebuild, four `lava` fields are rebuilds, everything
   * else is live (EV23, EV27, EV30, LZ38).
   */
  readonly onEdit: (section: EnvSection, field?: string) => void;
  /** Regenerate the asphalt, persisting a rerolled seed if one is currently previewing (EV27). See
   * `FxLayer.rebuildFloor`'s own comment for why a later Regenerate can reuse a rerolled seed. */
  readonly onRegenerateFloor: () => void;
  /** Regenerate the asphalt with a fresh seed — preview only, never saved or exported (EV9). */
  readonly onRerollFloor: () => void;
  /** Fire one of each shake kind, because shake cannot be judged on a frozen field (EV31). */
  readonly onTestShake: () => void;
  /** Copy the export to the clipboard. */
  readonly onCopy: () => void;
  /** Leave the panel and return to the menu. */
  readonly onBack: () => void;
}

/** How many of a section's fields are overridden, so a collapsed block states its own condition. */
function sectionSummary(section: EnvSection, overrides: EnvOverrides): string {
  const n = ENV_FIELDS.filter(
    (f) => f.section === section && overrides[envKey(f.section, f.name)] !== undefined,
  ).length;
  return n === 0 ? "shipped" : `${n} changed`;
}

function format(field: EnvFieldDef, value: number): string {
  if (field.kind === "color") return `#${value.toString(16).padStart(6, "0")}`;
  return String(Number(value.toFixed(6)));
}

export function buildEnvPanel(opts: EnvPanelOptions): HTMLElement {
  let expanded: EnvSection | undefined = "grade";
  const body = h("div", { class: "pg-stats" });

  function overridesValue(field: EnvFieldDef, shipped: number): number {
    const stored = opts.overrides[envKey(field.section, field.name)];
    return typeof stored === "number" ? stored : shipped;
  }

  /** One control (plus reset) for one field, wired straight into the overrides map. Mirrors
   * `vfx-panel.ts`'s `fieldRow`: a `pg-row pg-stat-row` with a label, the control, a `pg-value`
   * readout and a `pg-reset` button, so this panel is clickable and styled through classes the
   * stylesheet already defines rather than the bespoke `pg-field`/`pg-readout` markup this used to
   * emit (which had no CSS at all). */
  function fieldRow(field: EnvFieldDef, refreshHeader: () => void): HTMLElement {
    const key = envKey(field.section, field.name);
    const shipped = shippedEnvValue(field);
    const value = overridesValue(field, shipped);

    const readoutEl = h("span", { class: "pg-value" }, [format(field, value)]);

    let input: HTMLInputElement;

    function snapToShipped(): void {
      delete opts.overrides[key];
      input.value =
        field.kind === "color" ? `#${shipped.toString(16).padStart(6, "0")}` : String(shipped);
      readoutEl.textContent = format(field, shipped);
    }

    function commit(next: number): void {
      if (isEnvAtShipped(field, next, shipped)) {
        snapToShipped();
      } else {
        opts.overrides[key] = next;
        readoutEl.textContent = format(field, next);
      }
      opts.persist();
      // A section's collapsed header states how many of its fields are overridden, and that count
      // just changed. Refresh that ONE text node rather than calling `renderBody()`, for the same
      // reason `vfx-panel.ts`'s `onEdit` does: a range input fires on every pointer move, and
      // replacing the panel's children mid-drag strands the slider the pointer is captured on.
      refreshHeader();
      opts.onEdit(field.section, field.name);
    }

    if (field.kind === "color") {
      input = h("input", { type: "color" }) as HTMLInputElement;
      input.value = `#${value.toString(16).padStart(6, "0")}`;
      input.addEventListener("input", () => commit(Number.parseInt(input.value.slice(1), 16)));
    } else {
      input = h("input", {
        type: "range",
        min: String(field.min),
        max: String(field.max),
        step: String(field.step),
      }) as HTMLInputElement;
      input.value = String(value);
      input.addEventListener("input", () => commit(Number(input.value)));
    }

    /** Nudge the slider by one `field.step`, clamped, then run the ordinary `commit` so the
     * `isEnvAtShipped` tolerance, the readout, the save and the re-apply all behave as a drag's do.
     * Reads the control back after writing it, because the browser snaps a range input to its own
     * `min`/`step` grid — that re-read is what makes up-then-down a round trip. A colour has no step
     * grid to walk, so those rows get no buttons rather than a pair that does nothing. */
    function stepBy(direction: 1 | -1): void {
      input.value = String(stepInRange(field, Number(input.value), direction));
      commit(Number(input.value));
    }

    const steppers = stepperPair(field.kind === "color" ? undefined : stepBy);

    const resetBtn = button({ class: "pg-reset", title: "Reset to shipped" }, ["↺"], () => {
      snapToShipped();
      opts.persist();
      refreshHeader();
      opts.onEdit(field.section, field.name);
    });

    const title =
      field.section === "lava" && LAVA_REGENERATE_FIELDS.has(field.name)
        ? `${key} — needs Regenerate`
        : key;

    return h("div", { class: "pg-row pg-stat-row" }, [
      h("label", { title }, [`${field.label} (shipped ${format(field, shipped)})`]),
      steppers[0],
      input,
      steppers[1],
      readoutEl,
      resetBtn,
    ]);
  }

  function sectionExtras(section: EnvSection): HTMLElement[] {
    if (section === "floor") {
      return [
        button({}, ["Regenerate"], opts.onRegenerateFloor),
        // Preview only. The seed is arena-derived so every client generates the same floor, which is
        // why it is neither a field nor persisted (EV9).
        button({}, ["Reroll seed (preview)"], opts.onRerollFloor),
      ];
    }
    if (section === "lava") {
      // Same button as `floor`: the four baked knobs live in the crust texture (LZ38). Reroll is
      // the asphalt seed (EV9) and does not belong here.
      return [button({}, ["Regenerate"], opts.onRegenerateFloor)];
    }
    if (section === "shake") return [button({}, ["Test shake"], opts.onTestShake)];
    return [];
  }

  /** One collapsible section, built exactly as `vfx-panel.ts`'s `channelBlock` builds a channel: a
   * `pg-fx-block` wrapper around a `pg-fx-head` toggle button and, when open, its rows. */
  function sectionBlock(section: EnvSection): HTMLElement {
    const isOpen = expanded === section;
    const label = (): string => `${SECTION_LABELS[section]} — ${sectionSummary(section, opts.overrides)}`;

    const header = button({ class: "pg-fx-head" }, [label()], () => {
      expanded = isOpen ? undefined : section;
      renderBody();
    });

    /** Repaint just this header from the live map — see `fieldRow`'s `commit` for why this is not a
     * `renderBody`. */
    const refreshHeader = (): void => {
      header.textContent = label();
    };

    /** Drop every override this section holds — the section-level twin of a row's own reset button.
     * A click, never a drag, so the full `renderBody` is safe here where `commit` cannot use one:
     * nothing has the pointer captured. */
    const resetSection = (): void => {
      for (const f of ENV_FIELDS) {
        if (f.section === section) delete opts.overrides[envKey(f.section, f.name)];
      }
      opts.persist();
      renderBody();
      opts.onEdit(section);
    };

    const headRow = h("div", { class: "pg-fx-headrow" }, [
      header,
      button({ class: "pg-reset", title: `Reset ${SECTION_LABELS[section]} to shipped` }, ["\u21ba"], resetSection),
    ]);

    const rows = isOpen
      ? [
          ...ENV_FIELDS.filter((f) => f.section === section).map((f) => fieldRow(f, refreshHeader)),
          ...sectionExtras(section),
        ]
      : [];
    return h("div", { class: "pg-fx-block" }, [headRow, ...rows]);
  }

  function renderBody(): void {
    body.replaceChildren(...SECTION_ORDER.map(sectionBlock));
  }

  /** Drop every override the panel holds, in every section — the whole-table twin of the VFX
   * panel's own "Reset all".
   *
   * Re-applies only the sections that actually held one, rather than announcing all ten: `onEdit`
   * is what rebuilds the occlusion silhouettes and re-reads the table, so ten calls would do that
   * work nine times over for nothing. `floor` re-applies no more here than it does on a slider —
   * it stays Regenerate-only (EV27), so a reset floor still draws the old asphalt until the button
   * beside it is pressed. A section-level lava reset still reapplies: six of its knobs are live. */
  const resetAll = (): void => {
    const touched = new Set<EnvSection>();
    for (const f of ENV_FIELDS) {
      const key = envKey(f.section, f.name);
      if (opts.overrides[key] === undefined) continue;
      delete opts.overrides[key];
      touched.add(f.section);
    }
    opts.persist();
    renderBody();
    for (const section of touched) opts.onEdit(section);
  };

  renderBody();

  return h("div", { class: "pg-panel pg-settings pg-env" }, [
    h("div", { class: "pg-settings-header" }, [
      h("h2", {}, ["Environment settings"]),
      button({}, ["Back"], opts.onBack),
    ]),
    // Laid out as the VFX panel's toolbar is, so the two panels' chrome reads the same: the header
    // carries the title and the way out, the toolbar the whole-table actions.
    h("div", { class: "pg-stats-toolbar" }, [
      button({}, ["Reset all"], resetAll),
      button({}, ["Copy environment"], opts.onCopy),
    ]),
    body,
  ]);
}
