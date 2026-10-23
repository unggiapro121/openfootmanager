import { useTranslation } from "react-i18next";
import HomeLeaguePositionCard from "../../components/home/HomeLeaguePositionCard";
import { Card, CardBody, CardHeader } from "../../components/ui";
import { standingOf, toStandingSnapshot } from "../convert/standing";
import { formatMoment } from "../format";
import { useOnlineStore } from "../store/onlineStore";
import ClubCard from "./ClubCard";
import NextFixtureCard from "./NextFixtureCard";
import SeasonCard from "./SeasonCard";

/** Seasons before the first league day: the table does not move yet. */
const BEFORE_LEAGUE = new Set(["scheduled", "preseason"]);

/** The online overview (C-2 §3.3): the season, the club, the next match and the league place. */
export default function OnlineOverview() {
  const club = useOnlineStore((state) => state.club);
  if (!club) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SeasonCard />
      <NextFixtureCard />
      <ClubCard club={club} />
      <LeagueCard clubId={club.club.id} />
    </div>
  );
}

function LeagueCard({ clubId }: { clubId: string }) {
  const { t, i18n } = useTranslation();
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
      showStandingsLink={false}
    />
  );
}
