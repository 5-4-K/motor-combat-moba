import { defaultPracticeSetup, isPracticeSetup, type PracticeSetup } from "@motor-combat-moba/shared";

/**
 * localStorage persistence for the practice settings screen (spec PR21). Pure codec plus a thin
 * `Storage` seam, so the test runs under vitest's node environment without a `window`.
 *
 * Validation is the SAME guard the server uses, which buys one thing worth having: a chassis that is
 * later deactivated fails `isPracticeSetup`, so the blob falls back whole rather than stranding a
 * player on a settings page whose Start button the server will refuse.
 */
export const PRACTICE_STORAGE_KEY = "motor-combat.practice.v1";

export function loadPracticeSetup(storage: Storage = window.localStorage): PracticeSetup {
  try {
    const raw = storage.getItem(PRACTICE_STORAGE_KEY);
    if (raw === null) return defaultPracticeSetup();
    const parsed: unknown = JSON.parse(raw);
    return isPracticeSetup(parsed) ? parsed : defaultPracticeSetup();
  } catch {
    // Malformed JSON, or a storage that throws on access (private browsing, blocked site data).
    return defaultPracticeSetup();
  }
}

export function savePracticeSetup(
  setup: PracticeSetup,
  storage: Storage = window.localStorage,
): void {
  try {
    storage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // A setting that cannot be remembered is not worth breaking the screen over.
  }
}
