import { useTranslation } from "react-i18next";
import { Card, CardBody, CardHeader } from "../../components/ui";
import type { FixtureView } from "../api";
import { outcomeFor, seasonFixturesOf } from "../fixtures";
import { useOnlineStore } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import FixtureLine from "./FixtureLine";
import ResourceState from "./ResourceState";

const OUTCOME_CLASS: Record<"W" | "D" | "L", string> = {
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

  if (!leagueId || !clubId) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.league.none")}</p>;
  }
  return <SeasonList leagueId={leagueId} clubId={clubId} />;
}

function SeasonList({ leagueId, clubId }: { leagueId: string; clubId: string }) {
  const { t } = useTranslation();
  const { resource, reload } = useOnlineResource(
    () => seasonFixturesOf(leagueId, clubId),
    [leagueId, clubId],
  );

  return (
    <Card className="max-w-3xl">
      <CardHeader>{t("online.schedule.title")}</CardHeader>
      <CardBody>
        <ResourceState resource={resource} reload={reload}>
          {(fixtures) => (
            <ol aria-label={t("online.schedule.title")}>
              {fixtures.map((fixture) => (
                <ScheduleEntry key={fixture.id} fixture={fixture} clubId={clubId} />
              ))}
            </ol>
          )}
        </ResourceState>
      </CardBody>
    </Card>
  );
}

function ScheduleEntry({ fixture, clubId }: { fixture: FixtureView; clubId: string }) {
  const { t } = useTranslation();
  const outcome = outcomeFor(fixture, clubId);
  return (
    <li className="flex items-center gap-3">
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
      <ul className="min-w-0 flex-1">
        <FixtureLine fixture={fixture} myClubId={clubId} />
      </ul>
    </li>
  );
}
