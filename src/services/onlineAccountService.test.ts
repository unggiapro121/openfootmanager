import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { requestAccountDeletion } from "./onlineAccountService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("onlineAccountService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given a coach confirming the deletion of his account with his password (M3c1),
  // when it is asked,
  // then the session's command gets the password and the action's key, and the day comes back.
  it("asks the session to delete the account", async () => {
    mockedInvoke.mockResolvedValue({ deleteAt: "2026-11-19T10:00:00Z" });

    const view = await requestAccountDeletion("mot mat khau dai", "key-1");

    expect(view).toEqual({ deleteAt: "2026-11-19T10:00:00Z" });
    expect(mockedInvoke).toHaveBeenCalledWith("request_coach_account_deletion", {
      password: "mot mat khau dai",
      idempotencyKey: "key-1",
    });
  });
});
