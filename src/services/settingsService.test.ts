import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { clearAllSaves, exportWorldDatabase, getSettings, saveSettings } from "./settingsService";
import type { AppSettings } from "../store/settingsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const settings: AppSettings = {
  theme: "light",
  language: "vi",
  currency: "GBP",
  default_match_mode: "spectator",
  auto_save: false,
  auto_save_interval_minutes: 15,
  match_speed: "fast",
  show_match_commentary: false,
  confirm_advance: true,
  continue_to_next_event: true,
  ui_scale: "large",
  high_contrast: true,
};

describe("settingsService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given stored settings, when they are fetched, then the backend is asked
  // with no arguments and the response is handed back unchanged.
  it("fetches the settings", async () => {
    const response = { settings: {}, currency: {}, supported_currencies: [] };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(getSettings()).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("get_settings");
  });

  // Given changed settings, when they are saved, then the backend gets all of them.
  it("saves the settings", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await saveSettings(settings);
    expect(mockedInvoke).toHaveBeenCalledWith("save_settings", { settings });
  });

  // Given the backend cannot write, when settings are saved, then the failure
  // reaches the caller so the store can roll back.
  it("passes a failed save through", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("disk full"));

    await expect(saveSettings(settings)).rejects.toThrow("disk full");
  });

  // Given saved careers, when they are cleared, then the command is sent with no arguments.
  it("clears every save", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await clearAllSaves();
    expect(mockedInvoke).toHaveBeenCalledWith("clear_all_saves");
  });

  // Given a file name, when the world is exported, then the backend gets it and
  // the full written path comes back.
  it("exports the world database", async () => {
    mockedInvoke.mockResolvedValueOnce("/data/exported_world.json");

    await expect(exportWorldDatabase("exported_world.json")).resolves.toBe(
      "/data/exported_world.json",
    );
    expect(mockedInvoke).toHaveBeenCalledWith("export_world_database", {
      exportPath: "exported_world.json",
    });
  });
});
