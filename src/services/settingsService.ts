import { invoke } from "./transport";

import type { AppSettings, CurrencyDefinition } from "../store/settingsStore";

/** The stored settings, with the currencies the game can show money in. */
export interface SettingsResponse {
  settings: Partial<AppSettings>;
  currency: CurrencyDefinition;
  supported_currencies: CurrencyDefinition[];
}

/** The player's stored settings. */
export async function getSettings(): Promise<SettingsResponse> {
  return invoke<SettingsResponse>("get_settings");
}

/** Store the player's settings. */
export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

/** Delete every saved career on this machine. */
export async function clearAllSaves(): Promise<void> {
  return invoke<void>("clear_all_saves");
}

/** Write the world database out as JSON. Resolves to the full path written. */
export async function exportWorldDatabase(exportPath: string): Promise<string> {
  return invoke<string>("export_world_database", { exportPath });
}
