import { DEFAULT_GAME_MODE, modeConfigOrDefault, type ModeConfig } from "@motor-combat-moba/shared";

/**
 * The bundle the playground TUNES — the one answer, in one place, for the panel, the validator and
 * the write.
 *
 * Not the bundle that is INSTALLED. During a playground session `cfg()` returns whatever
 * `PlaygroundScene.syncTuning` last installed, which is the TUNED sibling; a panel that built its
 * ranges and its `shipped` values from that would move its own goalposts with every drag, and
 * `isAtShipped` would report a dragged slider as untouched. Every field the panel shows has to
 * describe the PRISTINE base a write is applied against, which is this.
 *
 * It is `DEFAULT_GAME_MODE`'s bundle because that is the base `PlaygroundRoom.applyTuningMessage`
 * builds its `applyOverrides` clone from — the playground has no mode picker, and the two sides
 * must name the same bundle or the panel would offer a path the server rejects. **When the
 * playground grows a mode picker, this and that one line in `PlaygroundRoom` are the pair that move
 * together.**
 *
 * A function, never a module-level `const`: `modeConfigOrDefault` is a registry read, and a
 * module-scope call would run at import time and freeze a value before anything had a chance to say
 * which mode this session is. (`MODE_TABLE`'s bundles are assembled once and frozen, so every call
 * returns the same object — which is what lets `tunableFields`'s bundle-keyed cache hit every
 * time.)
 */
export function tuningBaseConfig(): ModeConfig {
  return modeConfigOrDefault(DEFAULT_GAME_MODE);
}
