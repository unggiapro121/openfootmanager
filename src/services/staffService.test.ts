import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { hireStaff, previewStaffContract, releaseStaff, renewStaffContract } from "./staffService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("staffService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("calls the hire staff backend command with the chosen term", async () => {
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(hireStaff("staff-1", 3)).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("hire_staff", {
      staffId: "staff-1",
      contractYears: 3,
    });
  });

  it("calls the release staff backend command", async () => {
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(releaseStaff("staff-2")).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("release_staff", {
      staffId: "staff-2",
    });
  });

  it("calls the renew staff contract backend command with the chosen term", async () => {
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(renewStaffContract("staff-3", 1)).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("renew_staff_contract", {
      staffId: "staff-3",
      contractYears: 1,
    });
  });

  it("asks the backend for a staff contract preview", async () => {
    const preview = { staff_id: "staff-4", asking_wage: 4_200 };
    mockedInvoke.mockResolvedValueOnce(preview);

    await expect(previewStaffContract("staff-4")).resolves.toBe(preview);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_staff_contract", {
      staffId: "staff-4",
    });
  });

  it("passes a backend refusal through to the caller", async () => {
    mockedInvoke.mockRejectedValueOnce("be.error.staffWageBudget?budget=50000");

    await expect(hireStaff("staff-1", 2)).rejects.toBe("be.error.staffWageBudget?budget=50000");
  });
});
