import type { ManagerData, ReputationChange } from "../store/types";

/**
 * The user's season-by-season reputation reviews, oldest first, as the backend
 * logged them. Empty before the first review and for payloads without progression.
 */
export function getReputationLog(manager: ManagerData): ReputationChange[] {
  return manager.progression?.reputation_log ?? [];
}

/** The latest review's season and how far it moved the reputation; null before any review. */
export function getLastReputationChange(
  manager: ManagerData,
): { season: number; delta: number } | null {
  const log = getReputationLog(manager);
  const last = log[log.length - 1];
  if (!last) return null;
  return { season: last.season, delta: last.after - last.before };
}
