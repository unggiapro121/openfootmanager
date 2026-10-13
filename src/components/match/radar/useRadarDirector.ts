import { type RefObject, useEffect, useRef } from "react";

import type { MatchEvent, MatchSnapshot } from "../types";
import { choreographHighlights } from "./radarChoreography";
import type { RadarSettle } from "./radarSettle";
import { type Playback, enqueueBeats, jumpTo, restingPlayback } from "./radarPlayback";
import { type RadarScene, initialRadarScene } from "./radarScene";
import { type RadarStage, buildRadarStage, lineupsKey } from "./radarStage";
import { queueBeat } from "./radarTiming";

/** How the radar keeps time with play. */
export interface RadarPacing {
  /** Radar time per second of real pace: below 1 plays a little quicker than life. */
  timeScale: number;
  /** The furthest the radar may fall behind the match before it skips ahead. */
  maxLagMs: number;
  /**
   * How long a pass that ends a minute waits for the next minute to name its
   * receiver, before it plays on its own (the match paused).
   */
  holdMs: number;
}

/**
 * The 2D radar's pacing. The match waits for the radar — the next minute is
 * asked for only once the radar has played the last — so nothing ever piles up
 * to be skipped, and there is one pace: a little quicker than life, never so
 * quick that a run with the ball turns into a slide. Wanting it faster is what
 * the text mode and its speeds are for.
 */
export const RADAR_PACING: RadarPacing = {
  timeScale: 0.7,
  maxLagMs: Number.POSITIVE_INFINITY,
  holdMs: 1400,
};

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
 * Acts out the live match on the radar. Each new snapshot's dangerous play is
 * staged (`choreographHighlights`) and queued in the playback behind whatever
 * is still playing. Without animation, the playback jumps straight to the end
 * of the minute. Events from before the radar opened are not replayed.
 * `staged` counts the snapshot's events taken in so far: the radar has played a
 * minute out once they are all taken in and the playback is empty.
 *
 * The playback lives in a ref and the frame loop plays it: nothing here makes
 * React render as play moves on.
 */
export function useRadarDirector(
  snapshot: MatchSnapshot,
  pacing: RadarPacing | null,
  reducedMotion: boolean,
): { stage: RadarStage; playback: RefObject<Playback>; staged: RefObject<number> } {
  const stage = useStage(snapshot);
  const playback = useRef<Playback>(restingPlayback(initialRadarScene(snapshot)));
  const seenRef = useRef(snapshot.events.length);
  /** Where everything queued ends, so the next batch is staged from there. */
  const endRef = useRef<RadarScene>(playback.current.scene);

  /**
   * A completed pass that ended the last minute. The engine names its receiver
   * only by who acts next, so it waits for the next minute to arrive — or, if
   * none comes (the match paused), plays on its own after a short wait.
   */
  const heldPassRef = useRef<MatchEvent | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const settle: RadarSettle = {
      ballZone: snapshot.ball_zone,
      possession: snapshot.possession,
    };
    const isAnimated = pacing !== null && !reducedMotion;

    const stageAndQueue = (events: MatchEvent[], settleTo: RadarSettle | undefined) => {
      const { beats, end } = choreographHighlights(events, stage, endRef.current, settleTo);
      endRef.current = end;
      if (!isAnimated) {
        // No animation: rest at once where everything queued and new ends.
        playback.current = jumpTo(end);
        return;
      }
      if (beats.length === 0) return;
      playback.current = enqueueBeats(
        playback.current,
        beats.map((beat) => queueBeat(beat, pacing.timeScale)),
        pacing.maxLagMs,
      );
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
    // Nothing has happened: nothing to show.
    if (batch.length === 0) return;

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
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    },
    [],
  );

  return { stage, playback, staged: seenRef };
}
