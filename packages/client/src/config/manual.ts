/**
 * The cars-and-weapons manual: where it is served from, and what the button that opens it says.
 *
 * The page is GENERATED — `scripts/build-cars-and-weapons.mjs` writes it into `public/`, which Vite
 * copies verbatim into `dist/`, so it ships in the LAN zip and works with no route to the internet.
 * That makes this path a contract between the build script and the join screen, and nothing in the
 * type system can hold the two together; `scripts/manual-page.test.mjs` asserts they still agree.
 *
 * Relative rather than rooted at `/`, so the manual resolves wherever the client is mounted, and it
 * opens in a new tab rather than navigating: a player reading the manual mid-lobby should not lose
 * their room.
 */
export const MANUAL_PATH = "manual.html";

/** Says what the page is, not what to do with it — the reader is choosing between two doors here. */
export const MANUAL_LABEL = "Cars & weapons guide";
