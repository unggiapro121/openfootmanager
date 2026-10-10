import { describe, expect, it } from "vitest";

import type { TacticsPhaseSettings } from "../../store/types";
import type { TacticsLibraryEntry } from "./TacticsCommandBar";
import { findCustomTacticForSetup, isSamePhaseBlueprint } from "./TacticsCustomTactics.helpers";

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

function customTactic(
  id: string,
  overrides: Partial<TacticsLibraryEntry> = {},
): TacticsLibraryEntry {
  return {
    description: "",
    formation: "4-4-2",
    id,
    name: id,
    phase: blueprint,
    playStyle: "Balanced",
    type: "custom",
    ...overrides,
  };
}

describe("findCustomTacticForSetup", () => {
  const pressing = { ...blueprint, pressing_intensity: "Aggressive" } as TacticsPhaseSettings;
  const tactics = [customTactic("a"), customTactic("b", { phase: pressing })];

  // Given two tactics with the same shape, when the team plays the second one's
  // blueprint, then that tactic is found, not the first one with the same shape.
  it("tells same-shape tactics apart by their phase blueprint", () => {
    expect(findCustomTacticForSetup(tactics, "4-4-2", "Balanced", pressing)?.id).toBe("b");
    expect(findCustomTacticForSetup(tactics, "4-4-2", "Balanced", blueprint)?.id).toBe("a");
  });

  // Given a setup no saved tactic uses, then nothing is found.
  it("finds nothing when no saved tactic matches the setup", () => {
    expect(findCustomTacticForSetup(tactics, "4-3-3", "Balanced", blueprint)).toBeNull();
    const counter = { ...blueprint, break_speed: "Fast" } as TacticsPhaseSettings;
    expect(findCustomTacticForSetup(tactics, "4-4-2", "Balanced", counter)).toBeNull();
  });

  // Given a tactic saved before blueprints were kept, then its shape alone matches.
  it("matches a tactic saved without a blueprint on its shape", () => {
    const legacy = [customTactic("old", { phase: undefined })];
    expect(findCustomTacticForSetup(legacy, "4-4-2", "Balanced", pressing)?.id).toBe("old");
  });
});
