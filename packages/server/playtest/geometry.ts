/**
 * Level-geometry probes, on arena-02 — the dusty rectangular pit with a continuous spike ring.
 *
 * Until 2026-09-12 this file drove into Crossroads' free-standing bunkers and the plus-shape's
 * concave inner corners. That arena is gone: both shipped floors are 1280×720 pits, and arena-02's
 * only solids are four `kind: "spike"` strips flush to an inset rectangular boundary. The questions
 * (wedging, wall crush, lock/LOS, muzzle-in-wall, spawn clearance) are the same; the geometry they
 * are asked against is the spike ring.
 */
import {
  DEFAULT_GAME_MODE,
  DRIVE_CONFIG,
  SPIKE_CONFIG,
  forwardMaxSpeedOf,
  getArena,
  installMode,
  modeConfigOf,
  muzzleOffset,
  activeCarIds,
  fireSlotsOf,
  type ArenaDef,
  type CarId,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { PlaytestWorld, overlapDepth } from "./world.js";
import { Reporter } from "./reporter.js";

// Mode scope (MC12). `run-all.ts` spawns this file as its own one-shot process (one per probe), so
// there is nothing to restore afterward — `installMode`, not `withMode`, same shape as
// `scripts/build-cars-and-weapons.mjs`'s entry. This reports for DEFAULT_GAME_MODE's bundle only;
// per-mode playtest reporting is outstanding follow-up work this line does not take on.
installMode(modeConfigOf(DEFAULT_GAME_MODE));

const reporter = new Reporter(
  "geometry",
  "arena-02 spike-lined pit: wedging, corners, walls, aim-assist LOS, spawn seats.",
);
const report = reporter.report.bind(reporter);
const ARENA = getArena("arena-02");
/**
 * The chassis this probe seats to fire a row. Only ever asked about abilities here (G6 names
 * `afterburner` and `lance`), but it asks `fireSlotsOf` over `activeCarIds()` like the two weapon
 * probes do: the same helper written three ways is how the next sweep over `WEAPON_TABLE` walks
 * back into the "no chassis carries" crash a basic-attack row caused here.
 */
function carrierOf(w: WeaponId): CarId {
  const id = activeCarIds().find((c) => fireSlotsOf(c).includes(w));
  if (!id) throw new Error(`no active chassis can fire ${w}`);
  return id;
}
/**
 * Which FIRE slot (bitmask) this chassis presses to fire this weapon — the basic attack at index 0,
 * then the kit's three abilities at 1-3 (the 2026-09-20 index flip; `fireSlotsOf` is what this
 * follows, so the bit moved with the table and no arithmetic here did). Throws rather than silently returning a garbage bit:
 * `1 << -1` is `-2147483648`, which would press a nonsense mask and let a scenario naming a weapon
 * its chassis cannot fire report a clean, empty result.
 */
function slotBitFor(c: CarId, w: WeaponId): number {
  const i = fireSlotsOf(c).indexOf(w);
  if (i < 0) throw new Error(`${c} cannot fire ${w}`);
  return 1 << i;
}

/** Axis-aligned envelope of the inset `boundary` rect. arena-02's polygon is that rect. */
function boundaryRect(arena: ArenaDef): { left: number; right: number; top: number; bottom: number } {
  const verts = arena.boundary;
  if (!verts || verts.length === 0) {
    return { left: 0, right: arena.width, top: 0, bottom: arena.height };
  }
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

function westSpike(arena: ArenaDef) {
  const { left } = boundaryRect(arena);
  const strip = arena.obstacles.find((o) => o.x === left && o.w === SPIKE_CONFIG.depth);
  if (!strip) throw new Error(`${arena.id} has no west spike strip`);
  return strip;
}

/** Inclusive-on-the-edge, matching `pointOutsideBounds`: a centre ON a wall face has left the floor. */
function outsidePlayable(arena: ArenaDef, x: number, y: number): boolean {
  const b = boundaryRect(arena);
  return x <= b.left || x >= b.right || y <= b.top || y >= b.bottom;
}

/** Is this pose inside any obstacle? Measured on the hull's axis-aligned envelope. */
function insideObstacle(arena: ArenaDef, x: number, y: number, angle: number): number {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const hx = (c * DRIVE_CONFIG.carWidth + s * DRIVE_CONFIG.carHeight) / 2;
  const hy = (s * DRIVE_CONFIG.carWidth + c * DRIVE_CONFIG.carHeight) / 2;
  let worst = 0;
  for (const o of arena.obstacles) {
    const dx = Math.min(x + hx, o.x + o.w) - Math.max(x - hx, o.x);
    const dy = Math.min(y + hy, o.y + o.h) - Math.max(y - hy, o.y);
    if (dx > 0 && dy > 0) worst = Math.max(worst, Math.min(dx, dy));
  }
  return worst;
}

const WALL = boundaryRect(ARENA);
const WEST = westSpike(ARENA);
const INNER_L = WEST.x + WEST.w;
const CX = (WALL.left + WALL.right) / 2;
const CY = (WALL.top + WALL.bottom) / 2;

/* --------------------------------------------- G1. driving into every wall from the centre */
/**
 * Full-throttle into the spike-lined walls from many headings. Overlap with a strip is how these
 * walls work — FINDING is ejection past the boundary, or a car that cannot reverse back out.
 */
function driveIntoGeometry(): void {
  let deepest = 0;
  let worstCase = "";
  let stuckCases = 0;
  let ejectedCases = 0;
  let total = 0;

  for (let deg = 0; deg < 360; deg += 10) {
    for (const carId of ["mirage", "bastion"] as CarId[]) {
      total++;
      const a = (deg * Math.PI) / 180;
      const w = new PlaytestWorld(
        [{ id: "c", carId, x: CX, y: CY, angle: a }],
        "ffa",
        "arena-02",
      );
      let maxInside = 0;
      let ejected = false;
      for (let i = 0; i < 120; i++) {
        w.input("c", { throttle: 1 });
        w.tick();
        const p = w.get("c");
        maxInside = Math.max(maxInside, insideObstacle(ARENA, p.x, p.y, p.angle));
        if (outsidePlayable(ARENA, p.x, p.y)) ejected = true;
      }
      // Then try to reverse out — a car that cannot escape is wedged. Spike damage is one 80-hp
      // hit on arrival for a self-driven car, so they are still on the field for this.
      const before = { x: w.get("c").x, y: w.get("c").y };
      for (let i = 0; i < 120; i++) {
        w.input("c", { throttle: -1 });
        w.tick();
      }
      const after = w.get("c");
      const escaped = Math.hypot(after.x - before.x, after.y - before.y) > 40;
      if (!escaped) stuckCases++;
      if (ejected) ejectedCases++;
      if (maxInside > deepest) {
        deepest = maxInside;
        worstCase = `${carId} at ${deg} deg`;
      }
    }
  }
  report(
    "G1. Driving full-throttle into the spike-lined walls from 36 headings",
    stuckCases > 0 || ejectedCases > 0 ? "FINDING" : "OK",
    `deepest hull overlap with a spike strip: ${deepest.toFixed(2)}u (${worstCase || "none"}; ` +
      `strips are ${SPIKE_CONFIG.depth}u deep, so overlap up to that is the wall, not a clip)\n` +
      `cars unable to reverse back out: ${stuckCases}/${total}\n` +
      `cars whose centre left the playable boundary: ${ejectedCases}/${total}`,
  );
}

/* ------------------------------------------- G2. the four corners where two spike strips meet */
/**
 * The plus-shape is gone. What remains is a rectangular room: four corners where a long strip and
 * a short strip meet. Still the classic place a box-vs-box resolver picks the wrong separating
 * axis and either wedges or ejects a car — just no longer a concave notch.
 */
function pitCorners(): void {
  const depth = SPIKE_CONFIG.depth;
  const corners = [
    { x: WALL.left + depth, y: WALL.top + depth, name: "NW inner" },
    { x: WALL.right - depth, y: WALL.top + depth, name: "NE inner" },
    { x: WALL.left + depth, y: WALL.bottom - depth, name: "SW inner" },
    { x: WALL.right - depth, y: WALL.bottom - depth, name: "SE inner" },
  ];
  // Keep starts on the floor: 200u out from a corner along some headings leaves the pit entirely.
  const pad = 80;
  const floor = {
    left: WALL.left + depth + pad,
    right: WALL.right - depth - pad,
    top: WALL.top + depth + pad,
    bottom: WALL.bottom - depth - pad,
  };
  const rows: string[] = [];
  let bad = false;
  for (const corner of corners) {
    for (const deg of [45, 135, 225, 315]) {
      const a = (deg * Math.PI) / 180;
      const start = {
        x: Math.min(floor.right, Math.max(floor.left, corner.x - Math.cos(a) * 200)),
        y: Math.min(floor.bottom, Math.max(floor.top, corner.y - Math.sin(a) * 200)),
      };
      const w = new PlaytestWorld(
        [{ id: "c", carId: "mirage", x: start.x, y: start.y, angle: a }],
        "ffa",
        "arena-02",
      );
      let maxInside = 0;
      let ejected = false;
      for (let i = 0; i < 200; i++) {
        w.input("c", { throttle: 1, steer: i % 4 === 0 ? 1 : 0 });
        w.tick();
        const p = w.get("c");
        maxInside = Math.max(maxInside, insideObstacle(ARENA, p.x, p.y, p.angle));
        if (outsidePlayable(ARENA, p.x, p.y)) ejected = true;
      }
      // Overlap with the strips is the wall; past the strip depth, or off the floor, is the bug.
      if (maxInside > SPIKE_CONFIG.depth + 4 || ejected) {
        bad = true;
        rows.push(
          `${corner.name} @${deg} deg: spike overlap ${maxInside.toFixed(2)}u${ejected ? " EJECTED FROM ARENA" : ""}`,
        );
      }
    }
  }
  report(
    "G2. Grinding into the pit's four corners where two spike strips meet (16 approaches)",
    bad ? "FINDING" : "OK",
    rows.length > 0
      ? rows.join("\n")
      : `no overlap past the ${SPIKE_CONFIG.depth}u strip depth and nothing ejected from the playable floor`,
  );
}

/* ------------------------------------- G4. rammed into a spike-lined wall (car + geometry crush) */
/** collide.ts warns a car crushed between an obstacle and another car holds a deep overlap. */
function crushAgainstObstacle(): void {
  const rows: string[] = [];
  let deepest = 0;
  let deepestGeom = 0;
  let ejected = false;
  // Victim flush against the west strip's inner face; a bastion at top speed drives it into the wall.
  const vicX = INNER_L + DRIVE_CONFIG.carWidth / 2 + 1;
  const atkX = vicX + 60;
  for (let deg = 0; deg < 360; deg += 45) {
    const a = (deg * Math.PI) / 180;
    const w = new PlaytestWorld(
      [
        { id: "atk", carId: "bastion", x: atkX, y: CY, angle: Math.PI, speed: forwardMaxSpeedOf("bastion") },
        { id: "vic", carId: "mirage", x: vicX, y: CY, angle: a },
      ],
      "ffa",
      "arena-02",
    );
    let maxPair = 0;
    let maxGeom = 0;
    for (let i = 0; i < 150; i++) {
      w.input("atk", { throttle: 1 });
      w.tick();
      const v = w.get("vic");
      maxPair = Math.max(maxPair, overlapDepth(w.get("atk"), v));
      maxGeom = Math.max(maxGeom, insideObstacle(ARENA, v.x, v.y, v.angle));
      if (outsidePlayable(ARENA, v.x, v.y)) ejected = true;
    }
    deepest = Math.max(deepest, maxPair);
    deepestGeom = Math.max(deepestGeom, maxGeom);
    rows.push(`victim at ${String(deg).padStart(3)} deg: car-car ${maxPair.toFixed(1)}u, into-wall ${maxGeom.toFixed(1)}u`);
  }
  report(
    "G4. Car crushed between an attacker and a spike-lined wall",
    ejected || deepestGeom > DRIVE_CONFIG.carWidth
      ? "FINDING"
      : deepestGeom > 1
        ? "KNOWN-BY-DESIGN"
        : "OK",
    `collide.ts documents this concession explicitly (cars rank below obstacles, and the squeezed\n` +
      `car can hold an overlap "as deep as a full car dimension"). The west strip sits flush on the\n` +
      `boundary, so there is nowhere to push the victim but into the spikes.\n` +
      rows.join("\n") +
      `\nworst car-car ${deepest.toFixed(1)}u, worst hull-inside-strip ${deepestGeom.toFixed(1)}u ` +
      `(hull is ${DRIVE_CONFIG.carWidth}x${DRIVE_CONFIG.carHeight}; ejected ${ejected})`,
  );
}

/*
 * G5 measured the aim-assist lock's line-of-sight raycast: could a car hold a lock on a target
 * standing behind a solid spike strip? The 2026-09-17 removal of the target-lock feature deleted
 * `updateLock`, `lockTargetSessionId` and the raycast, so the scenario has no subject left to
 * measure and was removed with them rather than rewritten into something it was never asked to
 * check. G6 below still covers the OTHER caller of the same raycast — `wallClipDistance` against a
 * beam whose muzzle is buried in a strip — so the geometry itself is not unwatched. The numbering
 * is left with a hole on purpose: renumbering G6 and G7 would silently invalidate every earlier
 * report on disk.
 */

/* --------------------------------------------------- G6. beam fired with its muzzle in a wall */
/** `wallClipDistance` samples from d=0, so a muzzle buried in a wall should reach 0. */
function beamInWall(): void {
  const rows: string[] = [];
  let leak = false;
  for (const id of ["afterburner", "lance"] as WeaponId[]) {
    const carrier = carrierOf(id);
    const bit = slotBitFor(carrier, id);
    // Centre just inside the floor, firing west: the muzzle lands inside the west strip. Collision
    // pushes the hull east onto the inner face, which is still a blocked d=0 sample (inclusive).
    const sx = INNER_L + muzzleOffset() - 8;
    const w = new PlaytestWorld(
      [
        { id: "s", carId: carrier, x: sx, y: CY, angle: Math.PI, team: 0 },
        { id: "t", carId: "bastion", x: WEST.x - 40, y: CY, angle: 0, team: 0 },
      ],
      "ffa",
      "arena-02",
    );
    const hp0 = w.get("t").hp;
    let maxExtent = 0;
    for (let i = 0; i < 150; i++) {
      w.input("s", { fireSlots: i === 0 ? bit : 0 });
      w.tick();
      // afterburner authors muzzles at 0 and 180: the tail cone goes into the open pit and is not
      // this question. Only the wallward instance (heading west) can leak through the strip.
      for (const inst of w.instances()) {
        if (Math.cos(inst.angle) < 0) maxExtent = Math.max(maxExtent, inst.extent);
      }
    }
    const dealt = hp0 - w.get("t").hp;
    // The far-side target is in the wall band and will be clamped inward; damage after that clamp
    // is not a through-wall leak. Extent growing past the strip is.
    if (maxExtent > SPIKE_CONFIG.depth + 4) leak = true;
    rows.push(
      `${id.padEnd(11)} muzzle in the west strip, firing west: max wallward extent ${maxExtent.toFixed(0)}u, ` +
        `damage to the far-side car ${dealt}` +
        (maxExtent > SPIKE_CONFIG.depth + 4 ? " <- BEAM GREW PAST THE STRIP" : ""),
    );
  }
  report("G6. Beam fired with its muzzle buried in a spike strip", leak ? "FINDING" : "OK", rows.join("\n"));
}

/* ------------------------------------------------------- G7. six-car spawn overlap at match start */
function spawnOverlap(): void {
  const rows: string[] = [];
  let bad = false;
  for (const arenaId of ["arena-01", "arena-02"] as const) {
    const arena = getArena(arenaId);
    for (const [label, spawns] of [
      ["ffa", arena.ffaSpawns],
      ["teamA", arena.teamASpawns],
      ["teamB", arena.teamBSpawns],
    ] as const) {
      let worst = 0;
      let inWall = 0;
      for (let i = 0; i < spawns.length; i++) {
        const a = spawns[i]!;
        if (insideObstacle(arena, a.x, a.y, a.angle) > 0) inWall++;
        for (let j = i + 1; j < spawns.length; j++) {
          worst = Math.max(worst, overlapDepth(a, spawns[j]!));
        }
      }
      if (worst > 0 || inWall > 0) bad = true;
      rows.push(`${arenaId} ${label.padEnd(5)} (${spawns.length} seats): worst pair overlap ${worst.toFixed(1)}u, seats inside geometry ${inWall}`);
    }
  }
  report("G7. Spawn seats: overlap with each other or with level geometry", bad ? "FINDING" : "OK", rows.join("\n"));
}

driveIntoGeometry();
pitCorners();
crushAgainstObstacle();
beamInWall();
spawnOverlap();

reporter.finish();
