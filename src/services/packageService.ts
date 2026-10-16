import { invoke } from "./transport";

import type { PackageInfo, StackConflictInfo } from "../components/menu/WorldSelect";

/** Every world package installed on this machine. */
export async function listInstalledPackages(): Promise<PackageInfo[]> {
  return invoke<PackageInfo[]>("list_installed_packages");
}

/** Install the `.ofm` file at `path`. Rejects with a `be.error.*` key on a bad package. */
export async function installPackage(path: string): Promise<PackageInfo> {
  return invoke<PackageInfo>("install_package", { path });
}

/** Remove an installed package. */
export async function uninstallPackage(id: string): Promise<void> {
  return invoke<void>("uninstall_package", { id });
}

/** The clashes between packages if they were stacked into one world, in this order. */
export async function checkPackageStack(packageIds: string[]): Promise<StackConflictInfo[]> {
  return invoke<StackConflictInfo[]>("check_package_stack", { packageIds });
}
