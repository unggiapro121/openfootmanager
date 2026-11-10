import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Circle, Footprints, History, TrendingUp } from "lucide-react";
import { Badge, Card } from "../../components/ui";
import { usePhoneLayout } from "../../hooks/usePhoneLayout";
import type { ClubRef, FixtureDetailView, PlayerLine } from "../api";
import { online } from "../client";
import { formatMoment } from "../format";
import { FOCUS } from "./mobile/PhoneSheet";
import { tracked, useOnlineStore } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import { manOfTheMatch } from "./fixtureRatings";
import ResourceState from "./ResourceState";
import { onTablistKeyDown, tabIndexOf } from "./mobile/tablistKeys";
import { PlayerLink } from "./opponent/PlayerLink";

/**
 * A settled fixture (C-2 §3.5): the score and every player's part, from the match summary the
 * server kept (`GET /v1/fixtures/{id}`), and a way into its replay (C-2 §3.7). The desktop's match-detail dialog shows shots, passes
 * and a report the online summary does not have, so this page shows what it has and nothing
 * made up.
 */
export default function OnlineFixture() {
  const { fixtureId = "" } = useParams();
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.fixtures.byId(fixtureId)),
    [fixtureId],
  );
  return (
    <ResourceState resource={resource} reload={reload}>
      {(detail) => <FixtureResult detail={detail} />}
    </ResourceState>
  );
}

const CREST =
  "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-primary-500/40 bg-primary-500/15 font-heading text-lg font-bold text-primary-300";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/** A rating's colour, as the offline ratings panel grades it. */
function ratingClass(rating: number): string {
  if (rating >= 8) return "text-accent-700 dark:text-accent-400";
  if (rating >= 7) return "text-green-700 dark:text-green-400";
  if (rating >= 6) return "text-gray-600 dark:text-gray-300";
  if (rating >= 5) return "text-yellow-700 dark:text-yellow-400";
  return "text-red-400";
}

function FixtureResult({ detail }: { detail: FixtureDetailView }) {
  const { t, i18n } = useTranslation();
  const { fixture } = detail;
  const settled = fixture.homeGoals !== undefined && fixture.awayGoals !== undefined;
  const phone = usePhoneLayout();
  const motm = manOfTheMatch(detail.players);
  const motmClub = motm && (motm.clubId === fixture.home.id ? fixture.home : fixture.away);
  const myClubId = useOnlineStore((state) => state.club?.club.id ?? null);
  const coachOfFixture = myClubId === fixture.home.id || myClubId === fixture.away.id;

  return (
    <div className="space-y-5">
      <Card accent="primary">
        <div className="rounded-t-xl bg-gradient-to-r from-navy-700 to-navy-800 p-6">
          <p className="mb-4 text-center text-xs uppercase tracking-widest text-gray-400">
            {t("online.fixture.round", { round: fixture.round })} ·{" "}
            {formatMoment(fixture.kickoffAt, i18n.language)}
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 md:flex md:flex-wrap md:justify-center md:gap-10">
            <div className="flex min-w-0 flex-col items-center gap-2 text-center md:flex-row md:gap-4 md:text-left">
              <span className={CREST} aria-hidden="true">
                {initialsOf(fixture.home.name)}
              </span>
              <Link
                to={`/online/clubs/${fixture.home.id}`}
                className="rounded font-heading text-base font-bold text-white hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {fixture.home.name}
              </Link>
            </div>
            <h2
              className="flex items-center gap-3 font-heading text-4xl font-bold tabular-nums text-white md:gap-5 md:text-5xl"
              aria-label={
                settled
                  ? `${fixture.homeGoals} – ${fixture.awayGoals}`
                  : t("online.fixture.noLines")
              }
            >
              <span>{settled ? fixture.homeGoals : "–"}</span>
              <span className="text-center">
                <span className="block font-heading text-xs uppercase tracking-widest text-accent-400">
                  {t("match.fullTime")}
                </span>
                <span className="block font-heading text-base font-bold text-gray-500">
                  {t("match.ft")}
                </span>
              </span>
              <span>{settled ? fixture.awayGoals : "–"}</span>
            </h2>
            <div className="flex min-w-0 flex-col-reverse items-center gap-2 text-center md:flex-row md:gap-4 md:text-left">
              <Link
                to={`/online/clubs/${fixture.away.id}`}
                className="rounded font-heading text-base font-bold text-white hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {fixture.away.name}
              </Link>
              <span className={CREST} aria-hidden="true">
                {initialsOf(fixture.away.name)}
              </span>
            </div>
          </div>
          {fixture.status === "void" && (
            <p className="mt-3 text-center text-sm text-accent-400">{t("online.fixture.void")}</p>
          )}
          {fixture.matchId && (fixture.matchStatus === "finished" || settled) && (
            <div className="mt-4 flex justify-center">
              <Link
                to={`/online/match/${fixture.matchId}`}
                className="inline-flex items-center gap-1 rounded text-sm font-semibold text-primary-400 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <History className="h-4 w-4" aria-hidden="true" />
                {t("online.replay.watch")}
              </Link>
            </div>
          )}
        </div>
      </Card>
      {motm && motmClub && (
        <div className="flex items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 p-3 dark:border-accent-500/20 dark:bg-accent-500/10">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-100 font-heading text-base font-bold text-accent-700 dark:bg-accent-500/20 dark:text-accent-400">
            {motm.rating.toFixed(1)}
          </div>
          <div>
            <p className="font-heading text-xs font-bold uppercase tracking-wider text-accent-700 dark:text-accent-400">
              {t("match.motm")}
            </p>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
              {motm.name} · {motmClub.name}
            </p>
          </div>
        </div>
      )}
      {coachOfFixture && (
        <Link
          to={`/online/fixtures/${fixture.id}/progress`}
          className="inline-flex items-center gap-1.5 rounded text-sm font-semibold text-primary-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:focus:ring-offset-navy-900"
        >
          <TrendingUp className="h-4 w-4" aria-hidden="true" />
          {t("online.progress.link")}
        </Link>
      )}
      {detail.players.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.fixture.noLines")}</p>
      ) : phone ? (
        <PhoneClubTabs home={fixture.home} away={fixture.away} lines={detail.players} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <ClubLines club={fixture.home} lines={detail.players} phone={phone} />
          <ClubLines club={fixture.away} lines={detail.players} phone={phone} />
        </div>
      )}
    </div>
  );
}

