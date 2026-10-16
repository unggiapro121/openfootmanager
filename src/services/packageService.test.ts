import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  checkPackageStack,
  installPackage,
  listInstalledPackages,
  uninstallPackage,
} from "./packageService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("packageService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given installed packages, when they are listed, then the backend is asked
  // with no arguments and the list is handed back unchanged.
  it("lists the installed packages", async () => {
    const packages = [{ id: "real-world" }];
    mockedInvoke.mockResolvedValueOnce(packages);

    await expect(listInstalledPackages()).resolves.toBe(packages);
    expect(mockedInvoke).toHaveBeenCalledWith("list_installed_packages");
  });

  // Given a picked .ofm file, when it is installed, then the backend gets its path.
  it("installs a package from its path", async () => {
    const installed = { id: "real-world" };
    mockedInvoke.mockResolvedValueOnce(installed);

    await expect(installPackage("/tmp/world.ofm")).resolves.toBe(installed);
    expect(mockedInvoke).toHaveBeenCalledWith("install_package", { path: "/tmp/world.ofm" });
  });

  // Given a bad package, when it is installed, then the error key reaches the caller.
  it("passes a refused install's error key through", async () => {
    mockedInvoke.mockRejectedValueOnce("be.error.package.invalid");

    await expect(installPackage("/tmp/bad.ofm")).rejects.toBe("be.error.package.invalid");
  });

  // Given an installed package, when it is removed, then the backend gets its id.
  it("uninstalls a package by id", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await uninstallPackage("real-world");
    expect(mockedInvoke).toHaveBeenCalledWith("uninstall_package", { id: "real-world" });
  });

  // Given two stacked packages, when the stack is checked, then the backend
  // gets their ids in order and its conflicts come back.
  it("checks a package stack in order", async () => {
    const conflicts = [{ severity: "warning", code: "be.warn.package.override" }];
    mockedInvoke.mockResolvedValueOnce(conflicts);

    await expect(checkPackageStack(["base", "patch"])).resolves.toBe(conflicts);
    expect(mockedInvoke).toHaveBeenCalledWith("check_package_stack", {
      packageIds: ["base", "patch"],
    });
  });
});
