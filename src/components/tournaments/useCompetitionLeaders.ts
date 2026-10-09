import { useEffect, useState } from "react";

import {
  type CompetitionLeadersData,
  fetchCompetitionLeaders,
} from "../../services/competitionsService";

/**
 * The leaders of the competition on show. They are fetched again when another
 * competition is picked and when the day moves on, since a played round
 * changes them.
 */
export function useCompetitionLeaders(
  competitionId: string | null,
  currentDate: string | undefined,
): CompetitionLeadersData | null {
  const [leaders, setLeaders] = useState<CompetitionLeadersData | null>(null);

  useEffect(() => {
    if (!competitionId) {
      setLeaders(null);
      return;
    }
    let cancelled = false;
    fetchCompetitionLeaders(competitionId)
      .then((result) => {
        if (!cancelled) setLeaders(result);
      })
      .catch(() => {
        // Empty boards beat another competition's leaders left on screen.
        if (!cancelled) setLeaders(null);
      });
    return () => {
      cancelled = true;
    };
  }, [competitionId, currentDate]);

  return leaders;
}
