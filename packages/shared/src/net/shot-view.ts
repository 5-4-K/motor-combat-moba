import { TICK_RATE_HZ } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { instanceDefOf, isWeaponId } from "../config/weapon-config.js";
import type { WeaponDef } from "../config/weapon-types.js";
import { msToTicks } from "../config/weapon-ticks.js";
import { bornOlder, hitsWorld } from "../sim/combat.js";
import {
  beamOriginOf,
  beamReachOf,
  instanceExpired,
  lifetimeExpiryTick,
  stepInstance,
  travelledAfter,
  type OwnerPose,
  type StepInstanceContext,
  type WeaponInstance,
} from "../sim/weapons/instances.js";

/** The server's own per-tick `dt` (`runPipeline`: `1 / hz`), so every step here is its step. */
const DT = 1 / TICK_RATE_HZ;

/**
 * How far past its newest snapshot a shot may be drawn (NR40): `maxExtrapolateMs + maxDelayMs`,
 * whole ticks. The local predicted tick runs ahead of the newest snapshot by the input lead plus
 * the downlink — on a slow link more than `maxExtrapolateMs` alone — and the adaptive remote delay
 * (`maxDelayMs`) bounds how stale a snapshot the drawing may still be standing on. A function, not
 * a module-scope constant, so nothing is frozen at import.
 */
export function shotViewMaxTicks(): number {
  return msToTicks(NET_CONFIG.maxExtrapolateMs + NET_CONFIG.maxDelayMs);
}

/** The fields a networked instance row carries (`WeaponInstanceState`) that the motion reads. */
export interface WireShot {
  id: string;
  ownerSessionId: string;
  weaponId: string;
  x: number;
  y: number;
  angle: number;
  extent: number;
  spawnTick: number;
  isExplosion: boolean;
  lifeOffsetTicks: number;
}

/**
 * A sim `WeaponInstance` rebuilt from its wire row as it stands at `snapshotTick`, for drawing only,
 * or `undefined` for a weapon id this build does not know.
 *
 * The two clocks that END a projectile are re-derived exactly, from the same helpers the server
 * froze them with: `expiresAtTick` is `lifetimeExpiryTick` at the spawn tick, aged by the press's
 * shot compensation through the server's own `bornOlder`; `distance` is `travelledAfter` the
 * `snapshotTick − spawnTick + lifeOffsetTicks` steps it has flown (a newborn is not stepped on its
 * spawn tick, and a compensated one is fast-forwarded `lifeOffsetTicks` steps on it — NR37).
 * Everything else the wire does not carry is filled the way it reads for motion: `kind` and
 * `attached` from the weapon's definition, no homing target (see `ShotView`), no damage. Never
 * handed to anything that decides a hit.
 */
export function shotFromWire(row: WireShot, snapshotTick: number): WeaponInstance | undefined {
  if (!isWeaponId(row.weaponId)) return undefined;
  const def = instanceDefOf(row.weaponId, row.isExplosion);
  if (def.kind === "maneuver") return undefined;
  const born: WeaponInstance = {
    id: row.id,
    ownerSessionId: row.ownerSessionId,
    finalWave: true,
    ownerTeam: 0,
    damage: 0,
    weaponId: row.weaponId,
    kind: def.kind,
    x: row.x,
    y: row.y,
    angle: row.angle,
    extent: row.extent,
    spawnTick: row.spawnTick,
    distance: 0,
    pierceLeft: def.kind === "projectile" ? def.pierce : 0,
    attached: def.kind === "beam" ? def.attached : false,
    damageClock: new Map(),
    alive: true,
    muzzleDir: 0,
    homingTargetId: "",
    homingUntilTick: 0,
    expiresAtTick: row.isExplosion ? 0 : lifetimeExpiryTick(def, row.spawnTick),
    isExplosion: row.isExplosion,
    pressId: "",
  };
  const aged = row.lifeOffsetTicks > 0 ? bornOlder(born, row.lifeOffsetTicks) : born;
  if (def.kind !== "projectile") return { ...aged, lifeOffsetTicks: row.lifeOffsetTicks };
  const flown = Math.max(0, snapshotTick - row.spawnTick + row.lifeOffsetTicks);
  return { ...aged, distance: travelledAfter(def, flown, DT) };
}

