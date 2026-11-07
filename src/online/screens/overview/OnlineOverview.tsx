import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import { standingOf } from "../../convert/standing";
import { online } from "../../client";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import TrophyLift from "../honours/TrophyLift";
import LicenceNotice from "../LicenceNotice";
import ClubCard from "./ClubCard";
import { LastResultCard, StandingCard, UpcomingCard } from "./LeagueCards";
import LicenceCard from "./LicenceCard";
import NextMatchCard from "./NextMatchCard";
import PhoneShortcuts from "./PhoneShortcuts";
import SeasonCard from "./SeasonCard";
import { useItemUse } from "./useItemUse";

const ROW = "flex flex-wrap items-stretch gap-6";

/**
 * The online overview (C-2 §3.3, design tong-quan.html): the next match and the season; the
 * league place, the latest result and the coming fixtures; the club and the coach's licence.
 */
export default function OnlineOverview() {
  const club = useOnlineStore((state) => state.club);
  const league = useOnlineStore((state) => state.league);
  const { start, dialog } = useItemUse();
  const phone = usePhoneLayout();
  const clubId = club?.club.id ?? "";
  const inLeague = Boolean(club?.leagueId);
  const next = club?.nextFixture;
  // The season's fixtures, read again once a match is played and the next one changes.
  const { resource: fixtures, reload } = useOnlineResource(
    async () => (inLeague ? (await tracked(() => online.clubs.mineFixtures())).fixtures : []),
    [clubId, inLeague, next?.id, next?.status],
  );
  if (!club) return null;

  const row = (league && standingOf(league, clubId)) ?? undefined;
  if (phone) {
    // One column in the phone design's order (m-tong-quan.html): the match, the season, the
    // place and the last result side by side, the shortcuts, what comes next, licence and club.
    return (
      <div className="flex flex-col gap-3">
        <LicenceNotice />
        <NextMatchCard onUse={start} />
        <SeasonCard played={row?.played} />
        <div className="grid grid-cols-2 gap-3">
          <StandingCard row={row} inLeague={inLeague} />
          <LastResultCard fixtures={fixtures} reload={reload} clubId={clubId} />
        </div>
        <PhoneShortcuts />
        <UpcomingCard fixtures={fixtures} reload={reload} clubId={clubId} />
        <LicenceCard licence={club.licence} onUse={start} />
        <ClubCard club={club} />
        {dialog}
        <TrophyLift />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <LicenceNotice />
      <div className={ROW}>
        <NextMatchCard onUse={start} />
        <SeasonCard played={row?.played} />
      </div>
      <div className={ROW}>
        <StandingCard row={row} inLeague={inLeague} />
        <LastResultCard fixtures={fixtures} reload={reload} clubId={clubId} />
        <UpcomingCard fixtures={fixtures} reload={reload} clubId={clubId} />
      </div>
      <div className={ROW}>
        <ClubCard club={club} />
        <LicenceCard licence={club.licence} onUse={start} />
      </div>
      {dialog}
      <TrophyLift />
    </div>
  );
}
