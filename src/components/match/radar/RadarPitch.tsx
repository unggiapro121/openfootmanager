import { CENTRE_LANE, GOAL_HALF_WIDTH, HALFWAY, PITCH_LENGTH, PITCH_WIDTH } from "./radarGeometry";

/** Pitch markings in metres, to the laws of the game. */
const PENALTY_AREA = { depth: 16.5, halfWidth: 20.16 };
const GOAL_AREA = { depth: 5.5, halfWidth: 9.16 };
const PENALTY_SPOT = 11;
const CENTRE_CIRCLE = 9.15;
const GOAL_DEPTH = 2;
const STRIPES = 10;

const LINE = "fill-none stroke-white/60 dark:stroke-white/45";

interface RadarPitchProps {
  /** The goal that has just been scored in: its net flickers. */
  rippleEnd: "left" | "right" | null;
}

function Goal({ end, ripple }: { end: "left" | "right"; ripple: boolean }) {
  const x = end === "left" ? -GOAL_DEPTH : PITCH_LENGTH;
  return (
    <rect
      x={x}
      y={CENTRE_LANE - GOAL_HALF_WIDTH}
      width={GOAL_DEPTH}
      height={GOAL_HALF_WIDTH * 2}
      strokeWidth={0.25}
      className={`fill-white/25 stroke-white dark:fill-white/15 dark:stroke-gray-200 ${
        ripple ? "motion-safe:animate-radar-ripple" : ""
      }`}
    />
  );
}

function PenaltyEnd({ end }: { end: "left" | "right" }) {
  const fromLine = (depth: number) => (end === "left" ? depth : PITCH_LENGTH - depth);
  const boxX = end === "left" ? 0 : PITCH_LENGTH - PENALTY_AREA.depth;
  const goalAreaX = end === "left" ? 0 : PITCH_LENGTH - GOAL_AREA.depth;
  const arcEdge = fromLine(PENALTY_AREA.depth);
  // The "D": the part of the 9.15 m circle round the spot outside the area.
  const arcRise = Math.sqrt(CENTRE_CIRCLE ** 2 - (PENALTY_AREA.depth - PENALTY_SPOT) ** 2);
  const sweep = end === "left" ? 1 : 0;
  return (
    <g>
      <rect
        x={boxX}
        y={CENTRE_LANE - PENALTY_AREA.halfWidth}
        width={PENALTY_AREA.depth}
        height={PENALTY_AREA.halfWidth * 2}
        strokeWidth={0.25}
        className={LINE}
      />
      <rect
        x={goalAreaX}
        y={CENTRE_LANE - GOAL_AREA.halfWidth}
        width={GOAL_AREA.depth}
        height={GOAL_AREA.halfWidth * 2}
        strokeWidth={0.25}
        className={LINE}
      />
      <circle
        cx={fromLine(PENALTY_SPOT)}
        cy={CENTRE_LANE}
        r={0.3}
        className="fill-white/70 dark:fill-white/55"
      />
      <path
        d={`M ${arcEdge} ${CENTRE_LANE - arcRise} A ${CENTRE_CIRCLE} ${CENTRE_CIRCLE} 0 0 ${sweep} ${arcEdge} ${CENTRE_LANE + arcRise}`}
        strokeWidth={0.25}
        className={LINE}
      />
    </g>
  );
}

/** The grass, the lines and the goals the radar is drawn on. Decoration only. */
export function RadarPitch({ rippleEnd }: RadarPitchProps) {
  const stripeWidth = PITCH_LENGTH / STRIPES;
  return (
    <g>
      <rect
        x={-GOAL_DEPTH - 1}
        y={-1.5}
        width={PITCH_LENGTH + GOAL_DEPTH * 2 + 2}
        height={PITCH_WIDTH + 3}
        rx={1.5}
        className="fill-primary-700 dark:fill-primary-900"
      />
      {Array.from({ length: STRIPES }, (_, index) =>
        index % 2 === 0 ? (
          <rect
            key={index}
            x={index * stripeWidth}
            y={0}
            width={stripeWidth}
            height={PITCH_WIDTH}
            className="fill-white/5 dark:fill-white/5"
          />
        ) : null,
      )}
      <rect
        x={0}
        y={0}
        width={PITCH_LENGTH}
        height={PITCH_WIDTH}
        strokeWidth={0.3}
        className={LINE}
      />
      <line x1={HALFWAY} y1={0} x2={HALFWAY} y2={PITCH_WIDTH} strokeWidth={0.25} className={LINE} />
      <circle cx={HALFWAY} cy={CENTRE_LANE} r={CENTRE_CIRCLE} strokeWidth={0.25} className={LINE} />
      <circle cx={HALFWAY} cy={CENTRE_LANE} r={0.35} className="fill-white/70 dark:fill-white/55" />
      <PenaltyEnd end="left" />
      <PenaltyEnd end="right" />
      <Goal end="left" ripple={rippleEnd === "left"} />
      <Goal end="right" ripple={rippleEnd === "right"} />
    </g>
  );
}
