import { invoke } from "@tauri-apps/api/core";
import type { LeagueData, SeasonAwardsData, WorldCupChampionData } from "../store/types";

/** One leaderboard row: the player as he is now, and his tally. */
export interface LeaderEntryData {
  playerId: string;
  name: string;
  fullName: string;
  teamId: string | null;
  teamName: string | null;
  value: number;
}

/** A competition's season leaders, best first, ten at most per board. */
export interface CompetitionLeadersData {
  competitionId: string;
  goals: LeaderEntryData[];
  assists: LeaderEntryData[];
  yellowCards: LeaderEntryData[];
  redCards: LeaderEntryData[];
}

export interface CompetitionsView {
  competitions: LeagueData[];
  team_names: Record<string, string>;
  national_team_names: Record<string, string>;
  national_team_name_keys: Record<string, string>;
  world_cup_champions: WorldCupChampionData[];
  manager_team_id: string | null;
  active_competition_ids: string[];
}

export async function fetchCompetitionsView(): Promise<CompetitionsView> {
  return invoke<CompetitionsView>("get_competitions_view", { query: {} });
}

export async function fetchSeasonAwards(): Promise<SeasonAwardsData> {
  return invoke<SeasonAwardsData>("get_season_awards");
}

export async function fetchCompetitionLeaders(
  competitionId: string,
): Promise<CompetitionLeadersData> {
  return invoke<CompetitionLeadersData>("get_competition_leaders", { competitionId });
}
