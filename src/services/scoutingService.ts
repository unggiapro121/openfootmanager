import { invoke } from "@tauri-apps/api/core";

import type { GameStateData } from "../store/gameStore";

export interface StartYouthScoutingInput {
  scoutId: string;
  region?: string | null;
  objective?: string | null;
  targetPosition?: string | null;
}

/** Mirrors `ofm_core::scouting::YouthSearchQuote`. */
export interface YouthSearchQuote {
  fee: number;
  days: number;
  rest_days_left: number;
}

export async function quoteYouthSearch(
  scoutId: string,
  region: string,
  objective: string,
): Promise<YouthSearchQuote> {
  return invoke<YouthSearchQuote>("quote_youth_search", { scoutId, region, objective });
}

export async function sendScout(scoutId: string, playerId: string): Promise<GameStateData> {
  return invoke<GameStateData>("send_scout", {
    scoutId,
    playerId,
  });
}

export async function startYouthScouting(input: StartYouthScoutingInput): Promise<GameStateData> {
  return invoke<GameStateData>("start_youth_scouting", {
    scoutId: input.scoutId,
    region: input.region ?? null,
    objective: input.objective ?? null,
    targetPosition: input.targetPosition ?? null,
  });
}

export async function cancelYouthScouting(assignmentId: string): Promise<GameStateData> {
  return invoke<GameStateData>("cancel_youth_scouting", {
    assignmentId,
  });
}

export async function reassignYouthScouting(
  assignmentId: string,
  scoutId: string,
): Promise<GameStateData> {
  return invoke<GameStateData>("reassign_youth_scouting", {
    assignmentId,
    scoutId,
  });
}

export async function assignWatchlistScout(
  prospectId: string,
  scoutId: string | null,
): Promise<GameStateData> {
  return invoke<GameStateData>("assign_watchlist_scout", { prospectId, scoutId });
}

export async function signWatchedProspect(prospectId: string): Promise<GameStateData> {
  return invoke<GameStateData>("sign_watched_prospect", { prospectId });
}

export async function unwatchProspect(prospectId: string): Promise<GameStateData> {
  return invoke<GameStateData>("unwatch_prospect", { prospectId });
}
