import { RoomPhase } from "@motor-combat-moba/shared";
import { hintSlotOrder, SLOT_KEYS } from "../config/slot-keys.js";

/**
 * The "how do I drive this" line along the bottom of the arena — key pills for both bindings and a
 * trailing label, centred under the floor.
 *
 * Layout is pure and lives here for the same reason `weapon-hud.ts` and `roster-panel.ts` are: the
 * arithmetic that decides where a pill lands is the part worth testing, and `ArenaScene` should be
 * left with nothing but Phaser calls. Nothing in this file knows what a `Text` is — widths come in
 * already MEASURED, exactly as `drawHudSlot` sizes its key pill from `keyText.width` rather than
 * from a reserved column. A pill sized from a guess is a pill that is wrong in one font.
 */

/** The letter bindings, in the order a driver's left hand sits on them. */
export const MOVEMENT_KEYS = ["W", "A", "S", "D"] as const;

/**
 * The arrow bindings. `arena-input.ts` ORs the two sets — each side is "arrows OR WASD" — so the
 * hint has to print both or it teaches half the control scheme.
 */
export const MOVEMENT_ARROWS = ["↑", "←", "↓", "→"] as const;

/** Sits between the two clusters. A word, not a slash, so the row reads as a sentence. */
export const MOVEMENT_JOINER = "or";

/** Closes the row. Names the verb, because eight key caps alone do not say what they are for. */
export const MOVEMENT_LABEL = "to move";

/**
 * The action row's keys for a chassis carrying `abilities` weapons, derived from `SLOT_KEYS` so a
 * rebind can never leave the hint teaching keys the game stopped listening to.
 *
 * Parameterised by kit size (VS19): with variable kits a module constant would teach a two-weapon
 * chassis a binding for a slot it does not carry. The basic attack is taught FIRST and is the only
 * place its binding appears — the gutter pill never carries it (BA19) — so dropping it when
 * `BASIC_ATTACK_CONFIG.enabled` is false must remove the pill, not leave a dead one.
 */
export function actionKeysFor(abilities: number, enabled: boolean): readonly string[] {
  return hintSlotOrder(enabled, abilities).map((slot) => SLOT_KEYS[slot]!.glyph);
}

/**
 * No alternates (TR29). The old two-binding scheme gave every ability slot a home-row key AND a
 * mouse-hand alternate, which is what `actionKeysFor`/`actionAltsFor` used to split between them —
 * `buildHintRow` drew the two as "keys or alts". The one-layout controls pass left every slot with
 * exactly one input, so there is nothing left for a second cluster to show. Kept as its own
 * function, rather than deleted, so `buildHintRow`'s shared (keys, alts, label) shape — still live
 * for the movement row's WASD/arrows pair — has an explicit "this row has no alternates" value to
 * pass, instead of a caller improvising an empty array inline.
 */
export function actionAltsFor(_abilities: number, _enabled: boolean): readonly string[] {
  return [];
}

/**
 * Closes the action row, the way `MOVEMENT_LABEL` closes the movement one.
 *
 * There is deliberately no `ACTION_KEYS`/`ACTION_ALTS` constant beside it. Those existed for "a
 * caller with no chassis in hand" and were bound to `WEAPON_SLOT_CONFIG.maxAbilitySlots`; once
 * `ArenaScene` started passing the driven car's own ability count (VS19) nothing in production read
 * them, and a `N`-bound row that no screen draws is a row that can rot into teaching keys the
 * player's chassis does not have. Call `actionKeysFor`/`actionAltsFor` with a real count.
 */
export const ACTION_LABEL = "to fire";

/**
 * One thing on the row. A `pill` gets padding and a rounded plate behind it; a `label` is bare text
 * on the floor. `width` is the measured text width, never the drawn width — `placeMovementHint`
 * adds the padding, so a caller that pre-padded would double it.
 */
export interface HintItem {
  kind: "pill" | "label";
  width: number;
}

/** Where one item lands: `x` is its LEFT edge and `width` its drawn width, padding included. */
export interface HintPlacement {
  x: number;
  width: number;
}

export interface MovementHintLayout {
  placements: HintPlacement[];
  totalWidth: number;
}

export interface MovementHintMetrics {
  /** Horizontal padding inside a pill, per side. */
  padX: number;
  /** Space between neighbouring items. */
  gap: number;
  /** The x the finished row is centred on. */
  centerX: number;
}

/**
 * Lay the row out left to right and centre the whole run on `centerX`.
 *
 * Centred as ONE run rather than per cluster: the two key groups have different measured widths
 * (arrow glyphs are not letter-width in most faces), so centring anything but the total would leave
 * the row visibly off-axis under a countdown that is itself centred on the arena.
 *
 * `centerX` is the arena's middle, not the canvas's — the weapon gutter is off to the right of the
 * floor, and a row centred on the canvas would sit off-centre over the ground players are looking
 * at. Same reason `countdownText` is placed on `ARENA_VIEW_WIDTH / 2`.
 */
export function placeMovementHint(
  items: readonly HintItem[],
  metrics: MovementHintMetrics,
): MovementHintLayout {
  const widths = items.map((item) =>
    item.kind === "pill" ? item.width + metrics.padX * 2 : item.width,
  );
  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) + metrics.gap * Math.max(0, items.length - 1);

  let x = metrics.centerX - totalWidth / 2;
  const placements: HintPlacement[] = [];
  for (const width of widths) {
    placements.push({ x, width });
    x += width + metrics.gap;
  }
  return { placements, totalWidth };
}

/**
 * Whether the hint belongs on screen: during the countdown, and at no other time.
 *
 * The countdown is the one moment a driver is looking at the screen with nothing to do, so it is
 * where a control hint is read rather than merely drawn. It leaves at the green light, which also
 * means it can never compete with a fight for the middle of the floor.
 *
 * **No spectating guard, deliberately.** This row is the spectate banner's line and style, so the
 * two overlapping would be a real collision — but they cannot: `isSpectating` returns false unless
 * the phase is `MATCH`, and this returns false unless it is `COUNTDOWN`. The separation is a fact
 * about the phases rather than a rule either side enforces, so a `spectating` parameter here would
 * be an argument that could never change the answer. If the hint ever extends into `MATCH`, that
 * guard has to come back with it.
 */
export function showMovementHint(phase: RoomPhase): boolean {
  return phase === RoomPhase.COUNTDOWN;
}

/** The row's items in order, given the measured width of each piece of text. */
export function movementHintItems(
  keyWidths: readonly number[],
  joinerWidth: number,
  arrowWidths: readonly number[],
  labelWidth: number,
): HintItem[] {
  return [
    ...keyWidths.map((width): HintItem => ({ kind: "pill", width })),
    { kind: "label", width: joinerWidth },
    ...arrowWidths.map((width): HintItem => ({ kind: "pill", width })),
    { kind: "label", width: labelWidth },
  ];
}
