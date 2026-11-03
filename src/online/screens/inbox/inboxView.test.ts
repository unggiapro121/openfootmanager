import { describe, expect, it } from "vitest";
import type { MessageData } from "../../../store/types";
import { byDay, categoryCounts, daysAgo, filterInbox, filtersOn, NO_FILTER } from "./inboxView";

const mail = (id: string, category: string, date: string, read = false) =>
  ({
    id,
    category,
    date,
    read,
    subject: id,
    body: "",
    sender: "",
    actions: [],
  }) as unknown as MessageData;

const INBOX = [
  mail("a", "Injury", "2026-10-27T10:00:00"),
  mail("b", "MatchResult", "2026-10-27T09:00:00", true),
  mail("c", "Injury", "2026-10-26T08:00:00", true),
];

describe("filterInbox", () => {
  // Given three messages,
  // when the coach keeps the unread, then the injuries oldest first,
  // then the list keeps those in that order.
  it("keeps what the filter asks for, in its order", () => {
    expect(filterInbox(INBOX, { ...NO_FILTER, unreadOnly: true }).map((m) => m.id)).toEqual(["a"]);
    const injuries = { ...NO_FILTER, categories: ["Injury"], oldestFirst: true };
    expect(filterInbox(INBOX, injuries).map((m) => m.id)).toEqual(["c", "a"]);
    expect(filtersOn(injuries)).toBe(2);
    expect(filtersOn(NO_FILTER)).toBe(0);
  });
});

describe("categoryCounts", () => {
  // Given two injuries (one read) and a read result,
  // when the categories are counted, all then the unread only,
  // then each keeps its place, and the unread count can be nought.
  it("counts each category, the unread only when asked", () => {
    expect(categoryCounts(INBOX, false)).toEqual([
      { category: "Injury", count: 2 },
      { category: "MatchResult", count: 1 },
    ]);
    expect(categoryCounts(INBOX, true)).toEqual([
      { category: "Injury", count: 1 },
      { category: "MatchResult", count: 0 },
    ]);
  });
});

describe("byDay and daysAgo", () => {
  // Given messages over two days,
  // when they are grouped,
  // then each day holds its own, and today and yesterday are told apart from older days.
  it("groups by day and names today and yesterday", () => {
    expect(byDay(INBOX).map((day) => day.messages.map((m) => m.id))).toEqual([["a", "b"], ["c"]]);
    const now = new Date("2026-10-27T12:00:00");
    expect(daysAgo(new Date("2026-10-27T01:00:00"), now)).toBe(0);
    expect(daysAgo(new Date("2026-10-26T23:00:00"), now)).toBe(1);
    expect(daysAgo(new Date("2026-10-20T10:00:00"), now)).toBeNull();
  });
});
