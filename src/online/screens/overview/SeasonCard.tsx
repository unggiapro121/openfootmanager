import { useId } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import { ProgressBar } from "../../../components/ui";
import { useOnlineStore } from "../../store/onlineStore";
import { SEASON_DAYS } from "../shellNav";
import { useCountdownText } from "../useCountdownText";
import OverviewCard, { CardBadge } from "./OverviewCard";

/** Seasons whose days are under way: their badge is green. */
const LIVE = new Set(["preseason", "running"]);

/**
 * The season as the coach's region lives it (design tong-quan.html): its number and state,
 * today's day of the 28, how far it has gone, and the time to the next day.
 */
export default function SeasonCard({ played }: { played: number | undefined }) {
  const { t } = useTranslation();
  const season = useOnlineStore((state) => state.season);
  const nextDay = useCountdownText(season?.nextDayAt);
  const timerId = useId();

  if (!season) {
    return (
      <OverviewCard title={t("online.season.title")} className="flex-[1_1_300px]">
        <p className="p-6 text-sm text-gray-600 dark:text-gray-300">{t("online.season.none")}</p>
      </OverviewCard>
    );
  }

  const today = season.day === undefined ? undefined : season.day + 1;
  return (
    <OverviewCard
      title={t("online.header.season", { number: season.number })}
      className="flex-[1_1_300px]"
      action={
        <CardBadge tone={LIVE.has(season.status) ? "green" : "plain"}>
          {LIVE.has(season.status) && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-primary-500 dark:bg-primary-400"
            />
          )}
          {t(`online.season.status.${season.status}`, season.status)}
        </CardBadge>
      }
    >
      <div className="flex flex-1 flex-col gap-5 p-6">
        <div className="flex items-baseline justify-between gap-3">
          {today !== undefined && (
            <span className="font-heading text-4xl font-bold uppercase leading-none tracking-wide text-gray-900 dark:text-white">
              {t("online.overview.day", { day: today })}
              <span className="text-xl text-gray-400 dark:text-gray-500">/{SEASON_DAYS}</span>
            </span>
          )}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.season.footballYear", { year: season.footballYear })}
          </span>
        </div>
        {today !== undefined && (
          <div className="flex flex-col gap-1.5">
            <div
              role="progressbar"
              aria-label={t("online.overview.seasonProgress")}
              aria-valuemin={0}
              aria-valuemax={SEASON_DAYS}
              aria-valuenow={today}
            >
              <ProgressBar value={(today / SEASON_DAYS) * 100} variant="primary" size="md" />
            </div>
            <div className="flex justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span>{played !== undefined && t("online.overview.played", { count: played })}</span>
              <span>{t("online.overview.daysLeft", { count: SEASON_DAYS - today })}</span>
            </div>
          </div>
        )}
        {nextDay && (
          <div className="mt-auto flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 dark:border-navy-600 dark:bg-navy-800">
            <CalendarClock
              className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400"
              aria-hidden="true"
            />
            <span id={timerId} className="flex-1 text-sm text-gray-700 dark:text-gray-300">
              {t("online.overview.newDayIn")}
            </span>
            <span
              role="timer"
              aria-live="off"
              aria-labelledby={timerId}
              className="font-heading text-2xl font-bold tabular-nums text-gray-900 dark:text-white"
            >
              {nextDay}
            </span>
          </div>
        )}
      </div>
    </OverviewCard>
  );
}
