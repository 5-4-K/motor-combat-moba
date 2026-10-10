// Shared by the three source-scanning guards (`modes/no-raw-config-in-sim.test.ts`,
// `modes/no-mode-branching.test.ts`, `config/weapon-slots-readers.test.ts`). Not imported by any
// shipped code and must not import vitest: it compiles into shared's `dist` like every other file.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Directories no guard ever descends into: build output, installs and generated reports. */
const SKIP_DIRS = new Set(["node_modules", "dist", "reports"]);

export interface WalkOptions {
  /** Extensions to collect, with the dot. Default `[".ts"]`. */
  exts?: string[];
  /** Skip `*.test.*` files (any name containing ".test."). Default `true`. */
  skipTests?: boolean;
}

/** Windows builds paths with backslashes; every path a guard compares is written with "/". */
export const toPosix = (path: string): string => path.split("\\").join("/");

/**
 * Source files under `root`, as posix paths RELATIVE to `root`, sorted. `.d.ts` files are never
 * returned. Join with `root` to read one.
 */
export function walkSource(root: string, opts: WalkOptions = {}): string[] {
  const exts = opts.exts ?? [".ts"];
  const skipTests = opts.skipTests ?? true;
  const out: string[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) visit(join(dir, e.name), `${prefix}${e.name}/`);
      } else if (
        exts.some((x) => e.name.endsWith(x)) &&
        !e.name.endsWith(".d.ts") &&
        !(skipTests && e.name.includes(".test."))
      ) {
        out.push(prefix + e.name);
      }
    }
  };
  visit(root, "");
  return out.sort();
}

const cache = new Map<string, { stamp: string; text: string }>();

/**
 * A file's text, read once per process. The cache is validated against mtime and size so a guard's
 * tripwire that rewrites its fixture between two assertions still sees the new contents.
 */
export function readSource(absPath: string): string {
  const st = statSync(absPath);
  const stamp = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(absPath);
  if (hit && hit.stamp === stamp) return hit.text;
  const text = readFileSync(absPath, "utf8");
  cache.set(absPath, { stamp, text });
  return text;
}

/**
 * Block and line comments removed. The `[^:]` guard on the line-comment pattern is this repo's own
 * idiom, so a `://` inside a string is not mistaken for a comment.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Import statements removed (apply after `stripComments`). */
export function stripImports(src: string): string {
  return src.replace(/\bimport\s[\s\S]*?from\s*["'][^"']*["'];?/g, "");
}

/** Code that could actually DO something: comments, then import statements, stripped. */
export function codeOf(src: string): string {
  return stripImports(stripComments(src));
}