/** Where a shot is drawn: the only fields drawing reads. */
export interface ShotPose {
  x: number;
  y: number;
  angle: number;
  extent: number;
}

/**
 * A straight shot — a projectile that neither bounces nor homes — solved in closed form from one
 * snapshot: pose at `tick + n` is the snapshot pose plus `n` steps along its fixed heading. Its end is
 * found once, lazily and ahead of need: the tick its range or lifetime clock (the shared
 * `instanceExpired`, distance accumulated as the server accumulates it) or the server's own wall test
 * (`hitsWorld`) ends it.
 */
interface LinePath {
  kind: "line";
  tick: number;
  x0: number;
  y0: number;
  angle: number;
  ux: number;
  uy: number;
  /** Ticks past `tick` known not to have ended; `dClear` is the distance there. */
  clearTo: number;
  dClear: number;
  /** The tick offset the shot is gone on (expired or hit a wall), or Infinity while unknown. */
  stop: number;
}

/**
 * Anything else that flies (a bouncing or homing projectile, a detached beam): `stepInstance` one tick
 * at a time, cached and extended, the same end rules checked after every step.
 */
interface StepPath {
  kind: "step";
  tick: number;
  /** `steps[n]` is the instance at `tick + n`. */
  steps: WeaponInstance[];
  /** `steps` start at this index (a confirmed snapshot advances it rather than slicing). */
  base: number;
  stop: number;
}

type Path = LinePath | StepPath;

/** History ring length: snapshots kept to draw a shot BEHIND its newest one (a spectator's R). */
const HISTORY = 32;

interface Ease {
  dx: number;
  dy: number;
  mag: number;
  tick: number;
  perTick: number;
}

interface Entry {
  motion: "path" | "attached" | "still";
  def: WeaponDef;
  /** The newest snapshot's instance (with re-derived clocks). */
  source: WeaponInstance;
  newest: number;
  /** Was this shot first seen on its own spawn tick? Then it did not exist before it. */
  bornSeen: boolean;
  firstTick: number;
  world: { obstacles: StepInstanceContext["obstacles"]; bounds: StepInstanceContext["bounds"] };
  ownerPose: OwnerPose | null;
  path: Path | undefined;
  prevPath: Path | undefined;
  ease: Ease | undefined;
  perTick: number;
  // The snapshot history, as a ring.
  hTick: Float64Array;
  hX: Float64Array;
  hY: Float64Array;
  hAngle: Float64Array;
  hExtent: Float64Array;
  hCount: number;
  hHead: number;
  /** The pose `at` hands back, reused: valid until the next `at` for this id. */
  out: ShotPose;
  /** An attached beam's last raycast, reused while the drawn owner pose has not moved. */
  reachMemo: { x: number; y: number; angle: number; reach: number } | undefined;
}

/**
 * Shots drawn at the local present (NR40). Each instance's newest snapshot is advanced to the tick the
 * local car is drawn at with the SHARED motion — `stepInstance` (which reflects a bouncing row through
 * `bounceOffWorld`, exactly as `runCombat`'s step does), or its closed form for a straight shot —
 * against the arena's walls and obstacles, cars ignored. Its end is the server's rule applied to the
 * server's numbers: a shot is drawn up to the tick its range or lifetime clock (`instanceExpired`) or
 * the wall test (`hitsWorld`) ends it, and HIDDEN from that tick on, until its removal arrives. A hit
 * on a car is not foreseen (cars ignored): that end is the server's removal alone.
 *
 * A tick BEHIND the newest snapshot (a spectator draws at the remotes' render tick) is read off the
 * snapshot history instead, the server's own poses interpolated, and a shot first seen on its spawn
 * tick is not drawn before it — so a spectator's shots stand where the cars they fly among are drawn.
 *
 * - **Homing**: held on its heading. The target is chosen and steered at on the server (never
 *   networked); a client guess could curve the drawn shot AWAY from the server's, which straight
 *   extrapolation never does by more than the server's own curve. A newer snapshot that moves the
 *   path is eased: it snaps at most one tick of its own motion, and closes the rest at one tick of
 *   motion per tick.
 * - **Attached beams** re-anchor to the owner's DRAWN pose (passed to `at`) through the shared
 *   `beamOriginOf`/`beamReachOf` — welded to the car on screen, never extrapolated as free shots.
 * - **Explosions** are stationary.
 */
