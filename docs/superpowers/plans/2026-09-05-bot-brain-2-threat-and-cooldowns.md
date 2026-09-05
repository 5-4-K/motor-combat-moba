# Bot Brain 2 (spec phase C) — Threat Evaluation and Cooldown Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.
>
> **Blocked on plan 1.** This plan calls `solve()` with its arguments swapped; that function must
> exist first.

**Goal:** Let the bot know when it is standing inside somebody's firing solution, and estimate which
of their weapons are actually loaded — the two facts a skilled player acts on that this bot has never
had.

**Architecture:** `dangerEvAgainst()` is `solve()` called with the opponent as shooter and the bot as
target, summed over the opponent's kit and weighted by an estimate of what is off cooldown. The
estimate reads `perception`'s existing record of every weapon it has watched fire. The result feeds
the `evade` situation, so the bot breaks a line before the shot exists rather than dodging after it.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-bot-predictive-brain-design.md` — decisions P16, P21,
P38, P40, P47, P58b.

**Index:** `docs/superpowers/plans/2026-09-05-bot-predictive-brain-master-index.md`

## Global Constraints

Inherited verbatim from the master index. The two that bite here:

- **No cheating (P1, P2).** Readiness is estimated from **observed fires only**. Never read
  `BotCarView` for slot state — it deliberately carries none — and never widen it to.
- **Fixed random draw counts (H21).** This plan adds no `rng()` draws.

---

## Correction this plan is built on

The spec's first draft of **P21 was wrong** and has been corrected. It claimed the `fired` sink was
disabled in every room and had to be enabled. It is not:

- `PlaygroundRoom.ts:424`, `PracticeRoom.ts:409` and `balance/match.ts:271` all already pass
  `observedFires` into `buildBotView`.
- `perception.ts:84–87` already records **every** weapon it sees fired, not only ults.
  `ultSeenTick` is a misleading name for a general "last seen firing" map.

So there is **no plumbing task here.** What is missing is the readiness estimate on top, plus two
stale comments that assert the opposite and would mislead the next reader.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/server/src/bot/brain/perception.ts` | Modify | Add `readinessOf`; rename `ultSeenTick` → `firedSeenTick` with an honest comment. |
| `packages/server/src/bot/brain/perception.test.ts` | Modify | Cases for `readinessOf`. |
| `packages/server/src/bot/brain/solution.ts` | Modify | Add `dangerEvAgainst`. |
| `packages/server/src/bot/brain/solution.test.ts` | Modify | Cases for the above. |
| `packages/server/src/bot/brain/controller.ts` | Modify | Feed danger into the `evade` decision; carry it on `BotDebug`. |
| `packages/server/src/bot/types.ts` | Modify | `BotDebug.dangerEv`; fix the stale `observedFires` comment. |
| `packages/server/balance/match.ts` | Modify | Fix the stale comment at lines 234–236. |
| `packages/server/src/config/bot-profiles.ts` | Modify | Bump `BOT_BRAIN_VERSION` to `4.1.0`. No new field. |
| `docs/bot-behavior.md`, `.claude/skills/bot-tuner/SKILL.md` | Modify | P58b. |

---

### Task 1: Estimate weapon readiness from what was seen fired (P21)

**Files:**
- Modify: `packages/server/src/bot/brain/perception.ts`
- Modify: `packages/server/src/bot/types.ts`
- Modify: `packages/server/balance/match.ts`
- Test: `packages/server/src/bot/brain/perception.test.ts`

