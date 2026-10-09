import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCompetitionLeaders } from "../../services/competitionsService";
import { useCompetitionLeaders } from "./useCompetitionLeaders";

vi.mock("../../services/competitionsService", () => ({
  fetchCompetitionLeaders: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchCompetitionLeaders);

function leaders(competitionId: string) {
  return { competitionId, goals: [], assists: [], yellowCards: [], redCards: [] };
}

describe("useCompetitionLeaders", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  // Given a competition on show, then its leaders are fetched, and fetched
  // again when another competition is picked or the day moves on.
  it("fetches the leaders of the competition on show, and refetches on a change", async () => {
    mockedFetch.mockImplementation(async (id) => leaders(id));
    const { result, rerender } = renderHook(({ id, day }) => useCompetitionLeaders(id, day), {
      initialProps: { id: "eng-1" as string | null, day: "2026-09-01" },
    });

    await waitFor(() => expect(result.current?.competitionId).toBe("eng-1"));

    rerender({ id: "eng-cup", day: "2026-09-01" });
    await waitFor(() => expect(result.current?.competitionId).toBe("eng-cup"));

    rerender({ id: "eng-cup", day: "2026-09-02" });
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(3));
  });

  // Given no competition, then nothing is fetched and there are no leaders.
  it("has no leaders without a competition", () => {
    const { result } = renderHook(() => useCompetitionLeaders(null, "2026-09-01"));

    expect(result.current).toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  // Given the fetch fails, then there are no leaders rather than a stale board
  // from another competition.
  it("drops the leaders when the fetch fails", async () => {
    mockedFetch.mockResolvedValueOnce(leaders("eng-1"));
    const { result, rerender } = renderHook(({ id }) => useCompetitionLeaders(id, "d"), {
      initialProps: { id: "eng-1" as string | null },
    });
    await waitFor(() => expect(result.current?.competitionId).toBe("eng-1"));

    mockedFetch.mockRejectedValueOnce("be.error.noActiveGameSession");
    rerender({ id: "eng-cup" });

    await waitFor(() => expect(result.current).toBeNull());
  });
});
