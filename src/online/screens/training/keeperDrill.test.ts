import { describe, expect, it } from "vitest";
import { trainsKeeperDrill } from "./keeperDrill";

describe("who trains the keepers' drill", () => {
  // Given a season with the keepers' drill on,
  // when a keeper, a centre back and a player known only by his group are asked about,
  // then only the keeper trains it, as the engine picks him by his primary position.
  it("is the keepers of a season with the drill on", () => {
    expect(trainsKeeperDrill("Goalkeeper", true)).toBe(true);
    expect(trainsKeeperDrill("CenterBack", true)).toBe(false);
    expect(trainsKeeperDrill("Defender", true)).toBe(false);
  });

  // Given a season without the drill, or a club with no training day to read it from,
  // when a keeper is asked about,
  // then he does not train it.
  it("is nobody when the season has no drill", () => {
    expect(trainsKeeperDrill("Goalkeeper", false)).toBe(false);
    expect(trainsKeeperDrill("Goalkeeper", undefined)).toBe(false);
  });
});
