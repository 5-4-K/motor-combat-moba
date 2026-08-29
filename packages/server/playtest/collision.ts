/**
 * Car-on-car collision probes: the corner cases arena/vehicle-combat games classically break on.
 *
 * Each probe places cars at exact poses and speeds and reports a measurement, not a pass/fail —
 * the point is to see what the sim actually does, including where it does something defensible but
 * surprising.
 */
import { DRIVE_CONFIG, forwardMaxSpeedOf, getArena, type CarId } from "@motor-combat-moba/shared";
import { PlaytestWorld, overlapDepth } from "./world.js";
import { Reporter } from "./reporter.js";

const ARENA = getArena("arena-01");
const { carWidth: W, carHeight: H } = DRIVE_CONFIG;

const reporter = new Reporter(
  "collision",
  "Car-on-car collision: tunneling, crush, pile-ups, resolve order, energy, ram chaining.",
);
const report = reporter.report.bind(reporter);

/* ------------------------------------------------------------------ 1. tunneling */
/**
 * Can a car pass THROUGH another between two ticks? Cars are only tested at their post-step pose —
 * there is no swept test for driving (unlike projectiles, which smear). At 30 Hz a rectangle covers
 * 18 u/tick; a head-on pair closes 36. The hull is 48 long, so ordinary driving cannot tunnel. Ram
 * shove is the extra term: it is added to the drive velocity and is not capped by top speed.
 */
function tunneling(): void {
  const rows: string[] = [];
  let worst = 0;
  // Sweep closing speeds well past anything the drive model alone can reach, by injecting shove
  // directly — exactly what a ram writes onto a victim.
  for (const shove of [0, 200, 400, 600, 900, 1400, 2000]) {
    const gap = 200;
    const w = new PlaytestWorld([
      { id: "A", carId: "rectangle", x: 640 - gap / 2, y: 360, angle: 0, speed: forwardMaxSpeedOf("rectangle") },
      { id: "B", carId: "rectangle", x: 640 + gap / 2, y: 360, angle: Math.PI, speed: forwardMaxSpeedOf("rectangle") },
    ]);
    w.get("A").shoveX = shove;
    w.get("B").shoveX = -shove;
    let passedThrough = false;
    for (let i = 0; i < 20; i++) {
      w.input("A", { throttle: 1 });
      w.input("B", { throttle: 1 });
      w.tick();
      // A started left of B. If A ends up right of B, they swapped sides: a tunnel.
      if (w.get("A").x > w.get("B").x) passedThrough = true;
    }
    const perTick = (forwardMaxSpeedOf("rectangle") + shove) / 30;
    // The FIRST shove that tunnels, not the largest — the threshold is the interesting number.
    if (passedThrough && worst === 0) worst = shove;
    rows.push(
      `shove ${String(shove).padStart(4)} u/s -> ${(perTick * 2).toFixed(1)} u/tick closing, ` +
        `${passedThrough ? "TUNNELED" : "blocked"}`,
    );
  }
  // 260 * 1.6 is knockMaxSpeed * massFactorMax: the hardest shove the shipped ram can write.
  const maxRamShove = 260 * 1.6;
  report(
    "1. Car-car tunneling at extreme closing speed",
    worst > 0 && worst <= maxRamShove ? "FINDING" : "OK",
    `Hull is ${W}x${H}. Driving alone closes 36 u/tick head-on, well under the hull length.\n` +
      rows.join("\n") +
      (worst > 0
        ? `\nFirst tunnel at injected shove ${worst} u/s on BOTH cars. The hardest shove the ram can ` +
          `write is ${maxRamShove} u/s, and only onto one car, so this is out of reach in play.`
        : "\nNo tunnel at any tested closing speed."),
  );
}

/* ------------------------------------------------- 2. wall sandwich / crush depth */
/**
 * The documented concession: `resolveWorld` ranks bounds > obstacles > cars, so a car crushed
 * between another car and a wall holds an overlap and holds it stably. How deep does it actually
 * get with cars driving into each other at full throttle, and does anything escape the arena?
 */
