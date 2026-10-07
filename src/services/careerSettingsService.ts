import { invoke } from "@tauri-apps/api/core";

import type { GameStateData } from "../store/gameStore";

/**
 * Set how fast players develop in the active career, as a percentage of the realistic pace:
 * 100 is 1×, up to 500 (5×) in steps of 50. The backend refuses anything off that scale.
 */
export async function setDevelopmentSpeed(percent: number): Promise<GameStateData> {
  return invoke<GameStateData>("set_development_speed", { percent });
}
