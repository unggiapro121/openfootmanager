import { invoke } from "./transport";

import type { CareerStartPhase } from "../components/menu/CreateManagerForm";
import type { GameStateData } from "../store/gameStore";
import type {
  BoardObjective,
  FixtureData,
  ManagerData,
  ScoutingAssignment,
  SeasonContextData,
  StandingData,
  TeamData,
  YouthScoutingAssignment,
} from "../store/types";

/** Standing row with team name already resolved by the backend. */
export interface StandingRow extends StandingData {
  team_name: string;
}

/** Slim view of the manager's primary competition. */
export interface UserCompetitionSummary {
  competition_id: string;
  competition_name: string;
  name_key: string | null;
  standings: StandingRow[];
  upcoming_fixtures: FixtureData[];
  recent_fixtures: FixtureData[];
}

/**
 * KB-sized session payload returned by `get_session_state` and (in Phase 2)
 * by every hot command (advance_time, squad mutations, etc.).
 *
 * Contains only what the Home screen and header need — no players array,
 * no news bodies, no transfer history. Heavy collections live in slice commands.
 */
export interface SessionState {
  clock: {
    current_date: string;
    start_date: string;
  };
  manager: ManagerData;
  team: TeamData | null;
  season_context: SeasonContextData;
  board_objectives: BoardObjective[];
  scouting_assignments: ScoutingAssignment[];
  youth_scouting_assignments: YouthScoutingAssignment[];
  active_competition_ids: string[];
  unread_news_count: number;
  unread_messages_count: number;
  user_competition: UserCompetitionSummary | null;
}

/** One saved career, as the load menu lists it. */
export interface SaveEntry {
  id: string;
  name: string;
  manager_name: string;
  team_name: string;
  db_filename: string;
  checksum: string;
  created_at: string;
  last_played_at: string;
  /** The coach account the career belongs to; null for one from before accounts. */
  account_id?: string | null;
}

/** How a new career's world is set up before the first day. */
export type StartupOptionsPayload = {
  startYear: number;
  startPhase: CareerStartPhase;
  historyDepthYears: number;
  developmentSpeedPercent: number;
};

/** The world a new career starts with; its manager is the logged-in coach account. */
export interface NewGameRequest {
  startupOptions: StartupOptionsPayload;
  /** The installed packages to build the world from; absent means the generated world. */
  packageIds: string[] | undefined;
}

/** The full state of the game in progress. Rejects when no game is active. */
export async function getActiveGame(): Promise<GameStateData> {
  return invoke<GameStateData>("get_active_game");
}

/** The id of the save the game in progress belongs to, or null before its first save. */
export async function getActiveSaveId(): Promise<string | null> {
  return invoke<string | null>("get_active_save_id");
}

/** Write the game in progress to its save. */
export async function saveGame(): Promise<void> {
  return invoke<void>("save_game");
}

/** Close the game in progress, without saving, and return to the main menu. */
export async function exitToMenu(): Promise<void> {
  return invoke<void>("exit_to_menu");
}

/** Create a new career's world; the manager still has to pick a club. */
export async function startNewGame(request: NewGameRequest): Promise<GameStateData> {
  return invoke<GameStateData>("start_new_game", {
    startupOptions: request.startupOptions,
    packageIds: request.packageIds,
  });
}

/**
 * The manager takes charge of `teamId`; the backend simulates the listed
 * competitions and whatever regions they need on top of the listed ones.
 */
export async function selectTeam(
  teamId: string,
  activeRegionIds: string[],
  activeCompetitionIds: string[],
): Promise<GameStateData> {
  return invoke<GameStateData>("select_team", {
    teamId,
    activeRegionIds,
    activeCompetitionIds,
  });
}

/** Every saved career on this machine. */
export async function listSaves(): Promise<SaveEntry[]> {
  return invoke<SaveEntry[]>("get_saves");
}

/** Make `saveId` the game in progress. Resolves to its manager's name. */
export async function loadGame(saveId: string): Promise<string> {
  return invoke<string>("load_game", { saveId });
}

/** Delete one saved career. Resolves to whether a save was removed. */
export async function deleteSave(saveId: string): Promise<boolean> {
  return invoke<boolean>("delete_save", { saveId });
}
