import {
  CAR_TABLE,
  DRIVE_CONFIG,
  GameMode,
  accelOf,
  activeCarIds,
  forwardMaxSpeedOf,
  hpOf,
  massOf,
  reverseMaxSpeedOf,
  turnRateOf,
  weaponDamageOf,
  weaponDefOf,
  type CarId,
} from "@motor-combat-moba/shared";
import { modeLabel } from "./lobby-view.js";
import { secondsLeft } from "./reveal-view.js";

/**
 * Room state to the car select screen.
 *
 * Every number here is *derived* from the shared config tables, never transcribed from the design
 * handoff. The handoff quotes "Rectangle 120 + 8x30 = 360 u/s" as a worked example — that arithmetic
 * belongs to the old `baseMaxSpeed 120 / speedPerRating 30` config and to the chassis then called
 * Rectangle (now Mirage), so it is quoted here as history, not as a live figure. No test pins that
 * number: `car-select-view.test.ts` checks this panel's "Top speed" row against `forwardMaxSpeedOf`,
 * so retuning `speedPerRating` moves the panel and the sim together instead of leaving the screen
 * quietly lying about the car.
 */

/** The three summary bars on a card. The panel carries the detail; the card stays readable. */
export const CAR_BARS = ["speed", "attack", "hp"] as const;
export type CarBarKey = (typeof CAR_BARS)[number];

const URGENT_SECONDS = 10;

export interface StatBar {
  key: CarBarKey;
  /** 0-100, and so the rating verbatim — ratings are already on that scale. */
  percent: number;
}

export interface CarCard {
  id: CarId;
  name: string;
  selected: boolean;
  image: string;
  bars: StatBar[];
}

export interface StatRow {
  label: string;
  value: string;
}

export interface CarSelectView {
  modeLabel: string;
  clock: string;
  secondsLeft: number;
  urgent: boolean;
  cars: CarCard[];
  selectedName: string;
  stats: StatRow[];
  canLockIn: boolean;
  lockLabel: string;
}

export interface CarSelectViewState {
  mode: GameMode;
  tick: number;
  carSelectDeadlineTick: number;
}

/** One decimal at most, and no trailing `.0` — 0.5 s reads better than 0.500 s or 1.0 s. */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function fullStatsFor(id: CarId): StatRow[] {
  const def = CAR_TABLE[id];
  return [
    { label: "Top speed", value: `${trim(forwardMaxSpeedOf(id))} u/s` },
    { label: "Reverse speed", value: `${trim(reverseMaxSpeedOf(id))} u/s` },
    { label: "Acceleration", value: `${trim(accelOf(id))} u/s²` },
    { label: "Turn rate", value: `${trim(turnRateOf(id))} rad/s` },
    { label: "Turn radius", value: `${trim(forwardMaxSpeedOf(id) / turnRateOf(id))} u` },
    { label: "Hull HP", value: String(hpOf(id)) },
    { label: "Mass", value: String(massOf(id)) },
    { label: "Hull size", value: `${DRIVE_CONFIG.carWidth} x ${DRIVE_CONFIG.carHeight}` },
    // One row per equipped weapon, derived through the same `weaponDamageOf` the sim fires with.
    // The chassis `attack` rating is invisible on its own — this is where it becomes a number the
    // player can compare between cards.
    ...def.weapons.map((weaponId) => ({
      label: `${weaponDefOf(weaponId).name} damage`,
      value: String(weaponDamageOf(id, weaponId)),
    })),
  ];
}

function clockLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function carSelectView(
  state: CarSelectViewState,
  selectedId: CarId,
  locked: boolean,
): CarSelectView {
  const remaining = secondsLeft(state.carSelectDeadlineTick, state.tick);

  return {
    modeLabel: modeLabel(state.mode),
    clock: clockLabel(remaining),
    secondsLeft: remaining,
    urgent: remaining <= URGENT_SECONDS,
    cars: activeCarIds().map((id) => ({
      id,
      name: CAR_TABLE[id].name,
      selected: id === selectedId,
      image: `url("art/cars/${id}.png")`,
      bars: CAR_BARS.map((key) => ({ key, percent: CAR_TABLE[id][key] })),
    })),
    selectedName: CAR_TABLE[selectedId].name,
    stats: fullStatsFor(selectedId),
    canLockIn: !locked,
    lockLabel: locked ? "Locked in" : "Lock in",
  };
}
