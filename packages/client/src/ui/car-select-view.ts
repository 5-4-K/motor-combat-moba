import {
  CAR_TABLE,
  DRIVE_CONFIG,
  GameMode,
  forwardMaxSpeedOf,
  hpOf,
  reverseMaxSpeedOf,
  type CarId,
} from "@motor-combat-moba/shared";
import { modeLabel } from "./lobby-view.js";
import { secondsLeft } from "./reveal-view.js";

/**
 * Room state to the car select screen.
 *
 * Every number here is *derived* from the shared config tables, never transcribed from the design
 * handoff. The handoff quotes "Rectangle 120 + 8x30 = 360 u/s" as a worked example, and a test pins
 * that exact figure — but it is checked against `forwardMaxSpeedOf`, so retuning `speedPerRating`
 * moves the panel and the sim together instead of leaving the screen quietly lying about the car.
 */

/** The three summary bars on a card. The panel carries the detail; the card stays readable. */
export const CAR_BARS = ["speed", "strength", "hp"] as const;
export type CarBarKey = (typeof CAR_BARS)[number];

const URGENT_SECONDS = 10;

export interface StatBar {
  key: CarBarKey;
  /** 0-100, straight from the raw 0-10 rating. */
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
  return [
    { label: "Top speed", value: `${trim(forwardMaxSpeedOf(id))} u/s` },
    { label: "Reverse speed", value: `${trim(reverseMaxSpeedOf(id))} u/s` },
    { label: "Turn rate", value: `${trim(DRIVE_CONFIG.turnRate)} rad/s` },
    { label: "Hull HP", value: String(hpOf(id)) },
    { label: "Hull size", value: `${DRIVE_CONFIG.carWidth} x ${DRIVE_CONFIG.carHeight}` },
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
    cars: (Object.keys(CAR_TABLE) as CarId[]).map((id) => ({
      id,
      name: CAR_TABLE[id].name,
      selected: id === selectedId,
      image: `url("art/cars/${id}.png")`,
      bars: CAR_BARS.map((key) => ({ key, percent: CAR_TABLE[id][key] * 10 })),
    })),
    selectedName: CAR_TABLE[selectedId].name,
    stats: fullStatsFor(selectedId),
    canLockIn: !locked,
    lockLabel: locked ? "Locked in" : "Lock in",
  };
}
