import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const convertFileSrc = vi.fn((path: string) => `asset://localhost/${path}`);
const appDataDir = vi.fn(async () => "/home/u/.local/share/app");
const invoke = vi.fn(async (..._args: unknown[]) => "data:image/png;base64,SAKA");

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => convertFileSrc(path),
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => appDataDir(),
}));

import {
  ProjectAssetDirContext,
  resetPackageAssetRoot,
  usePackageAssetSrc,
} from "./usePackageAssetSrc";

describe("usePackageAssetSrc", () => {
  beforeEach(() => {
    resetPackageAssetRoot();
    convertFileSrc.mockClear();
    appDataDir.mockClear();
  });

  it("routes a package asset through the asset protocol", async () => {
    // This is the fix: an authored badge used to arrive as a bare relative path
    // into a deleted temp directory, so every club fell back to a crest.
    const { result } = renderHook(() => usePackageAssetSrc("brazil-1962/assets/images/santos.png"));

    await waitFor(() => {
      expect(result.current).toBe(
        "asset://localhost//home/u/.local/share/app/package-assets/brazil-1962/assets/images/santos.png",
      );
    });
  });

  it("serves a bundled asset directly, without the protocol", async () => {
    const { result } = renderHook(() => usePackageAssetSrc("assets/worlds/demo/logo.png"));

    expect(result.current).toBe("/assets/worlds/demo/logo.png");
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it("resolves the app data directory once across many images", async () => {
    const first = renderHook(() => usePackageAssetSrc("pkg/assets/a.png"));
    const second = renderHook(() => usePackageAssetSrc("pkg/assets/b.png"));

    await waitFor(() => {
      expect(first.result.current).not.toBeNull();
      expect(second.result.current).not.toBeNull();
    });
    expect(appDataDir).toHaveBeenCalledTimes(1);
  });

  it("falls back to nothing when the directory cannot be resolved", async () => {
    appDataDir.mockRejectedValueOnce(new Error("no app data dir"));

    const { result } = renderHook(() => usePackageAssetSrc("pkg/assets/a.png"));

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("retries the directory lookup after a failed one", async () => {
    // Deliberately no resetPackageAssetRoot between the two renders: a rejected
    // promise is still truthy, so caching it would disable every package badge
    // and photo for the rest of the session.
    appDataDir.mockRejectedValueOnce(new Error("transient"));

    const failed = renderHook(() => usePackageAssetSrc("pkg/assets/a.png"));
    await waitFor(() => expect(failed.result.current).toBeNull());

    const retried = renderHook(() => usePackageAssetSrc("pkg/assets/b.png"));

    await waitFor(() => {
      expect(retried.result.current).toBe(
        "asset://localhost//home/u/.local/share/app/package-assets/pkg/assets/b.png",
      );
    });
  });

  it("returns nothing for an empty path", () => {
    const { result } = renderHook(() => usePackageAssetSrc(null));

    expect(result.current).toBeNull();
  });

  // Given a package project open in the world editor, when one of its assets
  // is shown, then it is read from the project folder rather than taken for an
  // asset bundled with the app, whose `assets/` paths look the same.
  it("reads a package asset from the project being edited", async () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ProjectAssetDirContext.Provider, { value: "/projects/world" }, children);
    const { result } = renderHook(() => usePackageAssetSrc("assets/players/saka.png"), {
      wrapper,
    });

    await waitFor(() => expect(result.current).toBe("data:image/png;base64,SAKA"));
    expect(invoke).toHaveBeenCalledWith("read_file_as_data_url", {
      path: "/projects/world/assets/players/saka.png",
      baseDir: "/projects/world",
    });
  });
});
