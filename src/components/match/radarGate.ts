import type { MatchSnapshot, MinuteResult } from "./types";

/**
 * The 2D mode's gate between the engine and the screen: a step of the match is
 * fetched, played by the radar, and only then shown.
 */

/** A step of the match fetched from the engine and not yet shown. */
export interface FetchedMinutes {
  results: MinuteResult[];
  snapshot: MatchSnapshot;
}

/**
 * Whether the radar has played `fetched` out, given it has taken in `staged`
 * of the match's events and has nothing left to play: then it can be shown.
 */
export function isPlayedOut(fetched: FetchedMinutes, staged: number): boolean {
  return staged >= fetched.snapshot.events.length;
}
