import { type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Radar, Tags } from "lucide-react";

import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";
import { useGameStore } from "../../../store/gameStore";
import type { MatchSnapshot, SimSpeed } from "../types";
import { RadarPitch } from "./RadarPitch";
import type { RadarEase, RadarOverlay, RadarScene } from "./radarScene";
import { scenePositions } from "./radarStage";
import {
  CENTRE_LANE,
  HALFWAY,
  type PitchPoint,
  type RadarKits,
  type Side,
  kitNumberTone,
} from "./radarGeometry";
import { radarPacing, useRadarDirector } from "./useRadarDirector";

interface MatchRadar2DProps {
  snapshot: MatchSnapshot;
  speed: SimSpeed;
  kits: RadarKits;
}

const EASING: Record<RadarEase, string> = {
  linear: "linear",
  out: "cubic-bezier(0.2, 0.7, 0.3, 1)",
  in: "cubic-bezier(0.6, 0, 0.9, 0.4)",
  inOut: "ease-in-out",
  // A touch on the ground: quick off the foot, then rolling to a stop.
  push: "cubic-bezier(0.25, 0.8, 0.45, 1)",
};

const CELEBRATION_MS = 1800;
const SHAKE: Keyframe[] = [
  { transform: "translate(0, 0)" },
  { transform: "translate(-4px, 2px)" },
  { transform: "translate(4px, -2px)" },
  { transform: "translate(-3px, 1px)" },
  { transform: "translate(0, 0)" },
];

/** Dot colours for a side whose kit colour is unknown or clashes: the theme's home and away. */
const FALLBACK_FILL: Record<Side, string> = {
  Home: "fill-primary-500 dark:fill-primary-400",
  Away: "fill-indigo-500 dark:fill-indigo-400",
};

const TOGGLE_CLASS =
  "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-heading uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800";

/**
 * How a player's move eases and how long it takes: a run with a pace of its own
 * (meeting a pass, jogging back into shape) keeps it; anyone else acting out the
 * step moves with it; the rest drift with the shape.
 */
function playerTransition(scene: RadarScene, playerId: string): string {
  const isMover = playerId in scene.movers;
  const runMs = scene.runMs[playerId];
  if (runMs !== undefined) {
    return `transform ${runMs}ms ${isMover ? EASING[scene.moveEase] : "ease-in-out"}`;
  }
  return isMover
    ? `transform ${scene.moveMs}ms ${EASING[scene.moveEase]}`
    : `transform ${scene.shapeMs}ms ease-in-out`;
}

function translate(point: PitchPoint): string {
  return `translate(${point.x}px, ${point.y}px)`;
}

/**
 * The goal just scored, for as long as it is celebrated: a banner over the
 * pitch, a flicker of the net and — unless the player prefers reduced motion —
 * a shake of the whole radar.
 */
function useGoalCelebration(
  goal: RadarScene["goal"],
  reducedMotion: boolean,
  shakeRef: RefObject<HTMLDivElement | null>,
): RadarScene["goal"] {
  const [celebrating, setCelebrating] = useState<RadarScene["goal"]>(null);
  // Keyed on the serial, not the object: the same goal can reach here as two
  // objects (played step by step, or jumped to), and a re-run for the second
  // would clear the first one's timer and leave the banner up.
  const serial = goal?.serial ?? 0;
  const seenSerial = useRef(serial);
  const goalRef = useRef(goal);
  goalRef.current = goal;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    const latest = goalRef.current;
    if (!latest || serial === seenSerial.current) return;
    seenSerial.current = serial;
    setCelebrating(latest);
    const radar = shakeRef.current;
    if (!reducedMotionRef.current && typeof radar?.animate === "function") {
      radar.animate(SHAKE, { duration: 480, easing: "ease-in-out" });
    }
    const timer = setTimeout(() => setCelebrating(null), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [serial, shakeRef]);

  return celebrating;
}

function RadarBall({ scene }: { scene: RadarScene }) {
  // In the air the shadow travels steadily while the ball rises and falls on
  // its own curve; on the ground both share the step's easing.
  const isAerial = scene.ballEase === "out" || scene.ballEase === "in";
  const groundEase = isAerial ? EASING.linear : EASING[scene.ballEase];
  return (
    <g
      style={{
        transform: translate(scene.ball),
        transition: `transform ${scene.ballMs}ms ${groundEase}`,
      }}
    >
      <ellipse rx={0.95} ry={0.5} className="fill-navy-900/35 dark:fill-navy-900/50" />
      <g
        style={{
          transform: `translate(0px, ${-scene.lift}px) scale(${1 + scene.lift / 14})`,
          transition: `transform ${scene.ballMs}ms ${EASING[scene.ballEase]}`,
        }}
      >
        <circle
          r={0.85}
          strokeWidth={0.18}
          className="fill-white stroke-navy-900 dark:fill-gray-100 dark:stroke-navy-900"
        />
      </g>
    </g>
  );
}

