import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { useClubPotentialAssessments } from "./useClubPotentialAssessments";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

const READ = {
  player_id: "p1",
  potential_low: 70,
  potential_high: 86,
  potential_band: 8,
  potential_believed: 78,
  wonderkid: false,
};

describe("useClubPotentialAssessments", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("indexes the club's reads by player", async () => {
    mockedInvoke.mockResolvedValue({
      assessor: { staff_id: "s1", name: "Ann Scout", role: "Scout" },
      players: [READ],
    });

    const { result } = renderHook(() => useClubPotentialAssessments("2026-08-01"));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.assessor?.name).toBe("Ann Scout");
    expect(result.current.byPlayer.get("p1")).toEqual(READ);
  });

  it("knows no reads when the club cannot be assessed", async () => {
    mockedInvoke.mockRejectedValue("be.error.noActiveGameSession");

    const { result } = renderHook(() => useClubPotentialAssessments("2026-08-01"));

    await waitFor(() => expect(mockedInvoke).toHaveBeenCalled());
    expect(result.current.assessor).toBeNull();
    expect(result.current.byPlayer.size).toBe(0);
  });
});
