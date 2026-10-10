import { invoke } from "@tauri-apps/api/core";

import type { MatchSnapshot } from "../components/match/types";

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
