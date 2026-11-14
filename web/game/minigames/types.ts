import type { ChecklistItem, ChecklistStyle, Difficulty, Fact } from "../types";

export interface MinigameResult {
  /** 0..100 */
  score: number;
  correct: number;
  total: number;
  mistakes: number;
  seconds: number;
}

export interface MinigameProps {
  items: ChecklistItem[];
  difficulty: Difficulty;
  /** Mission facts, used for "did you know" rewards. */
  facts?: Fact[];
  /** Seed for deterministic shuffles (use plan.seed). */
  seed?: number;
  /** Someone else is playing: show live progress only. */
  watching?: boolean;
  /** Called after every step so other players can follow along. */
  onProgress?: (p: { done: number; total: number; mistakes: number }) => void;
  onDone: (r: MinigameResult) => void;
}

export type MinigameComponent = (p: MinigameProps) => React.ReactNode;
export type { ChecklistStyle };
