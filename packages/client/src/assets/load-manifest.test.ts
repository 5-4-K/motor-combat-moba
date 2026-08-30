import { describe, expect, it } from "vitest";
import { loadManifest } from "./load-manifest.js";

function respondWith(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("loadManifest", () => {
  it("parses a served manifest", async () => {
    const fetchImpl = respondWith({ sprites: { "car.bullseye": { file: "cars/bullseye.png" } } });
    const { manifest, problems } = await loadManifest("art/manifest.json", fetchImpl);
    expect(problems).toEqual([]);
    expect(manifest.sprites["car.bullseye"].file).toBe("cars/bullseye.png");
  });

  it("degrades to the empty manifest on a non-ok response", async () => {
    const { manifest, problems } = await loadManifest("art/manifest.json", respondWith({}, false, 404));
    expect(manifest.sprites).toEqual({});
    expect(problems[0]).toContain("404");
  });

  it("degrades to the empty manifest when fetch throws", async () => {
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const { manifest, problems } = await loadManifest("art/manifest.json", boom);
    expect(manifest.sprites).toEqual({});
    expect(problems[0]).toContain("offline");
  });

  it("degrades to the empty manifest on invalid JSON", async () => {
    const badJson = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    })) as unknown as typeof fetch;
    const { manifest, problems } = await loadManifest("art/manifest.json", badJson);
    expect(manifest.sprites).toEqual({});
    expect(problems).toHaveLength(1);
  });
});
