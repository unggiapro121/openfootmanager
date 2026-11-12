import type { GoalSourceCounts, LaneShare, TrendSideView, TrendView } from "../../api";

/** The seven goal sources, in the order the block lists them (S-46b `GoalSourceCounts`). */
const GOAL_SOURCES: readonly (keyof GoalSourceCounts)[] = [
  "openPlay",
  "corner",
  "freeKickSetPiece",
  "penalty",
  "header",
  "directFreeKick",
  "longShot",
];

/** What the block counts per match as observed play: behaviours, never a dial (BR-6). */
const BEHAVIOURS = [
  "longBalls",
  "crosses",
  "lowCrosses",
  "earlyCrosses",
  "counters",
  "highTurnovers",
  "ballsInBehind",
  "flankExposed",
  "offsides",
] as const satisfies readonly (keyof TrendSideView)[];

export type Behaviour = (typeof BEHAVIOURS)[number];
export type GoalSource = keyof GoalSourceCounts;
export type TeamFigure = "possession" | "shots" | "corners" | "fouls" | "cards" | "passAccuracy";
export type Lane = keyof LaneShare;

export interface GoalRow {
  source: GoalSource;
  scored: number;
  conceded: number;
}

export interface StyleRow {
  behaviour: Behaviour;
  team: number;
  against: number;
}

export interface TeamRow {
  figure: TeamFigure;
  team: TrendSideView;
  against: TrendSideView;
}

/**
 * Goals scored and conceded by source, totals over the matches. A source at 0 on both sides says
 * nothing and is left out (C-23 §7).
 */
export function goalRows(trend: TrendView): GoalRow[] {
  return GOAL_SOURCES.map((source) => ({
    source,
    scored: trend.team.goalsBySource[source],
    conceded: trend.against.goalsBySource[source],
  })).filter((row) => row.scored > 0 || row.conceded > 0);
}

/**
 * The observed play, per match, the club's and its opponents'. A behaviour at 0 on both sides is
 * left out, whichever it is: one no club in the league plays yet would only be noise (PO P5-34).
 */
export function styleRows(trend: TrendView): StyleRow[] {
  return BEHAVIOURS.map((behaviour) => ({
    behaviour,
    team: trend.team[behaviour],
    against: trend.against[behaviour],
  })).filter((row) => row.team > 0 || row.against > 0);
}

/** The team's figures; the pass accuracy only when the server sent it for both sides. */
export function teamRows(trend: TrendView): TeamRow[] {
  const figures: TeamFigure[] = ["possession", "shots", "corners", "fouls", "cards"];
  if (trend.team.passAccuracy !== undefined && trend.against.passAccuracy !== undefined) {
    figures.push("passAccuracy");
  }
  return figures.map((figure) => ({ figure, team: trend.team, against: trend.against }));
}

/**
 * A side's share of its final-third play by lane, left to right; none to draw when all three are 0
 * (the server sends that when no such event was counted).
 */
export function laneBars(side: TrendSideView): { lane: Lane; share: number }[] | null {
  const { left, centre, right } = side.finalThirdLanes;
  if (left === 0 && centre === 0 && right === 0) return null;
  return [
    { lane: "left", share: left },
    { lane: "centre", share: centre },
    { lane: "right", share: right },
  ];
}
