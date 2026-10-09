import { invoke } from "@tauri-apps/api/core";

import type { FixtureCompetition, FixtureData } from "../store/types";

export interface FixtureTeamStatsData {
  teamId: string;
  possessionPct: number;
  shots: number;
  shotsOnTarget: number;
  passesCompleted: number;
  passesAttempted: number;
  tacklesWon: number;
  interceptions: number;
  foulsCommitted: number;
  yellowCards: number;
  redCards: number;
}

export interface FixturePlayerStatsData {
  playerId: string;
  teamId: string;
  minutesPlayed: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  passesCompleted: number;
  passesAttempted: number;
  tacklesWon: number;
  interceptions: number;
  foulsCommitted: number;
  yellowCards: number;
  redCards: number;
  rating: number;
}

export interface FixturePlayerRefData {
  id: string;
  name: string;
  fullName: string;
  /** Natural position, e.g. "CenterBack". */
  position: string;
}

/** One fixture's full record, as `get_fixture_detail` returns it. */
export interface FixtureDetailData {
  fixtureId: string;
  competitionId: string;
  competitionName: string;
  competition: FixtureCompetition;
  matchday: number;
  date: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  /** The result as the fixture keeps it; null until the match is played. */
  result: FixtureData["result"];
  teamStats: FixtureTeamStatsData[];
  playerStats: FixturePlayerStatsData[];
  /** Every player the result or the stats mention, so a departed scorer still has a name. */
  players: FixturePlayerRefData[];
}

export async function getFixtureDetail(fixtureId: string): Promise<FixtureDetailData> {
  return invoke<FixtureDetailData>("get_fixture_detail", { fixtureId });
}
