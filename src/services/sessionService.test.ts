import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  deleteSave,
  exitToMenu,
  getActiveGame,
  getActiveSaveId,
  listSaves,
  loadGame,
  saveGame,
  selectTeam,
  startNewGame,
} from "./sessionService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("sessionService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given a game in progress, when its state is requested, then the backend is
  // asked with no arguments and the state is handed back unchanged.
  it("fetches the active game", async () => {
    const game = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(game);

    await expect(getActiveGame()).resolves.toBe(game);
    expect(mockedInvoke).toHaveBeenCalledWith("get_active_game");
  });

  // Given no game in progress, when its state is requested, then the backend's
  // rejection reaches the caller.
  it("passes the no-active-game rejection through", async () => {
    mockedInvoke.mockRejectedValueOnce("be.error.game.noActiveGame");

    await expect(getActiveGame()).rejects.toBe("be.error.game.noActiveGame");
  });

  // Given a game not yet saved, when its save id is requested, then null comes back.
  it("fetches the active save id", async () => {
    mockedInvoke.mockResolvedValueOnce(null);

    await expect(getActiveSaveId()).resolves.toBeNull();
    expect(mockedInvoke).toHaveBeenCalledWith("get_active_save_id");
  });

  // Given a game in progress, when it is saved, then the save command is sent
  // with no arguments.
  it("saves the game", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await saveGame();
    expect(mockedInvoke).toHaveBeenCalledWith("save_game");
  });

  // Given a game in progress, when the manager exits, then the exit command is
  // sent with no arguments.
  it("exits to the menu", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await exitToMenu();
    expect(mockedInvoke).toHaveBeenCalledWith("exit_to_menu");
  });

  // Given a new manager and no packages, when a career starts, then the
  // backend gets the manager, the startup options and no package ids.
  it("starts a new game with the manager and startup options", async () => {
    const game = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(game);
    const startupOptions = {
      startYear: 2026,
      startPhase: "seasonStart" as const,
      historyDepthYears: 12,
      developmentSpeedPercent: 100,
    };

    await expect(
      startNewGame({
        firstName: "Ana",
        lastName: "Silva",
        dob: "1980-01-01",
        nationality: "PT",
        startupOptions,
        packageIds: undefined,
      }),
    ).resolves.toBe(game);
    expect(mockedInvoke).toHaveBeenCalledWith("start_new_game", {
      firstName: "Ana",
      lastName: "Silva",
      dob: "1980-01-01",
      nationality: "PT",
      startupOptions,
      packageIds: undefined,
    });
  });

  // Given a club and the competitions to simulate, when the manager takes the
  // job, then the backend gets the club, regions and competitions.
  it("selects a team with its regions and competitions", async () => {
    const game = { manager: { team_id: "team-1" } };
    mockedInvoke.mockResolvedValueOnce(game);

    await expect(selectTeam("team-1", ["europe"], ["eng-1", "eng-cup"])).resolves.toBe(game);
    expect(mockedInvoke).toHaveBeenCalledWith("select_team", {
      teamId: "team-1",
      activeRegionIds: ["europe"],
      activeCompetitionIds: ["eng-1", "eng-cup"],
    });
  });

  // Given saved careers, when the load menu opens, then the saves are listed.
  it("lists the saves", async () => {
    const saves = [{ id: "save-1" }];
    mockedInvoke.mockResolvedValueOnce(saves);

    await expect(listSaves()).resolves.toBe(saves);
    expect(mockedInvoke).toHaveBeenCalledWith("get_saves");
  });

  // Given a save id, when it is loaded, then the manager's name comes back.
  it("loads a save by id", async () => {
    mockedInvoke.mockResolvedValueOnce("Ana Silva");

    await expect(loadGame("save-1")).resolves.toBe("Ana Silva");
    expect(mockedInvoke).toHaveBeenCalledWith("load_game", { saveId: "save-1" });
  });

  // Given a save id, when it is deleted, then the backend says whether it was.
  it("deletes a save by id", async () => {
    mockedInvoke.mockResolvedValueOnce(true);

    await expect(deleteSave("save-1")).resolves.toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith("delete_save", { saveId: "save-1" });
  });
});
