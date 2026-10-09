import { TICK_RATE_HZ } from "@motor-combat-moba/shared";
import type { ArenaCard } from "./arena-cards.js";

/** Room state to the arena select screen (AR28-AR35). No Phaser, no DOM. */

export type ArenaSelectStage = "choosing" | "roulette" | "revealed";

/** The clock turns to the accent colour for the last few seconds (AR28). */
const URGENT_SECONDS = 3;

export interface ArenaSelectInput {
  cards: readonly ArenaCard[];
  modeLabel: string;
  highlightId: string;
  chosenId: string | null;
  isHost: boolean;
  stage: ArenaSelectStage;
  secondsLeft: number;
  revealSecondsLeft: number;
}

export interface ArenaSelectCardView extends ArenaCard {
  highlighted: boolean;
}

export interface ArenaSelectView {
  modeLabel: string;
  clock: string;
  urgent: boolean;
  cards: ArenaSelectCardView[];
  status: string;
  canAct: boolean;
  stage: ArenaSelectStage;
  chosen: ArenaCard | null;
  revealLabel: string;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function arenaSelectView(input: ArenaSelectInput): ArenaSelectView {
  return {
    modeLabel: input.modeLabel,
    clock: formatClock(input.secondsLeft),
    urgent: input.stage === "choosing" && input.secondsLeft <= URGENT_SECONDS,
    cards: input.cards.map((c) => ({ ...c, highlighted: c.id === input.highlightId })),
    status: input.isHost ? "Choose an arena, then Select." : "The host is choosing the arena.",
    canAct: input.isHost && input.stage === "choosing",
    stage: input.stage,
    chosen: input.cards.find((c) => c.id === input.chosenId) ?? null,
    revealLabel: `Car select in ${Math.max(0, input.revealSecondsLeft)}`,
  };
}

/**
 * Whether a random pick's roulette still has time to play (AR34): the reveal's plain share is its
 * LAST `revealSeconds`, so anything before that is the roulette's.
 */
export function inRouletteWindow(tick: number, revealEndsTick: number, revealSeconds: number): boolean {
  return tick < revealEndsTick - Math.ceil(revealSeconds * TICK_RATE_HZ);
}
