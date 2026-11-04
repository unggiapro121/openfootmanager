import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { LeagueView, StandingRow } from "../../api";
import LeagueClubCrest from "../LeagueClubCrest";
import { FOCUS, OUTCOME_TONE, SegmentedChoice } from "./phoneLeagueLook";
import type { Outcome } from "./leagueView";

const KEY = "online.league.phone";
type Mode = "compact" | "full";

/** The columns of the full table only: wins, draws, losses, goals for and against. */
const FULL_ONLY: Array<{ label: string; value: (row: StandingRow) => number }> = [
  { label: "common.won", value: (row) => row.won },
  { label: "common.drawn", value: (row) => row.drawn },
  { label: "common.lost", value: (row) => row.lost },
  { label: "common.gf", value: (row) => row.goalsFor },
  { label: "common.ga", value: (row) => row.goalsAgainst },
];

const HEAD =
  "bg-gray-50 px-1 text-center font-heading text-[11px] font-semibold tracking-wider text-gray-500 dark:bg-navy-900 dark:text-gray-400";
const CELL = "border-b border-gray-200 text-center tabular-nums dark:border-navy-700";

/**
 * The league table on a phone (design m-giai-dau): compact by default (played, goal difference,
 * form, points), the full counts on request; the club column stays put while the table scrolls
 * sideways. The promotion places carry a green bar; a club opens its own page.
 */
export default function PhoneLeagueTable({
  league,
  myClubId,
  form,
}: {
  league: LeagueView;
  myClubId: string | null;
  form: ReadonlyMap<string, Outcome[]>;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("compact");
  const rows = [...league.table].sort((left, right) => left.position - right.position);
  const full = mode === "full";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        {league.promotionPlaces > 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <span aria-hidden="true" className="h-3.5 w-1 rounded-sm bg-primary-500" />
            {t(`${KEY}.promotionZone`, { to: league.promotionPlaces })}
          </span>
        ) : (
          <span />
        )}
        <SegmentedChoice
          label={t(`${KEY}.tableMode`)}
          value={mode}
          options={[
            { value: "compact", label: t(`${KEY}.compact`) },
            { value: "full", label: t(`${KEY}.full`) },
          ]}
          onChange={setMode}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th
                scope="col"
                className={`sticky left-0 z-[2] h-[34px] pl-2.5 text-left ${HEAD} ${full ? "min-w-[172px]" : ""}`}
              >
                {t("common.rank")} {t("common.team")}
              </th>
              <th scope="col" className={`${HEAD} min-w-[30px]`}>
                {t("common.played")}
              </th>
              {full &&
                FULL_ONLY.map((column) => (
                  <th key={column.label} scope="col" className={`${HEAD} min-w-[28px]`}>
                    {t(column.label)}
                  </th>
                ))}
              <th scope="col" className={`${HEAD} min-w-[38px]`}>
                {t("common.gd")}
              </th>
              <th scope="col" className={`${HEAD} min-w-[40px]`} title={t(`${KEY}.formTitle`)}>
                {t(`${KEY}.form`)}
              </th>
              <th
                scope="col"
                className={`${HEAD} min-w-[34px] pr-2.5 text-gray-900 dark:text-white`}
              >
                {t("common.pts")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TableRow
                key={row.club.id}
                row={row}
                mine={row.club.id === myClubId}
                promoted={row.position <= league.promotionPlaces}
                full={full}
                form={form.get(row.club.id) ?? []}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-normal text-gray-500 dark:text-gray-400">
        {t(full ? `${KEY}.legendFull` : `${KEY}.legendCompact`)}
      </p>
    </div>
  );
}

function TableRow({
  row,
  mine,
  promoted,
  full,
  form,
}: {
  row: StandingRow;
  mine: boolean;
  promoted: boolean;
  full: boolean;
  form: Outcome[];
}) {
  const { t } = useTranslation();
  const tint = mine ? "bg-primary-50 dark:bg-primary-900/30" : "bg-white dark:bg-navy-800";
  const coach = row.seat === "human" && row.coach ? row.coach.fullName : t("online.league.bot");
  const gd = row.goalDifference;
  return (
    <tr>
      <th
        scope="row"
        className={`sticky left-0 z-[1] border-b border-gray-200 p-0 text-left font-normal dark:border-navy-700 ${tint}`}
      >
        <span className="flex min-h-[52px] items-center gap-2 pr-1.5">
          <span
            aria-hidden="true"
            className={`w-[3px] self-stretch ${promoted ? "bg-primary-500" : ""}`}
          />
          <span
            className={`w-[18px] text-right font-heading text-sm font-bold ${promoted ? "text-primary-700 dark:text-primary-400" : "text-gray-500 dark:text-gray-400"}`}
          >
            {row.position}
          </span>
          <LeagueClubCrest club={row.club} mine={mine} className="h-[26px] w-[26px]" />
          <span className="flex min-w-0 flex-col gap-px">
            <Link
              to={`/online/clubs/${row.club.id}`}
              className={`truncate rounded font-semibold ${full ? "max-w-[118px]" : "max-w-[104px]"} ${mine ? "text-primary-700 dark:text-primary-400" : "text-gray-900 dark:text-white"} ${FOCUS}`}
            >
              {row.club.name}
            </Link>
            <span className="whitespace-nowrap text-[11px] text-gray-500 dark:text-gray-400">
              {t(`${KEY}.coachLine`, { coach })}
            </span>
          </span>
        </span>
      </th>
      <td className={`${CELL} ${tint} text-gray-700 dark:text-gray-200`}>{row.played}</td>
      {full &&
        FULL_ONLY.map((column) => (
          <td key={column.label} className={`${CELL} ${tint} text-gray-700 dark:text-gray-200`}>
            {column.value(row)}
          </td>
        ))}
      <td
        className={`${CELL} ${tint} font-bold ${gd > 0 ? "text-primary-700 dark:text-primary-400" : gd < 0 ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}
      >
        {gd > 0 ? `+${gd}` : gd}
      </td>
      <td className={`${CELL} ${tint}`}>
        <span className="inline-flex gap-0.5">
          {form.slice(-2).map((outcome, index) => (
            <span
              key={index}
              className={`inline-flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold ${OUTCOME_TONE[outcome]}`}
            >
              {t(`online.schedule.outcomeShort.${outcome}`)}
            </span>
          ))}
        </span>
      </td>
      <td
        className={`${CELL} ${tint} pr-2.5 font-heading text-[17px] font-bold text-gray-900 dark:text-white`}
      >
        {row.points}
      </td>
    </tr>
  );
}
