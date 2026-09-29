/** True when a `process.versions.node`-style string names Node 22 or newer. */
export function nodeMajorOk(version: string): boolean {
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "", 10);
  return Number.isFinite(major) && major >= 22;
}
