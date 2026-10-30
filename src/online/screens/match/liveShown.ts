import { useCallback, useEffect, useRef, useState } from "react";
import type { OnlineMatchState } from "../../convert/matchState";

/**
 * A live online match keeps the server's clock: a minute every `stepMillis`, without waiting for
 * the radar, which may fall a few minutes behind. The screen around the radar — the score, the
 * minute, the events, the stats, the half-time and full-time screens — shows the match only as
 * far as the radar has played it, so a goal is never read off the scoreboard before it is seen.
 * The touchline still acts on the server's own match.
 */

/**
 * The server's states the screen may still have to show, oldest first, with `state` added. A
 * state with fewer events than the last is a match read again from the start: only it is kept.
 */
export function remember(
  history: readonly OnlineMatchState[],
  state: OnlineMatchState,
): OnlineMatchState[] {
  const last = history[history.length - 1];
  if (last === state) return [...history];
  if (last !== undefined && state.events.length < last.events.length) return [state];
  return [...history, state];
}

/**
 * The newest state whose events the radar has all played out (`played`), or the oldest kept
 * when it has not played out even that one.
 */
export function shownAt(history: readonly OnlineMatchState[], played: number): OnlineMatchState {
  for (let index = history.length - 1; index > 0; index--) {
    if (history[index].events.length <= played) return history[index];
  }
  return history[0];
}

/**
 * The match as the screen shows it: `state` (the server's) while nothing plays it out — the
 * radar closed, the half-time or full-time screen up — else as far as the radar has played it.
 * `onPlayed` is the radar's report of how many events it has played out.
 */
export function useShownState(state: OnlineMatchState, following: boolean) {
  const [played, setPlayed] = useState<number | null>(null);
  const history = useRef<OnlineMatchState[]>([]);
  history.current = remember(history.current, state);
  const shown = following && played !== null ? shownAt(history.current, played) : state;
  // Nothing older than what is shown is ever shown again.
  history.current = history.current.slice(Math.max(0, history.current.indexOf(shown)));

  // Not followed — the radar closed, or the break or the end reached, where the half-time or
  // full-time screen takes its place — the next radar starts afresh where the match then is:
  // forget the old count.
  const isAway = !following || shown.isFinished || shown.phase === "HalfTime";
  useEffect(() => {
    if (isAway) setPlayed(null);
  }, [isAway]);

  const onPlayed = useCallback((count: number) => setPlayed(count), []);
  return { shown, onPlayed };
}
