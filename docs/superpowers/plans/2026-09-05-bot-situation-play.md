# Situation-play bot brain Implementation Plan

> **For agentic workers:** Execute inline in this session. Do not wait for confirmation. Do not
> commit unless the user asks (repo rule). REQUIRED: TDD — failing test before production code.
> Spec: `docs/superpowers/specs/2026-09-05-bot-situation-play-design.md` (S1–S28).

**Goal:** Replace the scored 11-goal catalog with a situation → one play brain so practice,
playground, and the balance harness share one `decide(BotView)` that uses HUD facts like a player.

**Architecture:** `buildFacts` → `pickSituation` (priority pre-empt) → `playOf` (heading/range/
closing/mayFire) → existing `reduceToIntent` + rewritten `chooseSlot`. Tier differences are
`BOT_PROFILES` numbers only. `HumanController.decide` stays the host door.

**Tech Stack:** TypeScript ESM, vitest, existing `@motor-combat-moba/shared` weapon/car tables.

**Spec:** [`docs/superpowers/specs/2026-09-05-bot-situation-play-design.md`](../specs/2026-09-05-bot-situation-play-design.md)

## Global Constraints

- No `if (profileId === "hard")` under `packages/server/src/bot/brain/`.
- No enemy `FireState` / stocks / `pressId` / `lastDamagerSessionId`.
- Ternary steer/throttle. No pathfinding. No analog steer.
- One fire slot per tick. `BOT_BRAIN_VERSION` = `"3.0.0"`.
- Do not touch playtest probes. Do not run `npm run balance`.
- After shared `playground-messages.ts` edits: `npm run build -w @motor-combat-moba/shared`.
- Relative imports use `.js` extensions.

## File map

| File | Role |
|---|---|
| `packages/server/src/config/bot-profiles.ts` | New knobs; delete goal weights; version 3.0.0 |
| `packages/server/src/config/bot-profiles.test.ts` | Total `LADDER` over new `BotProfile` |
| `packages/server/src/bot/types.ts` | `SituationId` replaces `GoalId`; `BotDebug.situation` |
| `packages/server/src/bot/brain/reach.ts` | S10 reach of a weapon / slot / kit |
| `packages/server/src/bot/brain/facts.ts` | `buildFacts` |
| `packages/server/src/bot/brain/situation.ts` | catalog, `pickSituation` |
| `packages/server/src/bot/brain/goals.ts` | Keep `scoreTargets` only (or move to `targets.ts` and delete the rest) |
| `packages/server/src/bot/brain/perception.ts` | Update known cars when dead/phased (S12) |
| `packages/server/src/bot/brain/firing.ts` | S10 preferred range; no lock veto; no `reach/2` ult window |
| `packages/server/src/bot/brain/movement.ts` | Open-floor unpin heading; no reverse into bound |
| `packages/server/src/bot/brain/controller.ts` | Wire layers; hunt stays for `waitOut` |
| `packages/server/src/bot/brain/personality.ts` | Drop deleted-weight shifts; unit-interval new knobs |
| `packages/shared/src/net/playground-messages.ts` | `situation` replaces `goal` / `goalScores` |
| `packages/client/src/dev/playground/overlay.ts` | Print situation line |
| `packages/server/src/rooms/PlaygroundRoom.ts` | Broadcast `situation` |
| `docs/bot-behavior.md`, root `CLAUDE.md` | New knobs / five-layer wording |
| `.claude/skills/bot-tuner/SKILL.md` | Feel complaint → knobs |

Keep `roles.ts` (kit roles for stun slot disqualify). Delete `goals.test.ts` scoring cases; keep
`scoreTargets` tests in `goals.test.ts` or `targets.test.ts`.

---

### Task 1: Profile knobs

**Files:**
- Modify: `packages/server/src/config/bot-profiles.ts`
- Modify: `packages/server/src/config/bot-profiles.test.ts`
- Modify: `packages/server/src/bot/brain/personality.ts`

