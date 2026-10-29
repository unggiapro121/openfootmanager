import type { InventoryView, StyleMasteryView } from "../../api";

/**
 * Readings of the coach's career for his profile (design ho-so-hlv.html). Every number is the
 * server's; these only order and name what it sent.
 */

/** The style the coach commands best: the highest level, the first of a tie. */
export function strongestStyle(mastery: StyleMasteryView[]): StyleMasteryView | undefined {
  return mastery.reduce<StyleMasteryView | undefined>(
    (best, style) => (best === undefined || style.level > best.level ? style : best),
    undefined,
  );
}

/** The styles strongest first, a tie in the server's order. */
export function masteryInOrder(mastery: StyleMasteryView[]): StyleMasteryView[] {
  return mastery
    .map((style, index) => ({ style, index }))
    .sort((a, b) => b.style.level - a.style.level || a.index - b.index)
    .map(({ style }) => style);
}

/** A licence against the one the coach holds: passed, held, or still ahead. */
export type TierState = "passed" | "held" | "ahead";

export function tierState(tier: number, held: number): TierState {
  if (tier < held) return "passed";
  return tier === held ? "held" : "ahead";
}

/** The tactical notebooks, weakest first: what adds XP to a style at once (C-7 C7-14). */
export const NOTE_CODES = ["tacticalNoteBasic", "tacticalNoteAdvanced", "tacticalNoteMaster"];

/**
 * The notebooks the coach holds, each with its count; none while the season has no item rules or
 * his items are locked, when no notebook may be used.
 */
export function notebooks(
  items: InventoryView | null | undefined,
): { code: string; total: number }[] | undefined {
  if (!items?.limits || items.locked) return undefined;
  return NOTE_CODES.map((code) => ({
    code,
    total: items.lines.find((line) => line.itemCode === code)?.total ?? 0,
  }));
}
