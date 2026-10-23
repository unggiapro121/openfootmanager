import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FixtureView } from "./api";
import { currentRound, outcomeFor, seasonFixturesOf } from "./fixtures";
import { fakeServer, ok, resetOnline } from "../test-utils/onlineTestKit";

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

let server: ReturnType<typeof fakeServer>;
beforeEach(() => resetOnline());
afterEach(() => server?.restore());

describe("seasonFixturesOf", () => {
  // Given a league whose rounds each hold the club's fixture among others,
  // when the club's season is read,
  // then every round is asked for and only the club's fixtures come back, in round order.
  it("reads every round and keeps the club's fixtures", async () => {
    server = fakeServer({
      "GET v1/leagues/league-1/fixtures": (request) => {
        const round = Number(request.query?.[0]?.[1]);
        return ok({
          round,
          fixtures: [fixture(round, "mine", `rival-${round}`), fixture(round, "x", "y")],
        });
      },
    });
    const season = await seasonFixturesOf("league-1", "mine");

    expect(season.map((entry) => entry.round)).toEqual(
      Array.from({ length: 26 }, (_, index) => index + 1),
    );
    expect(server.requests).toHaveLength(26);
  });
});

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
