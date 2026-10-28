import { useTranslation } from "react-i18next";
import { Coins, Wallet } from "lucide-react";
import { formatVal } from "../../lib/valueFormatting";
import { formatCoins } from "../format";
import { useOnlineStore } from "../store/onlineStore";
import { FriendlyChip } from "./friendly/FriendlyChip";
import { useGuardedNavigate } from "./leaveGuard";
import { useCountdownText } from "./useCountdownText";

/** Days of an online season: 2 of pre-season, 26 league days (ARCHITECTURE §2.2). */
export const SEASON_DAYS = 28;

/** The online header (C-2 §3.1): the club, the season's day, the time left to the next match. */
export default function OnlineHeader() {
  const { t, i18n } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const coins = useOnlineStore((state) => state.coins);
  // Shown once coins are open to anyone (a price list) or the coach holds some (C-7 Qc7-2).
  const showCoins = coins && (coins.priceListVersion !== undefined || coins.balance !== 0);
  const season = useOnlineStore((state) => state.season);
  const kickoff = useCountdownText(club?.nextFixture?.kickoffAt);
  const finance = useOnlineStore((state) => state.finance);
  const navigate = useGuardedNavigate();

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
        {club && finance?.economy && (
          <button
            type="button"
            onClick={() => navigate("/online/finance")}
            aria-label={t("online.header.cash", { amount: formatVal(finance.cash) })}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 font-heading text-sm font-bold tabular-nums text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-navy-600 dark:text-gray-100 dark:hover:bg-navy-700"
          >
            <Wallet className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
            {formatVal(finance.cash)}
          </button>
        )}
        {showCoins && (
          <button
            type="button"
            onClick={() => navigate("/online/coins")}
            aria-label={t("online.header.coins", {
              amount: formatCoins(coins.balance, i18n.language),
            })}
            className={`flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 font-heading text-sm font-bold tabular-nums hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-navy-600 dark:hover:bg-navy-700 ${
              coins.balance < 0
                ? "text-red-600 dark:text-red-400"
                : "text-gray-800 dark:text-gray-100"
            }`}
          >
            <Coins className="h-4 w-4 text-accent-500 dark:text-accent-400" aria-hidden="true" />
            {formatCoins(coins.balance, i18n.language)}
          </button>
        )}
        {kickoff && (
          <p className="font-heading text-sm font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400">
            {t("online.header.nextKickoff", { time: kickoff })}
          </p>
        )}
      </div>
    </header>
  );
}
