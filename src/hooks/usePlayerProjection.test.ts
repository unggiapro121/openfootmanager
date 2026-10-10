import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { usePlayerProjection } from "./usePlayerProjection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

describe("usePlayerProjection", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("fetches the projection of the player it is given", async () => {
    const projection = { player_id: "p1", wonderkid: true };
    mockedInvoke.mockResolvedValue(projection);

    const { result } = renderHook(() => usePlayerProjection("p1", "2026-08-01"));

    await waitFor(() => expect(result.current.projection).toEqual(projection));
    expect(result.current.error).toBeNull();
    expect(mockedInvoke).toHaveBeenCalledWith("get_player_projection", { playerId: "p1" });
  });

  it("asks nothing without a player, and keeps the backend's reason when refused", async () => {
    const { result: none } = renderHook(() => usePlayerProjection(null, "2026-08-01"));
    expect(none.current.projection).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();

    mockedInvoke.mockRejectedValue("be.error.projection.noAssessor");
    const { result: refused } = renderHook(() => usePlayerProjection("p1", "2026-08-01"));
    await waitFor(() => expect(refused.current.error).toBe("be.error.projection.noAssessor"));
    expect(refused.current.projection).toBeNull();
  });
});
