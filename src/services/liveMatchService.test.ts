import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import { autoPickMatchLineup, changeMatchPlayerRole, swapMatchPositions } from "./liveMatchService";

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

describe("changeMatchPlayerRole", () => {
  // Given a player of the user's side, then the backend is asked to change his
  // role for this match.
  it("sends the in-match role change", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "FirstHalf" });

    await changeMatchPlayerRole("Home", "p9", "Poacher");

    expect(invoke).toHaveBeenCalledWith("apply_match_command", {
      command: { ChangePlayerRole: { side: "Home", player_id: "p9", role: "Poacher" } },
    });
  });
});

describe("autoPickMatchLineup", () => {
  // Given the user's side, then the backend is asked to pick its strongest XI.
  it("asks for the strongest XI", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "PreKickOff" });

    await autoPickMatchLineup("Away");

    expect(invoke).toHaveBeenCalledWith("auto_pick_match_lineup", { side: "Away" });
  });
});
