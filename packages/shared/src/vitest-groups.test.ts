import { existsSync, globSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { BENCH_TESTS, NET_TESTS, SLOW_TESTS } from "../vitest.groups";

// Guards the group lists in `vitest.groups.ts`: a typo in a path or glob would silently drop a test
// from every run, so each entry must name something real and no file may sit in two groups.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isGlob = (entry: string) => /[*?[\]{}]/.test(entry);
const filesOf = (entries: string[]) =>
  new Set(entries.flatMap((entry) => (isGlob(entry) ? globSync(entry, { cwd: root }) : [entry])));

for (const [name, list] of [
  ["SLOW_TESTS", SLOW_TESTS],
  ["BENCH_TESTS", BENCH_TESTS],
  ["NET_TESTS", NET_TESTS],
] as const) {
  // A group may legitimately be empty; `it.each([])` would make an empty suite, which vitest rejects.
  for (const entry of list) {
    it(`${name}: ${entry} resolves to a real file`, () => {
      if (isGlob(entry)) expect(globSync(entry, { cwd: root }).length).toBeGreaterThan(0);
      else expect(existsSync(resolve(root, entry))).toBe(true);
    });
  }
}

// No file may sit in both groups: the slow config would silently drop it (it excludes BENCH_TESTS).
it("no file is named in both the slow and the bench group", () => {
  const bench = filesOf(BENCH_TESTS);
  expect([...filesOf(SLOW_TESTS)].filter((file) => bench.has(file))).toEqual([]);
});

// The net group stands alone: every config but `vitest.net.config.ts` excludes NET_TESTS, so a file
// also named in SLOW or BENCH would run twice or nowhere it was meant to.
it("no file is named in both the net group and the slow or bench group", () => {
  const net = filesOf(NET_TESTS);
  expect([...filesOf(SLOW_TESTS), ...filesOf(BENCH_TESTS)].filter((file) => net.has(file))).toEqual([]);
});
