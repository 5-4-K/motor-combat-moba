import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderPause } from "./pause.js";

/**
 * Client tests run in node with no DOM library installed, so this stands in the few `document`
 * calls `ui/dom.ts`'s `h`/`button` make: create an element, set attributes, append children and
 * text, and listen for a click. Enough to walk the menu's tree, nothing more.
 */
class FakeNode {
  readonly childNodes: FakeNode[] = [];
  constructor(readonly text = "") {}
  get textContent(): string {
    return this.text + this.childNodes.map((c) => c.textContent).join("");
  }
}

class FakeElement extends FakeNode {
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, Array<() => void>>();
  readonly style: Record<string, string> = {};
  constructor(readonly tagName: string) {
    super();
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  appendChild(child: FakeNode): FakeNode {
    this.childNodes.push(child);
    return child;
  }
  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  click(): void {
    for (const fn of this.listeners.get("click") ?? []) fn();
  }
  /** Every element below this one, depth first. */
  descendants(): FakeElement[] {
    return this.childNodes
      .filter((c): c is FakeElement => c instanceof FakeElement)
      .flatMap((c) => [c, ...c.descendants()]);
  }
}

const original = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
    createTextNode: (text: string) => new FakeNode(text),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = original;
});

function parts(root: HTMLElement): { title: string; buttons: FakeElement[] } {
  const all = (root as unknown as FakeElement).descendants();
  const title = all.find((el) => el.getAttribute("class") === "dialog-title")?.textContent ?? "";
  return { title, buttons: all.filter((el) => el.tagName === "BUTTON") };
}

describe("renderPause (TR39)", () => {
  const handlers = () => ({ onResume: vi.fn(), onExit: vi.fn() });

  it("is the practice pause by default: titled Paused, with Resume and Exit", () => {
    const { root } = renderPause(handlers());
    const { title, buttons } = parts(root);
    expect(title).toBe("Paused");
    expect(buttons.map((b) => b.textContent)).toEqual(["Resume", "Exit"]);
    expect(root.getAttribute("class")).toBe("dialog-backdrop");
  });

  it("is the arena's translucent menu as the overlay variant: titled Menu, with Resume and Exit", () => {
    const { root } = renderPause(handlers(), "overlay");
    const { title, buttons } = parts(root);
    expect(title).toBe("Menu");
    expect(buttons.map((b) => b.textContent)).toEqual(["Resume", "Exit"]);
    expect(root.getAttribute("class")?.split(" ")).toContain("overlay-translucent");
  });

  it.each(["paused", "overlay"] as const)("wires each %s button to its own handler", (variant) => {
    const h = handlers();
    const [resume, exit] = parts(renderPause(h, variant).root).buttons;
    resume!.click();
    expect(h.onResume).toHaveBeenCalledTimes(1);
    expect(h.onExit).not.toHaveBeenCalled();
    exit!.click();
    expect(h.onExit).toHaveBeenCalledTimes(1);
    expect(h.onResume).toHaveBeenCalledTimes(1);
  });
});
