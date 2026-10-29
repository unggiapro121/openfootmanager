import type { CoinLineView, CoinView } from "../../api";

/**
 * The wallet's readings of the server's coins and lines (design vi-coin.html): why coins cannot
 * be spent, what may be exchanged now, and what the history shows. Every rule is the server's;
 * these only add up what it sent.
 */

/** Why the coins cannot be spent, each said apart (C-7 §4.1): below zero, and locked. */
export function standing(coins: CoinView): {
  negative: boolean;
  locked: boolean;
  maybeLocked: boolean;
} {
  const negative = coins.balance < 0;
  // An older server has no `coinLocked`: `blocked` with coins at or above zero can only be the
  // lock, and below zero it may be both (R15-1).
  if (typeof coins.coinLocked === "boolean") {
    return { negative, locked: coins.coinLocked, maybeLocked: false };
  }
  return {
    negative,
    locked: coins.blocked && !negative,
    maybeLocked: coins.blocked && negative,
  };
}

/** The coins left to exchange today; none said when the price list sets no daily cap. */
export function leftToday(coins: CoinView): number | undefined {
  if (coins.exchangeDailyLimit === undefined) return undefined;
  return Math.max(0, coins.exchangeDailyLimit - coins.exchangedToday);
}

/** The most that may be exchanged now: the coins held, within what is left today. */
export function exchangeMax(coins: CoinView): number {
  return Math.max(0, Math.min(coins.balance, leftToday(coins) ?? coins.balance));
}

/**
 * The balance after each line, the lines newest first (the server's order): the first is the
 * balance now, each older one is the newer one less what the newer line moved. Right while the
 * lines were read with the balance; the page reads them again when the balance changes.
 */
export function balancesAfter(balance: number, lines: CoinLineView[]): number[] {
  const after: number[] = [];
  let running = balance;
  for (const line of lines) {
    after.push(running);
    running -= line.amount;
  }
  return after;
}

const DAY_MILLIS = 24 * 60 * 60 * 1000;

/**
 * What came in and went out today, today being the region day the exchange cap counts (it ends at
 * `nextDayAt`). Only the lines read so far count: a day of more lines than a page is rare.
 */
export function todayTotals(lines: CoinLineView[], nextDayAt: string): { in: number; out: number } {
  const start = Date.parse(nextDayAt) - DAY_MILLIS;
  let gained = 0;
  let spent = 0;
  for (const line of lines) {
    if (Number.isNaN(start) || Date.parse(line.at) < start) continue;
    if (line.amount > 0) gained += line.amount;
    else spent -= line.amount;
  }
  return { in: gained, out: spent };
}

export interface LineDay {
  /** The day's date on this machine, `YYYY-MM-DD`. */
  key: string;
  /** A line's moment, to name the day by. */
  at: string;
  lines: CoinLineView[];
}

function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The lines by their day on this machine, in the lines' own order. */
export function groupByDay(lines: CoinLineView[]): LineDay[] {
  const days: LineDay[] = [];
  for (const line of lines) {
    const key = dayKey(line.at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.lines.push(line);
    else days.push({ key, at: line.at, lines: [line] });
  }
  return days;
}

export type LineTone = "event" | "shop" | "exchange" | "other";

/** How a line looks by its kind: events gold, the shop plain, exchanges green. */
export function lineTone(kind: string): LineTone {
  if (kind === "event_reward") return "event";
  if (kind === "item_purchase" || kind === "item_refund") return "shop";
  if (kind === "coin_exchange") return "exchange";
  return "other";
}

/** Today's date on this machine, as `groupByDay` keys it. */
export function todayKey(nowMs: number): string {
  return dayKey(new Date(nowMs).toISOString());
}
