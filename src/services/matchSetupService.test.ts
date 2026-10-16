import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import {
  setMatchSetPieceTaker,
  suggestSetPieceTakers,
  swapPreMatchPositions,
  swapPreMatchStarter,
} from "./matchSetupService";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("swapPreMatchStarter", () => {
  // Given a starter and a bench player before kick-off, when they are swapped,
  // then the pre-match swap command is sent.
  it("sends the pre-match starter swap", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "PreKickOff" });

    const snapshot = await swapPreMatchStarter("Home", "starter", "bench");

    expect(invoke).toHaveBeenCalledWith("apply_match_command", {
      command: { PreMatchSwap: { side: "Home", player_off_id: "starter", player_on_id: "bench" } },
    });
    expect(snapshot).toEqual({ phase: "PreKickOff" });
  });
});

describe("swapPreMatchPositions", () => {
  // Given two starters before kick-off, when they trade slots, then the
  // pre-match position swap command is sent.
  it("sends the pre-match slot trade", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "PreKickOff" });

    await swapPreMatchPositions("Away", "a", "b");

    expect(invoke).toHaveBeenCalledWith("apply_match_command", {
      command: { PreMatchSwapPositions: { side: "Away", player_a_id: "a", player_b_id: "b" } },
    });
  });
});

describe("setMatchSetPieceTaker", () => {
  // Given a player chosen for penalties, when he is named, then the command
  // is keyed by the duty and carries the side and the player.
  it("names the taker under the duty's command", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "PreKickOff" });

    await setMatchSetPieceTaker("Home", "SetPenaltyTaker", "p10");

    expect(invoke).toHaveBeenCalledWith("apply_match_command", {
      command: { SetPenaltyTaker: { side: "Home", player_id: "p10" } },
    });
  });
});

describe("suggestSetPieceTakers", () => {
  // Given the matchday squad, when the backend is asked to pick, then it gets
  // the player ids and its picks come back unchanged.
  it("asks the backend to pick captain and takers", async () => {
    const picks = {
      captain: "p4",
      penalty_taker: "p9",
      free_kick_taker: null,
      corner_taker: "p7",
    };
    vi.mocked(invoke).mockResolvedValue(picks);

    const result = await suggestSetPieceTakers(["p4", "p7", "p9"]);

    expect(invoke).toHaveBeenCalledWith("auto_select_set_pieces", {
      playerIds: ["p4", "p7", "p9"],
    });
    expect(result).toBe(picks);
  });
});