export class ShotView {
  private readonly shots = new Map<string, Entry>();

  constructor(private readonly maxTicks: number) {}

  /** Whether `id` already holds the snapshot at `tick` (so the caller may skip rebuilding it). */
  isCurrent(id: string, tick: number): boolean {
    return this.shots.get(id)?.newest === tick;
  }

  /** Whether `id` is an attached beam, the one motion `at` reads a drawn owner pose for. */
  isAttached(id: string): boolean {
    return this.shots.get(id)?.motion === "attached";
  }

  /**
   * A snapshot's instance at its snapshot tick (`shotFromWire(row, tick)`). `world.ownerPose` is the
   * owner's pose in that same snapshot (read for an attached beam's muzzle); `world.homingTarget` and
   * `dt`/`tick` are ignored. Repeating the same tick keeps the cache.
   */
  update(id: string, tick: number, instance: WeaponInstance, world: StepInstanceContext): void {
    let entry = this.shots.get(id);
    if (entry && entry.newest === tick) return;
    if (!entry) {
      const def = instanceDefOf(instance.weaponId, instance.isExplosion);
      const motion = instance.isExplosion ? "still" : instance.attached ? "attached" : "path";
      entry = {
        motion,
        def,
        source: instance,
        newest: tick,
        bornSeen: tick <= instance.spawnTick,
        firstTick: tick,
        world: { obstacles: world.obstacles, bounds: world.bounds },
        ownerPose: world.ownerPose,
        path: undefined,
        prevPath: undefined,
        ease: undefined,
        perTick: motion === "path" && instance.kind === "projectile" ? def.speed * DT : 0,
        hTick: new Float64Array(HISTORY),
        hX: new Float64Array(HISTORY),
        hY: new Float64Array(HISTORY),
        hAngle: new Float64Array(HISTORY),
        hExtent: new Float64Array(HISTORY),
        hCount: 0,
        hHead: 0,
        out: { x: instance.x, y: instance.y, angle: instance.angle, extent: instance.extent },
        reachMemo: undefined,
      };
      this.shots.set(id, entry);
    }
    if (entry.motion === "attached" && world.ownerPose) {
      instance = { ...instance, muzzleDir: nearestMuzzle(instance.angle - world.ownerPose.angle, entry.def.muzzles) };
    }
    entry.source = instance;
    entry.newest = tick;
    entry.world.obstacles = world.obstacles;
    entry.world.bounds = world.bounds;
    entry.ownerPose = world.ownerPose;
    record(entry, tick, instance);
    if (entry.motion !== "path") return;
    if (entry.path && this.confirms(entry, entry.path, tick, instance)) return;
    entry.prevPath = entry.path;
    entry.path = newPath(entry, tick, instance);
  }

  /**
   * The pose at (fractional) `tick`, or `undefined` when the shot is not drawn there: past its end, or
   * before it was fired. Ahead of the newest snapshot it is the shared motion, capped at `maxTicks`;
   * behind it, the snapshot history. `ownerPose` is the owner's drawn pose, read by an attached beam
   * only (absent: its snapshot pose). The returned object is reused — read it before the next `at`.
   */
  at(id: string, tick: number, ownerPose?: OwnerPose): Readonly<ShotPose> | undefined {
    const entry = this.shots.get(id);
    if (!entry) return undefined;
    const out = entry.out;
    if (tick <= entry.newest) {
      if (!fromHistory(entry, tick, out)) return undefined;
      if (entry.motion === "attached") this.weld(entry, out.extent, 0, ownerPose, out);
      return out;
    }
    const capped = Math.min(tick, entry.newest + this.maxTicks);
    const ahead = capped - entry.newest;
    if (entry.motion === "still") {
      if (instanceExpired(entry.source, Math.floor(capped), entry.def)) return undefined;
      return setPose(out, entry.source.x, entry.source.y, entry.source.angle, entry.source.extent);
    }
    if (entry.motion === "attached") {
      if (instanceExpired(entry.source, Math.floor(capped), entry.def)) return undefined;
      this.weld(entry, entry.source.extent, ahead, ownerPose, out);
      return out;
    }
    const path = entry.path!;
    if (!this.onPath(entry, path, capped, out)) {
      entry.prevPath = undefined;
      return undefined;
    }
    if (entry.prevPath) {
      const prev = entry.prevPath;
      entry.prevPath = undefined;
      const nx = out.x;
      const ny = out.y;
      if (this.onPath(entry, prev, capped, out)) {
        const old = withEase(out, entry.ease, capped);
        const dx = old.x - nx;
        const dy = old.y - ny;
        const gap = Math.hypot(dx, dy);
        entry.ease =
          entry.perTick > 0 && gap > entry.perTick
            ? { dx: dx * ((gap - entry.perTick) / gap), dy: dy * ((gap - entry.perTick) / gap), mag: gap - entry.perTick, tick: capped, perTick: entry.perTick }
            : undefined;
      }
      this.onPath(entry, path, capped, out);
    }
    return withEase(out, entry.ease, capped);
  }

