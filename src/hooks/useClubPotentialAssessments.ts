import { useEffect, useMemo, useState } from "react";

import { getClubPotentialAssessments } from "../services/scoutingService";
import type { Assessor, ClubAssessments, PlayerAssessment } from "../store/types";

export interface ClubPotentialAssessmentsState {
  /** Who judges the club's players; null when nobody can. */
  assessor: Assessor | null;
  byPlayer: ReadonlyMap<string, PlayerAssessment>;
  /** Whether the backend has answered, so "no assessor" is not shown while waiting. */
  loaded: boolean;
}

/**
 * The club's read of every own player's ceiling, asked again whenever
 * `refreshKey` changes (the date, or who judges the club's players).
 */
export function useClubPotentialAssessments(refreshKey: string): ClubPotentialAssessmentsState {
  const [assessments, setAssessments] = useState<ClubAssessments | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let current = true;
    getClubPotentialAssessments()
      .then((next) => {
        if (current) setAssessments(next);
      })
      .catch(() => {
        // No game or no club: the screens simply show no reads.
        if (current) setAssessments(null);
      })
      .finally(() => {
        if (current) setLoaded(true);
      });
    return () => {
      current = false;
    };
  }, [refreshKey]);

  const byPlayer = useMemo(
    () => new Map((assessments?.players ?? []).map((read) => [read.player_id, read])),
    [assessments],
  );

  return { assessor: assessments?.assessor ?? null, byPlayer, loaded };
}
