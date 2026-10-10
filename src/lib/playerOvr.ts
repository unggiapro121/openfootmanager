type PlayerWithOvr = {
  ovr?: number | null;
};

export function getPlayerOvr(player: PlayerWithOvr): number {
  return player.ovr ?? 0;
}

/** How many players start a match: the likely XI a club's strength is read from. */
const LIKELY_XI = 11;

/** The side a club would most likely start: its eleven best players by OVR, best first. */
export function likelyXi<T extends PlayerWithOvr>(players: T[]): T[] {
  return [...players]
    .sort((left, right) => getPlayerOvr(right) - getPlayerOvr(left))
    .slice(0, LIKELY_XI);
}

/**
 * A club's average OVR, read from its likely XI: reserves who would not start
 * say nothing about how strong it is on a matchday. Rounded; 0 for nobody.
 * The backend's team cards use the same rule (`likely_xi_average_ovr`).
 */
export function likelyXiAverageOvr(players: PlayerWithOvr[]): number {
  const xi = likelyXi(players);
  if (xi.length === 0) return 0;
  return Math.round(xi.reduce((sum, player) => sum + getPlayerOvr(player), 0) / xi.length);
}
