import { invoke } from "./transport";

import type {
  MatchSnapshot,
  MinuteResult,
  RoundSummary,
  TeamTalkTone,
} from "../components/match/types";
import type { GameStateData } from "../store/gameStore";
import type { MasteryGain, PlayerRole } from "../store/types";

/** What the backend hands back once the live match is over and recorded. */
export interface FinishLiveMatchResponse {
  game: GameStateData;
  round_summary?: RoundSummary | null;
  player_ratings: Record<string, number>;
  /** Present when the user managed the match themselves ("go to the field"). */
  mastery_gain?: MasteryGain | null;
}

/** One player's morale before and after a team talk. */
export interface TeamTalkMoraleChange {
  player_id: string;
  player_name: string;
  old_morale: number;
  new_morale: number;
  delta: number;
}

/** How the user's side stands when the manager speaks to the dressing room. */
export type TeamTalkContext = "winning" | "losing" | "drawing";

/** The fixture to kick off as a live match session, by stable fixture identity. */
export interface LiveMatchStart {
  allowsExtraTime: boolean;
  fixtureIndex: number;
  competitionId: string;
  fixtureId: string;
  mode: string;
}

/**
 * Open a live match session for a fixture and return its kick-off snapshot.
 * `allowsExtraTime` decides whether a draw goes to extra time and penalties.
 */
export async function startLiveMatch(start: LiveMatchStart): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("start_live_match", {
    allowsExtraTime: start.allowsExtraTime,
    fixtureIndex: start.fixtureIndex,
    competitionId: start.competitionId,
    fixtureId: start.fixtureId,
    mode: start.mode,
  });
}

/**
 * Play the next `minutes` of the live match, one result per minute played. An
 * empty list means the match has nothing left to play. During a shootout a
 * "minute" is a single penalty.
 */
export async function stepLiveMatch(minutes: number): Promise<MinuteResult[]> {
  return invoke<MinuteResult[]>("step_live_match", { minutes });
}

/** The live match as it stands now: score, clock, both XIs and the events so far. */
export async function getMatchSnapshot(): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("get_match_snapshot");
}

/**
 * Close the live match: the backend writes the report, updates the game and
 * clears the session, so no snapshot can be fetched after this.
 */
export async function finishLiveMatch(): Promise<FinishLiveMatchResponse> {
  return invoke<FinishLiveMatchResponse>("finish_live_match");
}

/** `side` switches to `formation` from now on. */
export async function changeMatchFormation(
  side: "Home" | "Away",
  formation: string,
): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("apply_match_command", {
    command: { ChangeFormation: { side, formation } },
  });
}

/** `side` switches to `playStyle` from now on. */
export async function changeMatchPlayStyle(
  side: "Home" | "Away",
  playStyle: string,
): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("apply_match_command", {
    command: { ChangePlayStyle: { side, play_style: playStyle } },
  });
}

/** `side` takes `playerOffId` off and sends `playerOnId` on in his place. */
export async function substituteMatchPlayer(
  side: "Home" | "Away",
  playerOffId: string,
  playerOnId: string,
): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("apply_match_command", {
    command: { Substitute: { side, player_off_id: playerOffId, player_on_id: playerOnId } },
  });
}

/**
 * The manager gives the team talk `tone`, read against `context`, and gets
 * back each player's morale swing.
 */
export async function giveTeamTalk(
  tone: TeamTalkTone,
  context: TeamTalkContext,
): Promise<TeamTalkMoraleChange[]> {
  return invoke<TeamTalkMoraleChange[]>("apply_team_talk", { tone, context });
}

/**
 * Two players of `side`'s XI trade formation slots, at any point of the match.
 * Not a substitution. Either may be a sent-off player: that is how a side down
 * to ten moves the gap to the line it can best spare.
 */
export async function swapMatchPositions(
  side: "Home" | "Away",
  playerAId: string,
  playerBId: string,
): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("apply_match_command", {
    command: { SwapPositions: { side, player_a_id: playerAId, player_b_id: playerBId } },
  });
}

/** A player of `side`'s XI takes `role` for the rest of this match. */
export async function changeMatchPlayerRole(
  side: "Home" | "Away",
  playerId: string,
  role: PlayerRole,
): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("apply_match_command", {
    command: { ChangePlayerRole: { side, player_id: playerId, role } },
  });
}

/**
 * Before kick-off, the backend rearranges `side`'s XI into the strongest lineup
 * for its formation (the AI lineup rule), from the starters and the bench.
 */
export async function autoPickMatchLineup(side: "Home" | "Away"): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("auto_pick_match_lineup", { side });
}
