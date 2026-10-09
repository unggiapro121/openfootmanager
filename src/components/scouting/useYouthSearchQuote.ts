import { useEffect, useState } from "react";

import { quoteYouthSearch, type YouthSearchQuote } from "../../services/scoutingService";

/**
 * What the youth search on the form would cost and take, re-asked whenever the
 * scout, region or objective changes or the game moves on (`refreshKey`), so a
 * resting scout's days count down. Null until known, or when it cannot be.
 */
export function useYouthSearchQuote(
  scoutId: string,
  region: string,
  objective: string,
  refreshKey: string,
): YouthSearchQuote | null {
  const [quote, setQuote] = useState<YouthSearchQuote | null>(null);

  useEffect(() => {
    if (!scoutId) {
      setQuote(null);
      return;
    }
    let current = true;
    quoteYouthSearch(scoutId, region, objective)
      .then((next) => {
        if (current) setQuote(next);
      })
      .catch(() => {
        // The form still works without a quote; the backend refuses the search
        // itself if the scout is resting or the club cannot pay.
        if (current) setQuote(null);
      });
    return () => {
      current = false;
    };
  }, [scoutId, region, objective, refreshKey]);

  return quote;
}
