import type {
  PlayerData,
  PlayerRole,
  PositionRating,
  TacticsPhaseSettings,
  TeamData,
  TeamMatchRolesData,
} from "../../store/types";
import type { TacticsLimits } from "./licenceLimits";

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
  | "nationality"
  | "position"
  | "natural_position"
  | "alternate_positions"
  | "attributes"
  | "condition"
  | "morale"
  | "injury"
  | "team_id"
  | "ovr"
  | "jersey_number"
  | "squad_role"
> &
  Partial<Pick<PlayerData, "date_of_birth" | "traits" | "media">> & {
    /** His age, where the source knows it but not his date of birth (an online squad). */
    age?: number;
    /** The face his coach picked from the pool (online): his portrait is drawn with it. */
    portrait_seed?: string | null;
  };

/** A roster player's age: as the source gave it, or from his date of birth. */
export function rosterPlayerAge(
  player: Pick<TacticsRosterPlayer, "age" | "date_of_birth">,
  calcAge: (dateOfBirth: string) => number,
): number | null {
  if (player.age !== undefined) return player.age;
  return player.date_of_birth ? calcAge(player.date_of_birth) : null;
}

/**
 * Where the tactics board reads a club from and writes its changes to.
 *
 * The board — pitch, player list, command bar and phase panel — is the same
 * whether it edits the manager's club in a running game (the backend's save,
 * `useGameTacticsSource`) or a package club in the world editor (its `tactics`,
 * `useEditorTacticsSource`). Each write resolves once the change is in
 * `team`; a rejected one leaves the board as it was.
 */
/** The club as the tactics board reads it: its shape, XI, roles and phase settings. */
export type TacticsBoardTeam = Pick<
  TeamData,
  | "id"
  | "formation"
  | "play_style"
  | "starting_xi_ids"
  | "match_roles"
  | "tactics_phase"
  | "player_roles"
>;

export interface TacticsBoardSource {
  team: TacticsBoardTeam | null;
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
  /**
   * What the coach's licence closes (online, phase 3 S-9): those choices show as closed. Absent
   * in the game, the world editor and an online season without licences: everything is open.
   */
  limits?: TacticsLimits;
}
