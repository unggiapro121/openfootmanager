import { normalisePosition } from "../../lib/positions";
import type { PlayerData } from "../../store/gameStore";

type KeeperSecondaryAttribute =
  | "aerial"
  | "strength"
  | "decisions"
  | "composure"
  | "passing"
  | "vision"
  | "pace"
  | "agility";

// What a keeper with a given shot-stopping score usually has in each secondary attribute:
// expected = intercept + slope × shot-stopping. Comparing against this line, not against the
// keeper median, makes the lean measure the *shape* of a keeper's profile rather than repeat his
// level — good keepers are above the median everywhere. Fitted on the 1,585 keepers of the
// real-world-2025-26 package; refit with fm-document/comon/scripts/goalkeeper_style_fit.py when
// the attribute scale changes.
const KEEPER_EXPECTATION: Record<KeeperSecondaryAttribute, { intercept: number; slope: number }> = {
  aerial: { intercept: 2.7, slope: 0.9 },
  strength: { intercept: 27.5, slope: 0.49 },
  decisions: { intercept: -17.5, slope: 1.17 },
  composure: { intercept: -10.3, slope: 0.78 },
  passing: { intercept: -4.3, slope: 0.45 },
  vision: { intercept: -9.8, slope: 0.76 },
  pace: { intercept: -6.5, slope: 0.64 },
  agility: { intercept: 12.6, slope: 0.4 },
};

type LeanWeights = Partial<Record<KeeperSecondaryAttribute, number>>;

// A keeper's second job in each style, after stopping shots: commanding the box against a low
// block's crosses, releasing a counter quickly, building short in possession, sweeping behind a
// high line.
const BALANCED_LEAN: LeanWeights = { aerial: 1, decisions: 1, composure: 1 };
const KEEPER_STYLE_LEAN: Record<string, LeanWeights> = {
  Balanced: BALANCED_LEAN,
  Defensive: { aerial: 3, strength: 1, decisions: 1, composure: 1 },
  Counter: { aerial: 1, decisions: 2, passing: 2, vision: 2 },
  Possession: { decisions: 1, composure: 2, passing: 3, vision: 2 },
  HighPress: { decisions: 2, composure: 1, passing: 1, pace: 3, agility: 2 },
  Attacking: { decisions: 2, composure: 1, pace: 2, agility: 2 },
};

// The lean stays a nudge near a tier boundary (about ±4 between p10 and p90): the match engine
// scores a keeper on shot-stopping alone, so the style must never outweigh it.
const LEAN_SCALE = 0.5;
const LEAN_CAP = 8;

/** Handling, reflexes and positioning averaged: the keeper rating the match engine uses. */
export function getKeeperShotStopping(player: PlayerData): number {
  const { handling, reflexes, positioning } = player.attributes;
  return (handling + reflexes + positioning) / 3;
}

/** How far a keeper's secondary attributes suit `playStyle`, against keepers of his level. */
export function getKeeperStyleLean(player: PlayerData, playStyle: string): number {
  const weights = Object.entries(KEEPER_STYLE_LEAN[playStyle] ?? BALANCED_LEAN) as Array<
    [KeeperSecondaryAttribute, number]
  >;
  const shotStopping = getKeeperShotStopping(player);
  let weightedGap = 0;
  let totalWeight = 0;
  for (const [attribute, weight] of weights) {
    const { intercept, slope } = KEEPER_EXPECTATION[attribute];
    weightedGap += weight * (player.attributes[attribute] - (intercept + slope * shotStopping));
    totalWeight += weight;
  }
  const lean = (LEAN_SCALE * weightedGap) / totalWeight;
  return Math.min(LEAN_CAP, Math.max(-LEAN_CAP, lean));
}

/**
 * Whether the keeper formula scores this player: he stands in goal, or, with no deployed slot,
 * he is a keeper by trade.
 */
export function isKeeperStyleFitSlot(player: PlayerData, currentPos?: string): boolean {
  return normalisePosition(currentPos ?? player.natural_position) === "Goalkeeper";
}

/** The two halves of a keeper's style-fit score, formatted for its tooltip; null outfield. */
export function getKeeperFitBreakdown(
  player: PlayerData,
  playStyle: string,
  currentPos?: string,
): { save: string; lean: string } | null {
  if (!isKeeperStyleFitSlot(player, currentPos)) {
    return null;
  }
  const lean = getKeeperStyleLean(player, playStyle).toFixed(1);
  return {
    save: Math.round(getKeeperShotStopping(player)).toString(),
    lean: lean.startsWith("-") ? lean : `+${lean}`,
  };
}
