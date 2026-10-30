import type { TFunction } from "i18next";
import type { MyClubView, TrainingDayView } from "../../api";
import { formatKickoffClock } from "../../format";

/**
 * The codes a press can be refused with (S-21 §5.1, S-28 S28-3): the view's `refusal` and a 409.
 */
export const LINEUP_LOCKED = "be.error.club.lineupLocked";
const SESSION_CAP = "be.error.training.sessionCap";
export const DAY_PENDING = "be.error.training.dayPending";
const PLAIN_REFUSALS = new Set([
  "be.error.training.manualOff",
  "be.error.training.noDay",
  DAY_PENDING,
  "be.error.training.sessionToday",
  "be.error.training.sessionCapSeason",
  // Only a press answers it: every player chosen sits the session out (S-28 S28-3).
  "be.error.training.noFitPlayers",
]);

/**
 * A day of the season as the player reads it (C-8 C8-7). The server counts days from 0; the
 * player sees day 1 of 28, as the header does. Every day number the card shows passes through
 * here, and nowhere else adds one.
 */
export function displayDay(day: number): number {
  return day + 1;
}

/** Where a refusal's parameters come from: the club's view, or the 409's `details.params`. */
export interface RefusalParams {
  nextAllowedDay?: string | number;
  kickoffAt?: string | number;
}

/**
 * Why today's session cannot be held, as the player reads it (C-8 C8-6). One function for the
 * view's `refusal` (a bare code) and a 409 (code and parameters): the day is shown from 1, and
 * the lineup lock reads as a lock on training, not on the lineup. A code this build does not know
 * gets a plain sentence; nothing is guessed.
 */
export function refusalText(
  t: TFunction,
  language: string,
  code: string,
  params: RefusalParams,
  nowMs: number,
): string {
  if (code === SESSION_CAP) {
    const day = Number(params.nextAllowedDay);
    if (params.nextAllowedDay === undefined || Number.isNaN(day)) {
      return t("online.training.today.unknownRefusal");
    }
    return t(code, { nextAllowedDay: displayDay(day) });
  }
  if (code === LINEUP_LOCKED) {
    const time =
      typeof params.kickoffAt === "string"
        ? formatKickoffClock(params.kickoffAt, nowMs, language)
        : "";
    return t("online.training.today.lineupLocked", { time });
  }
  if (PLAIN_REFUSALS.has(code)) return t(code);
  return t("online.training.today.unknownRefusal");
}

/** The view's refusal with its parameters taken from the view (`refusal` carries none). */
export function viewRefusalParams(trainingDay: TrainingDayView, club: MyClubView): RefusalParams {
  return {
    nextAllowedDay: trainingDay.nextAllowedDay,
    kickoffAt: club.nextFixture?.kickoffAt,
  };
}

/**
 * The kick-off of a match the club plays today and has not started (C-8 C8-12): before the
 * region's day turns and after now. Only two moments are compared; no rule is computed.
 */
export function matchTodayKickoff(
  club: MyClubView,
  nextDayAt: string | undefined,
  nowMs: number,
): string | null {
  const kickoffAt = club.nextFixture?.kickoffAt;
  if (!kickoffAt || !nextDayAt) return null;
  const kickoff = Date.parse(kickoffAt);
  const turn = Date.parse(nextDayAt);
  if (Number.isNaN(kickoff) || Number.isNaN(turn)) return null;
  return kickoff > nowMs && kickoff < turn ? kickoffAt : null;
}

/** One cell of the seven days before today: its day, and how it was held (null: no row). */
export interface RecentDay {
  day: number;
  kind: string | null;
}

/**
 * The seven days before today, oldest first (C-8 C8-5). A day with no row stays empty: the
 * server keeps no row for it, and the card does not call it a rest.
 */
export function recentDays(trainingDay: TrainingDayView): RecentDay[] {
  const today = trainingDay.day;
  if (today === undefined) return [];
  const held = new Map(trainingDay.recent.map((line) => [line.day, line.kind]));
  const days: RecentDay[] = [];
  for (let day = today - 7; day < today; day += 1) {
    if (day >= 0) days.push({ day, kind: held.get(day) ?? null });
  }
  return days;
}
