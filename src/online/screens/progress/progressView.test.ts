import { describe, expect, it } from "vitest";
import { notPlayedOrder, playedOrder, pointsOf, summaryOf } from "./progressView";
import { progressLine } from "./progressTestData";

const xp = (extra: object = {}) => ({ before: 40, gained: 20, after: 60, ready: false, ...extra });

describe("a player's progress through a match", () => {
  // Given a player who trained +2 passing and +1 pace and whose bar gave +1 finishing,
  // when his points are counted,
  // then both kinds count: 4.
  it("counts what he trained and the bar's point", () => {
    const line = progressLine("p1", "An", {
      trainedSince: [
        { attribute: "passing", points: 2 },
        { attribute: "pace", points: 1 },
      ],
      xp: xp({ attributeUp: "shooting", after: 0, gained: 60 }),
    });
    expect(pointsOf(line)).toBe(4);
  });

  // Given a squad where two players gained points and one rose an OVR,
  // when the summary is made,
  // then it counts players who gained, the points, and the OVR risers, played or not.
  it("sums the squad up", () => {
    const summary = summaryOf([
      progressLine("p1", "An", { trainedSince: [{ attribute: "passing", points: 2 }] }),
      progressLine("p2", "Bình", {
        minutes: 0,
        xp: xp({ attributeUp: "pace" }),
        ovrBefore: 61,
        ovrAfter: 62,
      }),
      progressLine("p3", "Cường"),
    ]);
    expect(summary).toEqual({ improved: 2, points: 3, ovrUp: 1, withXp: true });
  });

  // Given a season without match growth (no bar on any line),
  // when the summary is made,
  // then it says so, so the page leaves the bar's explanation out.
  it("knows when no line has a bar", () => {
    expect(summaryOf([progressLine("p1", "An")]).withXp).toBe(false);
  });

  // Given four players who played, one up an OVR, one with the bar's point, one with more
  // trained points, one with the best rating, and one who did not play,
  // when the played list is ordered,
  // then OVR risers come first, then the bar's point, then points, then the match rating
  // (C-22 §7.2), and the one who did not play is not in it.
  it("orders the players who played as §7.2 does", () => {
    const lines = [
      progressLine("rating", "Rating", { rating: 8.4 }),
      progressLine("points", "Points", { trainedSince: [{ attribute: "pace", points: 3 }] }),
      progressLine("bar", "Bar", { xp: xp({ attributeUp: "pace" }) }),
      progressLine("ovr", "Ovr", { ovrBefore: 64, ovrAfter: 65, rating: 5.9 }),
      progressLine("bench", "Bench", { minutes: 0, rating: 0 }),
    ];
    expect(playedOrder(lines).map((line) => line.playerId)).toEqual([
      "ovr",
      "bar",
      "points",
      "rating",
    ]);
  });

  // Given three players who did not play,
  // when they are ordered,
  // then the most trained points come first, then by name.
  it("orders the ones who did not play by points, then name", () => {
    const lines = [
      progressLine("c", "Cường", { minutes: 0 }),
      progressLine("b", "Bình", { minutes: 0 }),
      progressLine("a", "An", { minutes: 0, trainedSince: [{ attribute: "pace", points: 1 }] }),
      progressLine("p", "Played"),
    ];
    expect(notPlayedOrder(lines).map((line) => line.playerId)).toEqual(["a", "b", "c"]);
  });
});
