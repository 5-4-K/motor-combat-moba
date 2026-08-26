# Car MOBA — Design Progress Doc

**Last updated:** Session 1 (2026-08-27)
**Status:** Brawl mode design, in progress
**Purpose:** Single source of truth carried between sessions. Paste this at the start of each new session for full context.

---

## 0. HOW TO USE THIS DOC

**Rules for the assistant reading this doc:**

1. Treat every section below as authoritative. Do not contradict a LOCKED decision without explicitly flagging that you are proposing a change and why.
2. Do **not** invent decisions. If something is not in this doc, it is undecided. Say so rather than assuming.
3. Section 5 (PROPOSED BUT NOT DECIDED) is the hallucination trap. Those items were discussed but never approved. Never refer to them as settled.
4. Discuss **one topic at a time**. Resolve it, then move on. Do not jump ahead to the next topic without asking.
5. After each new decision, check it against Sections 2, 3, and 4 and report any conflict with what was decided earlier.
6. Update this doc at the end of each session — add new decisions, move items out of "open", log rejected ideas with reasons.

---

## 1. PROJECT OVERVIEW

**What we're building:** A browser-based multiplayer MOBA-style game with cars. Weapons and abilities function as skills, like a typical MOBA.

**Current scope:** LAN multiplayer. Online play comes later.

**Current implementation:** 3v3 works. 2v2 and 1v1 also playable. **Design focus is 3v3.**

**Current design target:** The **Brawl mode** — the simplest standalone mode. If driving and combat feel good with no objective propping them up, everything built later inherits that.

### Brawl mode concept (user-defined)
- No objective. Two teams fight it out.
- Target average match duration: 5–10 minutes.
- Fixed respawn time.
- Players gain XP over time. **XP gain pauses while dead.**
- XP makes you stronger.
- First team to a target kill count wins.
- No hard time cap needed — escalating power means matches that run long resolve themselves.

---

## 2. GOALS (never compromise these)

1. **Driving skill is the primary skill-gap factor.** Every mechanic should be evaluated against this first.
2. **Low complexity.** Gameplay must not be too complex. There should not be too many things to learn and master.
3. **Fun and casual**, while still producing skill-based results.
4. Skill expression should be **visible and self-teaching** — players should understand why they lost without reading a wiki.

---

## 3. HARD CONSTRAINTS (do not break)

| # | Constraint | Notes |
|---|---|---|
| C1 | No hitscan weapons | Even a "laser" is a very fast projectile |
| C2 | Keyboard-only controls, no mouse | Stated as a strong preference, not absolute — but all design so far assumes it |
| C3 | The **basic weapon** is welded to the chassis and fires forward | Direct consequence of C2. Does **not** automatically apply to special powers — see §4.2. |
| C4 | Fixed respawn time | Never scales with match time or score |
| C5 | XP gain pauses while dead | User's core rule |
| C6 | Turn rate = aim rate | Locked "for now"; handling is the master stat |

### 3.1 Preferences (changeable, not constraints)

| # | Preference | Notes |
|---|---|---|
| P1 | Mobility does not scale with XP | Not top speed, acceleration, boost, or turn rate. Rationale: it's the constant-value skill currency that lets a low-level good driver beat a high-level bad one. **User's position: a preference for now. May change, may not.** Do not treat as locked. |

---

## 4. LOCKED DECISIONS

### 4.1 Combat model — path selection
- **Currently exploring: weapons as primary damage source.**
- The alternative path (**ramming as primary damage**) has NOT been explored yet. User is genuinely undecided and wants both paths discussed before committing.
- Whichever path wins, Section 2 goals remain constant.

### 4.2 Terminology and weapon scope

**Terminology (use these exact terms):**
- **Basic weapon** — the common weapon shared by all cars. Currently the flamethrower (§4.4).
- **Special powers** — car-specific weapons and abilities. **Not yet designed.**

**What is universal:**
- **Projectiles only**, all with travel time, for everything. (C1)

**What is NOT universal — decided per special power:**

| Property | Basic weapon | Special powers |
|---|---|---|
| Welded to chassis | **Always** | **Some yes, some no** — decided per power |
| Aim assist | **No** — direction is locked to car facing, no assist at all | **Some yes, some no** — decided per power |
| Cone + lock system (§4.3) | N/A | **Only** for those powers that have aim assist |

> ⚠️ Do not assume a special power is welded or aim-assisted. Both are per-power design choices. Nothing about special powers has been designed yet.