  forget(id: string): void {
    this.shots.delete(id);
  }

  /** Forget every id not in `live` — the per-frame sweep, with no array built. */
  forgetAllBut(live: ReadonlySet<string>): void {
    for (const id of this.shots.keys()) if (!live.has(id)) this.shots.delete(id);
  }

  /** The ids this view holds. */
  ids(): IterableIterator<string> {
    return this.shots.keys();
  }

  /** Does `instance` at `tick` land where `path` already said it would? Then keep the path. */
  private confirms(entry: Entry, path: Path, tick: number, instance: WeaponInstance): boolean {
    const n = tick - path.tick;
    if (n <= 0) return false;
    if (path.kind === "line") {
      this.extendLine(entry, path, n);
      if (n >= path.stop) return false;
      return near(path.x0 + path.ux * n, instance.x) && near(path.y0 + path.uy * n, instance.y) && near(path.angle, instance.angle);
    }
    const known = this.stepTo(entry, path, n);
    if (!known || n >= path.stop) return false;
    if (!(near(known.x, instance.x) && near(known.y, instance.y) && near(known.angle, instance.angle) && near(known.extent, instance.extent))) {
      return false;
    }
    // Keep the confirmed path, re-rooted on the server's own instance at `tick`.
    path.base += n;
    path.steps[path.base] = instance;
    path.tick = tick;
    path.stop -= n;
    if (path.base > HISTORY) {
      path.steps.splice(0, path.base);
      path.base = 0;
    }
    return true;
  }

  /** The pose on `path` at absolute (fractional) `tick` into `out`; false when the shot has ended. */
  private onPath(entry: Entry, path: Path, tick: number, out: ShotPose): boolean {
    const a = tick - path.tick;
    const lo = Math.floor(a);
    if (path.kind === "line") {
      this.extendLine(entry, path, Math.ceil(a));
      if (a >= path.stop) return false;
      // Between the last live tick and the end, it holds rather than sliding into the wall.
      const n = lo + 1 >= path.stop ? lo : a;
      setPose(out, path.x0 + path.ux * n, path.y0 + path.uy * n, path.angle, 0);
      return true;
    }
    const sa = this.stepTo(entry, path, lo);
    if (!sa || a >= path.stop) return false;
    const frac = a - lo;
    const sb = frac > 0 ? this.stepTo(entry, path, lo + 1) : undefined;
    if (!sb || lo + 1 >= path.stop) return setPose(out, sa.x, sa.y, sa.angle, sa.extent) !== undefined;
    setPose(
      out,
      sa.x + (sb.x - sa.x) * frac,
      sa.y + (sb.y - sa.y) * frac,
      // A bounce flips the heading inside the tick; it is drawn turned from the half-way point.
      frac < 0.5 ? sa.angle : sb.angle,
      sa.extent + (sb.extent - sa.extent) * frac,
    );
    return true;
  }

