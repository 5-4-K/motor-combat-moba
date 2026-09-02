/**
 * Level-geometry probes, on arena-02 ("Crossroads") — the arena that actually has obstacles.
 *
 * Getting wedged in level geometry, and shooting/locking through it, are the two collision bugs
 * players report most in top-down arena games. arena-01 is empty, so none of this is reachable
 * there; every one of these needs arena-02.
 */
import {
  AIM_CONFIG,
  DRIVE_CONFIG,
  forwardMaxSpeedOf,
  getArena,
  slotsOf,
  CAR_TABLE,
  type CarId,
  type WeaponId,
} from "@motor-combat-moba/shared";
import { PlaytestWorld, overlapDepth } from "./world.js";
import { Reporter } from "./reporter.js";

const reporter = new Reporter(
  "geometry",
  "arena-02 level geometry: wedging, concave corners, walls, aim-assist LOS, spawn seats.",
);
const report = reporter.report.bind(reporter);
const ARENA = getArena("arena-02");
function carrierOf(w: WeaponId): CarId {
  const id = (Object.keys(CAR_TABLE) as CarId[]).find((c) => slotsOf(c).includes(w));
  if (!id) throw new Error(`no chassis carries ${w}`);
  return id;
}
/**
 * Which slot index (1-based bitmask) carries this weapon on its chassis. Throws rather than
 * silently returning a garbage bit: `1 << -1` is `-2147483648`, which would fire a nonsense mask
 * and let a scenario naming a weapon its chassis no longer carries report a clean, empty result.
 */
function slotBitFor(c: CarId, w: WeaponId): number {
  const i = slotsOf(c).indexOf(w);
  if (i < 0) throw new Error(`${c} does not carry ${w}`);
  return 1 << i;
}

/** Is this pose inside any obstacle? Measured on the hull's axis-aligned envelope. */
function insideObstacle(x: number, y: number, angle: number): number {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const hx = (c * DRIVE_CONFIG.carWidth + s * DRIVE_CONFIG.carHeight) / 2;
  const hy = (s * DRIVE_CONFIG.carWidth + c * DRIVE_CONFIG.carHeight) / 2;
  let worst = 0;
  for (const o of ARENA.obstacles) {
    const dx = Math.min(x + hx, o.x + o.w) - Math.max(x - hx, o.x);
    const dy = Math.min(y + hy, o.y + o.h) - Math.max(y - hy, o.y);
    if (dx > 0 && dy > 0) worst = Math.max(worst, Math.min(dx, dy));
  }
  return worst;
}

/* --------------------------------------------- G1. driving into every obstacle face and corner */
/** Full-throttle into level geometry from many headings. Looking for clipping and for wedging. */
function driveIntoGeometry(): void {
  let deepest = 0;
  let worstCase = "";
  let stuckCases = 0;
  let total = 0;
  const box = ARENA.obstacles[2]!; // 400,400 200x200 — a free-standing bunker with four corners

  for (let deg = 0; deg < 360; deg += 10) {
    for (const carId of ["mirage", "bastion"] as CarId[]) {
      total++;
      const a = (deg * Math.PI) / 180;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const start = 260; // outside the box, driving straight at its centre
      const w = new PlaytestWorld(
        [{ id: "c", carId, x: cx - Math.cos(a) * start, y: cy - Math.sin(a) * start, angle: a }],
        "ffa",
        "arena-02",
      );
      let maxInside = 0;
      for (let i = 0; i < 120; i++) {
        w.input("c", { throttle: 1 });
        w.tick();
        const p = w.get("c");
        maxInside = Math.max(maxInside, insideObstacle(p.x, p.y, p.angle));
      }
      // Then try to reverse out — a car that cannot escape is wedged.
      const before = { x: w.get("c").x, y: w.get("c").y };
      for (let i = 0; i < 120; i++) {
        w.input("c", { throttle: -1 });
        w.tick();
      }
      const after = w.get("c");
      const escaped = Math.hypot(after.x - before.x, after.y - before.y) > 40;
      if (!escaped) stuckCases++;
      if (maxInside > deepest) {
        deepest = maxInside;
        worstCase = `${carId} at ${deg} deg`;
      }
    }
  }
  // A couple of units of hull corner inside a wall face is cosmetic at this hull size; being
  // unable to reverse back out is not. Weight the verdict accordingly.
  report(
    "G1. Driving full-throttle into a free-standing block from 36 headings",
    stuckCases > 0 ? "FINDING" : deepest > 4 ? "FINDING" : "OK",
    `deepest hull penetration into level geometry: ${deepest.toFixed(2)}u (${worstCase || "none"})\n` +
      `cars unable to reverse back out: ${stuckCases}/${total}`,
  );
}