**Produces:** `BotProfile` with `deadRespect`, `opponentRangeRespect`, `cornerRespect`,
`incomingCarChance`, `situationCommitTicks`, `slotStickTicks`. Removed: `rushWeight`,
`interceptWeight`, `setupWeight`, `dumpWeight`, `pinWeight`, `dodgeWeight`, `goalCommitTicks`.
`BOT_BRAIN_VERSION = "3.0.0"`. Hard retunes from S25.

- [ ] **Step 1:** Update `LADDER` and `PROBABILITY_FIELDS` / personality `UNIT_INTERVAL_FIELDS` and
  `ARCHETYPES` (drop deleted weights; kiter may shift `opponentRangeRespect` × 1.15). Watch
  `bot-profiles.test.ts` fail on missing keys / extra keys.
- [ ] **Step 2:** Write the profile rows and version string so the test compiles and passes.
- [ ] **Step 3:** Run `npx vitest run src/config/bot-profiles.test.ts` in `packages/server`.

---

### Task 2: Reach + facts + situation picker (TDD)

**Files:**
- Create: `packages/server/src/bot/brain/reach.ts`
- Create: `packages/server/src/bot/brain/reach.test.ts`
- Create: `packages/server/src/bot/brain/facts.ts`
- Create: `packages/server/src/bot/brain/facts.test.ts`
- Create: `packages/server/src/bot/brain/situation.ts`
- Create: `packages/server/src/bot/brain/situation.test.ts`
- Modify: `packages/server/src/bot/types.ts` (`SituationId`)

**Produces:**

```ts
export type SituationId =
  | "recover" | "waitOut" | "evade" | "unpin" | "punish" | "reset" | "fight" | "close";

export function weaponReachOf(weaponId: WeaponId): number;
export function kitReachOf(carId: CarId, extraWeaponIds?: readonly WeaponId[]): {
  shortest: number; longest: number;
};

export interface SituationFacts { /* spec S9 */ }
export function buildFacts(...): SituationFacts;

export interface SituationState { current: SituationId; sinceTick: number }
export function pickSituation(
  state: SituationState,
  facts: SituationFacts,
  tick: number,
  profile: BotProfile,
): SituationState;
```

Tests that must exist before implementation:

- `weaponReachOf("predator") === weaponDefOf("predator").aimRangeUnits` (800, not 1800).
- `kitReachOf("bullseye").shortest` is pepperbox’s authored range, not predator’s.
- Self dead → `recover`.
- Live opponent `alive: false` + Hard `deadRespect` 1 → `waitOut`, not `fight`.
- Pinned + hittable + `cornerRespect` 1 → `unpin` beats `fight`.
- Stunned target → `punish` beats `fight`.
- In reach, healthy → `fight`; out of reach → `close`.
- Higher priority cuts in before `situationCommitTicks`.

---

### Task 3: Perception updates dead/phased cars (TDD)

**Files:**
- Modify: `packages/server/src/bot/brain/perception.ts`
- Modify: `packages/server/src/bot/brain/perception.test.ts`

`visible()` must not drop `!car.alive`. Dead/phased cars in `view.others` refresh `KnownCar.car`
so `alive` / `phased` cannot stay stale for `memoryTicks`.

Test: notice a living car, then the same session with `alive: false` — `knownCars` snapshot is
dead (or `known.car.alive === false`).

---

### Task 4: Firing (TDD)

**Files:**
- Modify: `packages/server/src/bot/brain/firing.ts`
- Modify: `packages/server/src/bot/brain/firing.test.ts`

- `preferredRangeOf` uses S10 reach of the selected/ready kit, not weighted authored `range`.
- Delete lock-wait `continue`.
- Delete ult `distance <= reach / 2` good-moment.
- Ult good-moment = stunned or hp ≤ `ultWindowHpFraction` or caller passed `punish === true`.
- `chooseSlot` accepts `situation: SituationId` and `stuckSlot` + `slotStickTicks`.
- Stunned target: setupCc slot disqualified.

