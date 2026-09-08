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
  floor: "Floor texture",
  markings: "Painted markings",
  carBursts: "Car burst scaling",
};

export interface EnvPanelOptions {
  /** The live map. Mutated in place, exactly as the physics and VFX panels mutate their own. */
  readonly overrides: EnvOverrides;
  /** Save to localStorage. Called after every edit. */
  readonly persist: () => void;
  /**
   * Announce the edit and re-apply it. Called after every edit with the section that changed, so the
   * panel can ask for the right kind of apply: `floor` and `occlusion` are rebuilds, everything else
   * is live (EV23, EV27, EV30).
   */
  readonly onEdit: (section: EnvSection) => void;
  /** Regenerate the asphalt with the arena's own seed (EV27). */
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

export function buildEnvPanel(opts: EnvPanelOptions): HTMLElement {
  let expanded: EnvSection | undefined = "grade";
  const body = h("div", { class: "pg-stats" });

  /** One control for one field, wired straight into the overrides map. */
  function fieldRow(field: EnvFieldDef): HTMLElement {
    const key = envKey(field.section, field.name);
    const shipped = shippedEnvValue(field);
    const value = overridesValue(field, shipped);

    const readout = h("span", { class: "pg-readout" }, [format(field, value)]);

    const commit = (next: number): void => {
      if (isEnvAtShipped(field, next, shipped)) delete opts.overrides[key];
      else opts.overrides[key] = next;
      readout.textContent = format(field, next);
      opts.persist();
      opts.onEdit(field.section);
    };

    if (field.kind === "color") {
      const input = h("input", { type: "color" }) as HTMLInputElement;
      input.value = `#${value.toString(16).padStart(6, "0")}`;
      input.addEventListener("input", () =>
        commit(Number.parseInt(input.value.slice(1), 16)),
      );
      return h("label", { class: "pg-field" }, [field.label, input, readout]);
    }

    const input = h("input", {
      type: "range",
      min: String(field.min),
      max: String(field.max),
      step: String(field.step),
    }) as HTMLInputElement;
    input.value = String(value);
    input.addEventListener("input", () => commit(Number(input.value)));
    return h("label", { class: "pg-field" }, [field.label, input, readout]);
  }

  function overridesValue(field: EnvFieldDef, shipped: number): number {
    const stored = opts.overrides[envKey(field.section, field.name)];
    return typeof stored === "number" ? stored : shipped;
  }

  function format(field: EnvFieldDef, value: number): string {
    if (field.kind === "color") return `#${value.toString(16).padStart(6, "0")}`;
    return String(Number(value.toFixed(6)));
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
    if (section === "shake") return [button({}, ["Test shake"], opts.onTestShake)];
    return [];
  }

  function renderBody(): void {
    body.replaceChildren();
    for (const section of SECTION_ORDER) {
      const isOpen = expanded === section;
      const head = button({ class: "pg-section-head" }, [
        `${SECTION_LABELS[section]} — ${sectionSummary(section, opts.overrides)}`,
      ], () => {
        expanded = isOpen ? undefined : section;
        renderBody();
      });
      body.appendChild(head);
      if (!isOpen) continue;
      const rows = ENV_FIELDS.filter((f) => f.section === section).map(fieldRow);
      body.appendChild(h("div", { class: "pg-section-body" }, [...rows, ...sectionExtras(section)]));
    }
  }

  renderBody();
  return h("div", { class: "pg-env" }, [
    h("div", { class: "pg-head" }, [
      button({}, ["Back"], opts.onBack),
      button({}, ["Copy environment"], opts.onCopy),
    ]),
    body,
  ]);
}