/* ------------------------------------------- G2. the plus-shape's inner corners (concave wedge) */
/**
 * Two overlapping rects form the central plus. Its four inner corners are concave — the classic
 * place a box-vs-box resolver picks the wrong separating axis and either wedges or ejects a car.
 */
function concaveCorners(): void {
  const vertical = ARENA.obstacles[0]!; // 940,700 120x600
  const horizontal = ARENA.obstacles[1]!; // 700,940 600x120
  // The four re-entrant corners of the plus.
  const corners = [
    { x: vertical.x, y: horizontal.y, name: "NW inner" },
    { x: vertical.x + vertical.w, y: horizontal.y, name: "NE inner" },
    { x: vertical.x, y: horizontal.y + horizontal.h, name: "SW inner" },
    { x: vertical.x + vertical.w, y: horizontal.y + horizontal.h, name: "SE inner" },
  ];
  const rows: string[] = [];
  let bad = false;
  for (const corner of corners) {
    for (const deg of [45, 135, 225, 315]) {
      const a = (deg * Math.PI) / 180;
      // Start 200u out along the diagonal, drive straight into the notch.
      const w = new PlaytestWorld(
        [
          {
            id: "c",
            carId: "mirage",
            x: corner.x - Math.cos(a) * 200,
            y: corner.y - Math.sin(a) * 200,
            angle: a,
          },
        ],
        "ffa",
        "arena-02",
      );
      let maxInside = 0;
      let ejected = false;
      for (let i = 0; i < 200; i++) {
        w.input("c", { throttle: 1, steer: i % 4 === 0 ? 1 : 0 });
        w.tick();
        const p = w.get("c");
        maxInside = Math.max(maxInside, insideObstacle(p.x, p.y, p.angle));
        if (p.x < 0 || p.y < 0 || p.x > ARENA.width || p.y > ARENA.height) ejected = true;
      }
      if (maxInside > 1 || ejected) {
        bad = true;
        rows.push(
          `${corner.name} @${deg} deg: penetration ${maxInside.toFixed(2)}u${ejected ? " EJECTED FROM ARENA" : ""}`,
        );
      }
    }
  }
  report(
    "G2. Grinding into the plus-shape's four concave inner corners (16 approaches)",
    bad ? "FINDING" : "OK",
    rows.length > 0 ? rows.join("\n") : "no penetration above 1u and nothing ejected from the arena",
  );
}

