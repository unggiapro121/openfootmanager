import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useGameStore } from "../../store/gameStore";

interface MatchScoreButtonProps {
  fixtureId: string;
  /** The score as the list shows it: home - away, or for - against. */
  children: ReactNode;
  className?: string;
}

/**
 * A played fixture's score that opens its match details. The score itself names
 * the button, so a list of results reads as scores, not as one repeated label.
 */
export default function MatchScoreButton({
  fixtureId,
  children,
  className = "",
}: MatchScoreButtonProps) {
  const { t } = useTranslation();
  const openMatchDetail = useGameStore((state) => state.openMatchDetail);
  return (
    <button
      type="button"
      title={t("match.viewMatchDetails")}
      onClick={(event) => {
        event.stopPropagation();
        openMatchDetail(fixtureId);
      }}
      className={`rounded-md px-2 font-heading font-bold tabular-nums text-gray-800 transition-colors hover:bg-gray-100 hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-100 dark:hover:bg-navy-700 dark:hover:text-primary-400 ${className}`}
    >
      {children}
      <span className="sr-only"> – {t("match.viewMatchDetails")}</span>
    </button>
  );
}
