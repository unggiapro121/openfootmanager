import type { MessageData } from "../../../store/types";

/** What the phone inbox shows: the unread only or all, some categories or all, which first. */
export interface InboxFilter {
  unreadOnly: boolean;
  categories: string[];
  oldestFirst: boolean;
}

export const NO_FILTER: InboxFilter = { unreadOnly: false, categories: [], oldestFirst: false };

/** The messages under `filter`, from the inbox's newest-first order. */
export function filterInbox(messages: readonly MessageData[], filter: InboxFilter): MessageData[] {
  const kept = messages.filter(
    (message) =>
      (!filter.unreadOnly || !message.read) &&
      (filter.categories.length === 0 || filter.categories.includes(message.category)),
  );
  return filter.oldestFirst ? kept.reverse() : kept;
}

/** How many filters are on: the badge on the filter button. */
export function filtersOn(filter: InboxFilter): number {
  return (filter.unreadOnly ? 1 : 0) + filter.categories.length + (filter.oldestFirst ? 1 : 0);
}

/** Each category the inbox holds, in the order first met, with its count (the unread only, if asked). */
export function categoryCounts(
  messages: readonly MessageData[],
  unreadOnly: boolean,
): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (!counts.has(message.category)) counts.set(message.category, 0);
    if (!unreadOnly || !message.read) {
      counts.set(message.category, (counts.get(message.category) ?? 0) + 1);
    }
  }
  return [...counts].map(([category, count]) => ({ category, count }));
}

/** Messages under the day they came, in the order given. */
export interface InboxDay {
  key: string;
  date: Date;
  messages: MessageData[];
}

const dayKeyOf = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

export function byDay(messages: readonly MessageData[]): InboxDay[] {
  const days: InboxDay[] = [];
  for (const message of messages) {
    const date = new Date(message.date);
    const key = dayKeyOf(date);
    const last = days[days.length - 1];
    if (last && last.key === key) last.messages.push(message);
    else days.push({ key, date, messages: [message] });
  }
  return days;
}

/** Whether `date` is today (0), yesterday (1), or further back (null), on this device's clock. */
export function daysAgo(date: Date, now: Date): 0 | 1 | null {
  if (dayKeyOf(date) === dayKeyOf(now)) return 0;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return dayKeyOf(date) === dayKeyOf(yesterday) ? 1 : null;
}
