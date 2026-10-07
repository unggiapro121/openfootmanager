/**
 * Shared tailwind color classes for a `player.condition` value.
 *
 * Kept in one place so the same condition value looks the same everywhere
 * it appears (pre-match XI / substitutes, opponent scouting, sub panel,
 * training-groups roster). `condColor` is the text class; `condBgColor`
 * the bar/fill class. Both use identical thresholds and color families.
 */
export function condColor(condition: number): string {
  // The -400 shades are the dark-theme ones; light surfaces (squad roster,
  // training groups) need the deeper -600 to stay readable on white.
  if (condition >= 75) return "text-primary-600 dark:text-primary-400";
  if (condition >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function condBgColor(condition: number): string {
  if (condition >= 75) return "bg-primary-500";
  if (condition >= 50) return "bg-amber-500";
  return "bg-red-500";
}
