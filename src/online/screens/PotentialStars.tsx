import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";

/** A player's potential as his club reads it, one to five stars (the squad and the market). */
export default function PotentialStars({ stars }: { stars: number }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t("online.squad.potentialStars", { stars })}
      className="inline-flex text-accent-500 dark:text-accent-400"
    >
      {[1, 2, 3, 4, 5].map((at) => (
        <Star
          key={at}
          aria-hidden="true"
          className={`h-3.5 w-3.5 ${at <= stars ? "fill-current" : "opacity-30"}`}
        />
      ))}
    </span>
  );
}
