import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { FixtureView, StandingRow } from "../../api";
import { useOnlineNow } from "../../clock";
import { outcomeFor } from "../../fixtures";
import { formatKickoffClock } from "../../format";
import type { OnlineResource } from "../../useOnlineResource";
import ResourceState from "../ResourceState";
import OverviewCard, { CardBadge, CardLink, LABEL } from "./OverviewCard";

const CARD = "flex-[1_1_300px]";
/** Fixtures the coming list shows: the next match and three after it. */
const UPCOMING = 4;
const OUTCOME_TONE = { W: "green", D: "gold", L: "red" } as const;

/** The club's place in its league (design tong-quan.html): place, points, and its record. */
export function StandingCard({
  row,
  inLeague,
}: {
  row: StandingRow | undefined;
  inLeague: boolean;
}) {
  const { t } = useTranslation();
  return (
    <OverviewCard
      title={t("online.overview.tableTitle")}
      className={CARD}
      action={inLeague && <CardLink to="/online/league">{t("online.overview.seeTable")}</CardLink>}
    >
      <div className="flex flex-col gap-5 p-6">
        {row ? (
          <>
            <div className="flex items-center gap-4">
              <span className="flex h-18 w-18 shrink-0 items-center justify-center rounded-xl bg-accent-100 font-heading text-5xl font-bold leading-none text-accent-800 dark:bg-accent-900/40 dark:text-accent-400">
                <span className="sr-only">{t("online.overview.placeAria")} </span>
                {row.position}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className={LABEL}>{t("online.overview.placeNow")}</span>
                <span className="font-heading text-3xl font-bold leading-tight text-gray-900 dark:text-white">
                  {t("online.overview.points", { count: row.points })}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("online.overview.afterGames", { count: row.played })}
                </span>
              </div>
            </div>
            <Record row={row} />
          </>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {inLeague ? t("online.loading") : t("online.league.none")}
          </p>
        )}
      </div>
    </OverviewCard>
  );
}

