import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import { swapMatchPositions } from "./liveMatchService";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("swapMatchPositions", () => {
  // Given two players of the user's side, then the backend is asked to trade
  // their slots with the in-match command.
  it("sends the in-match slot trade", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "SecondHalf" });

    const snapshot = await swapMatchPositions("Away", "a", "b");

    expect(invoke).toHaveBeenCalledWith("apply_match_command", {
      command: { SwapPositions: { side: "Away", player_a_id: "a", player_b_id: "b" } },
    });
    expect(snapshot).toEqual({ phase: "SecondHalf" });
  });
});
