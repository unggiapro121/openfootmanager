import { useEffect, useRef, useState } from "react";

import { type MatchEvent, type MatchSnapshot, SPEED_MS, type SimSpeed } from "../types";
import { type RadarSettle, choreographBatch } from "./radarChoreography";
import { type RadarScene, applyStep, initialRadarScene } from "./radarScene";
import { type RadarStage, buildRadarStage, lineupsKey } from "./radarStage";
import { type QueuedBeat, queueBeat, queuedRuns, trimBacklog } from "./radarTiming";

/** How the radar keeps time with the match at one simulation speed. */
export interface RadarPacing {
  /** Radar time per second of real pace: below 1 plays a little quicker than life. */
  timeScale: number;
  /** The furthest the radar may fall behind the match before it skips ahead. */
  maxLagMs: number;
  /**
   * How long a pass that ends a minute waits for the next minute to name its
   * receiver: one tick, and a margin for the round trip and render.
   */
  holdMs: number;
}

/**
 * Radar time per second of real pace. An engine minute holds a few seconds of
 * real play but a tick lasts only 0.2–2 s, so the radar plays a little quicker
 * than life — never so quick that a run with the ball turns into a slide.
 */
const TIME_SCALE: Record<"slow" | "normal" | "fast", number> = {
  slow: 0.8,
  normal: 0.65,
  fast: 0.55,
};

const MAX_LAG_MS: Record<"slow" | "normal" | "fast", number> = {
  slow: 3200,
  normal: 2000,
  fast: 1500,
};

/** What a tick costs on top of its interval: the round trip to the engine and the render. */
const TICK_MARGIN_MS = 600;

/**
 * The radar's pacing at a simulation speed. Movements keep a real pace at every
 * speed; a faster match means more of the routine play is skipped to keep up,
 * not that the players move faster. The skip-ahead speed covers ten minutes a
 * tick and is not animated at all (null); a single step while paused plays at
 * the normal pace, and no next minute follows it on its own.
 */
export function radarPacing(speed: SimSpeed): RadarPacing | null {
  if (speed === "instant") return null;
  const pace = speed === "paused" ? "normal" : speed;
  return {
    timeScale: TIME_SCALE[pace],
    maxLagMs: MAX_LAG_MS[pace],
    holdMs: SPEED_MS[speed] + TICK_MARGIN_MS,
  };
}

/**
 * The stage for the current line-ups. Every tick brings a fresh snapshot, so
 * the stage is rebuilt only when the line-ups really change, keeping its
 * shape cache warm between ticks.
 */
function useStage(snapshot: MatchSnapshot): RadarStage {
  const key = lineupsKey(snapshot);
  const cached = useRef<{ key: string; stage: RadarStage } | null>(null);
  if (cached.current?.key !== key) {
    cached.current = { key, stage: buildRadarStage(snapshot) };
  }
  return cached.current.stage;
}

/**
 * Acts out the live match on the radar. Each new snapshot's new events are
 * staged and queued behind whatever is still playing, and every beat plays at
 * its real pace from start to finish. When the queue would leave the radar too
 * far behind the match, the oldest routine beats are skipped. Events from
 * before the radar opened are not replayed.
 */
export function useRadarDirector(
  snapshot: MatchSnapshot,
  pacing: RadarPacing | null,
  reducedMotion: boolean,
): { scene: RadarScene; stage: RadarStage } {
  const stage = useStage(snapshot);
  const [scene, setScene] = useState(() => initialRadarScene(snapshot));
  const seenRef = useRef(snapshot.events.length);
  /** What is on screen, step by step. */
  const shownRef = useRef<RadarScene>(scene);
  /** Where everything queued ends, so the next batch is staged from there. */
  const endRef = useRef<RadarScene>(scene);
  const queueRef = useRef<QueuedBeat[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlayingRef = useRef(false);

  /**
   * A completed pass that ended the last minute. The engine names its receiver
   * only by who acts next, so it waits for the next minute to arrive — or, if
   * none comes (the match paused), plays on its own after a short wait.
   */
  const heldPassRef = useRef<MatchEvent | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = (next: RadarScene) => {
      shownRef.current = next;
      setScene(next);
    };

    const playNext = () => {
      const entry = queueRef.current.shift();
      if (!entry) {
        isPlayingRef.current = false;
        return;
      }
      isPlayingRef.current = true;
      const playStep = (index: number) => {
        if (index >= entry.beat.steps.length) {
          playNext();
          return;
        }
        const ms = entry.stepMs[index];
        show(applyStep(shownRef.current, entry.beat.steps[index], ms, queuedRuns(entry, index)));
        timerRef.current = setTimeout(() => playStep(index + 1), ms);
      };
      playStep(0);
    };

    const settle: RadarSettle = {
      ballZone: snapshot.ball_zone,
      possession: snapshot.possession,
    };
    const isAnimated = pacing !== null && !reducedMotion;

    const stageAndQueue = (events: MatchEvent[], settleTo: RadarSettle | undefined) => {
      const { beats, end } = choreographBatch(events, stage, endRef.current, settleTo);
      endRef.current = end;
      if (!isAnimated) {
        // No animation: show where everything queued and new ends, at once.
        if (timerRef.current) clearTimeout(timerRef.current);
        isPlayingRef.current = false;
        queueRef.current = [];
        show(end);
        return;
      }
      if (beats.length === 0) return;
      queueRef.current = trimBacklog(
        [...queueRef.current, ...beats.map((beat) => queueBeat(beat, pacing.timeScale))],
        pacing.maxLagMs,
      );
      if (!isPlayingRef.current) playNext();
    };

    const events = snapshot.events;
    // A shorter list is a different match: start counting again.
    if (events.length < seenRef.current) seenRef.current = 0;
    const fresh = events.slice(seenRef.current);
    seenRef.current = events.length;

    const held = heldPassRef.current;
    if (held && fresh.length === 0 && isAnimated) return;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    heldPassRef.current = null;
    const batch = held ? [held, ...fresh] : fresh;

    const last = batch[batch.length - 1];
    if (isAnimated && last?.event_type === "PassCompleted") {
      heldPassRef.current = last;
      stageAndQueue(batch.slice(0, -1), undefined);
      holdTimerRef.current = setTimeout(() => {
        heldPassRef.current = null;
        stageAndQueue([last], settle);
      }, pacing.holdMs);
      return;
    }
    stageAndQueue(batch, settle);
  }, [snapshot.events, snapshot.ball_zone, snapshot.possession, stage, pacing, reducedMotion]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    },
    [],
  );

  return { scene, stage };
}
