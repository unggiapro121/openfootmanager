import { describe, expect, it } from "vitest";
import type { LeagueView, StandingRow } from "../api";
import { standingOf, toStandingSnapshot } from "./standing";

const ROW: StandingRow = {
  position: 3,
  club: { id: "club-1", name: "Cầu Vồng Nghệ An" },
  seat: "human",
  played: 5,
  won: 3,
  drawn: 1,
  lost: 1,
  goalsFor: 9,
  goalsAgainst: 4,
  goalDifference: 5,
  points: 10,
};

describe("toStandingSnapshot", () => {
  // Given a club's line of an online table,
  // when it is converted for the league-position card,
  // then every count lands in the field of the same meaning.
  it("keeps every count in its own field", () => {
    expect(toStandingSnapshot(ROW)).toEqual({
      team_id: "club-1",
      played: 5,
      won: 3,
      drawn: 1,
      lost: 1,
      goals_for: 9,
      goals_against: 4,
      points: 10,
    });
  });
});

describe("standingOf", () => {
  // Given a league table,
  // when a club's line is looked up,
  // then the club's own line is found, and a club not in the league has none.
  it("finds the club's own line", () => {
    const league = { table: [ROW, { ...ROW, position: 4, club: { id: "club-2", name: "B" } }] };
    expect(standingOf(league as LeagueView, "club-2")?.position).toBe(4);
    expect(standingOf(league as LeagueView, "club-9")).toBeNull();
  });
});
