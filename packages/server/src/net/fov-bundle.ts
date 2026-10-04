import {
  assembleModeConfig,
  modeConfigOf,
  type GameMode,
  type ModeConfig,
} from "@motor-combat-moba/shared";

/**
 * A mode's shipped bundle with `camera.fov.enabled` turned on (and, optionally, its spectate rule
 * replaced) — for the measurements and tests of interest management (Phase G). No shipped mode turns
 * FOV on, so this is the only way to reach the filtering path. `applyOverrides` cannot reach
 * `camera.*` (its tuning roots stop at the drive/weapon tables), so the bundle is assembled from the
 * shipped tables with the camera edited — the same thing a mode folder's override would produce.
 *
 * Never handed to a room by production code: the netsim's FOV run (`NetsimOptions.fov`) and the leak
 * tests are its only callers.
 */
export function fovOnBundle(mode: GameMode, spectate?: ModeConfig["camera"]["spectate"]): ModeConfig {
  const base = modeConfigOf(mode);
  return assembleModeConfig(mode, {
    ...base,
    camera: {
      ...base.camera,
      fov: { ...base.camera.fov, enabled: true },
      spectate: spectate ?? base.camera.spectate,
    },
  });
}
