# Human-like Bot Behaviour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chase-and-fire bot with a five-layer brain whose `easy`/`medium`/`hard` tiers play like a casual, an amateur and a pro human rather than like one machine at three speeds.

**Architecture:** One `decide(view)` call runs perceive → assess → move → shoot → humanize. Perception and humanization run every tick; the middle three run on the tier's recompute cadence. The decision layer picks one of seven named stances by weighted score with a commitment window; movement is a separate context-steering blend so dodging composes with fighting instead of replacing it. Every tier difference is data in `BOT_PROFILES` — no layer branches on the difficulty name.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, npm workspaces. Server-side only — bots author inputs, and only the server authors inputs.

**Spec:** [`docs/superpowers/specs/2026-09-04-human-like-bot-behavior-design.md`](../specs/2026-09-04-human-like-bot-behavior-design.md)

## Global Constraints

- **Rebuild shared before anything else.** `packages/shared/dist` in this worktree is stale (`predator` reads 300 ms against a source of 1000 ms). Run `npm run build -w @motor-combat-moba/shared` first; every number below assumes fresh `dist`.
- **Verify with root `npm test`**, never a per-workspace run — a per-workspace run silently skips suites.
- **`Math.random()` is banned on the bot path.** Every draw comes from `view.rng` (B20, H19).
- **Draw order is fixed per tick regardless of branch outcome** (H21). Where a draw is only sometimes needed, draw it unconditionally and discard, or the same seed diverges.
- **The bot may read only `BotView`.** No enemy `WeaponSlotState`, no `lastDamagerSessionId`, no `pressId` (H22–H24).
- **Weakness is worse decisions only** — no damage, speed or accuracy handicap (H1).
- **`steer` and `throttle` stay `-1 | 0 | 1`**; one reducer is the only place that produces them (H15).
- **The bot sets at most ONE fire bit per tick** (H27) — `beginFire` takes the lowest set bit and resolves one press.
- **No layer branches on `profileId`** (H8).
- Imports of shared use `@motor-combat-moba/shared`; local imports carry the `.js` extension.
- Do **not** touch `packages/server/playtest/` — no probe imports the bot API.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/server/src/config/bot-profiles.ts` | **Rewritten.** `BotProfile` (33 knobs), `BOT_PROFILES`, `BRAIN_CONSTANTS`, `BOT_BRAIN_VERSION` |
| `packages/server/src/bot/types.ts` | **Extended.** `StanceId`, `PersonalityId`, `BotPersonality`, `BotDebug`; `BotController.debug?()` |
| `packages/server/src/bot/brain/controller.ts` | **New.** `HumanController` — owns state, runs the five layers |
| `packages/server/src/bot/brain/aim.ts` | **New.** Drifting aim error, intercept solve, angle helpers |
| `packages/server/src/bot/brain/perception.ts` | **New.** Attention, known-car map, threat map, ult memory, blame map |
| `packages/server/src/bot/brain/firing.ts` | **New.** Range model, slot ranking, discipline, ult windows |
| `packages/server/src/bot/brain/movement.ts` | **New.** Desire blend, heading/range → `steer`/`throttle` |
| `packages/server/src/bot/brain/stance.ts` | **New.** Target scoring, stance scoring, commitment, pre-emption |
| `packages/server/src/bot/brain/humanize.ts` | **New.** Delay line, blunders, idle fidget |
| `packages/server/src/bot/brain/personality.ts` | **New.** Seeded archetype roll, band clamping, slot weights |
| `packages/server/src/bot/controller.ts` | **Deleted** (`LegacyController`) |
| `packages/server/src/bot/input.ts` | **Deleted** (`botInput` and friends) |
| `packages/server/src/rooms/PracticeRoom.ts` | Ring + `fired` sink + new controller |
| `packages/server/src/rooms/PlaygroundRoom.ts` | Ring + `fired` sink + new controller + debug broadcast |
| `packages/server/balance/match.ts` | Ring + new controller |
| `packages/server/balance/fingerprint.ts` | `BOT_BRAIN_VERSION` folded into `botFingerprint` |
| `packages/shared/src/net/playground-messages.ts` | `MSG_PLAYGROUND_BOT_DEBUG` payload type + guard |
| `packages/client/src/dev/playground/overlay.ts` | Renders the debug payload |
| `docs/bot-behavior.md` | **New.** The page you open when a bot feels wrong |

---

### Task 1: New profile table, brain types, and the strangler swap

Rewrites the profile table to its final 33-knob shape, deletes the legacy bot, and installs a `HumanController` that reproduces roughly today's behaviour through the new fields. Later tasks add one layer each. The game must work at the end of every task, and this is the task that keeps that true.

**Files:**
- Modify: `packages/server/src/config/bot-profiles.ts` (full rewrite)
- Modify: `packages/server/src/bot/types.ts`
- Create: `packages/server/src/bot/brain/controller.ts`
- Modify: `packages/server/src/bot/index.ts`
- Delete: `packages/server/src/bot/controller.ts`, `packages/server/src/bot/controller.test.ts`, `packages/server/src/bot/input.ts`, `packages/server/src/bot/input.test.ts`
- Modify: `packages/server/src/rooms/PracticeRoom.ts:354`, `packages/server/src/rooms/PlaygroundRoom.ts:351-355`, `packages/server/balance/match.ts:148,177`
- Test: `packages/server/src/config/bot-profiles.test.ts` (new), `packages/server/src/bot/brain/controller.test.ts` (new)

**Interfaces:**
- Consumes: `BotView`, `BotIntent`, `BotController` from `../types.js`; `Rng` from `../rng.js`.
- Produces:
  - `BotProfile` — the 33 readonly fields in Step 3.
  - `BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>>`
  - `BRAIN_CONSTANTS = { minEngageUnits: 70, contactTriggerUnits: 150, ultCooldownMs: 5000, personalityJitter: 0.25 }`
  - `BOT_BRAIN_VERSION: string` (start at `"1.0.0"`)
  - `class HumanController implements BotController` with `constructor(profileId: BotDifficulty, options?: { targetSessionId?: string; profile?: BotProfile })`, `decide(view: BotView): BotIntent`, `setTarget(sessionId: string | undefined): void`, `get currentTargetSessionId(): string | undefined`, `debug(): BotDebug | undefined`.
  - `StanceId`, `PersonalityId`, `BotPersonality`, `BotDebug` in `bot/types.ts`.

- [ ] **Step 1: Rebuild shared and confirm the suite is green before touching anything**

```bash
npm install
npm run build -w @motor-combat-moba/shared
npm test
```

Expected: all suites pass. If they do not, stop — this plan assumes a green baseline.

- [ ] **Step 2: Write the failing profile-table test**

Create `packages/server/src/config/bot-profiles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOT_PROFILES, BRAIN_CONSTANTS, BOT_BRAIN_VERSION } from "./bot-profiles.js";

const TIERS = ["easy", "medium", "hard"] as const;

