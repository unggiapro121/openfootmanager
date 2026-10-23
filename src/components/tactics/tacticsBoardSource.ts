import type {
  PlayerData,
  PlayerRole,
  PositionRating,
  TacticsPhaseSettings,
  TeamData,
  TeamMatchRolesData,
} from "../../store/types";

/**
 * A player as the tactics board reads him: who he is, where he plays, his attributes and how
 * fit he is. Nothing about his contract, value or transfers, which an online club does not
 * show (C-2 C2-6).
 */
export type TacticsRosterPlayer = Pick<
  PlayerData,
  | "id"
  | "match_name"
  | "full_name"
  | "date_of_birth"
  | "nationality"
  | "position"
  | "natural_position"
  | "alternate_positions"
  | "attributes"
  | "condition"
  | "morale"
  | "injury"
  | "team_id"
  | "retired"
  | "traits"
  | "ovr"
  | "jersey_number"
  | "media"
  | "squad_role"
>;

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
  roster: TacticsRosterPlayer[];
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
