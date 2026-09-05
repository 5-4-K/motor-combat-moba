# Netcode Phase 6 — Optional: Five Changes That Wait for Evidence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold the four optimisations and one balance change that phases 0–5 deliberately did not make, each behind the measurement that would justify it, so that none of them is done on a hunch and none of them is forgotten.

**Architecture:** Nothing here is a sequence. Each task is a self-contained change with its own gate, its own tests and its own acceptance, and the tasks touch disjoint parts of the tree — the codec (Task 1), the dependency set and the server's transport construction (Tasks 2 and 3), one `WEAPON_TABLE` row (Task 4), one `NET_CONFIG` number (Task 5). They may be run in any order, months apart, or never.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), npm workspaces, Colyseus 0.15 today (Task 2 evaluates 0.18), vitest in the **node** environment, `tsx` for the playtest harness, `node --test` for `scripts/*.test.mjs`.

**Spec:** [`2026-09-04-online-netcode-and-client-architecture-design.md`](../../specs/2026-09-04-online-netcode-and-client-architecture-design.md) — §8 phase 6 row, §13 ("Volley compression", "Transport", "Physics rewrite", "Aim assist"), §6.6 N31, §6.3 N9 and N12, §6.6 N20, §7, §10 questions 5 and 8.
**Ledger:** [`interfaces.md`](interfaces.md) — `net/codec.ts` (`PROTOCOL_VERSION`, `encodeSnapshot`, `decodeSnapshot`), `MatchTransport`, `NET_CONFIG.remoteSteerHoldTicks`, `config/telegraph.ts`.
**Previous phase:** [`15-netcode-5-lifecycle.md`](15-netcode-5-lifecycle.md) — **read its `## Handoff` in full before any task**, and its "For N6 specifically" bullet in particular. Phases 4, 3 and 2 are [`14-netcode-4-feel.md`](14-netcode-4-feel.md), [`13-netcode-3-world.md`](13-netcode-3-world.md) and [`12-netcode-2-wire.md`](12-netcode-2-wire.md).
**Runbook:** [`00-execution-guide.md`](00-execution-guide.md) — §3, §5 (the N6 gate: *"each task's own gate, stated in its first step; skipped tasks are recorded as skipped with the measured value"*), §7 (*"N6's tasks are not scheduled; each is run when its gate is observed true in a real match's netgraph or harness output, and the user says so"*).

---

## How to read this plan

**This plan is not a phase you execute.** It is five changes parked behind their evidence. Every other plan in this folder ships in order and is done when its acceptance numbers land; this one is a shelf.

Each task begins with a **Gate** block: a number, where to read it, and the threshold that makes the change worth its cost. **Read the gate first, write the measured value into §"The gate ledger" below, and only then decide.** A gate that reads false is not a failure — it is the phase working. Four of the five gates are expected to read false on a LAN and on a well-behaved home connection, and the plan says so where it is true.

Three rules the execution guide fixes and this plan inherits:

1. **The user decides when a task runs.** Not the harness, not a threshold crossing on its own. The gate makes the case; the user says go.
2. **A skipped task is recorded as skipped with its measured value, never deleted.** §"Recording a skip" says how, and the gate ledger is where it goes.
3. **Tasks are independent.** Nothing here consumes anything else here, with one stated exception: Task 3 (WebTransport) cannot start until Task 2 (Colyseus 0.18) has landed, because the server-side transport it needs does not exist in 0.15. That dependency is in Task 3's gate.

## The gate ledger

Fill a row in when you read its gate, whatever the answer. This table is the phase's memory: the next person to open this file needs to know that somebody already looked, what they saw, and when.

| # | Task | Gate, in one line | Measured | Date / machine | Decision |
|---|---|---|---|---|---|
| 1 | Volley compression | snapshot bytes p95 during a `pepperbox` volley, against §7's 1.2 KB line | — | — | — |
| 2 | Colyseus 0.18 | does 0.18 answer the two questions in Task 2 Step 1, and is there a reason to move | — | — | — |
| 3 | WebTransport | stall rate attributable to TCP head-of-line blocking, and a certificate the browser trusts | — | — | — |
| 4 | `thunderclap` wind-up | `telegraphAudit()` non-empty **and** late maneuver reveals per match above the line | — | — | — |
| 5 | `remoteSteerHoldTicks` | remote extrapolation error p95 against §7's 20 u line, at the design point | — | — | — |

## Global Constraints

- **Rebuild shared before testing**: `npm run build -w @motor-combat-moba/shared`. Server and client consume built `dist`.
- **Verify with root `npm test`**, never a per-workspace run alone.
- **`.js` import specifiers** on every local import; shared is imported as `@motor-combat-moba/shared`.
- **Nothing under `packages/client/src/match/` imports Phaser, and no test imports Phaser.** Task 3's `WebTransportTransport` lives beside `match/transport.ts` and imports neither Phaser nor Colyseus.
- **Do not touch `packages/server/playtest/` except to fix a compile break**, and say loudly in the task's commit step which probe numbers your change moves. **Tasks 1, 4 and 5 each edit `playtest/netcode.ts`** — the one authorised harness, named by spec §7 — and nothing else under `playtest/`. **Never create a new probe file.**
- **Do not edit `docs/ideas/` or `docs/invariants/`.**
- **Commit after every task** on branch `claude/gameplay-netcode-architecture-bgp8f6` (each session may use its own worktree branch cut off it). `npm install` in a fresh worktree before the first build.
- **"main" means `development/main`.**
- **Task 4 edits a balance table** (`WEAPON_TABLE.thunderclap.startUpMs`) and therefore carries `npm run build:manual` with the page committed, the `docs/turn-tuning.md` check, and the `balanceStamp` / `configFingerprint` / `protocolHash` consequences — all spelled out in that task and in nothing else here. **Tasks 1, 2, 3 and 5 edit no balance table**, so none of them owes the manual page or the turn-tuning page anything.
- **Every task is its own merge.** The execution guide's per-phase merge rule reads, for this plan, as one merge per task, with the gate's measured value in the merge commit message.

---

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `packages/shared/src/net/volley.ts` (create) | 1 | `FanSpec`, `isFanEligible`, `fanReferenceIndex`, `fanPelletsFrom`, `expandFan`, `fansFrom` — the fan geometry and the safety check, pure |
| `packages/shared/src/net/codec.ts` (modify) | 1 | `PROTOCOL_VERSION` 1 → 2; the Fans section between Instances and Events |
| `packages/shared/src/index.ts` (modify) | 1 | export the volley surface |
| `packages/server/playtest/netcode.ts` (modify) | 1, 5 | the **N8** bytes-under-volley row; the **N9** `remoteSteerHoldTicks` sweep |
| `packages/server/package.json`, `packages/client/package.json`, `package-lock.json` (modify) | 2 | Colyseus 0.15 → 0.18 |
| `packages/server/src/index.ts` (modify) | 2, 3 | transport construction |
| `packages/client/src/match/webtransport.ts` (create) | 3 | `WebTransportTransport implements MatchTransport` |
| `packages/client/src/match/transport-select.ts` (create) | 3 | which transport a session gets, and the fall back to Colyseus |
| `packages/shared/src/config/weapon-config.ts` (modify) | 4 | `thunderclap.startUpMs` 0 → 150 |
| `scripts/cars-and-weapons-copy.mjs` (modify) | 4 | the two sentences the wind-up makes untrue |
| `packages/client/public/manual.html` (regenerate) | 4 | `npm run build:manual`, committed |
| `packages/shared/src/config/net-config.ts` (modify) | 5 | `remoteSteerHoldTicks`, only if the sweep names a different value |
| `packages/server/src/net/input-log-read.ts` (create) | 5 | `parseInputLog` — reads N30's log back |
| `docs/networking.md`, `docs/config-reference.md`, `docs/schema-reference.md`, `docs/deployment.md`, `packages/server/playtest/README.md` (modify) | various | each task names the pages it owes |

---

### Task 1: Volley compression — one fan row instead of a dozen pellet rows

**Gate.**

> **Read:** `cd packages/server && npx tsx playtest/netcode.ts` and look at the **N8** row this task adds in Step 6 — or, from a real match, `?debug=net`'s `bytesIn` peak while a Bullseye holds down `pepperbox`.
>
> **The threshold:** spec §7's acceptance line is *"Snapshot size ≤ 700 bytes, ≤ 1.2 KB during a pepperbox volley"*. Run this task when the measured p95 during a volley is **above 1.2 KB**, or when `snapshotEvery` has had to be raised to 2 on a real host's upload and the reason is instance rows rather than car rows.
>
> **What it is expected to read.** N2 computed the layout: a full instance row is 14 B and a delta instance row is 10 B. One `pepperbox` press is 4 muzzles × 3 pellets = **12 instances**, so a volley in flight adds `12 × 10 = 120 B` to a 125 B steady-state delta, and two players volleying at once adds 240 B. That is ~365 B against a 1,200 B line. **This gate is expected to read false**, and reading it is the point: the spec parked this optimisation precisely because the arithmetic said it was not needed, and the arithmetic should be re-run against the shipped table rather than trusted from a document.
>
> **When it would change:** a new weapon row with a larger `pellets.pelletsPerVolley`, more muzzles, or a longer `lifetimeMs`; or a roster where more than two cars carry a multi-pellet weapon. `pepperbox` is the **only** row in `WEAPON_TABLE` today with `pelletsPerVolley > 1` — grep it before believing any of the numbers above.

**Files:**
- Create: `packages/shared/src/net/volley.ts`, `packages/shared/src/net/volley.test.ts`
- Modify: `packages/shared/src/net/codec.ts`, `packages/shared/src/net/codec.test.ts`, `packages/shared/src/index.ts`, `packages/server/playtest/netcode.ts`, `packages/server/playtest/README.md`, `docs/networking.md`
- Test: the two above, plus the existing `packages/shared/src/net/protocol-hash.test.ts`

**Interfaces:**
- Consumes: N2's `SnapshotInstance`, `Snapshot`, `QUANT`, `encodeSnapshot`, `decodeSnapshot`, `PROTOCOL_VERSION`, `instanceId`; `WEAPON_TABLE`, `weaponDefOf`; `fanOffset` from `sim/weapons/instances.ts` — **the sim's own fan math, imported, never re-derived**.
- Produces:

```ts
// packages/shared/src/net/volley.ts
export const FAN_MAX_PELLETS = 8;
export const FAN_TOLERANCE_UNITS: number;          // 2 / QUANT.posPerUnit
export interface FanSpec {
  ownerIndex: number;
  firstShotSeq: number;                            // the seq of pellet 0 of this muzzle's fan
  weaponId: string;
  memberMask: number;                              // bit i set = pellet i is still alive and in the fan
  x: number; y: number; angle: number;             // the REFERENCE pellet: the lowest set bit
  distance: number;                                // how far the fan has flown from its muzzle
}
export function isFanEligible(weaponId: string): boolean;
export function fanReferenceIndex(memberMask: number): number;
export function fanPelletPose(fan: FanSpec, index: number, pellets: number, spreadRad: number):
  { x: number; y: number; angle: number };
export function expandFan(fan: FanSpec): SnapshotInstance[];
export function fansFrom(instances: readonly SnapshotInstance[]):
  { fans: FanSpec[]; rest: SnapshotInstance[] };
```

#### Why a fan is derivable at all, and where that stops being true

`spawnInstances` (`packages/shared/src/sim/weapons/instances.ts:184-265`) emits one pellet per `(muzzle, pellet index)` pair from **one** point — `muzzleX, muzzleY`, computed once per muzzle — at angles `axis + fanOffset(i, pellets, spread)`, with consecutive `seq` values. Every pellet of one muzzle therefore lies on a circle of radius `distance` about that muzzle, at known angular offsets, for as long as it flies straight.

So one fan row plus the weapon's own table numbers reproduce every pellet exactly:

```
muzzle  = reference − distance · u(reference.angle)
pellet i = muzzle + distance · u(reference.angle − off(ref) + off(i))
```

Three things break it, and all three are excluded by `isFanEligible` rather than handled:

| Breaks the derivation | Why | Excluded by |
|---|---|---|
| Homing | `predator` steers per pellet; the circle stops being a circle | `def.homing !== undefined` |
| Pierce or bounce | a pellet that survives a hit has a different distance from its siblings | `def.pierce !== 0` |
| A single pellet | there is nothing to compress: one pellet is one row either way | `pelletsPerVolley < 2` |

And one thing is handled rather than excluded: **a pellet that dies leaves the fan**. It is emitted as an ordinary instance row on the tick it dies, carrying its own death pose, and its bit clears in `memberMask`. That is why the mask exists and why there is no "dead pellet" pose to derive.

**The encoder verifies its own derivation before it emits a fan.** `fansFrom` reconstructs every member from the reference and compares against the real instance; any member further than `FAN_TOLERANCE_UNITS` sends the whole group as ordinary rows. This is the property that makes the change safe to land at all: the wire can never carry a fan the client would draw in the wrong place, because the server checked.

#### The bytes, computed

