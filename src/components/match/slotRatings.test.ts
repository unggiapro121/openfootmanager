import { describe, expect, it } from "vitest";

import type { EnginePlayerData } from "./types";
import { fitToneClass, naturalPositionOf, ratingAt, slotPositionsOf } from "./slotRatings";

function player(ratings: EnginePlayerData["position_ratings"]): EnginePlayerData {
  return {
    id: "p",
    name: "P",
    position: "Defender",
    ovr: 80,
    position_ratings: ratings,
  } as unknown as EnginePlayerData;
}

const centreBack = player([
  { position: "CenterBack", ovr: 80, fit: "Natural" },
  { position: "LeftBack", ovr: 72, fit: "Adapted" },
  { position: "Striker", ovr: 52, fit: "Unfamiliar" },
]);

describe("slot ratings", () => {
  // Given a 4-2-3-1 XI, then each entry's slot is the pitch position it is
  // drawn at, keeper first.
  it("lays the XI out in the formation's slots", () => {
    expect(slotPositionsOf("4-2-3-1", 11)).toEqual([
      "Goalkeeper",
      "LeftBack",
      "CenterBack",
      "CenterBack",
      "RightBack",
      "DefensiveMidfielder",
      "CentralMidfielder",
      "LeftMidfielder",
      "AttackingMidfielder",
      "RightMidfielder",
      "Striker",
    ]);
  });

  // Given an XI that does not fill the formation, then there are no slots to
  // read: a partial lineup is not slot-aligned.
  it("has no slots for an XI that does not fill the formation", () => {
    expect(slotPositionsOf("4-4-2", 10)).toBeNull();
  });

  // Given a centre-back's ratings from the backend, then his rating and
  // familiarity are read for the slot, and his natural position is the one
  // rated Natural.
  it("reads a player's rating and familiarity at a slot", () => {
    expect(ratingAt(centreBack, "Striker")).toEqual({
      position: "Striker",
      ovr: 52,
      fit: "Unfamiliar",
    });
    expect(naturalPositionOf(centreBack)).toBe("CenterBack");
    expect(ratingAt(player(undefined), "Striker")).toBeUndefined();
  });

  // Given each familiarity, then it is drawn green, amber or red in both themes.
  it("colours each familiarity", () => {
    expect(fitToneClass("Natural")).toContain("text-primary-");
    expect(fitToneClass("Adapted")).toContain("text-accent-");
    expect(fitToneClass("Unfamiliar")).toContain("text-red-");
    for (const fit of ["Natural", "Adapted", "Unfamiliar"] as const) {
      expect(fitToneClass(fit)).toContain("dark:");
    }
  });
});
