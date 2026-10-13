import { type RadarScene, applyStep } from "./radarScene";
import { type QueuedBeat, queuedRuns, trimBacklog } from "./radarTiming";

/**
 * The radar's script played against the clock: which step of which beat is on
 * screen, and how far into it. Advanced by the animation loop frame by frame,
 * never by timers, so the radar keeps exactly the time it is given and React
 * never renders because play moved on.
 */

/** The step on screen: the scene it starts from, the scene it ends on, its length and how far in it is. */
export interface PlayingStep {
  from: RadarScene;
  to: RadarScene;
  ms: number;
  elapsed: number;
}

export interface Playback {
  queue: QueuedBeat[];
  /** The beat being played, and which of its steps is on screen. */
  beat: QueuedBeat | null;
  index: number;
  step: PlayingStep | null;
  /** Where play is headed: the end of the step on screen, or where it rests. */
  scene: RadarScene;
}

export function restingPlayback(scene: RadarScene): Playback {
  return { queue: [], beat: null, index: 0, step: null, scene };
}

/** Queues `beats` behind whatever is playing, dropping routine play to stay within `maxLagMs`. */
export function enqueueBeats(playback: Playback, beats: QueuedBeat[], maxLagMs: number): Playback {
  return { ...playback, queue: trimBacklog([...playback.queue, ...beats], maxLagMs) };
}

/** Drops everything queued and playing: play rests at once at `scene`. */
export function jumpTo(scene: RadarScene): Playback {
  return restingPlayback(scene);
}

function startStep(playback: Playback, beat: QueuedBeat, index: number): Playback {
  const ms = beat.stepMs[index];
  const to = applyStep(playback.scene, beat.beat.steps[index], queuedRuns(beat, index));
  return {
    ...playback,
    beat,
    index,
    step: { from: playback.scene, to, ms, elapsed: 0 },
    scene: to,
  };
}

/** The next step to put on screen: the rest of this beat, then the next queued one, else rest. */
function startNext(playback: Playback): Playback {
  const { beat, index } = playback;
  if (beat && index + 1 < beat.beat.steps.length) return startStep(playback, beat, index + 1);
  const [next, ...rest] = playback.queue;
  if (next) return startStep({ ...playback, queue: rest }, next, 0);
  return { ...playback, beat: null, index: 0, step: null };
}

/** A guard against a step of no length looping forever. */
const MAX_STEPS_PER_FRAME = 64;

/** Play `dtMs` further on. Time left over at the end of a step goes into the next. */
export function advancePlayback(playback: Playback, dtMs: number): Playback {
  let next = playback.step ? playback : startNext(playback);
  let remaining = dtMs;
  for (let guard = 0; next.step && guard < MAX_STEPS_PER_FRAME; guard++) {
    const elapsed = next.step.elapsed + remaining;
    if (elapsed < next.step.ms) return { ...next, step: { ...next.step, elapsed } };
    remaining = elapsed - next.step.ms;
    next = startNext(next);
  }
  return next;
}
