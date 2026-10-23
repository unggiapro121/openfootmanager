import { describe, expect, it } from "vitest";
import type { FixtureView } from "./api";
import { currentRound, outcomeFor } from "./fixtures";

function fixture(round: number, home: string, away: string, extra: Partial<FixtureView> = {}) {
  return {
    id: `f-${round}-${home}-${away}`,
    leagueId: "league-1",
    round,
    kickoffAt: "2099-01-01T11:00:00Z",
    status: "scheduled",
    home: { id: home, name: home },
    away: { id: away, name: away },
    ...extra,
  } satisfies FixtureView;
}

describe("outcomeFor", () => {
  // Given settled results at home and away, and an unsettled one,
  // when they are read from the club's side,
  // then a win, a draw and a loss are told apart and the unsettled one has none.
  it("reads a result from the club's side", () => {
    const won = fixture(1, "mine", "b", { status: "settled", homeGoals: 2, awayGoals: 1 });
    const lostAway = fixture(2, "b", "mine", { status: "settled", homeGoals: 3, awayGoals: 0 });
    const drawn = fixture(3, "mine", "b", { status: "settled", homeGoals: 1, awayGoals: 1 });
    expect(outcomeFor(won, "mine")).toBe("W");
    expect(outcomeFor(lostAway, "mine")).toBe("L");
    expect(outcomeFor(drawn, "mine")).toBe("D");
    expect(outcomeFor(fixture(4, "mine", "b"), "mine")).toBeNull();
  });
});

describe("currentRound", () => {
  // Given how many of the season's 182 fixtures are done,
  // when the current round is read,
  // then it is the first round not fully settled, and the last once all are.
  it("is the first round not fully settled", () => {
    expect(currentRound(0)).toBe(1);
    expect(currentRound(6)).toBe(1);
    expect(currentRound(7)).toBe(2);
    expect(currentRound(182)).toBe(26);
  });
});
