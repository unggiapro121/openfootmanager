import type { ExtraPlayerLine } from "../../../api";
import type { PlayerAttributes } from "../../../api/domain/PlayerAttributes";

export type AttributeKey = keyof PlayerAttributes;

/** An attribute that rose over a press, and by how much. */
export interface AttributeGain {
  attribute: AttributeKey;
  by: number;
}

/** What happened to the players who did not rise: they trained, or why they stopped first. */
export interface UnimprovedGroup {
  /** `trained`, or the server's stop reason (`keepAbove`, `tired`…), `other` when it gave none. */
  kind: string;
  playerIds: string[];
}

/** A press in three numbers: attributes risen, players who rose, and players chosen. */
export function pressTotals(lines: ExtraPlayerLine[]): {
  gains: number;
  improved: number;
  players: number;
} {
  return {
    gains: lines.reduce((total, line) => total + line.gains, 0),
    improved: lines.filter((line) => line.gains > 0).length,
    players: lines.length,
  };
}

/**
 * The attributes a player gained over a press, read from his attributes before it and after the
 * squad was read again. The server only counts the gains (`ExtraPlayerLine.gains`), so the names
 * are given only when the two reads account for every one of them; otherwise `null`, and the
 * sheet shows the count alone.
 */
export function namedGains(
  before: PlayerAttributes | undefined,
  after: PlayerAttributes | undefined,
  gains: number,
): AttributeGain[] | null {
  if (!before || !after || gains <= 0) return null;
  const risen = (Object.keys(after) as AttributeKey[])
    .map((attribute) => ({ attribute, by: Math.round(after[attribute] - before[attribute]) }))
    .filter((gain) => gain.by > 0);
  const total = risen.reduce((sum, gain) => sum + gain.by, 0);
  if (total !== gains) return null;
  return risen.sort(
    (left, right) => right.by - left.by || left.attribute.localeCompare(right.attribute),
  );
}

/** The players who did not rise, those who trained first, then by why each stopped. */
export function unimproved(lines: ExtraPlayerLine[]): UnimprovedGroup[] {
  const groups = new Map<string, string[]>();
  for (const line of lines) {
    if (line.gains > 0) continue;
    const kind = line.sessions > 0 ? "trained" : (line.stoppedBy ?? "other");
    groups.set(kind, [...(groups.get(kind) ?? []), line.playerId]);
  }
  return [...groups.entries()]
    .map(([kind, playerIds]) => ({ kind, playerIds }))
    .sort((left, right) => Number(right.kind === "trained") - Number(left.kind === "trained"));
}
