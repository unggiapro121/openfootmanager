import { describe, expect, it } from "vitest";
import type { TrophyView } from "../../api";
import { cabinet, latestTitle, trophyTone } from "./honoursView";

const trophy = (
  kind: string,
  seasonNumber: number,
  level: number,
  coach?: { name: string; mine: boolean },
): TrophyView => ({
  id: `${kind}-${seasonNumber}`,
  kind,
  place: { seasonNumber, region: "AsiaSoutheast", level, tier: 0 },
  club: { id: "club-1", name: "Malang Leopards" },
  coach,
});

describe("the trophy room's shelf", () => {
  // Given levels 1, 4, 5, 9, 10, 14, 15 and 20,
  // when their trophy's tone is chosen,
  // then it is bronze to 4, silver to 9, gold to 14 and platinum from 15 (Qtr-2).
  it("tones a trophy by its level", () => {
    expect([1, 4, 5, 9, 10, 14, 15, 20].map(trophyTone)).toEqual([
      "bronze",
      "bronze",
      "silver",
      "silver",
      "gold",
      "gold",
      "platinum",
      "platinum",
    ]);
  });

  // Given titles at level 2 in seasons 3 and 5, one at level 3 in season 7 and a promotion,
  // when the cabinet is laid out,
  // then the titles come first, highest level first, each level once with its count and
  // seasons newest first, and the promotion after them.
  it("groups the titles by level, highest first, then the promotions", () => {
    const shelf = cabinet(
      [
        trophy("leagueTitle", 7, 3),
        trophy("promotion", 6, 2),
        trophy("leagueTitle", 5, 2),
        trophy("leagueTitle", 3, 2),
      ],
      false,
    );
    expect(shelf.map((row) => [row.kind, row.level, row.count, row.seasons])).toEqual([
      ["leagueTitle", 3, 1, [7]],
      ["leagueTitle", 2, 2, [5, 3]],
      ["promotion", 2, 1, [6]],
    ]);
  });

  // Given one title under the coach and one under the AI,
  // when the cabinet is laid out for "under me",
  // then only the coach's is on it.
  it("keeps only the coach's own when asked", () => {
    const shelf = cabinet(
      [trophy("leagueTitle", 5, 2, { name: "Lê Tấn", mine: true }), trophy("leagueTitle", 3, 2)],
      true,
    );
    expect(shelf.map((row) => row.seasons)).toEqual([[5]]);
  });

  // Given titles in seasons 3 and 6 and a promotion in season 7,
  // when the latest title is picked,
  // then it is season 6's; with none there is none.
  it("picks the latest title", () => {
    expect(
      latestTitle([
        trophy("leagueTitle", 3, 1),
        trophy("promotion", 7, 2),
        trophy("leagueTitle", 6, 2),
      ])?.id,
    ).toBe("leagueTitle-6");
    expect(latestTitle([trophy("promotion", 7, 2)])).toBeUndefined();
  });
});
