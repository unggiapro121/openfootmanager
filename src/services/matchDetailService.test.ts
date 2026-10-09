import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { getFixtureDetail } from "./matchDetailService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("matchDetailService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given a fixture id, when its detail is requested, then the backend command
  // is called with that id and its record is handed back unchanged.
  it("fetches one fixture's detail by id", async () => {
    const detail = { fixtureId: "f1", homeTeamName: "Alpha FC" };
    mockedInvoke.mockResolvedValueOnce(detail);

    await expect(getFixtureDetail("f1")).resolves.toBe(detail);
    expect(mockedInvoke).toHaveBeenCalledWith("get_fixture_detail", { fixtureId: "f1" });
  });
});
