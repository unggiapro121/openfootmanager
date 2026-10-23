import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RADAR_PACING, type RadarPacing } from "../../../components/match/radar/useRadarDirector";
import type { MatchView, MineView } from "../../api";
import { online } from "../../client";
import type { OnlineMatchState } from "../../convert/matchState";
import {
  isWhole,
  type ReplaySource,
  replayAt,
  replayNext,
  replayStart,
  sidesChangedAt,
  stepOfMinute,
} from "../../convert/replay";
import { useOnlineResource } from "../../useOnlineResource";
import { readFrames, readMine } from "./matchReads";

export interface ReplayData {
  source: ReplaySource;
  /** The viewer's own side, for its dials and kit; null for a spectator. */
  mine: MineView | null;
}

/** A replay's data, or `gone` when the match's frames are no longer all kept (Qs8-10). */
export type ReplayLoad = { kind: "gone" } | { kind: "ready"; data: ReplayData };

/**
 * Read what a finished match's replay needs (C-2 §3.7): the match as it kicked off, all its
 * frames, the sides after each change made in sight, and the viewer's own side. No watch: the
 * match is over.
 */
export function useReplaySource(matchId: string, view: MatchView) {
  return useOnlineResource<ReplayLoad>(async () => {
    const [start, frames, mine] = await Promise.all([
      online.matches.byId(matchId, 0),
      readFrames(matchId, 0),
      readMine(matchId),
    ]);
    if (!isWhole(frames, view.lastSeq)) return { kind: "gone" };
    const sidesAt = new Map(
      await Promise.all(
        sidesChangedAt(frames).map(
          async (seq) => [seq, await online.matches.byId(matchId, seq)] as const,
        ),
      ),
    );
    return { kind: "ready", data: { source: { start, frames, sidesAt }, mine } };
  }, [matchId, view.lastSeq]);
}

export type ReplaySpeed = 1 | 2 | 4;
export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [1, 2, 4];

/** The least time a step stays on screen at 1×: a quiet minute still passes visibly. */
const MIN_STEP_MS = 600;
/** How long each step stays at 1× with the radar closed. */
const TEXT_STEP_MS = 1000;

/**
 * Playing a replay (C2-14): like the desktop match, the radar is handed the next step and the
 * screen shows it once the radar has played it out; the viewer pauses, changes speed, starts
 * again or jumps to a minute. With the radar closed, steps follow a timer.
 */
export function useReplayPlayback(source: ReplaySource) {
  const [shown, setShown] = useState<OnlineMatchState>(() => replayStart(source));
  const [ahead, setAhead] = useState<OnlineMatchState>(shown);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [radarOpen, setRadarOpen] = useState(true);
  const [radarKey, setRadarKey] = useState(0);
  const shownRef = useRef(shown);
  const aheadRef = useRef(ahead);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const steppedAt = useRef(0);
  playingRef.current = playing;
  speedRef.current = speed;

  const show = useCallback((state: OnlineMatchState) => {
    shownRef.current = state;
    setShown(state);
  }, []);
  const handOn = useCallback((state: OnlineMatchState) => {
    aheadRef.current = state;
    setAhead(state);
  }, []);

  /** The next step, or the end: then the replay stops where the match ended. */
  const stepOn = useCallback(
    (from: OnlineMatchState): OnlineMatchState | null => {
      const next = replayNext(source, from);
      if (!next) setPlaying(false);
      return next;
    },
    [source],
  );

  const onCaughtUp = useCallback(
    (staged: number) => {
      const pending = aheadRef.current;
      if (pending !== shownRef.current) {
        if (staged < pending.events.length) return;
        show(pending);
      }
      if (!playingRef.current) return;
      const now = Date.now();
      if (now - steppedAt.current < MIN_STEP_MS / speedRef.current) return;
      const next = stepOn(pending);
      if (!next) return;
      steppedAt.current = now;
      handOn(next);
    },
    [show, handOn, stepOn],
  );

  // With the radar closed nothing plays the steps out: a timer moves the replay on.
  useEffect(() => {
    if (radarOpen || !playing) return;
    const timer = setTimeout(() => {
      const next = stepOn(shownRef.current);
      if (!next) return;
      handOn(next);
      show(next);
    }, TEXT_STEP_MS / speed);
    return () => clearTimeout(timer);
  }, [radarOpen, playing, speed, shown, stepOn, handOn, show]);

  const jumpTo = useCallback(
    (state: OnlineMatchState) => {
      show(state);
      handOn(state);
      // A fresh radar rests where the match now is, instead of playing everything between.
      setRadarKey((key) => key + 1);
    },
    [show, handOn],
  );

  const jumpToMinute = useCallback(
    (minute: number) => jumpTo(replayAt(source, stepOfMinute(source.frames, minute))),
    [jumpTo, source],
  );

  const restart = useCallback(() => {
    jumpTo(replayStart(source));
    setPlaying(true);
  }, [jumpTo, source]);

  const togglePlaying = useCallback(() => {
    const atEnd = shownRef.current.lastSeq >= source.frames.length;
    if (!playingRef.current && atEnd) restart();
    else setPlaying((value) => !value);
  }, [restart, source.frames.length]);

  const toggleRadar = useCallback(() => {
    // Back to text: show at once what the radar was still playing.
    if (radarOpen) show(aheadRef.current);
    setRadarOpen((open) => !open);
  }, [radarOpen, show]);

  const pacing = useMemo<RadarPacing>(
    () => ({ timeScale: RADAR_PACING.timeScale / speed, maxLagMs: RADAR_PACING.maxLagMs }),
    [speed],
  );

  return {
    shown,
    ahead,
    playing,
    speed,
    setSpeed,
    radarOpen,
    radarKey,
    pacing,
    onCaughtUp,
    jumpToMinute,
    restart,
    togglePlaying,
    toggleRadar,
  };
}
