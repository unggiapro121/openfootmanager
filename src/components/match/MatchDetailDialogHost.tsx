import { useGameStore } from "../../store/gameStore";
import MatchDetailDialog from "./MatchDetailDialog";

interface MatchDetailDialogHostProps {
  onSelectPlayer?: (playerId: string) => void;
  onSelectTeam?: (teamId: string) => void;
}

/**
 * The one place the match-details dialog is drawn. Any fixture row opens it
 * through `openMatchDetail`, so no screen has to thread a dialog of its own.
 */
export default function MatchDetailDialogHost({
  onSelectPlayer,
  onSelectTeam,
}: MatchDetailDialogHostProps) {
  const fixtureId = useGameStore((state) => state.matchDetailFixtureId);
  const closeMatchDetail = useGameStore((state) => state.closeMatchDetail);
  if (!fixtureId) return null;
  return (
    <MatchDetailDialog
      fixtureId={fixtureId}
      onClose={closeMatchDetail}
      onSelectPlayer={onSelectPlayer}
      onSelectTeam={onSelectTeam}
    />
  );
}