| Case | Today | With fans |
|---|---|---|
| One `pepperbox` press, first snapshot | 12 full instances, `12 × 14` = **168 B** | 4 fans, `4 × 13` = **52 B** |
| The same volley in flight, per snapshot | 12 delta instances, `12 × 10` = **120 B** | 4 delta fans, `4 × 10` = **40 B** |
| Two players volleying, in flight | 240 B | 80 B |

A fan row is `1 owner + 2 firstShotSeq + 1 weapon + 1 memberMask + 2 x + 2 y + 2 angle + 2 distance` = **13 B**. A delta fan carries the key (`1 + 2`), a `u8` mask and the groups that changed: pose (`x`, `y`) 4 B and `distance` 2 B — `angle`, `weapon` and `memberMask` are all constant for a straight fan's whole life, so the steady-state delta is **10 B for three pellets**, against 30 B. The saving is ~80 B per snapshot per volleying player: **4.8 KB/s at 60 Hz**, or about 22 % of the two-player volley moment.

- [ ] **Step 1: Write the failing geometry test**

```ts
// packages/shared/src/net/volley.test.ts
import { describe, expect, it } from "vitest";
import { WEAPON_TABLE } from "../config/weapon-config.js";
import { fanOffset } from "../sim/weapons/instances.js";
import { QUANT, type SnapshotInstance } from "./codec.js";
import {
  FAN_MAX_PELLETS,
  FAN_TOLERANCE_UNITS,
  expandFan,
  fanPelletPose,
  fanReferenceIndex,
  fansFrom,
  isFanEligible,
  type FanSpec,
} from "./volley.js";

const PEPPERBOX = WEAPON_TABLE.pepperbox;
const SPREAD = (PEPPERBOX.pellets.spreadAngleDeg * Math.PI) / 180;
const PELLETS = PEPPERBOX.pellets.pelletsPerVolley;

/** The instances one muzzle's fan produces at `distance`, exactly as `spawnInstances` + `stepInstance` would. */
function fanInstances(muzzleX: number, muzzleY: number, axis: number, distance: number, firstSeq = 1): SnapshotInstance[] {
  const out: SnapshotInstance[] = [];
  for (let i = 0; i < PELLETS; i++) {
    const angle = axis + fanOffset(i, PELLETS, SPREAD);
    out.push({
      ownerIndex: 0,
      shotSeq: firstSeq + i,
      weaponId: "pepperbox",
      kind: 0,
      x: muzzleX + Math.cos(angle) * distance,
      y: muzzleY + Math.sin(angle) * distance,
      angle,
      extent: 0,
      alive: true,
      isExplosion: false,
      homingTargetIndex: -1,
    });
  }
  return out;
}

describe("isFanEligible", () => {
  it("accepts pepperbox and nothing else on the shipped table", () => {
    const eligible = Object.keys(WEAPON_TABLE).filter(isFanEligible);
    expect(
      eligible,
      "a new multi-pellet row is compressible for free; a new HOMING or PIERCING multi-pellet row is " +
        "not, and this list is where that is decided",
    ).toEqual(["pepperbox"]);
  });

  it("refuses a homing or piercing row even if it fans", () => {
    expect(WEAPON_TABLE.predator.homing).toBeDefined();
    expect(isFanEligible("predator")).toBe(false);
    expect(isFanEligible("afterburner")).toBe(false); // a beam has no pellets at all
  });
});

describe("fanReferenceIndex", () => {
  it("is the lowest live member, so a dead pellet 0 hands the reference to pellet 1", () => {
    expect(fanReferenceIndex(0b111)).toBe(0);
    expect(fanReferenceIndex(0b110)).toBe(1);
    expect(fanReferenceIndex(0b100)).toBe(2);
  });
});

describe("fanPelletPose", () => {
  it("reproduces every sibling from the reference pellet", () => {
    const truth = fanInstances(400, 300, 0.7, 250);
    const fan: FanSpec = {
      ownerIndex: 0,
      firstShotSeq: 1,
      weaponId: "pepperbox",
      memberMask: 0b111,
      x: truth[0]!.x,
      y: truth[0]!.y,
      angle: truth[0]!.angle,
      distance: 250,
    };
    for (let i = 0; i < PELLETS; i++) {
      const pose = fanPelletPose(fan, i, PELLETS, SPREAD);
      expect(pose.x).toBeCloseTo(truth[i]!.x, 6);
      expect(pose.y).toBeCloseTo(truth[i]!.y, 6);
      expect(pose.angle).toBeCloseTo(truth[i]!.angle, 6);
    }
  });
});

describe("fansFrom", () => {
  it("folds one muzzle's three pellets into one fan and leaves nothing behind", () => {
    const { fans, rest } = fansFrom(fanInstances(400, 300, 0, 120));
    expect(fans).toHaveLength(1);
    expect(rest).toHaveLength(0);
    expect(fans[0]!.memberMask).toBe(0b111);
    expect(fans[0]!.distance).toBeCloseTo(120, 2);
  });

  it("round-trips through expandFan, pellet for pellet", () => {
    const truth = fanInstances(400, 300, 1.2, 310, 41);
    const { fans } = fansFrom(truth);
    const back = expandFan(fans[0]!);
    expect(back.map((i) => i.shotSeq)).toEqual([41, 42, 43]);
    for (let i = 0; i < PELLETS; i++) {
      expect(back[i]!.x).toBeCloseTo(truth[i]!.x, 3);
      expect(back[i]!.y).toBeCloseTo(truth[i]!.y, 3);
      expect(back[i]!.angle).toBeCloseTo(truth[i]!.angle, 6);
      expect(back[i]!.weaponId).toBe("pepperbox");
      expect(back[i]!.homingTargetIndex).toBe(-1);
    }
  });

  it("drops a dead pellet out of the mask and leaves it as its own row", () => {
    const truth = fanInstances(400, 300, 0, 200);
    truth[1]!.alive = false;
    const { fans, rest } = fansFrom(truth);
    expect(fans[0]!.memberMask).toBe(0b101);
    expect(rest.map((i) => i.shotSeq)).toEqual([2]);
  });

  it("refuses a group whose derivation is wrong, rather than sending a fan the client would misdraw", () => {
    const truth = fanInstances(400, 300, 0, 200);
    // A pellet nudged well past the tolerance: the group must degrade to plain rows, whole.
    truth[2]!.x += 4 * FAN_TOLERANCE_UNITS;
    const { fans, rest } = fansFrom(truth);
    expect(fans).toHaveLength(0);
    expect(rest).toHaveLength(3);
  });

  it("keeps two muzzles of the same press apart", () => {
    const a = fanInstances(400, 300, 0, 90, 1);
    const b = fanInstances(400, 300, Math.PI / 2, 90, 4);
    const { fans, rest } = fansFrom([...a, ...b]);
    expect(fans).toHaveLength(2);
    expect(rest).toHaveLength(0);
    expect(fans.map((f) => f.firstShotSeq)).toEqual([1, 4]);
  });

  it("passes an ineligible instance straight through", () => {
    const rock: SnapshotInstance = {
      ownerIndex: 1, shotSeq: 9, weaponId: "predator", kind: 0, x: 10, y: 10, angle: 0,
      extent: 0, alive: true, isExplosion: false, homingTargetIndex: 2,
    };
    const { fans, rest } = fansFrom([rock]);
    expect(fans).toHaveLength(0);
    expect(rest).toEqual([rock]);
  });

  it("never folds more pellets than the mask can hold", () => {
    expect(PELLETS).toBeLessThanOrEqual(FAN_MAX_PELLETS);
    expect(
      Math.max(
        ...Object.values(WEAPON_TABLE).map((row) =>
          row.kind === "projectile" ? row.pellets.pelletsPerVolley : 0,
        ),
      ),
      "FAN_MAX_PELLETS is a u8 mask; a row wanting more than eight pellets needs a wider mask",
    ).toBeLessThanOrEqual(FAN_MAX_PELLETS);
  });
});

describe("the quantisation the wire imposes", () => {
  it("keeps every derived pellet inside the tolerance at the weapon's own maximum range", () => {
    const q = 1 / QUANT.posPerUnit;
    const truth = fanInstances(100, 100, 0.3, PEPPERBOX.range);
    // Quantise the reference the way the codec will, then derive the siblings from it.
    const ref = truth[0]!;
    const fan: FanSpec = {
      ownerIndex: 0, firstShotSeq: 1, weaponId: "pepperbox", memberMask: 0b111,
      x: Math.round(ref.x / q) * q,
      y: Math.round(ref.y / q) * q,
      angle: (Math.round((ref.angle * QUANT.angleSteps) / (Math.PI * 2)) * (Math.PI * 2)) / QUANT.angleSteps,
      distance: Math.round(PEPPERBOX.range / q) * q,
    };
    for (let i = 0; i < PELLETS; i++) {
      const pose = fanPelletPose(fan, i, PELLETS, SPREAD);
      expect(Math.hypot(pose.x - truth[i]!.x, pose.y - truth[i]!.y)).toBeLessThan(FAN_TOLERANCE_UNITS);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/shared && npx vitest run src/net/volley.test.ts`
Expected: FAIL — cannot resolve `./volley.js`.

- [ ] **Step 3: Write `net/volley.ts`**