**Aim assist rules — for special powers that have it:**
- Each such power has a **firing cone**, roughly ±10° to ±35° from the car's nose.
  - Inside the cone: assist handles **lead calculation only** (fires where the target will be).
  - Outside the cone: **no assist at all**, cannot engage.
  - Cone width is a per-power balance lever — narrow = high skill demand, wide = forgiving.
- **Assist error scales with the target's lateral velocity.** Target driving straight at/away = near-perfect lead. Target moving hard laterally/weaving/drifting = assist mispredicts, shots trail behind. This makes the *defender's* driving matter.
- **Firing arc is a car identity trait**, not a global rule. Some cars may have rear-facing or wide-arc powers.
- Starting approach: **cone assist from the start** (rather than prototyping zero-assist first).

**Design principle established:** *Driving decides whether you can shoot. The assist decides only where the bullet goes.*

### 4.3 Target lock system

**Applies to: special powers that have aim assist. Does NOT apply to the basic weapon, or to special powers without assist.**

- **Ambient lock.** Maintained whenever a valid target is in cone, whether or not you are firing. The trigger only fires; it has no say in targeting.
- **Score:** `angle° + (distance_m × 0.4)` — lowest score wins. The distance term prevents bias toward far targets that naturally sit near the centerline. Coefficient is a tuning lever for how close-range the game feels.
- **Retain:** while target stays inside cone **+5°** (wider retention than acquisition — prevents edge flicker). Keep at +5°; wider starts to feel like aimbot.
- **Steal:** a new target needs **25% better score**, and **0.4s minimum** must have passed since the last lock change.
- **Release on:** target death, out of range, LOS broken >0.3s, exits retention cone, or **0.6s with no fire-button press**.
- **No valid target = fire straight ahead.** Firing is never blocked.
- **Visible lock bracket** on the current target. (Rejected: "soft bracket" showing a would-be target while unlocked.)
- **No per-weapon timeout calculation.** Flat 0.6s for everything.

**Known consequence:** the flat 0.6s timeout splits weapons into two behavioral classes.
- Fire rate faster than ~1.7 shots/sec → holds locks, margin rule applies.
- Slower than that → re-acquires fresh every shot, always fires at the currently best target.
- **Avoid designing weapons in the 1.5–2.0 shots/sec band** — they'd feel inconsistent.

**Target switching:** no spin-down/spin-up penalty. The 25% margin + 0.4s commit timer supply enough friction.

### 4.4 The basic weapon — flamethrower

**Concept:** the basic weapon, shared by all cars, is a short-range flamethrower that functions mechanically like a melee attack.

- **Short range**, but not point-blank.
- Fires a **cone-shaped burst** of flame.
- **No auto-aim.** Burst direction is locked to the car's facing direction.
- **No continuous fire.** Fire button must be pressed for each burst.
- Fire rate ~**1 burst/sec** (tweakable).
- **Blocking rule (LOCKED):** *while your flamethrower is active, your front hitbox takes no flame damage.*
  - Per-car, independent — no pair-checking between two flames, no phase-alignment coin flip.
  - Scales correctly to 3v3: three enemies flaming your front are all blocked at once.
  - Perpendicular attacks land normally — the hit isn't on the front hitbox, so front immunity is irrelevant.
- **Flame blocks only other flames.** Special powers hit the front normally.
- **No windup** currently. (Windup is available as a future lever if spam becomes a problem.)

