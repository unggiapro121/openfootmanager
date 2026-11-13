import { useEffect, useState } from "react";
import type { MatchdayView } from "../../../api";
import { online } from "../../../client";
import { useOnlineStore } from "../../../store/onlineStore";

/**
 * The club's matchday (c-27 §7.1, C-27d): its ticket price, what the next home league match would
 * draw at each price, this season's home matches. Read when the screen opens and again when the
 * stands change size; `null` when the season draws no crowd or the read failed, so the stadium
 * section shows only its stands. A price chosen answers the view, which `setView` keeps.
 */
export function useMatchday() {
  const [view, setView] = useState<MatchdayView | null | undefined>(undefined);
  const capacity = useOnlineStore((state) => state.facilities?.capacity);

  // A new capacity (stands built) is a reason to read the view again.
  useEffect(() => {
    let live = true;
    online.finance
      .matchday()
      .then((answer) => {
        if (live) setView(answer);
      })
      .catch(() => {
        // No crowd this season (`be.error.matchday.disabled`) or no answer: the section goes on
        // without the ticket card, as a season without matchday has it.
        if (live) setView(null);
      });
    return () => {
      live = false;
    };
  }, [capacity]);

  return { view, setView };
}
