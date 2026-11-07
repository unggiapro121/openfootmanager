import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type TrophyTone, trophyTone } from "./honoursView";

/** Each metal's colour, in both themes (C20-3). */
const TONE: Record<TrophyTone, string> = {
  bronze: "text-amber-700 dark:text-amber-600",
  silver: "text-slate-400 dark:text-slate-300",
  gold: "text-accent-500 dark:text-accent-400",
  platinum: "text-cyan-500 dark:text-cyan-300",
};

/** A league's cup, in the metal of its level. Decorative: the words beside it name it. */
export function TrophyIcon({
  level,
  className = "h-12 w-12",
}: {
  level: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      data-tone={trophyTone(level)}
      className={`${TONE[trophyTone(level)]} ${className}`}
    >
      <path
        fill="currentColor"
        d="M14 6h20v4h7v5c0 6-4 10-9.5 10.8A10 10 0 0 1 26 31.5V36h5a3 3 0 0 1 3 3v3H14v-3a3 3 0 0 1 3-3h5v-4.5a10 10 0 0 1-5.5-5.7C11 25 7 21 7 15v-5h7V6Zm-3 8v1c0 3.6 2 6.2 5 7.2-.6-1.6-1-3.4-1-5.2v-3h-4Zm22 0v3c0 1.8-.4 3.6-1 5.2 3-1 5-3.6 5-7.2v-1h-4Z"
      />
      <path fill="currentColor" opacity="0.35" d="M18 10h4v8a4 4 0 0 1-2 3.5A6 6 0 0 1 18 17v-7Z" />
    </svg>
  );
}

/** A medal: a promotion's, or a player's champion medal and awards. */
export function MedalIcon({
  level,
  className = "h-10 w-10",
}: {
  level: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      data-tone={trophyTone(level)}
      className={`${TONE[trophyTone(level)]} ${className}`}
    >
      <path fill="currentColor" opacity="0.45" d="M14 4h8l4 12h-8L14 4Zm12 0h8l-4 12h-8l4-12Z" />
      <circle cx="24" cy="30" r="13" fill="currentColor" />
      <circle
        cx="24"
        cy="30"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.4"
      />
    </svg>
  );
}

/** The star a club carries in the table while it holds last season's title (Dtr-1, C20-4). */
export function DefendingStar() {
  const { t } = useTranslation();
  const label = t("online.honours.defending");
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0">
      <Star
        aria-hidden="true"
        className="h-3.5 w-3.5 fill-accent-400 text-accent-500 dark:text-accent-400"
      />
    </span>
  );
}
