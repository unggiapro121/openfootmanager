/**
 * A player's traits as the club shows them. The backend never sends the true
 * Wonderkid trait — it would give the ceiling away — so the badge is added
 * back only where the club's own read of him says he is one.
 */
export function withScoutedWonderkid(traits: string[], wonderkid: boolean | undefined): string[] {
  if (!wonderkid || traits.includes("Wonderkid")) {
    return traits;
  }
  return [...traits, "Wonderkid"];
}

/**
 * When the club's reads of its players should be asked for again: a new day,
 * or a change in who could make them (a scout or assistant hired or let go).
 */
export function assessmentRefreshKey(
  currentDate: string,
  staff: ReadonlyArray<{ id: string; team_id: string | null }>,
  teamId: string | null | undefined,
): string {
  const assessors = staff
    .filter((member) => member.team_id === teamId)
    .map((member) => member.id)
    .sort()
    .join(",");
  return `${currentDate}|${assessors}`;
}
