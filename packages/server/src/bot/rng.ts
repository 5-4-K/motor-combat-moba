/**
 * Seeded randomness for anything a bot or a balance run does (B20, B43).
 *
 * `Math.random()` is banned from every path a run touches: the harness's whole value rests on a
 * seed replaying identically, so that a balance edit can be measured as a paired difference rather
 * than sampled around (B36).
 *
 * mulberry32 — 32 bits of state, one multiply-xor-shift round. Chosen for being short enough to
 * read in full and stable forever: this is not cryptography, and a replay from six weeks ago must
 * still reproduce.
 */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A child seed from a parent and a path — `(runSeed, matchIndex)`, then `(matchSeed, slot)`.
 *
 * FNV-1a over the string form, so the parts may be numbers or names without a second scheme. Order
 * matters and is part of the identity: `(1, "a", 2)` and `(1, 2, "a")` are different streams.
 */
export function deriveSeed(seed: number, ...parts: (number | string)[]): number {
  let hash = 0x811c9dc5 ^ (seed >>> 0);
  for (const part of [String(seed), ...parts.map(String)].join("/")) {
    hash ^= part.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