/** Wins, draws and losses: a bar of their shares over the three counts. */
function Record({ row }: { row: StandingRow }) {
  const { t } = useTranslation();
  const parts = [
    {
      key: "W",
      count: row.won,
      bar: "bg-success-400 dark:bg-success-400",
      text: "text-success-600 dark:text-success-400",
    },
    {
      key: "D",
      count: row.drawn,
      bar: "bg-accent-400 dark:bg-accent-400",
      text: "text-accent-700 dark:text-accent-300",
    },
    {
      key: "L",
      count: row.lost,
      bar: "bg-red-500 dark:bg-red-500",
      text: "text-red-600 dark:text-red-400",
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      {row.played > 0 && (
        <div aria-hidden="true" className="flex h-2 gap-0.5 overflow-hidden rounded-full">
          {parts.map((part) =>
            part.count > 0 ? (
              <span key={part.key} className={part.bar} style={{ flexGrow: part.count }} />
            ) : null,
          )}
        </div>
      )}
      <dl className="grid grid-cols-3 gap-2 text-center">
        {parts.map((part) => (
          <div key={part.key} className="flex flex-col-reverse gap-0.5">
            <dt className="text-xs text-gray-500 dark:text-gray-400">
              {t(`online.schedule.outcome.${part.key}`)}
            </dt>
            <dd className={`font-heading text-2xl font-bold tabular-nums ${part.text}`}>
              {part.count}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The club's latest settled match: the outcome, the score, and its report. */
export function LastResultCard({
  fixtures,
  reload,
  clubId,
}: {
  fixtures: OnlineResource<FixtureView[]>;
  reload: () => void;
  clubId: string;
}) {
  const { t } = useTranslation();
  const latest =
    fixtures.status === "ready"
      ? fixtures.data.filter((fixture) => fixture.status === "settled").pop()
      : undefined;
  const outcome = latest ? outcomeFor(latest, clubId) : null;
  return (
    <OverviewCard
      title={t("online.overview.lastResult")}
      className={CARD}
      action={
        outcome && (
          <CardBadge tone={OUTCOME_TONE[outcome]}>
            {t(`online.schedule.outcome.${outcome}`)}
          </CardBadge>
        )
      }
    >
      <div className="flex flex-1 flex-col gap-4 p-6">
        <ResourceState resource={fixtures} reload={reload}>
          {() =>
            latest ? (
              <Result fixture={latest} clubId={clubId} />
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t("online.overview.noResult")}
              </p>
            )
          }
        </ResourceState>
      </div>
    </OverviewCard>
  );
}

function Result({ fixture, clubId }: { fixture: FixtureView; clubId: string }) {
  const { t } = useTranslation();
  const atHome = fixture.home.id === clubId;
  const name = (mine: boolean) =>
    `font-heading text-lg font-bold uppercase tracking-wider ${
      mine ? "text-primary-700 dark:text-primary-400" : "text-gray-900 dark:text-gray-100"
    }`;
  return (
    <>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {t("online.overview.resultMeta", {
          round: fixture.round,
          venue: atHome ? t("online.fixture.home") : t("online.fixture.away"),
        })}
      </span>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <span className={`${name(atHome)} text-right`}>{fixture.home.name}</span>
        <span className="rounded-lg bg-gray-100 px-3.5 py-1.5 font-heading text-4xl font-bold leading-none tabular-nums text-gray-900 dark:bg-navy-900 dark:text-white">
          {fixture.homeGoals} – {fixture.awayGoals}
        </span>
        <span className={name(!atHome)}>{fixture.away.name}</span>
      </div>
      <Link
        to={`/online/fixtures/${fixture.id}`}
        className="mt-auto inline-flex items-center gap-1.5 self-start rounded text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:hover:text-primary-300 dark:focus:ring-offset-navy-800"
      >
        {t("online.overview.report")}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </>
  );
}

/** The club's coming fixtures: the next one first, with the opponent and the kick-off. */
export function UpcomingCard({
  fixtures,
  reload,
  clubId,
}: {
  fixtures: OnlineResource<FixtureView[]>;
  reload: () => void;
  clubId: string;
}) {
  const { t } = useTranslation();
  return (
    <OverviewCard
      title={t("online.overview.upcoming")}
      className={CARD}
      action={<CardLink to="/online/schedule">{t("online.overview.seeAll")}</CardLink>}
    >
      <ResourceState resource={fixtures} reload={reload}>
        {(all) => {
          const coming = all
            .filter((fixture) => fixture.status !== "settled" && fixture.status !== "void")
            .slice(0, UPCOMING);
          return coming.length === 0 ? (
            <p className="p-6 text-sm text-gray-600 dark:text-gray-300">
              {t("online.overview.noUpcoming")}
            </p>
          ) : (
            <>
              <ol className="flex flex-col px-3 py-2">
                {coming.map((fixture, index) => (
                  <Coming key={fixture.id} fixture={fixture} clubId={clubId} next={index === 0} />
                ))}
              </ol>
              <p className="px-6 pb-4 text-xs text-gray-500 dark:text-gray-400">
                {t("online.overview.markLegend")}
              </p>
            </>
          );
        }}
      </ResourceState>
    </OverviewCard>
  );
}

function Coming({
  fixture,
  clubId,
  next,
}: {
  fixture: FixtureView;
  clubId: string;
  next: boolean;
}) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const atHome = fixture.home.id === clubId;
  const opponent = atHome ? fixture.away : fixture.home;
  return (
    <li
      aria-current={next ? "true" : undefined}
      className={`grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-3 py-2.5 ${
        next
          ? "bg-primary-50 dark:bg-primary-900/40"
          : "border-b border-gray-100 last:border-b-0 dark:border-navy-600"
      }`}
    >
      <span
        className={`text-xs ${next ? "font-semibold text-primary-700 dark:text-primary-300" : "text-gray-500 dark:text-gray-400"}`}
      >
        {t("online.fixture.round", { round: fixture.round })}
      </span>
      <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
        <Link
          to={`/online/clubs/${opponent.id}`}
          className="rounded hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {opponent.name}
        </Link>
        <span className="ml-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {atHome ? t("online.overview.homeMark") : t("online.overview.awayMark")}
        </span>
      </span>
      <span
        className={`text-xs tabular-nums ${next ? "text-primary-700 dark:text-primary-300" : "text-gray-500 dark:text-gray-400"}`}
      >
        {formatKickoffClock(fixture.kickoffAt, now, i18n.language)}
      </span>
    </li>
  );
}