```ts
// packages/shared/src/net/volley.ts
import { weaponDefOf } from "../config/weapon-config.js";
import { isWeaponId } from "../config/weapon-types.js";
import { fanOffset } from "../sim/weapons/instances.js";
import { QUANT, type SnapshotInstance } from "./codec.js";

/**
 * Volley compression (netcode spec §13): one wire row for a whole pellet fan, with the client
 * deriving the individual pellets.
 *
 * Every pellet of one muzzle leaves the same point at the same tick and flies straight, so at any
 * later tick they all sit on a circle of radius `distance` about that muzzle at angular offsets
 * `fanOffset` chose. One pellet's pose plus the radius therefore reproduces the rest, and the
 * weapon's own row supplies the pellet count and the spread. `fanOffset` is IMPORTED from the sim
 * rather than restated: if the fan's shape ever changes, this follows it.
 *
 * **The encoder checks its own arithmetic** (`fansFrom`) and sends plain instance rows for any group
 * whose reconstruction is off by more than `FAN_TOLERANCE_UNITS`. That is what makes this safe to
 * enable at all — the wire cannot carry a fan the client would draw in the wrong place.
 */

/** A `memberMask` is a `u8`, so a fan holds at most eight pellets. */
export const FAN_MAX_PELLETS = 8;

/**
 * How far a derived pellet may sit from the real one before the group is sent uncompressed: two
 * position quanta. The reconstruction's own error is dominated by the reference pellet's
 * quantisation (one quantum) plus the angle quantum times the radius, which at `pepperbox`'s
 * 600-unit range is about a further 0.06 u.
 */
export const FAN_TOLERANCE_UNITS = 2 / QUANT.posPerUnit;

export interface FanSpec {
  ownerIndex: number;
  /** The `shotSeq` of pellet 0 of this muzzle's fan, whether or not pellet 0 is still alive. */
  firstShotSeq: number;
  weaponId: string;
  /** Bit `i` set = pellet `i` is alive and derived from this row. */
  memberMask: number;
  /** The reference pellet's pose: the lowest set bit of `memberMask`. */
  x: number;
  y: number;
  angle: number;
  /** How far the fan has flown from its muzzle. The one field that changes every tick. */
  distance: number;
}

/**
 * Whether a weapon's pellets can be derived from one row. Read off the table, never a list of ids:
 * a new multi-pellet row is compressed with no edit here, and a homing or piercing one is refused
 * with no edit here either.
 */
export function isFanEligible(weaponId: string): boolean {
  if (!isWeaponId(weaponId)) return false;
  const def = weaponDefOf(weaponId);
  if (def.kind !== "projectile") return false;
  if (def.pellets.pelletsPerVolley < 2) return false;
  if (def.pellets.pelletsPerVolley > FAN_MAX_PELLETS) return false;
  // Homing steers each pellet independently; pierce lets one outlive its siblings at a different
  // distance. Either way the circle stops being a circle.
  if (def.homing !== undefined) return false;
  if (def.pierce !== 0) return false;
  return true;
}

/** The lowest live member: the pellet whose pose the row actually carries. */
export function fanReferenceIndex(memberMask: number): number {
  for (let i = 0; i < FAN_MAX_PELLETS; i++) if (memberMask & (1 << i)) return i;
  return 0;
}

const unit = (angle: number): { x: number; y: number } => ({ x: Math.cos(angle), y: Math.sin(angle) });

/** One pellet's pose, reconstructed from the reference pellet and the fan's radius. */
export function fanPelletPose(
  fan: FanSpec,
  index: number,
  pellets: number,
  spreadRad: number,
): { x: number; y: number; angle: number } {
  const reference = fanReferenceIndex(fan.memberMask);
  // The axis the fan is symmetric about, recovered from the reference pellet's own angle.
  const axis = fan.angle - fanOffset(reference, pellets, spreadRad);
  const muzzleDir = unit(fan.angle);
  const muzzleX = fan.x - muzzleDir.x * fan.distance;
  const muzzleY = fan.y - muzzleDir.y * fan.distance;
  const angle = axis + fanOffset(index, pellets, spreadRad);
  const dir = unit(angle);
  return { x: muzzleX + dir.x * fan.distance, y: muzzleY + dir.y * fan.distance, angle };
}

const spreadOf = (weaponId: string): number => {
  const def = weaponDefOf(weaponId);
  return def.kind === "projectile" ? (def.pellets.spreadAngleDeg * Math.PI) / 180 : 0;
};

const pelletsOf = (weaponId: string): number => {
  const def = weaponDefOf(weaponId);
  return def.kind === "projectile" ? def.pellets.pelletsPerVolley : 1;
};

/** Every live member of a fan, as ordinary snapshot instances. The decoder's whole job. */
export function expandFan(fan: FanSpec): SnapshotInstance[] {
  const pellets = pelletsOf(fan.weaponId);
  const spread = spreadOf(fan.weaponId);
  const out: SnapshotInstance[] = [];
  for (let i = 0; i < pellets; i++) {
    if (!(fan.memberMask & (1 << i))) continue;
    const pose = fanPelletPose(fan, i, pellets, spread);
    out.push({
      ownerIndex: fan.ownerIndex,
      shotSeq: fan.firstShotSeq + i,
      weaponId: fan.weaponId,
      kind: 0,
      x: pose.x,
      y: pose.y,
      angle: pose.angle,
      extent: 0,
      alive: true,
      isExplosion: false,
      homingTargetIndex: -1,
    });
  }
  return out;
}

interface Candidate {
  ownerIndex: number;
  weaponId: string;
  firstShotSeq: number;
  members: (SnapshotInstance | undefined)[];
  dead: SnapshotInstance[];
}

/**
 * Split a tick's instances into fans and everything else.
 *
 * Grouping is by `(ownerIndex, weaponId, floor((shotSeq - 1) / pellets))`: `spawnInstances` hands
 * one muzzle's pellets consecutive `seq` values, so the seq itself says which fan a pellet belongs
 * to and which slot in it it holds. Anything that does not group cleanly — a partial fan whose
 * missing members are not dead, a group whose reconstruction fails the tolerance — is returned
 * whole in `rest` and rides the wire as it does today.
 */
export function fansFrom(instances: readonly SnapshotInstance[]): {
  fans: FanSpec[];
  rest: SnapshotInstance[];
} {
  const fans: FanSpec[] = [];
  const rest: SnapshotInstance[] = [];
  const groups = new Map<string, Candidate>();

  for (const instance of instances) {
    if (!isFanEligible(instance.weaponId) || instance.isExplosion || instance.extent !== 0) {
      rest.push(instance);
      continue;
    }
    const pellets = pelletsOf(instance.weaponId);
    const group = Math.floor((instance.shotSeq - 1) / pellets);
    const key = `${instance.ownerIndex}|${instance.weaponId}|${group}`;
    let candidate = groups.get(key);
    if (!candidate) {
      candidate = {
        ownerIndex: instance.ownerIndex,
        weaponId: instance.weaponId,
        firstShotSeq: group * pellets + 1,
        members: new Array<SnapshotInstance | undefined>(pellets).fill(undefined),
        dead: [],
      };
      groups.set(key, candidate);
    }
    if (!instance.alive) {
      // A pellet dies where it died, not where the circle says it should be. It leaves the fan.
      candidate.dead.push(instance);
      continue;
    }
    candidate.members[instance.shotSeq - candidate.firstShotSeq] = instance;
  }

  for (const candidate of groups.values()) {
    rest.push(...candidate.dead);
    const pellets = pelletsOf(candidate.weaponId);
    const spread = spreadOf(candidate.weaponId);
    const live = candidate.members.filter((m): m is SnapshotInstance => m !== undefined);
    if (live.length < 2) {
      rest.push(...live);
      continue;
    }

    let memberMask = 0;
    for (let i = 0; i < pellets; i++) if (candidate.members[i]) memberMask |= 1 << i;
    const referenceIndex = fanReferenceIndex(memberMask);
    const reference = candidate.members[referenceIndex]!;
    // The radius, solved from the widest live pair: `|p_b − p_a| = 2 d sin((off_b − off_a) / 2)`.
    const last = candidate.members.reduce<number>((best, m, i) => (m ? i : best), referenceIndex);
    const half = (fanOffset(last, pellets, spread) - fanOffset(referenceIndex, pellets, spread)) / 2;
    const chord = Math.hypot(
      candidate.members[last]!.x - reference.x,
      candidate.members[last]!.y - reference.y,
    );
    const distance = half === 0 ? 0 : chord / (2 * Math.sin(half));

    const fan: FanSpec = {
      ownerIndex: candidate.ownerIndex,
      firstShotSeq: candidate.firstShotSeq,
      weaponId: candidate.weaponId,
      memberMask,
      x: reference.x,
      y: reference.y,
      angle: reference.angle,
      distance,
    };

    // Verify, then commit. A group that does not reconstruct goes out uncompressed, whole.
    let faithful = true;
    for (let i = 0; i < pellets && faithful; i++) {
      const member = candidate.members[i];
      if (!member) continue;
      const pose = fanPelletPose(fan, i, pellets, spread);
      if (Math.hypot(pose.x - member.x, pose.y - member.y) > FAN_TOLERANCE_UNITS) faithful = false;
    }
    if (faithful) fans.push(fan);
    else rest.push(...live);
  }

  rest.sort((a, b) => a.ownerIndex - b.ownerIndex || a.shotSeq - b.shotSeq);
  fans.sort((a, b) => a.ownerIndex - b.ownerIndex || a.firstShotSeq - b.firstShotSeq);
  return { fans, rest };
}
```

`packages/shared/src/index.ts`:

```ts
export { FAN_MAX_PELLETS, FAN_TOLERANCE_UNITS, expandFan, fanPelletPose, fanReferenceIndex, fansFrom, isFanEligible } from "./net/volley.js";
export type { FanSpec } from "./net/volley.js";
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/shared && npx vitest run src/net/volley.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Put the fans on the wire**

`net/codec.ts`, three edits. First the version, which is what refuses an older client:

| Before | After |
|---|---|
| `export const PROTOCOL_VERSION = 1;` | `export const PROTOCOL_VERSION = 2;` — the Fans section is a wire change, and `protocolHash()` hashes this constant, so every client on the old build is refused at join with the readable message N11 already writes |

Then the layout. The Fans section sits **between Instances and Events**, so a decoder that has read the instance count knows where it is:

```
Fans
  u8   count
  per fan:
    u8   ownerIndex
    u16  firstShotSeq            (ownerIndex, firstShotSeq) is the fan's identity and its delta key
    u8   mask                    DELTA ONLY
    group 0  identity  u8 weapon · u8 memberMask · u16 angle                    4 B
    group 1  pose      u16 x · u16 y                                            4 B
    group 2  radius    u16 distance                                             2 B
                                                                    full fan: 13 B
```

`angle` lives in the **identity** group rather than the pose group on purpose: a straight fan's reference angle never changes, so it is written once and never again, which is where the delta saving comes from. If a later weapon makes it vary, it moves to group 1 and the steady-state delta grows by 2 B — say so in the commit if you ever do that.

And the two call sites, which are the whole of the change above the byte layer:

```ts
// inside encodeSnapshot, replacing the single instances pass
const { fans, rest } = fansFrom(snapshot.instances);
writeInstances(rest);      // unchanged: the same writer, a shorter list
writeFans(fans);
```

```ts
// inside decodeSnapshot, after the instances section
const instances = readInstances();
for (const fan of readFans()) instances.push(...expandFan(fan));
instances.sort((a, b) => a.ownerIndex - b.ownerIndex || a.shotSeq - b.shotSeq);
return { …, instances };
```

**Nothing above the codec changes.** `Snapshot.instances` keeps its shape and its order, so `MatchClient`, `WorldPredictor`, `FirePrediction`'s ghost handover by `instanceId`, the shot renderer and every existing test see exactly what they saw before. That is the design constraint this task is built around, and the round-trip test in Step 6 is what holds it.

- [ ] **Step 6: Pin the wire, and measure it**

Append to `packages/shared/src/net/codec.test.ts`:

```ts
describe("volley compression (spec §13)", () => {
  const pepperboxVolley = (tick: number): SnapshotInstance[] => {
    const out: SnapshotInstance[] = [];
    const spread = (WEAPON_TABLE.pepperbox.pellets.spreadAngleDeg * Math.PI) / 180;
    const pellets = WEAPON_TABLE.pepperbox.pellets.pelletsPerVolley;
    let seq = 0;
    for (const muzzle of WEAPON_TABLE.pepperbox.muzzles!) {
      const axis = (muzzle * Math.PI) / 180;
      const distance = (WEAPON_TABLE.pepperbox.speed * tick) / TICK_RATE_HZ;
      for (let i = 0; i < pellets; i++) {
        const angle = axis + fanOffset(i, pellets, spread);
        seq += 1;
        out.push({
          ownerIndex: 0, shotSeq: seq, weaponId: "pepperbox", kind: 0,
          x: 640 + Math.cos(angle) * distance, y: 360 + Math.sin(angle) * distance,
          angle, extent: 0, alive: true, isExplosion: false, homingTargetIndex: -1,
        });
      }
    }
    return out;
  };

  it("round-trips a full volley pellet for pellet", () => {
    const snapshot = snapshotWith({ instances: pepperboxVolley(6) });
    const decoded = decodeSnapshot(encodeSnapshot(snapshot, undefined, roster), undefined, roster);
    expect(decoded.instances).toHaveLength(12);
    for (let i = 0; i < 12; i++) {
      const before = snapshot.instances[i]!;
      const after = decoded.instances[i]!;
      expect(instanceId(after.ownerIndex, after.shotSeq)).toBe(instanceId(before.ownerIndex, before.shotSeq));
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(FAN_TOLERANCE_UNITS);
      expect(after.weaponId).toBe("pepperbox");
    }
  });

  it("costs 4 fans instead of 12 instance rows, and the bytes to prove it", () => {
    const snapshot = snapshotWith({ instances: pepperboxVolley(6) });
    const bytes = encodeSnapshot(snapshot, undefined, roster).length;
    const empty = encodeSnapshot(snapshotWith({ instances: [] }), undefined, roster).length;
    // 4 fans x 13 B + the fan count byte, against 12 x 14 B + the count byte the old layout paid.
    expect(bytes - empty).toBe(4 * 13 + 1);
    expect(bytes - empty).toBeLessThan(12 * 14 + 1);
  });

  it("steady state is 10 B per fan, angle and identity having stopped changing", () => {
    const previous = snapshotWith({ tick: 100, instances: pepperboxVolley(6) });
    const next = snapshotWith({ tick: 101, instances: pepperboxVolley(7) });
    const base = encodeSnapshot(
      snapshotWith({ tick: 101, instances: [] }), snapshotWith({ tick: 100, instances: [] }), roster,
    ).length;
    expect(encodeSnapshot(next, previous, roster).length - base).toBe(4 * 10 + 1);
  });

  it("a killed pellet leaves the fan and arrives as its own row", () => {
    const instances = pepperboxVolley(6);
    instances[1]!.alive = false;
    const decoded = decodeSnapshot(
      encodeSnapshot(snapshotWith({ instances }), undefined, roster), undefined, roster,
    );
    expect(decoded.instances).toHaveLength(12);
    expect(decoded.instances.find((i) => i.shotSeq === 2)!.alive).toBe(false);
  });

  it("leaves every other weapon's instances exactly where they were", () => {
    const missile: SnapshotInstance = {
      ownerIndex: 1, shotSeq: 3, weaponId: "predator", kind: 0, x: 111, y: 222, angle: 0.5,
      extent: 0, alive: true, isExplosion: false, homingTargetIndex: 0,
    };
    const decoded = decodeSnapshot(
      encodeSnapshot(snapshotWith({ instances: [missile] }), undefined, roster), undefined, roster,
    );
    expect(decoded.instances[0]!.homingTargetIndex).toBe(0);
    expect(decoded.instances[0]!.x).toBeCloseTo(111, 1);
  });
});
```

and one line to `protocol-hash.test.ts`'s existing "changes when the protocol does" case: `expect(PROTOCOL_VERSION).toBe(2);`, with the comment *"bumped by volley compression, netcode phase 6 Task 1"*.

Then the harness row. `playtest/netcode.ts` gains **N8**, which is the gate this task is read against — write it whether or not you go on to implement the compression, because a gate nobody can read is not a gate:

```ts
/* N8. Snapshot bytes under a pepperbox volley (spec §7's 1.2 KB line, §13) */
{
  const r = trial({ latencyMs: 45, jitterMs: 10, lossRate: 0.01, ticks: 900, seed: 3, volley: "pepperbox" });
  const p95 = pct(r.snapshotBytes, 0.95);
  const peak = Math.max(0, ...r.snapshotBytes);
  reporter.report(
    "N8. Snapshot bytes while a pepperbox volley is in the air",
    peak > 1200 ? VERDICT.FINDING : VERDICT.OK,
    `Spec §7: <= 700 B steady, <= 1.2 KB during a pepperbox volley. One press is ` +
      `${WEAPON_TABLE.pepperbox.muzzles!.length} muzzles x ${WEAPON_TABLE.pepperbox.pellets.pelletsPerVolley} pellets = ` +
      `${WEAPON_TABLE.pepperbox.muzzles!.length * WEAPON_TABLE.pepperbox.pellets.pelletsPerVolley} instances, alive for ` +
      `${((WEAPON_TABLE.pepperbox.range / WEAPON_TABLE.pepperbox.speed) * 1000).toFixed(0)} ms.\n` +
      `  p95 ${f1(p95)} B   peak ${f1(peak)} B   (line: peak < 1200 B)\n` +
      `This row is netcode phase 6 Task 1's GATE. Above the line, volley compression (§13) is worth\n` +
      `its protocol bump; below it, record the number in that plan's gate ledger and skip the task.`,
  );
}
```

`TrialResult` gains `snapshotBytes: number[]` (filled where `patchBytes` was filled before phase 2 renamed the channel) and `TrialOpts` gains `volley?: WeaponId`, which makes "them" press that slot on a fixed cadence. Both are additive; every existing row is untouched.

- [ ] **Step 7: Run everything, and commit**

Run:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build
cd packages/server && npx tsx playtest/netcode.ts && cd ../..
```