function OverlayMarks({ overlay }: { overlay: RadarOverlay | null }) {
  if (overlay?.kind === "cut") {
    const { from, at } = overlay;
    return (
      <g strokeWidth={0.35} strokeLinecap="round" className="stroke-red-500 dark:stroke-red-400">
        <line x1={from.x} y1={from.y} x2={at.x} y2={at.y} strokeDasharray="1 0.8" />
        <line x1={at.x - 1} y1={at.y - 1} x2={at.x + 1} y2={at.y + 1} />
        <line x1={at.x - 1} y1={at.y + 1} x2={at.x + 1} y2={at.y - 1} />
      </g>
    );
  }
  if (overlay?.kind === "whistle") {
    return (
      <circle
        cx={overlay.at.x}
        cy={overlay.at.y}
        r={2.6}
        strokeWidth={0.3}
        className="fill-none stroke-white/90 dark:stroke-white/80 transform-fill origin-center motion-safe:animate-ping"
      />
    );
  }
  return null;
}

function PlayerMarks({ overlay, playerId }: { overlay: RadarOverlay | null; playerId: string }) {
  if (overlay?.kind === "card" && overlay.playerId === playerId) {
    const fill =
      overlay.colour === "yellow"
        ? "fill-accent-400 stroke-accent-700 dark:fill-accent-400 dark:stroke-accent-700"
        : "fill-red-600 stroke-red-900 dark:fill-red-500 dark:stroke-red-900";
    return (
      <rect
        x={1.2}
        y={-4.4}
        width={1.4}
        height={1.9}
        rx={0.15}
        strokeWidth={0.12}
        transform="rotate(12)"
        className={fill}
      />
    );
  }
  if (overlay?.kind === "injury" && overlay.playerId === playerId) {
    return (
      <g transform="translate(1.7 -1.7)">
        <circle r={0.9} className="fill-red-600 dark:fill-red-500" />
        <path
          d="M -0.5 0 H 0.5 M 0 -0.5 V 0.5"
          strokeWidth={0.28}
          className="stroke-white dark:stroke-white"
        />
      </g>
    );
  }
  return null;
}

interface RadarPlayerProps {
  id: string;
  side: Side;
  at: PitchPoint;
  kit: string | null;
  number: number | null;
  name: string;
  showName: boolean;
  isHighlighted: boolean;
  isKeeper: boolean;
  /** The CSS transition for his moves: brisk when he is in the action, a glide when not. */
  transition: string;
  overlay: RadarOverlay | null;
  swayIndex: number;
}

function RadarPlayer(props: RadarPlayerProps) {
  const { id, side, at, kit, number, name, showName, isHighlighted, isKeeper } = props;
  const numberFill =
    kitNumberTone(kit) === "dark"
      ? "fill-navy-900 dark:fill-navy-900"
      : "fill-white dark:fill-white";
  const ring = isHighlighted
    ? "stroke-accent-400 dark:stroke-accent-300"
    : "stroke-white/85 dark:stroke-white/70";
  return (
    <g
      style={{
        transform: translate(at),
        transition: props.transition,
      }}
    >
      <g
        className="motion-safe:animate-radar-sway"
        style={{ animationDelay: `-${(props.swayIndex * 0.37) % 3.6}s` }}
      >
        <circle
          r={1.7}
          strokeWidth={isHighlighted ? 0.45 : 0.22}
          strokeDasharray={isKeeper ? "0.9 0.45" : undefined}
          style={kit ? { fill: kit } : undefined}
          className={`${kit ? "" : FALLBACK_FILL[side]} ${ring}`}
        />
        {number != null && (
          <text
            fontSize={1.45}
            textAnchor="middle"
            dominantBaseline="central"
            className={`font-heading font-bold ${numberFill}`}
          >
            {number}
          </text>
        )}
      </g>
      {showName && (
        <text
          y={3.5}
          fontSize={1.6}
          textAnchor="middle"
          paintOrder="stroke"
          strokeWidth={0.45}
          className="font-sans font-semibold fill-white stroke-navy-900/80 dark:fill-white dark:stroke-navy-900/90"
        >
          {name}
        </text>
      )}
      <PlayerMarks overlay={props.overlay} playerId={id} />
    </g>
  );
}

interface RadarFieldProps extends MatchRadar2DProps {
  showAllNames: boolean;
  reducedMotion: boolean;
}

