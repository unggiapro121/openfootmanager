import type { TFunction } from "i18next";

/**
 * A human coach's name as other coaches read it. The server sends it empty for a coach who
 * deleted his account, or is waiting to be deleted (M3a K1): he reads as having left the game.
 */
export function shownCoachName(t: TFunction, name: string): string {
  return name === "" ? t("online.coachLeft") : name;
}
