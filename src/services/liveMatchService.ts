import { invoke } from "@tauri-apps/api/core";

import type { MatchSnapshot } from "../components/match/types";
import type { PlayerRole } from "../store/types";

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