function RadarField({ snapshot, speed, kits, showAllNames, reducedMotion }: RadarFieldProps) {
  const { t } = useTranslation();
  const pacing = useMemo(() => radarPacing(speed), [speed]);
  const { scene, stage } = useRadarDirector(snapshot, pacing, reducedMotion);
  const shakeRef = useRef<HTMLDivElement>(null);
  const celebration = useGoalCelebration(scene.goal, reducedMotion, shakeRef);
  // Match names and shirt numbers live on the full player, not the match snapshot.
  const squad = useGameStore((state) => state.gameState?.players);
  const squadById = useMemo(() => new Map((squad ?? []).map((p) => [p.id, p])), [squad]);
  const positions = scenePositions(stage, scene);
  const sides: { side: Side; team: MatchSnapshot["home_team"]; kit: string | null }[] = [
    { side: "Home", team: snapshot.home_team, kit: kits.home },
    { side: "Away", team: snapshot.away_team, kit: kits.away },
  ];

  return (
    <div ref={shakeRef} className="px-3 pb-3">
      <svg
        viewBox="-4 -2.5 113 73"
        role="img"
        aria-label={t("match.radar.pitchLabel", {
          home: snapshot.home_team.name,
          away: snapshot.away_team.name,
        })}
        className="mx-auto block h-auto max-h-80 w-full"
      >
        <RadarPitch
          rippleEnd={celebration ? (celebration.side === "Home" ? "right" : "left") : null}
        />
        {scene.trail.length > 1 && (
          <polyline
            points={scene.trail.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            strokeWidth={0.3}
            strokeLinecap="round"
            strokeDasharray="0.6 0.9"
            className="stroke-white/40 dark:stroke-white/30"
          />
        )}
        <OverlayMarks overlay={scene.overlay} />
        {sides.flatMap(({ side, team, kit }) =>
          team.players.map((player, index) => {
            const at = positions.get(player.id);
            if (!at) return null;
            const full = squadById.get(player.id);
            return (
              <RadarPlayer
                key={player.id}
                id={player.id}
                side={side}
                at={at}
                kit={kit}
                number={full?.jersey_number ?? null}
                name={full?.match_name || player.name}
                showName={showAllNames || scene.highlight.includes(player.id)}
                isHighlighted={scene.highlight.includes(player.id)}
                isKeeper={player.position === "Goalkeeper"}
                transition={playerTransition(scene, player.id)}
                overlay={scene.overlay}
                swayIndex={index + (side === "Away" ? 11 : 0)}
              />
            );
          }),
        )}
        <RadarBall scene={scene} />
        {celebration && (
          <g key={celebration.serial} className="motion-safe:animate-radar-goal">
            <rect
              x={HALFWAY - 15}
              y={CENTRE_LANE - 28}
              width={30}
              height={9}
              rx={2}
              className="fill-navy-900/75 dark:fill-navy-900/85"
            />
            <text
              x={HALFWAY}
              y={CENTRE_LANE - 23.5}
              fontSize={5.5}
              textAnchor="middle"
              dominantBaseline="central"
              className="font-heading font-bold uppercase tracking-wider fill-accent-400 dark:fill-accent-400"
            >
              {t("match.eventTypes.Goal")}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * The live match seen from above: 22 dots in their formations and the ball,
 * acting out the engine's events as they arrive. It shows what the commentary
 * already says — the event feed stays the full account — so the pitch is one
 * labelled picture to a screen reader.
 */
export function MatchRadar2D({ snapshot, speed, kits }: MatchRadar2DProps) {
  const { t } = useTranslation();
  const reducedMotion = usePrefersReducedMotion();
  const [isOpen, setIsOpen] = useState(true);
  const [showAllNames, setShowAllNames] = useState(false);
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className="border-b border-gray-200 bg-white transition-colors duration-300 dark:border-navy-700 dark:bg-navy-800"
    >
      <div className="flex items-center justify-between px-4 py-2">
        <h3
          id={titleId}
          className="flex items-center gap-2 text-xs font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400"
        >
          <Radar className="h-4 w-4" aria-hidden="true" />
          {t("match.radar.title")}
        </h3>
        <div className="flex items-center gap-1">
          {isOpen && (
            <button
              type="button"
              aria-pressed={showAllNames}
              onClick={() => setShowAllNames((shown) => !shown)}
              className={`${TOGGLE_CLASS} ${
                showAllNames
                  ? "bg-primary-500/20 text-primary-600 ring-1 ring-primary-500/50 dark:text-primary-400"
                  : "bg-gray-100 text-gray-600 hover:text-gray-900 dark:bg-navy-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              <Tags className="h-3 w-3" aria-hidden="true" />
              {t("match.radar.allNames")}
            </button>
          )}
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((open) => !open)}
            className={`${TOGGLE_CLASS} bg-gray-100 text-gray-600 hover:text-gray-900 dark:bg-navy-700 dark:text-gray-400 dark:hover:text-gray-200`}
          >
            {isOpen ? (
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            )}
            {isOpen ? t("match.radar.hide") : t("match.radar.show")}
          </button>
        </div>
      </div>
      {isOpen && (
        <RadarField
          snapshot={snapshot}
          speed={speed}
          kits={kits}
          showAllNames={showAllNames}
          reducedMotion={reducedMotion}
        />
      )}
    </section>
  );
}
