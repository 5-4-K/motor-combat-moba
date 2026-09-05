import { WEAPON_SLOT_CONFIG, type BotDifficulty } from "@motor-combat-moba/shared";
import { BOT_PROFILES, BRAIN_CONSTANTS, type BotProfile } from "../../config/bot-profiles.js";
import type { Rng } from "../rng.js";
import type { BotPersonality, PersonalityId } from "../types.js";

/** Which parameters an archetype may shift, and by how much (H47). 1 leaves a value alone. */
type Shifts = Partial<Record<keyof BotProfile, number>>;

const ARCHETYPES: Readonly<Record<PersonalityId, Shifts>> = Object.freeze({
  brawler: {
    standoffFraction: 0.8, ramIntentChance: 1.25, retreatHpFraction: 0.8, orbitBias: 0.8,
  },
  kiter: {
    standoffFraction: 1.25, orbitBias: 1.25, retreatHpFraction: 1.25, ramIntentChance: 0.8,
    opponentRangeRespect: 1.15,
  },
  sprayer: { fireDisciplineChance: 0.8, burstGapTicks: 0.8, ultDisciplineChance: 0.8 },
  grudge: { vengefulness: 1.25, targetCommitTicks: 1.25, woundedBias: 0.8 },
  opportunist: { woundedBias: 1.25, ultDisciplineChance: 1.25, standoffFraction: 1 },
});

const IDS = Object.keys(ARCHETYPES) as PersonalityId[];

/**
 * The profile fields that are probabilities or fractions, and therefore may never leave [0, 1].
 *
 * `bot-profiles.test.ts` asserts that invariant of the AUTHORED table; without this list it stopped
 * being true of the profile the brain actually runs, because a shift can push a value past 1 — a
 * hard `opportunist` reached `ultDisciplineChance` 1.125 (0.9 x 1.25, inside the +-25% band, so
 * `clampToBand` had no reason to stop it). It saturated harmlessly, but a stated invariant that only
 * holds of the table and not of the rolled profile is not an invariant. Kept in step with the same
 * list in that test.
 */
const UNIT_INTERVAL_FIELDS: ReadonlySet<string> = new Set<keyof BotProfile>([
  "fireDisciplineChance", "ultDisciplineChance", "ultWindowHpFraction", "woundedBias",
  "vengefulness", "standoffFraction", "deadbandFraction", "orbitBias", "retreatHpFraction",
  "ramIntentChance", "dodgeChance", "blunderChance", "idleFidgetChance", "leadFactor",
  "hearChance", "deadRespect", "opponentRangeRespect", "cornerRespect", "incomingCarChance",
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