type Side = "home" | "away";

/**
 * The two clubs' ratings as two tabs on a phone (C-22a, C22-1): one list at a time, so neither
 * club's players sit below a screen of the other's. A coach of the away club opens on his own
 * club; anyone else, the home coach and an onlooker alike, on the home club (D-PG1). Tapped, not
 * swiped (D-PG2).
 */
function PhoneClubTabs({
  home,
  away,
  lines,
}: {
  home: ClubRef;
  away: ClubRef;
  lines: PlayerLine[];
}) {
  const { t } = useTranslation();
  const myClubId = useOnlineStore((state) => state.club?.club.id ?? null);
  // Derived until the coach taps a tab, so a club that loads after the fixture still opens his.
  const [chosen, setChosen] = useState<Side | null>(null);
  const side: Side = chosen ?? (myClubId === away.id ? "away" : "home");
  const ids = useId();
  const tabs: { id: Side; club: ClubRef }[] = [
    { id: "home", club: home },
    { id: "away", club: away },
  ];
  return (
    <div>
      <div
        role="tablist"
        onKeyDown={onTablistKeyDown}
        aria-label={t("online.fixture.clubTabs")}
        className="mb-3 grid grid-cols-2 rounded-[10px] border border-gray-200 bg-white p-[3px] dark:border-navy-700 dark:bg-navy-800"
      >
        {tabs.map((tab) => {
          const on = tab.id === side;
          return (
            <button
              key={tab.id}
              id={`${ids}-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={tabIndexOf(on)}
              aria-controls={`${ids}-panel`}
              onClick={() => setChosen(tab.id)}
              className={`h-9 min-w-0 truncate rounded-lg px-2 text-[13px] font-semibold ${on ? "bg-gray-100 text-gray-900 dark:bg-navy-700 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}
            >
              {tab.club.name}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-${side}`}>
        <ClubLines club={side === "home" ? home : away} lines={lines} phone />
      </div>
    </div>
  );
}

/** A rated player's name: his own coach opens his squad page, anyone else his public page. */
const NAME_LINK =
  "rounded hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800";
const TH =
  "px-4 py-2.5 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400";
const TH_PHONE =
  "px-3 py-2 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400";

/** A player's goals, assists and cards in one cell of the phone's ratings (D-FT7). */
function PartCell({ line }: { line: PlayerLine }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {line.goals > 0 && (
        <span
          role="img"
          aria-label={t("online.fixture.goalsCount", { count: line.goals })}
          className="inline-flex items-center gap-0.5 tabular-nums text-accent-700 dark:text-accent-400"
        >
          <Circle className="h-3 w-3 fill-current" aria-hidden="true" />
          {line.goals > 1 && line.goals}
        </span>
      )}
      {line.assists > 0 && (
        <span
          role="img"
          aria-label={t("online.fixture.assistsCount", { count: line.assists })}
          className="inline-flex items-center gap-0.5 tabular-nums text-primary-700 dark:text-primary-400"
        >
          <Footprints className="h-3 w-3" aria-hidden="true" />
          {line.assists > 1 && line.assists}
        </span>
      )}
      {line.redCards > 0 ? (
        <Badge variant="danger" size="sm">
          {t("online.fixture.redCard")}
        </Badge>
      ) : line.yellowCards > 0 ? (
        <Badge variant="accent" size="sm">
          {t("online.fixture.yellowCards", { cards: line.yellowCards })}
        </Badge>
      ) : null}
    </span>
  );
}

/**
 * A club's players and their part. On a phone the table keeps to four columns, best rated first,
 * so it never scrolls sideways (D-FT7); from `md` up, one column per figure, most minutes first.
 */
function ClubLines({ club, lines, phone }: { club: ClubRef; lines: PlayerLine[]; phone: boolean }) {
  const { t } = useTranslation();
  const own = lines
    .filter((line) => line.clubId === club.id)
    .sort((left, right) =>
      phone
        ? right.rating - left.rating || left.name.localeCompare(right.name)
        : right.minutes - left.minutes || left.name.localeCompare(right.name),
    );

  return (
    <Card>
      <div className="rounded-t-xl border-b border-gray-100 bg-gray-50 px-5 py-3 dark:border-navy-600 dark:bg-navy-800">
        <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
          {t("match.ratings", { team: club.name })}
        </h3>
      </div>
      {phone ? (
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-xs dark:border-navy-600 dark:bg-navy-800">
              <th scope="col" className={`${TH_PHONE} w-12`}>
                {t("online.fixture.rating")}
              </th>
              <th scope="col" className={TH_PHONE}>
                {t("common.name")}
              </th>
              <th scope="col" className={`${TH_PHONE} w-12 text-right`}>
                {t("online.fixture.minutes")}
              </th>
              <th scope="col" className={`${TH_PHONE} w-24 text-right`}>
                {t("online.fixture.part")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
            {own.map((line) => (
              <tr key={line.playerId}>
                <td
                  className={`px-3 py-2 font-heading font-bold tabular-nums ${ratingClass(line.rating)}`}
                >
                  {line.rating > 0 ? line.rating.toFixed(1) : "–"}
                </td>
                <td className="truncate px-3 py-2 font-semibold text-gray-800 dark:text-gray-200">
                  <PlayerLink id={line.playerId} className={NAME_LINK}>
                    {line.name}
                  </PlayerLink>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">
                  {line.minutes}
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  <PartCell line={line} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs dark:border-navy-600 dark:bg-navy-800">
                <th scope="col" className={TH}>
                  {t("online.fixture.rating")}
                </th>
                <th scope="col" className={TH}>
                  {t("common.name")}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t("online.fixture.minutes")}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t("online.squad.goals")}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t("online.fixture.assists")}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t("online.fixture.cards")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
              {own.map((line) => (
                <tr
                  key={line.playerId}
                  className="transition-colors hover:bg-gray-50 dark:hover:bg-navy-700/50"
                >
                  <td
                    className={`px-4 py-2.5 font-heading font-bold tabular-nums ${ratingClass(line.rating)}`}
                  >
                    {line.rating > 0 ? line.rating.toFixed(1) : "–"}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-gray-800 dark:text-gray-200">
                    <PlayerLink id={line.playerId} className={NAME_LINK}>
                      {line.name}
                    </PlayerLink>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                    {line.minutes}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                    {line.goals}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                    {line.assists}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    {line.redCards > 0 ? (
                      <Badge variant="danger" size="sm">
                        {t("online.fixture.redCard")}
                      </Badge>
                    ) : line.yellowCards > 0 ? (
                      <Badge variant="accent" size="sm">
                        {t("online.fixture.yellowCards", { cards: line.yellowCards })}
                      </Badge>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
