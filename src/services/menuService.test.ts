import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  deleteManagerProfile,
  getManagerProfiles,
  saveManagerProfile,
  touchManagerProfile,
  updateManagerProfile,
} from "./menuService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const details = {
  firstName: "Ana",
  lastName: "Silva",
  dob: "1980-01-01",
  nationality: "PT",
};

describe("menuService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given saved profiles, when the menu opens, then they are fetched with no arguments.
  it("fetches the manager profiles", async () => {
    const profiles = [{ id: "profile-1" }];
    mockedInvoke.mockResolvedValueOnce(profiles);

    await expect(getManagerProfiles()).resolves.toBe(profiles);
    expect(mockedInvoke).toHaveBeenCalledWith("get_manager_profiles");
  });

  // Given a chosen profile, when it is touched, then the backend gets its id.
  it("touches a profile by id", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await touchManagerProfile("profile-1");
    expect(mockedInvoke).toHaveBeenCalledWith("touch_manager_profile", { id: "profile-1" });
  });

  // Given edited details, when a profile is updated, then the backend gets the
  // id with every detail, and an unknown id resolves to null.
  it("updates a profile with its id and details", async () => {
    mockedInvoke.mockResolvedValueOnce(null);

    await expect(updateManagerProfile("profile-1", details)).resolves.toBeNull();
    expect(mockedInvoke).toHaveBeenCalledWith("update_manager_profile", {
      id: "profile-1",
      ...details,
    });
  });

  // Given a profile id, when it is deleted, then the backend says whether it was.
  it("deletes a profile by id", async () => {
    mockedInvoke.mockResolvedValueOnce(true);

    await expect(deleteManagerProfile("profile-1")).resolves.toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith("delete_manager_profile", { id: "profile-1" });
  });

  // Given new details and no force, when the profile is saved, then the
  // backend gets the details with force left undefined.
  it("saves a profile without forcing a new one", async () => {
    const saved = { id: "profile-2" };
    mockedInvoke.mockResolvedValueOnce(saved);

    await expect(saveManagerProfile(details, undefined)).resolves.toBe(saved);
    expect(mockedInvoke).toHaveBeenCalledWith("save_manager_profile", {
      ...details,
      force: undefined,
    });
  });

  // Given the player chose "save as new", when the profile is saved, then the
  // backend is told to force a new one.
  it("saves a profile forcing a new one", async () => {
    mockedInvoke.mockResolvedValueOnce({ id: "profile-3" });

    await saveManagerProfile(details, true);
    expect(mockedInvoke).toHaveBeenCalledWith("save_manager_profile", {
      ...details,
      force: true,
    });
  });
});
