import type { PositionRating } from "../store/types";

/** The backend's rating at `position` among a player's `ratings`, if any. */
export function ratingAtPosition(
  ratings: readonly PositionRating[] | undefined,
  position: string,
): PositionRating | undefined {
  return ratings?.find((rating) => rating.position === position);
}
