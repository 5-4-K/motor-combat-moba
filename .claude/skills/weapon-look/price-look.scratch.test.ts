/**
 * Prices one weapon's look, headless. A SCRATCH file: copy it to
 * `packages/client/src/scenes/price-look.scratch.test.ts`, run
 * `LOOK=<weaponId> npx vitest run price-look` from `packages/client`, read the table, delete it.
 *
 * It measures the BUILD half of a look's per-frame cost (the CPU geometry) and counts what the
 * renderer will be handed; it cannot measure the RENDER half, which needs the browser — see the
 * `weapon-look` skill. Twelve instances, because that is the realistic ceiling for one weapon in a
 * six-car room, and because it is the load every number in `packages/client/CLAUDE.md` was
 * measured at.
 */
import { isWeaponId, weaponDefOf } from "@motor-combat-moba/shared";
import { it } from "vitest";
import {
  beamDrawLayers,
  beamFlareShapes,
  instanceDrawShape,
  instanceGlowBands,
  instanceHaloBands,
  projectileDrawLayers,
  projectileHaloShapes,
} from "./combat-visual.js";
import { discSegments } from "./ribbon-fill.js";

const INSTANCES = 12;
const FRAMES = 300;
const id = process.env.LOOK ?? "lance";

it(`prices the ${id} look at ${INSTANCES} live instances`, () => {
  if (!isWeaponId(id)) throw new Error(`LOOK=${id} is not a WeaponId`);
  const def = weaponDefOf(id);
  const extent = def.range;
  let fills = 0;
  let vertices = 0;
  let earcut = 0;
  let triangles = 0;
  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f += 1) {
    const nowMs = f * (1000 / 60);
    for (let i = 0; i < INSTANCES; i += 1) {
      const angle = (i / INSTANCES) * Math.PI * 2 + 0.3;
      const inst = { weaponId: id, isExplosion: false, x: 640, y: 360, angle, extent };
      const shape = instanceDrawShape(inst, 40);
      if (shape.kind === "circle") {
        const bands = [
          ...instanceHaloBands(id, shape.radius),
          ...instanceGlowBands(id, shape.radius, 0, nowMs),
        ];
        for (const b of bands) {
          fills += 1;
          triangles += discSegments(b.radius);
        }
        if (bands.length === 0) {
          fills += 1;
          triangles += discSegments(shape.radius);
        }
        continue;
      }
      const layers =
        def.kind === "beam"
          ? [
              ...beamDrawLayers(id, 640, 360, angle, extent, 0, nowMs),
              ...beamFlareShapes(id, 640, 360, angle, nowMs % 400).map((s) =>
                s.kind === "poly" ? { points: s.points } : { points: [], disc: s.radius },
              ),
            ]
          : [...projectileDrawLayers(inst, 40), ...projectileHaloShapes(inst, 40)];
      if (layers.length === 0) layers.push({ points: shape.points });
      for (const layer of layers) {
        fills += 1;
        if ("disc" in layer && layer.disc !== undefined) {
          triangles += discSegments(layer.disc);
          continue;
        }
        vertices += layer.points.length;
        if ("ribbon" in layer && layer.ribbon !== undefined) {
          triangles += (layer.ribbon - 1) * 2 + Math.max(0, layer.points.length - layer.ribbon * 2);
        } else {
          earcut += layer.points.length;
          triangles += Math.max(0, layer.points.length - 2);
        }
      }
    }
  }
  const ms = performance.now() - t0;
  const per = INSTANCES * FRAMES;
  const rows = {
    weapon: id,
    kind: def.kind,
    "build ms / instance / frame": (ms / per).toFixed(4),
    "build ms / frame at 12": (ms / FRAMES).toFixed(3),
    "fills / instance": (fills / per).toFixed(1),
    "vertices / instance": (vertices / per).toFixed(0),
    "Earcut-bound vertices / instance": (earcut / per).toFixed(0),
    "triangles / instance": (triangles / per).toFixed(0),
  };
  // eslint-disable-next-line no-console
  console.table(rows);
  // Reference points, same method, one container (2026-09-21) — build ms per instance per frame,
  // then Earcut-bound vertices per instance: lance 0.10 / 94, afterburner 0.16 / 68, predator
  // 0.014 / 99, magmablast 0.005 / 0. Those Earcut vertices are shards, embers and markings, a few
  // vertices each. A look whose Earcut column jumps by hundreds is a station walk without
  // `ribbon`, and `ribbon-fill.test.ts` fails it by name.
});