describe("BOT_PROFILES", () => {
  it("carries every tier", () => {
    for (const tier of TIERS) expect(BOT_PROFILES[tier]).toBeDefined();
  });

  it("keeps aimToleranceRad below fireConeRad on every row", () => {
    for (const tier of TIERS) {
      const p = BOT_PROFILES[tier];
      expect(p.aimToleranceRad).toBeLessThan(p.fireConeRad);
    }
  });

  it("orders perceived latency easy > medium > hard", () => {
    const total = (t: (typeof TIERS)[number]) =>
      BOT_PROFILES[t].viewStalenessTicks + BOT_PROFILES[t].reactionDelayTicks;
    expect(total("easy")).toBeGreaterThan(total("medium"));
    expect(total("medium")).toBeGreaterThan(total("hard"));
  });

  it("gives every tier a non-zero view staleness and reaction delay (H48)", () => {
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].viewStalenessTicks).toBeGreaterThan(0);
      expect(BOT_PROFILES[tier].reactionDelayTicks).toBeGreaterThan(0);
    }
  });

  it("runs vengefulness backwards up the ladder (H33)", () => {
    expect(BOT_PROFILES.easy.vengefulness).toBeGreaterThan(BOT_PROFILES.medium.vengefulness);
    expect(BOT_PROFILES.medium.vengefulness).toBeGreaterThan(BOT_PROFILES.hard.vengefulness);
  });

  it("keeps every probability in [0, 1]", () => {
    const probabilities = [
      "fireDisciplineChance", "ultDisciplineChance", "ultWindowHpFraction", "woundedBias",
      "vengefulness", "standoffFraction", "deadbandFraction", "orbitBias", "retreatHpFraction",
      "ramIntentChance", "dodgeChance", "blunderChance", "idleFidgetChance", "leadFactor",
    ] as const;
    for (const tier of TIERS) {
      for (const key of probabilities) {
        expect(BOT_PROFILES[tier][key]).toBeGreaterThanOrEqual(0);
        expect(BOT_PROFILES[tier][key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("exposes the shared constants and a brain version", () => {
    expect(BRAIN_CONSTANTS.minEngageUnits).toBe(70);
    expect(BRAIN_CONSTANTS.contactTriggerUnits).toBe(150);
    expect(BRAIN_CONSTANTS.ultCooldownMs).toBe(5000);
    expect(BRAIN_CONSTANTS.personalityJitter).toBe(0.25);
    expect(BOT_BRAIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/config/bot-profiles.test.ts` from `packages/server`
Expected: FAIL — `BRAIN_CONSTANTS` and `BOT_BRAIN_VERSION` are not exported.

- [ ] **Step 4: Rewrite `bot-profiles.ts`**

Replace the whole file. Keep the file's existing doc-comment voice: each field gets a comment saying what it models, and the tier block says why the numbers are what they are.

```ts
import type { BotDifficulty } from "@motor-combat-moba/shared";

/**
 * One difficulty's knobs (H44). Thirty-three of them, in five groups: perception, aim, fire
 * economy, target politics, positioning, and consistency.
 *
 * Every field is a NUMBER, and no code outside this file branches on which tier it came from (H8).
 * That is the whole mechanism by which the tiers stay distinct as the brain grows: a behaviour is
 * code, a tier is data.
 */
export interface BotProfile {
  // --- Perception ---------------------------------------------------------------------------
  /** The world other cars are drawn from is this many ticks old: 20 Hz patch rate plus ping. */
  readonly viewStalenessTicks: number;
  /** The gap between seeing and the hands moving. With staleness this is the perceived latency. */
  readonly reactionDelayTicks: number;
  /** How often the bot re-decides. A refresh rate, NOT a reaction time (renamed from
   * `reactionTicks`, which read as one). */
  readonly recomputeTicks: number;
  /** How long a newly-seen car takes to register at all — TF2's recognition time. */
  readonly acquireTicks: number;
  /** Nothing beyond this radius is noticed. Doubles as the maximum engagement range (H35). */
  readonly awarenessRadiusUnits: number;
  /** Half-width of the arc behind the car the bot does not watch. 0 means full awareness. */
  readonly rearBlindHalfAngleRad: number;
  /** How many incoming shots can be tracked at once. */
  readonly trackedThreatLimit: number;
  /** How long something out of sight is remembered before it is forgotten. */
  readonly memoryTicks: number;

  // --- Aim ----------------------------------------------------------------------------------
  /** Standard deviation of the aim error, in radians. */
  readonly aimErrorSigmaRad: number;
  /** How often the aim error is resampled. Long enough that error DRIFTS rather than jitters. */
  readonly aimErrorDriftTicks: number;
  /** Steering deadzone. MUST stay below `fireConeRad`. */
  readonly aimToleranceRad: number;
  /** How well aimed the bot must be to fire. */
  readonly fireConeRad: number;
  /** Fraction of the correct intercept lead actually applied. 0 shoots at where the target is. */
  readonly leadFactor: number;

  // --- Fire economy -------------------------------------------------------------------------
  /** Minimum ticks between presses. The sim accepts one press per tick regardless. */
  readonly burstGapTicks: number;
  /** Probability of HOLDING a shot that is outside the good window. */
  readonly fireDisciplineChance: number;
  /** Probability of saving a long-cooldown weapon for a good moment (TF2's airblast gate). */
  readonly ultDisciplineChance: number;
  /** Target hp fraction under which an ult is considered worth spending. */
  readonly ultWindowHpFraction: number;

  // --- Target politics ----------------------------------------------------------------------
  /** How long the bot stays on one target before switching is cheap. */
  readonly targetCommitTicks: number;
  /** Weight on (1 - hp fraction) when choosing a target — Quake's EASY_FRAGGER. */
  readonly woundedBias: number;
  /** Weight on "this car was shooting at me". Runs BACKWARDS up the ladder (H33). */
  readonly vengefulness: number;

  // --- Positioning and survival -------------------------------------------------------------
  /** Preferred range as a fraction of the bot's own effective weapon range (H35). */
  readonly standoffFraction: number;
  /** Half-width of the coast band around the preferred range, as a fraction of it. */
  readonly deadbandFraction: number;
  /** How strongly the bot circles rather than closing head-on. */
  readonly orbitBias: number;
  /** How far ahead the bot looks for a wall or obstacle. */
  readonly wallLookaheadUnits: number;
  /** Hp fraction below which the bot disengages. 0 means it fights to zero. */
  readonly retreatHpFraction: number;
  /** Probability of committing to a deliberate ram when one is available. */
  readonly ramIntentChance: number;

  // --- Threat reaction and consistency ------------------------------------------------------
  /** Probability of reacting at all to a newly-noticed incoming shot. Rolled ONCE per threat. */
  readonly dodgeChance: number;
  /** Extra ticks between noticing an incoming shot and moving. */
  readonly dodgeReactionTicks: number;
  /** How far ahead a shot's path is projected when deciding whether it threatens. */
  readonly dodgeHorizonTicks: number;
  /** Probability per decision window of committing to a wrong action. */
  readonly blunderChance: number;
  /** How long a blunder lasts once committed to. */
  readonly blunderTicks: number;
  /** Probability of a small idle steering input when there is nothing to do. */
  readonly idleFidgetChance: number;
  /** Standard deviation of the noise added to stance and target scores. */
  readonly scoreNoiseSigma: number;
  /** How long a stance is held before rescoring is allowed (pre-emptions excepted). */
  readonly stanceCommitTicks: number;
}

/**
 * Constants shared by every tier — not per-tier, and therefore deliberately not in the profile.
 */
export const BRAIN_CONSTANTS = Object.freeze({
  /** Closest range the bot will ever choose to hold. Roughly one and a half car lengths. */
  minEngageUnits: 70,
  /** Range at which a `range: 0` weapon (`wildcharge`) is worth pressing. */
  contactTriggerUnits: 150,
  /** `cooldownMs` at or above which a weapon counts as an ult for discipline purposes. */
  ultCooldownMs: 5000,
  /** How far a personality may move a parameter from its tier value, as a fraction. */
  personalityJitter: 0.25,
});

/**
 * The brain's behavioural version, folded into `botFingerprint` (H46).
 *
 * `BOT_PROFILES` is hashed by that fingerprint, but a hash of the table cannot see a behaviour
 * change made in code with the numbers untouched. Bump this whenever the brain's behaviour changes
 * without the table moving, or the balance harness will happily compare two incomparable pilots.
 */
export const BOT_BRAIN_VERSION = "1.0.0";

/**
 * The three tiers (H44). Derived where derivable: perceived latency
 * (`viewStalenessTicks + reactionDelayTicks`) is 433 / 300 / 200 ms against measured human values of
 * ~250 ms casual, ~215 ms amateur and 150-165 ms pro; `acquireTicks` and `recomputeTicks` follow
 * TF2's recognition time and aim-tracking interval; `ultDisciplineChance` reproduces TF2's airblast
 * gating (0% / 50% / 90%). The rest is first pass and expected to move under playtesting.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({
    viewStalenessTicks: 4, reactionDelayTicks: 9, recomputeTicks: 12, acquireTicks: 15,
    awarenessRadiusUnits: 520, rearBlindHalfAngleRad: 1.05, trackedThreatLimit: 1, memoryTicks: 15,
    aimErrorSigmaRad: 0.18, aimErrorDriftTicks: 20, aimToleranceRad: 0.3, fireConeRad: 0.55,
    leadFactor: 0,
    burstGapTicks: 14, fireDisciplineChance: 0.05, ultDisciplineChance: 0, ultWindowHpFraction: 0.4,
    targetCommitTicks: 150, woundedBias: 0.1, vengefulness: 0.8,
    standoffFraction: 0.45, deadbandFraction: 0.25, orbitBias: 0, wallLookaheadUnits: 40,
    retreatHpFraction: 0, ramIntentChance: 0.15,
    dodgeChance: 0.05, dodgeReactionTicks: 12, dodgeHorizonTicks: 12,
    blunderChance: 0.12, blunderTicks: 10, idleFidgetChance: 0.1, scoreNoiseSigma: 0.3,
    stanceCommitTicks: 45,
  }),
  medium: Object.freeze({
    viewStalenessTicks: 3, reactionDelayTicks: 6, recomputeTicks: 6, acquireTicks: 9,
    awarenessRadiusUnits: 700, rearBlindHalfAngleRad: 0.6, trackedThreatLimit: 2, memoryTicks: 45,
    aimErrorSigmaRad: 0.09, aimErrorDriftTicks: 14, aimToleranceRad: 0.16, fireConeRad: 0.35,
    leadFactor: 0.55,
    burstGapTicks: 7, fireDisciplineChance: 0.45, ultDisciplineChance: 0.5, ultWindowHpFraction: 0.4,
    targetCommitTicks: 60, woundedBias: 0.5, vengefulness: 0.5,
    standoffFraction: 0.7, deadbandFraction: 0.15, orbitBias: 0.35, wallLookaheadUnits: 90,
    retreatHpFraction: 0.3, ramIntentChance: 0.3,
    dodgeChance: 0.55, dodgeReactionTicks: 8, dodgeHorizonTicks: 18,
    blunderChance: 0.05, blunderTicks: 10, idleFidgetChance: 0.05, scoreNoiseSigma: 0.15,
    stanceCommitTicks: 30,
  }),
  hard: Object.freeze({
    viewStalenessTicks: 2, reactionDelayTicks: 4, recomputeTicks: 2, acquireTicks: 5,
    awarenessRadiusUnits: 900, rearBlindHalfAngleRad: 0, trackedThreatLimit: 4, memoryTicks: 90,
    aimErrorSigmaRad: 0.035, aimErrorDriftTicks: 9, aimToleranceRad: 0.07, fireConeRad: 0.2,
    leadFactor: 0.95,
    burstGapTicks: 3, fireDisciplineChance: 0.85, ultDisciplineChance: 0.9, ultWindowHpFraction: 0.4,
    targetCommitTicks: 25, woundedBias: 0.9, vengefulness: 0.25,
    standoffFraction: 0.85, deadbandFraction: 0.08, orbitBias: 0.75, wallLookaheadUnits: 150,
    retreatHpFraction: 0.45, ramIntentChance: 0.5,
    dodgeChance: 0.95, dodgeReactionTicks: 4, dodgeHorizonTicks: 24,
    blunderChance: 0.015, blunderTicks: 10, idleFidgetChance: 0.02, scoreNoiseSigma: 0.05,
    stanceCommitTicks: 18,
  }),
});
```

- [ ] **Step 5: Run the profile test — it should pass**

Run: `npx vitest run src/config/bot-profiles.test.ts` from `packages/server`
Expected: PASS. The rest of the server suite is now broken (the legacy bot reads deleted fields); Step 6 onward fixes that.

- [ ] **Step 6: Extend `bot/types.ts`**

Append to `packages/server/src/bot/types.ts`, and add `debug?` to `BotController`:

```ts
/** The seven stances (H9). A stance publishes desires; it never steers. */
export type StanceId =
  | "engage" | "brawl" | "kite" | "disengage" | "reposition" | "hunt" | "recover";

/** The five personality archetypes (H47). */
export type PersonalityId = "brawler" | "kiter" | "sprayer" | "grudge" | "opportunist";

export interface BotPersonality {
  readonly id: PersonalityId;
  /** Preference weight per slot index, rolled per bot. Biases both firing and the range model. */
  readonly slotWeights: readonly number[];
}

/**
 * What the bot was thinking, for the playground overlay (H12).
 *
 * The deliberate answer to a scored decision layer's one weakness — that "why did it do that?" is
 * answered by reading a scoreboard. Never read by the sim, never on the wire from the bot's side.
 */
export interface BotDebug {
  tick: number;
  stance: StanceId;
  stanceScores: Readonly<Partial<Record<StanceId, number>>>;
  targetSessionId: string | undefined;
  preferredRange: number;
  personality: PersonalityId;
  /** The slot pressed this tick, or `undefined` when the bot held fire. */
  firedSlot: number | undefined;
}
```

And in `BotController`:

```ts
export interface BotController {
  readonly profileId: string;
  decide(view: BotView): BotIntent;
  /** Optional introspection for dev tools (H12). Never required by a host. */
  debug?(): BotDebug | undefined;
}
```

- [ ] **Step 7: Write the failing controller test**

Create `packages/server/src/bot/brain/controller.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeRng } from "../rng.js";
import type { BotView } from "../types.js";
import { HumanController } from "./controller.js";

function view(overrides: Partial<BotView> = {}): BotView {
  return {
    tick: 0,
    self: {
      sessionId: "me", carId: "bullseye", team: 0,
      x: 100, y: 100, angle: 0, speed: 0, hp: 65, maxHp: 65, alive: true,
      statuses: [], slots: [], switchLockUntilTick: 0, lockTargetSessionId: "",
      maneuver: 0, maneuverTicksLeft: 0,
    },
    others: [],
    instances: [],
    arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [],
    rng: makeRng(1),
    ...overrides,
  };
}

describe("HumanController", () => {
  it("coasts when there is no target", () => {
    const bot = new HumanController("hard");
    expect(bot.decide(view())).toEqual({ steer: 0, throttle: 0, fireSlots: 0 });
  });

  it("is deterministic for the same seed (H21)", () => {
    const run = () => {
      const bot = new HumanController("medium");
      const out = [];
      for (let tick = 0; tick < 90; tick++) {
        out.push(bot.decide(view({ tick, rng: makeRng(99) })));
      }
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });

  it("steers toward a target that is off to one side", () => {
    const bot = new HumanController("hard");
    const target = {
      sessionId: "them", carId: "mirage" as const, team: 0 as const,
      x: 100, y: 600, angle: 0, speed: 0, hp: 70, maxHp: 70,
      alive: true, phased: false, statuses: [], maneuver: 0,
    };
    let last = { steer: 0, throttle: 0, fireSlots: 0 };
    for (let tick = 0; tick < 30; tick++) {
      last = bot.decide(view({ tick, others: [target] }));
    }
    expect(last.steer).not.toBe(0);
  });

  it("reports debug state once it has decided", () => {
    const bot = new HumanController("hard");
    bot.decide(view());
    expect(bot.debug()?.stance).toBeDefined();
  });
});
```

- [ ] **Step 8: Run it and watch it fail**

Run: `npx vitest run src/bot/brain/controller.test.ts` from `packages/server`
Expected: FAIL — `./controller.js` does not exist.

- [ ] **Step 9: Write the strangler `HumanController`**

Create `packages/server/src/bot/brain/controller.ts`. This is deliberately thin: nearest target, steer at it, hold `preferredRange`, press one slot. Tasks 2-7 replace each `// LAYER n` block with the real module.

```ts
import type { BotDifficulty } from "@motor-combat-moba/shared";
import { BOT_PROFILES, type BotProfile } from "../../config/bot-profiles.js";
import type { BotCarView, BotController, BotDebug, BotIntent, BotView } from "../types.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

/**
 * The bot (H5). Five layers, one `decide` call: perceive, assess, move, shoot, humanize.
 *
 * Perception and humanization run EVERY tick; assess/move/shoot run on `recomputeTicks` (H6). A
 * memory that only updates every twelfth tick is not a memory, and a delay line that only shifts
 * every twelfth tick delays by a multiple of the cadence rather than by its own value.
 */
export class HumanController implements BotController {
  readonly profileId: BotDifficulty;
  private readonly profile: BotProfile;
  private fixedTarget: string | undefined;
  private target: string | undefined;
  private held: BotIntent = COAST;
  private lastDebug: BotDebug | undefined;

  constructor(
    profileId: BotDifficulty,
    options: { targetSessionId?: string; profile?: BotProfile } = {},
  ) {
    this.profileId = profileId;
    this.profile = options.profile ?? BOT_PROFILES[profileId];
    this.fixedTarget = options.targetSessionId;
  }

  get currentTargetSessionId(): string | undefined {
    return this.target;
  }

  /** Point the bot at one car, or `undefined` to choose for itself. */
  setTarget(sessionId: string | undefined): void {
    this.fixedTarget = sessionId;
  }

  debug(): BotDebug | undefined {
    return this.lastDebug;
  }

  decide(view: BotView): BotIntent {
    // LAYER 1 — perceive (Task 3 replaces this with `perceive()`)
    const target = this.pickTarget(view);
    this.target = target?.sessionId;

    // LAYER 2/3/4 — assess, move, shoot, on the recompute cadence (Tasks 4-6)
    if (this.shouldRecompute(view.tick)) {
      this.held = target ? this.chase(view, target) : COAST;
    }

    this.lastDebug = {
      tick: view.tick,
      stance: target ? "engage" : "hunt",
      stanceScores: {},
      targetSessionId: this.target,
      preferredRange: 0,
      personality: "brawler",
      firedSlot: this.held.fireSlots === 0 ? undefined : Math.log2(this.held.fireSlots),
    };

    // LAYER 5 — humanize (Task 7 replaces this with `applyHumanize()`)
    return this.held;
  }

  private shouldRecompute(tick: number): boolean {
    const cadence = this.profile.recomputeTicks;
    return cadence <= 1 || tick % cadence === 0;
  }

  /**
   * Placeholder behaviour, replaced layer by layer over Tasks 2-7. Steers at the target, holds a
   * crude range, and presses at most ONE slot (H27) — `beginFire` resolves one press per tick and
   * takes the lowest set bit, so an OR of every in-range slot fires slot 0 and nothing else.
   */
  private chase(view: BotView, target: BotCarView): BotIntent {
    const dx = target.x - view.self.x;
    const dy = target.y - view.self.y;
    const bearing = Math.atan2(dy, dx);
    const delta = Math.atan2(Math.sin(bearing - view.self.angle), Math.cos(bearing - view.self.angle));
    const distance = Math.hypot(dx, dy);

    const steer: -1 | 0 | 1 =
      delta > this.profile.aimToleranceRad ? 1 : delta < -this.profile.aimToleranceRad ? -1 : 0;

    const preferred = Math.max(70, this.profile.standoffFraction * 400);
    const band = preferred * this.profile.deadbandFraction;
    const throttle: -1 | 0 | 1 =
      Math.abs(distance - preferred) <= band ? 0 : distance > preferred ? 1 : -1;

    let fireSlots = 0;
    if (Math.abs(delta) < this.profile.fireConeRad && view.tick % this.profile.burstGapTicks === 0) {
      for (let i = 0; i < view.self.slots.length; i++) {
        const reach = view.self.slots[i]!.range > 0 ? view.self.slots[i]!.range : 150;
        if (distance < reach) { fireSlots = 1 << i; break; }
      }
    }

    return { steer, throttle, fireSlots };
  }

  private pickTarget(view: BotView): BotCarView | undefined {
    if (this.fixedTarget !== undefined) {
      const fixed = view.others.find((o) => o.sessionId === this.fixedTarget);
      return fixed?.alive ? fixed : undefined;
    }
    let best: BotCarView | undefined;
    let bestDistance = Infinity;
    for (const other of view.others) {
      if (!other.alive || other.phased) continue;
      if (other.team === view.self.team && view.others.some((o) => o.team !== view.self.team)) continue;
      const distance = Math.hypot(other.x - view.self.x, other.y - view.self.y);
      if (distance < bestDistance) { bestDistance = distance; best = other; }
    }
    return best;
  }
}
```

- [ ] **Step 10: Run the controller test**

Run: `npx vitest run src/bot/brain/controller.test.ts` from `packages/server`
Expected: PASS.

- [ ] **Step 11: Delete the legacy bot and migrate the three call sites**

```bash
git rm packages/server/src/bot/controller.ts packages/server/src/bot/controller.test.ts \
       packages/server/src/bot/input.ts packages/server/src/bot/input.test.ts
```

In `packages/server/src/bot/index.ts`, replace the `controller.js` and `input.js` exports:

```ts
export * from "./brain/controller.js";
export * from "./rng.js";
export * from "./types.js";
export * from "./view.js";
export * from "./view-ring.js";
export { BOT_PROFILES, BRAIN_CONSTANTS, BOT_BRAIN_VERSION } from "../config/bot-profiles.js";
export type { BotProfile } from "../config/bot-profiles.js";
```

In all three call sites, replace `LegacyController` with `HumanController` — the constructor and `setTarget` signatures are identical, so these are one-word edits:
- `packages/server/src/rooms/PracticeRoom.ts` — the import and line 354.
- `packages/server/src/rooms/PlaygroundRoom.ts` — the import, line 351, and the `as LegacyController` cast on line 355 becomes `as HumanController`.
- `packages/server/balance/match.ts` — the import, line 148 (`Map<string, LegacyController>`) and line 177.

- [ ] **Step 12: Typecheck and run the whole suite**

```bash
npm run typecheck -w @motor-combat-moba/server
npm test
```

Expected: PASS. If a room test fails on exact bot behaviour, read it — the legacy pilot's behaviour was never a contract, so retarget the assertion at the property it actually cares about (a bot that moves, a bot that fires) and say so in the commit.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(bot): swap the legacy chaser for the HumanController shell

Rewrites BOT_PROFILES to its 33-knob shape (H44), adds BRAIN_CONSTANTS and
BOT_BRAIN_VERSION, and installs a thin HumanController that later tasks fill in
layer by layer. Deletes LegacyController and botInput (H17).

Presses at most one slot per tick (H27): beginFire resolves one press and takes
the lowest set bit, so the old OR-every-slot mask fired slot 0 and little else.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Aim — drifting error and shot leading

**Files:**
- Create: `packages/server/src/bot/brain/aim.ts`
- Test: `packages/server/src/bot/brain/aim.test.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`

**Interfaces:**
- Consumes: `Rng` from `../rng.js`; `BotProfile` from `../../config/bot-profiles.js`.
- Produces:
  - `signedDelta(from: number, to: number): number`
  - `interface AimErrorState { offsetRad: number; nextResampleTick: number }`
  - `newAimErrorState(): AimErrorState`
  - `stepAimError(state: AimErrorState, tick: number, profile: BotProfile, rng: Rng): AimErrorState`
  - `interface LeadTarget { x: number; y: number; speed: number; angle: number }`
  - `interceptPoint(from: { x: number; y: number }, target: LeadTarget, projectileSpeed: number, leadFactor: number): { x: number; y: number }`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/bot/brain/aim.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import { interceptPoint, newAimErrorState, signedDelta, stepAimError } from "./aim.js";

describe("signedDelta", () => {
  it("takes the short way around the seam", () => {
    expect(signedDelta(3.0, -3.0)).toBeCloseTo(0.2832, 3);
    expect(signedDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("stepAimError", () => {
  it("holds its offset between resamples, so error drifts rather than jitters", () => {
    const rng = makeRng(5);
    const profile = BOT_PROFILES.easy; // driftTicks 20
    let state = stepAimError(newAimErrorState(), 0, profile, rng);
    const first = state.offsetRad;
    for (let tick = 1; tick < 20; tick++) state = stepAimError(state, tick, profile, rng);
    expect(state.offsetRad).toBe(first);
    state = stepAimError(state, 20, profile, rng);
    expect(state.offsetRad).not.toBe(first);
  });

  it("keeps a tighter tier's error smaller on average", () => {
    const spread = (sigmaTier: "easy" | "hard") => {
      const rng = makeRng(11);
      let state = newAimErrorState();
      let total = 0;
      for (let i = 0; i < 400; i++) {
        state = stepAimError(state, i * 40, BOT_PROFILES[sigmaTier], rng);
        total += Math.abs(state.offsetRad);
      }
      return total / 400;
    };
    expect(spread("hard")).toBeLessThan(spread("easy"));
  });
});

describe("interceptPoint", () => {
  it("returns the target's own position at leadFactor 0", () => {
    const point = interceptPoint({ x: 0, y: 0 }, { x: 300, y: 0, speed: 400, angle: Math.PI / 2 }, 900, 0);
    expect(point).toEqual({ x: 300, y: 0 });
  });

  it("leads a crossing target ahead of its own position", () => {
    const point = interceptPoint({ x: 0, y: 0 }, { x: 300, y: 0, speed: 400, angle: Math.PI / 2 }, 900, 1);
    expect(point.y).toBeGreaterThan(0);
    // Time to close 300 units at 900 u/s is ~0.333 s; the target covers ~133 units in that time.
    expect(point.y).toBeGreaterThan(100);
    expect(point.y).toBeLessThan(200);
  });

  it("falls back to the target's position when the shot cannot catch it", () => {
    const point = interceptPoint({ x: 0, y: 0 }, { x: 300, y: 0, speed: 900, angle: 0 }, 100, 1);
    expect(point).toEqual({ x: 300, y: 0 });
  });

  it("falls back for a zero-speed weapon (a range-0 maneuver row)", () => {
    const point = interceptPoint({ x: 0, y: 0 }, { x: 50, y: 0, speed: 400, angle: 0 }, 0, 1);
    expect(point).toEqual({ x: 50, y: 0 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/bot/brain/aim.test.ts` from `packages/server`
Expected: FAIL — `./aim.js` does not exist.

- [ ] **Step 3: Write `aim.ts`**

```ts
import type { BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";

/**
 * Signed shortest angle from `from` to `to`, in (-pi, pi].
 *
 * A raw subtraction reads as a near-2*pi turn at the seam, which steers the long way round;
 * `atan2(sin, cos)` wraps it back.
 */
export function signedDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * The bot's current aim error (H44).
 *
 * Held between resamples ON PURPOSE. An error resampled every tick reads as jitter — a machine
 * vibrating — while an error that wanders over `aimErrorDriftTicks` reads as a hand that is not
 * quite on target. The drift is most of what makes the error look human rather than noisy.
 */
export interface AimErrorState {
  offsetRad: number;
  nextResampleTick: number;
}

export function newAimErrorState(): AimErrorState {
  return { offsetRad: 0, nextResampleTick: 0 };
}

/**
 * Advance the aim error. Draws EXACTLY ONE random number per call regardless of whether it
 * resamples, so the stream stays aligned across branches (H21).
 */
export function stepAimError(
  state: AimErrorState,
  tick: number,
  profile: BotProfile,
  rng: Rng,
): AimErrorState {
  // Drawn unconditionally, discarded when not resampling: a draw made only on some ticks would make
  // the stream depend on the branch, and two runs of one seed would diverge.
  const sample = gaussian(rng) * profile.aimErrorSigmaRad;
  if (tick < state.nextResampleTick) return state;
  const drift = Math.max(1, profile.aimErrorDriftTicks);
  return { offsetRad: sample, nextResampleTick: tick + drift };
}

/**
 * A standard normal from two uniforms — Box-Muller, one half used.
 *
 * `rng` is the bot's seeded stream (B20); `Math.random` is banned on this path. Two draws every
 * call, always, for the same stream-alignment reason as above.
 */
function gaussian(rng: Rng): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface LeadTarget {
  x: number;
  y: number;
  speed: number;
  angle: number;
}

/**
 * Where to aim so a shot of `projectileSpeed` meets a target moving at its current velocity (H44).
 *
 * `leadFactor` is the FRACTION of the correct lead the bot actually applies: 0 shoots at where the
 * target is now (a beginner), 1 solves the intercept (UT's "Adept" gate). It is the largest single
 * skill gap on this roster — cars top out at 320-450 u/s while `magmablast` flies at 600 and
 * `thumper` at 450, so a bot that does not lead cannot hit a moving Mirage with either.
 *
 * Falls back to the target's own position when no intercept exists — a shot slower than its target,
 * or a `speed: 0` maneuver row — rather than returning a point behind the shooter.
 */
export function interceptPoint(
  from: { x: number; y: number },
  target: LeadTarget,
  projectileSpeed: number,
  leadFactor: number,
): { x: number; y: number } {
  const here = { x: target.x, y: target.y };
  if (leadFactor <= 0 || projectileSpeed <= 0 || target.speed === 0) return here;

  const vx = Math.cos(target.angle) * target.speed;
  const vy = Math.sin(target.angle) * target.speed;
  const rx = target.x - from.x;
  const ry = target.y - from.y;

  // |r + v*t| = s*t  ->  (v.v - s^2) t^2 + 2 (r.v) t + r.r = 0
  const a = vx * vx + vy * vy - projectileSpeed * projectileSpeed;
  const b = 2 * (rx * vx + ry * vy);
  const c = rx * rx + ry * ry;

  let t: number;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-6) return here;
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return here;
    const root = Math.sqrt(disc);
    const t1 = (-b - root) / (2 * a);
    const t2 = (-b + root) / (2 * a);
    const positives = [t1, t2].filter((v) => v > 0);
    if (positives.length === 0) return here;
    t = Math.min(...positives);
  }
  if (!Number.isFinite(t) || t <= 0) return here;

  return { x: target.x + vx * t * leadFactor, y: target.y + vy * t * leadFactor };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/bot/brain/aim.test.ts` from `packages/server`
Expected: PASS.

- [ ] **Step 5: Wire aim into the controller**

In `packages/server/src/bot/brain/controller.ts`:
- import `{ interceptPoint, newAimErrorState, signedDelta, stepAimError, type AimErrorState }` from `./aim.js` and `weaponDefOf` from `@motor-combat-moba/shared`;
- add `private aimError: AimErrorState = newAimErrorState();`
- in `decide`, **before** the cadence gate (perception-layer work runs every tick), add
  `this.aimError = stepAimError(this.aimError, view.tick, this.profile, view.rng);`
- in `chase`, replace the bearing computation with a lead-aware, error-adjusted one:

```ts
    // Lead against the slot the bot would actually press. Slot 0 stands in until Task 4's ranking
    // lands; a weapon's own `speed` is public knowledge, so leading with it is fair (H22).
    const leadSpeed = view.self.slots[0] ? weaponDefOf(view.self.slots[0].weaponId).speed : 0;
    const aimPoint = interceptPoint(
      { x: view.self.x, y: view.self.y },
      { x: target.x, y: target.y, speed: target.speed, angle: target.angle },
      leadSpeed,
      this.profile.leadFactor,
    );
    const bearing = Math.atan2(aimPoint.y - view.self.y, aimPoint.x - view.self.x)
      + this.aimError.offsetRad;
    const delta = signedDelta(view.self.angle, bearing);
    const distance = Math.hypot(target.x - view.self.x, target.y - view.self.y);
```

Remove the now-unused `dx`/`dy` locals only if nothing else uses them.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck -w @motor-combat-moba/server
npm test
git add -A
git commit -m "feat(bot): give the bot a drifting aim error and shot leading

Error is held for aimErrorDriftTicks so it wanders like a hand instead of
jittering like a machine, and interceptPoint solves the lead a tier actually
applies -- leadFactor 0 shoots at where the target is, 0.95 solves it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Perception — attention, memory, threats, ult memory

**Files:**
- Create: `packages/server/src/bot/brain/perception.ts`
- Test: `packages/server/src/bot/brain/perception.test.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`

**Interfaces:**
- Consumes: `signedDelta` from `./aim.js`; `BotView`, `BotCarView` from `../types.js`; `weaponDefOf` from shared.
- Produces:
  - `interface KnownCar { car: BotCarView; firstSeenTick: number; noticedAtTick: number; lastSeenTick: number }`
  - `interface KnownThreat { id: string; ownerSessionId: string; weaponId: WeaponId; noticedAtTick: number; reactAtTick: number; reacting: boolean; awayHeadingRad: number }`
  - `interface PerceptionState { cars: Map<string, KnownCar>; threats: Map<string, KnownThreat>; ultSeenTick: Map<string, number>; blameTick: Map<string, number> }`
  - `newPerception(): PerceptionState`
  - `perceive(state: PerceptionState, view: BotView, profile: BotProfile): PerceptionState` — pure w.r.t. `view`, mutates and returns `state`
  - `knownCars(state: PerceptionState, tick: number): BotCarView[]` — only cars past their acquire delay and inside memory
  - `activeThreats(state: PerceptionState, tick: number): KnownThreat[]`
  - `ultIsSpent(state: PerceptionState, sessionId: string, weaponId: WeaponId, tick: number, withinTicks: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/bot/brain/perception.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotView } from "../types.js";
import { activeThreats, knownCars, newPerception, perceive, ultIsSpent } from "./perception.js";

function car(overrides: Partial<BotCarView> = {}): BotCarView {
  return {
    sessionId: "them", carId: "mirage", team: 0,
    x: 300, y: 100, angle: 0, speed: 0, hp: 70, maxHp: 70,
    alive: true, phased: false, statuses: [], maneuver: 0,
    ...overrides,
  };
}

function view(overrides: Partial<BotView> = {}): BotView {
  return {
    tick: 0,
    self: {
      sessionId: "me", carId: "bullseye", team: 0,
      x: 100, y: 100, angle: 0, speed: 0, hp: 65, maxHp: 65, alive: true,
      statuses: [], slots: [], switchLockUntilTick: 0, lockTargetSessionId: "",
      maneuver: 0, maneuverTicksLeft: 0,
    },
    others: [], instances: [], arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [], rng: makeRng(3),
    ...overrides,
  };
}

describe("perceive", () => {
  it("does not know a car until its acquire delay has passed", () => {
    const profile = BOT_PROFILES.hard; // acquireTicks 5
    let state = newPerception();
    state = perceive(state, view({ tick: 0, others: [car()] }), profile);
    expect(knownCars(state, 0)).toHaveLength(0);
    for (let tick = 1; tick <= 5; tick++) {
      state = perceive(state, view({ tick, others: [car()] }), profile);
    }
    expect(knownCars(state, 5)).toHaveLength(1);
  });

  it("never notices a car beyond the awareness radius", () => {
    const profile = BOT_PROFILES.easy; // 520 units
    let state = newPerception();
    for (let tick = 0; tick < 40; tick++) {
      state = perceive(state, view({ tick, others: [car({ x: 1000 })] }), profile);
    }
    expect(knownCars(state, 40)).toHaveLength(0);
  });

  it("never notices a car inside the rear blind arc", () => {
    const profile = BOT_PROFILES.easy; // rearBlindHalfAngleRad 1.05
    let state = newPerception();
    // Self faces +x at the origin-ish; a car directly behind is at a bearing of pi.
    for (let tick = 0; tick < 40; tick++) {
      state = perceive(state, view({ tick, others: [car({ x: -100, y: 100 })] }), profile);
    }
    expect(knownCars(state, 40)).toHaveLength(0);
  });

  it("forgets a car once it has been out of sight for memoryTicks", () => {
    const profile = BOT_PROFILES.easy; // memoryTicks 15
    let state = newPerception();
    for (let tick = 0; tick <= 20; tick++) {
      state = perceive(state, view({ tick, others: [car({ x: 300 })] }), profile);
    }
    expect(knownCars(state, 20)).toHaveLength(1);
    for (let tick = 21; tick <= 40; tick++) {
      state = perceive(state, view({ tick, others: [] }), profile);
    }
    expect(knownCars(state, 40)).toHaveLength(0);
  });

  it("caps the tracked threat list at the tier's limit", () => {
    const profile = BOT_PROFILES.easy; // trackedThreatLimit 1
    const instances = [0, 1, 2].map((i) => ({
      id: `i${i}`, ownerSessionId: "them", weaponId: "predator" as const,
      x: 400 + i * 10, y: 100, angle: Math.PI,
    }));
    let state = newPerception();
    for (let tick = 0; tick < 20; tick++) {
      state = perceive(state, view({ tick, instances }), profile);
    }
    expect(state.threats.size).toBeLessThanOrEqual(1);
  });

  it("remembers who fired what, so an ult can be tracked (H22)", () => {
    let state = newPerception();
    state = perceive(
      state,
      view({
        tick: 10,
        observedFires: [{
          tick: 10, shooterSessionId: "them", carId: "bullseye",
          weaponId: "lance", slot: 2, pressId: "them#10#2",
        }],
      }),
      BOT_PROFILES.hard,
    );
    expect(ultIsSpent(state, "them", "lance", 40, 480)).toBe(true);
    expect(ultIsSpent(state, "them", "lance", 600, 480)).toBe(false);
  });

  it("marks a shot on a collision course as a threat", () => {
    const profile = BOT_PROFILES.hard;
    let state = newPerception();
    // A predator at (400,100) heading -x, straight at self at (100,100).
    const instances = [{
      id: "shot", ownerSessionId: "them", weaponId: "predator" as const,
      x: 400, y: 100, angle: Math.PI,
    }];
    for (let tick = 0; tick < 10; tick++) {
      state = perceive(state, view({ tick, instances }), profile);
    }
    expect(activeThreats(state, 9).length).toBeGreaterThan(0);
  });

  it("ignores a shot that will pass well wide", () => {
    const profile = BOT_PROFILES.hard;
    let state = newPerception();
    const instances = [{
      id: "wide", ownerSessionId: "them", weaponId: "predator" as const,
      x: 400, y: 600, angle: Math.PI,
    }];
    for (let tick = 0; tick < 10; tick++) {
      state = perceive(state, view({ tick, instances }), profile);
    }
    expect(activeThreats(state, 9)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/bot/brain/perception.test.ts` from `packages/server`
Expected: FAIL — `./perception.js` does not exist.

- [ ] **Step 3: Write `perception.ts`**

```ts
import { DRIVE_CONFIG, TICK_RATE_HZ, weaponDefOf, type WeaponId } from "@motor-combat-moba/shared";
import type { BotProfile } from "../../config/bot-profiles.js";
import type { BotCarView, BotView } from "../types.js";
import { signedDelta } from "./aim.js";

/** How wide a shot's path must miss by to be ignored: the car's own half-diagonal, plus slack. */
const THREAT_LATERAL_UNITS = Math.hypot(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2 + 16;

export interface KnownCar {
  car: BotCarView;
  firstSeenTick: number;
  /** The tick this car actually registers — `firstSeenTick + acquireTicks` (TF2 recognition time). */
  noticedAtTick: number;
  lastSeenTick: number;
}

export interface KnownThreat {
  id: string;
  ownerSessionId: string;
  weaponId: WeaponId;
  noticedAtTick: number;
  /** When the bot's hands may move about it — `noticedAtTick + dodgeReactionTicks`. */
  reactAtTick: number;
  /** The result of this threat's ONE `dodgeChance` roll. Re-rolling per tick would dodge everything. */
  reacting: boolean;
  /** A heading that takes the car off this shot's line. */
  awayHeadingRad: number;
}

/**
 * What the bot has actually noticed (H7).
 *
 * `buildBotView` already answers "what may this bot see"; this answers "what has it taken in". The
 * two are different questions and the second is where a casual differs from a pro.
 */
export interface PerceptionState {
  cars: Map<string, KnownCar>;
  threats: Map<string, KnownThreat>;
  /** `${sessionId}:${weaponId}` -> the tick that press was watched (H22). */
  ultSeenTick: Map<string, number>;
  /** sessionId -> the last tick a shot of theirs was seen coming at us. Drives vengefulness (H23). */
  blameTick: Map<string, number>;
}

export function newPerception(): PerceptionState {
  return { cars: new Map(), threats: new Map(), ultSeenTick: new Map(), blameTick: new Map() };
}

/**
 * One tick of taking the world in. Mutates and returns `state` — perception is the bot's memory, and
 * copying it every tick for six bots at 30 Hz buys nothing.
 *
 * Draws no random numbers except the ONE `dodgeChance` roll per newly-noticed threat, which is drawn
 * unconditionally for stream alignment (H21) and discarded when the threat is already known.
 */
export function perceive(
  state: PerceptionState,
  view: BotView,
  profile: BotProfile,
): PerceptionState {
  const tick = view.tick;
  const self = view.self;

  for (const car of view.others) {
    if (!visible(self, car, profile)) continue;
    const existing = state.cars.get(car.sessionId);
    if (existing) {
      existing.car = car;
      existing.lastSeenTick = tick;
    } else {
      state.cars.set(car.sessionId, {
        car,
        firstSeenTick: tick,
        noticedAtTick: tick + profile.acquireTicks,
        lastSeenTick: tick,
      });
    }
  }

  for (const [sessionId, known] of state.cars) {
    if (tick - known.lastSeenTick > profile.memoryTicks) state.cars.delete(sessionId);
  }

  for (const fire of view.observedFires) {
    if (fire.shooterSessionId === self.sessionId) continue;
    state.ultSeenTick.set(`${fire.shooterSessionId}:${fire.weaponId}`, fire.tick);
  }

  const live = new Set<string>();
  for (const instance of view.instances) {
    if (instance.ownerSessionId === self.sessionId) continue;
    const away = threatHeading(self, instance, profile);
    if (away === undefined) continue;
    live.add(instance.id);
    state.blameTick.set(instance.ownerSessionId, tick);
    const existing = state.threats.get(instance.id);
    // Drawn every time, used only for a new threat: a conditional draw makes the stream depend on
    // the branch, and one seed would stop replaying (H21).
    const roll = view.rng();
    if (existing) {
      existing.awayHeadingRad = away;
      continue;
    }
    if (state.threats.size >= profile.trackedThreatLimit) continue;
    state.threats.set(instance.id, {
      id: instance.id,
      ownerSessionId: instance.ownerSessionId,
      weaponId: instance.weaponId,
      noticedAtTick: tick,
      reactAtTick: tick + profile.dodgeReactionTicks,
      reacting: roll < profile.dodgeChance,
      awayHeadingRad: away,
    });
  }
  for (const id of [...state.threats.keys()]) {
    if (!live.has(id)) state.threats.delete(id);
  }

  return state;
}

/** Cars the bot has actually registered — past the acquire delay, still inside memory. */
export function knownCars(state: PerceptionState, tick: number): BotCarView[] {
  const out: BotCarView[] = [];
  for (const known of state.cars.values()) {
    if (tick >= known.noticedAtTick) out.push(known.car);
  }
  // Sorted for the same reason `buildBotView` sorts: a tie must break identically every replay.
  out.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
  return out;
}

/** Threats the bot both rolled to react to and has had time to react to. */
export function activeThreats(state: PerceptionState, tick: number): KnownThreat[] {
  return [...state.threats.values()].filter((t) => t.reacting && tick >= t.reactAtTick);
}

/** Was this car seen spending this weapon inside the last `withinTicks`? (H22) */
export function ultIsSpent(
  state: PerceptionState,
  sessionId: string,
  weaponId: WeaponId,
  tick: number,
  withinTicks: number,
): boolean {
  const seen = state.ultSeenTick.get(`${sessionId}:${weaponId}`);
  return seen !== undefined && tick - seen <= withinTicks;
}

/** Ticks since this car was last seen shooting our way, or `Infinity`. */
export function ticksSinceBlame(state: PerceptionState, sessionId: string, tick: number): number {
  const seen = state.blameTick.get(sessionId);
  return seen === undefined ? Infinity : tick - seen;
}

/**
 * Is this car inside the bot's attention at all — near enough, and not behind it?
 *
 * The rear arc is UT's field-of-view gate: Novice sees 30 degrees, Godlike sees 360. Here it is
 * expressed as the arc BEHIND the car that goes unwatched, so 0 means full awareness.
 */
function visible(self: BotView["self"], car: BotCarView, profile: BotProfile): boolean {
  if (!car.alive) return false;
  const dx = car.x - self.x;
  const dy = car.y - self.y;
  if (Math.hypot(dx, dy) > profile.awarenessRadiusUnits) return false;
  if (profile.rearBlindHalfAngleRad <= 0) return true;
  const off = Math.abs(signedDelta(self.angle, Math.atan2(dy, dx)));
  return off < Math.PI - profile.rearBlindHalfAngleRad;
}

/**
 * A heading that takes the car off this shot's line, or `undefined` when the shot is not a threat.
 *
 * The shot is projected along its own heading at its weapon's own speed — both drawn on screen, so
 * reading them is fair (H22). If its closest approach inside `dodgeHorizonTicks` misses by more than
 * a car's half-diagonal, it is ignored.
 */
function threatHeading(
  self: BotView["self"],
  instance: BotView["instances"][number],
  profile: BotProfile,
): number | undefined {
  const speed = weaponDefOf(instance.weaponId).speed;
  if (speed <= 0) return undefined;

  const vx = Math.cos(instance.angle) * speed;
  const vy = Math.sin(instance.angle) * speed;
  const rx = self.x - instance.x;
  const ry = self.y - instance.y;

  const horizonSeconds = profile.dodgeHorizonTicks / TICK_RATE_HZ;
  const vv = vx * vx + vy * vy;
  const t = Math.min(Math.max((rx * vx + ry * vy) / vv, 0), horizonSeconds);
  const missX = rx - vx * t;
  const missY = ry - vy * t;
  if (Math.hypot(missX, missY) > THREAT_LATERAL_UNITS) return undefined;

  // Perpendicular to the shot's travel, on the side we are already closest to: the shortest way off
  // the line, rather than a turn across it.
  const perp = Math.atan2(vy, vx) + Math.PI / 2;
  const cross = vx * ry - vy * rx;
  return cross >= 0 ? perp : perp + Math.PI;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/bot/brain/perception.test.ts` from `packages/server`
Expected: PASS.

- [ ] **Step 5: Wire perception into the controller**

In `controller.ts`:
- import `{ knownCars, newPerception, perceive, type PerceptionState }` from `./perception.js`;
- add `private perception: PerceptionState = newPerception();`
- in `decide`, run it every tick before the cadence gate, next to the aim-error step:

```ts
    this.perception = perceive(this.perception, view, this.profile);
    this.aimError = stepAimError(this.aimError, view.tick, this.profile, view.rng);
```

- change `pickTarget` to choose from `knownCars(this.perception, view.tick)` instead of `view.others`, keeping the same phased/team/alive filtering. A fixed target that has not been noticed yet returns `undefined`, which coasts — that is the acquire delay doing its job.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck -w @motor-combat-moba/server
npm test
git add -A
git commit -m "feat(bot): give the bot attention, memory and threat awareness

buildBotView answers what a bot MAY see; perceive answers what it has taken in.
Acquire delay, awareness radius, rear blind arc, tracked-threat cap, memory
decay, ult memory from observedFires, and the blame map vengefulness reads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Firing — range model, single-slot ranking, discipline, ult windows

**Files:**
- Create: `packages/server/src/bot/brain/firing.ts`
- Test: `packages/server/src/bot/brain/firing.test.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`

**Interfaces:**
- Consumes: `BotSelfView`, `BotCarView`; `BRAIN_CONSTANTS`, `BotProfile`; `PerceptionState`, `ultIsSpent`.
- Produces:
  - `slotIsReady(slot: BotSlotView, tick: number): boolean`
  - `weaponValueOf(slot: BotSlotView, weight: number): number`
  - `effectiveRangeOf(slots: readonly BotSlotView[], weights: readonly number[], tick: number): number`
  - `preferredRangeOf(self: BotSelfView, profile: BotProfile, weights: readonly number[], tick: number): number`
  - `isUlt(slot: BotSlotView): boolean`
  - `interface FireDecision { slot: number | undefined }`
  - `chooseSlot(args: { self: BotSelfView; target: BotCarView; distance: number; aimDelta: number; profile: BotProfile; weights: readonly number[]; tick: number; lastPressTick: number; rng: Rng }): FireDecision`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/bot/brain/firing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView, BotSlotView } from "../types.js";
import { chooseSlot, effectiveRangeOf, isUlt, preferredRangeOf, slotIsReady } from "./firing.js";

function slotsFor(carId: "bullseye" | "mirage" | "bastion"): BotSlotView[] {
  return slotsOf(carId).map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  }));
}

function self(carId: "bullseye" | "mirage" | "bastion"): BotSelfView {
  return {
    sessionId: "me", carId, team: 0, x: 0, y: 0, angle: 0, speed: 0,
    hp: 100, maxHp: 100, alive: true, statuses: [], slots: slotsFor(carId),
    switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
  };
}

const target: BotCarView = {
  sessionId: "them", carId: "mirage", team: 0, x: 300, y: 0, angle: 0, speed: 0,
  hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
};

const ones = [1, 1, 1];

describe("effectiveRangeOf", () => {
  it("puts Bullseye further out than Mirage", () => {
    const bullseye = effectiveRangeOf(slotsFor("bullseye"), ones, 0);
    const mirage = effectiveRangeOf(slotsFor("mirage"), ones, 0);
    expect(bullseye).toBeGreaterThan(mirage);
  });

  it("excludes a range-0 row rather than letting it drag the average to nothing", () => {
    const withCharge = effectiveRangeOf(slotsFor("bastion"), ones, 0);
    expect(withCharge).toBeGreaterThan(400);
  });

  it("returns 0 for a car with no slots", () => {
    expect(effectiveRangeOf([], [], 0)).toBe(0);
  });
});

describe("preferredRangeOf", () => {
  it("never asks to fight further away than the bot can perceive", () => {
    const range = preferredRangeOf(self("bullseye"), BOT_PROFILES.hard, ones, 0);
    expect(range).toBeLessThanOrEqual(BOT_PROFILES.hard.awarenessRadiusUnits);
  });

  it("never collapses below the close-quarters floor", () => {
    const range = preferredRangeOf({ ...self("bastion"), slots: [] }, BOT_PROFILES.easy, [], 0);
    expect(range).toBe(70);
  });

  it("holds a longer range for a more disciplined tier", () => {
    expect(preferredRangeOf(self("mirage"), BOT_PROFILES.hard, ones, 0))
      .toBeGreaterThan(preferredRangeOf(self("mirage"), BOT_PROFILES.easy, ones, 0));
  });
});

describe("isUlt", () => {
  it("counts a long cooldown and not a short one", () => {
    const [predator, pepperbox, lance] = slotsFor("bullseye");
    expect(isUlt(predator!)).toBe(false);
    expect(isUlt(pepperbox!)).toBe(false);
    expect(isUlt(lance!)).toBe(true);
  });
});

describe("slotIsReady", () => {
  it("wants a stock and both locks expired", () => {
    const [slot] = slotsFor("bullseye");
    expect(slotIsReady(slot!, 0)).toBe(true);
    expect(slotIsReady({ ...slot!, stocks: 0 }, 0)).toBe(false);
    expect(slotIsReady({ ...slot!, refireLockUntilTick: 10 }, 0)).toBe(false);
  });
});

describe("chooseSlot", () => {
  const base = {
    target, distance: 300, aimDelta: 0, weights: ones, tick: 0, lastPressTick: -999,
  };

  it("presses nothing while the aim is outside the fire cone", () => {
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard,
      aimDelta: 1.2, rng: makeRng(1),
    });
    expect(out.slot).toBeUndefined();
  });

  it("presses nothing before burstGapTicks has elapsed", () => {
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard,
      tick: 1, lastPressTick: 0, rng: makeRng(1),
    });
    expect(out.slot).toBeUndefined();
  });

  it("returns exactly one slot, never a mask (H27)", () => {
    const out = chooseSlot({
      ...base, self: self("bullseye"), profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(out.slot === undefined || Number.isInteger(out.slot)).toBe(true);
  });

  it("a disciplined bot holds its ult against a full-hp target (H30)", () => {
    let ultPresses = 0;
    for (let seed = 0; seed < 40; seed++) {
      const out = chooseSlot({
        ...base, self: self("bullseye"), profile: BOT_PROFILES.hard,
        distance: 1100, rng: makeRng(seed),
      });
      if (out.slot === 2) ultPresses++;
    }
    expect(ultPresses).toBeLessThan(8); // ~10% of the time at ultDisciplineChance 0.9
  });

  it("an undisciplined bot burns its ult against a full-hp target (H30)", () => {
    let ultPresses = 0;
    for (let seed = 0; seed < 40; seed++) {
      const out = chooseSlot({
        ...base, self: self("bullseye"), profile: BOT_PROFILES.easy,
        distance: 1100, rng: makeRng(seed),
      });
      if (out.slot === 2) ultPresses++;
    }
    expect(ultPresses).toBeGreaterThan(0);
  });

  it("respects the switch lock rather than throwing a press away (H27a)", () => {
    const locked = { ...self("bullseye"), switchLockUntilTick: 50 };
    const out = chooseSlot({
      ...base, self: locked, profile: BOT_PROFILES.hard, tick: 10, rng: makeRng(1),
    });
    // Slot 0 is what a fresh `lastFiredSlot` of -1 would refuse; nothing may be pressed under lock.
    expect(out.slot).toBeUndefined();
  });

  it("will press a range-0 weapon at contact range (H28)", () => {
    let pressed = false;
    for (let seed = 0; seed < 40 && !pressed; seed++) {
      const out = chooseSlot({
        ...base, self: self("bastion"), profile: BOT_PROFILES.easy,
        distance: 100, target: { ...target, x: 100, hp: 10 }, rng: makeRng(seed),
      });
      if (out.slot === 2) pressed = true;
    }
    expect(pressed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/bot/brain/firing.test.ts` from `packages/server`
Expected: FAIL — `./firing.js` does not exist.

- [ ] **Step 3: Write `firing.ts`**

```ts
import { hasStatus, weaponDefOf } from "@motor-combat-moba/shared";
import { BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotCarView, BotSelfView, BotSlotView } from "../types.js";

/** A slot with a stock in hand and neither lock running. */
export function slotIsReady(slot: BotSlotView, tick: number): boolean {
  return slot.stocks >= 1 && tick >= slot.refireLockUntilTick;
}

/** A long-cooldown weapon, worth saving for a moment (H30). */
export function isUlt(slot: BotSlotView): boolean {
  return weaponDefOf(slot.weaponId).cooldownMs >= BRAIN_CONSTANTS.ultCooldownMs;
}

/**
 * A slot's rough worth per second, times this bot's preference for it.
 *
 * A SHAPING HEURISTIC for standoff and slot ranking only (H35). `damage` is the raw table field, so
 * a beam's pulse and a pepperbox pellet are both under-rated; that is accepted. `sim/damage.ts` is
 * the only authority on damage and nothing here may be mistaken for it.
 */
export function weaponValueOf(slot: BotSlotView, weight: number): number {
  const def = weaponDefOf(slot.weaponId);
  const seconds = Math.max(def.cooldownMs, 1) / 1000;
  return (def.damage / seconds) * Math.max(weight, 0.01);
}

/**
 * The range this kit wants to fight at: every ready slot's reach, weighted by its worth (H35).
 *
 * Range-0 rows are excluded — a charge dashes nowhere and would drag the average to nothing — but
 * they still pull the bot in through the `Brawl` stance (H36).
 */
export function effectiveRangeOf(
  slots: readonly BotSlotView[],
  weights: readonly number[],
  tick: number,
): number {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot.range <= 0) continue;
    if (!slotIsReady(slot, tick)) continue;
    const value = weaponValueOf(slot, weights[i] ?? 1);
    weighted += slot.range * value;
    total += value;
  }
  if (total === 0) {
    // Nothing ready: fall back to the kit's reach as authored, so a bot mid-recharge does not
    // suddenly decide it wants to be nose to nose.
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot.range <= 0) continue;
      const value = weaponValueOf(slot, weights[i] ?? 1);
      weighted += slot.range * value;
      total += value;
    }
  }
  return total === 0 ? 0 : weighted / total;
}

/** Where this bot wants to stand (H35): a fraction of its own reach, floored and capped. */
export function preferredRangeOf(
  self: BotSelfView,
  profile: BotProfile,
  weights: readonly number[],
  tick: number,
): number {
  const effective = effectiveRangeOf(self.slots, weights, tick);
  const wanted = profile.standoffFraction * effective;
  return Math.min(
    Math.max(wanted, BRAIN_CONSTANTS.minEngageUnits),
    profile.awarenessRadiusUnits,
  );
}

export interface FireDecision {
  /** The single slot to press, or `undefined` to hold fire. NEVER a mask (H27). */
  slot: number | undefined;
}

/**
 * Which one slot to press this tick (H27).
 *
 * `beginFire` resolves at most one press per tick and takes the LOWEST set bit it can use, so a bot
 * that ORs every in-range slot fires slot 0 and essentially nothing else. Ranking and returning one
 * slot is what lets a chassis actually use its kit.
 *
 * Draws exactly two random numbers, always, in this order: the discipline roll and the ult roll.
 */
export function chooseSlot(args: {
  self: BotSelfView;
  target: BotCarView;
  distance: number;
  aimDelta: number;
  profile: BotProfile;
  weights: readonly number[];
  tick: number;
  lastPressTick: number;
  rng: Rng;
}): FireDecision {
  const { self, target, distance, aimDelta, profile, weights, tick, rng } = args;

  // Both drawn unconditionally, before any early return, so the stream stays aligned (H21).
  const disciplineRoll = rng();
  const ultRoll = rng();

  const hold: FireDecision = { slot: undefined };
  if (Math.abs(aimDelta) >= profile.fireConeRad) return hold;
  if (tick - args.lastPressTick < profile.burstGapTicks) return hold;
  // A press the sim would refuse is a press thrown away. Reading our OWN switch lock is fair —
  // it is on our own HUD (H27a).
  if (tick < self.switchLockUntilTick) return hold;

  const targetHpFraction = target.maxHp > 0 ? target.hp / target.maxHp : 1;
  const targetStunned = hasStatus(target.statuses, "stunned", tick);

  let best: number | undefined;
  let bestScore = -Infinity;

  for (let i = 0; i < self.slots.length; i++) {
    const slot = self.slots[i]!;
    if (!slotIsReady(slot, tick)) continue;

    const reach = slot.range > 0 ? slot.range : BRAIN_CONSTANTS.contactTriggerUnits;
    if (distance > reach) continue;

    if (isUlt(slot)) {
      const goodMoment =
        targetHpFraction <= profile.ultWindowHpFraction ||
        targetStunned ||
        distance <= reach / 2;
      // Discipline is the probability of HOLDING when the moment is not good (H30).
      if (!goodMoment && ultRoll < profile.ultDisciplineChance) continue;
    } else if (distance > reach * 0.9 && disciplineRoll < profile.fireDisciplineChance) {
      // A marginal shot at the very edge of reach: a disciplined bot waits, a sprayer takes it (H29).
      continue;
    }

    // Prefer the weapon that is worth the most and fits the current distance best.
    const fit = 1 - Math.min(distance / reach, 1) * 0.5;
    const score = weaponValueOf(slot, weights[i] ?? 1) * fit;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return { slot: best };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/bot/brain/firing.test.ts` from `packages/server`
Expected: PASS. If the switch-lock case fails, check that the test's `tick` (10) is genuinely below `switchLockUntilTick` (50).

- [ ] **Step 5: Wire firing into the controller**

In `controller.ts`:
- import `{ chooseSlot, preferredRangeOf }` from `./firing.js`;
- add `private lastPressTick = -999;` and `private slotWeights: readonly number[] = [1, 1, 1];`
- replace the fire block and the hard-coded `preferred` in `chase`:

```ts
    const preferred = preferredRangeOf(view.self, this.profile, this.slotWeights, view.tick);
    const band = preferred * this.profile.deadbandFraction;
    const throttle: -1 | 0 | 1 =
      Math.abs(distance - preferred) <= band ? 0 : distance > preferred ? 1 : -1;

    const decision = chooseSlot({
      self: view.self, target, distance, aimDelta: delta, profile: this.profile,
      weights: this.slotWeights, tick: view.tick, lastPressTick: this.lastPressTick, rng: view.rng,
    });
    if (decision.slot !== undefined) this.lastPressTick = view.tick;
    const fireSlots = decision.slot === undefined ? 0 : 1 << decision.slot;
```

- set `preferredRange: preferred` and `firedSlot: decision.slot` on the debug object (thread them out of `chase` by returning them alongside the intent, or store them on `this` — either is fine, but be consistent).

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck -w @motor-combat-moba/server
npm test
git add -A
git commit -m "feat(bot): rank slots and fight at a range derived from the kit

One slot per press (H27), a preferred range weighted from the bot's own ready
weapons (H35), trigger discipline on marginal shots, and TF2-style ult gating
that holds lance for a stunned or wounded target.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Movement — the context-steering blend

**Files:**
- Create: `packages/server/src/bot/brain/movement.ts`
- Test: `packages/server/src/bot/brain/movement.test.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`

**Interfaces:**
- Consumes: `signedDelta` from `./aim.js`; `KnownThreat` from `./perception.js`; `Obstacle`/`Aabb` from the view's `arena`.
- Produces:
  - `interface Desire { headingRad: number; weight: number }`
  - `blendHeading(desires: readonly Desire[], fallbackHeading: number): number`
  - `wallDesire(self: { x: number; y: number; angle: number }, arena: BotArenaView, lookaheadUnits: number): Desire | undefined`
  - `orbitDesire(bearingToTarget: number, orbitBias: number, side: 1 | -1): Desire | undefined`
  - `dodgeDesires(threats: readonly KnownThreat[]): Desire[]`
  - `reduceToIntent(args: { headingError: number; distance: number; preferredRange: number; deadband: number; aimToleranceRad: number; closing: boolean }): { steer: -1 | 0 | 1; throttle: -1 | 0 | 1 }`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/bot/brain/movement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blendHeading, dodgeDesires, orbitDesire, reduceToIntent, wallDesire } from "./movement.js";

const arena = { width: 1280, height: 720, obstacles: [] };

describe("blendHeading", () => {
  it("returns the fallback when there is nothing to want (H14)", () => {
    expect(blendHeading([], 1.23)).toBe(1.23);
    expect(blendHeading([{ headingRad: 0.5, weight: 0 }], 1.23)).toBe(1.23);
  });

  it("returns the only desire when there is one", () => {
    expect(blendHeading([{ headingRad: 0.5, weight: 2 }], 0)).toBeCloseTo(0.5, 6);
  });

  it("lands between two desires, nearer the heavier one", () => {
    const out = blendHeading(
      [{ headingRad: 0, weight: 3 }, { headingRad: Math.PI / 2, weight: 1 }],
      0,
    );
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(Math.PI / 4);
  });

  it("averages across the +-pi seam without swinging the long way", () => {
    const out = blendHeading(
      [{ headingRad: 3.1, weight: 1 }, { headingRad: -3.1, weight: 1 }],
      0,
    );
    expect(Math.abs(out)).toBeGreaterThan(3.0);
  });
});

describe("wallDesire", () => {
  it("is silent in open floor", () => {
    expect(wallDesire({ x: 640, y: 360, angle: 0 }, arena, 150)).toBeUndefined();
  });

  it("pushes away from a wall the car is driving at", () => {
    const desire = wallDesire({ x: 1200, y: 360, angle: 0 }, arena, 150);
    expect(desire).toBeDefined();
    expect(Math.abs(desire!.headingRad)).toBeGreaterThan(Math.PI / 2);
  });

  it("sees less of the wall with a shorter look-ahead", () => {
    expect(wallDesire({ x: 1180, y: 360, angle: 0 }, arena, 40)).toBeUndefined();
    expect(wallDesire({ x: 1180, y: 360, angle: 0 }, arena, 150)).toBeDefined();
  });
});

describe("orbitDesire", () => {
  it("is silent at orbitBias 0", () => {
    expect(orbitDesire(0, 0, 1)).toBeUndefined();
  });

  it("aims across the target rather than at it", () => {
    const desire = orbitDesire(0, 0.75, 1);
    expect(desire).toBeDefined();
    expect(Math.abs(desire!.headingRad)).toBeCloseTo(Math.PI / 2, 2);
  });
});

describe("dodgeDesires", () => {
  it("carries one desire per active threat", () => {
    const out = dodgeDesires([
      { id: "a", ownerSessionId: "x", weaponId: "predator", noticedAtTick: 0,
        reactAtTick: 0, reacting: true, awayHeadingRad: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.headingRad).toBe(1);
    expect(out[0]!.weight).toBeGreaterThan(0);
  });
});

describe("reduceToIntent", () => {
  it("coasts inside the deadband", () => {
    const out = reduceToIntent({
      headingError: 0, distance: 300, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    expect(out.throttle).toBe(0);
  });

  it("drives forward when too far and reverses when too close", () => {
    const far = reduceToIntent({
      headingError: 0, distance: 600, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    const near = reduceToIntent({
      headingError: 0, distance: 100, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    expect(far.throttle).toBe(1);
    expect(near.throttle).toBe(-1);
  });

  it("does not steer inside the aim tolerance", () => {
    const out = reduceToIntent({
      headingError: 0.05, distance: 300, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    expect(out.steer).toBe(0);
  });

  it("steers toward a heading error outside the tolerance", () => {
    const left = reduceToIntent({
      headingError: 0.8, distance: 300, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    const right = reduceToIntent({
      headingError: -0.8, distance: 300, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: true,
    });
    expect(left.steer).toBe(1);
    expect(right.steer).toBe(-1);
  });

  it("drives forward regardless of range when the heading is a break-away", () => {
    const out = reduceToIntent({
      headingError: 0, distance: 100, preferredRange: 300, deadband: 40,
      aimToleranceRad: 0.1, closing: false,
    });
    expect(out.throttle).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/bot/brain/movement.test.ts` from `packages/server`
Expected: FAIL — `./movement.js` does not exist.

- [ ] **Step 3: Write `movement.ts`**

```ts
import { DRIVE_CONFIG } from "@motor-combat-moba/shared";
import type { BotArenaView } from "../types.js";
import type { KnownThreat } from "./perception.js";

/** One thing the bot would like to point at, and how much it cares. */
export interface Desire {
  headingRad: number;
  weight: number;
}

/** How hard dodging pulls relative to holding a range. Reactive, so it outweighs the plan. */
const DODGE_WEIGHT = 2.5;
/** How hard a wall pushes once it is inside the look-ahead. Above dodge: a wall does not miss. */
const WALL_WEIGHT = 3;

/**
 * Collapse the desires into one heading (H13).
 *
 * Summed as unit vectors so the +-pi seam cannot make two nearly-identical headings average to their
 * opposite. When nothing is wanted — every weight zero, or desires that cancel exactly — the
 * fallback is returned rather than an arbitrary angle (H14); a blend with no fallback dithers on the
 * tick everything cancels, which is this style's known failure mode.
 */
export function blendHeading(desires: readonly Desire[], fallbackHeading: number): number {
  let x = 0;
  let y = 0;
  for (const desire of desires) {
    if (desire.weight <= 0) continue;
    x += Math.cos(desire.headingRad) * desire.weight;
    y += Math.sin(desire.headingRad) * desire.weight;
  }
  if (Math.hypot(x, y) < 1e-6) return fallbackHeading;
  return Math.atan2(y, x);
}

/**
 * Push off a wall or obstacle the car would reach within `lookaheadUnits` (H39).
 *
 * `arena-01` has no obstacles, so on the shipped arena this is entirely about bounds and corners. A
 * short look-ahead is not a bug: an easy bot at 40 units and 320-450 u/s pins itself on walls, which
 * is free human-likeness.
 */
export function wallDesire(
  self: { x: number; y: number; angle: number },
  arena: BotArenaView,
  lookaheadUnits: number,
): Desire | undefined {
  const aheadX = self.x + Math.cos(self.angle) * lookaheadUnits;
  const aheadY = self.y + Math.sin(self.angle) * lookaheadUnits;
  const margin = Math.max(DRIVE_CONFIG.carWidth, DRIVE_CONFIG.carHeight) / 2;

  let pushX = 0;
  let pushY = 0;
  if (aheadX < margin) pushX += 1;
  if (aheadX > arena.width - margin) pushX -= 1;
  if (aheadY < margin) pushY += 1;
  if (aheadY > arena.height - margin) pushY -= 1;

  for (const box of arena.obstacles) {
    if (
      aheadX > box.x - margin && aheadX < box.x + box.w + margin &&
      aheadY > box.y - margin && aheadY < box.y + box.h + margin
    ) {
      pushX += self.x - (box.x + box.w / 2);
      pushY += self.y - (box.y + box.h / 2);
    }
  }

  if (pushX === 0 && pushY === 0) return undefined;
  return { headingRad: Math.atan2(pushY, pushX), weight: WALL_WEIGHT };
}

/** Circle the target instead of closing head-on (H13). `side` keeps the bot circling one way. */
export function orbitDesire(
  bearingToTarget: number,
  orbitBias: number,
  side: 1 | -1,
): Desire | undefined {
  if (orbitBias <= 0) return undefined;
  return { headingRad: bearingToTarget + (side * Math.PI) / 2, weight: orbitBias };
}

/** One desire per shot worth leaning off (H26) — never a stance, so it composes with fighting. */
export function dodgeDesires(threats: readonly KnownThreat[]): Desire[] {
  return threats.map((threat) => ({ headingRad: threat.awayHeadingRad, weight: DODGE_WEIGHT }));
}

/**
 * The ONE place a heading and a range become `steer` and `throttle` (H15).
 *
 * `closing` false means the blended heading is a break-away rather than an approach — disengaging or
 * dodging — so range no longer governs the throttle: the bot drives the heading it chose.
 */
export function reduceToIntent(args: {
  headingError: number;
  distance: number;
  preferredRange: number;
  deadband: number;
  aimToleranceRad: number;
  closing: boolean;
}): { steer: -1 | 0 | 1; throttle: -1 | 0 | 1 } {
  const { headingError, distance, preferredRange, deadband, aimToleranceRad, closing } = args;

  const steer: -1 | 0 | 1 =
    headingError > aimToleranceRad ? 1 : headingError < -aimToleranceRad ? -1 : 0;

  if (!closing) return { steer, throttle: 1 };

  const throttle: -1 | 0 | 1 =
    Math.abs(distance - preferredRange) <= deadband ? 0 : distance > preferredRange ? 1 : -1;

  return { steer, throttle };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/bot/brain/movement.test.ts` from `packages/server`
Expected: PASS.

- [ ] **Step 5: Wire movement into the controller**

Replace the steering half of `chase` with a blend. Add `private orbitSide: 1 | -1 = 1;` to the controller (rolled once in Task 7's personality pass; until then leave it 1).

```ts
    const bearingToTarget = Math.atan2(target.y - view.self.y, target.x - view.self.x);
    const aimHeading = Math.atan2(aimPoint.y - view.self.y, aimPoint.x - view.self.x)
      + this.aimError.offsetRad;

    const desires: Desire[] = [{ headingRad: aimHeading, weight: 1 }];
    const orbit = orbitDesire(bearingToTarget, this.profile.orbitBias, this.orbitSide);
    if (orbit) desires.push(orbit);
    const wall = wallDesire(view.self, view.arena, this.profile.wallLookaheadUnits);
    if (wall) desires.push(wall);
    desires.push(...dodgeDesires(activeThreats(this.perception, view.tick)));

    const heading = blendHeading(desires, view.self.angle);
    const delta = signedDelta(view.self.angle, heading);

    const { steer, throttle } = reduceToIntent({
      headingError: delta,
      distance,
      preferredRange: preferred,
      deadband: preferred * this.profile.deadbandFraction,
      aimToleranceRad: this.profile.aimToleranceRad,
      closing: true,
    });
```

Note the ordering trap: `chooseSlot` needs the aim delta **to the target**, not the blended heading — a bot leaning off a shot is still aiming at its target. Compute `const aimDelta = signedDelta(view.self.angle, aimHeading);` and pass *that* to `chooseSlot`, while `reduceToIntent` gets the blended `delta`.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck -w @motor-combat-moba/server
npm test
git add -A
git commit -m "feat(bot): steer by blending desires, so dodging composes with fighting

Context steering: aim, orbit, wall push and one desire per incoming shot are
blended into a heading, then a single reducer turns heading and range into
steer/throttle. Dodging is a desire, never a state, which is what stops the bot
having to choose between fighting and not being hit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Stances and target politics

**Files:**
- Create: `packages/server/src/bot/brain/stance.ts`
- Test: `packages/server/src/bot/brain/stance.test.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`

**Interfaces:**
- Consumes: `PerceptionState`, `ticksSinceBlame` from `./perception.js`; `BotProfile`; `StanceId`.
- Produces:
  - `interface StanceState { current: StanceId; sinceTick: number }`
  - `newStanceState(): StanceState`
  - `scoreTargets(args: { self: BotSelfView; candidates: readonly BotCarView[]; perception: PerceptionState; profile: BotProfile; tick: number; heldTargetId: string | undefined; heldSinceTick: number; rng: Rng }): { targetSessionId: string | undefined; scores: Map<string, number> }`
  - `scoreStances(args: { self: BotSelfView; target: BotCarView | undefined; distance: number; preferredRange: number; profile: BotProfile; tick: number; hasReadyContactWeapon: boolean; wantsRam: boolean; pinnedOnWall: boolean; rng: Rng }): Record<StanceId, number>`
  - `pickStance(state: StanceState, scores: Record<StanceId, number>, tick: number, profile: BotProfile, preempt: StanceId | undefined): StanceState`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/bot/brain/stance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSelfView } from "../types.js";
import { newPerception, type PerceptionState } from "./perception.js";
import { newStanceState, pickStance, scoreStances, scoreTargets } from "./stance.js";

const self: BotSelfView = {
  sessionId: "me", carId: "bullseye", team: 0, x: 0, y: 0, angle: 0, speed: 0,
  hp: 65, maxHp: 65, alive: true, statuses: [], slots: [],
  switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
};

function car(sessionId: string, over: Partial<BotCarView> = {}): BotCarView {
  return {
    sessionId, carId: "mirage", team: 0, x: 300, y: 0, angle: 0, speed: 0,
    hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
    ...over,
  };
}

function blaming(sessionId: string, tick: number): PerceptionState {
  const state = newPerception();
  state.blameTick.set(sessionId, tick);
  return state;
}

describe("scoreTargets", () => {
  const base = { self, perception: newPerception(), tick: 100, heldTargetId: undefined, heldSinceTick: 0 };

  it("skips dead and phased cars", () => {
    const out = scoreTargets({
      ...base,
      candidates: [car("dead", { alive: false }), car("ghost", { phased: true })],
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBeUndefined();
  });

  it("a high-woundedBias tier picks the wounded car (H32)", () => {
    const out = scoreTargets({
      ...base,
      candidates: [car("healthy", { x: 200 }), car("hurt", { x: 400, hp: 10 })],
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBe("hurt");
  });

  it("a vengeful tier chases whoever shot at it (H33)", () => {
    const out = scoreTargets({
      ...base,
      perception: blaming("shooter", 98),
      candidates: [car("quiet", { x: 150 }), car("shooter", { x: 480 })],
      profile: BOT_PROFILES.easy, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBe("shooter");
  });

  it("keeps the held target while the commitment window is open", () => {
    const out = scoreTargets({
      ...base,
      candidates: [car("held", { x: 450 }), car("closer", { x: 120 })],
      heldTargetId: "held", heldSinceTick: 95,
      profile: BOT_PROFILES.easy, rng: makeRng(1),
    });
    expect(out.targetSessionId).toBe("held");
  });
});

describe("scoreStances", () => {
  const base = {
    self, target: car("them"), distance: 300, preferredRange: 300, tick: 0,
    hasReadyContactWeapon: false, wantsRam: false, pinnedOnWall: false,
  };

  it("engages when healthy with a target", () => {
    const scores = scoreStances({ ...base, profile: BOT_PROFILES.hard, rng: makeRng(1) });
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]![0];
    expect(best).toBe("engage");
  });

  it("hunts when there is no target", () => {
    const scores = scoreStances({
      ...base, target: undefined, profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]![0];
    expect(best).toBe("hunt");
  });

  it("wants to brawl when a contact weapon is ready (H36)", () => {
    const scores = scoreStances({
      ...base, hasReadyContactWeapon: true, distance: 140,
      profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(scores.brawl).toBeGreaterThan(scores.engage);
  });

  it("wants to brawl when it has committed to a ram (H40)", () => {
    const scores = scoreStances({
      ...base, wantsRam: true, distance: 140, profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(scores.brawl).toBeGreaterThan(scores.engage);
  });

  it("does not brawl with no contact weapon and no ram intent", () => {
    const scores = scoreStances({ ...base, profile: BOT_PROFILES.hard, rng: makeRng(1) });
    expect(scores.brawl).toBeLessThan(scores.engage);
  });

  it("scores disengage above engage when badly hurt", () => {
    const scores = scoreStances({
      ...base, self: { ...self, hp: 10 }, profile: BOT_PROFILES.hard, rng: makeRng(1),
    });
    expect(scores.disengage).toBeGreaterThan(scores.engage);
  });

  it("never disengages at retreatHpFraction 0, however hurt (H37)", () => {
    const scores = scoreStances({
      ...base, self: { ...self, hp: 1 }, profile: BOT_PROFILES.easy, rng: makeRng(1),
    });
    expect(scores.disengage).toBeLessThan(scores.engage);
  });
});

describe("pickStance", () => {
  const scores = {
    engage: 1, brawl: 0, kite: 5, disengage: 0, reposition: 0, hunt: 0, recover: 0,
  } as const;

  it("holds the current stance inside the commitment window (H10)", () => {
    const state = { current: "engage" as const, sinceTick: 100 };
    const next = pickStance(state, { ...scores }, 105, BOT_PROFILES.hard, undefined);
    expect(next.current).toBe("engage");
  });

  it("rescores once the window has elapsed", () => {
    const state = { current: "engage" as const, sinceTick: 100 };
    const next = pickStance(state, { ...scores }, 130, BOT_PROFILES.hard, undefined);
    expect(next.current).toBe("kite");
  });

  it("a pre-emption cuts the window short (H10)", () => {
    const state = { current: "engage" as const, sinceTick: 100 };
    const next = pickStance(state, { ...scores }, 101, BOT_PROFILES.hard, "disengage");
    expect(next.current).toBe("disengage");
    expect(next.sinceTick).toBe(101);
  });

  it("starts from a defined stance", () => {
    expect(newStanceState().current).toBe("hunt");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/bot/brain/stance.test.ts` from `packages/server`
Expected: FAIL — `./stance.js` does not exist.

- [ ] **Step 3: Write `stance.ts`**

```ts
import { hasStatus } from "@motor-combat-moba/shared";
import type { BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotCarView, BotSelfView, StanceId } from "../types.js";
import { ticksSinceBlame, type PerceptionState } from "./perception.js";

export interface StanceState {
  current: StanceId;
  sinceTick: number;
}

/** A bot starts having seen nothing, so it starts hunting. */
export function newStanceState(): StanceState {
  return { current: "hunt", sinceTick: 0 };
}

const ALL_STANCES: readonly StanceId[] = [
  "engage", "brawl", "kite", "disengage", "reposition", "hunt", "recover",
];

/**
 * Who to shoot at (H32) — a weighted score, not nearest-first.
 *
 * Proximity, the wounded bias (Quake's EASY_FRAGGER), the grudge against whoever was last seen
 * shooting our way (VENGEFULNESS, which runs BACKWARDS up the ladder — a casual chases whoever hurt
 * them, a pro is not distracted), and a bonus for the target already held that decays across the
 * commitment window.
 *
 * Draws one random number per candidate, in `candidates` order, always.
 */
export function scoreTargets(args: {
  self: BotSelfView;
  candidates: readonly BotCarView[];
  perception: PerceptionState;
  profile: BotProfile;
  tick: number;
  heldTargetId: string | undefined;
  heldSinceTick: number;
  rng: Rng;
}): { targetSessionId: string | undefined; scores: Map<string, number> } {
  const { self, candidates, perception, profile, tick, rng } = args;
  const scores = new Map<string, number>();

  let best: string | undefined;
  let bestScore = -Infinity;

  for (const car of candidates) {
    const noise = (rng() - 0.5) * 2 * profile.scoreNoiseSigma;
    if (!car.alive || car.phased) continue;
    if (car.team === self.team && candidates.some((o) => o.team !== self.team)) continue;

    const distance = Math.hypot(car.x - self.x, car.y - self.y);
    const proximity = 1 - Math.min(distance / Math.max(profile.awarenessRadiusUnits, 1), 1);
    const wounded = car.maxHp > 0 ? 1 - car.hp / car.maxHp : 0;

    const sinceBlame = ticksSinceBlame(perception, car.sessionId, tick);
    const grudge = sinceBlame <= profile.targetCommitTicks
      ? 1 - sinceBlame / Math.max(profile.targetCommitTicks, 1)
      : 0;

    const heldFor = tick - args.heldSinceTick;
    const stickiness = car.sessionId === args.heldTargetId && heldFor < profile.targetCommitTicks
      ? 1 - heldFor / Math.max(profile.targetCommitTicks, 1)
      : 0;

    const score =
      proximity +
      wounded * profile.woundedBias * 2 +
      grudge * profile.vengefulness * 2 +
      stickiness * 1.5 +
      noise;

    scores.set(car.sessionId, score);
    if (score > bestScore) {
      bestScore = score;
      best = car.sessionId;
    }
  }

  return { targetSessionId: best, scores };
}

/**
 * Score every stance (H9). The winner is chosen by `pickStance`, which also holds it.
 *
 * Draws exactly one random number, always, for the score noise.
 */
export function scoreStances(args: {
  self: BotSelfView;
  target: BotCarView | undefined;
  distance: number;
  preferredRange: number;
  profile: BotProfile;
  tick: number;
  /** A ready `range: 0` weapon — a charge is worth walking into contact for (H36). */
  hasReadyContactWeapon: boolean;
  /** This bot has rolled and committed to a deliberate ram (H40). */
  wantsRam: boolean;
  pinnedOnWall: boolean;
  rng: Rng;
}): Record<StanceId, number> {
  const { self, target, distance, preferredRange, profile, tick, rng } = args;
  const noise = (rng() - 0.5) * 2 * profile.scoreNoiseSigma;

  const hpFraction = self.maxHp > 0 ? self.hp / self.maxHp : 1;
  const controlLost = !self.alive || hasStatus(self.statuses, "phased", tick);

  const scores: Record<StanceId, number> = {
    engage: 0, brawl: 0, kite: 0, disengage: 0, reposition: 0, hunt: 0, recover: 0,
  };

  if (controlLost) {
    scores.recover = 100;
    return scores;
  }
  if (!target) {
    scores.hunt = 10 + noise;
    return scores;
  }

  scores.engage = 5 + noise;

  // A ready charge is worth walking into contact for (H36) — what makes "Bastion is going for the
  // charge" legible from the outside — and so is a ram the bot has committed to (H40). Ram knockback
  // and the hard-slam stun are real mechanics no bot has ever used on purpose.
  scores.brawl = args.hasReadyContactWeapon || args.wantsRam
    ? 6 + (1 - Math.min(distance / Math.max(preferredRange, 1), 2)) * 2 + noise
    : -Infinity;

  // Too close for the range this kit wants.
  scores.kite = distance < preferredRange * 0.6 ? 6 + noise : 1 + noise;

  // `retreatHpFraction` 0 means this branch can never win, however hurt the bot is (H37): an easy
  // bot fights to zero, because self-preservation is a learned habit.
  scores.disengage = profile.retreatHpFraction > 0 && hpFraction < profile.retreatHpFraction
    ? 8 + (profile.retreatHpFraction - hpFraction) * 10 + noise
    : -Infinity;

  scores.reposition = args.pinnedOnWall ? 7 + noise : 0;

  return scores;
}

/**
 * Hold the current stance for `stanceCommitTicks`, then take the best (H10).
 *
 * `preempt` is the escape hatch, and there are exactly three of them: hp crossing the retreat
 * threshold, the target dying, and losing control. Dodging is NOT one — it is a steering desire
 * (H26), which is what lets the bot dodge without stopping fighting.
 */
export function pickStance(
  state: StanceState,
  scores: Record<StanceId, number>,
  tick: number,
  profile: BotProfile,
  preempt: StanceId | undefined,
): StanceState {
  if (preempt !== undefined) {
    return preempt === state.current ? state : { current: preempt, sinceTick: tick };
  }
  if (tick - state.sinceTick < profile.stanceCommitTicks) return state;

  let best: StanceId = state.current;
  let bestScore = -Infinity;
  for (const stance of ALL_STANCES) {
    const score = scores[stance];
    if (score > bestScore) {
      bestScore = score;
      best = stance;
    }
  }
  return best === state.current ? { ...state, sinceTick: tick } : { current: best, sinceTick: tick };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/bot/brain/stance.test.ts` from `packages/server`
Expected: PASS.

- [ ] **Step 5: Wire stances into the controller**

Add fields:

```ts
  private stance: StanceState = newStanceState();
  private heldSinceTick = 0;
  private wantsRam = false;
  private ramRolledForTargetId: string | undefined;
  // Carried out of `plan` for `debug()`, which runs after it.
  private lastStanceScores: Record<StanceId, number> | undefined;
  private lastPreferredRange = 0;
  private lastFiredSlot: number | undefined;
```

Imports this step adds: `{ blendHeading, dodgeDesires, orbitDesire, reduceToIntent, wallDesire, type Desire }` from `./movement.js`, `{ chooseSlot, preferredRangeOf, slotIsReady }` from `./firing.js`, `{ activeThreats, knownCars }` from `./perception.js`, `{ newStanceState, pickStance, scoreStances, scoreTargets, type StanceState }` from `./stance.js`, `{ BRAIN_CONSTANTS }` from `../../config/bot-profiles.js`, and `{ weaponDefOf }` from `@motor-combat-moba/shared`.

Replace `pickTarget`'s body with `scoreTargets`, keeping the `fixedTarget` short-circuit that both rooms rely on:

```ts
  private pickTarget(view: BotView): BotCarView | undefined {
    const candidates = knownCars(this.perception, view.tick);
    if (this.fixedTarget !== undefined) {
      // Both rooms name the bot's opponent. A fixed target the bot has NOT noticed yet is absent
      // here on purpose: that is the acquire delay doing its job, not a lookup failure.
      const fixed = candidates.find((o) => o.sessionId === this.fixedTarget);
      return fixed?.alive && !fixed.phased ? fixed : undefined;
    }
    const chosen = scoreTargets({
      self: view.self, candidates, perception: this.perception, profile: this.effectiveProfile,
      tick: view.tick, heldTargetId: this.target, heldSinceTick: this.heldSinceTick, rng: view.rng,
    });
    return candidates.find((c) => c.sessionId === chosen.targetSessionId);
  }
```

Replace `chase` wholesale. `decide` calls this instead, and the stance decides the desires:

```ts
  private plan(view: BotView, target: BotCarView | undefined): BotIntent {
    const profile = this.effectiveProfile;
    const self = view.self;
    const tick = view.tick;

    const preferred = preferredRangeOf(self, profile, this.slotWeights, tick);
    const distance = target ? Math.hypot(target.x - self.x, target.y - self.y) : Infinity;
    const wall = wallDesire(self, view.arena, profile.wallLookaheadUnits);
    const hasReadyContactWeapon = self.slots.some((s, i) => s.range === 0 && slotIsReady(s, tick));

    // The ram roll happens ONCE per target, not per tick: re-rolling every tick would ram
    // everything eventually, the same trap the dodge roll avoids (H25, H40).
    const ramRoll = view.rng();
    if (target && this.ramRolledForTargetId !== target.sessionId) {
      this.ramRolledForTargetId = target.sessionId;
      this.wantsRam = ramRoll < profile.ramIntentChance;
    }
    if (!target) this.wantsRam = false;

    const scores = scoreStances({
      self, target, distance, preferredRange: preferred, profile, tick,
      hasReadyContactWeapon, wantsRam: this.wantsRam,
      pinnedOnWall: wall !== undefined, rng: view.rng,
    });
    this.stance = pickStance(this.stance, scores, tick, profile, this.preemption(view, target));

    this.lastStanceScores = scores;
    this.lastPreferredRange = preferred;

    if (this.stance.current === "recover") return COAST;

    // Aim stays on the TARGET even while the body leans elsewhere: a human dodging is still
    // pointing their gun at you.
    const leadSlot = self.slots[0];
    const aimHeading = target
      ? Math.atan2(
          interceptPoint(
            self,
            { x: target.x, y: target.y, speed: target.speed, angle: target.angle },
            leadSlot ? weaponDefOf(leadSlot.weaponId).speed : 0,
            profile.leadFactor,
          ).y - self.y,
          interceptPoint(
            self,
            { x: target.x, y: target.y, speed: target.speed, angle: target.angle },
            leadSlot ? weaponDefOf(leadSlot.weaponId).speed : 0,
            profile.leadFactor,
          ).x - self.x,
        ) + this.aimError.offsetRad
      : self.angle;
    const aimDelta = signedDelta(self.angle, aimHeading);

    const centreHeading = Math.atan2(view.arena.height / 2 - self.y, view.arena.width / 2 - self.x);
    const bearing = target ? Math.atan2(target.y - self.y, target.x - self.x) : centreHeading;

    const desires: Desire[] = [];
    let range = preferred;
    let closing = true;
    let mayFire = target !== undefined;

    switch (this.stance.current) {
      case "engage":
        desires.push({ headingRad: aimHeading, weight: 1 });
        break;
      case "brawl":
        desires.push({ headingRad: bearing, weight: 1.5 });
        range = BRAIN_CONSTANTS.contactTriggerUnits;
        break;
      case "kite":
        desires.push({ headingRad: aimHeading, weight: 1 });
        range = preferred * 1.3;
        break;
      case "disengage":
        // Kites rather than flees (H38): still facing, still able to shoot, backing away. Turning
        // tail is a blunder outcome, not a plan.
        desires.push({ headingRad: aimHeading, weight: 1 });
        range = profile.awarenessRadiusUnits;
        break;
      case "reposition":
        desires.push({ headingRad: centreHeading, weight: 1 });
        closing = false;
        mayFire = false;
        break;
      case "hunt":
        desires.push({ headingRad: centreHeading, weight: 1 });
        closing = false;
        mayFire = false;
        break;
      case "recover":
        return COAST;
    }

    const orbit = this.stance.current === "engage" || this.stance.current === "kite"
      ? orbitDesire(bearing, profile.orbitBias, this.orbitSide)
      : undefined;
    if (orbit) desires.push(orbit);
    if (wall) desires.push(wall);
    desires.push(...dodgeDesires(activeThreats(this.perception, tick)));

    const heading = blendHeading(desires, self.angle);
    const { steer, throttle } = reduceToIntent({
      headingError: signedDelta(self.angle, heading),
      distance: Number.isFinite(distance) ? distance : range,
      preferredRange: range,
      deadband: range * profile.deadbandFraction,
      aimToleranceRad: profile.aimToleranceRad,
      closing,
    });

    // `chooseSlot` draws whether or not it may fire, so the stream does not depend on the stance.
    const decision = chooseSlot({
      self, target: target ?? ABSENT_TARGET, distance, aimDelta, profile,
      weights: this.slotWeights, tick, lastPressTick: this.lastPressTick, rng: view.rng,
    });
    const slot = mayFire ? decision.slot : undefined;
    if (slot !== undefined) this.lastPressTick = tick;
    this.lastFiredSlot = slot;

    return { steer, throttle, fireSlots: slot === undefined ? 0 : 1 << slot };
  }

  /**
   * The three cases a stance may be cut short for (H10). Dodging is NOT one of them — it is a
   * steering desire, which is what lets the bot dodge without stopping fighting (H26).
   */
  private preemption(view: BotView, target: BotCarView | undefined): StanceId | undefined {
    const profile = this.effectiveProfile;
    const self = view.self;
    if (!self.alive) return "recover";
    const hpFraction = self.maxHp > 0 ? self.hp / self.maxHp : 1;
    if (profile.retreatHpFraction > 0 && hpFraction < profile.retreatHpFraction) return "disengage";
    if (!target && this.stance.current !== "hunt") return "hunt";
    return undefined;
  }
```

Add the module-level stand-in `chooseSlot` needs when there is no target, so the draw still happens:

```ts
/** A target-shaped nothing, so `chooseSlot` can draw on a targetless tick without firing (H21). */
const ABSENT_TARGET: BotCarView = {
  sessionId: "", carId: "bullseye", team: 0, x: 0, y: 0, angle: 0, speed: 0,
  hp: 1, maxHp: 1, alive: false, phased: true, statuses: [], maneuver: 0,
};
```

Track `heldSinceTick` in `decide` where the target is assigned:

```ts
    const target = this.pickTarget(view);
    if (target?.sessionId !== this.target) this.heldSinceTick = view.tick;
    this.target = target?.sessionId;
```

Fill `stance`, `stanceScores`, `preferredRange` and `firedSlot` into `lastDebug` from the fields `plan` stored.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck -w @motor-combat-moba/server
npm test
git add -A
git commit -m "feat(bot): choose a stance and a target by score, and hold both

Seven named stances scored with a commitment window and three pre-emptions, and
target choice by proximity + wounded bias + grudge + stickiness. Vengefulness
runs backwards up the ladder on purpose: a casual chases whoever hurt them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Humanization and personality

**Files:**
- Create: `packages/server/src/bot/brain/humanize.ts`, `packages/server/src/bot/brain/personality.ts`
- Test: `packages/server/src/bot/brain/humanize.test.ts`, `packages/server/src/bot/brain/personality.test.ts`
- Modify: `packages/server/src/bot/brain/controller.ts`

**Interfaces:**
- Produces:
  - `type BlunderKind = "oversteer" | "wrong-way" | "hold-fire" | "panic-reverse"`
  - `interface HumanizeState { delayLine: BotIntent[]; blunderUntilTick: number; blunderKind: BlunderKind | undefined }`
  - `newHumanizeState(): HumanizeState`
  - `applyHumanize(state: HumanizeState, intent: BotIntent, tick: number, profile: BotProfile, rng: Rng, idle: boolean): BotIntent`
  - `rollPersonality(rng: Rng, tier: BotDifficulty): { personality: BotPersonality; profile: BotProfile }`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/bot/brain/humanize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import type { BotIntent } from "../types.js";
import { applyHumanize, newHumanizeState } from "./humanize.js";

const drive: BotIntent = { steer: 1, throttle: 1, fireSlots: 1 };

describe("applyHumanize", () => {
  it("coasts until the delay line has filled", () => {
    const state = newHumanizeState();
    const rng = makeRng(1);
    const profile = BOT_PROFILES.hard; // reactionDelayTicks 4
    const out = [];
    for (let tick = 0; tick < 4; tick++) {
      out.push(applyHumanize(state, drive, tick, profile, rng, false));
    }
    expect(out.every((i) => i.steer === 0 && i.throttle === 0)).toBe(true);
  });

  it("emits the intent decided reactionDelayTicks ago", () => {
    const state = newHumanizeState();
    const rng = makeRng(1);
    const profile = { ...BOT_PROFILES.hard, blunderChance: 0, idleFidgetChance: 0 };
    for (let tick = 0; tick < 4; tick++) {
      applyHumanize(state, drive, tick, profile, rng, false);
    }
    const out = applyHumanize(state, { steer: -1, throttle: -1, fireSlots: 0 }, 4, profile, rng, false);
    expect(out).toEqual(drive);
  });

  it("never blunders at blunderChance 0", () => {
    const state = newHumanizeState();
    const rng = makeRng(7);
    const profile = { ...BOT_PROFILES.hard, blunderChance: 0, idleFidgetChance: 0, reactionDelayTicks: 0 };
    for (let tick = 0; tick < 200; tick++) {
      expect(applyHumanize(state, drive, tick, profile, rng, false)).toEqual(drive);
    }
  });

  it("blunders sometimes at a high blunder chance, and commits for a window", () => {
    const state = newHumanizeState();
    const rng = makeRng(7);
    const profile = { ...BOT_PROFILES.easy, blunderChance: 1, blunderTicks: 10, idleFidgetChance: 0, reactionDelayTicks: 0 };
    const first = applyHumanize(state, drive, 0, profile, rng, false);
    expect(first).not.toEqual(drive);
    expect(state.blunderUntilTick).toBe(10);
  });

  it("fidgets only when idle", () => {
    const state = newHumanizeState();
    const rng = makeRng(9);
    const profile = { ...BOT_PROFILES.easy, blunderChance: 0, idleFidgetChance: 1, reactionDelayTicks: 0 };
    const still: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };
    expect(applyHumanize(state, still, 0, profile, rng, true).steer).not.toBe(0);
    expect(applyHumanize(state, still, 1, profile, rng, false).steer).toBe(0);
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const state = newHumanizeState();
      const rng = makeRng(4);
      const out = [];
      for (let tick = 0; tick < 60; tick++) {
        out.push(applyHumanize(state, drive, tick, BOT_PROFILES.easy, rng, tick % 3 === 0));
      }
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
  });
});
```

Create `packages/server/src/bot/brain/personality.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOT_PROFILES, BRAIN_CONSTANTS } from "../../config/bot-profiles.js";
import { makeRng } from "../rng.js";
import { rollPersonality } from "./personality.js";

describe("rollPersonality", () => {
  it("is deterministic for a seed", () => {
    expect(rollPersonality(makeRng(3), "hard").personality.id)
      .toBe(rollPersonality(makeRng(3), "hard").personality.id);
  });

  it("produces different archetypes across seeds", () => {
    const ids = new Set<string>();
    for (let seed = 0; seed < 60; seed++) ids.add(rollPersonality(makeRng(seed), "medium").personality.id);
    expect(ids.size).toBeGreaterThan(1);
  });

  it("never leaves the tier band (H47)", () => {
    const jitter = BRAIN_CONSTANTS.personalityJitter;
    for (let seed = 0; seed < 100; seed++) {
      const { profile } = rollPersonality(makeRng(seed), "hard");
      const base = BOT_PROFILES.hard;
      for (const key of ["standoffFraction", "orbitBias", "ramIntentChance", "vengefulness"] as const) {
        const low = base[key] * (1 - jitter);
        const high = base[key] * (1 + jitter);
        expect(profile[key]).toBeGreaterThanOrEqual(Math.min(low, high) - 1e-9);
        expect(profile[key]).toBeLessThanOrEqual(Math.max(low, high) + 1e-9);
      }
    }
  });

  it("never lets a hard bot become as undisciplined as a medium one (H47)", () => {
    for (let seed = 0; seed < 100; seed++) {
      const { profile } = rollPersonality(makeRng(seed), "hard");
      expect(profile.ultDisciplineChance).toBeGreaterThanOrEqual(BOT_PROFILES.medium.ultDisciplineChance);
    }
  });

  it("rolls one slot weight per possible slot", () => {
    const { personality } = rollPersonality(makeRng(1), "easy");
    expect(personality.slotWeights).toHaveLength(3);
    for (const weight of personality.slotWeights) {
      expect(weight).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/bot/brain/humanize.test.ts src/bot/brain/personality.test.ts` from `packages/server`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Write `humanize.ts`**

```ts
import type { BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotIntent } from "../types.js";

const COAST: BotIntent = { steer: 0, throttle: 0, fireSlots: 0 };

export type BlunderKind = "oversteer" | "wrong-way" | "hold-fire" | "panic-reverse";

const BLUNDERS: readonly BlunderKind[] = ["oversteer", "wrong-way", "hold-fire", "panic-reverse"];

/**
 * The last layer (H7): everything that makes a correct decision come out human.
 *
 * Runs EVERY tick, never on the recompute cadence — a delay line that only shifts when the bot
 * re-decides delays by a multiple of the cadence rather than by its own value (H6).
 */
export interface HumanizeState {
  delayLine: BotIntent[];
  blunderUntilTick: number;
  blunderKind: BlunderKind | undefined;
}

export function newHumanizeState(): HumanizeState {
  return { delayLine: [], blunderUntilTick: 0, blunderKind: undefined };
}

/**
 * Apply reaction delay, blunders and idle fidget.
 *
 * Draws exactly three random numbers, always, in this order: the blunder roll, the blunder kind, and
 * the fidget roll (H21).
 */
export function applyHumanize(
  state: HumanizeState,
  intent: BotIntent,
  tick: number,
  profile: BotProfile,
  rng: Rng,
  idle: boolean,
): BotIntent {
  const blunderRoll = rng();
  const kindRoll = rng();
  const fidgetRoll = rng();

  if (tick >= state.blunderUntilTick) {
    state.blunderKind = undefined;
    if (blunderRoll < profile.blunderChance) {
      state.blunderKind = BLUNDERS[Math.floor(kindRoll * BLUNDERS.length)] ?? "oversteer";
      state.blunderUntilTick = tick + profile.blunderTicks;
    }
  }

  let out = intent;
  if (state.blunderKind !== undefined) out = applyBlunder(out, state.blunderKind);
  if (idle && fidgetRoll < profile.idleFidgetChance) {
    out = { ...out, steer: kindRoll < 0.5 ? 1 : -1 };
  }

  return delay(state, out, profile.reactionDelayTicks);
}

/**
 * A mistake committed to for a window, not a per-tick coin flip (H41): a flip reads as a stutter,
 * a committed wrong action reads as a person who has misjudged something.
 */
function applyBlunder(intent: BotIntent, kind: BlunderKind): BotIntent {
  switch (kind) {
    case "oversteer":
      return { ...intent, steer: intent.steer === 0 ? 1 : intent.steer };
    case "wrong-way":
      return { ...intent, steer: (intent.steer * -1) as -1 | 0 | 1 };
    case "hold-fire":
      return { ...intent, fireSlots: 0 };
    case "panic-reverse":
      return { ...intent, throttle: -1 };
  }
}

/**
 * The gap between deciding and the hands moving (B19).
 *
 * Below `delay` calls since construction, the reaction to anything seen so far has not arrived yet —
 * the same as a human's first instant in a match — so this coasts rather than acting on a decision
 * it has not felt.
 */
function delay(state: HumanizeState, intent: BotIntent, delayTicks: number): BotIntent {
  if (delayTicks <= 0) return intent;
  state.delayLine.push(intent);
  if (state.delayLine.length > delayTicks) return state.delayLine.shift()!;
  return COAST;
}
```

- [ ] **Step 4: Write `personality.ts`**

```ts
import { WEAPON_SLOT_CONFIG, type BotDifficulty } from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotPersonality, PersonalityId } from "../types.js";

/** Which parameters an archetype may shift, and by how much (H47). 1 leaves a value alone. */
type Shifts = Partial<Record<keyof BotProfile, number>>;

const ARCHETYPES: Readonly<Record<PersonalityId, Shifts>> = Object.freeze({
  brawler: { standoffFraction: 0.8, ramIntentChance: 1.25, retreatHpFraction: 0.8, orbitBias: 0.8 },
  kiter: { standoffFraction: 1.25, orbitBias: 1.25, retreatHpFraction: 1.25, ramIntentChance: 0.8 },
  sprayer: { fireDisciplineChance: 0.8, burstGapTicks: 0.8, ultDisciplineChance: 0.8 },
  grudge: { vengefulness: 1.25, targetCommitTicks: 1.25, woundedBias: 0.8 },
  opportunist: { woundedBias: 1.25, ultDisciplineChance: 1.25, standoffFraction: 1 },
});

const IDS = Object.keys(ARCHETYPES) as PersonalityId[];

/** The tier one rung easier, whose values a personality may never reach past (H47). */
const EASIER: Readonly<Record<BotDifficulty, BotDifficulty | undefined>> = Object.freeze({
  easy: undefined,
  medium: "easy",
  hard: "medium",
});

/**
 * Roll this bot's personality (H47).
 *
 * A tier sets the competence band; a personality moves parameters WITHIN it. The clamp is what keeps
 * that promise: `personalityJitter` around the tier value, and never past the easier neighbouring
 * tier's value on the same parameter. A hard `sprayer` is still recognisably a good player.
 *
 * Draws `1 + maxWeaponSlots` random numbers, always: the archetype, then one weight per slot.
 */
export function rollPersonality(
  rng: Rng,
  tier: BotDifficulty,
): { personality: BotPersonality; profile: BotProfile } {
  const pick = rng();
  const weights: number[] = [];
  for (let i = 0; i < WEAPON_SLOT_CONFIG.maxWeaponSlots; i++) {
    // 0.5x to 1.5x: a real preference, but never a weapon the bot refuses to touch.
    weights.push(0.5 + rng());
  }

  const id = IDS[Math.min(Math.floor(pick * IDS.length), IDS.length - 1)]!;
  const shifts = ARCHETYPES[id];
  const base = BOT_PROFILES[tier];
  const easier = EASIER[tier];

  const profile = { ...base } as Record<keyof BotProfile, number>;
  for (const [key, factor] of Object.entries(shifts) as [keyof BotProfile, number][]) {
    profile[key] = clampToBand(base[key], base[key] * factor, easier ? BOT_PROFILES[easier][key] : undefined);
  }

  return {
    personality: { id, slotWeights: weights },
    profile: Object.freeze(profile) as unknown as BotProfile,
  };
}

/**
 * Keep a shifted value inside `personalityJitter` of the tier value, and on the tier's own side of
 * the easier neighbour. `neighbour` may sit either side of `base` — `vengefulness` runs backwards up
 * the ladder (H33) — so the bound is applied as "no further from `base` than `neighbour` is", not as
 * a naive min or max.
 */
function clampToBand(base: number, shifted: number, neighbour: number | undefined): number {
  const jitter = BRAIN_CONSTANTS.personalityJitter;
  const low = Math.min(base * (1 - jitter), base * (1 + jitter));
  const high = Math.max(base * (1 - jitter), base * (1 + jitter));
  let out = Math.min(Math.max(shifted, low), high);
  if (neighbour !== undefined) {
    // Never past the easier tier's value: a hard bot may drift toward medium but never reach it.
    if (neighbour > base) out = Math.min(out, neighbour);
    else if (neighbour < base) out = Math.max(out, neighbour);
  }
  return out;
}
```

- [ ] **Step 5: Run both tests**

Run: `npx vitest run src/bot/brain/humanize.test.ts src/bot/brain/personality.test.ts` from `packages/server`
Expected: PASS.

- [ ] **Step 6: Wire both into the controller**

- Add `private humanize = newHumanizeState();`, `private personality: BotPersonality | undefined;`
- At the top of `decide`, before any other draw, roll the personality lazily (H20):

```ts
    if (!this.personality) {
      const rolled = rollPersonality(view.rng, this.profileId);
      this.personality = rolled.personality;
      this.effectiveProfile = rolled.profile;
      this.slotWeights = rolled.personality.slotWeights;
      this.orbitSide = rolled.personality.slotWeights[0]! > 1 ? 1 : -1;
    }
```

Add `private effectiveProfile: BotProfile` initialised to `this.profile` in the constructor, and use `this.effectiveProfile` **everywhere** the brain currently reads `this.profile`. Leave `this.profile` as the un-personalised tier row so `debug()` can show both.

- Replace the `return this.held;` at the end of `decide` with:

```ts
    const idle = this.target === undefined;
    return applyHumanize(
      this.humanize, this.held, view.tick, this.effectiveProfile, view.rng, idle,
    );
```

- Set `personality: this.personality.id` on the debug object.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck -w @motor-combat-moba/server
npm test
git add -A
git commit -m "feat(bot): add reaction delay, blunders, fidget and personalities

The humanize layer is the only place tier error lives: a delay line, blunders
committed for a window rather than flipped per tick, and idle fidget. Each bot
also rolls one of five archetypes, clamped so a personality can never leave its
tier's band.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Host wiring — the view ring and the fired sink

**Files:**
- Modify: `packages/server/src/rooms/PracticeRoom.ts`, `packages/server/src/rooms/PlaygroundRoom.ts`, `packages/server/balance/match.ts`
- Test: `packages/server/src/rooms/practice-room.test.ts` (extend)

**Interfaces:**
- Consumes: `ViewRing`, `snapshotWorld` from `../bot/index.js`; `newCombatEvents`, `type CombatEvents` from shared.
- Produces: `botRingCapacity(): number` from `packages/server/src/bot/view-ring.ts`, re-exported through `bot/index.ts`. Every host sizes its ring from this one function rather than each computing the same maximum.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/bot/ring-capacity.test.ts` — a host-free assertion, so it does not depend on any room test's private harness:

```ts
import { describe, expect, it } from "vitest";
import { BOT_PROFILES } from "../config/bot-profiles.js";
import { botRingCapacity } from "./view-ring.js";

describe("botRingCapacity", () => {
  it("covers the deepest staleness any tier asks for, plus one", () => {
    const deepest = Math.max(...Object.values(BOT_PROFILES).map((p) => p.viewStalenessTicks));
    expect(botRingCapacity()).toBe(deepest + 1);
  });

  it("is at least 2, so a ring is never degenerate", () => {
    expect(botRingCapacity()).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then add the helper**

Run: `npx vitest run src/bot/ring-capacity.test.ts` from `packages/server`
Expected: FAIL — `botRingCapacity` is not exported.

Add to `packages/server/src/bot/view-ring.ts`:

```ts
import { BOT_PROFILES } from "../config/bot-profiles.js";

/**
 * How deep a host's ring must be (H48): the deepest `viewStalenessTicks` on the table, plus the
 * current tick. One function so three hosts cannot drift to three different answers, and so a tier
 * retune that deepens staleness cannot leave a ring too shallow to serve it.
 */
export function botRingCapacity(): number {
  return Math.max(...Object.values(BOT_PROFILES).map((p) => p.viewStalenessTicks)) + 1;
}
```

Re-run: PASS.

- [ ] **Step 3: Wire `PracticeRoom`**

```ts
  private readonly botEvents: CombatEvents = newCombatEvents();
  private readonly botRing = new ViewRing(botRingCapacity());
  private previousTickFires: readonly FiredEvent[] = [];
```

In `ctx()`, add `events: this.botEvents,`.

In the tick, **before** `enqueueBotInput`, push the snapshot:

```ts
    this.botRing.push(snapshotWorld(this.state, this.combat));
```

In `enqueueBotInput`, pass the ring, the staleness and the observed fires:

```ts
    const view = buildBotView({
      state: this.state,
      selfSessionId: BOT_SESSION_ID,
      combat: this.combat,
      rng: this.botRng,
      observedFires: this.previousTickFires,
      stalenessTicks: BOT_PROFILES[this.difficulty].viewStalenessTicks,
      ring: this.botRing,
    });
```

After `runPipeline`, take this tick's fires and **drain the bag** so a long match does not accumulate every event it has ever produced:

```ts
    this.previousTickFires = this.botEvents.fired.slice();
    this.botEvents.fired.length = 0;
    this.botEvents.damaged.length = 0;
    this.botEvents.killed.length = 0;
```

- [ ] **Step 4: Wire `PlaygroundRoom` the same way**

Identical changes, with the difficulty read from `this.state.botDifficulty` through `isBotDifficulty` exactly as the existing code does.

- [ ] **Step 5: Wire the harness ring**

`balance/match.ts` already keeps per-seat RNG streams and already feeds `observedFires` through `previousTickFires` and `firedCursor` — leave both alone. Add only the ring:

```ts
  const ring = new ViewRing(botRingCapacity());
```

Push once per tick before the seat loop, and pass `ring` plus `stalenessTicks: BOT_PROFILES[setup.difficulty].viewStalenessTicks` into each `buildBotView` call.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck -w @motor-combat-moba/server
npm test
git add -A
git commit -m "feat(bot): give every host a view ring and the rooms a fired sink

viewStalenessTicks is non-zero on all three tiers now, so the ring the balance
harness spec built has to actually run. Rooms also pass a CombatEvents bag and
drain it each tick, which is what makes observedFires -- and therefore ult
memory and vengefulness -- non-empty outside the harness.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Characterisation and ladder tests

The tests that keep the tiers from collapsing back into each other under a future tuning pass.

**Files:**
- Create: `packages/server/src/bot/brain/tiers.test.ts`

**Interfaces:** consumes everything built so far; produces no exports.

- [ ] **Step 1: Write the characterisation tests**

Create `packages/server/src/bot/brain/tiers.test.ts`. Build views with the same helpers Task 1's controller test uses (copy them into a small local factory rather than exporting test helpers across files).

```ts
import { describe, expect, it } from "vitest";
import { slotsOf, weaponDefOf } from "@motor-combat-moba/shared";
import { makeRng } from "../rng.js";
import type { BotCarView, BotSlotView, BotView } from "../types.js";
import { HumanController } from "./controller.js";

function slotsFor(carId: "bullseye" | "bastion" | "mirage"): BotSlotView[] {
  return slotsOf(carId).map((weaponId) => ({
    weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
    range: weaponDefOf(weaponId).range,
  }));
}

function view(tick: number, over: Partial<BotView> = {}): BotView {
  return {
    tick,
    self: {
      sessionId: "me", carId: "bullseye", team: 0, x: 200, y: 360, angle: 0, speed: 200,
      hp: 65, maxHp: 65, alive: true, statuses: [], slots: slotsFor("bullseye"),
      switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
    },
    others: [], instances: [], arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [], rng: makeRng(17),
    ...over,
  };
}

const enemy: BotCarView = {
  sessionId: "them", carId: "mirage", team: 0, x: 700, y: 360, angle: Math.PI, speed: 400,
  hp: 70, maxHp: 70, alive: true, phased: false, statuses: [], maneuver: 0,
};

/** Run a bot for `ticks` against a fixed scene and return every intent it produced. */
function run(tier: "easy" | "medium" | "hard", ticks: number, over: Partial<BotView>) {
  const bot = new HumanController(tier);
  const out = [];
  for (let tick = 0; tick < ticks; tick++) out.push(bot.decide(view(tick, over)));
  return { bot, out };
}

describe("tier characterisation", () => {
  it("hard reacts to an incoming shot and easy does not (H25)", () => {
    const incoming = [{
      id: "shot", ownerSessionId: "them", weaponId: "predator" as const,
      x: 600, y: 360, angle: Math.PI,
    }];
    const scene = { others: [enemy], instances: incoming };
    const hard = run("hard", 60, scene).out;
    const easy = run("easy", 60, scene).out;
    const turns = (intents: { steer: number }[]) => intents.filter((i) => i.steer !== 0).length;
    expect(turns(hard)).toBeGreaterThan(turns(easy));
  });

  it("easy burns its ult on a full-hp target and hard does not (H30)", () => {
    const scene = { others: [{ ...enemy, x: 900 }] };
    const ultPressed = (tier: "easy" | "hard") =>
      run(tier, 200, scene).out.some((i) => i.fireSlots === 1 << 2);
    expect(ultPressed("easy")).toBe(true);
    expect(ultPressed("hard")).toBe(false);
  });

  it("hard disengages when badly hurt and easy fights on (H37)", () => {
    const hurt = (tier: "easy" | "hard") => {
      const bot = new HumanController(tier);
      for (let tick = 0; tick < 90; tick++) {
        bot.decide(view(tick, {
          others: [enemy],
          self: { ...view(tick).self, hp: 5 },
        }));
      }
      return bot.debug()?.stance;
    };
    expect(hurt("hard")).toBe("disengage");
    expect(hurt("easy")).not.toBe("disengage");
  });

  it("hard focuses the wounded car and easy chases whoever shot at it (H32, H33)", () => {
    const wounded = { ...enemy, sessionId: "hurt", x: 900, y: 360, hp: 8 };
    const shooter = { ...enemy, sessionId: "shooter", x: 420, y: 360 };
    const scene = {
      others: [wounded, shooter],
      instances: [{
        id: "s", ownerSessionId: "shooter", weaponId: "predator" as const,
        x: 400, y: 360, angle: Math.PI,
      }],
    };
    expect(run("hard", 120, scene).bot.currentTargetSessionId).toBe("hurt");
    expect(run("easy", 200, scene).bot.currentTargetSessionId).toBe("shooter");
  });

  it("a full kit does not press the same slot forever (H27)", () => {
    const scene = { others: [{ ...enemy, x: 500 }] };
    const pressed = new Set(
      run("hard", 400, scene).out.filter((i) => i.fireSlots !== 0).map((i) => i.fireSlots),
    );
    expect(pressed.size).toBeGreaterThan(1);
  });

  it("hard stays further off a wall than easy over the same approach (H39)", () => {
    const nearWall = (tier: "easy" | "hard") => {
      const bot = new HumanController(tier);
      let steersAway = 0;
      for (let tick = 0; tick < 90; tick++) {
        const intent = bot.decide(view(tick, {
          others: [enemy],
          self: { ...view(tick).self, x: 1200, y: 360, angle: 0 },
        }));
        if (intent.steer !== 0) steersAway++;
      }
      return steersAway;
    };
    expect(nearWall("hard")).toBeGreaterThan(nearWall("easy"));
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run src/bot/brain/tiers.test.ts` from `packages/server`
Expected: several failures on the first pass. **This is the tuning gate.** For each failure, decide whether the *test* states the spec's intent badly or the *tier values* fail to deliver it, and fix whichever is actually wrong. Do not weaken an assertion to make it pass without saying so in the commit message.

- [ ] **Step 3: Add the ladder-monotonicity test**

Append to the same file:

```ts
describe("ladder monotonicity", () => {
  it("presses more shots at a good angle as the tier rises", () => {
    const scene = { others: [enemy] };
    const shots = (tier: "easy" | "medium" | "hard") =>
      run(tier, 600, scene).out.filter((i) => i.fireSlots !== 0).length;
    expect(shots("hard")).toBeGreaterThan(shots("medium"));
    expect(shots("medium")).toBeGreaterThan(shots("easy"));
  });
});
```

If this proves flaky across seeds, average it over five seeds by threading a `seed` argument into `view`'s `rng`. Do not delete it — it is the only cheap guard that the ladder still points the right way.

- [ ] **Step 4: Verify and commit**

```bash
npm test
git add -A
git commit -m "test(bot): pin the behavioural differences between tiers

Characterisation over numbers: hard dodges and easy does not, easy burns its
ult and hard saves it, hard disengages and easy fights to zero, hard focuses
the wounded and easy chases whoever shot it, and no tier presses one slot
forever. These are what a future tuning pass would otherwise erode silently.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Fingerprint the brain version, and correct the harness README

**Files:**
- Modify: `packages/server/balance/fingerprint.ts`, `packages/server/balance/fingerprint.test.ts`, `packages/server/balance/README.md`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/balance/fingerprint.test.ts`:

```ts
it("covers the brain version, not just the profile table (H46)", async () => {
  const profiles = await import("../src/config/bot-profiles.js");
  expect(botFingerprint()).toContain(""); // sanity: it returns a string
  // A hash of the table alone cannot see a code-only behaviour change, so the version must be in it.
  expect(JSON.stringify({ BOT_BRAIN_VERSION: profiles.BOT_BRAIN_VERSION })).toBeTruthy();
  const before = botFingerprint();
  expect(before).toBe(botFingerprint()); // stable across calls
});
```

Then assert the real property by extracting the hashed payload into an exported helper:

```ts
// in fingerprint.ts
export function botFingerprintInput(): unknown {
  return { BOT_PROFILES, BOT_BRAIN_VERSION };
}
export function botFingerprint(): string {
  return fnv1aHex(stableStringify(botFingerprintInput()));
}
```

```ts
// in fingerprint.test.ts
it("includes BOT_BRAIN_VERSION in what it hashes (H46)", () => {
  expect(botFingerprintInput()).toHaveProperty("BOT_BRAIN_VERSION");
});
```

- [ ] **Step 2: Run it, watch it fail, implement, run it again**

Run: `npx vitest run balance/fingerprint.test.ts` from `packages/server`
Expected: FAIL, then PASS after the `fingerprint.ts` edit above.

- [ ] **Step 3: Correct the README**

In `packages/server/balance/README.md`, replace the pilot caveat. The old text says the pilot is a fixed-standoff 1v1 chaser that cannot press `wildcharge`. Both statements are now wrong. Write:

> **The pilot is a tiered human-like bot** (`docs/superpowers/specs/2026-09-04-human-like-bot-behavior-design.md`). It perceives with a tier-scaled latency and attention limit, chooses a stance, dodges, holds a range derived from its own kit, and presses ONE slot per tick. Which tier flew the matches is part of the bot fingerprint, and so is `BOT_BRAIN_VERSION` — a report from before a brain change is not comparable to one after, and `--baseline` refuses the comparison rather than trusting a reader to remember.
>
> **Reports produced before 2026-09-04 measured a different pilot in a way worth naming.** The old bot ORed every in-range slot into one fire mask, and `beginFire` takes the lowest usable bit — so it pressed slot 0 almost exclusively. Any historical conclusion about a slot-1 or slot-2 weapon being weak is suspect for that reason alone.

- [ ] **Step 4: Verify and commit**

```bash
npm test
git add -A
git commit -m "feat(balance): fingerprint the brain version and correct the pilot caveat

A hash of BOT_PROFILES cannot see a behaviour change made in code with the
numbers untouched, so BOT_BRAIN_VERSION goes into botFingerprint (H46). The
README's pilot description and its slot-0 bias are both recorded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The playground debug overlay

Makes "why did it do that?" answerable in the tool that exists for watching one bot (H12). Dev-only — `PlaygroundRoom` is `DEV_TOOLS`-gated and never in a release build.

**Files:**
- Modify: `packages/shared/src/net/playground-messages.ts`
- Modify: `packages/server/src/rooms/PlaygroundRoom.ts`
- Modify: `packages/client/src/dev/playground/overlay.ts`
- Test: `packages/shared/src/net/playground-messages.test.ts`

- [ ] **Step 1: Write the failing shared test**

Add to `packages/shared/src/net/playground-messages.test.ts`:

```ts
describe("isBotDebugPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(isBotDebugPayload({
      tick: 10, stance: "engage", targetSessionId: "them",
      preferredRange: 300, personality: "kiter", firedSlot: 1,
    })).toBe(true);
  });

  it("rejects a payload with an unknown stance", () => {
    expect(isBotDebugPayload({
      tick: 10, stance: "vibing", targetSessionId: "them",
      preferredRange: 300, personality: "kiter", firedSlot: 1,
    })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isBotDebugPayload(null)).toBe(false);
    expect(isBotDebugPayload("engage")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run src/net/playground-messages.test.ts` from `packages/shared`
Expected: FAIL — `isBotDebugPayload` is not exported.

- [ ] **Step 3: Add the message type to shared**

In `packages/shared/src/net/playground-messages.ts`:

```ts
/** Dev-only: what the bot was thinking, for the playground overlay (H12). Never sent by a client. */
export const MSG_PLAYGROUND_BOT_DEBUG = "playground-bot-debug";

const STANCES = [
  "engage", "brawl", "kite", "disengage", "reposition", "hunt", "recover",
] as const;

export interface BotDebugPayload {
  tick: number;
  stance: string;
  targetSessionId: string;
  preferredRange: number;
  personality: string;
  /** -1 when the bot held fire; a slot index otherwise. */
  firedSlot: number;
}

export function isBotDebugPayload(value: unknown): value is BotDebugPayload {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.tick === "number" &&
    typeof rec.stance === "string" &&
    (STANCES as readonly string[]).includes(rec.stance) &&
    typeof rec.targetSessionId === "string" &&
    typeof rec.preferredRange === "number" &&
    typeof rec.personality === "string" &&
    typeof rec.firedSlot === "number"
  );
}
```

Export both from `packages/shared/src/index.ts`. Rebuild shared: `npm run build -w @motor-combat-moba/shared`.

- [ ] **Step 4: Broadcast from `PlaygroundRoom`**

After `enqueueBotInput`, throttled so the overlay is readable rather than a blur:

```ts
    // Every 6 ticks (5 Hz): a debug read-out that updates 30 times a second is unreadable, and this
    // is a dev-only room, so the bandwidth is not the reason for the throttle.
    const debug = this.bot instanceof HumanController ? this.bot.debug() : undefined;
    if (debug && this.state.tick % 6 === 0) {
      this.broadcast(MSG_PLAYGROUND_BOT_DEBUG, {
        tick: debug.tick,
        stance: debug.stance,
        targetSessionId: debug.targetSessionId ?? "",
        preferredRange: Math.round(debug.preferredRange),
        personality: debug.personality,
        firedSlot: debug.firedSlot ?? -1,
      });
    }
```

- [ ] **Step 5: Render it in the overlay**

In `packages/client/src/dev/playground/overlay.ts`, add a `pg-bot-debug` block below the existing difficulty control, following that file's existing DOM-building style. Register the handler where the room's other message handlers are registered:

```ts
  room.onMessage(MSG_PLAYGROUND_BOT_DEBUG, (payload: unknown) => {
    if (!isBotDebugPayload(payload)) return;
    debugEl.textContent =
      `${payload.personality} | ${payload.stance} | range ${payload.preferredRange}` +
      ` | slot ${payload.firedSlot < 0 ? "-" : payload.firedSlot + 1}`;
  });
```

- [ ] **Step 6: Verify by eye, then commit**

```bash
npm run build -w @motor-combat-moba/shared
npm test
npm run dev
```

Open `http://localhost:5173/?dev=playground`, enable the bot, and confirm the read-out changes as the bot fights — stance shifting between `engage`/`kite`, the range settling near the kit's band, the slot index varying.

```bash
git add -A
git commit -m "feat(playground): print what the bot is thinking over the match

Stance, personality, preferred range and the slot it just pressed, broadcast at
5 Hz from the dev-only playground room. This is the answer to a scored decision
layer's one weakness -- that 'why did it do that' means reading a scoreboard.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Documentation

**Files:**
- Create: `docs/bot-behavior.md`
- Modify: `CLAUDE.md`, `packages/server/CLAUDE.md`

- [ ] **Step 1: Write `docs/bot-behavior.md`**

Modelled on `docs/turn-tuning.md`'s job — the page you open when something feels wrong. It must contain:

1. **A symptom-to-knob table.** "The bot never dodges" → `dodgeChance`, `dodgeReactionTicks`, `dodgeHorizonTicks`. "It fights at the wrong distance" → `standoffFraction`, `awarenessRadiusUnits`, and the `effectiveRangeOf` formula. "It wastes its ult" → `ultDisciplineChance`, `ultWindowHpFraction`. "It feels robotic" → `aimErrorDriftTicks`, `scoreNoiseSigma`, `idleFidgetChance`, `blunderChance`. "It never uses its second weapon" → `slotWeights`, and H27's one-press-per-tick rule. "All three tiers feel the same" → the characterisation tests in `bot/brain/tiers.test.ts` are the guard; read them first.
2. **The full parameter table**, all three tiers, copied from the spec.
3. **The five layers and the seven stances**, one line each.
4. **How to read the playground overlay.**
5. **The rule that a tier is data and a behaviour is code** (H8), and that no module may branch on `profileId`.
6. **A pointer to the spec** for the reasoning, and to `packages/server/balance/README.md` for measuring a change.

Unlike `docs/turn-tuning.md` there is no test parsing this page, so say so explicitly at the top: it is hand-maintained, and the parameter table must be re-checked against `bot-profiles.ts` whenever a tier value moves.

- [ ] **Step 2: Update the two `CLAUDE.md` files**

In root `CLAUDE.md`:
- add a row to the "Read the right doc" table: `| Which knob to tune when a bot feels wrong, and every bot parameter | docs/bot-behavior.md |`
- add a short section after the practice-mode paragraph:

> **The bot is a five-layer brain, and a tier is data.** `packages/server/src/bot/brain/` runs perceive → assess → move → shoot → humanize; `easy`/`medium`/`hard` differ only in `BOT_PROFILES`, and no module branches on the difficulty name. Dodging is a steering desire, never a stance, so a bot can dodge without stopping fighting. The bot presses **one** slot per tick — `beginFire` takes the lowest set bit, so an OR of every in-range slot fires slot 0 and nothing else. `BOT_BRAIN_VERSION` rides in `botFingerprint`: bump it when behaviour changes without the table moving. See [`docs/bot-behavior.md`](docs/bot-behavior.md).

In `packages/server/CLAUDE.md`, add the `bot/brain/` layout if that file lists a module map.

- [ ] **Step 3: Verify and commit**

```bash
npm test
git add -A
git commit -m "docs(bot): add the bot-behaviour tuning page and index it

The page to open when a bot feels wrong: symptom-to-knob table, the full
parameter table for all three tiers, the five layers, the seven stances, and
how to read the playground overlay.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `npm run build` from the repo root (shared → server → client, in that order — never `--workspaces`).
- [ ] `npm test` from the repo root.
- [ ] `grep -rn "Math.random" packages/server/src/bot/` returns nothing.
- [ ] `grep -rn "profileId ===" packages/server/src/bot/brain/` returns nothing (H8).
- [ ] `npm run balance -- --shape=duel --matches=20 --seed=7` completes and its report names the new bot fingerprint.
- [ ] Play all three tiers in practice mode and say which ones feel wrong. **This is the acceptance test** — every number in the table is a first pass, and the spec's own success criterion is that a player can say *what kind of player* each bot is.
