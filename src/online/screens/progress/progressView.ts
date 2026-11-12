import type { PlayerProgressLine } from "../../api";

/** What one match did to a squad, for the page's first card (C-22 §7.2). */
export type ProgressSummary = {
  /** Players who gained at least a point, in training or from the bar. */
  improved: number;
  /** Every point gained: trained since the line before, plus each bar's point. */
  points: number;
  /** Players whose OVR rose since the line before, by training or by the bar. */
  ovrUp: number;
  /** Whether any line has the Experience bar: none in a season without match growth. */
  withXp: boolean;
};

/** The points a player gained: what he trained since his line before, and the bar's point. */
export function pointsOf(line: PlayerProgressLine): number {
  const trained = line.trainedSince.reduce((sum, gain) => sum + gain.points, 0);
  return trained + (line.xp?.attributeUp ? 1 : 0);
}

/**
 * The OVR a player's line runs from: his OVR after his line before when there is one, so a rise
 * trained during the week shows (P5-27 Q1); else the match's own, before it was played.
 */
export function ovrFromOf(line: PlayerProgressLine): number {
  return line.ovrSince ?? line.ovrBefore;
}

/** What the OVR did since the line before; below zero after a fall (age at a season's turn). */
export function ovrRiseOf(line: PlayerProgressLine): number {
  return line.ovrAfter - ovrFromOf(line);
}

export function summaryOf(lines: PlayerProgressLine[]): ProgressSummary {
  return {
    improved: lines.filter((line) => pointsOf(line) > 0).length,
    points: lines.reduce((sum, line) => sum + pointsOf(line), 0),
    ovrUp: lines.filter((line) => ovrRiseOf(line) > 0).length,
    withXp: lines.some((line) => line.xp !== undefined),
  };
}

/**
 * The players who played, in §7.2's order: an OVR rise first, then the bar's point, then the
 * points gained, then the match rating. The server sends them by minutes (PO P5-25).
 */
export function playedOrder(lines: PlayerProgressLine[]): PlayerProgressLine[] {
  const barPoint = (line: PlayerProgressLine) => (line.xp?.attributeUp ? 1 : 0);
  return lines
    .filter((line) => line.minutes > 0)
    .sort(
      (left, right) =>
        ovrRiseOf(right) - ovrRiseOf(left) ||
        barPoint(right) - barPoint(left) ||
        pointsOf(right) - pointsOf(left) ||
        right.rating - left.rating ||
        left.name.localeCompare(right.name),
    );
}

/** The players who did not play: the most trained first, then by name. */
export function notPlayedOrder(lines: PlayerProgressLine[]): PlayerProgressLine[] {
  return lines
    .filter((line) => line.minutes === 0)
    .sort((left, right) => pointsOf(right) - pointsOf(left) || left.name.localeCompare(right.name));
}
