import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  claimSaveForCoach,
  createCoachAccount,
  deleteCoachAccount,
  getActiveCoachAccount,
  getCoachProgress,
  listCoachAccounts,
  loginCoachAccount,
  logoutCoachAccount,
  updateCoachAccount,
  type CoachIdentity,
} from "./coachService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const identity: CoachIdentity = {
  first_name: "Dung",
  last_name: "Ung",
  date_of_birth: "1990-05-01",
  nationality: "VN",
  region: "AsiaSoutheast",
};

describe("coachService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given accounts on this machine, when the login screen opens, then they are listed.
  it("lists the coach accounts", async () => {
    const accounts = [{ id: "a-1" }];
    mockedInvoke.mockResolvedValueOnce(accounts);

    await expect(listCoachAccounts()).resolves.toBe(accounts);
    expect(mockedInvoke).toHaveBeenCalledWith("list_coach_accounts");
  });

  // Given a filled form, when an account is made, then the backend gets the identity as one object.
  it("creates an account from an identity", async () => {
    mockedInvoke.mockResolvedValueOnce({ id: "a-1" });

    await createCoachAccount(identity);

    expect(mockedInvoke).toHaveBeenCalledWith("create_coach_account", { identity });
  });

  // Given an account, when it is edited, then the backend gets its id and the new identity.
  it("updates an account by id", async () => {
    mockedInvoke.mockResolvedValueOnce({ id: "a-1" });

    await updateCoachAccount("a-1", identity);

    expect(mockedInvoke).toHaveBeenCalledWith("update_coach_account", { id: "a-1", identity });
  });

  // Given an account, when the player logs in, out, or deletes it, then the backend gets the call.
  it("logs in, logs out and deletes by id", async () => {
    mockedInvoke.mockResolvedValue(undefined);

    await loginCoachAccount("a-1");
    await logoutCoachAccount();
    await deleteCoachAccount("a-1");

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "login_coach_account", { id: "a-1" });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "logout_coach_account");
    expect(mockedInvoke).toHaveBeenNthCalledWith(3, "delete_coach_account", { id: "a-1" });
  });

  // Given a logged-in account, when the menu or the manager screen asks, then it reads it and its progress.
  it("reads the active account and its progress", async () => {
    mockedInvoke.mockResolvedValueOnce(null).mockResolvedValueOnce({ counted_today: 3 });

    await expect(getActiveCoachAccount()).resolves.toBeNull();
    await expect(getCoachProgress()).resolves.toEqual({ counted_today: 3 });
    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "get_active_coach_account");
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "get_coach_progress");
  });

  // Given a save from before accounts, when the player attaches it, then the backend gets its id.
  it("claims a save by id", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await claimSaveForCoach("save-1");

    expect(mockedInvoke).toHaveBeenCalledWith("claim_save_for_coach", { saveId: "save-1" });
  });
});
