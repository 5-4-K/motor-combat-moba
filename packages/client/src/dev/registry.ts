import type Phaser from "phaser";

/**
 * Asserted absent from release bundles by `assertNoDevOnlyCode` in `scripts/build-release.mjs`.
 * Every dev tool also renders this string as its heading, so it is physically present in each tool's
 * own module as well as here — a tool that reaches a release by some route bypassing this registry
 * is still caught.
 */
export const DEV_TOOL_MARKER = "MOTOR DEV TOOL";

type SceneCtor = new () => Phaser.Scene;

/**
 * Every dev tool, keyed by its `?dev=<id>` value. Values are dynamic imports, so a tool is fetched
 * only when asked for and the whole suite sits behind the one `import.meta.env.DEV` branch in
 * `BootScene` — one guard and one strip marker no matter how many tools accumulate.
 *
 * Empty until Task 9. `import type Phaser` is erased at compile time, so this module stays
 * importable from a node test.
 */
export const DEV_TOOLS: Record<string, () => Promise<SceneCtor>> = {
  assets: async () => (await import("./AssetTuningScene.js")).AssetTuningScene,
};

/**
 * Own-property check, deliberately not `id in DEV_TOOLS`: `in` walks the prototype chain, so
 * `?dev=toString` would pass as a tool id and then resolve to something that is not a scene.
 */
export function isDevToolId(id: string | undefined): id is string {
  return id !== undefined && Object.prototype.hasOwnProperty.call(DEV_TOOLS, id);
}