**Interfaces:**
- Consumes: `PerceptionState`, `ultIsSpent` (existing).
- Produces: `readinessOf(state: PerceptionState, sessionId: string, weaponId: WeaponId, tick: number, profile: BotProfile): number` — 0..1, where 1 means "as far as this bot knows, that gun is loaded".

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/bot/brain/perception.test.ts`:

```typescript
describe("readinessOf", () => {
  it("assumes a weapon never seen fired is loaded", () => {
    const state = newPerception();
    expect(readinessOf(state, "them", "predator", 100, BOT_PROFILES.hard)).toBe(1);
  });

  it("treats a weapon seen fired one tick ago as spent", () => {
    const state = newPerception();
    state.firedSeenTick.set("them:lance", 100);
    expect(readinessOf(state, "them", "lance", 101, BOT_PROFILES.hard)).toBeLessThan(0.1);
  });

  it("recovers to loaded once the cooldown has elapsed", () => {
    const state = newPerception();
    state.firedSeenTick.set("them:predator", 100);
    // predator: 1000 ms == 30 ticks at 30 Hz.
    expect(readinessOf(state, "them", "predator", 131, BOT_PROFILES.hard)).toBe(1);
  });

  it("forgets a sighting older than memoryTicks, so a casual loses track", () => {
    const state = newPerception();
    state.firedSeenTick.set("them:lance", 0);
    const easy = readinessOf(state, "them", "lance", 60, BOT_PROFILES.easy);
    // lance is a 16 s gun: 60 ticks in it is genuinely still recharging, but easy's 15-tick memory
    // has dropped the sighting, so easy believes it is loaded. That gap IS the tier difference.
    expect(easy).toBe(1);
    expect(readinessOf(state, "them", "lance", 60, BOT_PROFILES.hard)).toBeLessThan(1);
  });
});
```

Add `readinessOf` and `newPerception` to the file's imports from `./perception.js`, and
`BOT_PROFILES` from `../../config/bot-profiles.js` if not already imported.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/perception.test.ts -t "readinessOf"
```

Run from `packages/server`. Expected: FAIL — `readinessOf` is not exported, `firedSeenTick` does not exist.

- [ ] **Step 3: Rename the map honestly and add the estimate**

In `perception.ts`, rename `ultSeenTick` to `firedSeenTick` throughout (interface, `newPerception`,
`perceive`, `ultIsSpent`) and replace its comment:

```typescript
  /**
   * `${sessionId}:${weaponId}` -> the tick that press was watched (H22, P21).
   *
   * EVERY weapon, not only ults — the old name `ultSeenTick` said otherwise and was wrong about its
   * own contents. `ultIsSpent` is the ult-shaped query over it; `readinessOf` is the general one.
   */
  firedSeenTick: Map<string, number>;
```

Add at the end of the file:

```typescript
/**
 * How loaded this bot BELIEVES an opponent's weapon is (P21), 0..1.
 *
 * Built only from presses it actually watched — a human tracks availability approximately, which the
 * user's fairness ruling calls fair, and `BotCarView` deliberately carries no slot state so there is
 * nothing else to read. Three ways this is honestly wrong, all of them the point:
 * a press seen through a shorter `memoryTicks` is forgotten and the gun is assumed loaded; a press
 * never seen at all is assumed loaded; and a weapon fired outside the bot's awareness never lands
 * here in the first place.
 */
export function readinessOf(
  state: PerceptionState,
  sessionId: string,
  weaponId: WeaponId,
  tick: number,
  profile: BotProfile,
): number {
  const seen = state.firedSeenTick.get(`${sessionId}:${weaponId}`);
  if (seen === undefined) return 1;
  const since = tick - seen;
  if (since > profile.memoryTicks) return 1;
  const cooldown = weaponTicksOf(weaponId).cooldown;
  if (cooldown <= 0) return 1;
  return Math.min(1, since / cooldown);
}
```

Import `weaponTicksOf` and `WeaponId` from `@motor-combat-moba/shared` and `BotProfile` from
`../../config/bot-profiles.js` if not already present.

- [ ] **Step 4: Fix the two stale comments**

In `packages/server/src/bot/types.ts`, on `observedFires`, replace:

```typescript
   * Empty when the host does not collect combat events, which is every room today. A bot that needs
   * these is what turns the `fired` sink on in that room.
```

with:

```typescript
   * Every host that runs a bot already collects these and passes them: `PlaygroundRoom`,
   * `PracticeRoom` and the balance harness. `ArenaRoom` passes nothing and correctly so — it hosts
   * no bots. An earlier version of this comment claimed no room collected them, which was wrong and
   * hid the fact that cooldown tracking was already possible.
```

In `packages/server/balance/match.ts`, replace the claim at lines 234–236 that the harness is the
only host turning `observedFires` on with:

```typescript
  // B18: every bot-hosting surface turns `observedFires` on — this harness, `PlaygroundRoom` and
  // `PracticeRoom`. `ArenaRoom` does not, correctly, because it hosts no bots.
```

- [ ] **Step 5: Run the suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/bot packages/server/balance/match.ts
git commit -m "feat(bot): estimate enemy weapon readiness from observed fires

The bot could already see every press -- all three bot hosts pass observedFires,
and perception recorded every weapon fired, not just ults. What was missing was
the estimate on top. readinessOf compares time since the last watched press
against that weapon's cooldown, and returns 'loaded' for anything forgotten or
never seen, so a short memoryTicks genuinely loses track. That gap is the tier
difference, not a penalty bolted on.

Renames ultSeenTick to firedSeenTick: the old name was wrong about its own
contents. Fixes two comments that claimed no room collected combat events.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `dangerEvAgainst` — the solver, inverted (P16)

**Files:**
- Modify: `packages/server/src/bot/brain/solution.ts`
- Test: `packages/server/src/bot/brain/solution.test.ts`

**Interfaces:**
- Consumes: `solve`, `PosePredictor`, `constantVelocityPredictor` (plan 1); `readinessOf` (Task 1).
- Produces:
  - `dangerEvAgainst(args: DangerArgs): number`
  - `interface DangerArgs { threat: BotCarView; me: BotCarView; meAt: PosePredictor; readiness: (weaponId: WeaponId) => number; assumedAimSigmaRad: number; tick: number; arena: BotArenaView }`
  - `BRAIN_CONSTANTS.assumedOpponentAimSigmaRad` (new constant)

- [ ] **Step 1: Write the failing test**

```typescript
describe("dangerEvAgainst (P16)", () => {
  const loaded = () => 1;

  it("is higher when the threat is pointed at us than when it is pointed away", () => {
    const me = targetAt(300, 0);
    const facing: BotCarView = { ...targetAt(0, 0), sessionId: "them", carId: "bullseye", angle: 0 };
    const away: BotCarView = { ...facing, angle: Math.PI };
    const at = (threat: BotCarView) => dangerEvAgainst({
      threat, me, meAt: constantVelocityPredictor(me), readiness: loaded,
      assumedAimSigmaRad: 0.05, tick: 0, arena,
    });
    expect(at(facing)).toBeGreaterThan(at(away));
  });

  it("is zero when the threat is out of every weapon's reach", () => {
    const me = targetAt(5000, 0);
    const threat: BotCarView = { ...targetAt(0, 0), sessionId: "them", carId: "bullseye", angle: 0 };
    expect(dangerEvAgainst({
      threat, me, meAt: constantVelocityPredictor(me), readiness: loaded,
      assumedAimSigmaRad: 0.05, tick: 0, arena,
    })).toBe(0);
  });

  it("discounts a weapon this bot believes is still recharging (P21)", () => {
    const me = targetAt(300, 0);
    const threat: BotCarView = { ...targetAt(0, 0), sessionId: "them", carId: "bullseye", angle: 0 };
    const common = {
      threat, me, meAt: constantVelocityPredictor(me),
      assumedAimSigmaRad: 0.05, tick: 0, arena,
    };
    const all = dangerEvAgainst({ ...common, readiness: loaded });
    const spent = dangerEvAgainst({ ...common, readiness: () => 0 });
    expect(spent).toBeLessThan(all);
    expect(spent).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/solution.test.ts -t "dangerEvAgainst"
```

Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `solution.ts`:

