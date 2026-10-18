import type {
  PlayerData,
  PlayerRole,
  PositionRating,
  TacticsPhaseSettings,
  TeamData,
  TeamMatchRolesData,
} from "../../store/types";

/**
 * Where the tactics board reads a club from and writes its changes to.
 *
 * The board — pitch, player list, command bar and phase panel — is the same
 * whether it edits the manager's club in a running game (the backend's save,
 * `useGameTacticsSource`) or a package club in the world editor (its `tactics`,
 * `useEditorTacticsSource`). Each write resolves once the change is in
 * `team`; a rejected one leaves the board as it was.
 */
export interface TacticsBoardSource {
  team: TeamData | null;
  /** The club's players. */
  roster: PlayerData[];
  /** Each player's rating at every pitch position, by player id. */
  positionRatings: Record<string, PositionRating[]>;
  /** Slot-aligned with the formation: entry `i` plays slot `i`. */
  setStartingXi: (playerIds: string[]) => Promise<void>;
  setFormation: (formation: string) => Promise<void>;
  setPlayStyle: (playStyle: string) => Promise<void>;
  setMatchRoles: (roles: TeamMatchRolesData) => Promise<void>;
  setTacticsPhase: (patch: Partial<TacticsPhaseSettings>) => Promise<void>;
  setPlayerRole: (playerId: string, role: PlayerRole) => Promise<void>;
}
