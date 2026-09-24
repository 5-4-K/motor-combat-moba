import {
  cars,
  drive,
  GameMode,
  activeCarIds,
  chassisTakenByTeammate,
  dragRateOf,
  engineAccelOf,
  forwardMaxSpeedOf,
  hpOf,
  ramAttackOf,
  ramDefenceOf,
  reverseAccelOf,
  turnRateOf,
  uniqueChassisApplies,
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
  /** A teammate has already locked this chassis, in a mode where `uniqueChassisApplies` (CQ32). */
  taken: boolean;
  /** The teammate's name, or "" when `taken` is false. */
  takenBy: string;
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

export interface CarSelectViewPlayer {
  sessionId: string;
  name: string;
  team: number;
  lockedCarId: string;
}

export interface CarSelectViewState {
  mode: GameMode;
  tick: number;
  carSelectDeadlineTick: number;
  players: readonly CarSelectViewPlayer[];
}

/** One decimal at most, and no trailing `.0` — 0.5 s reads better than 0.500 s or 1.0 s. */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function fullStatsFor(id: CarId): StatRow[] {
  const def = cars()[id];
  return [
    { label: "Top speed", value: `${trim(forwardMaxSpeedOf(id))} u/s` },
    // CHANGED by the Unity drive-model port (car-physics-port stage 1 Task 3): there is no
    // authored reverse top speed any more, only the equilibrium `reverseAccel / dragRate` — the
    // same asymptote `stepDrive` itself settles at, not a separately-tuned ratio.
    { label: "Reverse speed", value: `${trim(reverseAccelOf(id) / dragRateOf(id))} u/s` },
    { label: "Acceleration", value: `${trim(engineAccelOf(id))} u/s²` },
    { label: "Turn rate", value: `${trim(turnRateOf(id))} rad/s` },
    { label: "Turn radius", value: `${trim(forwardMaxSpeedOf(id) / turnRateOf(id))} u` },
    { label: "Hull HP", value: String(hpOf(id)) },
    // Two rows, not one, since stage 3 of the car-physics rework replaced the single `mass` rating
    // with a `ramAttack`/`ramDefence` pair (spec R11). One number could not tell a player that a
    // chassis hits hard AND is easy to shove, and those are now independently tunable — so showing
    // one figure would hide exactly the choice the split exists to offer.
    //
    // Named for what they DO in a collision rather than after the config fields, which is the rule
    // every row on this card follows ("Hull HP", not `hp * hpPerRating`). Raw 0-100 ratings, unscaled:
    // the contest reads them unscaled too, so there is no derived unit to show and a rating compares
    // straight across the three cards.
    { label: "Ram power", value: String(ramAttackOf(id)) },
    { label: "Ram resistance", value: String(ramDefenceOf(id)) },
    { label: "Hull size", value: `${drive().carWidth} x ${drive().carHeight}` },
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

/**
 * A pure signature of the roster's claims (CQ32 review fix): `sessionId:team:lockedCarId` per
 * player, sorted so row order never matters, joined into one string. `CarSelectScene` compares this
 * against the last one it saw to decide whether a teammate's lock changed and the taken cards need
 * a redraw — the same "cheap key, not a deep compare" trick `lobbyRenderSignature` uses for the
 * lobby screen. Mirrors `chassisTakenByTeammate`'s own three fields exactly, so nothing this
 * predicate could ever act on is left out of the key.
 */
export function claimsSignature(players: readonly CarSelectViewPlayer[]): string {
  return players
    .map((p) => `${p.sessionId}:${p.team}:${p.lockedCarId}`)
    .sort()
    .join(";");
}

export function carSelectView(
  state: CarSelectViewState,
  selectedId: CarId,
  locked: boolean,
  selfId = "",
): CarSelectView {
  const remaining = secondsLeft(state.carSelectDeadlineTick, state.tick);
  const unique = uniqueChassisApplies(state.mode);
  const team = state.players.find((p) => p.sessionId === selfId)?.team ?? 0;

  return {
    modeLabel: modeLabel(state.mode),
    clock: clockLabel(remaining),
    secondsLeft: remaining,
    urgent: remaining <= URGENT_SECONDS,
    cars: activeCarIds().map((id) => {
      // Only a TEAMMATE'S lock greys a card — never the local player's own, never an enemy's
      // (CQ30). `chassisTakenByTeammate` is the one shared predicate every reader of this rule
      // uses; the teammate itself is found the same way, to name who has it.
      const takenBy = unique
        ? state.players.find((p) => p.sessionId !== selfId && p.team === team && p.lockedCarId === id)
        : undefined;
      return {
        id,
        name: cars()[id].name,
        selected: id === selectedId,
        image: `url("art/cars/${id}.png")`,
        bars: CAR_BARS.map((key) => ({ key, percent: cars()[id][key] })),
        taken: takenBy !== undefined,
        takenBy: takenBy?.name ?? "",
      };
    }),
    selectedName: cars()[selectedId].name,
    stats: fullStatsFor(selectedId),
    canLockIn: !locked && !(unique && chassisTakenByTeammate(selectedId, team, selfId, state.players)),
    lockLabel: locked ? "Locked in" : "Lock in",
  };
}
