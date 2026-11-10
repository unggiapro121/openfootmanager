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

/** A mean to a tenth, a whole number without decimals: 70.3, 72. */
export function formatTenth(value: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
}

/** The gap between two lines, signed so that ahead and behind read at a glance: +1.7, −4, 0. */
export function formatGap(gap: number, language: string): string {
  const rounded = Math.round(gap * 10) / 10;
  const figure = formatTenth(Math.abs(rounded), language);
  if (rounded > 0) return `+${figure}`;
  return rounded < 0 ? `−${figure}` : figure;
}

type Result = { outcome: string; goalsFor: number; goalsAgainst: number };

/** How many of `matches` were won, drawn and lost, seen from the club whose results they are. */
export function totals(matches: readonly Result[]): { won: number; drawn: number; lost: number } {
  const count = (outcome: string) => matches.filter((match) => match.outcome === outcome).length;
  return { won: count("W"), drawn: count("D"), lost: count("L") };
}

/** Goals scored and conceded a match over `matches`; none when there is no match. */
export function perMatch(matches: readonly Result[]): { scored: number; conceded: number } | null {
  if (matches.length === 0) return null;
  const sum = (goals: (match: Result) => number) =>
    matches.reduce((total, match) => total + goals(match), 0);
  return {
    scored: sum((match) => match.goalsFor) / matches.length,
    conceded: sum((match) => match.goalsAgainst) / matches.length,
  };
}
