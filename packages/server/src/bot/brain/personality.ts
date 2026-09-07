import { WEAPON_SLOT_CONFIG, type BotDifficulty } from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotPersonality, PersonalityId } from "../types.js";

/** Which parameters an archetype may shift, and by how much (H47). 1 leaves a value alone. */
type Shifts = Partial<Record<keyof BotProfile, number>>;

/**
 * R-M1 (spec phase D, 2026-09-07; comment corrected in fix wave 2 the same day):
 * `brawler`, `kiter` and `opportunist` used to shift `standoffFraction`, which P35 deleted —
 * `preferredRangeOf` derives the range from the kit now. The nearest surviving DANGER-DISTANCE axis
 * is `opponentRangeRespect` after P38, so `brawler` takes 0.8 on it (respects the opponent's
 * keep-out less) where it used to take 0.8 of the standoff; `kiter` ALREADY carried 1.15 on this
 * field and keeps exactly that rather than stacking a second factor onto it — a kiter that shifted
 * `opponentRangeRespect` twice would be a different, further-standing archetype than the one that
 * shipped. `opportunist` simply drops the shift: its old `standoffFraction: 1` was a factor of one,
 * a no-op that moved nothing, so there is nothing to re-express.
 *
 * WHAT THAT MAPPING ACTUALLY DELIVERS, stated exactly, because the first version of this comment
 * claimed it was "precisely the flavour `standoffFraction` carried" and it is not. `controller.ts`
 * computes `fightRange = max(ownComfort, kitReachOf(target).shortest * opponentRangeRespect)`.
 * Three consequences, all of them real:
 *
 * 1. AT EASY, `brawler` AND `kiter` ARE INDISTINGUISHABLE — not "differ only on
 *    `ramIntentChance`", which is what this comment used to say and which sends a tuner to move a
 *    knob and watch nothing happen. Every field either archetype shifts is dead at easy:
 *    `opponentRangeRespect` is 0 (0 x 0.8 and 0 x 1.15 are both 0), `retreatHpFraction` is 0 (0 x
 *    0.8 and 0 x 1.25 are both 0), and `ramIntentChance` — the one field whose VALUE does move,
 *    0.15 to 0.1875 for brawler and to 0.12 for kiter — REACHES NO BEHAVIOUR (see below).
 *    `rollPersonality` also draws `slotWeights` from the same stream positions whatever the
 *    archetype, so the two roll the same weights from the same seed. Two of five archetypes are
 *    behaviourally null at easy.
 *
 *    `ramIntentChance` HAS NO CONSUMER, and that is PRE-EXISTING, not phase D's doing.
 *    `controller.ts` draws it into `this.wantsRam` (~line 247) and the only other reference is
 *    `void this.wantsRam;` (~line 559), landed by "Replace the bot's scored goal catalog with
 *    situation-play" on `development/main` before this branch. The `rng()` draw behind it is real
 *    and must stay (H21 fixes the draw count); only its RESULT is discarded. It is recorded here
 *    rather than repaired because reconnecting a ram intent is a behaviour change, not a comment
 *    fix. Until it is reconnected, this field tunes nothing at any tier.
 * 2. AT HARD, KITER'S SHIFT IS SMALLER THAN IT READS. 0.9 x 1.15 = 1.035, and
 *    `opponentRangeRespect` is in `UNIT_INTERVAL_FIELDS`, so it saturates at 1.0 — an ~11% shift,
 *    not 15%.
 * 3. IT CANNOT MAKE A BRAWLER STAND CLOSER THAN A NEUTRAL BOT. The `max` FLOORS the fight range at
 *    the bot's own `preferredRangeOf` comfort, and this field only moves the other operand.
 *    `standoffFraction` scaled that comfort itself, so it could pull the bot inside it; nothing in
 *    the shipped profile can.
 *
 * So the flavour is narrower than the one that was deleted: it is "how much of the OPPONENT's
 * threat range I insist on clearing", live only at medium and hard and only in the standing-OFF
 * direction. Restoring the closing half would need a profile field that scales `ownComfort`, and
 * P35/P36 enumerate exactly which fields leave and which arrive — an archetype range knob is in
 * neither list, so it is deliberately NOT added here. It is recorded as a candidate for a future
 * tuning pass instead.
 */
