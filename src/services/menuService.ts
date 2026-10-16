import { invoke } from "./transport";

import type { ManagerProfile } from "../components/menu/types";

/** The manager identity a profile stores. */
export interface ManagerProfileDetails {
  firstName: string;
  lastName: string;
  dob: string;
  nationality: string;
}

/** Every saved manager profile, most recently used first. */
export async function getManagerProfiles(): Promise<ManagerProfile[]> {
  return invoke<ManagerProfile[]>("get_manager_profiles");
}

/** Mark a profile as just used, so it sorts first next time. */
export async function touchManagerProfile(id: string): Promise<void> {
  return invoke<void>("touch_manager_profile", { id });
}

/** Overwrite a profile's details. Resolves to null when no profile has that id. */
export async function updateManagerProfile(
  id: string,
  details: ManagerProfileDetails,
): Promise<ManagerProfile | null> {
  return invoke<ManagerProfile | null>("update_manager_profile", {
    id,
    firstName: details.firstName,
    lastName: details.lastName,
    dob: details.dob,
    nationality: details.nationality,
  });
}

/** Delete a profile. Resolves to whether one was removed. */
export async function deleteManagerProfile(id: string): Promise<boolean> {
  return invoke<boolean>("delete_manager_profile", { id });
}

/**
 * Save a profile for these details. The backend reuses a matching profile
 * unless `force` is true, which always creates a new one.
 */
export async function saveManagerProfile(
  details: ManagerProfileDetails,
  force: true | undefined,
): Promise<ManagerProfile> {
  return invoke<ManagerProfile>("save_manager_profile", {
    firstName: details.firstName,
    lastName: details.lastName,
    dob: details.dob,
    nationality: details.nationality,
    force,
  });
}