Expected: green, and the N8 row printing the before/after bytes.

```bash
git add packages/shared/src/net/volley.ts packages/shared/src/net/volley.test.ts packages/shared/src/net/codec.ts packages/shared/src/net/codec.test.ts packages/shared/src/net/protocol-hash.test.ts packages/shared/src/index.ts packages/server/playtest/netcode.ts packages/server/playtest/README.md docs/networking.md
git commit -m "perf(net): send a pellet fan as one row; PROTOCOL_VERSION 2"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Say it loudly in the summary.** This edits `playtest/netcode.ts` — it **adds** the N8 row and two additive `TrialResult`/`TrialOpts` fields, and changes no existing row's link parameters, so N1–N7 must report what they reported before. **Verify that by diffing the report folders rather than assuming it.** No other probe is touched and no probe's stated expectation moves: nothing here changes the sim, only how its instances are packed. `PROTOCOL_VERSION` moving means **every client must be rebuilt**; a stale one is refused at join by name, which is the mechanism working.

**Task 1's acceptance:** `npm test` green; the codec suite's three byte assertions exact (52 B full, 40 B steady, both under the old layout's 168 B and 120 B); the round-trip test showing every pellet within `FAN_TOLERANCE_UNITS`; and the harness's N8 row printing a peak under 1.2 KB *with* the compression on, which is the line the spec set.

---

### Task 2: Colyseus 0.15 → 0.18

**Gate.**

> **Read:** Step 1 of this task is the reading. It answers two questions against the actual package, not against a changelog:
>
> 1. **Does 0.18 deliver unreliable datagrams server → client at all?** Spec §13 records this as the consolidated note's own top risk and marks it *unverified*. If the answer is no, Task 3 has no foundation and this upgrade buys only maintenance.
> 2. **What does 0.18 do to the two things this codebase actually leans on** — `client.sendBytes` (N9's whole hot path) and `allowReconnection` with `reconnectionToken` (N5's whole lifecycle)?
>
> **The threshold:** run this task when **either** (a) question 1 answers yes and the user wants Task 3, **or** (b) the project moves to central hosting (spec §10 question 5), where staying on an unmaintained minor is a real cost. **Do not run it for tidiness.** 0.15 works, the match hot path bypasses Colyseus entirely by design (N9), and an upgrade's whole surface is the lobby half plus the reconnect path — the two places a regression is least visible and most annoying.
>
> **What it is expected to read.** Unknown, and that is the honest answer: nobody has checked. Step 1 is cheap and its output is the gate ledger's row 2.

**Files:**
- Modify: `packages/server/package.json`, `packages/client/package.json`, `package-lock.json`, `packages/server/src/index.ts`, `packages/server/src/rooms/ArenaRoom.ts`, `packages/server/src/rooms/PracticeRoom.ts`, `packages/server/src/rooms/PlaygroundRoom.ts`, `packages/client/src/net/connection.ts`, `docs/deployment.md`
- Test: every existing suite; no new test module. The upgrade's proof is that the shipped ones still pass **and** `npm run smoke:arena` and `npm run smoke:reconnect` still pass, which is the only place the lifecycle is exercised end to end.

**Interfaces:**
- Consumes: N5's `smoke:reconnect`, `Reconnector`, `reconnectArena`; N2's `SnapshotBroadcaster` and `ColyseusTransport`.
- Produces: no new export. A version bump and whatever call-site edits the upgrade forces, each named in Step 3.

- [ ] **Step 1: Answer the two questions, in writing, before changing anything**

Nothing is installed for this step. Work in a scratch directory outside the repository so the lockfile is untouched:

```bash
mkdir -p /tmp/colyseus-018 && cd /tmp/colyseus-018 && npm init -y
npm install colyseus@0.18 @colyseus/core@0.18 @colyseus/ws-transport@0.18 colyseus.js@0.16
node -e "const c=require('@colyseus/core');console.log(Object.keys(c).sort().join('\n'))"
ls node_modules/@colyseus
grep -rn "sendBytes" node_modules/@colyseus/core/build/*.d.ts node_modules/@colyseus/core/build/**/*.d.ts | head
grep -rn "allowReconnection\|reconnectionToken" node_modules/@colyseus/core/build/**/*.d.ts | head
ls node_modules/@colyseus | grep -i "transport\|webtransport\|uwebsockets"
```

Write the answers into the gate ledger row 2 as three short sentences: whether an unreliable datagram path exists server → client and under what package name; whether `sendBytes` survives with the same signature; whether `allowReconnection` survives with the same signature. **If the first answer is no, stop here** — record the finding, mark Tasks 2 and 3 skipped with it, and the phase has done its job for a morning's work.

- [ ] **Step 2: Take the baseline you will be judged against**

Before the bump, on the current tree:

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build
npm run smoke:arena && npm run smoke:reconnect
cd packages/server && npx tsx playtest/netcode.ts && cd ../..
```

Keep the harness report folder's path. An upgrade that changes a netcode number is exactly what this baseline exists to catch, and "it felt the same" is not a number.

- [ ] **Step 3: Bump, compile, and fix what the compiler names**

```bash
npm install -w @motor-combat-moba/server colyseus@^0.18 @colyseus/core@^0.18 @colyseus/ws-transport@^0.18 @colyseus/monitor@^0.18
npm install -w @motor-combat-moba/client colyseus.js@^0.16
npm run build -w @motor-combat-moba/shared && npm run typecheck
```

`@colyseus/schema` is a **separate** version line and is a dependency of `packages/shared` as well as the server (`packages/shared/package.json:21`). If 0.18 requires a schema major, bump it in **both** package files in the same commit or the two will disagree at runtime in a way no test catches — the schema is the lobby's wire format and both halves must encode it identically.

Then fix, one commit each, only what the compiler names. The four call sites most likely to move, with what to keep true at each:

| Site | What it does today | The invariant to preserve |
|---|---|---|
| `packages/server/src/index.ts:36-38` | `new Server({ transport: new WebSocketTransport({ server: httpServer }) })` | the HTTP server is shared with express, because LAN mode serves the client build off the same port (`index.ts:31-33`) |
| `ArenaRoom.onLeave` (N5) | `await this.allowReconnection(client, NET_CONFIG.reconnectSeconds)` | the seat is held for `reconnectSeconds` and `releaseSeat` runs only when the window rejects — N5's suite is the check |
| `SnapshotBroadcaster` (N2) | `client.sendBytes(MSG_SNAPSHOT, bytes)` | one binary message per tick, no schema patching; `setPatchRate(null)` still disables auto-patching |
| `client/src/net/connection.ts` | `client.joinOrCreate<ArenaState>(ROOM_NAME, { name })` and the two sibling rooms | a refused join still rejects with the server's own error string, which three screens turn into readable text |

- [ ] **Step 4: Prove the lifecycle, not just the compile**

Run: the whole of Step 2 again, and compare every number.

```bash
npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build
npm run smoke:arena && npm run smoke:reconnect
cd packages/server && npx tsx playtest/netcode.ts && cd ../..
```

Expected: all green, and the harness's N1–N8 rows inside noise of the Step 2 baseline. **`smoke:reconnect` is the one that matters** — it is the only automated exercise of `allowReconnection` and the reconnect token end to end, and a version bump is exactly the kind of change that breaks it silently while every unit test passes.

Then by hand, because two of these have no automated cover: open two browsers on a LAN build, join, play a round, pull one machine's cable and plug it back in; and open the monitor at `/colyseus` (`packages/server/src/monitor.ts`) to confirm it still mounts.

- [ ] **Step 5: The pages, and commit**

`docs/deployment.md`: the Colyseus version wherever it is named. `packages/server/CLAUDE.md` if it names 0.15.

```bash
git add package-lock.json packages/server/package.json packages/client/package.json packages/server/src packages/client/src docs packages/server/CLAUDE.md
git commit -m "chore(deps): Colyseus 0.15 -> 0.18"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Say it loudly in the summary.** This touches no probe file, but it changes the runtime under `playtest/netcode.ts`, which drives a real room pipeline. Quote the before/after N1–N8 rows in the merge commit and recommend `npm run playtest` — this is a dependency change under the sim's own host, and "the tests pass" is not the same claim.

**Task 2's acceptance:** every suite green; `npm run smoke:arena` and `npm run smoke:reconnect` green; the harness's rows inside noise of the Step 2 baseline; the monitor mounts; a hand-run cable pull resumes. Record the two Step 1 answers in the gate ledger whatever the outcome — they are the phase's most reusable finding.

---

### Task 3: A WebTransport transport behind `MatchTransport`

**Gate.**

> **Read three things, all of which must hold:**
>
> 1. **Task 2 has landed**, and its Step 1 answered *yes* to unreliable datagrams server → client. Without that, this task has nothing to sit on.
> 2. **TCP head-of-line blocking is actually costing something.** Spec §6.3's N12 computes the cost as *"a one-RTT stall about once every three seconds of snapshots"* at 1 % loss, and says the jitter buffer and lead absorb it. The measurement is the harness's N3 row (frozen frames, remote error p95 at `lossRate` 0.01) and, in a real match, `?debug=net`'s correction and snap counters. **Run this task when loss-attributable stalls put remote error p95 over §7's 20 u line at the design point and Task 5's lever is exhausted.**
> 3. **There is a certificate the browser trusts.** WebTransport is HTTP/3 over TLS. Spec §13 is explicit: for a player-hosted server that means certificate-hash pinning on a two-week rotation, which is a worse problem than the one being solved. **This gate is expected to read false until hosting moves** (spec §10 question 5), and that is the honest reason this is task three of five rather than task one.
>
> **What it is expected to read.** False, on every count, for as long as the game is player-hosted on a LAN. Read it anyway when the harness's N3 row moves.

**Files:**
- Create: `packages/client/src/match/webtransport.ts`, `packages/client/src/match/webtransport.test.ts`, `packages/client/src/match/transport-select.ts`, `packages/client/src/match/transport-select.test.ts`
- Modify: `packages/server/src/index.ts`, `packages/client/src/scenes/ArenaScene.ts`, `docs/networking.md`, `docs/deployment.md`

**Interfaces:**
- Consumes: N2's `MatchTransport`, `ColyseusTransport`, `MSG_SNAPSHOT`, `encodeInput`, `decodePong`; N5's `ColyseusTransport.rebind` — **the proof this seam is swappable at runtime**, which is what N5's Handoff hands this task.
- Produces:

```ts
// packages/client/src/match/webtransport.ts
export interface DatagramSocket {                       // the seam that keeps the test out of a browser
  readonly datagrams: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
  readonly closed: Promise<unknown>;
  close(): void;
}
export class WebTransportTransport implements MatchTransport {
  constructor(socket: DatagramSocket, fallback: MatchTransport);
  start(): void;
  stop(): void;
  readonly datagramsIn: number;
  readonly datagramsOut: number;
  readonly degraded: boolean;                           // true once it has fallen back
}

