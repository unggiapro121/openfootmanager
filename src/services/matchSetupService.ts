import { invoke } from "./transport";

import type { MatchSnapshot } from "../components/match/types";

/** The match command that names one of a side's set-piece takers, or its captain. */
export type SetPieceTakerCommand =
  | "SetPenaltyTaker"
  | "SetFreeKickTaker"
  | "SetCornerTaker"
  | "SetCaptain";

/** The backend's pick of captain and set-piece takers; `null` where it found nobody. */
export interface SetPieceTakerSuggestion {
  captain: string | null;
  penalty_taker: string | null;
  free_kick_taker: string | null;
  corner_taker: string | null;
}

/** Before kick-off, `side` drops starter `playerOffId` to the bench for `playerOnId`. */
export async function swapPreMatchStarter(
  side: "Home" | "Away",
  playerOffId: string,
  playerOnId: string,
): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("apply_match_command", {
    command: { PreMatchSwap: { side, player_off_id: playerOffId, player_on_id: playerOnId } },
  });
}

/** Before kick-off, two starters of `side` trade formation slots. */
export async function swapPreMatchPositions(
  side: "Home" | "Away",
  playerAId: string,
  playerBId: string,
): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("apply_match_command", {
    command: { PreMatchSwapPositions: { side, player_a_id: playerAId, player_b_id: playerBId } },
  });
}

/** `side` names `playerId` for the duty `command` stands for (penalties, captaincy...). */
export async function setMatchSetPieceTaker(
  side: "Home" | "Away",
  command: SetPieceTakerCommand,
  playerId: string,
): Promise<MatchSnapshot> {
  return invoke<MatchSnapshot>("apply_match_command", {
    command: { [command]: { side, player_id: playerId } },
  });
}

/** The backend's choice of captain and set-piece takers from `playerIds`. */
export async function suggestSetPieceTakers(playerIds: string[]): Promise<SetPieceTakerSuggestion> {
  return invoke<SetPieceTakerSuggestion>("auto_select_set_pieces", { playerIds });
}
