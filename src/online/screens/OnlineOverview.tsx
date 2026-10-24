import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import HomeLeaguePositionCard from "../../components/home/HomeLeaguePositionCard";
import { Card, CardBody, CardHeader } from "../../components/ui";
import { standingOf, toStandingSnapshot } from "../convert/standing";
import { online } from "../client";
import { involves, LEAGUE_ROUNDS } from "../fixtures";
import { formatMoment } from "../format";
import { tracked, useOnlineStore } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";
import ClubCard from "./ClubCard";
import FixtureLine from "./FixtureLine";
import LicenceCard from "./LicenceCard";
import LicenceNotice from "./LicenceNotice";
import NextFixtureCard from "./NextFixtureCard";
import SeasonCard from "./SeasonCard";

/** Seasons before the first league day: the table does not move yet. */
const BEFORE_LEAGUE = new Set(["scheduled", "preseason"]);

/** The online overview (C-2 §3.3): the season, the club, the next match and the league place. */
export default function OnlineOverview() {
  const club = useOnlineStore((state) => state.club);
  if (!club) return null;

  return (
    <div className="space-y-6">
      <LicenceNotice />
      <div className="grid gap-6 lg:grid-cols-2">
        <SeasonCard />
        <NextFixtureCard />
        <ClubCard club={club} />
        <LeagueCard clubId={club.club.id} />
        <RecentResultCard />
        <LicenceCard licence={club.licence} />
      </div>
    </div>
  );
}

function LeagueCard({ clubId }: { clubId: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const league = useOnlineStore((state) => state.league);
  const season = useOnlineStore((state) => state.season);
  const opener = useOnlineStore((state) => state.club?.nextFixture?.kickoffAt);

  if (!league) {
    return (
      <Card>
        <CardHeader>{t("online.league.title")}</CardHeader>
        <CardBody>
          <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.league.none")}</p>
        </CardBody>
      </Card>
    );
  }

  const row = standingOf(league, clubId);
  const isPreseason = !season || BEFORE_LEAGUE.has(season.status);
  return (
    <HomeLeaguePositionCard
      isPreseason={isPreseason}
      phase="Preseason"
      seasonStartLabel={opener ? formatMoment(opener, i18n.language) : null}
      myStanding={row?.position ?? null}
      myStandingData={row ? toStandingSnapshot(row) : null}
      teamForm={[]}
      onNavigate={() => navigate("/online/league")}
    />
  );
}

/**
 * The round before the next match: the one the club last played, as long as the season has one.
 * With no match left the season is over, and its last round is the latest.
 */
export function lastPlayedRound(nextRound: number | undefined, inLeague: boolean): number | null {
  if (!inLeague) return null;
  const round = nextRound === undefined ? LEAGUE_ROUNDS : nextRound - 1;
  return round >= 1 ? round : null;
}

/** The club's latest result: one round read, the round before its next match. */
function RecentResultCard() {
  const { t } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const leagueId = club?.leagueId;
  const clubId = club?.club.id ?? "";
  const round = lastPlayedRound(club?.nextFixture?.round, Boolean(leagueId));
  const { resource } = useOnlineResource(async () => {
    if (!leagueId || round === null) return null;
    const view = await tracked(() => online.leagues.round(leagueId, round));
    return view.fixtures.find((fixture) => involves(fixture, clubId)) ?? null;
  }, [leagueId, round, clubId]);
  const fixture = resource.status === "ready" ? resource.data : null;

  return (
    <Card>
      <CardHeader>{t("online.overview.lastResult")}</CardHeader>
      <CardBody>
        {fixture ? (
          <ul>
            <FixtureLine fixture={fixture} myClubId={clubId} />
          </ul>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {resource.status === "loading" ? t("online.loading") : t("online.overview.noResult")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
