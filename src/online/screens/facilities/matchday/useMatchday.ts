import { useCallback, useEffect, useState } from "react";
import type { MatchdayView } from "../../../api";
import { online } from "../../../client";
import { OnlineApiError } from "../../../errors";
import { useOnlineStore } from "../../../store/onlineStore";

/** The season draws no crowd: the stadium shows its stands only, and nothing is wrong. */
const NO_MATCHDAY = "be.error.matchday.disabled";

/**
 * The club's matchday (c-27 §7.1, C-27d): its ticket price, what the next home league match would
 * draw at each price, this season's home matches. Read when the screen opens and again when the
 * stands change size. `view` is `null` when the season draws no crowd, so the stadium section
 * shows only its stands; any other failure is `failed`, said with a retry (`reload`), so the cards
 * never go without a word. A price chosen answers the view, which `setView` keeps.
 */
export function useMatchday() {
  const [view, setView] = useState<MatchdayView | null | undefined>(undefined);
  const [failed, setFailed] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const capacity = useOnlineStore((state) => state.facilities?.capacity);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  // A new capacity (stands built) or a retry is a reason to read the view again.
  useEffect(() => {
    let live = true;
    setFailed(null);
    online.finance
      .matchday()
      .then((answer) => {
        if (live) setView(answer);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setView(null);
        if (!(error instanceof OnlineApiError && error.code === NO_MATCHDAY)) setFailed(error);
      });
    return () => {
      live = false;
    };
  }, [capacity, attempt]);

  return { view, setView, failed, reload };
}
