import {
  CENTRE_LANE,
  GOAL_HALF_WIDTH,
  HALFWAY,
  PITCH_LENGTH,
  PITCH_WIDTH,
  type PitchPoint,
  type Side,
  kitNumberTone,
} from "./radarGeometry";
import type { RadarPalette } from "./radarPalette";
import type { RadarOverlay } from "./radarScene";

/**
 * Draws one frame of the match radar on a 2D canvas, in metres: the pitch, the
 * 22 players, the ball and whatever the beat marks. Draws only what it is
 * given — where everyone is comes from the simulation.
 */

/** The part of the pitch shown, in metres: the pitch, its goals and a margin. */
export const RADAR_VIEW = { left: -4, top: -2.5, width: 113, height: 73 };

export interface DrawnPlayer {
  id: string;
  side: Side;
  at: PitchPoint;
  /** A kit colour from the team's data, or null for the theme's colour. */
  kit: string | null;
  number: number | null;
  name: string;
  showName: boolean;
  isHighlighted: boolean;
  isKeeper: boolean;
}

export interface RadarPicture {
  ball: PitchPoint;
  lift: number;
  /** 0 while the ball is out of play, fading out and back in either side. */
  ballOpacity: number;
  trail: PitchPoint[];
  overlay: RadarOverlay | null;
  players: DrawnPlayer[];
  /** The goal being celebrated and how far through its celebration, 0…1. */
  celebration: { side: Side; progress: number } | null;
  /** A repeating 0…1 for the whistle's ring; null when motion is reduced. */
  pulse: number | null;
  goalLabel: string;
}

/** Pitch markings in metres, to the laws of the game. */
const PENALTY_AREA = { depth: 16.5, halfWidth: 20.16 };
const GOAL_AREA = { depth: 5.5, halfWidth: 9.16 };
const PENALTY_SPOT = 11;
const CENTRE_CIRCLE = 9.15;
const GOAL_DEPTH = 2;
const STRIPES = 10;
const LINE_WIDTH = 0.25;
const DOT_RADIUS = 1.7;

function circle(ctx: CanvasRenderingContext2D, at: PitchPoint, radius: number): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
}

function drawGoal(
  ctx: CanvasRenderingContext2D,
  palette: RadarPalette,
  end: "left" | "right",
  flicker: number,
): void {
  const x = end === "left" ? -GOAL_DEPTH : PITCH_LENGTH;
  ctx.globalAlpha = flicker;
  ctx.fillStyle = palette.goalFill;
  ctx.strokeStyle = palette.goalStroke;
  ctx.lineWidth = LINE_WIDTH;
  ctx.fillRect(x, CENTRE_LANE - GOAL_HALF_WIDTH, GOAL_DEPTH, GOAL_HALF_WIDTH * 2);
  ctx.strokeRect(x, CENTRE_LANE - GOAL_HALF_WIDTH, GOAL_DEPTH, GOAL_HALF_WIDTH * 2);
  ctx.globalAlpha = 1;
}

function drawPenaltyEnd(
  ctx: CanvasRenderingContext2D,
  palette: RadarPalette,
  end: "left" | "right",
): void {
  const fromLine = (depth: number) => (end === "left" ? depth : PITCH_LENGTH - depth);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = LINE_WIDTH;
  const boxX = end === "left" ? 0 : PITCH_LENGTH - PENALTY_AREA.depth;
  ctx.strokeRect(
    boxX,
    CENTRE_LANE - PENALTY_AREA.halfWidth,
    PENALTY_AREA.depth,
    PENALTY_AREA.halfWidth * 2,
  );
  const goalAreaX = end === "left" ? 0 : PITCH_LENGTH - GOAL_AREA.depth;
  ctx.strokeRect(
    goalAreaX,
    CENTRE_LANE - GOAL_AREA.halfWidth,
    GOAL_AREA.depth,
    GOAL_AREA.halfWidth * 2,
  );
  ctx.fillStyle = palette.spot;
  circle(ctx, { x: fromLine(PENALTY_SPOT), y: CENTRE_LANE }, 0.3);
  ctx.fill();
  // The "D": the part of the 9.15 m circle round the spot outside the area.
  const reach = Math.acos((PENALTY_AREA.depth - PENALTY_SPOT) / CENTRE_CIRCLE);
  const facing = end === "left" ? 0 : Math.PI;
  ctx.beginPath();
  ctx.arc(fromLine(PENALTY_SPOT), CENTRE_LANE, CENTRE_CIRCLE, facing - reach, facing + reach);
  ctx.stroke();
}

