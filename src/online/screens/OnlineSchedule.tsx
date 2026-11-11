import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Badge, Card, CardBody } from "../../components/ui";
import type { ClubRef, FixtureView } from "../api";
import { online } from "../client";
import { outcomeFor } from "../fixtures";
import { tracked, useOnlineStore } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import { formatMoment } from "../format";
import ResourceState from "./ResourceState";
import { OpponentFixtureLink } from "./opponent/OpponentFixtureLink";
import PhoneSchedule from "./schedule/PhoneSchedule";
import { usePhoneLayout } from "../../hooks/usePhoneLayout";

/** The colour of a won, drawn or lost match, wherever a result is a coloured square. */
export const OUTCOME_CLASS: Record<"W" | "D" | "L", string> = {
  W: "bg-green-500",
  D: "bg-gray-400",
  L: "bg-red-500",
};

/**
 * The club's season, round by round (C-2 §3.5): real dates, not the desktop's game calendar,
 * so a list rather than `ScheduleCalendarGrid`.
 */
export default function OnlineSchedule() {
  const { t } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const leagueId = club?.leagueId;
  const clubId = club?.club.id ?? null;
  const phone = usePhoneLayout();

  if (!leagueId || !clubId) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.league.none")}</p>;
  }
  return phone ? <PhoneSchedule clubId={clubId} /> : <SeasonList clubId={clubId} />;
}

function SeasonList({ clubId }: { clubId: string }) {
  const { t } = useTranslation();
  const { resource, reload } = useOnlineResource(
    async () => (await tracked(() => online.clubs.mineFixtures())).fixtures,
    [clubId],
  );

  return (
    <Card>
      <div className="rounded-t-xl border-b border-gray-100 bg-gray-50 px-5 py-3 dark:border-navy-600 dark:bg-navy-800">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
          {t("online.schedule.title")}
        </h2>
      </div>
      <CardBody className="p-0">
        <ResourceState resource={resource} reload={reload}>
          {(fixtures) => {
            const next = fixtures.find(
              (fixture) => fixture.status !== "settled" && fixture.status !== "void",
            );
            return (
              <ol
                aria-label={t("online.schedule.title")}
                className="divide-y divide-gray-100 dark:divide-navy-600"
              >
                {fixtures.map((fixture) => (
                  <ScheduleEntry
                    key={fixture.id}
                    fixture={fixture}
                    clubId={clubId}
                    isNext={fixture.id === next?.id}
                  />
                ))}
              </ol>
            );
          }}
        </ResourceState>
      </CardBody>
    </Card>
  );
}

const LINK_CLASS =
  "rounded text-sm font-semibold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

function ClubLink({ club, mine, side }: { club: ClubRef; mine: boolean; side: "home" | "away" }) {
  return (
    <Link
      to={`/online/clubs/${club.id}`}
      className={`${LINK_CLASS} min-w-0 flex-1 truncate ${side === "home" ? "text-right" : "text-left"} ${
        mine ? "text-primary-600 dark:text-primary-400" : "text-gray-800 dark:text-gray-200"
      }`}
    >
      {club.name}
    </Link>
  );
}

/** The middle of a row: the score once settled, a way into the match while it is played, or "vs". */
function Middle({ fixture }: { fixture: FixtureView }) {
  const { t } = useTranslation();
  const names = { home: fixture.home.name, away: fixture.away.name };
  if (fixture.status === "settled") {
    return (
      <Link
        to={`/online/fixtures/${fixture.id}`}
        aria-label={t("online.fixture.openResult", names)}
        className="rounded font-heading text-lg font-bold tabular-nums text-gray-900 hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-100 dark:hover:text-primary-400"
      >
        {fixture.homeGoals} - {fixture.awayGoals}
      </Link>
    );
  }
  if (fixture.matchId && fixture.matchStatus === "live") {
    return (
      <Link
        to={`/online/match/${fixture.matchId}`}
        aria-label={t("online.fixture.watchMatch", names)}
        className="rounded text-xs font-semibold text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-red-400"
      >
        {t("online.fixture.watchLive")}
      </Link>
    );
  }
  return (
    <Badge variant="neutral" size="sm">
      {fixture.status === "void" ? t("online.fixture.void") : t("common.vs")}
    </Badge>
  );
}

function ScheduleEntry({
  fixture,
  clubId,
  isNext,
}: {
  fixture: FixtureView;
  clubId: string;
  isNext: boolean;
}) {
  const { t, i18n } = useTranslation();
  const outcome = outcomeFor(fixture, clubId);
  const upcoming = fixture.status !== "settled" && fixture.status !== "void";
  return (
    <li
      className={`flex items-center gap-3 px-5 py-3 transition-colors ${
        isNext ? "bg-primary-50/50 dark:bg-primary-500/5" : ""
      }`}
    >
      <span className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">
        {t("online.fixture.round", { round: fixture.round })}
      </span>
      {outcome ? (
        <span
          role="img"
          aria-label={t(`online.schedule.outcome.${outcome}`)}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded font-heading text-[10px] font-bold text-white ${OUTCOME_CLASS[outcome]}`}
        >
          {t(`online.schedule.outcomeShort.${outcome}`)}
        </span>
      ) : (
        <span aria-hidden="true" className="h-6 w-6 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 items-center">
        <ClubLink club={fixture.home} mine={fixture.home.id === clubId} side="home" />
        <div className="mx-3 w-24 shrink-0 text-center">
          <Middle fixture={fixture} />
        </div>
        <ClubLink club={fixture.away} mine={fixture.away.id === clubId} side="away" />
      </div>
      <span className="hidden w-44 shrink-0 text-right text-xs text-gray-500 sm:block dark:text-gray-400">
        {isNext && (
          <Badge variant="primary" size="sm">
            {t("schedule.nextMatch")}
          </Badge>
        )}{" "}
        {upcoming && formatMoment(fixture.kickoffAt, i18n.language)}
      </span>
      {upcoming && (
        <OpponentFixtureLink
          fixture={fixture}
          clubId={clubId}
          className="shrink-0 rounded text-xs font-semibold text-primary-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:focus:ring-offset-navy-800"
        />
      )}
    </li>
  );
}
