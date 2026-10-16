import { describe, expect, it } from "vitest";
import { createPlayer } from "../../test-utils/factories";
import { buildRadarData, OUTFIELD_RADAR_KEYS } from "./PlayerAttributeRadarChart";

const translate = (key: string) => key;

describe("buildRadarData", () => {
  it("keeps eight outfield axes", () => {
    expect(buildRadarData(createPlayer(), OUTFIELD_RADAR_KEYS, translate)).toHaveLength(8);
  });

  it("reads the passing axis as the mean of short and long passing", () => {
    const player = createPlayer();
    player.attributes = { ...player.attributes, passing: 80, long_passing: 61 };

    const passing = buildRadarData(player, ["passing"], translate)[0];

    expect(passing).toEqual({ attr: "common.attributes.passing", value: 71, fullMark: 100 });
  });

  it("reads the shooting axis as the mean of finishing and long shots", () => {
    const player = createPlayer();
    player.attributes = { ...player.attributes, shooting: 90, long_shots: 50 };

    expect(buildRadarData(player, ["shooting"], translate)[0]?.value).toBe(70);
  });

  it("reads every other axis straight from its attribute", () => {
    const player = createPlayer();
    player.attributes = { ...player.attributes, pace: 77, long_passing: 10 };

    expect(buildRadarData(player, ["pace"], translate)[0]?.value).toBe(77);
  });
});
