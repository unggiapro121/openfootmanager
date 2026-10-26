import type { EnginePlayerData, EngineTeamData, MatchSnapshot } from "../types";

/**
 * The match as the radar reads it (C-2 C2-10): the score, the clock, where the ball is, the
 * events, and each side's shape and players. The desktop passes the engine's `MatchSnapshot`,
 * which has all of it; the online mode builds one from the server's match view and frames,
 * which carry no player attributes and no dials of the other side.
 */
export type RadarPlayer = Pick<EnginePlayerData, "id" | "name" | "position">;

export type RadarTeam = Pick<EngineTeamData, "id" | "name" | "formation" | "tactics"> & {
  players: RadarPlayer[];
};

export type RadarMatch = Pick<
  MatchSnapshot,
  | "phase"
  | "current_minute"
  | "home_score"
  | "away_score"
  | "possession"
  | "ball_zone"
  | "ball_lane"
  | "events"
  | "sent_off"
> & {
  home_team: RadarTeam;
  away_team: RadarTeam;
};

/**
 * What a match screen shows of a player beyond the match data: his names, his shirt number and
 * his face. The game's `PlayerData` has all of it; the online squad has what the server sends.
 */
export interface RadarRosterEntry {
  /** What his portrait is drawn from, with his names and nationality: the same on every screen. */
  id?: string;
  nationality?: string | null;
  /** The face his coach picked from the pool (online). */
  portrait_seed?: string | null;
  full_name: string;
  match_name: string;
  jersey_number?: number | null;
  media?: { face?: string };
}

/** Each player's roster entry, by id. */
export type RadarRoster = ReadonlyMap<string, RadarRosterEntry>;

/** The roster of `players`, keyed by id, for a radar that is handed the club's players. */
export function radarRosterOf(
  players: ReadonlyArray<RadarRosterEntry & { id: string }> | null | undefined,
): RadarRoster {
  return new Map((players ?? []).map((player) => [player.id, player]));
}
