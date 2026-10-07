import type { ManagerData, PlayStyleId } from "../store/types";

/** Every play style, in the order the game lists them. */
export const PLAY_STYLE_IDS: readonly PlayStyleId[] = [
  "Balanced",
  "Attacking",
  "Defensive",
  "Possession",
  "Counter",
  "HighPress",
];

/** Mastery the backend gives a manager it has nothing else for: the style as designed. */
const NEUTRAL_MASTERY = 50;

/** How well `manager` gets `style` across, 1–100. Display only: the engine applies it. */
export function getPlayStyleMastery(manager: ManagerData, style: PlayStyleId): number {
  return manager.play_style_mastery?.[style] ?? NEUTRAL_MASTERY;
}

/**
 * The style `manager` is strongest in, earlier styles winning ties — the same
 * answer as `PlayStyleMastery::best_style` in the backend.
 */
export function getBestPlayStyle(manager: ManagerData): { style: PlayStyleId; value: number } {
  return PLAY_STYLE_IDS.reduce<{ style: PlayStyleId; value: number }>(
    (best, style) => {
      const value = getPlayStyleMastery(manager, style);
      return value > best.value ? { style, value } : best;
    },
    { style: "Balanced", value: getPlayStyleMastery(manager, "Balanced") },
  );
}
