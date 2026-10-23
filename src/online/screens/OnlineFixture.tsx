import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Card, CardBody, CardHeader } from "../../components/ui";
import type { ClubRef, FixtureDetailView, PlayerLine } from "../api";
import { online } from "../client";
import { formatMoment } from "../format";
import { tracked } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import ResourceState from "./ResourceState";

/**
 * A settled fixture (C-2 §3.5): the score and every player's part, from the match summary the
 * server kept (`GET /v1/fixtures/{id}`). The desktop's match-detail dialog shows shots, passes
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

function FixtureResult({ detail }: { detail: FixtureDetailView }) {
  const { t, i18n } = useTranslation();
  const { fixture } = detail;
  const settled = fixture.homeGoals !== undefined && fixture.awayGoals !== undefined;

  return (
    <div className="space-y-6">
      <Card accent="primary">
        <CardBody className="flex flex-col items-center gap-2 text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.fixture.round", { round: fixture.round })} ·{" "}
            {formatMoment(fixture.kickoffAt, i18n.language)}
          </p>
          <h2 className="font-heading text-2xl font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
            <Link
              to={`/online/clubs/${fixture.home.id}`}
              className="rounded hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
            >
              {fixture.home.name}
            </Link>{" "}
            {settled ? `${fixture.homeGoals} – ${fixture.awayGoals}` : "–"}{" "}
            <Link
              to={`/online/clubs/${fixture.away.id}`}
              className="rounded hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
            >
              {fixture.away.name}
            </Link>
          </h2>
          {fixture.status === "void" && (
            <p className="text-sm text-accent-700 dark:text-accent-400">
              {t("online.fixture.void")}
            </p>
          )}
        </CardBody>
      </Card>
      {detail.players.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.fixture.noLines")}</p>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <ClubLines club={fixture.home} lines={detail.players} />
          <ClubLines club={fixture.away} lines={detail.players} />
        </div>
      )}
    </div>
  );
}

function ClubLines({ club, lines }: { club: ClubRef; lines: PlayerLine[] }) {
  const { t } = useTranslation();
  const own = lines
    .filter((line) => line.clubId === club.id)
    .sort((left, right) => right.minutes - left.minutes || left.name.localeCompare(right.name));

  return (
    <Card>
      <CardHeader>{club.name}</CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-navy-600 dark:text-gray-400">
            <tr>
              <th scope="col" className="px-4 py-2">
                {t("common.name")}
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                {t("online.fixture.minutes")}
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                {t("online.squad.goals")}
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                {t("online.fixture.assists")}
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                {t("online.fixture.cards")}
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                {t("online.fixture.rating")}
              </th>
            </tr>
          </thead>
          <tbody>
            {own.map((line) => (
              <tr key={line.playerId} className="border-b border-gray-100 dark:border-navy-600">
                <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{line.name}</td>
                <td className="px-2 py-2 text-right tabular-nums">{line.minutes}</td>
                <td className="px-2 py-2 text-right tabular-nums">{line.goals}</td>
                <td className="px-2 py-2 text-right tabular-nums">{line.assists}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {line.redCards > 0
                    ? t("online.fixture.redCard")
                    : line.yellowCards > 0
                      ? t("online.fixture.yellowCards", { cards: line.yellowCards })
                      : ""}
                </td>
                <td className="px-2 py-2 text-right font-heading font-bold tabular-nums">
                  {line.rating > 0 ? line.rating.toFixed(1) : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
