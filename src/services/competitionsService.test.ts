import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { fetchCompetitionLeaders } from "./competitionsService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("competitionsService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given a competition id, when its leaders are requested, then the backend
  // command is called with that id and its boards are handed back unchanged.
  it("fetches a competition's leaders by id", async () => {
    const leaders = { competitionId: "eng-1", goals: [], assists: [] };
    mockedInvoke.mockResolvedValueOnce(leaders);

    await expect(fetchCompetitionLeaders("eng-1")).resolves.toBe(leaders);
    expect(mockedInvoke).toHaveBeenCalledWith("get_competition_leaders", {
      competitionId: "eng-1",
    });
  });
});
