import type { DefensiveLine, PitchWidth, TeamColors } from "../../../store/types";
import { layoutFormationSlots } from "../FormationPitch";
import type { EngineTeamData } from "../types";

/**
 * Pitch geometry for the match radar: a top-down pitch in metres, the home side
 * attacking left to right. Everything here is presentation — where a dot is
 * drawn — and decides nothing about the match.
 */

export type Side = "Home" | "Away";

export interface PitchPoint {
  x: number;
  y: number;
}

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
export const HALFWAY = PITCH_LENGTH / 2;
export const CENTRE_LANE = PITCH_WIDTH / 2;
/** Half the width of a goal mouth (7.32 m). */
export const GOAL_HALF_WIDTH = 3.66;

const PITCH_ZONES = ["HomeBox", "HomeDefense", "Midfield", "AwayDefense", "AwayBox"] as const;
export type PitchZone = (typeof PITCH_ZONES)[number];

/** Where along the pitch each engine zone sits, in metres from the home goal line. */
const ZONE_X: Record<PitchZone, number> = {
  HomeBox: 8,
  HomeDefense: 27,
  Midfield: HALFWAY,
  AwayDefense: 78,
  AwayBox: 97,
};

/** The stretch of pitch each engine zone covers, in metres from the home goal line. */
const ZONE_SPAN: Record<PitchZone, [number, number]> = {
  HomeBox: [0, 16.5],
  HomeDefense: [16.5, 38],
  Midfield: [38, 67],
  AwayDefense: [67, 88.5],
  AwayBox: [88.5, PITCH_LENGTH],
};

export function isPitchZone(zone: string): zone is PitchZone {
  return (PITCH_ZONES as readonly string[]).includes(zone);
}

export function zoneCentreX(zone: string): number {
  return isPitchZone(zone) ? ZONE_X[zone] : HALFWAY;
}

export function zoneSpan(zone: string): [number, number] {
  return isPitchZone(zone) ? ZONE_SPAN[zone] : ZONE_SPAN.Midfield;
}

/** The next zone towards the goal `side` attacks; the box stays the box. */
export function zoneAhead(side: Side, zone: string): PitchZone {
  const index = isPitchZone(zone) ? PITCH_ZONES.indexOf(zone) : 2;
  const next = side === "Home" ? Math.min(index + 1, 4) : Math.max(index - 1, 0);
  return PITCH_ZONES[next];
}

export function opposite(side: Side): Side {
  return side === "Home" ? "Away" : "Home";
}

/**
 * A point given from one side's point of view — `depth` metres up from its own
 * goal line, `lane` metres in from its left touchline — on the shared pitch.
 * The away side faces the other way, so its view is the home view turned round.
 */
export function toPitch(side: Side, depth: number, lane: number): PitchPoint {
  return side === "Home"
    ? { x: depth, y: lane }
    : { x: PITCH_LENGTH - depth, y: PITCH_WIDTH - lane };
}

