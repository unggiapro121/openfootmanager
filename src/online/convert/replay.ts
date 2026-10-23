import type { MatchFrame, MatchView } from "../api";
import { applyFrame, initialMatchState, type OnlineMatchState, withSides } from "./matchState";

/**
 * A finished match as a replay reads it (C-2 §3.7, C2-14): the match as it kicked off, every
 * frame it published, and the sides after each step whose gap changed them in sight. The engine
 * decides where players stand after a change, so those sides are the server's (`atSeq`), never
 * worked out here.
 */
export interface ReplaySource {
  start: MatchView;
  frames: MatchFrame[];
  sidesAt: ReadonlyMap<number, MatchView>;
}

/** The steps whose gap changed a side in sight: the views a replay reads besides the start. */
export function sidesChangedAt(frames: MatchFrame[]): number[] {
  return frames
    .filter((frame) => frame.gapInputs.some((input) => input.kind === "command"))
    .map((frame) => frame.seq);
}

/** Whether the frames hold every step the match played: older ones may have been let go. */
export function isWhole(frames: MatchFrame[], lastSeq: number): boolean {
  return frames.length === lastSeq && frames.every((frame, index) => frame.seq === index + 1);
}

/** The match as it kicked off. */
export function replayStart(source: ReplaySource): OnlineMatchState {
  return initialMatchState(source.start);
}

/** The match one step on from `state`; null once the last step is shown. */
export function replayNext(source: ReplaySource, state: OnlineMatchState): OnlineMatchState | null {
  const frame = source.frames[state.lastSeq];
  if (!frame) return null;
  const result = applyFrame(state, frame);
  if (result.kind !== "applied") return null;
  const sides = result.sidesChanged ? source.sidesAt.get(frame.seq) : undefined;
  return sides ? withSides(result.state, sides) : result.state;
}

/** The match after step `seq`, played from kick-off. */
export function replayAt(source: ReplaySource, seq: number): OnlineMatchState {
  let state = replayStart(source);
  while (state.lastSeq < seq) {
    const next = replayNext(source, state);
    if (!next) break;
    state = next;
  }
  return state;
}

/** The first step that reaches `minute`, or the last step. */
export function stepOfMinute(frames: MatchFrame[], minute: number): number {
  const reached = frames.find((frame) => frame.result.minute >= minute);
  return reached?.seq ?? frames[frames.length - 1]?.seq ?? 0;
}
