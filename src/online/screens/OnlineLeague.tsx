import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import StandingsTable from "../../components/tournaments/StandingsTable";
import { usePhoneLayout } from "../../hooks/usePhoneLayout";
import { Button, Card, CardBody, CardHeader } from "../../components/ui";
import type { LeagueView } from "../api";
import { online } from "../client";
import { leagueTeamLookup, toStandingData } from "../convert/standings";
import { currentRound, LEAGUE_ROUNDS } from "../fixtures";
import { tracked, useOnlineStore } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import FixtureLine from "./FixtureLine";
import ChampionsCard from "./honours/ChampionsCard";
import { DefendingStar } from "./honours/TrophyIcon";
import PhoneLeague from "./league/PhoneLeague";
import { LeagueLeaders } from "./LeagueLeaders";
import ResourceState from "./ResourceState";

/** Fixtures of a whole league season: 26 rounds of seven. */
const SEASON_FIXTURES = 182;

/**
 * The coach's league (C-2 §3.5): its table, then its fixtures round by round. On a phone, the
 * phone's own page (PhoneLeague).
 */
export default function OnlineLeague() {
  const { t } = useTranslation();
  const league = useOnlineStore((state) => state.league);
  const phone = usePhoneLayout();
  if (league === undefined) return null;
  if (league === null) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.league.none")}</p>;
  }
  return phone ? <PhoneLeague league={league} /> : <LeaguePage league={league} />;
}

function LeaguePage({ league }: { league: LeagueView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const myClubId = useOnlineStore((state) => state.club?.club.id ?? null);
  const rows = new Map(league.table.map((row) => [row.club.id, row]));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <Card>
        <CardHeader>
          {t("online.league.heading", { name: league.name, level: league.level })}
        </CardHeader>
        <CardBody className="space-y-3 p-0">
          <p className="px-6 pt-4 text-xs text-gray-500 dark:text-gray-400">
            {t("online.league.progress", { done: league.fixturesDone, total: SEASON_FIXTURES })}
          </p>
          {league.rankedPerMatch && (
            <p role="note" className="px-6 text-xs text-accent-700 dark:text-accent-400">
              {t("online.league.rankedPerMatch")}
            </p>
          )}
          <div className="overflow-x-auto">
            <StandingsTable
              standings={toStandingData(league.table)}
              variant="full"
              teams={leagueTeamLookup(league, myClubId, (id) => navigate(`/online/clubs/${id}`))}
              testIdPrefix="online-standings"
              zones={{ promotionSlots: league.promotionPlaces, relegationSlots: 0 }}
              nameMark={(clubId) =>
                rows.get(clubId)?.defendingChampion ? <DefendingStar /> : null
              }
              extraColumn={{
                label: t("online.league.coach"),
                value: (clubId) => {
                  const row = rows.get(clubId);
                  if (!row) return null;
                  return row.seat === "human" && row.coach
                    ? row.coach.fullName
                    : t("online.league.bot");
                },
              }}
            />
          </div>
        </CardBody>
      </Card>
      <RoundCard league={league} myClubId={myClubId} />
      <div className="xl:col-span-2">
        <LeagueLeaders leagueId={league.id} />
      </div>
      <div className="xl:col-span-2">
        <ChampionsCard leagueId={league.id} level={league.level} />
      </div>
    </div>
  );
}

function RoundCard({ league, myClubId }: { league: LeagueView; myClubId: string | null }) {
  const { t } = useTranslation();
  const [round, setRound] = useState(() => currentRound(league.fixturesDone));
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.leagues.round(league.id, round)),
    [league.id, round],
  );

  return (
    <Card>
      <CardHeader
        action={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("online.league.previousRound")}
              disabled={round <= 1}
              onClick={() => setRound(round - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("online.league.nextRound")}
              disabled={round >= LEAGUE_ROUNDS}
              onClick={() => setRound(round + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      >
        {t("online.fixture.round", { round })}
      </CardHeader>
      <CardBody>
        <ResourceState resource={resource} reload={reload}>
          {(view) => (
            <ul aria-label={t("online.fixture.round", { round })}>
              {view.fixtures.map((fixture) => (
                <FixtureLine key={fixture.id} fixture={fixture} myClubId={myClubId} />
              ))}
            </ul>
          )}
        </ResourceState>
      </CardBody>
    </Card>
  );
}
