/**
 * The smallest element builder that keeps the screen modules readable. Deliberately not a framework:
 * the menu screens re-render wholesale from a view-model whenever the room state's signature changes
 * (the same trick `lobby-signature.ts` already plays for the Phaser lobby), so there is no diffing to
 * do and nothing to reconcile.
 */

export type Attrs = Record<string, string | number | boolean | undefined>;
export type Child = Node | string | null | undefined | false;

/** Attribute names that are really DOM properties; setAttribute on these does the wrong thing. */
const PROPERTIES: ReadonlySet<string> = new Set(["value", "checked", "disabled", "maxLength"]);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (PROPERTIES.has(key)) {
      (el as unknown as Record<string, unknown>)[key] = value;
      continue;
    }
    el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

/**
 * An SVG node from markup. The icons come straight out of the design file, where they are Lucide
 * paths at stroke-width 2.75; re-typing them as DOM calls would only invite transcription errors.
 */
export function svg(markup: string): SVGElement {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    "image/svg+xml",
  );
  return doc.documentElement as unknown as SVGElement;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

/** `h` for a button that runs `onClick`, the one event these screens actually use. */
export function button(attrs: Attrs, children: Child[], onClick: () => void): HTMLButtonElement {
  const el = h("button", { type: "button", ...attrs }, children);
  el.addEventListener("click", onClick);
  return el;
}
