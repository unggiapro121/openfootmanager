import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { advanceToNextSeason } from "./seasonService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("seasonService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("rolls the season over without sending any arguments", async () => {
    // Given the backend closes the season and returns its summary
    const response = {
      game: { manager: { id: "manager-1" } },
      summary: { season: 2026, league_name: "Premier League" },
    };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager advances to the next season
    const result = await advanceToNextSeason();

    // Then the rollover command is called with no argument object and its answer comes back as is
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("advance_to_next_season");
    expect(mockedInvoke.mock.calls[0]).toHaveLength(1);
  });

  it("passes a sacking through to the caller", async () => {
    // Given the board's end-of-season review sacks the manager
    const response = {
      action: "fired",
      game: { manager: { id: "manager-1" } },
      summary: { season: 2026 },
    };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager advances to the next season
    const result = await advanceToNextSeason();

    // Then the caller sees the fired action
    expect(result.action).toBe("fired");
  });

  it("passes a refused rollover's error through", async () => {
    // Given the backend refuses to roll over while fixtures remain
    mockedInvoke.mockRejectedValueOnce("be.error.season.notFinished");

    // When the manager advances to the next season
    // Then the error reaches the caller untouched
    await expect(advanceToNextSeason()).rejects.toBe("be.error.season.notFinished");
  });
});
