import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";

/**
 * A player's potential as his club reads it, one to five stars (the squad and the market), or a
 * range of them when only that much is known (an academy youngster, C-7 C7-42): the lowest filled,
 * up to the highest outlined, the rest faint.
 */
export default function PotentialStars({
  stars,
  range,
  size = "sm",
}: {
  stars?: number;
  range?: [number, number];
  /** `lg` for a youngster's card on the academy page (design HocVien.dc.html). */
  size?: "sm" | "lg";
}) {
  const { t } = useTranslation();
  const low = range ? range[0] : (stars ?? 0);
  const high = range ? range[1] : low;
  const label =
    range && low !== high
      ? t("online.squad.potentialStarsRange", { low, high })
      : t("online.squad.potentialStars", { stars: low });
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex text-accent-500 dark:text-accent-400"
    >
      {[1, 2, 3, 4, 5].map((at) => (
        <Star
          key={at}
          aria-hidden="true"
          data-star={at <= low ? "sure" : at <= high ? "maybe" : "none"}
          className={`${size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} ${at <= low ? "fill-current" : at <= high ? "" : "opacity-30"}`}
        />
      ))}
    </span>
  );
}
