import { describe, expect, it } from "vitest";

import type { ManagerData } from "../store/types";
import { getBestPlayStyle, getPlayStyleMastery } from "./managerMastery";

function manager(overrides: Partial<ManagerData> = {}): ManagerData {
  return {
    id: "m1",
    first_name: "Jane",
    last_name: "Doe",
    date_of_birth: "1980-01-01",
    nationality: "GB",
    reputation: 500,
    satisfaction: 50,
    fan_approval: 50,
    team_id: null,
    career_stats: {
      matches_managed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      trophies: 0,
      best_finish: null,
    },
    career_history: [],
    ...overrides,
  };
}

describe("managerMastery", () => {
  it("reads a manager's mastery of a style", () => {
    const coach = manager({ play_style_mastery: { Counter: 72, HighPress: 31 } });

    expect(getPlayStyleMastery(coach, "Counter")).toBe(72);
    expect(getPlayStyleMastery(coach, "HighPress")).toBe(31);
  });

  it("reads a style the payload leaves out as neutral 50", () => {
    expect(getPlayStyleMastery(manager(), "Possession")).toBe(50);
    expect(getPlayStyleMastery(manager({ play_style_mastery: { Counter: 72 } }), "Defensive")).toBe(
      50,
    );
  });

  it("names the style the manager is strongest in", () => {
    const coach = manager({
      play_style_mastery: {
        Balanced: 44,
        Attacking: 58,
        Defensive: 39,
        Possession: 66,
        Counter: 51,
        HighPress: 47,
      },
    });

    expect(getBestPlayStyle(coach)).toEqual({ style: "Possession", value: 66 });
  });

  it("prefers the earlier style on a tie, as the backend does", () => {
    expect(getBestPlayStyle(manager())).toEqual({ style: "Balanced", value: 50 });
  });
});
