import { describe, expect, it } from "vitest";
import type { CoinLineView, CoinView } from "../../api";
import {
  balancesAfter,
  exchangeMax,
  groupByDay,
  leftToday,
  lineTone,
  standing,
  todayTotals,
} from "./coinWallet";

function coins(overrides: Partial<CoinView> = {}): CoinView {
  return {
    balance: 120,
    blocked: false,
    coinLocked: false,
    priceListVersion: 4,
    cashPerCoin: 1_000,
    exchangeDailyLimit: 50,
    exchangedToday: 20,
    nextDayAt: "2026-10-30T04:00:00Z",
    ...overrides,
  };
}

function line(id: number, at: string, amount: number, kind = "coin_exchange"): CoinLineView {
  return { id, at, kind, amount };
}

describe("standing", () => {
  // Given a balance below zero and locked, as a server with `coinLocked` says,
  // when it is read,
  // then both hold, and nothing is a guess.
  it("reads the lock from coinLocked", () => {
    expect(standing(coins({ balance: -5, blocked: true, coinLocked: true }))).toEqual({
      negative: true,
      locked: true,
      maybeLocked: false,
    });
  });

  // Given a server without `coinLocked`: blocked above zero, then blocked below zero,
  // when each is read,
  // then the first is the lock, the second may be.
  it("guesses the lock from blocked on an older server", () => {
    const { coinLocked: _, ...above } = coins({ blocked: true });
    expect(standing(above as CoinView)).toEqual({
      negative: false,
      locked: true,
      maybeLocked: false,
    });
    const { coinLocked: __, ...below } = coins({ blocked: true, balance: -1 });
    expect(standing(below as CoinView)).toEqual({
      negative: true,
      locked: false,
      maybeLocked: true,
    });
  });
});

describe("leftToday and exchangeMax", () => {
  // Given 120 coins with 30 of today's 50 left, then a cap passed, then no cap, then few coins,
  // when what may go is read,
  // then it is the smaller of the coins and what is left, never below zero.
  it("takes the smaller of the coins and what is left today", () => {
    expect(leftToday(coins())).toBe(30);
    expect(exchangeMax(coins())).toBe(30);
    expect(leftToday(coins({ exchangedToday: 60 }))).toBe(0);
    expect(leftToday(coins({ exchangeDailyLimit: undefined }))).toBeUndefined();
    expect(exchangeMax(coins({ exchangeDailyLimit: undefined }))).toBe(120);
    expect(exchangeMax(coins({ balance: 7 }))).toBe(7);
    expect(exchangeMax(coins({ balance: -3 }))).toBe(0);
  });
});

describe("balancesAfter", () => {
  // Given 100 coins now and three lines, newest first: +20, −50, −10,
  // when the balance after each is read,
  // then it walks back from today's balance: 100, 80, 130.
  it("walks back from the balance through the lines newest first", () => {
    const lines = [line(3, "2026-10-29T10:00:00Z", 20), line(2, "x", -50), line(1, "x", -10)];
    expect(balancesAfter(100, lines)).toEqual([100, 80, 130]);
  });
});

describe("todayTotals", () => {
  // Given lines today (+20, −15, −5) and one before today's 04:00 start (+100),
  // when today's totals are read,
  // then only today's count: 20 in, 20 out.
  it("sums what came in and went out since the day began", () => {
    const lines = [
      line(4, "2026-10-29T09:00:00Z", 20),
      line(3, "2026-10-29T08:00:00Z", -15),
      line(2, "2026-10-29T04:00:00Z", -5),
      line(1, "2026-10-29T03:59:59Z", 100),
    ];
    expect(todayTotals(lines, "2026-10-30T04:00:00Z")).toEqual({ in: 20, out: 20 });
  });
});

describe("groupByDay", () => {
  // Given lines on two days, newest first,
  // when they are grouped,
  // then each day keeps its lines in order, the newest day first.
  it("groups the lines by their day on this machine", () => {
    const lines = [
      line(3, "2026-10-29T12:00:00", 1),
      line(2, "2026-10-29T08:00:00", 2),
      line(1, "2026-10-28T12:00:00", 3),
    ];
    const days = groupByDay(lines);
    expect(days.map((day) => day.lines.map((one) => one.id))).toEqual([[3, 2], [1]]);
  });
});

describe("lineTone", () => {
  // Given each kind of line and one this build does not know,
  // when its tone is read,
  // then events are gold, the shop plain, exchanges green, the rest plain.
  it("reads a line's look from its kind", () => {
    expect(
      ["event_reward", "item_purchase", "item_refund", "coin_exchange", "reversal"].map(lineTone),
    ).toEqual(["event", "shop", "shop", "exchange", "other"]);
  });
});
