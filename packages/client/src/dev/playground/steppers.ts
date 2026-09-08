import { button, h } from "../../ui/dom.js";

/**
 * The −/+ pair a stat row wears either side of its slider, in every settings panel (physics, VFX,
 * environment).
 *
 * Lives here rather than three times over because the pair is a column of the row's grid, not a
 * decoration: the label, the two stepper columns, the control, the readout and the reset button line
 * up across every row of a section, and three copies of that markup are three chances for one panel
 * to drift a column out of line with the other two.
 *
 * `stepBy` omitted means the row has nothing to step — a checkbox, a colour swatch. It gets two
 * HIDDEN twins of the real buttons rather than nothing at all: an inert control that looks live is
 * worse than none (the rule `FX_FIELDS`'s `smokeOnly` rows already follow), but a row that simply
 * drops the two columns pulls its control and its readout left, out of the grid its neighbours sit
 * in. The twins are the same element with the same classes, so their width cannot drift from the
 * buttons' the next time the padding is touched.
 */
export function stepperPair(
  stepBy?: (direction: 1 | -1) => void,
): [HTMLElement, HTMLElement] {
  if (!stepBy) return [stepSpacer(), stepSpacer()];
  return [
    button({ class: "pg-step", title: "One step down" }, ["−"], () => stepBy(-1)),
    button({ class: "pg-step", title: "One step up" }, ["+"], () => stepBy(1)),
  ];
}

/** `visibility: hidden` keeps the box and its width while taking the button out of the tab order and
 * off the screen; `disabled` means a stray programmatic click does nothing either. */
function stepSpacer(): HTMLElement {
  return h("button", { type: "button", class: "pg-step pg-step-gap", disabled: true, "aria-hidden": "true" }, [
    "+",
  ]);
}
