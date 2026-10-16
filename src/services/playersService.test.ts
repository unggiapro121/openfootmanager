import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { getPlayerMatchHistory, getPlayerStatsOverview } from "./playersService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("playersService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("asks for one player's advanced stats overview", async () => {
    // Given the backend has an advanced-stats view of the player
    const response = { percentileEligible: true, metrics: {} };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the profile asks for player-1's overview
    const result = await getPlayerStatsOverview("player-1");

    // Then the overview command is called for that player and its answer comes back as is
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("get_player_stats_overview", {
      playerId: "player-1",
    });
  });

  it("asks for a player's last matches up to the limit", async () => {
    // Given the player has played recently
    const response = [{ fixture_id: "fixture-1" }];
    mockedInvoke.mockResolvedValueOnce(response);

    // When the profile asks for player-1's last five matches
    const result = await getPlayerMatchHistory("player-1", 5);

    // Then the history command is called with the player and the limit
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("get_player_match_history", {
      playerId: "player-1",
      limit: 5,
    });
  });

  it("passes a failed match history request through", async () => {
    // Given the backend cannot find the player
    mockedInvoke.mockRejectedValueOnce("be.error.players.notFound");

    // When the profile asks for the player's match history
    // Then the error reaches the caller untouched
    await expect(getPlayerMatchHistory("ghost", 5)).rejects.toBe("be.error.players.notFound");
  });
});
