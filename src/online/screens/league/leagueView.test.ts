import { describe, expect, it } from "vitest";
import type { FixtureView } from "../../api";
import { ownFirst, rankLeaders, recentForm, roundState, tiedWithFirst } from "./leagueView";

const A = { id: "a", name: "A" };
const B = { id: "b", name: "B" };
const C = { id: "c", name: "C" };

function fixture(home: typeof A, away: typeof A, extra: Partial<FixtureView> = {}): FixtureView {
  return {
    id: `${home.id}-${away.id}`,
    leagueId: "l",
    round: 1,
    kickoffAt: "2099-01-01T00:00:00Z",
    status: "scheduled",
    home,
    away,
    ...extra,
  };
}
const won = (home: typeof A, away: typeof A, h: number, a: number) =>
  fixture(home, away, { status: "settled", homeGoals: h, awayGoals: a });

describe("recentForm", () => {
  // Given A beating B in round 1, and A drawing with C in round 2 while B's match is not settled,
  // when the form is read,
  // then A has a win then a draw, B a loss, C a draw.
  it("lists each club's results, oldest first", () => {
    const form = recentForm([[won(A, B, 2, 0)], [won(C, A, 1, 1), fixture(B, C)]]);
    expect(Object.fromEntries(form)).toEqual({ a: ["W", "D"], b: ["L"], c: ["D"] });
  });
});

describe("rankLeaders", () => {
  // Given scorers on 3, 3 and 1,
  // when they are ranked,
  // then the two on 3 share first place and the third is third, two of them tied at the top.
  it("gives players level the same rank", () => {
    const line = (name: string, value: number) => ({
      playerId: name,
      name,
      clubId: "a",
      clubName: "A",
      value,
    });
    const ranked = rankLeaders([line("x", 3), line("y", 3), line("z", 1)]);
    expect(ranked.map((one) => one.rank)).toEqual([1, 1, 3]);
    expect(tiedWithFirst(ranked)).toBe(1);
    expect(tiedWithFirst([])).toBe(0);
  });
});

describe("roundState and ownFirst", () => {
  // Given rounds settled, being played and to come,
  // when their state is read,
  // then each says so; and the coach's own fixture comes first.
  it("reads a round's state and puts the coach's fixture first", () => {
    expect(roundState([won(A, B, 1, 0)])).toBe("done");
    expect(roundState([won(A, B, 1, 0), fixture(B, C, { matchStatus: "live" })])).toBe("live");
    expect(roundState([fixture(A, B)])).toBe("upcoming");
    expect(ownFirst([fixture(B, C), fixture(A, B)], "a").map((one) => one.id)).toEqual([
      "a-b",
      "b-c",
    ]);
  });
});
