/**
 * Every number the guide's PROSE quotes, derived from the live tables.
 *
 * `cars-and-weapons-copy.mjs` opens by saying "Numbers never live here". Its stat cells honoured
 * that from the start; its sentences did not, and three of them had gone wrong by 2026-09-04 —
 * predator claiming a 300 ms recharge against a table reading 1000, afterburner claiming five damage
 * ticks a second against a `damageFrequencyMs` of 500, and a chassis note citing a 286 that appears
 * nowhere on the page. `balanceStamp` cannot catch that class of error: it hashes the prose, so it
 * only ever asks "was the page rebuilt from this text", never "is this text true".
 *
 * So the prose writes a token like `{namespace.fact:words}` and this file answers it. A retune now
 * rewrites the sentence exactly as it already rewrote the cell beside it.
 *
 * **Adding a fact:** put it here, derived — never typed. If you find yourself writing a literal,
 * that is the bug this file exists to prevent. `manual-facts.test.mjs` fails on a token the prose
 * never uses, so a fact and its sentence are added and deleted together. The helpers that read a
 * status duration or a modifier percentage out of the tables went with the paragraphs that used
 * them in the 2026-09-17 restructure; the git history has them if a sentence needs one back.
 */

/**
 * The flat token map the prose is rendered against. Keys are `weapon.fact`; every value is a number
 * computed from a table, so none of them can drift from what the stat cells print.
 *
 * **Short, and meant to stay short.** The 2026-09-17 restructure cut the prose to one line per
 * chassis and one per weapon, and a caption that quotes no figure needs no token — thirty of these
 * went with the paragraphs that quoted them. `manual-facts.test.mjs` fails on a fact the prose never
 * uses, so this map can only ever be as long as the sentences justify. Adding a sentence that
 * measures something is what adds its fact back.
 *
 * **Empty as of VS29.** `roster.slotsPerCar` (`slotsOf(activeCarIds()[0]).length`) asserted a
 * uniform kit length across the roster that a variable `N` no longer guarantees, so it and the two
 * sentences that quoted it are gone — see `cars-and-weapons-copy.mjs`'s chassis lines. The map is
 * left here, empty, rather than deleted outright, because a future sentence measuring something real
 * adds its fact back in.
 */
export function manualFacts() {
  return {};
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty",
];
const TENS = { 30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety", 100: "a hundred" };

/**
 * A number spelled out, for prose that reads better in words ("two-second life").
 *
 * Deliberately NARROW: whole numbers to twenty, then round tens. Anything else throws rather than
 * guessing, which turns "this value grew past what the sentence can spell" into a failed build
 * instead of a sentence reading "two point four-second life".
 */
export function inWords(value, token) {
  if (Number.isInteger(value) && value >= 0 && value <= 20) return ONES[value];
  if (Number.isInteger(value) && TENS[value]) return TENS[value];
  throw new Error(
    `manual copy asked for {${token}:words}, but ${value} cannot be spelled out. ` +
      `Use {${token}} for the digits, or rewrite the sentence.`,
  );
}

/** `{token}` and `{token:words}`, the two forms the prose may ask for. */
const PLACEHOLDER = /\{([a-zA-Z][\w.]*)(?::(words))?\}/g;

/** One prose string with its placeholders filled in. Throws on a token this file does not define. */
export function renderCopyString(text, facts) {
  return text.replace(PLACEHOLDER, (_match, token, form) => {
    if (!(token in facts)) {
      throw new Error(
        `manual copy references {${token}}, which manual-facts.mjs does not define. ` +
          `Add it there — derived from the tables, never typed.`,
      );
    }
    const value = facts[token];
    return form === "words" ? inWords(value, token) : String(value);
  });
}

/** Every string in a copy tree, rendered. Structure and key order are preserved exactly. */
export function renderCopy(node, facts) {
  if (typeof node === "string") return renderCopyString(node, facts);
  if (Array.isArray(node)) return node.map((item) => renderCopy(item, facts));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, renderCopy(v, facts)]));
  }
  return node;
}

/** Which tokens a copy tree actually uses, so an unused fact can be caught and deleted. */
export function tokensUsedIn(node, found = new Set()) {
  if (typeof node === "string") {
    for (const m of node.matchAll(PLACEHOLDER)) found.add(m[1]);
  } else if (Array.isArray(node)) {
    for (const item of node) tokensUsedIn(item, found);
  } else if (node && typeof node === "object") {
    for (const v of Object.values(node)) tokensUsedIn(v, found);
  }
  return found;
}