function wallSandwich(): void {
  const rows: string[] = [];
  let deepest = 0;
  let escaped = false;
  for (const carId of ["rectangle", "oval", "hexagon"] as CarId[]) {
    // B parked flush against the left wall, A driving into it at full speed.
    const w = new PlaytestWorld([
      { id: "A", carId, x: 400, y: 360, angle: Math.PI, speed: forwardMaxSpeedOf(carId) },
      { id: "B", carId, x: W / 2, y: 360, angle: Math.PI },
    ]);
    let maxDepth = 0;
    let minX = Infinity;
    for (let i = 0; i < 120; i++) {
      w.input("A", { throttle: 1 });
      w.input("B", { throttle: 0 });
      w.tick();
      maxDepth = Math.max(maxDepth, overlapDepth(w.get("A"), w.get("B")));
      minX = Math.min(minX, w.get("B").x);
    }
    // Out-of-arena is measured on the hull, not the centre.
    const outside = minX < W / 2 - 0.01;
    if (outside) escaped = true;
    deepest = Math.max(deepest, maxDepth);
    rows.push(
      `${carId.padEnd(9)} peak overlap ${maxDepth.toFixed(1)}u, victim min x ${minX.toFixed(1)} ` +
        `(wall-flush is ${(W / 2).toFixed(0)}) ${outside ? "<- LEFT THE ARENA" : ""}`,
    );
  }
  report(
    "2. Crush between a car and the wall",
    escaped ? "FINDING" : deepest > H ? "KNOWN-BY-DESIGN" : "OK",
    `Documented in collide.ts: bounds outrank obstacles outrank cars, so the squeezed car concedes.\n` +
      rows.join("\n") +
      `\nDeepest overlap ${deepest.toFixed(1)}u against a ${H}u hull width. ` +
      (escaped ? "A car left the arena." : "No car left the arena — the bounds clamp held."),
  );
}

/* ------------------------------------------------------ 3. six-car corner pile-up */
/** Max roster, all driving into one corner. Looking for stable interpenetration, NaN, or ejection. */
function pileUp(): void {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const w = new PlaytestWorld(
    ids.map((id, i) => ({
      id,
      carId: (["rectangle", "oval", "hexagon"] as CarId[])[i % 3]!,
      x: 300 + i * 60,
      y: 300 + (i % 2) * 60,
      angle: Math.atan2(80 - (300 + (i % 2) * 60), 80 - (300 + i * 60)),
    })),
  );
  let maxDepth = 0;
  let nan = false;
  let outOfBounds = false;
  for (let i = 0; i < 300; i++) {
    for (const id of ids) w.input(id, { throttle: 1, steer: 0 });
    w.tick();
    for (const a of ids) {
      const pa = w.get(a);
      if (!Number.isFinite(pa.x) || !Number.isFinite(pa.y) || !Number.isFinite(pa.angle)) nan = true;
      if (pa.x < 0 || pa.y < 0 || pa.x > ARENA.width || pa.y > ARENA.height) outOfBounds = true;
      for (const b of ids) {
        if (a >= b) continue;
        maxDepth = Math.max(maxDepth, overlapDepth(pa, w.get(b)));
      }
    }
  }
  // Now reverse everyone out and see whether the pile actually resolves.
  for (let i = 0; i < 200; i++) {
    for (const id of ids) w.input(id, { throttle: -1 });
    w.tick();
  }
  let residual = 0;
  for (const a of ids) for (const b of ids) if (a < b) residual = Math.max(residual, overlapDepth(w.get(a), w.get(b)));

  report(
    "3. Six-car corner pile-up (300 ticks in, 200 reversing out)",
    nan || outOfBounds ? "FINDING" : residual > 1 ? "FINDING" : "OK",
    `peak pairwise overlap ${maxDepth.toFixed(1)}u; NaN ${nan}; centre out of bounds ${outOfBounds}\n` +
      `after reversing out, residual overlap ${residual.toFixed(2)}u ` +
      (residual > 1 ? "<- cars did NOT separate" : "(pile resolves cleanly)"),
  );
}

/* --------------------------------------- 4. rammed into a wall: can you be pushed out? */
/** A full-severity ram aimed straight at the boundary — the shove is a velocity the clamp must eat. */
function ramIntoWall(): void {
  const rows: string[] = [];
  let escaped = false;
  for (const victim of ["rectangle", "oval", "hexagon"] as CarId[]) {
    // Hexagon (mass 85) at top speed rear-ending a victim parked against the right wall.
    const wallX = ARENA.width - W / 2;
    const w = new PlaytestWorld([
      { id: "attacker", carId: "hexagon", x: wallX - W - 4, y: 360, angle: 0, speed: forwardMaxSpeedOf("hexagon") },
      { id: "victim", carId: victim, x: wallX, y: 360, angle: 0 },
    ]);
    let maxX = -Infinity;
    for (let i = 0; i < 90; i++) {
      w.input("attacker", { throttle: 1 });
      w.tick(); // victim sends nothing: exercises the silent-but-knocked coast path
      maxX = Math.max(maxX, w.get("victim").x);
    }
    const out = maxX > wallX + 0.01;
    if (out) escaped = true;
    rows.push(
      `victim ${victim.padEnd(9)} max x ${maxX.toFixed(2)} (wall-flush ${wallX}) ${out ? "<- CLIPPED THROUGH" : "held"}`,
    );
  }
  report(
    "4. Rammed into the arena wall (victim silent — the coast path)",
    escaped ? "FINDING" : "OK",
    rows.join("\n"),
  );
}