// packages/client/src/match/transport-select.ts
export type TransportKind = "colyseus" | "webtransport";
export function transportKind(search?: string, capable?: boolean): TransportKind;
export async function openTransport(room: Room<ArenaState>, endpoint: string): Promise<MatchTransport>;
```

#### The shape of the change, and the one rule it must not break

`MatchTransport` has five members and no notion of reliability. That is deliberate (N12), and it means a datagram transport is a **constructor swap and nothing else** — `MatchClient` subscribes once at construction (N5), and N5's `rebind` already proved a live client tolerates the room under it changing.

The rule this task must not break: **the roster is reliable and the snapshot is not.** `MSG_ROSTER` carries the protocol hash and the car indices without which a snapshot cannot even be decoded, and it is sent once at join and on reconnect. So the split is:

| Channel | Path | Why |
|---|---|---|
| Roster | **always Colyseus**, never a datagram | one message, ordering-critical, and losing it is unrecoverable rather than merely late |
| Snapshot | datagram when available | a lost snapshot is replaced 16.7 ms later (N9); that is the entire argument for the change |
| Input | datagram, with N10's redundancy | `encodeInput` already carries a run of the last inputs — **this is the capability that has been in the codec since phase 2 waiting for exactly this task**, and turning it on is a `count` other than 1 |
| Ping/pong | datagram | an RTT sample over a stalled TCP stream measures the stall, not the link |

`WebTransportTransport` therefore **composes** rather than replaces: it takes the Colyseus transport as `fallback`, forwards `onRoster` to it verbatim, and carries the other four itself. When the datagram socket closes or errors, `degraded` flips and every member forwards to the fallback — a WebTransport session dying mid-match must cost a stutter, not the match.

- [ ] **Step 1: Write the failing transport test**

```ts
// packages/client/src/match/webtransport.test.ts
import { describe, expect, it, vi } from "vitest";
import { DatagramSocket, WebTransportTransport } from "./webtransport.js";
import type { MatchTransport } from "./transport.js";

function fakeSocket(): DatagramSocket & { deliver(bytes: Uint8Array): void; fail(): void; sent: Uint8Array[] } {
  const sent: Uint8Array[] = [];
  let push: ((bytes: Uint8Array) => void) | undefined;
  let closeSocket: (() => void) | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (bytes) => controller.enqueue(bytes);
      closeSocket = () => controller.close();
    },
  });
  const writable = new WritableStream<Uint8Array>({ write(chunk) { sent.push(chunk); } });
  return {
    datagrams: { readable, writable },
    closed: new Promise(() => {}),
    close: () => closeSocket?.(),
    deliver: (bytes) => push?.(bytes),
    fail: () => closeSocket?.(),
    sent,
  };
}

const stubFallback = (): MatchTransport & { inputs: Uint8Array[] } => {
  const inputs: Uint8Array[] = [];
  return {
    inputs,
    sendInput: (bytes) => inputs.push(bytes),
    sendPing: vi.fn(),
    onSnapshot: vi.fn(() => () => {}),
    onPong: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
  };
};

describe("WebTransportTransport", () => {
  it("delegates the roster to the reliable fallback, always", () => {
    const fallback = stubFallback();
    const transport = new WebTransportTransport(fakeSocket(), fallback);
    const cb = vi.fn();
    transport.onRoster(cb);
    expect(fallback.onRoster).toHaveBeenCalledWith(cb);
  });

  it("carries a snapshot datagram to its subscriber", async () => {
    const socket = fakeSocket();
    const transport = new WebTransportTransport(socket, stubFallback());
    const seen: Uint8Array[] = [];
    transport.onSnapshot((bytes) => seen.push(bytes));
    transport.start();
    socket.deliver(Uint8Array.of(9, 8, 7));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect([...seen[0]!]).toEqual([9, 8, 7]);
    expect(transport.datagramsIn).toBe(1);
  });

  it("writes an input to the datagram channel rather than the fallback", () => {
    const socket = fakeSocket();
    const fallback = stubFallback();
    const transport = new WebTransportTransport(socket, fallback);
    transport.start();
    transport.sendInput(Uint8Array.of(1, 2));
    expect(fallback.inputs).toHaveLength(0);
    expect(transport.datagramsOut).toBe(1);
  });

  it("falls back to the reliable path when the socket dies, and says so", async () => {
    const socket = fakeSocket();
    const fallback = stubFallback();
    const transport = new WebTransportTransport(socket, fallback);
    transport.start();
    socket.fail();
    await vi.waitFor(() => expect(transport.degraded).toBe(true));
    transport.sendInput(Uint8Array.of(3));
    expect(fallback.inputs).toHaveLength(1);
  });
});
```

```ts
// packages/client/src/match/transport-select.test.ts
import { describe, expect, it } from "vitest";
import { transportKind } from "./transport-select.js";

