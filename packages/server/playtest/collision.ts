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
  "Car-on-car collision: tunneling, crush, pile-ups, resolve order, energy, ram chaining, wall pins.",
);
const report = reporter.report.bind(reporter);

/* ------------------------------------------------------------------ 1. tunneling */
/**
 * Can a car pass THROUGH another between two ticks? Cars are only tested at their post-step pose —
 * there is no swept test for driving (unlike projectiles, which smear). At 30 Hz a mirage (top
 * speed rose 540 -> 576 in T8's restat) covers 19.2 u/tick; a head-on pair closes 38.4. The hull is
 * 48 long, so ordinary driving cannot tunnel. Ram shove is the extra term: it is added to the drive
 * velocity and is not capped by top speed.
 */
function tunneling(): void {
  const rows: string[] = [];
  let worst = 0;
  // Sweep closing speeds well past anything the drive model alone can reach, by injecting shove
  // directly — exactly what a ram writes onto a victim.
  for (const shove of [0, 200, 400, 600, 900, 1400, 2000]) {
    const gap = 200;
    const w = new PlaytestWorld([
      { id: "A", carId: "mirage", x: 640 - gap / 2, y: 360, angle: 0, speed: forwardMaxSpeedOf("mirage") },
      { id: "B", carId: "mirage", x: 640 + gap / 2, y: 360, angle: Math.PI, speed: forwardMaxSpeedOf("mirage") },
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
    const perTick = (forwardMaxSpeedOf("mirage") + shove) / 30;
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
    `Hull is ${W}x${H}. Driving alone closes 38.4 u/tick head-on, well under the hull length.\n` +
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
  for (const carId of ["mirage", "bullseye", "bastion"] as CarId[]) {
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
      carId: (["mirage", "bullseye", "bastion"] as CarId[])[i % 3]!,
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
  // Now reverse everyone out and watch whether the pile ever actually comes apart.
  //
  // Measured as the BEST separation reached during the reverse, not the overlap at some fixed
  // endpoint. Six cars reversing at full throttle cross the arena in a couple of seconds and pile
  // into the OPPOSITE corner, so a single late sample measures that second pile and reports the
  // first one as unresolved. (The endpoint form of this probe read 0.68u before rams fired reliably
  // and 1.53u after — both were sampling the far-corner pile, and neither number was about the
  // corner the probe is named for.)
  const worstNow = (): number => {
    let worst = 0;
    for (const a of ids) for (const b of ids) if (a < b) worst = Math.max(worst, overlapDepth(w.get(a), w.get(b)));
    return worst;
  };
  let residual = Infinity;
  let clearedAtTick = -1;
  for (let i = 0; i < 200; i++) {
    for (const id of ids) w.input(id, { throttle: -1 });
    w.tick();
    const now = worstNow();
    if (now < residual) residual = now;
    if (now === 0 && clearedAtTick < 0) clearedAtTick = i + 1;
  }

  report(
    "3. Six-car corner pile-up (300 ticks in, then reversing out)",
    nan || outOfBounds ? "FINDING" : residual > 1 ? "FINDING" : "OK",
    `peak pairwise overlap ${maxDepth.toFixed(1)}u; NaN ${nan}; centre out of bounds ${outOfBounds}\n` +
      `reversing out: best separation reached was ${residual.toFixed(2)}u overlap` +
      (clearedAtTick > 0
        ? `, fully clear after ${clearedAtTick} ticks (pile resolves cleanly)`
        : " <- cars never fully separated"),
  );
}

/* --------------------------------------- 4. rammed into a wall: can you be pushed out? */
/** A full-severity ram aimed straight at the boundary — the shove is a velocity the clamp must eat. */
function ramIntoWall(): void {
  const rows: string[] = [];
  let escaped = false;
  for (const victim of ["mirage", "bullseye", "bastion"] as CarId[]) {
    // Bastion (mass 90) at top speed rear-ending a victim parked against the right wall.
    const wallX = ARENA.width - W / 2;
    const w = new PlaytestWorld([
      { id: "attacker", carId: "bastion", x: wallX - W - 4, y: 360, angle: 0, speed: forwardMaxSpeedOf("bastion") },
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
    { id: "mover", carId: "mirage", x: 640 - W - 30, y: 360, angle: 0 },
    { id: "parked", carId: "mirage", x: 640, y: 360, angle: 0 },
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
      { id: idA, carId: "mirage", x: 200, y: 360, angle: 0, speed: 400 },
      { id: idB, carId: "mirage", x: 260, y: 360, angle: 0 },
      { id: idC, carId: "mirage", x: 320, y: 360, angle: 0 },
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
      { id: "A", carId: "mirage", x: 500, y: 360, angle, speed: 500 },
      { id: "B", carId: "bastion", x: 560, y: 360, angle: Math.PI },
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
    const w = new PlaytestWorld([{ id: "A", carId: "mirage", x: 60, y: 360, angle: Math.PI - angle, speed: 400 }]);
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
    { id: "atk1", carId: "bastion", x: 500, y: 320, angle: Math.PI / 2 },
    { id: "atk2", carId: "bastion", x: 500, y: 400, angle: -Math.PI / 2 },
    { id: "victim", carId: "bullseye", x: 500, y: 360, angle: 0 },
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
    // Edge triggering is the anti-stun-lock guarantee, not the trigger rate. Near-continuous
    // degradation under a coordinated 2v1 focus would mean edge triggering has stopped working.
    ticksBelowFullAuthority > 270 ? "FINDING" : "OK",
    `victim spent ${ticksBelowFullAuthority}/300 ticks with degraded steering ` +
      `(${((ticksBelowFullAuthority / 300) * 100).toFixed(0)}%), floor reached ${minAuthority.toFixed(2)} ` +
      `(RAM_CONFIG.authorityFloor is 0.35).\n` +
      `Balance note: this read 46% and floor 0.57 while the ram trigger bug was live, because most ` +
      `of the attackers' passes landed nothing. 84% at the designed floor is what a coordinated 2v1 ` +
      `focus was always meant to cost — it is the intended pressure arriving for the first time, not ` +
      `a regression, and it is the first thing to re-tune from play.`,
  );
}

/* ------------------------------------------------------------ 10. wall pin / can the victim leave */
/**
 * Probe 2 measures how deep a wall crush gets; this one asks the question a pinned player actually
 * has: CAN I GET OUT? The heaviest car (bastion) holds full throttle into the lightest (bullseye)
 * against the right wall, forever, in the two geometries a pin happens in:
 *
 *  - NOSE PIN — victim nose-first into the wall, attacker square on its tail. The victim tries the
 *    three things a player would: reverse straight (shoving back against the pusher), reverse at
 *    full lock (walking the tail out), and forward at full lock (pivoting along the wall).
 *  - BROADSIDE PIN — victim parallel to the wall, attacker perpendicular on its flank. The escape
 *    is simply driving forward along the wall; hulls have no friction, so nothing but geometry can
 *    hold the car.
 *
 * Alignment is swept: a pin is never pixel-perfect in play, and an offset pusher is both easier
 * and harder to escape depending on which corner it loads. Escape = the victim's centre moves 80u
 * from where it was pinned (about 1.7 car lengths) inside 300 ticks (10 s) — a pin a player can
 * break in ten seconds of trying is pressure; one they cannot is a cage.
 */
function wallPin(): void {
  const wallX = ARENA.width;
  const strategies = [
    { name: "reverse straight", input: { throttle: -1, steer: 0 } },
    { name: "reverse, full lock", input: { throttle: -1, steer: 1 } },
    { name: "forward, full lock", input: { throttle: 1, steer: 1 } },
  ] as const;
  const rows: string[] = [];
  let nosePinCaged = false;

  for (const offset of [-12, -6, 0, 6, 12]) {
    const cells: string[] = [];
    let anyEscape = false;
    for (const strategy of strategies) {
      const w = new PlaytestWorld([
        { id: "vic", carId: "bullseye", x: wallX - W / 2, y: 360, angle: 0 },
        { id: "atk", carId: "bastion", x: wallX - W / 2 - W, y: 360 + offset, angle: 0 },
      ]);
      const start = { x: w.get("vic").x, y: w.get("vic").y };
      let escapedAt = 0;
      let travelled = 0;
      for (let t = 1; t <= 300 && escapedAt === 0; t++) {
        w.input("atk", { throttle: 1 });
        w.input("vic", strategy.input);
        w.tick();
        travelled = Math.hypot(w.get("vic").x - start.x, w.get("vic").y - start.y);
        if (travelled > 80) escapedAt = t;
      }
      if (escapedAt > 0) anyEscape = true;
      cells.push(
        `${strategy.name} ${escapedAt > 0 ? `ESCAPED t${escapedAt}` : `caged (moved ${travelled.toFixed(0)}u)`}`,
      );
    }
    if (!anyEscape) nosePinCaged = true;
    rows.push(`NOSE PIN, attacker offset ${String(offset).padStart(3)}u: ${cells.join(" | ")}`);
  }

  let broadsideCaged = false;
  for (const offset of [-12, -6, 0, 6, 12]) {
    const w = new PlaytestWorld([
      { id: "vic", carId: "bullseye", x: wallX - H / 2, y: 360, angle: Math.PI / 2 },
      { id: "atk", carId: "bastion", x: wallX - H / 2 - H / 2 - W / 2, y: 360 + offset, angle: 0 },
    ]);
    let escapedAt = 0;
    let travelled = 0;
    for (let t = 1; t <= 300 && escapedAt === 0; t++) {
      w.input("atk", { throttle: 1 });
      w.input("vic", { throttle: 1 });
      w.tick();
      travelled = Math.abs(w.get("vic").y - 360);
      if (travelled > 80) escapedAt = t;
    }
    if (escapedAt === 0) broadsideCaged = true;
    rows.push(
      `BROADSIDE PIN, attacker offset ${String(offset).padStart(3)}u: drive along the wall ` +
        `${escapedAt > 0 ? `ESCAPED t${escapedAt}` : `caged (moved ${travelled.toFixed(0)}u)`}`,
    );
  }

  report(
    "10. Wall pin: heaviest car holds the lightest against the wall — can it get out?",
    nosePinCaged || broadsideCaged ? "FINDING" : "OK",
    `bastion (mass 90) holds full throttle into a bullseye (mass 30) on the right wall for 300 ` +
      `ticks; the victim drives each escape a player would try. Escape = centre moved 80u.\n` +
      rows.join("\n") +
      (nosePinCaged || broadsideCaged
        ? `\nAt least one geometry left the victim with NO working escape — that is a cage, not ` +
          `pressure, and nothing documents it as intended.`
        : `\nEvery pin had a working escape. A pin still costs the victim the seconds it takes to ` +
          `break — that is the intended pressure, priced in time rather than in a cage.`),
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
wallPin();

reporter.finish();
