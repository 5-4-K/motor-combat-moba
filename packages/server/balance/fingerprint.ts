/**
 * Two short, stable fingerprints over the balance-relevant config, so a report printed today stays
 * interpretable months from now.
 *
 * `configFingerprint` covers the ACTIVE MODE's whole `ModeConfig` bundle (MC41) — cars, weapons,
 * drive, ram, impulse, combat, turret, the three status tables, spike, slots, flow, deathmatch,
 * camera, the arena id list, and every artifact derived from them — plus the wire id of the mode
 * itself and the three globals no mode owns that this harness's pipeline reads: `TICK_RATE_HZ`,
 * the arena definitions (`ARENAS` — `assignSpawns` reads an arena's spawn points directly, and its
 * obstacles feed `stepSim`) and `LOGICAL_CANVAS` (B17: `buildBotView`'s viewport fairness limit is
 * `LOGICAL_CANVAS` divided by the bundle's own `camera.zoom`, and a bot that can suddenly see less
 * — or more — of the arena is exactly the kind of change a baseline must not silently average
 * over). `botFingerprint` covers `BOT_PROFILES` and `BOT_BRAIN_VERSION` separately, because a bot
 * retune and a balance retune are different edits with different implications for whether an old
 * report is still comparable to a new one (Task 20's baseline guard refuses a comparison across
 * either). `BOT_BRAIN_VERSION` (H46) rides alongside `BOT_PROFILES` in that same fingerprint because
 * a hash of the table alone cannot see a behaviour change made entirely in code — the human-like
 * brain's layers reading the numbers differently, with no number itself moving.
 *
 * **It used to hash a hand-maintained list of RAW `config/` globals, and that list is gone.** It
 * named thirteen tables and was missing four the sim reads — `SPIKE_CONFIG`, `TURRET_CONFIG`,
 * `STATUS_CONFIG`, `STATUS_LIMITS` — exactly the drift its own warning predicted; worse, since the
 * per-mode work those globals are not what the game plays on at all, so a mode-only table edit
 * moved nothing here. Hashing the bundle fixes both: a new table added to `ModeTables` is covered
 * the day it is added, with no edit to this file. The one thing it over-covers is `FLOW_CONFIG`
 * (lobby/countdown, never reached — a match starts already in `RoomPhase.MATCH`), which is now in
 * the hash because it is in the bundle. That refuses a comparison that would in fact have been
 * valid, which is the safe direction to be wrong in, and it costs a `--force` rather than a
 * misattributed delta. `PRACTICE_CONFIG` and `NET_CONFIG` stay out: neither is in a bundle and
 * neither is read here.
 *
 * Hashed WHOLE, following the precedent `balanceStamp` (`scripts/build-cars-and-weapons.mjs`) set
 * for the manual page — any field of any row counts, not just the ones this file's author thought
 * to name. Computed independently rather than imported: `balanceStamp` lives in a build script
 * outside the TypeScript packages, and hashes for a different consumer (the player-facing guide,
 * not this harness). FNV-1a over a `JSON.stringify` with keys sorted at every level, rather than
 * `node:crypto`'s sha256 that `balanceStamp` uses — a 32-bit FNV-1a is plenty of collision
 * resistance for "did this file change since the last run" and needs no import from `node:crypto`,
 * keeping this module as small as what it does.
 */
import { BOT_BRAIN_VERSION, BOT_PROFILES } from "../src/config/bot-profiles.js";
import {
  ARENAS,
  LOGICAL_CANVAS,
  TICK_RATE_HZ,
  modeConfigOf,
  type GameMode,
} from "@motor-combat-moba/shared";

// FNV-1a 32-bit constants (the standard offset basis and prime for the 32-bit variant). Named
// rather than inlined so a reader does not have to recognize the magic numbers as a well-known
// hash's constants on sight.
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/**
 * FNV-1a over a string, 32-bit, rendered as 8 lowercase hex digits.
 *
 * `Math.imul` keeps the multiply inside 32 bits the way the algorithm expects — a plain `*` would
 * overflow into a float and silently stop being FNV-1a past the first few iterations.
 */
function fnv1aHex(input: string): string {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  // `>>> 0` turns the (possibly negative, since JS bitwise ops are signed 32-bit) result into an
  // unsigned 32-bit value before it goes to hex, so the output is always 8 digits, never a sign.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Recursively sorts object keys so `JSON.stringify` produces the same text regardless of the
 * insertion order the source objects happen to use — the fingerprint is a fact about the DATA, not
 * about which field a table's author happened to type first.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeysDeep(source[key]);
    return sorted;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/**
 * Fingerprint over the MODE's whole bundle plus the globals this harness reads that no mode owns.
 * Changes whenever any balance-relevant config field changes, however small — and, since MC41,
 * whenever the run measures a different mode.
 *
 * Two modes never share a fingerprint, even though they ship byte-identical tables today (neither's
 * `config.ts` overrides them, so both resolve to the same base) — which matters, because a hash
 * over the mode-BLIND raw globals gave a Brawl run and a Deathmatch run the same value and let
 * `--baseline` compare two
 * different games as if they were one. Two things carry the mode into the hash and either alone
 * would do it: the top-level `mode` key here, and `ModeConfig.id`, which every assembled bundle
 * carries as a field of its own. The redundancy is deliberate and cheap — the payload should say
 * which mode it is about without a reader having to know that a bundle self-identifies.
 *
 * Takes the mode explicitly rather than reading `cfg()`: this is called once, at the top of a run,
 * from code that already holds the flag's answer, and a parameter cannot silently report on
 * whatever bundle happened to be installed.
 *
 * `configFingerprintInput` is the payload; `configFingerprint` below is its hash.
 */
export function configFingerprintInput(mode: GameMode): unknown {
  return {
    mode,
    bundle: modeConfigOf(mode),
    TICK_RATE_HZ,
    ARENAS,
    LOGICAL_CANVAS,
  };
}

/** The hash of that payload. Exported separately from `configFingerprintInput` for the same reason
 * `botFingerprintInput` is: a test can assert WHAT is hashed, not only that the hash is stable. */
export function configFingerprint(mode: GameMode): string {
  return fnv1aHex(stableStringify(configFingerprintInput(mode)));
}

/** What `botFingerprint` hashes: `BOT_PROFILES` plus `BOT_BRAIN_VERSION` (H46). A hash of the
 * table alone cannot see a behaviour change made in code with every tier's numbers left untouched —
 * `BOT_BRAIN_VERSION` is what makes that case invalidate a baseline comparison too. Exported so a
 * test can assert the shape directly rather than only the hash's stability. */
export function botFingerprintInput(): unknown {
  return { BOT_PROFILES, BOT_BRAIN_VERSION };
}

/** Fingerprint over `BOT_PROFILES` and `BOT_BRAIN_VERSION`, whole and separate from
 * `configFingerprint` — a bot retune and a balance retune are different edits, and a baseline
 * comparison needs to tell them apart. */
export function botFingerprint(): string {
  return fnv1aHex(stableStringify(botFingerprintInput()));
}
