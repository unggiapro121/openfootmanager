// The opponent profile's two pure rules (C-23a §6.4, §6.5): a side's strength by line, and where
// a player's name leads.

import { normalisePosition } from "../../../lib/positions";

export type Line = "Goalkeeper" | "Defender" | "Midfielder" | "Forward";

/** The mean OVR of each line that has a player, to a tenth; an empty line is left out. */
export function lineStrength(
  players: readonly { position: string; ovr: number }[],
): Partial<Record<Line, number>> {
  const sums = new Map<Line, { total: number; count: number }>();
  for (const { position, ovr } of players) {
    const line = normalisePosition(position) as Line;
    const sum = sums.get(line) ?? { total: 0, count: 0 };
    sums.set(line, { total: sum.total + ovr, count: sum.count + 1 });
  }
  const lines: Partial<Record<Line, number>> = {};
  for (const [line, { total, count }] of sums) {
    lines[line] = Math.round((total / count) * 10) / 10;
  }
  return lines;
}

/**
 * The coach's own player opens his squad page, where he can act on him; anyone else's opens the
 * read-only public page.
 */
export function playerHref(
  playerId: string,
  myClub: { players: readonly { id: string }[] } | null | undefined,
): string {
  const mine = myClub?.players.some((player) => player.id === playerId) ?? false;
  return mine ? `/online/squad/${playerId}` : `/online/players/${playerId}`;
}