/** The grass, the lines and the goals. `rippleEnd` is the net just scored in, flickering. */
function drawPitch(
  ctx: CanvasRenderingContext2D,
  palette: RadarPalette,
  ripple: { end: "left" | "right"; flicker: number } | null,
): void {
  ctx.fillStyle = palette.surround;
  ctx.fillRect(-GOAL_DEPTH - 1, -1.5, PITCH_LENGTH + GOAL_DEPTH * 2 + 2, PITCH_WIDTH + 3);
  ctx.fillStyle = palette.stripe;
  const stripeWidth = PITCH_LENGTH / STRIPES;
  for (let index = 0; index < STRIPES; index += 2) {
    ctx.fillRect(index * stripeWidth, 0, stripeWidth, PITCH_WIDTH);
  }
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 0.3;
  ctx.strokeRect(0, 0, PITCH_LENGTH, PITCH_WIDTH);
  ctx.lineWidth = LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(HALFWAY, 0);
  ctx.lineTo(HALFWAY, PITCH_WIDTH);
  ctx.stroke();
  circle(ctx, { x: HALFWAY, y: CENTRE_LANE }, CENTRE_CIRCLE);
  ctx.stroke();
  ctx.fillStyle = palette.spot;
  circle(ctx, { x: HALFWAY, y: CENTRE_LANE }, 0.35);
  ctx.fill();
  drawPenaltyEnd(ctx, palette, "left");
  drawPenaltyEnd(ctx, palette, "right");
  for (const end of ["left", "right"] as const) {
    drawGoal(ctx, palette, end, ripple?.end === end ? ripple.flicker : 1);
  }
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  palette: RadarPalette,
  trail: PitchPoint[],
): void {
  if (trail.length < 2) return;
  ctx.strokeStyle = palette.trail;
  ctx.lineWidth = 0.3;
  ctx.lineCap = "round";
  ctx.setLineDash([0.6, 0.9]);
  ctx.beginPath();
  const [first, ...rest] = trail;
  ctx.moveTo(first.x, first.y);
  for (const point of rest) ctx.lineTo(point.x, point.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  palette: RadarPalette,
  overlay: RadarOverlay | null,
  pulse: number | null,
): void {
  if (overlay?.kind === "cut") {
    const { from, at } = overlay;
    ctx.strokeStyle = palette.cut;
    ctx.lineWidth = 0.35;
    ctx.lineCap = "round";
    ctx.setLineDash([1, 0.8]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(at.x, at.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(at.x - 1, at.y - 1);
    ctx.lineTo(at.x + 1, at.y + 1);
    ctx.moveTo(at.x - 1, at.y + 1);
    ctx.lineTo(at.x + 1, at.y - 1);
    ctx.stroke();
  }
  if (overlay?.kind === "whistle") {
    ctx.strokeStyle = palette.whistle;
    ctx.lineWidth = 0.3;
    // A ring that spreads and fades, like a whistle blast; still when motion is reduced.
    ctx.globalAlpha = pulse === null ? 1 : 1 - pulse;
    circle(ctx, overlay.at, 2.6 * (pulse === null ? 1 : 1 + pulse));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawPlayerMark(
  ctx: CanvasRenderingContext2D,
  palette: RadarPalette,
  overlay: RadarOverlay | null,
  player: DrawnPlayer,
): void {
  const { at } = player;
  if (overlay?.kind === "card" && overlay.playerId === player.id) {
    const isYellow = overlay.colour === "yellow";
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate((12 * Math.PI) / 180);
    ctx.fillStyle = isYellow ? palette.yellowCard : palette.redCard;
    ctx.strokeStyle = isYellow ? palette.yellowCardEdge : palette.redCardEdge;
    ctx.lineWidth = 0.12;
    ctx.fillRect(1.2, -4.4, 1.4, 1.9);
    ctx.strokeRect(1.2, -4.4, 1.4, 1.9);
    ctx.restore();
  }
  if (overlay?.kind === "injury" && overlay.playerId === player.id) {
    const centre = { x: at.x + 1.7, y: at.y - 1.7 };
    ctx.fillStyle = palette.injury;
    circle(ctx, centre, 0.9);
    ctx.fill();
    ctx.strokeStyle = palette.injuryMark;
    ctx.lineWidth = 0.28;
    ctx.beginPath();
    ctx.moveTo(centre.x - 0.5, centre.y);
    ctx.lineTo(centre.x + 0.5, centre.y);
    ctx.moveTo(centre.x, centre.y - 0.5);
    ctx.lineTo(centre.x, centre.y + 0.5);
    ctx.stroke();
  }
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  palette: RadarPalette,
  player: DrawnPlayer,
): void {
  const { at } = player;
  ctx.fillStyle =
    player.kit ?? (player.side === "Home" ? palette.homeFallback : palette.awayFallback);
  ctx.strokeStyle = player.isHighlighted ? palette.ringHighlight : palette.ring;
  ctx.lineWidth = player.isHighlighted ? 0.45 : 0.22;
  ctx.setLineDash(player.isKeeper ? [0.9, 0.45] : []);
  circle(ctx, at, DOT_RADIUS);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (player.number !== null) {
    ctx.font = `bold 1.45px ${palette.headingFont}`;
    ctx.fillStyle =
      kitNumberTone(player.kit) === "dark" ? palette.numberOnLight : palette.numberOnDark;
    ctx.fillText(String(player.number), at.x, at.y);
  }
  if (player.showName) {
    ctx.font = `600 1.6px ${palette.bodyFont}`;
    ctx.lineWidth = 0.45;
    ctx.strokeStyle = palette.nameOutline;
    ctx.fillStyle = palette.name;
    ctx.strokeText(player.name, at.x, at.y + 3.5);
    ctx.fillText(player.name, at.x, at.y + 3.5);
  }
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  palette: RadarPalette,
  ball: PitchPoint,
  lift: number,
  opacity: number,
): void {
  if (opacity <= 0) return;
  ctx.globalAlpha = opacity;
  ctx.fillStyle = palette.shadow;
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y, 0.95, 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // In the air the ball rises off its shadow and looks a little bigger.
  ctx.fillStyle = palette.ball;
  ctx.strokeStyle = palette.ballStroke;
  ctx.lineWidth = 0.18;
  circle(ctx, { x: ball.x, y: ball.y - lift }, 0.85 * (1 + lift / 14));
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** The banner's opacity through the celebration: in fast, held, then fading. */
function bannerOpacity(progress: number): number {
  if (progress < 0.12) return progress / 0.12;
  if (progress < 0.8) return 1;
  return Math.max(0, (1 - progress) / 0.2);
}

function drawCelebration(
  ctx: CanvasRenderingContext2D,
  palette: RadarPalette,
  label: string,
  progress: number,
): void {
  ctx.globalAlpha = bannerOpacity(progress);
  ctx.fillStyle = palette.banner;
  ctx.beginPath();
  ctx.roundRect(HALFWAY - 15, CENTRE_LANE - 28, 30, 9, 2);
  ctx.fill();
  ctx.fillStyle = palette.bannerText;
  ctx.font = `bold 5.5px ${palette.headingFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label.toLocaleUpperCase(), HALFWAY, CENTRE_LANE - 23.5);
  ctx.globalAlpha = 1;
}

/** The net's flicker for the first part of a celebration. */
function netFlicker(progress: number): number {
  const cycle = (progress * 3) % 1;
  return progress < 0.66 && cycle > 0.25 && cycle < 0.75 ? 0.35 : 1;
}

/** Draws `picture`, `pixelsPerMetre` pixels to the metre, on a canvas sized to `RADAR_VIEW`. */
export function drawRadar(
  ctx: CanvasRenderingContext2D,
  picture: RadarPicture,
  palette: RadarPalette,
  pixelsPerMetre: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, RADAR_VIEW.width * pixelsPerMetre, RADAR_VIEW.height * pixelsPerMetre);
  ctx.setTransform(
    pixelsPerMetre,
    0,
    0,
    pixelsPerMetre,
    -RADAR_VIEW.left * pixelsPerMetre,
    -RADAR_VIEW.top * pixelsPerMetre,
  );
  const { celebration } = picture;
  drawPitch(
    ctx,
    palette,
    celebration
      ? {
          end: celebration.side === "Home" ? "right" : "left",
          flicker: netFlicker(celebration.progress),
        }
      : null,
  );
  drawTrail(ctx, palette, picture.trail);
  drawOverlay(ctx, palette, picture.overlay, picture.pulse);
  for (const player of picture.players) {
    drawPlayer(ctx, palette, player);
    drawPlayerMark(ctx, palette, picture.overlay, player);
  }
  drawBall(ctx, palette, picture.ball, picture.lift, picture.ballOpacity);
  if (celebration) drawCelebration(ctx, palette, picture.goalLabel, celebration.progress);
}
