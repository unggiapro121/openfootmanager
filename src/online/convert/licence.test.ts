import { describe, expect, it } from "vitest";

import type { LicenceTableView, MyClubView } from "../api";
import { boardLimits, licenceSteps, openInMatch } from "./licence";

const TABLE: LicenceTableView = {
  levels: { national: 2, continental: 4, elite: 7 },
  tiers: [1, 2, 3, 4].map((tier) => ({
    tier,
    formations: [],
    playStyles: [],
    dials: [],
    roles: [],
  })),
};

function club(licence: MyClubView["licence"]): MyClubView {
  return { licence } as MyClubView;
}

describe("boardLimits", () => {
  // Given a second-licence coach and the licence table,
  // when the board's limits are made,
  // then they open the second licence and keep the table and its levels.
  it("gives the board the coach's licence within the table", () => {
    const limits = boardLimits(
      club({ level: 3, tier: 2, nextTierLevel: 4, pending: false }),
      TABLE,
    );
    expect(limits?.open.tier).toBe(2);
    expect(limits?.table).toHaveLength(4);
    expect(limits?.levels.elite).toBe(7);
  });

  // Given a season without licences (no licence on the club, no levels in the table), or a table
  // not read yet,
  // when the board's limits are made,
  // then there are none: everything is open.
  it("gives no limits when the season has no licences", () => {
    expect(boardLimits(club(undefined), TABLE)).toBeUndefined();
    expect(
      boardLimits(club({ level: 1, tier: 1, pending: false }), { tiers: TABLE.tiers }),
    ).toBeUndefined();
    expect(boardLimits(club({ level: 1, tier: 1, pending: false }), null)).toBeUndefined();
  });
});

describe("openInMatch", () => {
  const first = {
    tier: 1,
    formations: ["4-4-2", "4-3-3", "3-5-2"],
    playStyles: ["Balanced" as const],
    dials: [],
    roles: [],
  };

  // Given a side of the first licence in a match, and one with none,
  // when the order lists are filtered,
  // then the first keeps only its open shapes, styles and roles (Standard always), and the other
  // keeps every one.
  it("keeps the orders a side's licence opens", () => {
    expect(openInMatch(first, "formation", ["4-4-2", "4-2-3-1"])).toEqual(["4-4-2"]);
    expect(openInMatch(first, "playStyle", ["Balanced", "Counter"])).toEqual(["Balanced"]);
    expect(openInMatch(first, "role", ["Standard", "Poacher"])).toEqual(["Standard"]);
    expect(openInMatch(undefined, "formation", ["4-4-2", "4-2-3-1"])).toEqual(["4-4-2", "4-2-3-1"]);
  });
});

describe("licenceSteps", () => {
  const table: LicenceTableView = {
    levels: { national: 2, continental: 4, elite: 7 },
    tiers: [
      { tier: 1, formations: ["4-4-2"], playStyles: ["Balanced"], dials: [], roles: [] },
      {
        tier: 2,
        formations: ["4-4-2", "4-2-3-1"],
        playStyles: ["Balanced", "Counter"],
        dials: ["width"],
        roles: ["Poacher"],
      },
      {
        tier: 3,
        formations: ["4-4-2", "4-2-3-1"],
        playStyles: ["Balanced", "Counter"],
        dials: ["width", "break_speed"],
        roles: ["Poacher", "Mezzala"],
      },
    ],
  };

  // Given the licence table,
  // when it is read as a road,
  // then each licence starts at its level, counts what it opens, and lists what it adds to the
  // one before; the first adds everything it opens.
  it("reads each licence as a step of the road", () => {
    const steps = licenceSteps(table);
    expect(steps.map((step) => step.startsAt)).toEqual([1, 2, 4]);
    expect(steps[0].totals).toEqual({ formations: 1, playStyles: 1, dials: 0, roles: 0 });
    expect(steps[0].added.formations).toEqual(["4-4-2"]);
    expect(steps[1].added).toEqual({
      formations: ["4-2-3-1"],
      playStyles: ["Counter"],
      dials: ["width"],
      roles: ["Poacher"],
    });
    expect(steps[2].added).toEqual({
      formations: [],
      playStyles: [],
      dials: ["break_speed"],
      roles: ["Mezzala"],
    });
  });
});
