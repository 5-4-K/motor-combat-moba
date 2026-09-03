import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRunDir } from "./run-dir.js";

const temps: string[] = [];
function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-dir-"));
  temps.push(dir);
  return dir;
}
afterEach(() => { for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("createRunDir", () => {
  it("numbers the first run of a day -01", () => {
    expect(path.basename(createRunDir(tempRoot()))).toMatch(/^\d{4}-\d{2}-\d{2}-01$/);
  });

  it("counts up from what is already on disk", () => {
    const root = tempRoot();
    createRunDir(root);
    expect(path.basename(createRunDir(root))).toMatch(/-02$/);
  });

  it("creates the directory it names", () => {
    expect(fs.existsSync(createRunDir(tempRoot()))).toBe(true);
  });
});
