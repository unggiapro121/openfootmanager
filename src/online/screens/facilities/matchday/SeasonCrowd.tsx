import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { formatCount, formatPermille, formatVal } from "../../../../lib/valueFormatting";
import type { MatchdayMatchView, MatchdayView } from "../../../api";
import { FOCUS } from "../../mobile/PhoneSheet";

/** More home matches than this and a phone names each bar by its day (c-27 §7.1). */
const NAMES_FIT = 5;

/**
 * This season's home crowds (c-27 §7.1, C27-19): a bar for each home league match played, its
 * axis from 0 (T12), the capacity marked, a sold-out match in gold; a bar pressed says the match
 * in full in a live line, and a table says them all to a screen reader. Before the first home
 * match: a sentence and what the first would draw at the price set (T8).
 */
export function SeasonCrowd({ matchday }: { matchday: MatchdayView }) {
  const { t } = useTranslation();
  const matches = matchday.matches;
  const [chosen, setChosen] = useState(matches.length - 1);

  return (
    <article
      aria-labelledby="facilities-crowd-title"
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-navy-600 dark:bg-navy-800"
    >
      <h3
        id="facilities-crowd-title"
        className="flex items-center gap-2 font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
      >
        <Users className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
        {t("online.facilities.crowd.title")}
      </h3>
      {matches.length === 0 ? (
        <NoHomeMatch matchday={matchday} />
      ) : (
        <>
          <Bars matches={matches} chosen={chosen} onChoose={setChosen} />
          <ChosenLine match={matches[Math.min(chosen, matches.length - 1)]} />
          <p className="text-sm tabular-nums text-gray-800 dark:text-gray-100">
            {t("online.facilities.crowd.summary", {
              fill: formatPermille(matchday.summary.avgFillPermille),
              soldOut: matchday.summary.soldOut,
              revenue: formatVal(matchday.summary.ticketRevenue),
            })}
          </p>
          <CrowdTable matches={matches} />
        </>
      )}
    </article>
  );
}

function Bars({
  matches,
  chosen,
  onChoose,
}: {
  matches: MatchdayMatchView[];
  chosen: number;
  onChoose: (index: number) => void;
}) {
  const { t } = useTranslation();
  const top = Math.max(1, ...matches.map((match) => Math.max(match.capacity, match.attendance)));
  const capacity = matches[matches.length - 1]?.capacity ?? 0;
  const byDay = matches.length > NAMES_FIT;
  return (
    <div
      role="group"
      aria-label={t("online.facilities.crowd.chart", { count: matches.length })}
      className="relative flex h-40 items-end gap-1 pt-5"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 border-t border-dashed border-accent-500 dark:border-accent-400"
        // The bars stand between the names (1rem and a 0.25rem gap) and the 1.25rem top margin.
        style={{ bottom: `calc(1.25rem + ${capacity / top} * (100% - 2.5rem))` }}
      >
        <span className="absolute -top-4 right-0 text-[10px] font-bold text-accent-700 dark:text-accent-300">
          {t("online.facilities.crowd.capacity", { capacity: formatCount(capacity) })}
        </span>
      </span>
      {matches.map((match, index) => {
        const height = `${(match.attendance / top) * 100}%`;
        return (
          <button
            key={match.fixtureId}
            type="button"
            aria-pressed={index === chosen}
            aria-label={barText(t, match)}
            onClick={() => onChoose(index)}
            className={`flex h-full min-w-0 flex-1 flex-col items-stretch justify-end gap-1 rounded ${FOCUS}`}
          >
            <span className="relative flex flex-1 items-end">
              <span
                className={`flex w-full justify-center rounded-t pt-1 ${match.soldOut ? "bg-accent-400 dark:bg-accent-400" : "bg-primary-500 dark:bg-primary-400"} ${index === chosen ? "ring-2 ring-gray-900 dark:ring-white" : ""}`}
                style={{ height }}
              >
                {match.soldOut && (
                  <span className="rotate-180 text-[9px] font-extrabold uppercase text-navy-900 [writing-mode:vertical-rl] dark:text-navy-900">
                    {t("online.match.attendance.soldOut")}
                  </span>
                )}
              </span>
            </span>
            <span className="h-4 text-center text-[10px] leading-4 text-gray-500 dark:text-gray-400">
              <span className={byDay ? "hidden md:inline" : ""}>{match.opponentShortName}</span>
              {byDay && (
                <span className="md:hidden">
                  {t("online.facilities.crowd.dayShort", { day: match.day })}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function barText(t: ReturnType<typeof useTranslation>["t"], match: MatchdayMatchView): string {
  const base = t("online.facilities.crowd.bar", {
    opponent: match.opponentShortName,
    day: match.day,
    attendance: formatCount(match.attendance),
    capacity: formatCount(match.capacity),
  });
  return match.soldOut
    ? base + t("online.facilities.crowd.barSoldOut", { count: formatCount(match.lockedOut) })
    : base;
}

function ChosenLine({ match }: { match: MatchdayMatchView | undefined }) {
  const { t } = useTranslation();
  return (
    <p
      aria-live="polite"
      className="min-h-10 rounded-lg bg-gray-50 px-2.5 py-2 text-xs tabular-nums text-gray-700 dark:bg-navy-900 dark:text-gray-300"
    >
      {match && (
        <>
          <b className="text-gray-900 dark:text-white">{match.opponentShortName}</b>{" "}
          {t("online.facilities.crowd.chosen", {
            day: match.day,
            attendance: formatCount(match.attendance),
            capacity: formatCount(match.capacity),
            revenue: formatVal(match.ticketRevenue),
          })}
          {match.soldOut &&
            t("online.facilities.crowd.chosenSoldOut", { count: formatCount(match.lockedOut) })}
        </>
      )}
    </p>
  );
}

function NoHomeMatch({ matchday }: { matchday: MatchdayView }) {
  const { t } = useTranslation();
  const next = matchday.next;
  const projection = next?.projections.find((line) => line.price === matchday.ticketPrice);
  return (
    <div className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
      <p>{t("online.facilities.crowd.empty")}</p>
      {next && projection && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.facilities.crowd.emptyNext", {
            opponent: next.opponent.shortName,
            day: next.day,
            attendance: formatCount(projection.attendance),
          })}
        </p>
      )}
    </div>
  );
}

function CrowdTable({ matches }: { matches: MatchdayMatchView[] }) {
  const { t } = useTranslation();
  return (
    <table className="sr-only">
      <caption>{t("online.facilities.crowd.title")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("online.facilities.crowd.table.opponent")}</th>
          <th scope="col">{t("online.facilities.crowd.table.day")}</th>
          <th scope="col">{t("online.facilities.crowd.table.crowd")}</th>
          <th scope="col">{t("online.facilities.crowd.table.tickets")}</th>
        </tr>
      </thead>
      <tbody>
        {matches.map((match) => (
          <tr key={match.fixtureId}>
            <td>{match.opponentShortName}</td>
            <td>{match.day}</td>
            <td>{barText(t, match)}</td>
            <td>{formatVal(match.ticketRevenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
