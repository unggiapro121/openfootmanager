/**
 * Player development speed, as a percentage of the realistic pace. Mirrors the
 * backend's `DevelopmentSpeed` scale (100 = ×1 … 500 = ×5, half steps), which
 * refuses anything else when a career is created.
 */
export const DEVELOPMENT_SPEED_PERCENTS = [100, 150, 200, 250, 300, 350, 400, 450, 500] as const;
export const REALISTIC_DEVELOPMENT_SPEED_PERCENT = 100;

type Translate = (key: string) => string;

/** "×1 (Realistic)", "×1,5", "×2" — the multiplier in the reader's number format. */
export function formatDevelopmentSpeed(percent: number, t: Translate, language: string): string {
  const multiplier = `×${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(percent / 100)}`;
  return percent === REALISTIC_DEVELOPMENT_SPEED_PERCENT
    ? `${multiplier} (${t("settings.developmentSpeedRealistic")})`
    : multiplier;
}
