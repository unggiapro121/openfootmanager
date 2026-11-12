import { useTranslation } from "react-i18next";
import { translatePositionAbbreviation } from "../../components/squad/SquadTab.helpers";
import type { PositionRating } from "../api/engine";

/** Ratings by position shown beside a player's attributes. */
const RATINGS_SHOWN = 5;

/**
 * A player's best positions with his OVR at each (the market's chips, C-5): the five highest,
 * best first. Nothing when the server sent none.
 */
export default function PositionRatingChips({ ratings }: { ratings: readonly PositionRating[] }) {
  const { t } = useTranslation();
  const best = [...ratings].sort((a, b) => b.ovr - a.ovr).slice(0, RATINGS_SHOWN);
  if (best.length === 0) return null;
  return (
    <ul aria-label={t("online.market.positionRatings")} className="flex flex-wrap gap-2">
      {best.map((rating) => (
        <li
          key={rating.position}
          className="rounded bg-gray-100 px-2 py-1 text-xs dark:bg-navy-700"
        >
          {translatePositionAbbreviation(t, rating.position)} <strong>{rating.ovr}</strong>
        </li>
      ))}
    </ul>
  );
}
