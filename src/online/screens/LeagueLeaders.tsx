import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import TournamentsLeaderboard from "../../components/tournaments/TournamentsLeaderboard";
import type { LeaderView } from "../api";
import { online } from "../client";
import { tracked } from "../store/onlineStore";
import { useOnlineResource } from "../useOnlineResource";

/** A ranked line as the offline leaderboard reads it. */
const asEntry = (leader: LeaderView) => ({
  playerId: leader.playerId,
  name: leader.name,
  fullName: leader.name,
  teamId: leader.clubId,
  teamName: leader.clubName,
  value: leader.value,
});

/**
 * Who leads the league's season, as the offline competition overview shows it, read from the
 * server's `GET /v1/leagues/{id}/leaders` a visit at a time.
 */
function useLeagueLeaders(leagueId: string) {
  return useOnlineResource(() => tracked(() => online.leagues.leaders(leagueId)), [leagueId]);
}

export function LeaderBoard({
  title,
  empty,
  leaders,
  prefix,
}: {
  title: string;
  empty: string;
  leaders: LeaderView[] | undefined;
  prefix: string;
}) {
  const navigate = useNavigate();
  const entries = useMemo(() => (leaders ?? []).map(asEntry), [leaders]);
  return (
    <TournamentsLeaderboard
      title={title}
      emptyText={empty}
      entries={entries}
      testIdPrefix={prefix}
      onSelectTeam={(clubId) => navigate(`/online/clubs/${clubId}`)}
    />
  );
}

/** The league's boards under its table: scorers, assists, clean sheets and the cards. */
export function LeagueLeaders({ leagueId }: { leagueId: string }) {
  const { t } = useTranslation();
  const { resource } = useLeagueLeaders(leagueId);
  const leaders = resource.status === "ready" ? resource.data : undefined;
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      <LeaderBoard
        title={t("tournaments.topScorers")}
        empty={t("tournaments.noGoals")}
        leaders={leaders?.goals}
        prefix="online-top-scorer"
      />
      <LeaderBoard
        title={t("tournaments.topAssists")}
        empty={t("tournaments.noAssists")}
        leaders={leaders?.assists}
        prefix="online-top-assist"
      />
      <LeaderBoard
        title={t("tournaments.topCleanSheets")}
        empty={t("tournaments.noCleanSheets")}
        leaders={leaders?.cleanSheets}
        prefix="online-clean-sheet"
      />
      <LeaderBoard
        title={t("tournaments.mostYellowCards")}
        empty={t("tournaments.noCards")}
        leaders={leaders?.yellowCards}
        prefix="online-yellow-card"
      />
      <LeaderBoard
        title={t("tournaments.mostRedCards")}
        empty={t("tournaments.noCards")}
        leaders={leaders?.redCards}
        prefix="online-red-card"
      />
    </div>
  );
}
