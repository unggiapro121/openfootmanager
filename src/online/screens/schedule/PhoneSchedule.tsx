import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { ClubRef, FixtureView } from "../../api";
import { online } from "../../client";
import { useOnlineNow } from "../../clock";
import { outcomeFor } from "../../fixtures";
import { formatKickoffClock } from "../../format";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import { OUTCOME_TONE } from "../league/phoneLeagueLook";
import LeagueClubCrest from "../LeagueClubCrest";
import ResourceState from "../ResourceState";
import { useCountdownText } from "../useCountdownText";
import { byDay, countByVenue, ofVenue, type Venue } from "./scheduleView";

const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-navy-900";
const VENUES: { venue: Venue; label: string }[] = [
  { venue: "all", label: "common.all" },
  { venue: "home", label: "online.fixture.home" },
  { venue: "away", label: "online.fixture.away" },
];

const isUpcoming = (fixture: FixtureView) =>
  fixture.status !== "settled" && fixture.status !== "void";

/**
 * The club's season on a phone (design m-lich-thi-dau.html): the next match with its countdown,
 * a filter by venue, then the fixtures by day, each club on its own line so long names fit.
 */
export default function PhoneSchedule({ clubId }: { clubId: string }) {
  const { t } = useTranslation();
  const [venue, setVenue] = useState<Venue>("all");
  const { resource, reload } = useOnlineResource(
    async () => (await tracked(() => online.clubs.mineFixtures())).fixtures,
    [clubId],
  );

  return (
    <ResourceState resource={resource} reload={reload}>
      {(fixtures) => {
        const next = fixtures.find(isUpcoming);
        const counts = countByVenue(fixtures, clubId);
        return (
          <div className="flex flex-col gap-3">
            {next && <NextBanner fixture={next} clubId={clubId} />}
            <div
              role="group"
              aria-label={t("online.schedule.filterLabel")}
              className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1"
            >
              {VENUES.map((one) => (
                <button
                  key={one.venue}
                  type="button"
                  aria-pressed={venue === one.venue}
                  onClick={() => setVenue(one.venue)}
                  className={`h-9 shrink-0 rounded-full border px-3.5 text-sm font-semibold ${FOCUS} ${
                    venue === one.venue
                      ? "border-primary-600 bg-primary-600 text-white dark:border-primary-500 dark:bg-primary-600 dark:text-white"
                      : "border-gray-200 bg-white text-gray-700 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-200"
                  }`}
                >
                  {t(one.label)} ({counts[one.venue]})
                </button>
              ))}
            </div>
            <section aria-label={t("online.schedule.title")} className="flex flex-col gap-4">
              {byDay(ofVenue(fixtures, clubId, venue)).map((day) => (
                <DayBlock key={day.key} date={day.date} count={day.fixtures.length}>
                  {day.fixtures.map((fixture) => (
                    <Row
                      key={fixture.id}
                      fixture={fixture}
                      clubId={clubId}
                      isNext={fixture.id === next?.id}
                    />
                  ))}
                </DayBlock>
              ))}
            </section>
            <p className="text-center text-xs text-gray-500 dark:text-gray-400">
              {t("online.overview.markLegend")}
            </p>
          </div>
        );
      }}
    </ResourceState>
  );
}

