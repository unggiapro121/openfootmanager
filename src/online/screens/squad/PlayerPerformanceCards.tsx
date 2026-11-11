import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import PlayerProfileAdvancedStatsCard from "../../../components/playerProfile/PlayerProfileAdvancedStatsCard";
import PlayerProfileCareerHistoryCard from "../../../components/playerProfile/PlayerProfileCareerHistoryCard";
import PlayerProfileRecentMatchesCard from "../../../components/playerProfile/PlayerProfileRecentMatchesCard";
import PlayerProfileSeasonStatsCard from "../../../components/playerProfile/PlayerProfileSeasonStatsCard";
import type { SquadPlayerView } from "../../api";
import { online } from "../../client";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import {
  advancedOf,
  careerOf,
  matchFormOf,
  recentMatchesOf,
  seasonStatsOf,
  unrankedAdvanced,
} from "./playerPerformance";

/**
 * What the cards read of a player: his id and season, and his career and form where the page has
 * them (his own coach's squad does; another club's player's public page does not).
 */
export type PerformanceSubject = Pick<SquadPlayerView, "id" | "season"> &
  Partial<Pick<SquadPlayerView, "career" | "matchForm">>;

/**
 * The cards of the offline profile below a player's attributes (C-21): his season, his advanced
 * figures ranked by the server, his career and his last matches with their rating trend. The
 * season card is left out where the page draws its own (the phone's season tab); the career card
 * where the page has none to show (another club's player's public page, S-46a), rather than one
 * saying he has none.
 */
export default function PlayerPerformanceCards({
  player,
  withSeason = true,
  withCareer = true,
}: {
  player: PerformanceSubject;
  withSeason?: boolean;
  withCareer?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const appearances = player.season.appearances;
  // Read again after each match he plays, as the offline profile does. A server older than S-43
  // has no such route: the cards then show what the squad view holds.
  const { resource } = useOnlineResource(
    () => tracked(() => online.players.performance(player.id)),
    [player.id, appearances],
  );
  const performance = resource.status === "ready" ? resource.data : null;
  const advanced = performance ? advancedOf(performance.advanced) : unrankedAdvanced(player.season);
  const matches = performance ? recentMatchesOf(performance.recentMatches, i18n.language) : [];
  return (
    <>
      {withSeason && (
        <PlayerProfileSeasonStatsCard
          stats={seasonStatsOf(player.season)}
          matchForm={matchFormOf(player)}
          t={t}
        />
      )}
      <PlayerProfileAdvancedStatsCard summary={advanced} t={t} language={i18n.language} />
      {withCareer && (
        <PlayerProfileCareerHistoryCard
          career={careerOf(player)}
          t={t}
          formatSeason={(season) => t("online.player.careerSeason", { season })}
        />
      )}
      <PlayerProfileRecentMatchesCard
        matches={matches}
        t={t}
        renderScore={(match) => (
          <Link
            to={`/online/fixtures/${match.fixture_id}`}
            title={t("match.viewMatchDetails")}
            className="rounded-md px-2 font-heading text-base font-bold tabular-nums text-gray-800 hover:bg-gray-100 hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-100 dark:hover:bg-navy-700 dark:hover:text-primary-400"
          >
            {match.team_goals} - {match.opponent_goals}
          </Link>
        )}
      />
    </>
  );
}
