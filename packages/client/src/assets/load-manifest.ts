import { EMPTY_MANIFEST, parseManifest, type ParseResult } from "./manifest-schema.js";

/**
 * Where the manifest is served from, relative to the page. `art/` and not `assets/`: Vite's
 * `build.assetsDir` defaults to `assets`, so bundled JS lands in `dist/assets/` and source art
 * placed there would merge into the same directory as hashed bundle output.
 *
 * Deliberately a single constant with no project name in it — the only thing a future theme feature
 * would need to change.
 */
export const MANIFEST_URL = "art/manifest.json";

/**
 * Fetch and parse the manifest, never throwing. Every failure — unreachable, 404, malformed JSON —
 * returns the empty manifest plus a problem string, so a broken manifest costs the game its art and
 * nothing else: all cars fall through to the procedural silhouettes they draw today.
 *
 * `fetchImpl` is injectable so this is testable in the node environment; the client's vitest config
 * has no DOM and no browser `fetch` guarantees.
 */
export async function loadManifest(
  url: string = MANIFEST_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ParseResult> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { manifest: EMPTY_MANIFEST, problems: [`manifest fetch failed: ${response.status}`] };
    }
    return parseManifest(await response.json());
  } catch (error) {
    return { manifest: EMPTY_MANIFEST, problems: [`manifest fetch threw: ${String(error)}`] };
  }
}
