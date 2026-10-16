import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { fetchTeamRecentMatches, fetchTeamStatsOverview } from "./teamsService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("teamsService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("asks for a club's season stats overview", async () => {
    // Given the backend has season figures for the club
    const response = { matchesPlayed: 10, goalsFor: 18, goalsAgainst: 9 };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the team profile asks for team-1's overview
    const result = await fetchTeamStatsOverview("team-1");

    // Then the overview command is called for that club and its answer comes back as is
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("get_team_stats_overview", { teamId: "team-1" });
  });

  it("asks for a club's last five results by default", async () => {
    // Given the club has played recently
    const response = [{ fixtureId: "fixture-1" }];
    mockedInvoke.mockResolvedValueOnce(response);

    // When the team profile asks for its recent matches without a limit
    const result = await fetchTeamRecentMatches("team-1");

    // Then the history command is called with a limit of five
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("get_team_match_history", {
      teamId: "team-1",
      limit: 5,
    });
  });

  it("treats a missing match history as no matches", async () => {
    // Given the backend has no history for the club
    mockedInvoke.mockResolvedValueOnce(null);

    // When the team profile asks for its last three matches
    const result = await fetchTeamRecentMatches("team-1", 3);

    // Then the caller gets an empty list, and the limit it asked for was sent
    expect(result).toEqual([]);
    expect(mockedInvoke).toHaveBeenCalledWith("get_team_match_history", {
      teamId: "team-1",
      limit: 3,
    });
  });
});
