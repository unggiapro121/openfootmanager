import { invoke } from "./transport";

/** A synthetic team's play style in a Sim Lab batch. */
export type PlayStyleDto =
  | "balanced"
  | "attacking"
  | "defensive"
  | "possession"
  | "counter"
  | "high_press";

/** One Sim Lab batch: synthetic teams and engine overrides, no game needed. */
export interface SimBatchConfig {
  games: number;
  seed: number | null;
  home_style: PlayStyleDto;
  away_style: PlayStyleDto;
  home_formation: string;
  away_formation: string;
  home_rating: number;
  away_rating: number;
  home_advantage: number | null;
  shot_accuracy_base: number | null;
  goal_conversion_base: number | null;
  foul_probability: number | null;
  yellow_card_probability: number | null;
  red_card_probability: number | null;
  penalty_probability: number | null;
  injury_probability: number | null;
}

/** A Sim Lab batch's aggregated match statistics. */
export interface SimBatchResults {
  games: number;
  home_wins: number;
  draws: number;
  away_wins: number;
  home_win_pct: number;
  draw_pct: number;
  away_win_pct: number;
  goals_per_game: number;
  home_goals_per_game: number;
  away_goals_per_game: number;
  clean_sheet_home_pct: number;
  clean_sheet_away_pct: number;
  btts_pct: number;
  shots_per_game: number;
  shots_on_target_pct: number;
  goal_conversion_pct: number;
  xg_proxy_per_game: number;
  yellow_cards_per_game: number;
  red_cards_per_game: number;
  fouls_per_game: number;
  penalties_per_game: number;
  penalty_conversion_pct: number;
  injuries_per_game: number;
  corners_per_game: number;
  free_kicks_per_game: number;
  home_possession_avg: number;
  away_possession_avg: number;
  passes_per_game: number;
  goals_per_game_hist: number[];
  scoreline_heatmap: number[][];
  goals_by_bucket: number[];
  total_time_secs: number;
  games_per_sec: number;
}

/** Simulate a batch of matches between two synthetic teams and aggregate the stats. */
export async function runSimBatch(config: SimBatchConfig): Promise<SimBatchResults> {
  return invoke<SimBatchResults>("run_sim_batch", { config });
}
