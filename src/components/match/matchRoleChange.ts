import { changeMatchPlayerRole } from "../../services/liveMatchService";
import { setPlayerRole } from "../../services/squadService";
import type { PlayerRole } from "../../store/types";
import type { MatchSnapshot } from "./types";

/**
 * Changing a player's role from a match screen: the match takes it now, and it
 * is kept on the player — fire-and-forget — so it carries over to later
 * matches, as on the tactics board.
 */
export function createMatchRoleChange(
  side: "Home" | "Away" | null,
  onSnapshotUpdate: (snapshot: MatchSnapshot) => void,
): (playerId: string, role: PlayerRole) => Promise<void> {
  return async (playerId, role) => {
    if (!side) return;
    try {
      onSnapshotUpdate(await changeMatchPlayerRole(side, playerId, role));
    } catch (err) {
      console.error("Player role change failed:", err);
      return;
    }
    void setPlayerRole(playerId, role).catch((err: unknown) => {
      console.error("Failed to save player role:", err);
    });
  };
}
