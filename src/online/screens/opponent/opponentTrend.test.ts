import { describe, expect, it } from "vitest";
import { goalRows, laneBars, styleRows, teamRows } from "./opponentTrend";
import { trendView } from "./opponentTestData";

describe("the trend's rows (C-23b)", () => {
  // Given a trend where the club scored from open play and a corner, and conceded a penalty,
  // when its goal sources are listed,
  // then the seven sources come in their order, and a source at 0 on both sides is left out.
  it("leaves out a goal source at 0 on both sides", () => {
    const trend = trendView(
      { goalsBySource: { ...trendView().team.goalsBySource, openPlay: 4, corner: 1 } },
      { goalsBySource: { ...trendView().team.goalsBySource, penalty: 2 } },
    );

    expect(goalRows(trend)).toEqual([
      { source: "openPlay", scored: 4, conceded: 0 },
      { source: "corner", scored: 1, conceded: 0 },
      { source: "penalty", scored: 0, conceded: 2 },
    ]);
  });

  // Given a trend where the club plays long balls, its opponents cross early, and nobody
  // counters, when the observed play is listed,
  // then a behaviour at 0 on both sides (counters, crosses never seen…) is left out.
  it("leaves out a behaviour at 0 on both sides", () => {
    const trend = trendView({ longBalls: 7.3 }, { earlyCrosses: 1.2, offsides: 0.4 });

    expect(styleRows(trend)).toEqual([
      { behaviour: "longBalls", team: 7.3, against: 0 },
      { behaviour: "earlyCrosses", team: 0, against: 1.2 },
      { behaviour: "offsides", team: 0, against: 0.4 },
    ]);
  });

  // Given a trend with a pass accuracy on both sides, and one without it,
  // when the team's figures are listed,
  // then the pass accuracy row shows only when the server sent it.
  it("shows the pass accuracy only when it was sent", () => {
    const withPasses = trendView({ passAccuracy: 81.4 }, { passAccuracy: 77 });
    const rows = (trend: typeof withPasses) => teamRows(trend).map((row) => row.figure);

    expect(rows(withPasses)).toEqual([
      "possession",
      "shots",
      "corners",
      "fouls",
      "cards",
      "passAccuracy",
    ]);
    expect(rows(trendView())).not.toContain("passAccuracy");
    expect(rows(trendView({ passAccuracy: 80 }))).not.toContain("passAccuracy");
  });

  // Given lanes with shares, and lanes all at 0,
  // when the bars are drawn,
  // then a side with shares gets its three bars in order, one all at 0 gets none.
  it("draws no lane bars for lanes all at 0", () => {
    const trend = trendView({ finalThirdLanes: { left: 30, centre: 25, right: 45 } });

    expect(laneBars(trend.team)).toEqual([
      { lane: "left", share: 30 },
      { lane: "centre", share: 25 },
      { lane: "right", share: 45 },
    ]);
    expect(laneBars(trend.against)).toBeNull();
  });
});