/* ---------------------------------- 5. silent, un-knocked player as an immovable wall */
/**
 * `serverTick` only coasts a silent player while `hasKnock` is true. A contact below
 * `RAM_CONFIG.minApproachSpeed` writes no knock at all — so a silent car that is nudged slowly is
 * never stepped, never resolved, and cannot be pushed out of an overlap. Does that let a driver
 * bury themselves in a parked car?
 */
function silentWall(): void {
  // Approach slowly enough to stay under minApproachSpeed (60 u/s) at the moment of contact.
  const w = new PlaytestWorld([
    { id: "mover", carId: "rectangle", x: 640 - W - 30, y: 360, angle: 0 },
    { id: "parked", carId: "rectangle", x: 640, y: 360, angle: 0 },
  ]);
  let maxDepth = 0;
  let knockWritten = false;
  for (let i = 0; i < 200; i++) {
    // Feather the throttle: pulse on/off so speed hovers around 40 u/s, below the ram threshold.
    w.input("mover", { throttle: i % 6 === 0 ? 1 : 0 });
    w.tick();
    const p = w.get("parked");
    if (p.shoveX !== 0 || p.shoveY !== 0 || p.angVel !== 0 || p.authority !== 1) knockWritten = true;
    maxDepth = Math.max(maxDepth, overlapDepth(w.get("mover"), p));
  }
  const parked = w.get("parked");
  report(
    "5. Slow-nudging a silent (AFK/alt-tabbed) car",
    maxDepth > 1 ? "FINDING" : "OK",
    `parked car never moved: x ${parked.x.toFixed(2)}; a ram knock was ${knockWritten ? "" : "never "}written\n` +
      `peak overlap ${maxDepth.toFixed(2)}u — the mover is pushed out by resolveWorld each tick, ` +
      `so the pair ${maxDepth > 1 ? "interpenetrates" : "stays separated"}.`,
  );
}

/* ------------------------------------------------- 6. resolution order dependence */
/**
 * Players are stepped in sorted session-id order and resolve sequentially against the CURRENT poses
 * of the others. So the same geometry with different session ids is a different simulation. How big
 * is the divergence in a realistic squeeze?
 */
function orderDependence(): void {
  const build = (idA: string, idB: string, idC: string) => {
    const w = new PlaytestWorld([
      { id: idA, carId: "rectangle", x: 200, y: 360, angle: 0, speed: 400 },
      { id: idB, carId: "rectangle", x: 260, y: 360, angle: 0 },
      { id: idC, carId: "rectangle", x: 320, y: 360, angle: 0 },
    ]);
    for (let i = 0; i < 60; i++) {
      w.input(idA, { throttle: 1 });
      w.input(idB, { throttle: 1 });
      w.input(idC, { throttle: 0 });
      w.tick();
    }
    return [idA, idB, idC].map((id) => w.get(id).x);
  };
  // Same physical setup, ids that sort in the opposite order.
  const forward = build("aaa", "bbb", "ccc");
  const reverse = build("ccc", "bbb", "aaa");
  const delta = forward.map((x, i) => Math.abs(x - reverse[i]!));
  const worst = Math.max(...delta);
  report(
    "6. Session-id order dependence in a three-car squeeze",
    worst > 1 ? "KNOWN-BY-DESIGN" : "OK",
    `same geometry, ids sorted the other way: per-car x divergence ` +
      `[${delta.map((d) => d.toFixed(2)).join(", ")}] after 60 ticks (worst ${worst.toFixed(2)}u).\n` +
      `Deterministic per room — both halves of the lockstep sort identically — but the car with the ` +
      `lexicographically smaller session id resolves first and keeps its separation.`,
  );
}