function NextBanner({ fixture, clubId }: { fixture: FixtureView; clubId: string }) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const countdown = useCountdownText(fixture.kickoffAt);
  const titleId = useId();
  const timerId = useId();
  const atHome = fixture.home.id === clubId;
  const opponent = atHome ? fixture.away : fixture.home;
  const mine = atHome ? fixture.home : fixture.away;
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-primary-200 bg-primary-50 p-4 dark:border-primary-800 dark:bg-primary-900/30"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={titleId}
          className="font-heading text-sm font-bold uppercase tracking-wider text-primary-800 dark:text-primary-300"
        >
          {t("schedule.nextMatch")} · {t("online.fixture.round", { round: fixture.round })}
        </h2>
        <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300">
          {formatKickoffClock(fixture.kickoffAt, now, i18n.language)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <LeagueClubCrest club={mine} mine className="h-11 w-11" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-bold text-primary-700 dark:text-primary-300">
            {mine.name}
          </span>
          <span className="truncate text-sm text-gray-700 dark:text-gray-200">
            {t("common.vs")} {opponent.name}
          </span>
        </div>
        {countdown && (
          <div className="flex shrink-0 flex-col items-end">
            <span id={timerId} className="text-xs text-gray-600 dark:text-gray-300">
              {t("online.overview.kickoffIn")}
            </span>
            <span
              role="timer"
              aria-live="off"
              aria-labelledby={timerId}
              className="font-heading text-2xl font-bold leading-none tabular-nums text-accent-700 dark:text-accent-400"
            >
              {countdown}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function DayBlock({ date, count, children }: { date: Date; count: number; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const day = new Intl.DateTimeFormat(i18n.language, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between px-1">
        <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-gray-800 dark:text-gray-100">
          {day}
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.schedule.dayCount", { count })}
        </span>
      </div>
      <ol className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-600 dark:bg-navy-700">
        {children}
      </ol>
    </div>
  );
}

function Side({ club, clubId }: { club: ClubRef; clubId: string }) {
  const mine = club.id === clubId;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <LeagueClubCrest club={club} mine={mine} className="h-5 w-5" />
      <Link
        to={`/online/clubs/${club.id}`}
        className={`truncate rounded text-sm font-semibold hover:underline ${FOCUS} ${
          mine ? "text-primary-700 dark:text-primary-400" : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {club.name}
      </Link>
    </span>
  );
}

function Row({
  fixture,
  clubId,
  isNext,
}: {
  fixture: FixtureView;
  clubId: string;
  isNext: boolean;
}) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const outcome = outcomeFor(fixture, clubId);
  const atHome = fixture.home.id === clubId;
  const names = { home: fixture.home.name, away: fixture.away.name };
  return (
    <li
      data-round={fixture.round}
      aria-current={isNext ? "true" : undefined}
      className={`grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-gray-100 px-3 py-2.5 last:border-b-0 dark:border-navy-600 ${
        isNext ? "border-l-4 border-l-primary-500 bg-primary-50 dark:bg-primary-900/30" : ""
      }`}
    >
      <span className="text-center text-xs leading-tight text-gray-500 dark:text-gray-400">
        {t("online.fixture.round", { round: fixture.round })}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <Side club={fixture.home} clubId={clubId} />
        <Side club={fixture.away} clubId={clubId} />
      </span>
      <span className="flex flex-col items-end gap-1">
        {fixture.status === "settled" ? (
          <Link
            to={`/online/fixtures/${fixture.id}`}
            aria-label={t("online.fixture.openResult", names)}
            className={`rounded font-heading text-lg font-bold tabular-nums text-gray-900 dark:text-white ${FOCUS}`}
          >
            {fixture.homeGoals} - {fixture.awayGoals}
          </Link>
        ) : fixture.matchId && fixture.matchStatus === "live" ? (
          <Link
            to={`/online/match/${fixture.matchId}`}
            aria-label={t("online.fixture.watchMatch", names)}
            className={`rounded text-xs font-bold text-red-600 dark:text-red-400 ${FOCUS}`}
          >
            {t("online.fixture.watchLive")}
          </Link>
        ) : (
          <span className="font-heading text-base font-bold tabular-nums text-gray-900 dark:text-white">
            {fixture.status === "void"
              ? t("online.fixture.void")
              : formatKickoffClock(fixture.kickoffAt, now, i18n.language)}
          </span>
        )}
        {outcome ? (
          <span className={`rounded px-1.5 text-xs font-bold ${OUTCOME_TONE[outcome]}`}>
            {t(`online.schedule.outcome.${outcome}`)}
          </span>
        ) : isNext ? (
          <span className="rounded bg-accent-400 px-1.5 font-heading text-xs font-bold uppercase text-navy-900 dark:bg-accent-400 dark:text-navy-900">
            {t("schedule.nextMatch")}
          </span>
        ) : (
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            {atHome ? t("online.overview.homeMark") : t("online.overview.awayMark")}
          </span>
        )}
      </span>
    </li>
  );
}
