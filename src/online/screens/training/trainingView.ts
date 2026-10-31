import { SCHEDULE_TRAINING_DAYS } from "../../../components/training/trainingOptions";
import type { ExtraDayView, SquadPlayerView, TrainingDayView } from "../../api";
import { conditionAfter } from "./extraText";
import { recentDays } from "./todayText";

/** The days of a week, Monday first, as the plan's schedules count them. */
const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

/** One cell of the strip: the seven days before today, then today. */
export interface StripDay {
  day: number;
  /** How the day was held; `null` with no row (a past day) or not yet (today). */
  kind: string | null;
  isToday: boolean;
}

/**
 * The strip of the hero card (design tap-luyen.html): the seven days before today, oldest first,
 * then today with its session if one was held. Empty before the season's first day.
 */
export function stripDays(trainingDay: TrainingDayView): StripDay[] {
  if (trainingDay.day === undefined) return [];
  const past = recentDays(trainingDay).map((cell) => ({ ...cell, isToday: false }));
  return [...past, { day: trainingDay.day, kind: trainingDay.today ?? null, isToday: true }];
}

/** Whether each weekday of a schedule is a training day, Monday first. */
export function scheduleWeek(schedule: string): boolean[] {
  const days = SCHEDULE_TRAINING_DAYS[schedule] ?? [];
  return WEEK.map((weekday) => days.includes(weekday));
}

/** Today is a training day on the plan's schedule; `null` while the weekday is unknown. */
export function isScheduleDay(schedule: string, weekday: number | null): boolean | null {
  if (weekday === null) return null;
  return scheduleWeek(schedule)[weekday] ?? false;
}

/**
 * The squad in the order the extra training list shows it: those who can train first, then those
 * the server says sit out; in each, the fittest first. The server still decides who trains.
 */
export function extraOrder(players: SquadPlayerView[], extra: ExtraDayView): SquadPlayerView[] {
  const sittingOut = new Set(extra.sitOut.map((line) => line.playerId));
  return [...players].sort(
    (left, right) =>
      Number(sittingOut.has(left.id)) - Number(sittingOut.has(right.id)) ||
      right.condition - left.condition,
  );
}

/**
 * A chosen player who would not take a single session: the condition to keep stops him before
 * the first one, read the way the server stops him (S-28 S28-3). Unknown without a cost.
 */
export function stopsBeforeFirst(
  condition: number,
  cost: number | undefined,
  floor: number,
  keepAbove: number | null,
): boolean {
  if (cost === undefined || keepAbove === null) return false;
  return conditionAfter(condition, 1, cost, floor, keepAbove) === condition;
}

/** What the groups table reads of a group: the plan's and the card's groups both fit. */
interface GroupMembers {
  id: string;
  player_ids: string[];
}

/** "All" or a group's id: which players the groups table shows. */
export type GroupFilter = "all" | string;

/** The id of the group a player trains in, or "" for the team default. */
export function groupOf(groups: GroupMembers[], playerId: string): string {
  return groups.find((group) => group.player_ids.includes(playerId))?.id ?? "";
}

/** The players a filter shows: all of them, or a group's. A filter on a removed group shows all. */
export function filteredRoster<T extends { id: string }>(
  roster: T[],
  groups: GroupMembers[],
  filter: GroupFilter,
): T[] {
  const group = groups.find((candidate) => candidate.id === filter);
  if (!group) return roster;
  return roster.filter((player) => group.player_ids.includes(player.id));
}
