import { useTranslation } from "react-i18next";

import TournamentsLeaderboard from "./TournamentsLeaderboard";
import { useCompetitionLeaders } from "./useCompetitionLeaders";

interface CompetitionLeaderboardsProps {
  competitionId: string | null;
  /** The game date: a played round changes the leaders, so they reload with it. */
  currentDate: string | undefined;
  onSelectTeam: (id: string) => void;
  onSelectPlayer?: (id: string) => void;
}

/** A competition's top scorers, top assisters and clean-sheet keepers, side by side. */
export default function CompetitionLeaderboards({
  competitionId,
  currentDate,
  onSelectTeam,
  onSelectPlayer,
}: CompetitionLeaderboardsProps) {
  const { t } = useTranslation();
  const leaders = useCompetitionLeaders(competitionId, currentDate);

  const boards = [
    {
      key: "goals",
      title: t("tournaments.topScorers"),
      emptyText: t("tournaments.noGoals"),
      entries: leaders?.goals,
      testIdPrefix: "competition-top-scorer",
    },
    {
      key: "assists",
      title: t("tournaments.topAssists"),
      emptyText: t("tournaments.noAssists"),
      entries: leaders?.assists,
      testIdPrefix: "competition-top-assist",
    },
    {
      key: "cleanSheets",
      title: t("tournaments.topCleanSheets"),
      emptyText: t("tournaments.noCleanSheets"),
      entries: leaders?.cleanSheets,
      testIdPrefix: "competition-clean-sheet",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {boards.map((board) => (
        <TournamentsLeaderboard
          key={board.key}
          title={board.title}
          emptyText={board.emptyText}
          entries={board.entries ?? []}
          testIdPrefix={board.testIdPrefix}
          onSelectTeam={onSelectTeam}
          onSelectPlayer={onSelectPlayer}
        />
      ))}
    </div>
  );
}