const ARCHETYPES: Readonly<Record<PersonalityId, Shifts>> = Object.freeze({
  brawler: {
    opponentRangeRespect: 0.8, ramIntentChance: 1.25, retreatHpFraction: 0.8,
  },
  kiter: {
    retreatHpFraction: 1.25, ramIntentChance: 0.8,
    opponentRangeRespect: 1.15,
  },
  // `minShotValueFraction` down is the EV-era equivalent of the old `fireDisciplineChance` down: a
  // lower threshold takes shots a more careful tier would decline (Task 7, P14 replaced P36's field;
  // R20 made the threshold relative to the kit's own ceiling rather than absolute).
  sprayer: { minShotValueFraction: 0.8, burstGapTicks: 0.8, ultDisciplineChance: 0.8 },
  grudge: { vengefulness: 1.25, targetCommitTicks: 1.25, woundedBias: 0.8 },
  opportunist: { woundedBias: 1.25, ultDisciplineChance: 1.25 },
});

const IDS = Object.keys(ARCHETYPES) as PersonalityId[];

/**
 * The profile fields that are probabilities or fractions, and therefore may never leave [0, 1].
 *
 * `bot-profiles.test.ts` asserts that invariant of the AUTHORED table; without this list it stopped
 * being true of the profile the brain actually runs, because a shift can push a value past 1 — a
 * hard `opportunist` reached `ultDisciplineChance` 1.125 (0.9 x 1.25, inside the +-25% band, so
 * `clampToBand` had no reason to stop it). It saturated harmlessly, but a stated invariant that only
 * holds of the table and not of the rolled profile is not an invariant.
 *
 * KEPT BYTE-IDENTICAL, BY HAND, with `PROBABILITY_FIELDS` in `bot-profiles.test.ts` (R-M2). Nothing
 * typed holds the two lists in step — one is a `Set` here and the other a `const` tuple there — so
 * an entry added or removed on one side must be made on the other in the same edit. `standoffFraction`
 * and `deadbandFraction` came off BOTH when P35 deleted them (2026-09-07).
 */
const UNIT_INTERVAL_FIELDS: ReadonlySet<string> = new Set<keyof BotProfile>([
  "ultDisciplineChance", "ultWindowHpFraction", "woundedBias",
  "vengefulness", "retreatHpFraction",
  "ramIntentChance", "dodgeChance", "blunderChance", "idleFidgetChance",
  "hearChance", "deadRespect", "opponentRangeRespect", "cornerRespect", "incomingCarChance",
  "commitPenalty",
]);

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
 *
 * `startFrom` is the profile to build the rolled result on top of — the tier row by default, but a
 * controller constructed with a custom `options.profile` (a test override, or a future dev-tools
 * knob) passes its own profile here so a personality shift never clobbers a field the caller
 * deliberately set. The competence BAND a shifted field is clamped into is always the tier's own —
 * `clampToBand` reads `BOT_PROFILES[tier]`, never `startFrom` — so the override is preserved exactly
 * on every field the archetype does not touch, and the tier's guarantees hold on every field it does.
 */
export function rollPersonality(
  rng: Rng,
  tier: BotDifficulty,
  startFrom: BotProfile = BOT_PROFILES[tier],
): { personality: BotPersonality; profile: BotProfile } {
  const pick = rng();
  const weights: number[] = [];
  for (let i = 0; i < WEAPON_SLOT_CONFIG.maxWeaponSlots; i++) {
    // 0.5x to 1.5x: a real preference, but never a weapon the bot refuses to touch.
    weights.push(0.5 + rng());
  }

  const id = IDS[Math.min(Math.floor(pick * IDS.length), IDS.length - 1)]!;
  const shifts = ARCHETYPES[id];
  const tierBase = BOT_PROFILES[tier];
  const easier = EASIER[tier];

  const profile = { ...startFrom } as Record<keyof BotProfile, number>;
  for (const [key, factor] of Object.entries(shifts) as [keyof BotProfile, number][]) {
    profile[key] = clampToBand(
      tierBase[key], tierBase[key] * factor, easier ? BOT_PROFILES[easier][key] : undefined,
      UNIT_INTERVAL_FIELDS.has(key),
    );
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
 *
 * `unitInterval` additionally holds the result inside [0, 1]. It is applied LAST, after the band and
 * the neighbour bound, because it is a bound on what the number MEANS rather than on how far the
 * personality may move it: 1.125 is not a probability at all, whatever band it landed inside.
 */
function clampToBand(
  base: number,
  shifted: number,
  neighbour: number | undefined,
  unitInterval: boolean,
): number {
  const jitter = BRAIN_CONSTANTS.personalityJitter;
  const low = Math.min(base * (1 - jitter), base * (1 + jitter));
  const high = Math.max(base * (1 - jitter), base * (1 + jitter));
  let out = Math.min(Math.max(shifted, low), high);
  if (neighbour !== undefined) {
    // Never past the easier tier's value: a hard bot may drift toward medium but never reach it.
    if (neighbour > base) out = Math.min(out, neighbour);
    else if (neighbour < base) out = Math.max(out, neighbour);
  }
  if (unitInterval) out = Math.min(Math.max(out, 0), 1);
  return out;
}
