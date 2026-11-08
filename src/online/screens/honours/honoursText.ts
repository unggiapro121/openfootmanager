import type { TFunction } from "i18next";
import type { HonourCoach } from "../../api";

/** The awards a league's season gives a player (S-42 §3.4), as the server names them. */
export const AWARD_KINDS = [
  "topScorer",
  "topAssists",
  "goldenGlove",
  "playerOfSeason",
  "youngPlayer",
  "titleMedal",
] as const;

/** The awards whose value is a mean rating, not a count. */
const RATED = new Set<string>(["playerOfSeason", "youngPlayer"]);

/** The award's key in the locales: its own when known, `other` for one a newer server adds. */
export function awardKey(kind: string): string {
  return (AWARD_KINDS as readonly string[]).includes(kind) ? kind : "other";
}

export function awardName(t: TFunction, kind: string): string {
  return t(`online.honours.awards.${awardKey(kind)}`);
}

/**
 * What the award counted, in words: goals, assists, clean sheets, a mean rating to two places,
 * or for a champion's medal the matches played for the club. Nothing for an unknown award.
 */
export function awardValue(t: TFunction, kind: string, value: number, matches = 0): string {
  const key = awardKey(kind);
  if (key === "other") return "";
  if (key === "titleMedal") return t("online.honours.value.titleMedal", { matches });
  if (RATED.has(key)) return t(`online.honours.value.${key}`, { value: value.toFixed(2) });
  return t(`online.honours.value.${key}`, { value: Math.round(value) });
}

/** Who ran the club when it was won: the coach's name of the day (the reader's own marked), or the AI. */
export function coachName(t: TFunction, coach: HonourCoach | undefined): string {
  if (!coach) return t("online.honours.aiCoach");
  return coach.mine ? t("online.honours.youCoach", { name: coach.name }) : coach.name;
}
