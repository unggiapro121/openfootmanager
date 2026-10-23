import { useTranslation } from "react-i18next";
import { useOnlineStore } from "../store/onlineStore";
import { FriendlyChip } from "./friendly/FriendlyChip";
import { useCountdownText } from "./useCountdownText";

/** Days of an online season: 2 of pre-season, 26 league days (ARCHITECTURE §2.2). */
export const SEASON_DAYS = 28;

/** The online header (C-2 §3.1): the club, the season's day, the time left to the next match. */
export default function OnlineHeader() {
  const { t } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const season = useOnlineStore((state) => state.season);
  const kickoff = useCountdownText(club?.nextFixture?.kickoffAt);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4 dark:border-navy-600 dark:bg-navy-800">
      <div>
        <h1 className="font-heading text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
          {club?.club.name ?? t("online.title")}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {season
            ? season.day === undefined
              ? t("online.header.season", { number: season.number })
              : t("online.header.seasonDay", {
                  number: season.number,
                  day: season.day + 1,
                  total: SEASON_DAYS,
                })
            : t("online.season.none")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <FriendlyChip />
        {kickoff && (
          <p className="font-heading text-sm font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400">
            {t("online.header.nextKickoff", { time: kickoff })}
          </p>
        )}
      </div>
    </header>
  );
}
