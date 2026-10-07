/** The auto-save intervals offered in Settings, in real-time minutes. */
export const AUTO_SAVE_INTERVAL_OPTIONS = [5, 30, 60, 720, 1440] as const;

const MS_PER_MINUTE = 60_000;

/**
 * Milliseconds until the next auto-save is due; zero or less means now.
 *
 * Counted from when the game first changed after its last save, so the setting
 * reads as "never lose more than this much play". A failed attempt waits a full
 * interval before the next, rather than retrying in a tight loop against a save
 * that keeps refusing.
 */
export function autoSaveDelayMs({
  now,
  dirtySince,
  lastAttemptAt,
  intervalMinutes,
}: {
  now: number;
  dirtySince: number;
  lastAttemptAt: number | null;
  intervalMinutes: number;
}): number {
  const intervalMs = Math.max(1, intervalMinutes) * MS_PER_MINUTE;
  const dueAt = Math.max(dirtySince, lastAttemptAt ?? dirtySince) + intervalMs;
  return dueAt - now;
}