/** The inverse of `toPitch`: the same point seen from `side`'s end. */
export function fromPitch(side: Side, point: PitchPoint): { depth: number; lane: number } {
  return side === "Home"
    ? { depth: point.x, lane: point.y }
    : { depth: PITCH_LENGTH - point.x, lane: PITCH_WIDTH - point.y };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: PitchPoint, to: PitchPoint, t: number): PitchPoint {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

export function distance(a: PitchPoint, b: PitchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Keeps a point on the grass (the ball may sit in a goal, so x gets a little slack). */
export function onPitch(point: PitchPoint): PitchPoint {
  return { x: clamp(point.x, -2, PITCH_LENGTH + 2), y: clamp(point.y, 0.5, PITCH_WIDTH - 0.5) };
}

/**
 * How far a defensive-line setting moves the back line, as a share of the pitch
 * length. A high line pushes the defenders 15% further up the pitch.
 */
const DEFENSIVE_LINE_SHIFT: Record<DefensiveLine, number> = {
  VeryLow: -0.15,
  Low: -0.075,
  Medium: 0,
  High: 0.15,
};

/** How far a width setting spreads the side across the pitch from its centre line. */
const WIDTH_SPREAD: Record<PitchWidth, number> = {
  Narrow: 0.8,
  Normal: 1,
  Wide: 1.2,
};

/** What both sides shape themselves around: where the ball is, and whose it is. */
export interface ShapeFocus {
  x: number;
  y: number;
  possession: Side;
}

/** How a side sets up in one phase, in metres of its own view. */
interface PhaseShape {
  /** How far the back line follows the ball up the pitch, per metre the ball moves. */
  backFollow: number;
  backBase: number;
  /** Back line to front line, and how much longer the side gets per metre further up the ball is. */
  span: number;
  spanFollow: number;
  /** Spread across the pitch, on top of the width dial. */
  width: number;
  /** How far the block slides towards the ball's flank, per metre the ball is off-centre. */
  slide: number;
}

/**
 * With the ball a side pushes on and stretches long and wide; without it, it
 * drops off, squeezes the space between its lines and slides across to the
 * ball. The two differ on purpose: as the ball goes forward the attack
 * lengthens while the defence shortens, so the blocks never move as one.
 */
const WITH_BALL: PhaseShape = {
  backFollow: 0.5,
  backBase: 12,
  span: 28,
  spanFollow: 0.12,
  width: 1.1,
  slide: 0.2,
};
const WITHOUT_BALL: PhaseShape = {
  backFollow: 0.45,
  backBase: 6,
  span: 18,
  spanFollow: 0.1,
  width: 0.85,
  slide: 0.35,
};

/** The vertical-board rows `layoutFormationSlots` uses: the keeper at 88%, defence at 70%. */
const KEEPER_ROW_MIN = 80;
const DEFENCE_ROW = 70;
const FORWARD_ROW = 18;
/** How far a keeper edges towards the ball's post: never out of his goal. */
const KEEPER_SLIDE = 0.15;
const KEEPER_SLIDE_MAX = GOAL_HALF_WIDTH - 1;

/** One player's place on the vertical formation board, in percent of its width and height. */
export interface ShapeSlot {
  id: string;
  x: number;
  y: number;
}

/**
 * A side's on-pitch players in their formation slots. This is the costly part
 * of a shape and changes only with the line-up, so a caller drawing many shapes
 * works it out once.
 */
export function formationSlots(team: EngineTeamData, sentOff: string[]): ShapeSlot[] {
  return layoutFormationSlots(team.formation, team.players, sentOff)
    .filter((slot) => !slot.isSentOff && !sentOff.includes(slot.player.id))
    .map((slot) => ({ id: slot.player.id, x: slot.x, y: slot.y }));
}

/**
 * Where every player of one side stands, in its formation shape, around `focus`.
 *
 * The block follows the ball up and down the pitch and across it, shaped by
 * whether the side has the ball (`WITH_BALL`, `WITHOUT_BALL`), and the
 * side's defensive line and width dials stretch it, so a manager's
 * instructions are visible on the radar.
 */
export function placeShape(
  slots: ShapeSlot[],
  team: EngineTeamData,
  side: Side,
  focus: ShapeFocus,
): Map<string, PitchPoint> {
  const ball = fromPitch(side, focus);
  const phase = focus.possession === side ? WITH_BALL : WITHOUT_BALL;
  const lineShift = DEFENSIVE_LINE_SHIFT[team.tactics?.defensive_line ?? "Medium"] * PITCH_LENGTH;
  const spread = WIDTH_SPREAD[team.tactics?.width ?? "Normal"] * phase.width;
  const backLine = clamp(phase.backFollow * ball.depth + phase.backBase + lineShift, 6, 64);
  const frontLine = Math.min(backLine + phase.span + phase.spanFollow * ball.depth, 95);
  const slide = (ball.lane - CENTRE_LANE) * phase.slide;

  const positions = new Map<string, PitchPoint>();
  for (const slot of slots) {
    if (slot.y >= KEEPER_ROW_MIN) {
      const keeperDepth = clamp(4 + ball.depth * 0.1, 3, 16);
      const keeperLane =
        CENTRE_LANE +
        clamp((ball.lane - CENTRE_LANE) * KEEPER_SLIDE, -KEEPER_SLIDE_MAX, KEEPER_SLIDE_MAX);
      positions.set(slot.id, toPitch(side, keeperDepth, keeperLane));
      continue;
    }
    const lineDepth = clamp((DEFENCE_ROW - slot.y) / (DEFENCE_ROW - FORWARD_ROW), 0, 1.1);
    const depth = Math.min(backLine + lineDepth * (frontLine - backLine), 101);
    const lane = clamp(
      CENTRE_LANE + ((slot.x / 100) * PITCH_WIDTH - CENTRE_LANE) * spread + slide,
      3,
      65,
    );
    positions.set(slot.id, toPitch(side, depth, lane));
  }
  return positions;
}

/** `placeShape` for one side, working its slots out afresh. Sent-off players get no position. */
export function shapePositions(
  team: EngineTeamData,
  side: Side,
  sentOff: string[],
  focus: ShapeFocus,
): Map<string, PitchPoint> {
  return placeShape(formationSlots(team, sentOff), team, side, focus);
}

// ---------------------------------------------------------------------------
// Kit colours
// ---------------------------------------------------------------------------

function parseHex(colour: string | undefined): [number, number, number] | null {
  const match = colour?.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!match) return null;
  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** Rough perceptual distance between two colours, 0–~765. */
function colourDistance(a: [number, number, number], b: [number, number, number]): number {
  const meanRed = (a[0] + b[0]) / 2;
  const [dr, dg, db] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return Math.sqrt(
    (2 + meanRed / 256) * dr * dr + 4 * dg * dg + (2 + (255 - meanRed) / 256) * db * db,
  );
}

const KITS_TOO_CLOSE = 150;

export interface RadarKits {
  /** A kit colour from the team's data, or null to fall back to the theme's colour. */
  home: string | null;
  away: string | null;
}

/**
 * The colour each side's dots wear. Two sides in near-identical colours would be
 * unreadable on a radar, so the away side changes into its second colour, as a
 * visiting team changes strip.
 */
export function pickRadarKits(
  home: TeamColors | undefined,
  away: TeamColors | undefined,
): RadarKits {
  const homeRgb = parseHex(home?.primary);
  const awayRgb = parseHex(away?.primary);
  const homeKit = homeRgb ? (home?.primary ?? null) : null;
  if (!homeRgb || !awayRgb) {
    return { home: homeKit, away: awayRgb ? (away?.primary ?? null) : null };
  }
  if (colourDistance(homeRgb, awayRgb) >= KITS_TOO_CLOSE) {
    return { home: homeKit, away: away?.primary ?? null };
  }
  const changeRgb = parseHex(away?.secondary);
  if (changeRgb && colourDistance(homeRgb, changeRgb) >= KITS_TOO_CLOSE) {
    return { home: homeKit, away: away?.secondary ?? null };
  }
  return { home: homeKit, away: null };
}

/** Whether a number printed on this kit should be dark (on a light kit) or light. */
export function kitNumberTone(kit: string | null): "dark" | "light" {
  const rgb = parseHex(kit ?? undefined);
  if (!rgb) return "light";
  const [r, g, b] = rgb;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "dark" : "light";
}
