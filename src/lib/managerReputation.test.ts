import { describe, expect, it } from "vitest";

import type { ManagerData, ReputationChange } from "../store/types";
import { getLastReputationChange, getReputationLog } from "./managerReputation";

function change(overrides: Partial<ReputationChange>): ReputationChange {
  return {
    season: 2026,
    team_id: "team-1",
    before: 500,
    after: 545,
    performance: 45,
    honours: 0,
    club_pull: 0,
    dismissal: 0,
    league_matches_led: 38,
    league_matches_played: 38,
    ...overrides,
  };
}

function manager(overrides: Partial<ManagerData>): ManagerData {
  return {
    id: "mgr",
    first_name: "Sam",
    last_name: "Boss",
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

describe("getReputationLog", () => {
  it("is empty for a payload without progression", () => {
    expect(getReputationLog(manager({}))).toEqual([]);
  });

  it("returns the seasons in the order the backend logged them", () => {
    const log = [change({ season: 2026 }), change({ season: 2027, before: 545, after: 600 })];
    expect(getReputationLog(manager({ progression: { reputation_log: log } }))).toEqual(log);
  });
});

describe("getLastReputationChange", () => {
  it("is null before the first review", () => {
    expect(getLastReputationChange(manager({ progression: {} }))).toBeNull();
  });

  it("gives the latest season and how far reputation moved in it", () => {
    const log = [
      change({ season: 2026, before: 500, after: 545 }),
      change({ season: 2027, before: 545, after: 470 }),
    ];
    expect(getLastReputationChange(manager({ progression: { reputation_log: log } }))).toEqual({
      season: 2027,
      delta: -75,
    });
  });
});
