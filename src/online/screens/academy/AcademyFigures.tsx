import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { AcademyView } from "../../api";
import { CardBadge, LABEL } from "../overview/OverviewCard";

export const ACADEMY_LINK =
  "rounded font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:hover:text-primary-300 dark:focus:ring-offset-navy-800";

/** The slots a report may fill: never below zero. */
export function freeSlots(academy: AcademyView): number {
  return Math.max(0, academy.slots - academy.used);
}

function Figure({
  label,
  badge,
  value,
  unit,
  note,
}: {
  label: string;
  badge?: ReactNode;
  value: ReactNode;
  unit?: string;
  note: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-gray-200 bg-white px-5 py-4 max-md:gap-1 max-md:px-3.5 max-md:py-3 dark:border-navy-600 dark:bg-navy-700">
      <span className={`flex items-center justify-between gap-2 ${LABEL}`}>
        {label}
        {badge}
      </span>
      <span className="font-heading text-3xl font-bold leading-none tabular-nums text-gray-900 max-md:text-2xl dark:text-white">
        {value}
        {unit && <span className="text-xl text-gray-400 dark:text-gray-500">{unit}</span>}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">{note}</span>
    </li>
  );
}

/**
 * The academy's figures (design HocVien.dc.html): its slots, the season's trips, what its
 * youngsters cost a week and what one's graduation costs. The costs show only while the season
 * has academy rules.
 */
export default function AcademyFigures({ academy }: { academy: AcademyView }) {
  const { t } = useTranslation();
  const full = academy.slots > 0 && freeSlots(academy) === 0;
  return (
    <ul
      aria-label={t("online.academy.figures.title")}
      className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 max-md:grid-cols-2 max-md:gap-3"
    >
      <Figure
        label={t("online.academy.figures.slots")}
        badge={full && <CardBadge tone="gold">{t("online.academy.figures.full")}</CardBadge>}
        value={academy.used}
        unit={`/${academy.slots}`}
        note={
          <>
            {t("online.academy.figures.level", { level: academy.academyLevel })} ·{" "}
            <Link to="/online/finance" className={ACADEMY_LINK}>
              {t("online.academy.upgrade")}
            </Link>
          </>
        }
      />
      <Figure
        label={t("online.academy.figures.trips")}
        value={academy.tripsThisSeason}
        unit={academy.maxTripsPerSeason !== undefined ? `/${academy.maxTripsPerSeason}` : undefined}
        note={t("online.academy.figures.eliteTrips", {
          sent: academy.eliteTripsThisSeason,
          max: academy.maxEliteTripsPerSeason ?? 0,
        })}
      />
      {academy.weeklyWage !== undefined && (
        <Figure
          label={t("online.academy.figures.wages")}
          value={formatExactMoney(academy.weeklyWage * academy.used)}
          unit={t("online.academy.figures.perWeek")}
          note={t("online.academy.figures.wagesNote", {
            wage: formatExactMoney(academy.weeklyWage),
            n: academy.used,
          })}
        />
      )}
      {academy.graduationFee !== undefined && academy.minAcademyDays !== undefined && (
        <Figure
          label={t("online.academy.figures.fee")}
          value={formatExactMoney(academy.graduationFee)}
          note={t("online.academy.figures.feeNote", { days: academy.minAcademyDays })}
        />
      )}
    </ul>
  );
}
