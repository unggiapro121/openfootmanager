import { describe, expect, it } from "vitest";

import type { TacticsPhaseSettings } from "../../store/types";
import { isSamePhaseBlueprint } from "./TacticsCustomTactics.helpers";

const blueprint: TacticsPhaseSettings = {
  build_up_style: "Short",
  width: "Normal",
  tempo: "Patient",
  defensive_line: "Medium",
  pressing_intensity: "Medium",
  defensive_shape: "Normal",
  marking_style: "Zonal",
  counter_press_duration: "Short",
  break_speed: "Medium",
};

describe("isSamePhaseBlueprint", () => {
  // Given two blueprints that set every phase alike, then they are the same.
  it("treats identical blueprints as the same", () => {
    expect(isSamePhaseBlueprint(blueprint, { ...blueprint })).toBe(true);
  });

  // Given two blueprints that differ only in how fast they break, then a saved
  // tactic using one is out of date with the other: the break counts too.
  it("tells blueprints apart on any single phase", () => {
    expect(isSamePhaseBlueprint(blueprint, { ...blueprint, break_speed: "Fast" })).toBe(false);
  });
});