  /**
   * Make sure `path`'s end is known through offset `need`. Looks a whole cap ahead at a time, so a
   * steady frame usually asks nothing: the clocks are scalar, and the wall test is ONE `hitsWorld`
   * over the whole stretch (a straight shot's smear from `a` to `b` is the union of its per-tick
   * smears), bisected only when that stretch does hit.
   */
  private extendLine(entry: Entry, path: LinePath, need: number): void {
    if (need <= path.clearTo || path.stop !== Infinity) return;
    const to = need + this.maxTicks;
    const probe = scratchA;
    probe.weaponId = entry.source.weaponId;
    probe.isExplosion = false;
    probe.kind = "projectile";
    probe.expiresAtTick = entry.source.expiresAtTick;
    probe.spawnTick = entry.source.spawnTick;
    let d = path.dClear;
    let expiry = Infinity;
    let dAt = d;
    for (let n = path.clearTo + 1; n <= to; n++) {
      d = travelledAfter(entry.def, 1, DT, d);
      probe.distance = d;
      if (instanceExpired(probe, path.tick + n, entry.def)) {
        expiry = n;
        break;
      }
      dAt = d;
    }
    const wallTo = Math.min(to, expiry - 1);
    if (wallTo > path.clearTo && this.lineHits(entry, path, path.clearTo, wallTo)) {
      let lo = path.clearTo;
      let hi = wallTo;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.lineHits(entry, path, path.clearTo, mid)) hi = mid;
        else lo = mid;
      }
      path.stop = hi;
      return;
    }
    if (expiry !== Infinity) {
      path.stop = expiry;
      return;
    }
    path.clearTo = to;
    path.dClear = dAt;
  }

  /** The server's wall test over a straight shot's travel from offset `from` to `to`. */
  private lineHits(entry: Entry, path: LinePath, from: number, to: number): boolean {
    linePose(scratchB, entry.source.weaponId, path, from);
    linePose(scratchA, entry.source.weaponId, path, to);
    return hitsWorld(scratchA, scratchB, entry.world);
  }

  private stepTo(entry: Entry, path: StepPath, n: number): WeaponInstance | undefined {
    if (n >= path.stop) return path.steps[path.base + path.stop - 1];
    while (path.steps.length - path.base <= n) {
      const k = path.steps.length - path.base;
      const last = path.steps[path.steps.length - 1]!;
      const tick = path.tick + k;
      const next = stepInstance(
        last,
        { dt: DT, tick, obstacles: entry.world.obstacles, bounds: entry.world.bounds, ownerPose: null, homingTarget: null },
        entry.def,
      );
      // The server's end rules, in its order: the clock, then the world.
      if (
        (next.kind === "projectile" && instanceExpired(next, tick, entry.def)) ||
        (next.kind === "projectile" && hitsWorld(next, last, entry.world))
      ) {
        path.stop = k;
        return path.steps[path.base + k - 1];
      }
      path.steps.push(next);
    }
    return path.steps[path.base + n];
  }

  /** An attached beam welded to `ownerPose` (or its snapshot owner), grown `ahead` ticks. */
  private weld(entry: Entry, extent: number, ahead: number, ownerPose: OwnerPose | undefined, out: ShotPose): void {
    const origin = beamOriginOf(entry.source, entry.def, ownerPose ?? entry.ownerPose);
    let memo = entry.reachMemo;
    if (!memo || memo.x !== origin.x || memo.y !== origin.y || memo.angle !== origin.angle) {
      memo = { x: origin.x, y: origin.y, angle: origin.angle, reach: beamReachOf(entry.def, origin, entry.world.obstacles, entry.world.bounds) };
      entry.reachMemo = memo;
    }
    setPose(out, origin.x, origin.y, origin.angle, Math.min(memo.reach, extent + entry.def.speed * DT * ahead));
  }
}

/** Two scratch instances the wall test reads, reused across every call. */
const scratchA = scratchInstance();
const scratchB = scratchInstance();

function scratchInstance(): WeaponInstance {
  return {
    id: "",
    ownerSessionId: "",
    finalWave: true,
    ownerTeam: 0,
    damage: 0,
    weaponId: "pepperbox",
    kind: "projectile",
    x: 0,
    y: 0,
    angle: 0,
    extent: 0,
    spawnTick: 0,
    distance: 0,
    pierceLeft: 0,
    attached: false,
    damageClock: new Map(),
    alive: true,
    muzzleDir: 0,
    homingTargetId: "",
    homingUntilTick: 0,
    expiresAtTick: 0,
    isExplosion: false,
    pressId: "",
  };
}

