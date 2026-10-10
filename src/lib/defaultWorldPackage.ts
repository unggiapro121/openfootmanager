/**
 * The world package a new career starts from unless the player says otherwise: the real-world
 * database built in `ofm-packages/` (FC 25 players, 15 leagues, the European cups).
 */
export const DEFAULT_WORLD_PACKAGE_ID = "real-world-2024-25";

/**
 * Which packages the packages step opens with.
 *
 * The default package is pre-selected only while the player has made no choice of their own.
 * Once they have toggled anything — including unticking the default to play a generated world —
 * their selection stands, even when the list reloads; an empty selection is how a player asks
 * for a random world, so it must not be "fixed" back to the default.
 */
export function initialPackageSelection(
  installedPackageIds: readonly string[],
  currentSelection: readonly string[],
  playerHasChosen: boolean,
): string[] {
  if (playerHasChosen || currentSelection.length > 0) {
    return [...currentSelection];
  }
  return installedPackageIds.includes(DEFAULT_WORLD_PACKAGE_ID)
    ? [DEFAULT_WORLD_PACKAGE_ID]
    : [];
}