/* ----------------------------------------------------- 7. does a collision add energy? */
/** Restitution is 0.35, so every contact must shed speed. Shove reflection is the risky path. */
function energyGain(): void {
  let worstGain = 0;
  let worstCase = "";
  for (let deg = 0; deg < 180; deg += 5) {
    const angle = (deg * Math.PI) / 180;
    const w = new PlaytestWorld([
      { id: "A", carId: "rectangle", x: 500, y: 360, angle, speed: 500 },
      { id: "B", carId: "hexagon", x: 560, y: 360, angle: Math.PI },
    ]);
    w.get("A").shoveX = 300;
    w.get("A").shoveY = 120;
    const before = Math.abs(w.get("A").speed) + Math.hypot(w.get("A").shoveX, w.get("A").shoveY);
    for (let i = 0; i < 3; i++) {
      w.input("A", { throttle: 0 });
      w.input("B", { throttle: 0 });
      w.tick();
      const a = w.get("A");
      const after = Math.abs(a.speed) + Math.hypot(a.shoveX, a.shoveY);
      const gain = after - before;
      if (gain > worstGain) {
        worstGain = gain;
        worstCase = `heading ${deg} deg, tick ${i + 1}: |speed|+|shove| ${before.toFixed(0)} -> ${after.toFixed(0)}`;
      }
    }
  }
  report(
    "7. Energy gain from a contact (restitution 0.35 + shove reflection)",
    worstGain > 1 ? "FINDING" : "OK",
    worstGain > 1
      ? `speed/shove magnitude INCREASED across a contact: ${worstCase}`
      : `no heading gained magnitude across a contact (worst delta ${worstGain.toFixed(3)}).`,
  );
}

/* ------------------------------------------- 8. the documented 30.6-degree speed sign flip */
/** `applyContact` re-projects onto an unchanged facing; the reported sign flips at ~30.6 deg. */
function glancingSignFlip(): void {
  const rows: string[] = [];
  let maxJump = 0;
  let previous: number | null = null;
  for (let deg = 20; deg <= 45; deg += 1) {
    const angle = (deg * Math.PI) / 180;
    // Drive into the left wall at `deg` off the normal.
    const w = new PlaytestWorld([{ id: "A", carId: "rectangle", x: 60, y: 360, angle: Math.PI - angle, speed: 400 }]);
    w.input("A", { throttle: 1 });
    w.tick();
    const s = w.get("A").speed;
    if (previous !== null && Math.abs(s - previous) > maxJump) maxJump = Math.abs(s - previous);
    if (previous !== null && Math.sign(s) !== Math.sign(previous)) {
      rows.push(`sign flips between ${deg - 1} deg (${previous.toFixed(0)}) and ${deg} deg (${s.toFixed(0)})`);
    }
    previous = s;
  }
  report(
    "8. Reported speed sign flip on a glancing wall contact",
    maxJump > 100 ? "KNOWN-BY-DESIGN" : "OK",
    `${rows.join("\n") || "no sign flip in 20-45 deg"}\nlargest one-degree jump in reported speed: ${maxJump.toFixed(0)} u/s.\n` +
      `Documented in collide.ts applyContact note 2. Magnitude is continuous; the SIGN is not, and ` +
      `the HUD/audio read speed.`,
  );
}

/* ------------------------------------------------------------ 9. ram chain / stun-lock */
/** Edge-triggered rams should not stun-lock. Two attackers alternating on one victim is the stress. */
function ramChain(): void {
  const w = new PlaytestWorld([
    { id: "atk1", carId: "hexagon", x: 500, y: 320, angle: Math.PI / 2 },
    { id: "atk2", carId: "hexagon", x: 500, y: 400, angle: -Math.PI / 2 },
    { id: "victim", carId: "oval", x: 500, y: 360, angle: 0 },
  ]);
  let ticksBelowFullAuthority = 0;
  let minAuthority = 1;
  for (let i = 0; i < 300; i++) {
    // Both attackers pump the throttle so they separate and re-approach — a real chain attempt.
    const phase = Math.floor(i / 20) % 2;
    w.input("atk1", { throttle: phase === 0 ? 1 : -1 });
    w.input("atk2", { throttle: phase === 1 ? 1 : -1 });
    w.input("victim", { throttle: 0 });
    w.tick();
    const a = w.get("victim").authority;
    minAuthority = Math.min(minAuthority, a);
    if (a < 0.999) ticksBelowFullAuthority++;
  }
  report(
    "9. Two attackers chain-ramming one victim (300 ticks)",
    ticksBelowFullAuthority > 270 ? "FINDING" : "OK",
    `victim spent ${ticksBelowFullAuthority}/300 ticks with degraded steering ` +
      `(${((ticksBelowFullAuthority / 300) * 100).toFixed(0)}%), floor reached ${minAuthority.toFixed(2)} ` +
      `(RAM_CONFIG.authorityFloor is 0.35).`,
  );
}

/* ---------------------------------------------------------------------------- run */
tunneling();
wallSandwich();
pileUp();
ramIntoWall();
silentWall();
orderDependence();
energyGain();
glancingSignFlip();
ramChain();

reporter.finish();
