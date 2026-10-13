import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Radar, Tags } from "lucide-react";

import { usePrefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";
import { useGameStore } from "../../../store/gameStore";
import type { MatchSnapshot, SimSpeed } from "../types";
import { type DrawnPlayer, RADAR_VIEW, type RadarPicture, drawRadar } from "./radarDraw";
import type { RadarKits, Side } from "./radarGeometry";
import { FONT_CLASSES, PALETTE_CLASSES, readPalette } from "./radarPalette";
import { advancePlayback } from "./radarPlayback";
import type { RadarScene } from "./radarScene";
import { type RadarSim, restingSim, stepSim } from "./radarSim";
import type { RadarStage } from "./radarStage";
import { radarPacing, useRadarDirector } from "./useRadarDirector";

interface MatchRadar2DProps {
  snapshot: MatchSnapshot;
  speed: SimSpeed;
  kits: RadarKits;
}

const CELEBRATION_MS = 1800;
const SHAKE: Keyframe[] = [
  { transform: "translate(0, 0)" },
  { transform: "translate(-4px, 2px)" },
  { transform: "translate(4px, -2px)" },
  { transform: "translate(-3px, 1px)" },
  { transform: "translate(0, 0)" },
];
/** A frame later than this after the last (a hidden tab, a stall) is treated as this long. */
const MAX_FRAME_GAP_MS = 250;
/** How often the loop re-reads the theme's colours, so a theme switch shows within a moment. */
const PALETTE_REFRESH_FRAMES = 30;
/** The canvas's drawing size before it has been laid out, in pixels per metre. */
const INITIAL_PIXELS_PER_METRE = 6;

const TOGGLE_CLASS =
  "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-heading uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800";

/** Everything the frame loop draws from, kept current on every render without restarting it. */
interface RadarCast {
  snapshot: MatchSnapshot;
  kits: RadarKits;
  squadById: Map<string, { jersey_number?: number | null; match_name?: string | null }>;
  showAllNames: boolean;
  stage: RadarStage;
  goalLabel: string;
}

/** The goal being celebrated: its serial, and when its celebration started (ms, the frame clock). */
interface Celebration {
  serial: number;
  side: Side | null;
  startedAt: number;
}

/** Sizes the canvas to its laid-out box and the screen's pixel density; returns pixels per metre. */
function fitCanvas(canvas: HTMLCanvasElement): number {
  const box = canvas.getBoundingClientRect();
  const cssPerMetre =
    box.width > 0 && box.height > 0
      ? Math.min(box.width / RADAR_VIEW.width, box.height / RADAR_VIEW.height)
      : INITIAL_PIXELS_PER_METRE;
  const perMetre = cssPerMetre * (window.devicePixelRatio || 1);
  const width = Math.round(RADAR_VIEW.width * perMetre);
  const height = Math.round(RADAR_VIEW.height * perMetre);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return perMetre;
}

/**
 * Notes a new goal in `scene` as the start of its celebration at `now`, and
 * returns how far through the celebration is (0…1), or null when none is on.
 */
function noteGoal(
  celebration: Celebration,
  scene: RadarScene,
  now: number,
  onStart: () => void,
): number | null {
  const goal = scene.goal;
  if (goal && goal.serial !== celebration.serial) {
    celebration.serial = goal.serial;
    celebration.side = goal.side;
    celebration.startedAt = now;
    onStart();
  }
  const progress = (now - celebration.startedAt) / CELEBRATION_MS;
  return celebration.side && progress >= 0 && progress < 1 ? progress : null;
}

function pictureOf(
  sim: RadarSim,
  scene: RadarScene,
  cast: RadarCast,
  celebration: Celebration,
  progress: number | null,
  pulse: number | null,
): RadarPicture {
  const { snapshot, kits, squadById, showAllNames } = cast;
  const players: DrawnPlayer[] = [];
  const sides = [
    { side: "Home" as const, team: snapshot.home_team, kit: kits.home },
    { side: "Away" as const, team: snapshot.away_team, kit: kits.away },
  ];
  for (const { side, team, kit } of sides) {
    for (const player of team.players) {
      const at = sim.players[player.id]?.at;
      if (!at) continue;
      // Match names and shirt numbers live on the full player, not the match snapshot.
      const full = squadById.get(player.id);
      const isHighlighted = scene.highlight.includes(player.id);
      players.push({
        id: player.id,
        side,
        at,
        kit,
        number: full?.jersey_number ?? null,
        name: full?.match_name || player.name,
        showName: showAllNames || isHighlighted,
        isHighlighted,
        isKeeper: player.position === "Goalkeeper",
      });
    }
  }
  return {
    ball: sim.ball,
    lift: sim.lift,
    trail: scene.trail,
    overlay: scene.overlay,
    players,
    celebration:
      celebration.side && progress !== null ? { side: celebration.side, progress } : null,
    pulse,
    goalLabel: cast.goalLabel,
  };
}

function shake(element: HTMLElement | null): void {
  if (typeof element?.animate === "function") {
    element.animate(SHAKE, { duration: 480, easing: "ease-in-out" });
  }
}

interface RadarFieldProps extends MatchRadar2DProps {
  showAllNames: boolean;
  reducedMotion: boolean;
}

function RadarField({ snapshot, speed, kits, showAllNames, reducedMotion }: RadarFieldProps) {
  const { t } = useTranslation();
  const pacing = useMemo(() => radarPacing(speed), [speed]);
  const isAnimated = pacing !== null && !reducedMotion;
  const { stage, playback } = useRadarDirector(snapshot, pacing, reducedMotion);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const swatchesRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const squad = useGameStore((state) => state.gameState?.players);
  const squadById = useMemo(() => new Map((squad ?? []).map((p) => [p.id, p])), [squad]);
  const castRef = useRef<RadarCast | null>(null);
  castRef.current = {
    snapshot,
    kits,
    squadById,
    showAllNames,
    stage,
    goalLabel: t("match.eventTypes.Goal"),
  };
  const simRef = useRef<RadarSim | null>(null);
  const celebrationRef = useRef<Celebration>({
    serial: playback.current.scene.goal?.serial ?? 0,
    side: null,
    startedAt: Number.NEGATIVE_INFINITY,
  });

  // Moving: a frame loop advances the script, simulates the pitch and draws it.
  // Nothing in it sets React state, so play moving on never re-renders.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!isAnimated || !canvas || !context) return;
    let palette = readPalette(swatchesRef.current);
    let frames = 0;
    let last: number | null = null;
    let handle = 0;
    const tick = (now: number) => {
      const cast = castRef.current;
      if (!cast) return;
      const dt = last === null ? 0 : Math.min(now - last, MAX_FRAME_GAP_MS);
      last = now;
      playback.current = advancePlayback(playback.current, dt);
      const scene = playback.current.scene;
      const sim = stepSim(
        simRef.current ?? restingSim(cast.stage, scene),
        cast.stage,
        playback.current,
        dt,
      );
      simRef.current = sim;
      const progress = noteGoal(celebrationRef.current, scene, now, () => shake(shakeRef.current));
      frames += 1;
      if (frames % PALETTE_REFRESH_FRAMES === 0) palette = readPalette(swatchesRef.current);
      const pulse = (now / 1000) % 1;
      const picture = pictureOf(sim, scene, cast, celebrationRef.current, progress, pulse);
      drawRadar(context, picture, palette, fitCanvas(canvas));
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [isAnimated, playback]);

  // Still (reduced motion, the skip-ahead speed): draw where play rests, after
  // every render. A goal's banner shows without moving, then a redraw clears it.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const cast = castRef.current;
    if (isAnimated || !canvas || !context || !cast) return;
    const scene = playback.current.scene;
    const sim = restingSim(cast.stage, scene);
    simRef.current = sim;
    const draw = () => {
      const progress = noteGoal(celebrationRef.current, scene, performance.now(), () => {});
      const still = progress === null ? null : 0.5;
      const picture = pictureOf(sim, scene, cast, celebrationRef.current, still, null);
      drawRadar(context, picture, readPalette(swatchesRef.current), fitCanvas(canvas));
      return progress;
    };
    const progress = draw();
    if (progress === null) return;
    const timer = setTimeout(draw, (1 - progress) * CELEBRATION_MS);
    return () => clearTimeout(timer);
  });

  return (
    <div ref={shakeRef} className="px-3 pb-3">
      <canvas
        ref={canvasRef}
        width={RADAR_VIEW.width * INITIAL_PIXELS_PER_METRE}
        height={RADAR_VIEW.height * INITIAL_PIXELS_PER_METRE}
        role="img"
        aria-label={t("match.radar.pitchLabel", {
          home: snapshot.home_team.name,
          away: snapshot.away_team.name,
        })}
        className="mx-auto block h-auto max-h-80 w-full object-contain"
      />
      {/* The radar's colours and fonts as theme tokens, read by the canvas (see radarPalette). */}
      <div ref={swatchesRef} aria-hidden="true" className="hidden">
        {Object.entries(PALETTE_CLASSES).map(([key, classes]) => (
          <span key={key} data-radar-colour={key} className={classes} />
        ))}
        {Object.entries(FONT_CLASSES).map(([key, classes]) => (
          <span key={key} data-radar-font={key} className={classes} />
        ))}
      </div>
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
