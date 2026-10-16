import { invoke } from "./transport";

import type { GameStateData, SeasonAwardsData } from "../store/gameStore";

/** How the season that just ended went, league-wide and for the manager's club. */
export interface EndOfSeasonSummary {
  season: number;
  league_name: string;
  champion_id: string;
  champion_name: string;
  user_position: number;
  user_points: number;
  user_won: number;
  user_drawn: number;
  user_lost: number;
  user_goals_for: number;
  user_goals_against: number;
  golden_boot_player: string;
  golden_boot_goals: number;
  poty_player: string;
  poty_rating: number;
  total_teams: number;
  season_awards: SeasonAwardsData;
}

export interface AdvanceToNextSeasonResponse {
  /** `"fired"` when the board sacks the manager at the season's end. */
  action?: string;
  game: GameStateData;
  summary: EndOfSeasonSummary;
}

/**
 * Close the finished season and roll the world over into the next one. The
 * board's end-of-season review may sack the manager on the way.
 */
export async function advanceToNextSeason(): Promise<AdvanceToNextSeasonResponse> {
  return invoke<AdvanceToNextSeasonResponse>("advance_to_next_season");
}
