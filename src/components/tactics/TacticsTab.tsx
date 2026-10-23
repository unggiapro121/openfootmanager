import { useMemo, type JSX } from "react";
import type { GameStateData, PlayerSelectionOptions } from "../../store/gameStore";

import TacticsBoard from "./TacticsBoard";
import { useGameTacticsSource } from "./useGameTacticsSource";
import { useClubPotentialAssessments } from "../../hooks/useClubPotentialAssessments";
import { assessmentRefreshKey } from "../../lib/scoutedTraits";

interface TacticsTabProps {
  gameState: GameStateData | null;
  onSelectPlayer: (id: string, options?: PlayerSelectionOptions) => void;
  onGameUpdate: (g: GameStateData) => void;
}

/** The manager's own club on the tactics board, saved into the running game. */
export default function TacticsTab({
  gameState,
  onSelectPlayer,
  onGameUpdate,
}: TacticsTabProps): JSX.Element {
  const source = useGameTacticsSource({ gameState, onGameUpdate });
  const { byPlayer: clubReads } = useClubPotentialAssessments(
    assessmentRefreshKey(
      gameState?.clock.current_date ?? "",
      gameState?.staff ?? [],
      gameState?.manager.team_id,
    ),
  );
  const scoutedWonderkids = useMemo(
    () =>
      new Set(
        [...clubReads.values()].filter((read) => read.wonderkid).map((read) => read.player_id),
      ),
    [clubReads],
  );

  return (
    <TacticsBoard
      source={source}
      libraryGame={gameState}
      coach={gameState?.manager ?? null}
      onOpenPlayerProfile={(playerId) => onSelectPlayer(playerId)}
      scoutedWonderkids={scoutedWonderkids}
    />
  );
}
