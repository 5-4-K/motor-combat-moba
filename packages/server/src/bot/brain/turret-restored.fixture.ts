// Test-only. A copy of shared's `modes/test-setup.ts` `turretRestored` (that file is not exported
// from the package, so server tests cannot import it).
//
// The turret system is switched off in every shipped mode (no weapon row carries `turret`), but its
// machinery stays in the code and stays tested. This rebuilds a bundle with `turret: { additionalOffset: 0 }`
// put back on exactly the rows that had it, so the bot's turret solving, the shooter and the tick
// pipeline's turret press run on the bundle their tests were written against. Keep the id list in
// step with shared's `TURRET_RESTORED_WEAPON_IDS`.
import { assembleModeConfig, type ModeConfig } from "@motor-combat-moba/shared";

const TURRET_RESTORED_WEAPON_IDS: readonly string[] = [
  "basic-attack-bullseye",
  "basic-attack-mirage",
  "basic-attack-bastion",
  "basic-attack-taurus",
  "basic-attack-anvil",
  "basic-attack-prowler",
  "basic-attack-cleaver",
  "basic-attack-skorpios",
  "basic-attack-caprico",
  "predator",
  "magmablast",
  "thumper",
  "roadblock",
  "fury-horn",
];

export function turretRestored(config: ModeConfig): ModeConfig {
  const weapons: Record<string, unknown> = { ...config.weapons };
  for (const id of TURRET_RESTORED_WEAPON_IDS) {
    const row = weapons[id];
    if (row === undefined) throw new Error(`turretRestored: no weapon row "${id}"`);
    weapons[id] = { ...(row as object), turret: { additionalOffset: 0 } };
  }
  return assembleModeConfig(config.id, { ...config, weapons: weapons as unknown as ModeConfig["weapons"] });
}
