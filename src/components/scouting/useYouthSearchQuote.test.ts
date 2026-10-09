import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { useYouthSearchQuote } from "./useYouthSearchQuote";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

describe("useYouthSearchQuote", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("quotes the selected search", async () => {
    mockedInvoke.mockResolvedValue({ fee: 50_000, days: 6, rest_days_left: 0 });

    const { result } = renderHook(() =>
      useYouthSearchQuote("scout-1", "International", "Balanced", "2026-08-01"),
    );

    await waitFor(() =>
      expect(result.current).toEqual({ fee: 50_000, days: 6, rest_days_left: 0 }),
    );
    expect(mockedInvoke).toHaveBeenCalledWith("quote_youth_search", {
      scoutId: "scout-1",
      region: "International",
      objective: "Balanced",
    });
  });

  it("has no quote without a scout, and none when the quote fails", async () => {
    const { result: none } = renderHook(() =>
      useYouthSearchQuote("", "Domestic", "Balanced", "2026-08-01"),
    );
    expect(none.current).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();

    mockedInvoke.mockRejectedValue("be.error.noActiveGameSession");
    const { result: failed } = renderHook(() =>
      useYouthSearchQuote("scout-1", "Domestic", "Balanced", "2026-08-01"),
    );
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalled());
    expect(failed.current).toBeNull();
  });
});
