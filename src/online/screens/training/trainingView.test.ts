import { describe, expect, it } from "vitest";
import { squadPlayer } from "../../../test-utils/onlineTestKit";
import type { ExtraDayView, TrainingDayView } from "../../api";
import {
  extraOrder,
  filteredRoster,
  groupOf,
  isScheduleDay,
  scheduleWeek,
  stopsBeforeFirst,
  stripDays,
} from "./trainingView";

function day(overrides: Partial<TrainingDayView> = {}): TrainingDayView {
  return {
    day: 3,
    recent: [{ day: 1, kind: "auto" }],
    canTrain: false,
    sessionsLast7: 1,
    sessionsCap: 6,
    nextRecoveryAt: "2099-01-01T00:00:00Z",
    recovery: { perDay: 6, hours: 8 },
    autoOff: false,
    ...overrides,
  };
}

const EXTRA: ExtraDayView = { canPress: true, today: 0, floor: 40, sitOut: [] };

describe("stripDays", () => {
  // Given day 3 with a row for day 1 only,
  // when the strip is built,
  // then it holds days 0 to 2 (day 0 and 2 with no row) and today last, not yet held.
  it("puts the past days first and today last", () => {
    expect(stripDays(day())).toEqual([
      { day: 0, kind: null, isToday: false },
      { day: 1, kind: "auto", isToday: false },
      { day: 2, kind: null, isToday: false },
      { day: 3, kind: null, isToday: true },
    ]);
  });

  // Given today's session already held before the coach took over,
  // when the strip is built,
  // then today's cell carries it.
  it("shows today's session once held", () => {
    const strip = stripDays(day({ today: "bot" }));
    expect(strip[strip.length - 1]).toEqual({
      day: 3,
      kind: "bot",
      isToday: true,
    });
  });

  // Given no day (before the season or with no seat in it),
  // when the strip is built,
  // then it is empty.
  it("is empty with no day", () => {
    expect(stripDays(day({ day: undefined }))).toEqual([]);
  });
});

describe("the schedule's week", () => {
  // Given the balanced schedule (Mon, Tue, Thu, Fri),
  // when its week is read,
  // then those four days train and Wednesday, Saturday and Sunday rest.
  it("marks the schedule's training days", () => {
    expect(scheduleWeek("Balanced")).toEqual([true, true, false, true, true, false, false]);
  });

  // Given a weekday known or not,
  // when today is checked against the light schedule (Tue, Thu),
  // then Tuesday trains, Monday rests, and an unknown weekday says nothing.
  it("says whether today trains only when the weekday is known", () => {
    expect(isScheduleDay("Light", 1)).toBe(true);
    expect(isScheduleDay("Light", 0)).toBe(false);
    expect(isScheduleDay("Light", null)).toBeNull();
  });
});

describe("extraOrder", () => {
  // Given a tired player sitting out and two fit players,
  // when the extra list is ordered,
  // then the fit come first, fittest first, and the one sitting out last.
  it("lists who can train first, fittest first", () => {
    const players = [
      squadPlayer({ id: "a", condition: 30 }),
      squadPlayer({ id: "b", condition: 60 }),
      squadPlayer({ id: "c", condition: 90 }),
    ];
    const extra = { ...EXTRA, sitOut: [{ playerId: "c", reason: "peaked" }] };
    expect(extraOrder(players, extra).map((player) => player.id)).toEqual(["b", "a", "c"]);
  });
});

describe("stopsBeforeFirst", () => {
  // Given a condition to keep of 75 and sessions costing 3,
  // when players at 76 and 80 are read,
  // then the one a session would take under 75 does not train; the other does.
  it("says who the condition to keep stops before a session", () => {
    expect(stopsBeforeFirst(76, 3, 40, 75)).toBe(true);
    expect(stopsBeforeFirst(80, 3, 40, 75)).toBe(false);
  });

  // Given no condition to keep, or no cost from the server,
  // when a player is read,
  // then nothing is said.
  it("says nothing without a condition to keep or a cost", () => {
    expect(stopsBeforeFirst(50, 3, 40, null)).toBe(false);
    expect(stopsBeforeFirst(50, undefined, 40, 75)).toBe(false);
  });
});

describe("the groups table", () => {
  const groups = [
    { id: "g1", name: "Keepers", focus: "Defending" as const, player_ids: ["a"] },
    { id: "g2", name: "Wingers", focus: "Attacking" as const, player_ids: [] },
  ];
  const roster = [{ id: "a" }, { id: "b" }];

  // Given a player in a group and one in none,
  // when their group is read,
  // then the first has the group's id and the second the team default ("").
  it("reads a player's group", () => {
    expect(groupOf(groups, "a")).toBe("g1");
    expect(groupOf(groups, "b")).toBe("");
  });

  // Given a filter on all, on a group, on an empty group, and on a group since removed,
  // when the roster is filtered,
  // then all, the group's player, no one, and all again.
  it("shows the filter's players", () => {
    expect(filteredRoster(roster, groups, "all")).toEqual(roster);
    expect(filteredRoster(roster, groups, "g1")).toEqual([{ id: "a" }]);
    expect(filteredRoster(roster, groups, "g2")).toEqual([]);
    expect(filteredRoster(roster, groups, "gone")).toEqual(roster);
  });
});
