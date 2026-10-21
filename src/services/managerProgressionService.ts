import { invoke } from "./transport";
import type { ManagerProgressionView } from "../store/types";

/** The user's play style mastery: XP to the next point and each style's real effect. */
export async function getManagerProgression(): Promise<ManagerProgressionView> {
  return invoke<ManagerProgressionView>("get_manager_progression");
}
