/**
 * The dev playground's tuning VOCABULARY, and nothing else. This file is types only.
 *
 * It used to hold `setTuning`, which assembled a `ModeConfig` from `BRAWL_TABLES` with the overrides
 * written in and `installMode`d it **process-wide** — so a playground holding overrides re-balanced
 * every other room in the server, and `PracticeRoom` carried a hand-written rule (plus a test
 * asserting on its own source text) saying it must never call it. That whole hazard is gone with the
 * function: `modes/overlay.ts`'s `applyOverrides(base, overrides)` is its successor, and it is
 * **pure** — it returns a tuned sibling bundle, installs nothing, mutates nothing, and each call
 * starts fresh from `base` so overrides replace rather than accumulate. `PlaygroundRoom` holds the
 * result as its own `this.modeConfig`; `PlaygroundScene` holds it for the tab's life. Nothing in
 * production installs a bundle at all.
 *
 * The two types below stayed because they are the shared vocabulary of that feature — the net
 * message types, the playground scene, `applyOverrides` itself and `tuning-walker.ts` all speak
 * them — and moving them would churn every one of those imports for nothing. `tuning-walker.ts`,
 * which ENUMERATES these paths and never writes one, is likewise untouched and still lives beside
 * this file.
 */

export type TuningValue = number | boolean | string;

/**
 * Flat dot-paths into the seven balance tables: `"car.mirage.speed"`, `"drive.baseTurnRate"`,
 * `"ram.attackerLockMs"`, `"combat.hpPerRating"`, `"impulse.spinScale"`, `"weapon.predator.damage"`,
 * `"turret.turnRateDegPerSec"`, `"car.mirage.turretMount.x"`,
 * `"weapon.pepperbox.hitbox.radiusAlong"`. Numeric segments index arrays
 * (`"weapon.predator.applies.0.durationMs"`).
 *
 * They are resolved against the tables of the bundle being tuned (`applyOverrides`'s `base`), never
 * against the raw `config/` globals — a path is valid for the MODE it is applied to.
 */
export type TuningOverrides = Readonly<Record<string, TuningValue>>;
