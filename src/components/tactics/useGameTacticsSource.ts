import { useEffect, useState } from "react";

import type { GameStateData } from "../../store/gameStore";
import { useGameStore } from "../../store/gameStore";
import {
  getSquad,
  getSquadPositionRatings,
  setFormation,
  setPlayStyle,
  setPlayerRole,
  setStartingXi,
  setTacticsPhase,
  setTeamMatchRoles,
} from "../../services/squadService";
import type { PlayerData, PositionRating } from "../../store/types";
import type { TacticsBoardSource } from "./tacticsBoardSource";

/**
 * The manager's own club in the running game: read from the session, written
 * through the backend, every change published with `onGameUpdate`.
 */
export function useGameTacticsSource({
  gameState,
  onGameUpdate,
}: {
  gameState: GameStateData | null;
  onGameUpdate: (g: GameStateData) => void;
}): TacticsBoardSource {
  const { sessionState } = useGameStore();
  const [fetchedSquad, setFetchedSquad] = useState<PlayerData[] | null>(null);
  const teamId = sessionState?.manager?.team_id ?? gameState?.manager?.team_id ?? null;

  useEffect(() => {
    if (!teamId) return;
    void getSquad(teamId)
      .then(setFetchedSquad)
      .catch(() => {});
  }, [teamId]);

  // Each player's rating at every position, from the backend: the board shows
  // a player out of position at the rating he would play there.
  const [positionRatings, setPositionRatings] = useState<Record<string, PositionRating[]>>({});
  useEffect(() => {
    if (!teamId) return;
    void getSquadPositionRatings(teamId)
      .then(setPositionRatings)
      .catch((err: unknown) => {
        console.error("Failed to load position ratings:", err);
      });
  }, [teamId]);

  const publish = async (request: Promise<GameStateData>) => {
    onGameUpdate(await request);
  };

  return {
    team: sessionState?.team ?? gameState?.teams?.find((t) => t.id === teamId) ?? null,
    roster: fetchedSquad ?? gameState?.players ?? [],
    positionRatings,
    setStartingXi: (playerIds) => publish(setStartingXi(playerIds)),
    setFormation: (formation) => publish(setFormation(formation)),
    setPlayStyle: (playStyle) => publish(setPlayStyle(playStyle)),
    setMatchRoles: (roles) => publish(setTeamMatchRoles(roles)),
    setTacticsPhase: (patch) => publish(setTacticsPhase(patch)),
    setPlayerRole: (playerId, role) => publish(setPlayerRole(playerId, role)),
  };
}