/* ------------------------------------- G3. rammed into an obstacle corner (car + geometry crush) */
/** collide.ts warns a car crushed between an obstacle and another car holds a deep overlap. */
function crushAgainstObstacle(): void {
  const box = ARENA.obstacles[2]!;
  const rows: string[] = [];
  let deepest = 0;
  let deepestGeom = 0;
  for (let deg = 0; deg < 360; deg += 45) {
    const a = (deg * Math.PI) / 180;
    // Victim flush against the box face; a bastion at top speed drives it into the wall.
    const faceX = box.x - DRIVE_CONFIG.carWidth / 2 - 1;
    const faceY = box.y + box.h / 2;
    const w = new PlaytestWorld(
      [
        { id: "atk", carId: "bastion", x: faceX - 60, y: faceY, angle: 0, speed: forwardMaxSpeedOf("bastion") },
        { id: "vic", carId: "mirage", x: faceX, y: faceY, angle: a },
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
      maxGeom = Math.max(maxGeom, insideObstacle(v.x, v.y, v.angle));
    }
    deepest = Math.max(deepest, maxPair);
    deepestGeom = Math.max(deepestGeom, maxGeom);
    rows.push(`victim at ${String(deg).padStart(3)} deg: car-car ${maxPair.toFixed(1)}u, into-wall ${maxGeom.toFixed(1)}u`);
  }
  report(
    "G4. Car crushed between an attacker and an obstacle",
    deepestGeom > DRIVE_CONFIG.carHeight / 2 ? "FINDING" : deepestGeom > 1 ? "KNOWN-BY-DESIGN" : "OK",
    `collide.ts documents this concession explicitly (cars rank below obstacles, and the squeezed\n` +
      `car can hold an overlap "as deep as a full car dimension").\n` +
      rows.join("\n") +
      `\nworst car-car ${deepest.toFixed(1)}u, worst hull-inside-wall ${deepestGeom.toFixed(1)}u ` +
      `(hull is ${DRIVE_CONFIG.carWidth}x${DRIVE_CONFIG.carHeight})`,
  );
}

/* ------------------------------------------------- G5. aim-assist lock through level geometry */
/** `updateLock` raycasts line of sight. A lock held through a solid block would aim shots at a wall. */
function lockThroughWall(): void {
  const box = ARENA.obstacles[2]!;
  const y = box.y + box.h / 2;
  // Shooter and target on opposite faces of the block, inside lockRange (400).
  const sx = box.x - 60;
  const tx = box.x + box.w + 60;
  const gap = tx - sx;
  const w = new PlaytestWorld(
    [
      { id: "s", carId: "bullseye", x: sx, y, angle: 0, team: 0 },
      { id: "t", carId: "bastion", x: tx, y, angle: 0, team: 0 },
    ],
    "ffa",
    "arena-02",
  );
  const bit = slotBitFor("bullseye", "predator");
  let lockedTicks = 0;
  for (let i = 0; i < 120; i++) {
    w.input("s", { fireSlots: bit });
    w.tick();
    if (w.get("s").lockTargetSessionId === "t") lockedTicks++;
  }
  // Control: same distance, no wall between them.
  const clear = new PlaytestWorld(
    [
      { id: "s", carId: "bullseye", x: 200, y: 1800, angle: 0, team: 0 },
      { id: "t", carId: "bastion", x: 200 + gap, y: 1800, angle: 0, team: 0 },
    ],
    "ffa",
    "arena-02",
  );
  let clearLocked = 0;
  for (let i = 0; i < 120; i++) {
    clear.input("s", { fireSlots: bit });
    clear.tick();
    if (clear.get("s").lockTargetSessionId === "t") clearLocked++;
  }
  report(
    "G5. Aim-assist lock through a solid block",
    lockedTicks > 5 ? "FINDING" : "OK",
    `${gap}u apart (lockRange ${AIM_CONFIG.lockRange}), wall between: locked on ${lockedTicks}/120 ticks\n` +
      `same distance in the open (control): locked on ${clearLocked}/120 ticks\n` +
      `losGraceMs is ${AIM_CONFIG.losGraceMs}, so a few ticks of grace after sight is lost is expected.`,
  );
}

/* --------------------------------------------------- G6. beam fired with its muzzle in a wall */
/** `wallClipDistance` samples from d=0, so a muzzle buried in a wall should reach 0. */
function beamInWall(): void {
  const box = ARENA.obstacles[2]!;
  const rows: string[] = [];
  let leak = false;
  for (const id of ["afterburner", "lance"] as WeaponId[]) {
    const carrier = carrierOf(id);
    const bit = slotBitFor(carrier, id);
    // Shooter nosed into the block's west face, firing east — the muzzle lands inside the wall.
    const w = new PlaytestWorld(
      [
        { id: "s", carId: carrier, x: box.x - 20, y: box.y + box.h / 2, angle: 0, team: 0 },
        { id: "t", carId: "bastion", x: box.x + box.w + 40, y: box.y + box.h / 2, angle: 0, team: 0 },
      ],
      "ffa",
      "arena-02",
    );
    const hp0 = w.get("t").hp;
    let maxExtent = 0;
    for (let i = 0; i < 150; i++) {
      w.input("s", { fireSlots: i === 0 ? bit : 0 });
      w.tick();
      for (const inst of w.instances()) maxExtent = Math.max(maxExtent, inst.extent);
    }
    const dealt = hp0 - w.get("t").hp;
    // magmablast's SHELL dies on the wall like any projectile; its 60u burst is a disc, and a disc
    // has no axis for the wall raycast to follow, so the splash does reach the far side. Damage
    // here is the explosion by design (spec P17), not a leak.
    if (dealt > 0 && id !== "magmablast") leak = true;
    rows.push(
      `${id.padEnd(11)} muzzle inside the block: max extent ${maxExtent.toFixed(0)}u, ` +
        `damage to the car on the far side ${dealt} ${dealt > 0 ? (id === "magmablast" ? "(disc burst — no wall clip, by design)" : "<- THROUGH THE WALL") : ""}`,
    );
  }
  report("G6. Beam fired with its muzzle buried in level geometry", leak ? "FINDING" : "OK", rows.join("\n"));
}

/* ------------------------------------------------------- G7. six-car spawn overlap at match start */
function spawnOverlap(): void {
  const rows: string[] = [];
  let bad = false;
  for (const arenaId of ["arena-01", "arena-02"]) {
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
        if (arenaId === "arena-02" && insideObstacle(a.x, a.y, a.angle) > 0) inWall++;
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
concaveCorners();
crushAgainstObstacle();
lockThroughWall();
beamInWall();
spawnOverlap();

reporter.finish();
