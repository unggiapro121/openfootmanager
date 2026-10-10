import { buildPitchRows } from "../squad/SquadTab.helpers";
import type { EnginePlayerData, PositionFit, PositionRating } from "./types";

/**
 * The pitch position of each XI entry under `formation` (entry i plays slot i),
 * or null when `count` players do not fill it — a partial XI is not
 * slot-aligned, and reading slots off it would mislabel everyone after the gap.
 */
export function slotPositionsOf(formation: string, count: number): string[] | null {
  const slots = buildPitchRows(formation).flatMap((row) => row.positions);
  return slots.length === count ? slots : null;
}

/** The backend's rating of `player` at `position`, if it sent one. */
export function ratingAt(player: EnginePlayerData, position: string): PositionRating | undefined {
  return player.position_ratings?.find((rating) => rating.position === position);
}

/** The position `player` is rated Natural at. */
export function naturalPositionOf(player: EnginePlayerData): string | undefined {
  return player.position_ratings?.find((rating) => rating.fit === "Natural")?.position;
}

const FIT_TONE: Record<PositionFit, string> = {
  Natural: "text-primary-600 dark:text-primary-400",
  Adapted: "text-accent-600 dark:text-accent-400",
  Unfamiliar: "text-red-600 dark:text-red-400",
};

/** Text colour for a familiarity: green at home, amber adapted, red out of position. */
export function fitToneClass(fit: PositionFit): string {
  return FIT_TONE[fit];
}
