import type { PlayerRole } from "../store/types";

// IMPORTANT: this table is the front-end mirror of the backend role table
// `domain::Position::valid_roles()` (src-tauri/crates/domain/src/player.rs).
// The backend command validates against that table and is the
// authority — it rejects an out-of-position role with `be.error.roleNotValidForPosition`
// — so every role offered here MUST be one the backend accepts for that position,
// or the dropdown selection silently reverts. The cross-language parity is pinned
// by tests on both sides (playerRoles.test.ts and squad.rs role-validity tests).
export const ROLE_OPTIONS_BY_POSITION: Record<string, PlayerRole[]> = {
  Goalkeeper: ["Standard", "BallPlayingKeeper", "SweeperKeeper"],
  CenterBack: ["Standard", "Stopper", "CoverCB", "BallPlayingCB"],
  RightBack: ["Standard", "AttackingFB", "DefensiveFB", "InvertedFB", "WingBack"],
  LeftBack: ["Standard", "AttackingFB", "DefensiveFB", "InvertedFB", "WingBack"],
  RightWingBack: ["Standard", "AttackingFB", "DefensiveFB", "InvertedFB", "WingBack"],
  LeftWingBack: ["Standard", "AttackingFB", "DefensiveFB", "InvertedFB", "WingBack"],
  DefensiveMidfielder: ["Standard", "AnchorMan", "BallWinner", "DeepLyingPlaymaker", "HalfBack"],
  CentralMidfielder: ["Standard", "BoxToBox", "Carrilero", "Mezzala"],
  AttackingMidfielder: ["Standard", "AdvancedPlaymaker", "ShadowStriker"],
  RightMidfielder: [
    "Standard",
    "WideForward",
    "InsideForward",
    "InvertedWinger",
    "DefensiveWinger",
  ],
  LeftMidfielder: ["Standard", "WideForward", "InsideForward", "InvertedWinger", "DefensiveWinger"],
  RightWinger: ["Standard", "WideForward", "InsideForward", "InvertedWinger", "DefensiveWinger"],
  LeftWinger: ["Standard", "WideForward", "InsideForward", "InvertedWinger", "DefensiveWinger"],
  Striker: [
    "Standard",
    "Poacher",
    "TargetMan",
    "DeepLyingForward",
    "False9",
    "PressingForward",
    "CompleteForward",
  ],
  // Broad outfield categories (reached via canonicalised/legacy positions like
  // "Defender"/"Midfielder"/"Forward") map to the union of their detailed roles,
  // matching the backend's legacy-bucket branches.
  Defender: [
    "Standard",
    "Stopper",
    "CoverCB",
    "BallPlayingCB",
    "AttackingFB",
    "DefensiveFB",
    "InvertedFB",
    "WingBack",
  ],
  Midfielder: [
    "Standard",
    "AnchorMan",
    "BallWinner",
    "DeepLyingPlaymaker",
    "BoxToBox",
    "Carrilero",
    "Mezzala",
    "AdvancedPlaymaker",
    "ShadowStriker",
    "WideForward",
    "InsideForward",
    "InvertedWinger",
    "HalfBack",
    "DefensiveWinger",
  ],
  Forward: [
    "Standard",
    "WideForward",
    "InsideForward",
    "InvertedWinger",
    "DefensiveWinger",
    "Poacher",
    "TargetMan",
    "DeepLyingForward",
    "False9",
    "PressingForward",
    "CompleteForward",
  ],
};

const ALL_ROLES: PlayerRole[] = [
  "Standard",
  "BallPlayingKeeper",
  "SweeperKeeper",
  "Stopper",
  "CoverCB",
  "BallPlayingCB",
  "AttackingFB",
  "DefensiveFB",
  "InvertedFB",
  "WingBack",
  "AnchorMan",
  "BallWinner",
  "DeepLyingPlaymaker",
  "HalfBack",
  "BoxToBox",
  "Carrilero",
  "Mezzala",
  "AdvancedPlaymaker",
  "ShadowStriker",
  "WideForward",
  "InsideForward",
  "InvertedWinger",
  "DefensiveWinger",
  "Poacher",
  "TargetMan",
  "DeepLyingForward",
  "False9",
  "PressingForward",
  "CompleteForward",
];

export function getRolesForPosition(position: string): PlayerRole[] {
  return ROLE_OPTIONS_BY_POSITION[position] ?? ALL_ROLES;
}

/**
 * Role options for a position that always include `currentRole`. A player's role
 * is a single per-player value that may have been assigned from a different
 * (slot or legacy/broad) position, so it can fall outside this position's option
 * set; including it keeps a controlled <select> in sync instead of silently
 * displaying — and on edit, overwriting with — the wrong role.
 */
export function getRoleOptions(position: string, currentRole?: string | null): PlayerRole[] {
  const base = getRolesForPosition(position);
  if (currentRole && !base.includes(currentRole as PlayerRole)) {
    return [currentRole as PlayerRole, ...base];
  }
  return base;
}

/**
 * Two Stoppers, or two Cover CBs, side by side at centre-back with none of the
 * other kind beside them: the pair the match engine makes pay (two Stoppers
 * leave the space behind them on the break, two Cover CBs the edge of the box;
 * `engine/src/live_match/roles.rs`, phase 2 P2.6). `null` for any other back
 * line. A hint for the manager picking roles, not the rule itself.
 */
export function centreBackPairGap(
  slots: { position: string; playerId: string | null }[],
  roles: Record<string, PlayerRole | undefined>,
): "stoppers" | "covers" | null {
  const atCentreBack = slots
    .filter((slot) => slot.position === "CenterBack" && slot.playerId)
    .map((slot) => roles[slot.playerId ?? ""] ?? "Standard");
  const stoppers = atCentreBack.filter((role) => role === "Stopper").length;
  const covers = atCentreBack.filter((role) => role === "CoverCB").length;
  if (stoppers >= 2 && covers === 0) return "stoppers";
  if (covers >= 2 && stoppers === 0) return "covers";
  return null;
}