Tests: Hard fires predator without HUD lock when in cone and in aim-range; Hard does not ult at
`distance <= range/2` on full HP unstunned; dump/punish still ults a stunned target.

---

### Task 5: Movement helpers (TDD)

**Files:**
- Modify: `packages/server/src/bot/brain/movement.ts`
- Modify: `packages/server/src/bot/brain/movement.test.ts`

```ts
export function openFloorHeading(
  self: { x: number; y: number },
  arena: BotArenaView,
): number; // inward from nearest bound; never atan2(center)

export function reverseWouldHitBound(
  self: { x: number; y: number; angle: number },
  arena: BotArenaView,
  lookaheadUnits: number,
): boolean;
```

`reduceToIntent`: if `closing` and the throttle would be -1 and `reverseWouldHitBound`, use
throttle 0 or 1 (caller may pass a flag). Implement as: when `closing` and distance < preferred
and reverse would hit a bound, throttle `0` (coast) rather than `-1`.

---

### Task 6: Controller wiring

**Files:**
- Modify: `packages/server/src/bot/brain/controller.ts`
- Modify: `packages/server/src/bot/brain/controller.test.ts`
- Modify: `packages/server/src/bot/brain/personality.ts` (already in Task 1)
- Delete goal-scoring from `goals.ts`; keep `scoreTargets`.

`plan()`: `buildFacts` → `pickSituation` → switch on situation for desires / range / closing /
mayFire. Hunt heading from existing `huntHeading` on `waitOut`. Orbit only on `fight` when
throttle would be 0. `debug().situation`.

Incoming car: detect in facts; roll `incomingCarChance` once per approach episode (controller
state, same pattern as `huntHear`).

Pin episode: roll `cornerRespect` once while pinned stays true.

Ghost: `deadRespect` roll once per dead-target episode.

---

### Task 7: Characterisation (S28)

**Files:**
- Modify: `packages/server/src/bot/brain/tiers.test.ts`
- Create or extend: `packages/server/src/bot/brain/controller.test.ts`

1. Opponent `alive: false` after having been seen — Hard `fireSlots === 0` for 90 ticks.
2. Bot at `(40, 40)`, opponent approaching from mid — Hard heading/throttle not into the corner
   and not toward `(640, 360)`.
3. Opponent at 400 u, Hard facing them, predator ready, `lockTargetSessionId: ""` — some tick
   soon has `fireSlots !== 0`.
4. Drop “Hard waits for lock” if that test still exists; invert it.
5. Easy vs Hard still differ on dodge (existing H25 pattern).

---

### Task 8: Playground overlay wire

**Files:**
- Modify: `packages/shared/src/net/playground-messages.ts`
- Modify: `packages/shared/src/net/playground-messages.test.ts`
- Modify: `packages/client/src/dev/playground/overlay.ts`
- Modify: `packages/server/src/rooms/PlaygroundRoom.ts`

`BotDebugPayload.situation` is one of the eight ids. No `goalScores`. Rebuild shared.

---

### Task 9: Docs + tuner skill

**Files:**
- Rewrite: `docs/bot-behavior.md` (complaint table → new knobs; copy values from `bot-profiles.ts`)
- Modify: root `CLAUDE.md` bot paragraph (situation → play; version 3; tuner skill)
- Create: `.claude/skills/bot-tuner/SKILL.md`

Skill: trigger on bot feel complaints; read live `bot-profiles.ts`; map to knobs; one change at a
time; no `if (hard)`; no sim handicaps. Point at `docs/bot-behavior.md` for the human table.

---

### Task 10: Verify

Run:

```
npx vitest run src/config/bot-profiles.test.ts src/bot/brain --reporter=dot
```

from `packages/server`, and shared playground-message tests after the shared rebuild.

Do not run `npm run balance`. Recommend it in the summary. Playtest probes unchanged — say so
if anything in `sim/` was touched (it must not be).
