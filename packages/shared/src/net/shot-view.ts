import { MS_PER_TICK } from "../constants.js";
import { NET_CONFIG } from "../config/net-config.js";
import { instanceDefOf, isWeaponId } from "../config/weapon-config.js";
import { msToTicks } from "../config/weapon-ticks.js";
import { hitsWorld } from "../sim/combat.js";
import {
  stepInstance,
  type OwnerPose,
  type StepInstanceContext,
  type WeaponInstance,
} from "../sim/weapons/instances.js";

const DT = MS_PER_TICK / 1000;

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
 * A sim `WeaponInstance` rebuilt from its wire row, for drawing only, or `undefined` for a weapon id
 * this build does not know. Everything the wire does not carry is filled the way it reads for MOTION:
 * `kind` and `attached` from the weapon's own definition (the same def `stepInstance` resolves), no
 * homing target (the client has none — see `ShotView`), no flight clock and no damage. Never handed
 * to anything that decides a hit.
 */
export function shotFromWire(row: WireShot): WeaponInstance | undefined {
  if (!isWeaponId(row.weaponId)) return undefined;
  const def = instanceDefOf(row.weaponId, row.isExplosion);
  if (def.kind === "maneuver") return undefined;
  return {
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
    expiresAtTick: 0,
    isExplosion: row.isExplosion,
    pressId: "",
    lifeOffsetTicks: row.lifeOffsetTicks,
  };
}

type Motion = "free" | "attached" | "still";

interface Ease {
  dx: number;
  dy: number;
  /** The offset's magnitude when it was taken, and the tick it was taken at. */
  mag: number;
  tick: number;
  /** One tick of the shot's own motion: the most it may snap, and how fast the offset closes. */
  perTick: number;
}

interface Entry {
  tick: number;
  motion: Motion;
  world: { obstacles: StepInstanceContext["obstacles"]; bounds: StepInstanceContext["bounds"] };
  ownerPose: OwnerPose | null;
  /** `steps[n]` is the instance at `tick + n`. Appended to, or shifted when a newer snapshot confirms it. */
  steps: WeaponInstance[];
  /** The wall test ended the shot after this step; nothing past it is drawn. */
  stopped: boolean;
  /** The path this snapshot superseded, until the first `at` measures the gap against it. */
  prev: Entry | undefined;
  ease: Ease | undefined;
  /** One tick of this shot's own motion, for the ease. 0 for anything that does not fly. */
  perTick: number;
}

/**
 * Shots drawn at the local present (NR40). Each instance's newest snapshot is advanced to the tick
 * the local car is drawn at with the SHARED motion — `stepInstance`, which reflects a bouncing row
 * through `bounceOffWorld` exactly as `runCombat`'s step does — against the arena's walls and
 * obstacles, with cars ignored. A shot's end (a hit, its expiry) is the server's to report: this only
 * stops drawing a non-bouncing shot past the wall the server's own `hitsWorld` would end it on, and
 * holds it there until the removal arrives.
 *
 * Steps are cached per snapshot and extended one tick at a time, like `RemoteReckoner`; a newer
 * snapshot that lands on the cached path (every shot but a homing one the server turned) keeps it,
 * so a steady frame costs about one `stepInstance` + `hitsWorld` per live shot. Between whole ticks
 * the position (and a beam's extent) is lerped.
 *
 * - **Homing**: held on its heading. The target is chosen and steered at on the server
 *   (`acquireByProximity`, `homingTargetId`, neither networked); a client guess at the target could
 *   curve the drawn shot AWAY from the server's, which straight extrapolation never does by more than
 *   the server's own curve. Each newer snapshot carries the server's turn, and the rebase is eased.
 * - **Attached beams** re-anchor to the owner's DRAWN pose, passed to `at` — they are welded to a
 *   car, so they are drawn on the car the player sees, never extrapolated as free shots.
 * - **Explosions** are stationary: nothing to advance.
 *
 * A newer snapshot that moves the path (a homing turn; nothing else does, the motion is otherwise the
 * server's own) is eased: the drawn shot snaps at most one tick of its own motion and closes the
 * rest at one tick of motion per tick.
 */
export class ShotView {
  private readonly shots = new Map<string, Entry>();

  constructor(private readonly maxTicks: number) {}

  /** Whether `id` already holds the snapshot at `tick` (so the caller may skip rebuilding it). */
  isCurrent(id: string, tick: number): boolean {
    return this.shots.get(id)?.tick === tick;
  }

  /** Whether `id` is an attached beam, the one motion `at` reads a drawn owner pose for. */
  isAttached(id: string): boolean {
    return this.shots.get(id)?.motion === "attached";
  }

  /** The ids this view holds. */
  ids(): IterableIterator<string> {
    return this.shots.keys();
  }