function linePose(into: WeaponInstance, weaponId: WeaponInstance["weaponId"], path: LinePath, n: number): void {
  into.weaponId = weaponId;
  into.isExplosion = false;
  into.kind = "projectile";
  into.x = path.x0 + path.ux * n;
  into.y = path.y0 + path.uy * n;
  into.angle = path.angle;
}

function newPath(entry: Entry, tick: number, instance: WeaponInstance): Path {
  const def = entry.def;
  if (def.kind === "projectile" && !def.bounces && !def.homing) {
    const step = def.speed * DT;
    return {
      kind: "line",
      tick,
      x0: instance.x,
      y0: instance.y,
      angle: instance.angle,
      ux: Math.cos(instance.angle) * step,
      uy: Math.sin(instance.angle) * step,
      clearTo: 0,
      dClear: instance.distance,
      stop: Infinity,
    };
  }
  return { kind: "step", tick, steps: [instance], base: 0, stop: Infinity };
}

function record(entry: Entry, tick: number, instance: WeaponInstance): void {
  const i = entry.hHead;
  entry.hTick[i] = tick;
  entry.hX[i] = instance.x;
  entry.hY[i] = instance.y;
  entry.hAngle[i] = instance.angle;
  entry.hExtent[i] = instance.extent;
  entry.hHead = (i + 1) % HISTORY;
  entry.hCount = Math.min(HISTORY, entry.hCount + 1);
}

/** The snapshot history at `tick` (≤ newest) into `out`; false before the shot existed. */
function fromHistory(entry: Entry, tick: number, out: ShotPose): boolean {
  if (tick < entry.firstTick && entry.bornSeen) return false;
  // Newest first: the bracketing pair is near the head for any sane delay.
  let later = -1;
  for (let k = 1; k <= entry.hCount; k++) {
    const i = (entry.hHead - k + HISTORY) % HISTORY;
    const t = entry.hTick[i]!;
    if (t <= tick) {
      if (later < 0 || t === tick) return copyHistory(entry, i, out);
      const tl = entry.hTick[later]!;
      const f = (tick - t) / (tl - t);
      return (
        setPose(
          out,
          entry.hX[i]! + (entry.hX[later]! - entry.hX[i]!) * f,
          entry.hY[i]! + (entry.hY[later]! - entry.hY[i]!) * f,
          f < 0.5 ? entry.hAngle[i]! : entry.hAngle[later]!,
          entry.hExtent[i]! + (entry.hExtent[later]! - entry.hExtent[i]!) * f,
        ) !== undefined
      );
    }
    later = i;
  }
  // Older than everything kept: the oldest kept pose (or nothing, if it was born then).
  return later >= 0 && copyHistory(entry, later, out);
}

function copyHistory(entry: Entry, i: number, out: ShotPose): boolean {
  setPose(out, entry.hX[i]!, entry.hY[i]!, entry.hAngle[i]!, entry.hExtent[i]!);
  return true;
}

function setPose(out: ShotPose, x: number, y: number, angle: number, extent: number): ShotPose {
  out.x = x;
  out.y = y;
  out.angle = angle;
  out.extent = extent;
  return out;
}

/** Within float noise: a path the server's own step reproduces lands on the same pose. */
const SAME_POSE_EPSILON = 1e-6;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= SAME_POSE_EPSILON;
}

function withEase(out: ShotPose, ease: Ease | undefined, tick: number): ShotPose {
  if (!ease) return out;
  const left = ease.mag - ease.perTick * Math.max(0, tick - ease.tick);
  if (left <= 0) return out;
  const s = left / ease.mag;
  out.x += ease.dx * s;
  out.y += ease.dy * s;
  return out;
}

/** The authored muzzle (radians off the heading) nearest `rel`; 0 for a single-muzzle row. */
function nearestMuzzle(rel: number, muzzlesDeg: readonly number[] | undefined): number {
  let best = 0;
  let bestGap = Infinity;
  for (const deg of muzzlesDeg ?? [0]) {
    const dir = (deg * Math.PI) / 180;
    const gap = Math.abs(Math.atan2(Math.sin(rel - dir), Math.cos(rel - dir)));
    if (gap < bestGap) {
      bestGap = gap;
      best = dir;
    }
  }
  return best;
}