```typescript
export interface DangerArgs {
  /** The car that might shoot us, as observed. */
  threat: BotCarView;
  /** Us, in the shape the solver takes a target in. */
  me: BotCarView;
  meAt: PosePredictor;
  /** How loaded this bot believes each of their weapons is, 0..1 (P21). */
  readiness: (weaponId: WeaponId) => number;
  /** What competence to assume of them — their real hands are unknowable. */
  assumedAimSigmaRad: number;
  tick: number;
  arena: BotArenaView;
}

/**
 * How much damage per second we are currently standing in front of (P16).
 *
 * `solve()` with the arguments swapped, summed across their kit and weighted by what we believe is
 * off cooldown. Two things on their side are unknowable and are therefore assumed rather than read:
 * their aim error (a fixed nominal — the bot assumes competence, never incompetence) and their slot
 * state (`readiness`, from watched presses only).
 *
 * The kit is the chassis default plus anything we have watched them fire — `kitWeaponIds` — so a
 * weapon they carry but have not used still counts, exactly as a human would assume from the car.
 */
export function dangerEvAgainst(args: DangerArgs): number {
  const { threat, me, meAt, readiness, assumedAimSigmaRad, tick, arena } = args;
  let total = 0;
  for (const weaponId of kitWeaponIds(threat.carId)) {
    const ready = readiness(weaponId);
    if (ready <= 0) continue;
    const solution = solve({
      shooter: {
        sessionId: threat.sessionId, carId: threat.carId, team: threat.team,
        x: threat.x, y: threat.y, angle: threat.angle, speed: threat.speed,
        // A lock we cannot see. Assuming none is the conservative read: it makes danger LOWER, so
        // the bot never flinches from a lock the opponent does not actually hold.
        lockTargetSessionId: "",
      },
      slot: {
        weaponId, stocks: 1, rechargeEndsTick: 0, refireLockUntilTick: 0,
        range: weaponDefOf(weaponId).range,
      },
      slotIndex: 0,
      target: me,
      targetAt: meAt,
      aimSigmaRad: assumedAimSigmaRad,
      tick,
      arena,
    });
    total += solution.value * ready;
  }
  return total;
}
```

Import `kitWeaponIds` from `./reach.js` and `WeaponId` from `@motor-combat-moba/shared`.

Add to `BRAIN_CONSTANTS` in `bot-profiles.ts`:

```typescript
  /**
   * The aim error a bot assumes of an OPPONENT when evaluating danger (P16). Not per-tier: this is
   * what the bot assumes of someone else, and every tier assumes competence rather than projecting
   * its own hands onto them.
   */
  assumedOpponentAimSigmaRad: 0.06,
```

- [ ] **Step 4: Run to verify they pass**

```bash
npx vitest run src/bot/brain/solution.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bot/brain/solution.ts packages/server/src/bot/brain/solution.test.ts packages/server/src/config/bot-profiles.ts
git commit -m "feat(bot): evaluate the danger we are standing in

dangerEvAgainst is solve() with the arguments swapped -- the same geometry read
in the other direction -- summed over the opponent's kit and weighted by what we
believe is off cooldown. Writing it as its own geometry would have duplicated
the whole marching loop.

Two unknowables are assumed rather than read: their hands (a fixed nominal, and
the bot assumes competence) and their lock (assumed absent, which is the
conservative direction -- it makes danger lower, never higher).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Break the line before the shot exists (P16, P38, P40)

Gives phase C an observable behaviour. Without a consumer, `dangerEvAgainst` is dead code until
plan 4.

**Files:**
- Modify: `packages/server/src/bot/brain/controller.ts`
- Modify: `packages/server/src/bot/types.ts`
- Test: `packages/server/src/bot/brain/controller.test.ts`

**Interfaces:**
- Consumes: `dangerEvAgainst`, `readinessOf`.
- Produces: `BotDebug.dangerEv: number`. The `evade` situation now also triggers on danger.

The reactive dodge (a shot already in flight) **stays** — P40. This adds a second, anticipatory
trigger beside it.

- [ ] **Step 1: Write the failing test**

```typescript
it("breaks the line when it is in a loaded gun's solution, before the shot exists (P16)", () => {
  // Threat is stationary, pointed straight at the bot, well inside predator's reach, and has
  // fired nothing -- so every gun reads as loaded and there is no instance in flight to dodge.
  const bot = new HumanController("hard");
  const rng = makeRng(17);
  let evaded = false;
  for (let tick = 0; tick < 120; tick++) {
    bot.decide(inThreatLineView(tick, rng));
    if (bot.debug()?.situation === "evade") evaded = true;
  }
  expect(evaded).toBe(true);
});

