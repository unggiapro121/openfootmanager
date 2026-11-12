import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  cancelCoachAccountDeletion,
  claimSaveForCoach,
  createCoachAccount,
  deleteCoachAccount,
  getActiveCoachAccount,
  getCoachAccountMode,
  getCoachProgress,
  listCoachAccounts,
  loginCoachAccount,
  loginCoachWithEmail,
  logoutCoachAccount,
  registerCoachAccount,
  requestCoachPasswordReset,
  resendCoachVerification,
  resetCoachPassword,
  resumeCoachSession,
  updateCoachAccount,
  verifyCoachEmail,
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

  // Given the game starts, when the login screen opens, then it asks where the accounts live.
  it("reads the account mode", async () => {
    mockedInvoke.mockResolvedValueOnce("server");

    await expect(getCoachAccountMode()).resolves.toBe("server");
    expect(mockedInvoke).toHaveBeenCalledWith("get_coach_account_mode");
  });

  // Given the registration form, when it is sent, then the backend gets email, password and identity as one object.
  it("registers an account on the server", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    const registration = { email: "coach@example.test", password: "mot mat khau dai", identity };

    await registerCoachAccount(registration);

    expect(mockedInvoke).toHaveBeenCalledWith("register_coach_account", { registration });
  });

  // Given the server flows, when each is used, then the backend gets its command and arguments.
  it("sends codes, logins and password resets to the backend", async () => {
    mockedInvoke.mockResolvedValue(undefined);

    await verifyCoachEmail("ABC123");
    await resendCoachVerification("coach@example.test");
    await loginCoachWithEmail("coach@example.test", "mot mat khau dai");
    await resumeCoachSession();
    await requestCoachPasswordReset("coach@example.test");
    await resetCoachPassword("XYZ789", "mot mat khau moi");

    expect(mockedInvoke.mock.calls).toEqual([
      ["verify_coach_email", { code: "ABC123" }],
      ["resend_coach_verification", { email: "coach@example.test" }],
      ["login_coach_with_email", { email: "coach@example.test", password: "mot mat khau dai" }],
      ["resume_coach_session"],
      ["request_coach_password_reset", { email: "coach@example.test" }],
      ["reset_coach_password", { code: "XYZ789", newPassword: "mot mat khau moi" }],
    ]);
  });

  // Given an account waiting to be deleted (M3c1),
  // when the login screen cancels the deletion,
  // then the backend gets the email and password to name it by.
  it("cancels a pending deletion with the email and password", async () => {
    mockedInvoke.mockResolvedValue(undefined);

    await cancelCoachAccountDeletion("coach@example.test", "mot mat khau dai");

    expect(mockedInvoke).toHaveBeenCalledWith("cancel_coach_account_deletion", {
      email: "coach@example.test",
      password: "mot mat khau dai",
    });
  });
});
