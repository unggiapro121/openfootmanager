import { describe, expect, it } from "vitest";
import type { FixtureView } from "../../api";
import { byDay, countByVenue, ofVenue } from "./scheduleView";

const MINE = { id: "club-1", name: "Mine" };
const RIVAL = { id: "club-2", name: "Rival" };

function fixture(round: number, kickoffAt: string, home = MINE, away = RIVAL): FixtureView {
  return { id: `f${round}`, leagueId: "l", round, kickoffAt, status: "scheduled", home, away };
}

const SEASON = [
  fixture(1, "2026-10-28T12:12:00Z"),
  fixture(2, "2026-10-28T12:42:00Z", RIVAL, MINE),
  fixture(3, "2026-10-29T12:12:00Z"),
];

describe("the phone schedule's view", () => {
  // Given a season with home and away fixtures,
  // when the coach picks Home or Away,
  // then only the fixtures the club plays at home, or away, remain, in their order.
  it("keeps the fixtures of the venue picked", () => {
    expect(ofVenue(SEASON, "club-1", "all").map((one) => one.round)).toEqual([1, 2, 3]);
    expect(ofVenue(SEASON, "club-1", "home").map((one) => one.round)).toEqual([1, 3]);
    expect(ofVenue(SEASON, "club-1", "away").map((one) => one.round)).toEqual([2]);
  });

  // Given the same season,
  // when the filters show their counts,
  // then each counts the fixtures it would keep.
  it("counts the fixtures of each venue", () => {
    expect(countByVenue(SEASON, "club-1")).toEqual({ all: 3, home: 2, away: 1 });
  });

  // Given fixtures on two days of this machine's calendar,
  // when the list groups them,
  // then each day holds its own fixtures in order, the days in order.
  it("groups the fixtures by the day they kick off", () => {
    const days = byDay(SEASON);
    expect(days.map((day) => day.fixtures.map((one) => one.round))).toEqual([[1, 2], [3]]);
    expect(days[0].date.toDateString()).toBe(new Date("2026-10-28T12:12:00Z").toDateString());
  });
});