**Why this design (user's reasoning):** short range forces you to close distance; flames cancel head-on; therefore the only way to land basic weapon damage is from the **side or rear**. This makes positioning and driving the deciding factor in the primary damage exchange.

**Requires:** hitbox zones on every car — front / side / rear at minimum.

**Spam concern (accepted, unresolved):** front immunity uptime = burst duration ÷ cycle time. At 0.3s burst on a 1.0s cycle that's 30%. Not a wall, so blocking still requires intent. **Tune via fire rate, burst time, or adding windup later if it feels spammable.** No new mechanic needed.

**Layered defense this creates:** facing an enemy protects you from their flame but exposes you to their special powers. Two layers pulling in opposite directions — no single dominant answer in a fight.

### 4.5 Collisions

- **Impact only. Little to no damage.**
- **Impulse formula (LOCKED):**

  ```
  J = (1 + e) × v_rel_normal ÷ (1/m₁ + 1/m₂)
  ```

  where `v_rel_normal` is closing velocity projected onto the contact normal, and `e` is restitution (~0.2–0.4 for a weighty feel).

  This one formula produces all four cases naturally:
  - **Head-on:** closing speed = v₁ + v₂ → big impulse
  - **Rear ram:** closing speed = v₁ − v₂ → small impulse (rear-ending at matched speed barely registers)
  - **Side ram:** their velocity is perpendicular to the normal → contributes nothing; only your speed and mass ratio matter
  - **Stopped car:** their velocity is zero → same as side ram

  The "weight only" cases are not special rules — they're what the formula does when the normal component of their velocity is zero.

- **Off-center hits produce rotation.** Impulse applied off the center of mass creates torque proportional to the perpendicular offset. Dead-center = pure pushback, zero spin. Further out = more rotation, less pushback.
  - **Gameplay consequence:** precise ramming is a skill. Hit center to shove someone straight (off a ledge). Hit the corner to spin their nose off-line and break their flame block.
- **Momentum decides head-on ram duels, not mass.**
  - **Tuning target:** tanks should win head-on ram duels against light cars at **≥70–80% of max speed**, and lose if they haven't accelerated enough.
  - Creates the tactical loop: a rolling tank is a no-go zone from the front; a stalled or slowed tank is prey. Lights get a real job — force the tank to slow, then punish.
- **The ram winner also slows down.** Ramming is a deliberate commitment, not something heavies do ambiently.
- **Glancing blows slide.** Low car-to-car friction. Shallow angles = scrape past and keep speed. Side-by-side jockeying must not grind to a halt.
- **No turn-induced speed penalty.** Turning does not bleed speed.
- **No diminishing returns on repeat collisions** — for now. The relative-velocity formula may self-solve chain-spinning, since after the first ram both cars are slow and the second hit has low closing speed. Revisit if chain-spinning shows up in testing.
- **Heavies' "don't touch me" state applies to head-on ramming only.** Sides, rear, and all abilities remain open. Heavies have low top speed so they can't chase lights down regardless.

---

## 5. PROPOSED BUT **NOT** DECIDED

> ⚠️ **Everything in this section was discussed but never approved. Do not treat as settled. Do not build on these without confirming first.**

### 5.1 Driving model (raised, then deferred — topic was never actually opened)
- Arcade handling, not simulation — predictable over realistic
- Turn rate degrades as speed increases (~2× radius at full speed vs 50%)
- Handbrake drift that decouples facing from travel direction
- Universal regenerating boost (~8–10s recharge, ~1.5s burn)
- Slow reverse (~30% of forward top speed) to prevent backward-firing kiting

### 5.2 Combat damage split (from the pre-flamethrower discussion; partly superseded)
- ~70% weapons / ~30% powers damage split
- Effective range 25–35m to force close engagement
- Environmental impacts (walls, hazards, ledges) doing real damage while normal rams do not

### 5.3 Match skeleton numbers (explicitly deferred — see Section 7)
- Any specific kill target, respawn duration, or TTK figure discussed in Session 1 is **void**. TTK is an output of the stats, not an input.

### 5.4 Other unconfirmed proposals
- Two-phase power curve (skill regime → escalation phase)
- HP scaling less than DPS scaling (e.g. 1.4× HP vs 2.0× DPS)
- Cooldowns scaling ~15% max with XP
- Heat vs magazine as an ammo system for non-flame weapons
- Sustained-fire damage ramp-up for continuous weapons
- Three chassis classes (Light / Medium / Heavy)
- Fixed ~10-verb special power vocabulary for roster discipline
- Reduced rotation from *teammate* collisions specifically

---

## 6. REJECTED IDEAS (do not re-propose)

| Idea | Why rejected |
|---|---|
| Convoy / escort objective mode | User didn't like it |
| Trigger re-pull as lock override | User wants weapons where the fire button is tapped repeatedly for continuous fire — every tap would reset the lock |
| Per-weapon lock timeout formula | User wants a flat timeout. Weapons slower than the timeout simply re-acquire each shot. |
| "Soft bracket" (showing would-be target while unlocked) | User doesn't want it |
| Turn-induced speed loss | User doesn't want it |
| Mouse aim / 360° turret | Keyboard-only preference (C2) |
| Hard match time cap | Escalating power resolves long matches naturally |
| Lowest-HP target selection for aim assist | Self-defeating with projectiles — would aim at targets with no line of fire, and would break body-blocking |
| Mass alone deciding ram duels | Replaced by momentum, which makes it positional instead of a stat check |
| Scaling respawn timers | Main engine of blowouts; nothing to gain in an objectiveless mode |

---

## 7. OPEN QUESTIONS / REMAINING TOPICS

### Immediate next topic
**Chassis classes** — mass, acceleration, top speed, turn-rate curves. Everything in 4.5 now depends on these numbers.

### Still open within settled topics
- **Flame: instant damage or burn-over-time?** (DoT lets you land a hit and disengage with value; instant is easier to read)
- **Does basic weapon damage scale with XP?** (Recommendation was: scale it, but less than special powers)
- **Flame numbers:** range (rough guess 8–12m), cone width (~40–50°), burst duration, damage per burst, damage falloff toward cone edge
- **Flame range is coupled to boost strength** — must be tuned together, not in isolation
- **Do special powers have an ammo/heat cost?**
- **Does damage vary by hit location** (rear bonus)? Hitbox zones already exist for the basic weapon system.
- **Damage falloff over range** for projectiles

### Full remaining topic list (rough order)
1. Chassis classes ← next
2. Special power vocabulary (fixed verb list, before any specific car)
3. Individual cars and their special powers
4. XP curve — rate, what it scales, and how much
5. Map / arena design
6. **Match skeleton** — kill target, respawn time, TTK. *Deliberately last: these are outputs derived from all stats above.*
7. Anti-frustration pass — spawn camping, stomps, quitters
8. **The ramming-as-primary-damage path** — must be explored and compared before final commitment to the weapons-primary path

---

## 8. WATCH LIST (known risks, flagged but not fixed)

| Risk | Detail | Trigger to act |
|---|---|---|
| Flame spam | Mashing fire gives passive front immunity ≈ burst÷cycle uptime | If blocking feels effortless in playtest → tune fire rate / burst time / add windup |
| Chain-spinning | Repeated rams could keep a light car permanently out of control | If it appears in playtest → add diminishing returns (100% / 60% / 30% within ~3s) |
| Stray contact | In a 3v3 scramble, unintended bumps (including from teammates) rotate your nose and ruin shots | If it feels bad → reduce rotation from teammate collisions specifically |
| Flame blocking doesn't scale to 3v3 | You can only face one direction; two flankers means you eat one guaranteed | Probably correct behavior (rewards teamwork) — but means the block matters mainly in 1v1 |
| Heavies are structurally bad at flame duels | Flame duel is a pure turn-rate contest; heavies lose every time | Must be solved in **chassis classes** — via wider flame cone, longer range, front resistance, or an identity where the basic weapon isn't their win condition |
| Head-on passes feel samey | Two cars closing head-on always cancel, pass through, then race to turn around | Watch in playtest; possible fix is a closing-speed damage bonus |
| Heavy's permanent safe state | With no turn-speed penalty, a heavy at full speed can circle indefinitely while immune to head-on rams | Likely fine (safe but useless if the turn radius is wide). Watch whether it can actually threaten while doing this. |
| XP snowball | XP pauses on death → winning team is alive more → gains XP faster → wins harder. Decaying TTK amplifies every existing advantage. | **The central problem of the XP topic.** Fix in the shape of the XP curve, not by removing the rule. |

---

## 9. GLOSSARY

- **Basic weapon** — the common weapon shared by all cars (currently the flamethrower)
- **Special power** — a car-specific weapon or ability
- **Cone** — the angular window from the car's nose within which aim assist operates
- **Lock** — the currently assist-targeted enemy
- **Steal** — a new target taking the lock from the current one
- **v_rel_normal** — closing velocity projected onto the collision contact normal
- **Front immunity** — the flamethrower's block: front hitbox takes no flame damage while your own flame is active
- **Escalation** — the late-match power ramp that ends long games
- **TTK** — time to kill

---

## 10. SESSION LOG

**Session 1 — 2026-08-27**
- Established brawl mode concept and goals
- Deferred match skeleton to the end (TTK is an output, not an input)
- Chose to explore weapons-as-primary-damage path first
- Locked: keyboard-only, welded weapons, projectile-only, cone assist, assist error from lateral velocity, turn rate = aim rate
- Locked: full target lock system
- Locked: flamethrower basic weapon with front-immunity blocking
- Locked: collision impulse formula and ramming behavior
- Terminology fixed: **basic weapon** (common) vs **special powers** (car-specific)
- Clarified that welded-to-chassis and aim assist are **per-power** choices for special powers, not universal
- Downgraded "mobility doesn't scale with XP" from constraint to preference (P1)
- **Next session starts at: chassis classes**
