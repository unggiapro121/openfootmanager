import { describe, expect, it } from "vitest";
import { myClub, squadPlayer } from "../../../test-utils/onlineTestKit";
import { fitRank, squadFits } from "./squadFit";

const keeper = squadPlayer({
  id: "gk",
  position: "Goalkeeper",
  naturalPosition: "Goalkeeper",
  alternatePositions: [],
});
const striker = squadPlayer({
  id: "st",
  position: "Forward",
  naturalPosition: "Striker",
  alternatePositions: [],
});
const bench = squadPlayer({
  id: "bench",
  position: "Forward",
  naturalPosition: "Striker",
  alternatePositions: [],
});

function club(xi: string[]) {
  const base = myClub({ players: [keeper, striker, bench] });
  return { ...base, setup: { ...base.setup, formation: "4-4-2", startingXiIds: xi } };
}

describe("how a player suits the saved formation and style", () => {
  // Given a club whose first eleven opens with its keeper and then a striker,
  // when the fits are worked out,
  // then the keeper is natural in goal, the striker out of position in the second slot, and the
  // man off the pitch has no slot but a best role.
  it("rates a starter by the slot he stands in", () => {
    const fits = squadFits(club(["gk", "st"]));

    expect(fits.get("gk")).toMatchObject({
      starter: true,
      tactical: "natural",
      outOfPosition: false,
    });
    expect(fits.get("st")).toMatchObject({ starter: true, tactical: "out", outOfPosition: true });
    const off = fits.get("bench");
    expect(off).toMatchObject({ starter: false, outOfPosition: false });
    expect(off?.bestRole).toBeTruthy();
    expect(["strong", "good", "risky"]).toContain(off?.style);
  });

  // Given those fits,
  // when the formation column is ranked,
  // then a player off the pitch comes first, then natural, then out of position; a keeper, and
  // only a keeper, has the two halves of his style fit.
  it("ranks the formation fit with the bench first, and tells a keeper's style fit", () => {
    const fits = squadFits(club(["gk", "st"]));

    expect(fitRank(fits.get("bench"), "fit")).toBe(-1);
    expect(fitRank(fits.get("gk"), "fit")).toBe(0);
    expect(fitRank(fits.get("st"), "fit")).toBe(2);
    expect(fitRank(undefined, "fit")).toBe(-1);
    expect(fits.get("gk")?.keeper).not.toBeNull();
    expect(fits.get("st")?.keeper).toBeNull();
  });
});
