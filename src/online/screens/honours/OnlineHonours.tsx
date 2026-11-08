import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Card, CardBody, CardHeader } from "../../../components/ui";
import type { ClubHonoursView } from "../../api";
import { online } from "../../client";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import ResourceState from "../ResourceState";
import { AwardsCard, RecordsCard, SeasonsCard } from "./HonoursSections";
import { coachName } from "./honoursText";
import { cabinet, type ShelfRow } from "./honoursView";
import { MedalIcon, TrophyIcon } from "./TrophyIcon";

const FOCUS =
  "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800";

/**
 * A club's trophy room (C20-1, C20-2): its titles and promotions, its players' awards, its
 * seasons and its records. `honours` is the coach's own club; `clubs/:clubId/honours` another's,
 * read only.
 */
export default function OnlineHonours() {
  const { clubId: routeClub } = useParams();
  const myClubId = useOnlineStore((state) => state.club?.club.id);
  const clubId = routeClub ?? myClubId;
  if (!clubId) return null;
  return <HonoursOf clubId={clubId} mine={clubId === myClubId} />;
}

function HonoursOf({ clubId, mine }: { clubId: string; mine: boolean }) {
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.clubs.honours(clubId)),
    [clubId],
  );
  return (
    <ResourceState resource={resource} reload={reload}>
      {(view) => <HonoursPage view={view} mine={mine} />}
    </ResourceState>
  );
}

function HonoursPage({ view, mine }: { view: ClubHonoursView; mine: boolean }) {
  const { t } = useTranslation();
  const titles = view.trophies.filter((trophy) => trophy.kind === "leagueTitle").length;
  const promotions = view.trophies.filter((trophy) => trophy.kind === "promotion").length;
  const defending = view.defendingChampion;

  return (
    <div className="flex flex-col gap-6">
      <Card accent="accent">
        <CardBody className="flex flex-wrap items-center gap-4">
          <TrophyIcon level={defending?.place.level ?? 1} className="h-14 w-14 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-2xl font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
              {t("online.honours.titleOf", { club: view.club.name })}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t("online.honours.summary", { titles, promotions })}
            </p>
            {defending && (
              <p className="mt-1 text-sm font-semibold text-accent-700 dark:text-accent-400">
                {t("online.honours.defendingLine", {
                  level: defending.place.level,
                  season: defending.place.seasonNumber,
                })}
              </p>
            )}
          </div>
          {!mine && (
            <Link
              to={`/online/clubs/${view.club.id}`}
              className={`rounded text-sm font-semibold text-primary-700 hover:underline dark:text-primary-400 ${FOCUS}`}
            >
              {t("online.honours.toClub")}
            </Link>
          )}
        </CardBody>
      </Card>
      <CabinetCard view={view} mine={mine} />
      <AwardsCard awards={view.awards} />
      <SeasonsCard seasons={view.seasons} />
      <RecordsCard records={view.records} />
    </div>
  );
}

function CabinetCard({ view, mine }: { view: ClubHonoursView; mine: boolean }) {
  const { t } = useTranslation();
  const [mineOnly, setMineOnly] = useState(false);
  const league = useOnlineStore((state) => state.league);
  const shelf = cabinet(view.trophies, mine && mineOnly);
  const filter = mine && (
    <fieldset aria-label={t("online.honours.filterLabel")} className="m-0 flex gap-1 border-0 p-0">
      {[false, true].map((only) => (
        <button
          key={String(only)}
          type="button"
          aria-pressed={mineOnly === only}
          onClick={() => setMineOnly(only)}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold ${FOCUS} ${
            mineOnly === only
              ? "bg-primary-700 text-white"
              : "bg-gray-100 text-gray-600 hover:text-gray-900 dark:bg-navy-700 dark:text-gray-300 dark:hover:text-white"
          }`}
        >
          {t(only ? "online.honours.filterMine" : "online.honours.filterAll")}
        </button>
      ))}
    </fieldset>
  );

  return (
    <Card>
      <CardHeader action={filter || undefined}>{t("online.honours.cabinet")}</CardHeader>
      <CardBody>
        {shelf.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {mine && mineOnly
              ? t("online.honours.emptyMine")
              : mine && league
                ? t("online.honours.emptyCabinet", { level: league.level })
                : t("online.honours.emptyCabinetOther")}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shelf.map((row) => (
              <ShelfItem key={`${row.kind}:${row.level}`} row={row} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function ShelfItem({ row }: { row: ShelfRow }) {
  const { t } = useTranslation();
  const title = row.kind === "leagueTitle";
  const name = t(title ? "online.honours.kinds.leagueTitle" : "online.honours.kinds.promotion", {
    level: row.level,
  });
  return (
    <li
      aria-label={name}
      className="flex gap-3 rounded-xl border border-gray-200 p-3 dark:border-navy-600"
    >
      {title ? (
        <TrophyIcon level={row.level} className="h-12 w-12 shrink-0" />
      ) : (
        <MedalIcon level={row.level} className="h-10 w-10 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
          {name}
          {row.count > 1 && (
            <span className="ml-2 text-accent-700 dark:text-accent-400">×{row.count}</span>
          )}
        </p>
        <ul className="text-xs text-gray-600 dark:text-gray-400">
          {row.seasons.map((season, index) => (
            <li key={season}>
              {t("online.honours.wonIn", {
                season,
                coach: coachName(t, row.coaches[index]),
              })}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