  /**
   * A snapshot's instance at its snapshot tick. `world.ownerPose` is the owner's pose in that same
   * snapshot (read for an attached beam's muzzle), `world.homingTarget` is ignored, and `dt`/`tick`
   * are the view's own. Repeating the same tick keeps the cache; a different one rebuilds it.
   */
  update(id: string, tick: number, instance: WeaponInstance, world: StepInstanceContext): void {
    const cur = this.shots.get(id);
    if (cur && cur.tick === tick) return;
    // The newer snapshot landed where the cached path already said it would (every shot whose motion
    // is the server's own — all but a homing turn): keep the path from there rather than re-stepping
    // it, so a steady frame costs one new step per shot instead of a whole lead's worth.
    if (cur && cur.motion === "free" && tick > cur.tick) {
      const d = tick - cur.tick;
      const known = cur.steps[d];
      if (known && samePose(known, instance)) {
        cur.steps = [instance, ...cur.steps.slice(d + 1)];
        cur.tick = tick;
        cur.prev = undefined;
        return;
      }
    }
    const def = instanceDefOf(instance.weaponId, instance.isExplosion);
    const motion: Motion = instance.isExplosion ? "still" : instance.attached ? "attached" : "free";
    let start = instance;
    if (motion === "attached" && world.ownerPose) {
      start = { ...instance, muzzleDir: nearestMuzzle(instance.angle - world.ownerPose.angle, def.muzzles) };
    }
    if (cur) cur.prev = undefined; // at most one superseded path is ever kept
    this.shots.set(id, {
      tick,
      motion,
      world: { obstacles: world.obstacles, bounds: world.bounds },
      ownerPose: world.ownerPose,
      steps: [start],
      stopped: false,
      prev: cur,
      ease: undefined,
      perTick: motion === "free" && instance.kind === "projectile" ? def.speed * DT : 0,
    });
  }

  /**
   * The instance advanced to (fractional) `tick` with the shared motion, cars ignored, capped at
   * `maxTicks` past its snapshot. `ownerPose` is the owner's drawn pose, read by an attached beam
   * only (absent: its snapshot pose).
   */
  at(id: string, tick: number, ownerPose?: OwnerPose): WeaponInstance | undefined {
    const entry = this.shots.get(id);
    if (!entry) return undefined;
    const base = this.sample(entry, tick, ownerPose);
    if (entry.prev) {
      const old = this.drawn(entry.prev, tick, ownerPose);
      entry.prev = undefined;
      const dx = old.x - base.x;
      const dy = old.y - base.y;
      const gap = Math.hypot(dx, dy);
      if (entry.perTick > 0 && gap > entry.perTick) {
        const keep = (gap - entry.perTick) / gap;
        entry.ease = { dx: dx * keep, dy: dy * keep, mag: gap - entry.perTick, tick, perTick: entry.perTick };
      }
    }
    return withEase(base, entry.ease, tick);
  }

  forget(id: string): void {
    this.shots.delete(id);
  }

  private drawn(entry: Entry, tick: number, ownerPose: OwnerPose | undefined): WeaponInstance {
    return withEase(this.sample(entry, tick, ownerPose), entry.ease, tick);
  }

  private sample(entry: Entry, tick: number, ownerPose: OwnerPose | undefined): WeaponInstance {
    const source = entry.steps[0]!;
    if (entry.motion === "still") return source;
    const ahead = Math.max(0, Math.min(tick - entry.tick, this.maxTicks));
    if (entry.motion === "attached") {
      // One step of the elapsed length: a beam's growth is linear and clamped to its wall clip, and
      // the re-anchor reads only the pose it is handed, so this is the shared step, not a copy.
      return stepInstance(source, {
        dt: ahead * DT,
        tick: entry.tick + ahead,
        obstacles: entry.world.obstacles,
        bounds: entry.world.bounds,
        ownerPose: ownerPose ?? entry.ownerPose,
        homingTarget: null,
      });
    }
    const lo = Math.floor(ahead);
    const a = this.stepTo(entry, lo);
    const frac = ahead - lo;
    if (frac === 0) return a;
    const b = this.stepTo(entry, lo + 1);
    if (a === b) return a;
    return {
      ...b,
      x: a.x + (b.x - a.x) * frac,
      y: a.y + (b.y - a.y) * frac,
      // A bounce flips the heading inside the tick; it is drawn turned from the half-way point.
      angle: frac < 0.5 ? a.angle : b.angle,
      extent: a.extent + (b.extent - a.extent) * frac,
    };
  }

  private stepTo(entry: Entry, n: number): WeaponInstance {
    while (entry.steps.length <= n && !entry.stopped) {
      const last = entry.steps[entry.steps.length - 1]!;
      const next = stepInstance(last, {
        dt: DT,
        tick: entry.tick + entry.steps.length,
        obstacles: entry.world.obstacles,
        bounds: entry.world.bounds,
        ownerPose: null,
        homingTarget: null,
      });
      // The server's own wall test: a shot it would end here is drawn no further.
      if (next.kind === "projectile" && hitsWorld(next, last, entry.world)) entry.stopped = true;
      else entry.steps.push(next);
    }
    return entry.steps[Math.min(n, entry.steps.length - 1)]!;
  }
}

/** Within float noise: a path the server's own step reproduces lands on the same pose. */
const SAME_POSE_EPSILON = 1e-6;

function samePose(a: WeaponInstance, b: WeaponInstance): boolean {
  return (
    Math.abs(a.x - b.x) <= SAME_POSE_EPSILON &&
    Math.abs(a.y - b.y) <= SAME_POSE_EPSILON &&
    Math.abs(a.angle - b.angle) <= SAME_POSE_EPSILON &&
    Math.abs(a.extent - b.extent) <= SAME_POSE_EPSILON
  );
}

function withEase(base: WeaponInstance, ease: Ease | undefined, tick: number): WeaponInstance {
  if (!ease) return base;
  const left = ease.mag - ease.perTick * Math.max(0, tick - ease.tick);
  if (left <= 0) return base;
  const s = left / ease.mag;
  return { ...base, x: base.x + ease.dx * s, y: base.y + ease.dy * s };
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