describe("transportKind", () => {
  it("is colyseus unless the browser can and the URL asks", () => {
    expect(transportKind("", true)).toBe("colyseus");
    expect(transportKind("?transport=webtransport", false)).toBe("colyseus");
    expect(transportKind("?transport=webtransport", true)).toBe("webtransport");
  });

  it("lets the URL force the reliable path back on, which is the field diagnostic", () => {
    expect(transportKind("?transport=colyseus", true)).toBe("colyseus");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/client && npx vitest run src/match/webtransport.test.ts src/match/transport-select.test.ts`
Expected: FAIL — neither module resolves.

- [ ] **Step 3: Write the transport**

```ts
// packages/client/src/match/webtransport.ts
import type { PingMessage, PongMessage } from "@motor-combat-moba/shared";
import { decodePong, encodePong } from "@motor-combat-moba/shared";
import type { MatchTransport } from "./transport.js";

/**
 * The datagram half of `MatchTransport` (netcode spec N12), over whatever unreliable channel the
 * host offers. Typed against the two members it uses rather than against the browser's
 * `WebTransport`, so the whole class is testable in node with a pair of streams.
 */
export interface DatagramSocket {
  readonly datagrams: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
  readonly closed: Promise<unknown>;
  close(): void;
}

/** First byte of every datagram: which of the two unreliable channels this is. */
const DATAGRAM_SNAPSHOT = 1;
const DATAGRAM_PONG = 2;
const DATAGRAM_INPUT = 3;

/**
 * Snapshots, inputs and pongs over datagrams; the roster over the reliable transport it wraps.
 *
 * A lost snapshot is replaced 16.7 ms later (N9), which is the whole argument for being here. A lost
 * ROSTER is unrecoverable, so it never leaves the reliable path — that split is the one rule this
 * class exists to keep.
 *
 * `degraded` is one-way. A datagram session that dies mid-match hands everything back to the
 * reliable transport and stays there for the rest of the match: a transport that flapped would
 * re-order snapshots against themselves, and one stutter is cheaper than that.
 */
export class WebTransportTransport implements MatchTransport {
  private snapshotCb: ((bytes: Uint8Array) => void) | undefined;
  private pongCb: ((pong: PongMessage) => void) | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private running = false;
  private fellBack = false;
  private inCount = 0;
  private outCount = 0;

  constructor(
    private readonly socket: DatagramSocket,
    private readonly fallback: MatchTransport,
  ) {}

  get datagramsIn(): number { return this.inCount; }
  get datagramsOut(): number { return this.outCount; }
  get degraded(): boolean { return this.fellBack; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.writer = this.socket.datagrams.writable.getWriter();
    void this.pump();
    void this.socket.closed.then(() => this.degrade(), () => this.degrade());
  }

  stop(): void {
    this.running = false;
    this.writer?.releaseLock();
    this.writer = undefined;
    this.socket.close();
  }

  sendInput(bytes: Uint8Array): void {
    if (this.fellBack) { this.fallback.sendInput(bytes); return; }
    this.write(DATAGRAM_INPUT, bytes);
  }

  sendPing(ping: PingMessage): void {
    if (this.fellBack) { this.fallback.sendPing(ping); return; }
    // The ping rides the same encoder as the pong so both halves of an RTT sample are one shape.
    this.write(DATAGRAM_PONG, encodePong({ clientMs: ping.clientMs, serverTick: 0, msIntoTick: 0 }));
  }

  onSnapshot(cb: (bytes: Uint8Array) => void): () => void {
    this.snapshotCb = cb;
    const undoFallback = this.fallback.onSnapshot(cb);
    return () => { this.snapshotCb = undefined; undoFallback(); };
  }

  onPong(cb: (pong: PongMessage) => void): () => void {
    this.pongCb = cb;
    const undoFallback = this.fallback.onPong(cb);
    return () => { this.pongCb = undefined; undoFallback(); };
  }

  /** Always reliable. See the class comment: a lost roster cannot be recovered from. */
  onRoster(cb: Parameters<MatchTransport["onRoster"]>[0]): () => void {
    return this.fallback.onRoster(cb);
  }

  private write(channel: number, payload: Uint8Array): void {
    const writer = this.writer;
    if (!writer) return;
    const framed = new Uint8Array(payload.length + 1);
    framed[0] = channel;
    framed.set(payload, 1);
    this.outCount += 1;
    void writer.write(framed).catch(() => this.degrade());
  }

  private async pump(): Promise<void> {
    const reader = this.socket.datagrams.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        this.inCount += 1;
        const payload = value.subarray(1);
        if (value[0] === DATAGRAM_SNAPSHOT) this.snapshotCb?.(payload);
        else if (value[0] === DATAGRAM_PONG) this.pongCb?.(decodePong(payload));
      }
    } catch {
      // A read error is a dead session, which is the same thing as a closed one.
    } finally {
      reader.releaseLock();
      this.degrade();
    }
  }

  private degrade(): void {
    if (this.fellBack) return;
    this.fellBack = true;
    this.writer = undefined;
  }
}
```

```ts
// packages/client/src/match/transport-select.ts
import type { Room } from "colyseus.js";
import type { ArenaState } from "@motor-combat-moba/shared";
import { ColyseusTransport, type MatchTransport } from "./transport.js";
import { WebTransportTransport, type DatagramSocket } from "./webtransport.js";

export type TransportKind = "colyseus" | "webtransport";

/**
 * Which transport this session gets. Opt-in by URL and only where the browser has the API, because
 * WebTransport needs a certificate the browser trusts (spec §13) and a player-hosted server does not
 * have one. `?transport=colyseus` forces the reliable path back on, which is the field diagnostic
 * when a match feels wrong and nobody knows which half to blame.
 */
export function transportKind(
  search: string = window.location.search,
  capable: boolean = typeof (globalThis as { WebTransport?: unknown }).WebTransport === "function",
): TransportKind {
  return capable && new URLSearchParams(search).get("transport") === "webtransport"
    ? "webtransport"
    : "colyseus";
}

export async function openTransport(room: Room<ArenaState>, endpoint: string): Promise<MatchTransport> {
  const colyseus = new ColyseusTransport(room);
  if (transportKind() === "colyseus") return colyseus;
  try {
    const Ctor = (globalThis as { WebTransport: new (url: string) => DatagramSocket }).WebTransport;
    const socket = new Ctor(endpoint);
    const transport = new WebTransportTransport(socket, colyseus);
    transport.start();
    return transport;
  } catch (error) {
    console.warn(`[net] WebTransport unavailable, staying on the reliable path: ${String(error)}`);
    return colyseus;
  }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd packages/client && npx vitest run src/match/webtransport.test.ts src/match/transport-select.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: The server side, and the honest limit**

The server half depends entirely on what Task 2 Step 1 found. Two shapes, and the plan states both rather than guessing which one 0.18 offers:

| If 0.18 offers | Then `packages/server/src/index.ts` | And the room |
|---|---|---|
| a first-party datagram transport | construct it beside `WebSocketTransport` and pass both to `new Server({ transport })`, gated on a `WEBTRANSPORT_CERT` env knob so a LAN build never tries | `SnapshotBroadcaster.afterTick` sends the same bytes down whichever channel the client's session has |
| nothing usable | **stop, and record it.** Do not hand-roll an HTTP/3 server beside Colyseus: two session lifecycles for one match is the failure mode N12's seam exists to avoid | — |

Whichever holds, the client's `MatchClient` is untouched: it takes a `MatchTransport` and always did.

- [ ] **Step 6: Measure the thing it was supposed to fix**

Run the harness's N3 row (jitter and loss at the design point) with the datagram path in the loop, against the run recorded in the gate. The number to move is **remote error p95 at `lossRate` 0.01**; if it does not move, the change did not buy what it was for, and that belongs in the merge commit as plainly as a win would.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/match/webtransport.ts packages/client/src/match/webtransport.test.ts packages/client/src/match/transport-select.ts packages/client/src/match/transport-select.test.ts packages/client/src/scenes/ArenaScene.ts packages/server/src/index.ts docs
git commit -m "feat(net): a WebTransport datagram transport behind the MatchTransport seam"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Say it loudly in the summary.** No probe file is touched. `playtest/netcode.ts` drives a `LoopbackTransport` and is unaffected by which transport a browser picks, which is worth stating explicitly so nobody reads a green harness as evidence the datagram path works — **only a real browser against a real certificate can show that**, and the by-hand check in Step 6 is the whole of it.

**Task 3's acceptance:** the six unit tests green; `?transport=webtransport` on a capable browser against a trusted certificate plays a match with `degraded` false; pulling the datagram path mid-match (close the session from the server) leaves the match running on the reliable path; and the N3 row's remote error p95 at 1 % loss measured with and without, both recorded.

---

### Task 4: `thunderclap`'s wind-up — N31 as a balance change

**Gate.**

> **Read two numbers:**
>
> 1. **`telegraphAudit()`**, which N4 shipped (`packages/shared/src/config/telegraph.ts`). Today it names exactly one row: **`thunderclap`, failing N31 rules 1 and 3** — `startUpMs` 0 against a 150 ms window, 96,000 u/s² of commanded acceleration against a 4,267 u/s² budget, and **240 u of error on a victim's screen against a 48 u car**. Run `cd packages/shared && npx vitest run src/config/telegraph.test.ts` to see it, or call `telegraphAudit()` from a scratch script.
> 2. **How often it actually bites.** N4's late-reveal path (`RenderCar.revealedManeuver`, rendering spec R18a) covers the case by playing the dash's own trail rather than sliding the car. The question the gate asks is whether players notice: count reveals per match from the netgraph, or count `snaps` attributable to a maneuver in the harness.
>
> **The threshold:** run this task when the audit is non-empty **and** the reveal is happening often enough to read as unfair — a dash arriving visibly late on a victim's screen more than a couple of times a match at the design point. **The audit alone is not the gate.** N4 deliberately shipped the violation with the rendering answer beside it; this task is the *sim* answer and it costs a real change in how the weapon plays.
>
> **What it is expected to read.** The audit: non-empty, permanently, until this task runs. The reveal rate: unknown until phase 4 has been played on a real link. This is the only one of the five gates whose first half is already known to be true.

**This task edits a balance table.** That carries four obligations, all of them below, none of them optional.

**Files:**
- Modify: `packages/shared/src/config/weapon-config.ts` (the `thunderclap` row and its doc comment), `packages/shared/src/config/weapon-config.test.ts`, `packages/shared/src/config/telegraph.test.ts`, `scripts/cars-and-weapons-copy.mjs`, `packages/client/public/manual.html` (regenerated), `docs/config-reference.md`, `docs/combat-model.md`
- Test: the three suites above, plus `node --test scripts/manual-page.test.mjs scripts/manual-facts.test.mjs scripts/turn-tuning-doc.test.mjs`

**Interfaces:**
- Consumes: N4's `telegraphAudit`; `NET_CONFIG.telegraphWindowMs` (150); `weaponTicksOf`.
- Produces: no export. One number.

#### What the sim already does with a wind-up, and why no code changes

This is the part worth checking before touching anything, because it decides whether the task is one line or fifty.

`beginFire` commits the press and sets `pending.nextShotTick = tick + weaponTicksOf(id).startUp`; `releaseShots` emits the order on that tick; and only then does `runCombat` call `startManeuver` (`packages/shared/src/sim/combat.ts:480-484`). So a maneuver weapon with a wind-up already behaves the way N31 asks:

| Tick | What is true | What a remote client sees |
|---|---|---|
| press | the stock is spent, `pending` is set, `pendingUntilTick` and `lastFiredSlot` are on the wire | "that car has committed to slot 2" — **9 ticks before the dash** |
| press + 9 | `startManeuver` freezes `maneuverAngle` and `maneuverSpeed`; `stepDrive` integrates them | the dash, predicted exactly from its first tick, because every field it needs arrived a window ago |

`msToTicks(150)` at 60 Hz is `ceil(150 × 60 / 1000)` = **9 ticks**, exactly 150 ms. So `startUpMs: 150` is `startUpMs >= NET_CONFIG.telegraphWindowMs` with no rounding slack, and rule 1 passes. Rule 3 stops applying: it is the budget for powers that *cannot* be telegraphed, and this one now is.

**No sim code changes.** One table field, and the audit goes quiet.

#### What it costs the player, which is the actual decision

Three consequences, and the user is owed all three before saying yes:

1. **A 150 ms tell before a 400-unit lunge.** That is the counterplay N31 is arguing for, and it is a nerf: the dash stops being unreactable.
2. **A stun can now eat the press.** `runCombat`'s interruption pass (`combat.ts:622-636`) cancels `pending` when a stun lands and the weapon is not `isUnInterruptable`; `thunderclap` is not. With `startUpMs: 0` that window did not exist. With 150 ms it is nine ticks wide, the stock stays spent (O14), and **`roadblock` gains a hard counter to `thunderclap` that it did not have yesterday.** If that is unwanted, the answer is `isUnInterruptable: true` on the row — a second balance decision, not a detail.
3. **Commitment goes up by 150 ms.** The manual's own Commitment bar is `startUpMs + recoveryMs + cooldownMs`, so `thunderclap` moves 5.2 s → 5.35 s and its bar is drawn against `MAX.commit` (`lance`'s 17.7 s), which is a visible change on the players' guide.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/config/telegraph.test.ts` — invert the first case, which N4 wrote to fail when the *set* of violating rows changes:

```ts
  it("names no violating row: every mobility power telegraphs for the window", () => {
    expect(
      telegraphAudit(),
      "a mobility power that fails N31 must be raised with the user as a balance change — see " +
        "16-netcode-6-optional.md Task 4",
    ).toEqual([]);
  });

  it("thunderclap telegraphs for at least the design-point window", () => {
    expect(WEAPON_TABLE.thunderclap.startUpMs).toBeGreaterThanOrEqual(NET_CONFIG.telegraphWindowMs);
    // The wind-up must be a whole number of ticks or the tell is a tick shorter than it reads.
    expect(weaponTicksOf("thunderclap").startUp).toBe(
      Math.ceil((NET_CONFIG.telegraphWindowMs * TICK_RATE_HZ) / 1000),
    );
  });
```

**Delete N4's second case** — "reports thunderclap's numbers from the live table" — and say so in the commit: it asserted the shape of a violation that no longer exists, and keeping it alive against a synthetic row would be testing the audit's arithmetic twice.

`packages/shared/src/config/weapon-config.test.ts`, beside the existing `expect(lance.startUpMs).toBe(700)`:

```ts
    // N31 rule 1: a mobility power telegraphs for at least the design-point extrapolation window,
    // so a remote client predicts the dash exactly from its first tick rather than being told about
    // it 240 units late. Raised from 0 by netcode phase 6.
    expect(WEAPON_TABLE.thunderclap.startUpMs).toBe(150);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/shared && npx vitest run src/config/telegraph.test.ts src/config/weapon-config.test.ts`
Expected: FAIL — the audit still names `thunderclap`, and `startUpMs` is 0.

- [ ] **Step 3: Make the edit**

`packages/shared/src/config/weapon-config.ts`, in the `thunderclap` row:

| Before | After |
|---|---|
| `startUpMs: 0,` | `startUpMs: 150, // ⚙ N31's telegraph window; see the comment above` |

and append to that row's doc comment, above `thunderclap:`:

```ts
   * **The 150 ms wind-up is a netcode requirement, not a feel one (N31).** A dash is an instant,
   * large, unknown acceleration: with no wind-up, a victim's client cannot know it happened until
   * the snapshot arrives, and the car is 240 units — five car lengths — from where that client had
   * it. No amount of prediction fixes information that does not exist yet. The wind-up puts
   * `pendingUntilTick`, `lastFiredSlot` and the locked angle and speed on the wire a full
   * extrapolation window before the car moves, so every other client predicts the dash exactly from
   * its first tick. `NET_CONFIG.telegraphWindowMs` is the floor and
   * `config/telegraph.ts`'s audit is what fails if a future maneuver row forgets it.
   *
   * Two consequences that are balance, not netcode, and were accepted with it: the dash is now
   * reactable, and a stun landing inside the wind-up cancels the press while the stock stays spent
   * (`runCombat`'s interruption pass, O14) — which hands `roadblock` a counter it did not have. If
   * that reads as too strong, the lever is `isUnInterruptable: true` on this row, and that is its
   * own decision.
```

- [ ] **Step 4: Run them to verify they pass, then the whole suite**

Run:

```bash
npm run build -w @motor-combat-moba/shared
cd packages/shared && npx vitest run src/config && cd ../..
npm test
```

Expected: the two suites pass. **`npm test` will fail**, on `scripts/manual-page.test.mjs`, with the message telling you to run `npm run build:manual` — `balanceStamp` hashes `WEAPON_TABLE` whole, so any field of any row moves it. That failure is the guard working; Step 5 is the fix.

Also expect `packages/shared/src/sim/weapons/fire.test.ts` and `packages/shared/src/sim/combat.test.ts` to be worth re-reading even if they pass: any case that presses `thunderclap` and asserts the dash begins on the press tick is now asserting something false. Fix the test's tick expectations, never the row.

- [ ] **Step 5: The four obligations of a balance edit**

**(a) The players' guide.** The generated page gains a "Wind-up 150ms / 9 ticks — you are visible" row (`build-cars-and-weapons.mjs:624`), the Commitment bar grows, and the at-a-glance table's wind-up cell stops reading `—`. All of that is generated. **Two sentences of prose are not**, and `manual-facts.test.mjs` cannot see either of them, because they are claims rather than figures:

`scripts/cars-and-weapons-copy.mjs`, the `thunderclap` entry:

| Field | Before | After |
|---|---|---|
| `how` | `"…no instance to dodge, no travel time to react to, just whether you are still there when it lands."` | `"…no instance to dodge — but there is a wind-up, and the moment you commit, every other car can see it coming before you move."` |
| `tip` | `"Use it to close, not to open from range — it is not a ranged threat, it is the last few metres. …"` | unchanged in its first half; append: `" The wind-up is short but it is real: a stun landing inside it eats the press and the recharge with it."` |

The `what` field is safe as written — `"{thunderclap.dashUnits}-unit lunge … covering the distance in well under a second"` describes the dash itself, which did not change.

Then:

```bash
npm run build:manual
git add packages/client/public/manual.html scripts/cars-and-weapons-copy.mjs
```

**(b) `docs/turn-tuning.md`: nothing is owed, and here is why.** That page's test recomputes turn numbers from `CAR_TABLE`'s `handling`/`speed`, `DRIVE_CONFIG`'s six knobs, `overheated`'s `turnRate`, `RAM_CONFIG`'s two, and `TICK_RATE_HZ`. A weapon's `startUpMs` is in none of them, and `thunderclap`'s dash speed — the one number of this row that could reach a turn figure — is untouched. Run `node --test scripts/turn-tuning-doc.test.mjs` to confirm rather than to discover.

**(c) `protocolHash()` moves.** It hashes `WEAPON_TABLE` (N11), so **every client on an older build is refused at join** with the message naming the mismatch. That is correct and is the mechanism working, but it means this change ships as a coordinated rebuild, not as a server-side hot fix. Say so in the release notes and in `docs/deployment.md` if it names the hash.

**(d) `configFingerprint` moves**, so **every balance report taken before this edit is incomparable to every one after it** (`packages/server/balance/fingerprint.ts`). `npm run balance --baseline` will refuse the comparison rather than average over it. Take a fresh baseline in the same session as this edit:

```bash
npm run balance -- --shape=duel --matches=40 --seed=7
```

and quote the Mirage win-rate interval before and after in the merge commit. **`thunderclap` is Mirage's slot 2 and the harness's bot presses it**, so this is one of the few balance edits the harness can actually see.

**(e) Documentation.** `docs/config-reference.md`'s `WEAPON_TABLE` section: the `thunderclap` row's wind-up. `docs/combat-model.md`: wherever it describes the dash as instant.

- [ ] **Step 6: Commit**

```bash
npm run build -w @motor-combat-moba/shared && npm test
git add packages/shared/src/config packages/client/public/manual.html scripts/cars-and-weapons-copy.mjs docs
git commit -m "balance(weapons): thunderclap telegraphs for 150 ms (N31 rule 1)"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Say it loudly in the summary — this is the loudest one in the plan.** A `WEAPON_TABLE` row moved. The probes that measure it: **`playtest/weapons.ts`** (flight and reach figures — `thunderclap` is a maneuver, so its reach row is the dash distance, unchanged, but its *commit* time is not), **`playtest/netcode.ts`'s N4 weapon-exposure row** (which prints `flight = min(range, lockRange) / speed + startUpMs` and will now read 150 ms higher for this row), and **`playtest/ram.ts`** if it presses the dash to produce contacts. Recommend `npm run playtest` **and** `npm run balance`, hand both reports over, and name the N4 row's number as the one that moved by construction rather than by surprise.

**Task 4's acceptance:** `telegraphAudit()` returns `[]`; `weaponTicksOf("thunderclap").startUp === 9`; the manual page regenerated and committed with its stamp green; `npm test` green including the three script tests; a fresh balance baseline taken and quoted. And the one thing no test can check, so a person must: press the dash in a practice room and confirm the 150 ms reads as a tell rather than as lag.

---

### Task 5: `remoteSteerHoldTicks`, tuned against recorded input logs

**Gate.**

> **Read:** the harness's **N5 checkpoint row** (execution guide §6) and its **N3 jitter row** — specifically **remote extrapolation error p95** against spec §7's line of **20 u**.
>
> **The threshold:** run this task when remote error p95 is within about 25 % of 20 u at the design point, or over it. Spec §6.6 names exactly two levers before the approach-B fallback: *"lower the lead for the link, and tune `remoteSteerHoldTicks` against recorded input logs"*. **This task is the second lever, and it is the last thing to try before the checkpoint fails**, so running it early costs nothing and running it late costs the netcode stream.
>
> **What it is expected to read.** N3's own acceptance is remote error p95 < 20 u and it merged green, so the gate reads false at the design point on a healthy link. It is expected to read *true* on a link worse than the design point — 150 ms RTT, or the 25 ms-jitter cell — which is exactly where the current value of 6 was a guess.
>
> **The one number this task may change:** `NET_CONFIG.remoteSteerHoldTicks`, currently **6** — 100 ms at 60 Hz. It is not a balance table, is not in `protocolHash` and is not in `configFingerprint`, so it owes neither the manual page nor a balance baseline. It **is** read by the client's predictor, which the probes measure.

**Files:**
- Create: `packages/server/src/net/input-log-read.ts`, `packages/server/src/net/input-log-read.test.ts`
- Modify: `packages/server/playtest/netcode.ts`, `packages/server/playtest/README.md`, `packages/shared/src/config/net-config.ts` (**only if the sweep names a different value**), `docs/config-reference.md`, `docs/networking.md`

**Interfaces:**
- Consumes: N0's `InputLog` and its line format (`packages/server/src/net/input-log.ts`); N3's `WorldPredictor`, whose constructor takes `Pick<typeof NET_CONFIG, "maxPredictionTicks" | "maxExtrapolationTicks" | "remoteSteerHoldTicks">` — **that slice is what makes a sweep possible at all**, because a trial can vary the number without touching the process-wide config.
- Produces:

```ts
// packages/server/src/net/input-log-read.ts
export interface InputLogEntry { tick: number; sessionId: string; input: InputFrame }
export interface ParsedInputLog { header: InputLogHeader | undefined; entries: InputLogEntry[] }
export function parseInputLog(text: string): ParsedInputLog;
export function inputsByTick(log: ParsedInputLog): Map<number, Map<string, InputFrame>>;
export function steerRunLengths(log: ParsedInputLog): number[];
```

#### What the number is, and what the log is for

`WorldPredictor` extrapolates a remote car with its last known input. `remoteSteerHoldTicks` is **how long a held steer is believed** before the predictor assumes the player let go and zeroes it (`prediction.ts`, the line N3 wrote as `age > cfg.remoteSteerHoldTicks ? { ...last, steer: 0 } : last`).

Too short and a remote in a sustained turn is drawn straightening out, which is the error `v·ω` dominates — spec §13 records that the steering term dominates prediction error and that two earlier drafts got this wrong by reasoning about throttle. Too long and a remote that *did* let go keeps curving.

The right value is a property of **how long human players actually hold a steer**, which is a fact about the game nobody has, and which N30's input log exists to answer: spec §13 calls it *"the only way to answer the note's own open question about whether input changes cluster at contact"*. So this task has two halves, and the first is worth doing even if the second changes nothing:

1. **Read the distribution** out of a real match's log.
2. **Sweep the number** in the harness, against both scripted inputs and that recorded log, and pick the value that minimises remote error p95 at the design point.

- [ ] **Step 1: Write the failing reader test**

```ts
// packages/server/src/net/input-log-read.test.ts
import { describe, expect, it } from "vitest";
import { inputsByTick, parseInputLog, steerRunLengths } from "./input-log-read.js";

const LOG = [
  `# {"v":1,"tick":10,"arenaId":"arena-01","cars":[{"sessionId":"a","carId":"mirage","x":0,"y":0,"angle":0}]}`,
  "11 a 1 1 0",
  "11 b 0 1 0",
  "12 a 1 1 0",
  "13 a 1 0 4",
  "14 a 0 1 0",
  "",
].join("\n");

describe("parseInputLog", () => {
  it("reads the header and every line", () => {
    const log = parseInputLog(LOG);
    expect(log.header?.tick).toBe(10);
    expect(log.header?.cars[0]?.sessionId).toBe("a");
    expect(log.entries).toHaveLength(5);
    expect(log.entries[3]).toEqual({ tick: 13, sessionId: "a", input: { steer: 1, throttle: 0, fireSlots: 4 } });
  });

  it("survives a truncated tail, which a killed server always leaves", () => {
    const log = parseInputLog(`${LOG}15 a 1`);
    expect(log.entries).toHaveLength(5);
  });

  it("groups by tick and session", () => {
    const byTick = inputsByTick(parseInputLog(LOG));
    expect(byTick.get(11)?.get("b")).toEqual({ steer: 0, throttle: 1, fireSlots: 0 });
    expect(byTick.size).toBe(4);
  });
});

describe("steerRunLengths", () => {
  it("measures how long a held steer is actually held, per car", () => {
    // "a" holds steer 1 for ticks 11-13, then releases: one run of 3.
    expect(steerRunLengths(parseInputLog(LOG))).toEqual([3]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && npx vitest run src/net/input-log-read.test.ts`
Expected: FAIL — cannot resolve `./input-log-read.js`.

- [ ] **Step 3: Write the reader**

```ts
// packages/server/src/net/input-log-read.ts
import type { InputFrame } from "@motor-combat-moba/shared";
import type { InputLogHeader } from "./input-log.js";

/**
 * Reads N30's per-tick input log back (`packages/server/src/net/input-log.ts` writes it).
 *
 * The reason this exists is netcode spec §13's open question: how long does a real player hold a
 * steer? `NET_CONFIG.remoteSteerHoldTicks` is an answer to that question that nobody has measured,
 * and `steerRunLengths` is the measurement. Deliberately tolerant — a log from a killed server ends
 * mid-line, and a reader that threw on that would be useless for exactly the sessions worth reading.
 */
export interface InputLogEntry {
  tick: number;
  sessionId: string;
  input: InputFrame;
}

export interface ParsedInputLog {
  header: InputLogHeader | undefined;
  entries: InputLogEntry[];
}

const axis = (raw: string): -1 | 0 | 1 => (raw === "1" ? 1 : raw === "-1" ? -1 : 0);

export function parseInputLog(text: string): ParsedInputLog {
  let header: InputLogHeader | undefined;
  const entries: InputLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("# ")) {
      try {
        header = JSON.parse(line.slice(2)) as InputLogHeader;
      } catch {
        // A truncated header is a log worth reading anyway: the entries are what the sweep needs.
      }
      continue;
    }
    const parts = line.split(" ");
    if (parts.length !== 5) continue;
    const tick = Number(parts[0]);
    const fireSlots = Number(parts[4]);
    if (!Number.isFinite(tick) || !Number.isFinite(fireSlots)) continue;
    entries.push({
      tick,
      sessionId: parts[1]!,
      input: { steer: axis(parts[2]!), throttle: axis(parts[3]!), fireSlots },
    });
  }
  return { header, entries };
}

export function inputsByTick(log: ParsedInputLog): Map<number, Map<string, InputFrame>> {
  const out = new Map<number, Map<string, InputFrame>>();
  for (const entry of log.entries) {
    let tick = out.get(entry.tick);
    if (!tick) {
      tick = new Map<string, InputFrame>();
      out.set(entry.tick, tick);
    }
    tick.set(entry.sessionId, entry.input);
  }
  return out;
}

/**
 * The length, in ticks, of every unbroken run of the same non-zero steer, per car. This is the
 * distribution `remoteSteerHoldTicks` is guessing at: a hold shorter than the number is believed to
 * its end, and one longer is straightened out early.
 */
export function steerRunLengths(log: ParsedInputLog): number[] {
  const runs: number[] = [];
  const open = new Map<string, { steer: number; tick: number; length: number }>();
  for (const entry of log.entries) {
    const current = open.get(entry.sessionId);
    const held = entry.input.steer !== 0;
    if (current && (!held || current.steer !== entry.input.steer || entry.tick !== current.tick + 1)) {
      runs.push(current.length);
      open.delete(entry.sessionId);
    }
    if (!held) continue;
    const still = open.get(entry.sessionId);
    if (still) {
      still.length += 1;
      still.tick = entry.tick;
    } else {
      open.set(entry.sessionId, { steer: entry.input.steer, tick: entry.tick, length: 1 });
    }
  }
  for (const run of open.values()) runs.push(run.length);
  return runs;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/server && npx vitest run src/net/input-log-read.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: The sweep, as harness row N9**

`playtest/netcode.ts`. `TrialOpts` gains two additive fields — `steerHoldTicks?: number` and `scriptedInputs?: Map<number, Map<string, InputFrame>>` — and `trial()` passes the first into the `WorldPredictor` it builds and reads the second in place of its fixed `FORWARD` when present. Both default to today's behaviour, so **every existing row is byte-identical**.

```ts
/* N9. remoteSteerHoldTicks: the second of §6.6's two levers, swept */
{
  const logPath = process.env.INPUT_LOG_DIR;
  const recorded = logPath
    ? inputsByTick(parseInputLog(fs.readFileSync(path.join(logPath, INPUT_LOG_FILE), "utf8")))
    : undefined;
  const candidates = [2, 4, 6, 8, 10, 12];
  const rows: string[] = [];
  let best = { ticks: NET_CONFIG.remoteSteerHoldTicks, p95: Infinity };
  for (const ticks of candidates) {
    const scripted = trial({ latencyMs: 45, jitterMs: 20, lossRate: 0.01, ticks: 900, seed: 13, steerHoldTicks: ticks });
    const replay = recorded
      ? trial({ latencyMs: 45, jitterMs: 20, lossRate: 0.01, ticks: 900, seed: 13, steerHoldTicks: ticks, scriptedInputs: recorded })
      : undefined;
    const p95 = pct(scripted.remoteErrors, 0.95);
    if (p95 < best.p95) best = { ticks, p95 };
    rows.push(
      `hold ${String(ticks).padStart(2)} ticks (${((ticks * MS_PER_TICK)).toFixed(0).padStart(3)} ms)  ` +
        `remote err p95 ${f1(p95)}u  max ${f1(Math.max(0, ...scripted.remoteErrors))}u  ` +
        `snaps ${String(scripted.snaps).padStart(3)}  correction p95 ${f2(pct(scripted.corrections, 0.95))}u` +
        (replay ? `  | recorded log: remote err p95 ${f1(pct(replay.remoteErrors, 0.95))}u` : ""),
    );
  }
  const holds = recorded ? steerRunLengths({ header: undefined, entries: [...recorded].flatMap(([tick, byId]) => [...byId].map(([sessionId, input]) => ({ tick, sessionId, input }))) }) : [];
  reporter.report(
    "N9. remoteSteerHoldTicks sweep (spec §6.6's second lever, §13's open question)",
    best.ticks === NET_CONFIG.remoteSteerHoldTicks ? VERDICT.OK : VERDICT.FINDING,
    `How long an extrapolated remote's held steer is believed before it is zeroed. Shipped value: ` +
      `${NET_CONFIG.remoteSteerHoldTicks} ticks (${(NET_CONFIG.remoteSteerHoldTicks * MS_PER_TICK).toFixed(0)} ms).\n` +
      `Design point, jitter +/-20 ms, 1 % loss, ${(900 * MS_PER_TICK / 1000).toFixed(0)} s. Spec §7's line: remote error p95 < 20 u.\n` +
      `${rows.join("\n")}\n` +
      `  best: ${best.ticks} ticks at ${f1(best.p95)} u\n` +
      (holds.length > 0
        ? `  recorded steer holds: n ${holds.length}  p50 ${pct(holds, 0.5)} ticks  p95 ${pct(holds, 0.95)} ticks  max ${Math.max(...holds)} ticks\n`
        : `  no recorded log: set INPUT_LOG_DIR=packages/server/logs/<run> to sweep against real inputs (N30)\n`) +
      `A FINDING here means the shipped number is not the best one MEASURED — it is not a bug, it is\n` +
      `the lever netcode phase 6 Task 5 exists to pull. Change NET_CONFIG only if the win survives a\n` +
      `second seed and the 150 ms RTT cell.`,
  );
}
```

- [ ] **Step 6: Decide, with a second seed**

Run:

```bash
cd packages/server && npx tsx playtest/netcode.ts
INPUT_LOG_DIR=packages/server/logs/<a real match's folder> npx tsx playtest/netcode.ts
```

Change `NET_CONFIG.remoteSteerHoldTicks` **only if all three hold**:

1. The sweep names a different value at the design point.
2. The same value wins on a second seed **and** in the 150 ms RTT cell (spec §7: *"Same run at 150 ms RTT: no metric worse than 2×"*).
3. Contact correction p95 and the snap count do not get worse — the number trades remote *display* error against how well contact is predicted, and N3's acceptance owns the second.

If it does not: **record the sweep table in the gate ledger and skip**, which is the likely outcome and a real result. `6` will have gone from a guess to a measured value, which is most of what this task was for.

If it does: one line in `net-config.ts` with the sweep's own table pasted into its comment, plus the new number in `docs/config-reference.md`'s `NET_CONFIG` section.

- [ ] **Step 7: Commit**

```bash
npm run build -w @motor-combat-moba/shared && npm test
git add packages/server/src/net/input-log-read.ts packages/server/src/net/input-log-read.test.ts packages/server/playtest/netcode.ts packages/server/playtest/README.md packages/shared/src/config/net-config.ts docs
git commit -m "perf(net): sweep remoteSteerHoldTicks against recorded input logs"
git push -u origin claude/gameplay-netcode-architecture-bgp8f6
```

**Say it loudly in the summary.** This edits `playtest/netcode.ts` — the N9 row plus two additive `TrialOpts` fields, both defaulted, so N1–N8 must be unchanged; **diff the report folders rather than assuming**. If `NET_CONFIG.remoteSteerHoldTicks` actually moved, then `playtest/prediction.ts` measures what changed even though it was not edited: its remote-error numbers move by construction. Name that, recommend `npm run playtest`, and do **not** update its expectations unless the user asks.

`packages/server/playtest/README.md`, the `netcode.ts` paragraph, gains: *"and the N9 sweep: remote extrapolation error across candidate `remoteSteerHoldTicks` values, optionally replayed against a recorded input log (`INPUT_LOG_DIR`)."*

**Task 5's acceptance:** the four reader tests green; the N9 row printing six candidate values with remote error p95 for each and naming the best; the recorded steer-hold distribution printed when a log is supplied; and either a `NET_CONFIG` change justified by three independent runs, or a gate-ledger row saying the shipped value won.

---

## Recording a skip

A skipped task is a result. Record it in three places and it stays a result; record it nowhere and the next reader re-derives it from scratch.

1. **The gate ledger** at the top of this file: the measured value, the date, the machine, and `skipped — under the line` (or whatever the reason is). Commit that edit on its own: `docs(plans): N6 task <n> gate read <value> on <date>, skipped`.
2. **The harness row**, if the gate has one. Leave it in place and green. A gate whose measurement was deleted after it read false cannot be re-read next month, which is the whole failure this section exists to prevent.
3. **The merge commit of whatever phase you were actually doing**, in one sentence, so the number is findable from `git log` without knowing this file exists.

Never delete a task. If a task becomes genuinely impossible — the API it needed does not exist, the weapon it names is retired — strike it through in place with the date and the reason, and leave the gate.

---

## Acceptance

Spec §8, phase 6 row: **Ships** — "volley compression (§13), Colyseus 0.18 and a WebTransport transport behind the seam, `thunderclap` wind-up (N31) as a balance change". **Fixes** — none listed. **Acceptance** — **"on evidence from the harness"**. Execution guide §5: *"each task's own gate, stated in its first step; skipped tasks are recorded as skipped with the measured value"*.

**This phase has no single acceptance number, and that is its acceptance.** It is done — for a given task — when the gate has been read and written down, and either the task ran and met its own acceptance or it was recorded as skipped with the value.

| Requirement | Demonstrated by |
|---|---|
| **Every task states its gate before its first step** | the five **Gate** blocks, each naming the command that reads it, the threshold, and what the number is expected to be |
| **A gate is readable without running its task** | Task 1's N8 row and Task 5's N9 row are harness rows that exist to be read; Task 4's is `telegraphAudit()`, shipped by N4; Task 2's is a scratch install that touches nothing; Task 3's is Task 2's answer plus N3's existing row |
| **A skipped task is recorded with its measured value** | the gate ledger, plus §"Recording a skip"'s three places |
| Volley compression (Task 1) | `cd packages/shared && npx vitest run src/net/volley.test.ts src/net/codec.test.ts` — 11 + 5 tests; the three exact byte assertions (52 B full, 40 B steady, 12 pellets round-tripping inside `FAN_TOLERANCE_UNITS`); `PROTOCOL_VERSION === 2` |
| Colyseus 0.18 (Task 2) | `npm test`, `npm run smoke:arena`, `npm run smoke:reconnect` green after the bump, and the harness's N1–N8 inside noise of the pre-bump baseline; the two Step 1 answers recorded whatever they were |
| WebTransport (Task 3) | `cd packages/client && npx vitest run src/match/webtransport.test.ts src/match/transport-select.test.ts` — 6 tests; and, on a real browser against a trusted certificate, a match played with `degraded` false and a mid-match session kill that costs a stutter rather than the match |
| `thunderclap`'s wind-up (Task 4) | `telegraphAudit()` returns `[]`; `weaponTicksOf("thunderclap").startUp === 9`; `npm run build:manual` run and the page committed; `node --test scripts/manual-page.test.mjs scripts/manual-facts.test.mjs scripts/turn-tuning-doc.test.mjs` green; a fresh `npm run balance` baseline quoted, because `configFingerprint` moved |
| `remoteSteerHoldTicks` (Task 5) | `cd packages/server && npx vitest run src/net/input-log-read.test.ts` — 4 tests; the N9 sweep row across six candidates, with the recorded steer-hold distribution when a log is supplied; a change justified by three runs or a skip recorded with the table |
| No balance table moved by Tasks 1, 2, 3 or 5 | `git diff development/main -- packages/shared/src/config/weapon-config.ts packages/shared/src/config/car-config.ts` prints nothing for those four; `node --test scripts/turn-tuning-doc.test.mjs scripts/manual-page.test.mjs` passes with neither page edited |
| Nothing under `match/` imports Phaser, and no test does | `grep -rin "phaser" packages/client/src/match/` prints nothing — Task 3's two new modules are pure TypeScript over `ReadableStream`/`WritableStream` |
| No new probe file exists | `git diff --stat development/main -- packages/server/playtest/` names only `netcode.ts` and `README.md` |
| Everything else still green, per task | `npm run build -w @motor-combat-moba/shared && npm test && npm run typecheck && npm run build && npm run smoke:arena` |

Record each task's measured gate value in the ledger at the top of this file when it is read, with the date and the machine.

## Handoff

Nothing after this plan consumes it — N6 is the last netcode phase. What follows is for whoever opens a task months from now.

### Exports beyond the ledger, per task

- **Task 1.** Shared `net/volley.ts`: `FAN_MAX_PELLETS` (8), `FAN_TOLERANCE_UNITS` (`2 / QUANT.posPerUnit` = 0.125 u), `FanSpec`, `isFanEligible`, `fanReferenceIndex`, `fanPelletPose`, `expandFan`, `fansFrom`. `PROTOCOL_VERSION` becomes **2**. `TrialResult.snapshotBytes` and `TrialOpts.volley` in the harness. **Nothing above the codec changed** — `Snapshot.instances` keeps its shape, order and identity rule, which is what let this land without touching prediction, ghost handover or rendering.
- **Task 2.** No export. A version line, and whatever the compiler forced.
- **Task 3.** Client `match/webtransport.ts`: `DatagramSocket`, `WebTransportTransport`. Client `match/transport-select.ts`: `TransportKind`, `transportKind`, `openTransport`. `?transport=colyseus` forces the reliable path back on and is the field diagnostic.
- **Task 4.** No export. `WEAPON_TABLE.thunderclap.startUpMs` is 150 and `telegraphAudit()` is empty.
- **Task 5.** Server `net/input-log-read.ts`: `InputLogEntry`, `ParsedInputLog`, `parseInputLog`, `inputsByTick`, `steerRunLengths`. `TrialOpts.steerHoldTicks` and `TrialOpts.scriptedInputs` in the harness. **`steerRunLengths` is the answer to spec §13's open question about how long a player holds a steer**, and it is reusable for anything else that wants a real input distribution — bot humanisation, for one.

### What this plan deliberately does not contain

Spec §13 records four more roads not taken. None became a task here, and each has a reason worth keeping:

- **The physics rewrite (C8) — a velocity-vector drive and a sequential-impulse solver.** Its stated purpose, grading a ram so a contact disagreement degrades gracefully, was already delivered by the 2026-08-29 ram-CC design's continuous severity. The residual benefit — an angular-velocity ramp trimming reversal error by about a quarter — is real, is a **drive-model change behind the root `CLAUDE.md` fence**, and would need the user's authorisation. It is a lever if the harness shows the correction tail is too fat, not a task.
- **Running the aim lock client-side** (§13, "Aim assist"). The recorded upgrade if the harness shows ghosts diverging; N4's ghost-mismatch counter is the measurement. Collapsing the lock's seven knobs to one commit timer is an aim-*feel* change outside this brief.
- **Spawn-time catch-up for ghost shots** (§6.7). A bounded rewind of a projectile's birth tick only, at most `lead` ticks, "the one refinement this design would consider if the harness shows the ghost and the real shot separating at spawn". Same measurement as above, different fix.
- **`snapshotEvery = 2`** (N9). Already a shipped knob, not a task: a host whose measured upload cannot carry 60 Hz sets it and the harness reports the error delta between the two.

### The one dependency inside this plan

**Task 3 needs Task 2.** Everything else is independent, in either order, or never. Task 1 and Task 4 both move `protocolHash()` and therefore both force a coordinated client rebuild; running them in the same release saves one forced upgrade, which is worth knowing but is not a dependency.

## Self-review

**Spec coverage.** §8's phase 6 row names three things and this plan has five tasks, because the row's third item ("Colyseus 0.18 **and** a WebTransport transport") is two changes with different gates and a real dependency between them, and because §6.6's *"tune `remoteSteerHoldTicks` against recorded input logs"* is named as one of exactly two levers before the approach-B checkpoint and had no home. §13 "Volley compression" is Task 1, with the note's own design — a pellet fan as one row, clients deriving the pellets — and the per-pellet death events it predicted as the added protocol surface, which this plan resolves as a `memberMask` rather than a new event kind. §13 "Transport" is Tasks 2 and 3, including its two recorded objections (the unverified datagram claim, and certificate pinning on a player-hosted server) as gate conditions rather than as prose. §6.6 N31 is Task 4, taking the audit N4 shipped and turning its one named row into the balance edit the spec says is "recorded here as a follow-up rather than made" — with all four of the repo's balance-edit obligations discharged in Step 5 and the two gameplay consequences named for the user. §6.6 N20 and §7's 20 u line are Task 5. §10 questions 5 and 8 (hosting, transport) are the reason Task 3's gate is expected to read false and say so. Execution guide §5's N6 row and §7's "not scheduled" rule are the plan's shape, and §"Recording a skip" is that row's second clause made into a procedure.

**Placeholder scan.** Every new module — `net/volley.ts`, `match/webtransport.ts`, `match/transport-select.ts`, `net/input-log-read.ts` — is printed in full, and so are the two harness rows. Every edit to an existing file is a named substitution table (the `PROTOCOL_VERSION` line, the `startUpMs` line, the two manual-copy sentences) or a printed block with the statement it follows named. Every test is real code with values read from the tables it tests — `WEAPON_TABLE.pepperbox.muzzles`, `.pellets.pelletsPerVolley`, `.spreadAngleDeg`, `.range`, `.speed`, `QUANT.posPerUnit`, `QUANT.angleSteps`, `NET_CONFIG.telegraphWindowMs`, `TICK_RATE_HZ` — rather than as digits. The figures quoted in prose are each derived beside themselves: 168 B and 120 B from N2's 14 B and 10 B rows times twelve pellets, 52 B and 40 B from the 13 B and 10 B fan rows times four muzzles, 9 ticks from `msToTicks(150)` at 60 Hz, 240 u from N4's own audit table, and 4.8 KB/s from 80 B at 60 Hz. Task 2 Step 5 and Task 3 Step 5 are the two places this plan does **not** print an implementation, and both say why in a table with both branches: the call sites depend on an API nobody has read yet, and inventing one would be the worst kind of placeholder — the kind that looks like an answer.

**Type consistency.** `SnapshotInstance` (N2, unchanged) is what `fansFrom` consumes, what `expandFan` produces, and what `decodeSnapshot` returns — one shape, and `Snapshot.instances` is sorted by `(ownerIndex, shotSeq)` on both sides so `instanceId(ownerIndex, shotSeq)` still names the same instance it named in phase 4. `FanSpec` never leaves the codec: it is built by `fansFrom`, written by the encoder, read by the decoder and expanded, so nothing above `net/` has a type it did not have before. `fanOffset(index, pellets, spreadRad)` is imported from `sim/weapons/instances.ts` and is the **only** fan geometry in the repository, which is why a re-tune of `spreadAngleDeg` cannot desynchronise the wire from the sim. `MatchTransport` (N2) is implemented by `ColyseusTransport`, `LoopbackTransport` and now `WebTransportTransport`, which takes the first as its `fallback` and forwards `onRoster` to it verbatim — one interface, three implementations, and `openTransport` returns the interface so `ArenaScene` and `MatchClient` see no difference. `InputFrame` (N0) is what `parseInputLog` reconstructs, what `inputsByTick` maps and what `TrialOpts.scriptedInputs` feeds to `trial()`, matching `WorldPredictor.predictTick`'s parameter exactly. `Pick<typeof NET_CONFIG, "maxPredictionTicks" | "maxExtrapolationTicks" | "remoteSteerHoldTicks">` is `WorldPredictor`'s constructor slice from N3 and is what makes Task 5's sweep possible without a process-wide mutation — the sweep passes a modified copy, never the real `NET_CONFIG`.