it("reports the danger it is standing in, for the overlay", () => {
  const bot = new HumanController("hard");
  const rng = makeRng(17);
  for (let tick = 0; tick < 30; tick++) bot.decide(inThreatLineView(tick, rng));
  expect(bot.debug()!.dangerEv).toBeGreaterThan(0);
});
```

with the helper:

```typescript
function inThreatLineView(tick: number, rng: ReturnType<typeof makeRng>): BotView {
  return {
    tick,
    self: {
      sessionId: "me", carId: "bullseye", team: 0, x: 400, y: 360, angle: 0, speed: 300,
      hp: 65, maxHp: 65, alive: true, statuses: [], slots: slotsFor("bullseye"),
      switchLockUntilTick: 0, lockTargetSessionId: "", maneuver: 0, maneuverTicksLeft: 0,
    },
    others: [{
      sessionId: "them", carId: "bullseye", team: 1, x: 100, y: 360, angle: 0, speed: 0,
      hp: 65, maxHp: 65, alive: true, phased: false, statuses: [], maneuver: 0,
    }],
    instances: [], arena: { width: 1280, height: 720, obstacles: [] },
    observedFires: [], rng,
  };
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/bot/brain/controller.test.ts -t "breaks the line"
```

Expected: FAIL — the bot never reaches `evade` without an instance in flight; `dangerEv` is undefined.

- [ ] **Step 3: Add `dangerEv` to `BotDebug`**

In `types.ts`:

```typescript
  /** Damage per second the bot believes it is standing in front of (P16). Overlay only. */
  dangerEv: number;
```

- [ ] **Step 4: Compute danger and feed the evade decision**

In `controller.ts`'s `plan`, after the existing `shotThreats` line:

```typescript
    const danger = target
      ? dangerEvAgainst({
          threat: target,
          me: {
            sessionId: self.sessionId, carId: self.carId, team: self.team,
            x: self.x, y: self.y, angle: self.angle, speed: self.speed,
            hp: self.hp, maxHp: self.maxHp, alive: true, phased: false,
            statuses: self.statuses, maneuver: self.maneuver,
          },
          meAt: (ahead) => ({
            x: self.x + Math.cos(self.angle) * self.speed * (ahead / TICK_RATE_HZ),
            y: self.y + Math.sin(self.angle) * self.speed * (ahead / TICK_RATE_HZ),
            angle: self.angle,
          }),
          readiness: (weaponId) =>
            readinessOf(this.perception, target.sessionId, weaponId, tick, profile),
          assumedAimSigmaRad: BRAIN_CONSTANTS.assumedOpponentAimSigmaRad,
          tick,
          arena: view.arena,
        })
      : 0;
    this.lastDangerEv = danger;
```

Then widen the `evade` input in the `classifySituation` call:

```typescript
      evade: shotThreats.length > 0
        || (carIncoming && this.willEvadeCar)
        // Anticipatory: standing in a loaded gun's solution is a reason to move BEFORE the shot
        // exists. Scaled by opponentRangeRespect (P38) so respecting danger stays the tier axis it
        // has always been — at 0 this term can never fire, which is exactly easy's intent.
        || danger * profile.opponentRangeRespect >= BRAIN_CONSTANTS.dangerEvadeThreshold,
```

Add the field `private lastDangerEv = 0;` and include `dangerEv: this.lastDangerEv` in the
`lastDebug` assignment. Add to `BRAIN_CONSTANTS`:

```typescript
  /** Danger-per-second, after `opponentRangeRespect`, at which a bot leaves the line (P16). */
  dangerEvadeThreshold: 12,
```

- [ ] **Step 5: Run the suite**

```bash
npm test
```

Expected: PASS. If `evade` now fires so constantly that other controller tests break, the threshold
is too low for the scenes those tests use — raise `dangerEvadeThreshold` rather than special-casing
a test.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/bot
git commit -m "feat(bot): evade a firing solution, not just a shot in flight

The bot could only react to an instance already travelling toward it. It can now
also leave a line it is standing in before the shot exists, which is what
'breaks your lines by arithmetic rather than by dodge roll' means.

Scaled by opponentRangeRespect, which is repurposed rather than replaced -- 'how
much does this bot respect danger' was always what that knob meant, and at easy's
0 the anticipatory term can never fire. The reactive dodge stays beside it: a
shot in flight and a potential shot are different reflexes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Docs, skill, version (P47, P58b)

**Files:**
- Modify: `packages/server/src/config/bot-profiles.ts`
- Modify: `docs/bot-behavior.md`
- Modify: `.claude/skills/bot-tuner/SKILL.md`

- [ ] **Step 1: Bump the version**

```typescript
// 4.1.0 (2026-09-05): danger evaluation and cooldown readiness (spec phase C).
export const BOT_BRAIN_VERSION = "4.1.0";
```

- [ ] **Step 2: Update `docs/bot-behavior.md`**

- Version line → `4.1.0`.
- In **Judgment**, re-document `opponentRangeRespect`: *"the weight on danger — how hard the bot
  works to stay out of a loaded gun's firing solution (P38). At 0 the anticipatory evade never
  fires."*
- Add a **Situations** table note on `evade`: *"an incoming shot (rolled `dodgeChance`), an incoming
  car (`incomingCarChance`), **or** standing in a loaded gun's solution above
  `dangerEvadeThreshold`."*
- Add to the complaint map:

| They say | Factor | First knobs |
|---|---|---|
| "it runs away from nothing" | judgment | `opponentRangeRespect` down, or `BRAIN_CONSTANTS.dangerEvadeThreshold` up. Overlay's `danger` reading says which |
| "it walks into obvious fire" | judgment | `opponentRangeRespect` up. If `danger` reads 0 while you are aimed at it, that is a solver bug, not a knob |

- [ ] **Step 3: Update `bot-tuner`**

Add the two rows above to its complaint table, and extend the overlay-first diagnostic from plan 1
to mention `danger`:

```markdown
   The overlay also prints `danger` — damage per second the bot believes it is standing in. If it
   reads 0 while you are pointed straight at it from inside your weapon's reach, stop: that is a
   solver bug, not a tuning problem.
```

- [ ] **Step 4: Verify and commit**

```bash
npm test
```

```bash
git add packages/server/src/config/bot-profiles.ts docs/bot-behavior.md .claude/skills/bot-tuner/SKILL.md
git commit -m "docs: bot brain 4.1.0 — danger and readiness

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Validation

- [ ] **1.** `npm test` from the repo root passes.
- [ ] **2.** `npm run build` succeeds and `packages/server/dist/index.js` inlines `// ../shared/dist/`.
- [ ] **3.** In `?dev=playground`, drive at a hard bot in a straight line from inside your weapon's
  reach without firing. It should move off the line **before** you shoot. The overlay's `danger`
  reading should be non-zero while you are pointed at it and fall when you turn away.
- [ ] **4.** Fire a big gun at a hard bot, then watch: it should press its advantage while your gun
  is recharging. Against an **easy** bot the same test should show no such change — easy's 15-tick
  memory forgets the press almost immediately.
- [ ] **5.** Report: balance baselines invalidated again (`4.1.0`). Playtest probes unaffected by
  this plan specifically — no firing cadence or drive change — but say so rather than staying silent.
