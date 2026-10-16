import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { TeamMatchRolesData } from "../store/gameStore";
import { setFormation, setPlayerSquadRole, setPlayStyle, setTeamMatchRoles } from "./squadService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("squadService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("calls the set player squad role backend command", async () => {
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(setPlayerSquadRole("player-1", "Youth")).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("set_player_squad_role", {
      playerId: "player-1",
      squadRole: "Youth",
    });
  });

  it("switches the formation", async () => {
    // Given the backend accepts the new formation
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager picks 4-3-3
    const result = await setFormation("4-3-3");

    // Then the formation command is called with it and the updated game comes back
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("set_formation", { formation: "4-3-3" });
  });

  it("passes a refused formation's error through", async () => {
    // Given the backend rejects an unknown formation
    mockedInvoke.mockRejectedValueOnce("be.error.tactics.invalidFormation");

    // When the manager picks it
    // Then the error reaches the caller untouched
    await expect(setFormation("9-9-9")).rejects.toBe("be.error.tactics.invalidFormation");
  });

  it("sets the play style", async () => {
    // Given the backend accepts the play style
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager chooses a counter-attacking style
    const result = await setPlayStyle("Counter");

    // Then the play style command is called with it and the updated game comes back
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("set_play_style", { playStyle: "Counter" });
  });

  it("saves the captain and set-piece takers", async () => {
    // Given a full set of match roles
    const matchRoles: TeamMatchRolesData = {
      captain: "player-1",
      vice_captain: "player-2",
      penalty_taker: "player-3",
      free_kick_taker: "player-3",
      corner_taker: "player-4",
    };
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager saves them
    const result = await setTeamMatchRoles(matchRoles);

    // Then the roles reach the backend unchanged and the updated game comes back
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("set_team_match_roles", { matchRoles });
  });
});
