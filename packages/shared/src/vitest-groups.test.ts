import { existsSync, globSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { BENCH_TESTS, SLOW_TESTS } from "../vitest.groups.ts";

// Guards the group lists in `vitest.groups.ts`: a typo in a path or glob would silently drop a test
// from every run, so each entry must name something real and no file may sit in two groups.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isGlob = (entry: string) => /[*?[\]{}]/.test(entry);
const filesOf = (entries: string[]) =>
  new Set(entries.flatMap((entry) => (isGlob(entry) ? globSync(entry, { cwd: root }) : [entry])));

for (const [name, list] of [
  ["SLOW_TESTS", SLOW_TESTS],
  ["BENCH_TESTS", BENCH_TESTS],
] as const) {
  // A group may legitimately be empty; `it.each([])` would make an empty suite, which vitest rejects.
  for (const entry of list) {
    it(`${name}: ${entry} resolves to a real file`, () => {
      if (isGlob(entry)) expect(globSync(entry, { cwd: root }).length).toBeGreaterThan(0);
      else expect(existsSync(resolve(root, entry))).toBe(true);
    });
  }
}

// A SLOW glob may sweep up a bench file (server's `src/bot/**`): the slow config excludes BENCH_TESTS,
// so the bench group wins. An exact-path SLOW entry that is also a bench file is a real mistake.
it("no file is named in both the slow and the bench group", () => {
  const bench = filesOf(BENCH_TESTS);
  expect(SLOW_TESTS.filter((entry) => !isGlob(entry) && bench.has(entry))).toEqual([]);
});
