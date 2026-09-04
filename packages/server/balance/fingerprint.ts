/**
 * Two short, stable fingerprints over the balance-relevant config, so a report printed today stays
 * interpretable months from now.
 *
 * `configFingerprint` covers every config `stepSim`, `runCombat`, the contact/ram pass, and the
 * deathmatch respawn/phase pipeline this harness itself drives (`runPipeline`, `respawnSweep`) read
 * that a tuning pass could touch: `WEAPON_TABLE`, `CAR_TABLE`, `COMBAT_CONFIG`, `DRIVE_CONFIG`,
 * `STATUS_TABLE`, `RAM_CONFIG`, `SLAM_CONFIG`, `AIM_CONFIG`, `WEAPON_SLOT_CONFIG`,
 * `DEATHMATCH_CONFIG`, `TICK_RATE_HZ`, and every registered arena (`ARENAS` — `assignSpawns` reads
 * an arena's spawn points directly, and its obstacles feed `stepSim`). Also `CAMERA_CONFIG` and
 * `LOGICAL_CANVAS` (B17, 2026-09-03): `buildBotView`'s viewport fairness limit is derived from both
 * (`LOGICAL_CANVAS` divided by `CAMERA_CONFIG.zoom`), and a bot session that can suddenly see less
 * — or more — of the arena is exactly the kind of change a baseline comparison must not silently
 * average over. `botFingerprint` covers `BOT_PROFILES` and `BOT_BRAIN_VERSION` separately, because a
 * bot retune and a balance retune are different edits with different implications for whether an old
 * report is still comparable to a new one (Task 20's baseline guard refuses a comparison across
 * either). `BOT_BRAIN_VERSION` (H46) rides alongside `BOT_PROFILES` in that same fingerprint because
 * a hash of the table alone cannot see a behaviour change made entirely in code — the human-like
 * brain's layers reading the numbers differently, with no number itself moving.
 *
 * **This list is not derived from anything — it is hand-maintained, and it must be kept in sync by
 * hand.** A config added later (a new `*_CONFIG` table, a new arena, a new tick-derived constant)
 * that the sim or this harness's own pipeline reads is invisible to `configFingerprint` until it is
 * added to the object below. Miss one and `--baseline` silently stops doing its job for exactly that
 * knob: two runs that actually measured different games will report `ok`, the Deltas table will
 * render, and every number in it will be misattributed to whatever the reader thought they changed
 * (see finding 2 in the 2026-09-03 review — this is the failure mode that motivated writing this
 * paragraph out in full). Deliberately NOT covered: `NET_CONFIG` (patch rate, not read by the sim),
 * `FLOW_CONFIG` (lobby/countdown, never reached — a match starts already in `RoomPhase.MATCH`), and
 * `PRACTICE_CONFIG` (only `PracticeRoom`, which this harness never runs).
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
  AIM_CONFIG,
  ARENAS,
  CAMERA_CONFIG,
  CAR_TABLE,
  COMBAT_CONFIG,
  DEATHMATCH_CONFIG,
  DRIVE_CONFIG,
  LOGICAL_CANVAS,
  RAM_CONFIG,
  SLAM_CONFIG,
  STATUS_TABLE,
  TICK_RATE_HZ,
  WEAPON_SLOT_CONFIG,
  WEAPON_TABLE,
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

/** Fingerprint over every table named in this module's header comment, whole. Changes whenever any
 * balance-relevant config field changes, however small. Keep the object below and the header
 * comment's list in sync — see that comment for what "in sync" costs if it drifts. */
export function configFingerprint(): string {
  return fnv1aHex(
    stableStringify({
      WEAPON_TABLE,
      CAR_TABLE,
      COMBAT_CONFIG,
      DRIVE_CONFIG,
      STATUS_TABLE,
      RAM_CONFIG,
      SLAM_CONFIG,
      AIM_CONFIG,
      WEAPON_SLOT_CONFIG,
      DEATHMATCH_CONFIG,
      TICK_RATE_HZ,
      ARENAS,
      CAMERA_CONFIG,
      LOGICAL_CANVAS,
    }),
  );
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
