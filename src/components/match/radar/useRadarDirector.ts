import { type RefObject, useEffect, useRef } from "react";

import type { MatchEvent, MatchSnapshot } from "../types";
import { type RadarCaption, minuteCaptions } from "./radarCaptions";
import { choreographHighlights } from "./radarChoreography";
import { highlightsOf, openMove } from "./radarHighlights";
import type { RadarSettle } from "./radarSettle";
import { type Playback, enqueueBeats, jumpTo, restingPlayback } from "./radarPlayback";
import { type RadarBeat, type RadarScene, initialRadarScene } from "./radarScene";
import { type RadarStage, buildRadarStage, lineupsKey } from "./radarStage";
import { queueBeat } from "./radarTiming";

/** How the radar keeps time with play. */
export interface RadarPacing {
  /** Radar time per second of real pace: below 1 plays a little quicker than life. */
  timeScale: number;
  /** The furthest the radar may fall behind the match before it skips ahead. */
  maxLagMs: number;
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
 * `beats` with `captions` said after the last of them. A minute whose play is
 * told already needs no filler line.
 */
function withCaptions(beats: RadarBeat[], captions: RadarCaption[]): RadarBeat[] {
  const last = beats[beats.length - 1];
  if (!last || captions.length === 0) return beats;
  const isTold = beats.some((beat) => (beat.captions ?? []).length > 0);
  const said = isTold ? captions.filter((caption) => caption.priority !== "filler") : captions;
  const step = last.steps.length - 1;
  const tail = {
    ...last,
    captions: [...(last.captions ?? []), ...said.map((caption) => ({ step, caption }))],
  };
  return [...beats.slice(0, -1), tail];
}

/** Every caption of `beats`, in the order they are said. */
function captionsIn(beats: RadarBeat[]): RadarCaption[] {
  return beats.flatMap((beat) =>
    [...(beat.captions ?? [])].sort((a, b) => a.step - b.step).map((entry) => entry.caption),
  );
}

/**
 * Acts out the live match on the radar. Each new snapshot's dangerous play is
 * staged (`choreographHighlights`) and queued in the playback behind whatever
 * is still playing. A build-up the minute ends on (`openMove`) is held back
 * and staged with the next minute, so a move that spans two minutes plays in
 * one piece, from its start to its end, and names each pass's receiver by who
 * acts next. Without animation, the playback jumps straight to the end
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
  onCaption?: (caption: RadarCaption) => void,
): { stage: RadarStage; playback: RefObject<Playback>; staged: RefObject<number> } {
  const stage = useStage(snapshot);
  const playback = useRef<Playback>(restingPlayback(initialRadarScene(snapshot)));
  const seenRef = useRef(snapshot.events.length);
  /** Where everything queued ends, so the next batch is staged from there. */
  const endRef = useRef<RadarScene>(playback.current.scene);

  /** The build-up the last minute ended on, not staged yet: it opens this minute's play. */
  const openRef = useRef<MatchEvent[]>([]);
  /** What the commentary still has to say about the minute, said after the next beats staged. */
  const pendingCaptionsRef = useRef<RadarCaption[]>([]);
  const onCaptionRef = useRef(onCaption);
  onCaptionRef.current = onCaption;

  useEffect(() => {
    const settle: RadarSettle = {
      ballZone: snapshot.ball_zone,
      possession: snapshot.possession,
      ballLane: snapshot.ball_lane,
    };
    const isAnimated = pacing !== null && !reducedMotion;

    const stageAndQueue = (events: MatchEvent[], settleTo: RadarSettle | undefined) => {
      const staged = choreographHighlights(events, stage, endRef.current, settleTo);
      const beats = withCaptions(staged.beats, pendingCaptionsRef.current);
      if (beats.length > 0) pendingCaptionsRef.current = [];
      const { end } = staged;
      endRef.current = end;
      if (!isAnimated) {
        // No animation: rest at once where everything queued and new ends,
        // and say at once what the minute's play would have said.
        playback.current = jumpTo(end);
        for (const caption of captionsIn(beats)) onCaptionRef.current?.(caption);
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
    if (events.length < seenRef.current) {
      seenRef.current = 0;
      openRef.current = [];
    }
    const fresh = events.slice(seenRef.current);
    seenRef.current = events.length;
    // Nothing has happened: nothing to show.
    if (fresh.length === 0) return;

    const batch = [...openRef.current, ...fresh];
    const open = openMove(batch);
    openRef.current = open;
    const held = new Set(open);
    const toStage = batch.slice(0, batch.length - open.length);
    pendingCaptionsRef.current = [
      ...pendingCaptionsRef.current,
      ...minuteCaptions(
        fresh.filter((event) => !held.has(event)),
        new Set(highlightsOf(toStage)),
        {
          possession: snapshot.possession,
          ballZone: snapshot.ball_zone,
          minute: snapshot.current_minute,
          homeScore: snapshot.home_score,
          awayScore: snapshot.away_score,
        },
      ),
    ];

    stageAndQueue(toStage, settle);
  }, [
    snapshot.events,
    snapshot.ball_zone,
    snapshot.possession,
    snapshot.current_minute,
    snapshot.home_score,
    snapshot.away_score,
    stage,
    pacing,
    reducedMotion,
  ]);

  return { stage, playback, staged: seenRef };
}
