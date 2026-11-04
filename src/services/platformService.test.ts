import { beforeEach, describe, expect, it, vi } from "vitest";

const { platform } = vi.hoisted(() => {
  const appWindow = {
    setTitle: vi.fn(async (_title: string) => {}),
    onCloseRequested: vi.fn(async (_handler: unknown) => () => {}),
    destroy: vi.fn(async () => {}),
  };
  return {
    platform: {
      appWindow,
      isTauri: vi.fn(() => true),
      convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
      appDataDir: vi.fn(async () => "/home/u/.local/share/app"),
      listen: vi.fn(async (_event: string, _handler: unknown) => () => {}),
      unregister: vi.fn(async () => {}),
      onBackButtonPress: vi.fn(async (_handler: () => void) => ({
        unregister: () => platform.unregister(),
      })),
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => platform.isTauri(),
  convertFileSrc: (path: string) => platform.convertFileSrc(path),
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => platform.appDataDir(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: unknown) => platform.listen(event, handler),
}));
vi.mock("@tauri-apps/api/app", () => ({
  onBackButtonPress: (handler: () => void) => platform.onBackButtonPress(handler),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => platform.appWindow,
}));

import {
  appDataDirectory,
  destroyWindow,
  isDesktopApp,
  localFileUrl,
  onBackendEvent,
  onPhoneBackButton,
  onWindowCloseRequested,
  setWindowTitle,
} from "./platformService";

describe("platformService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Given the Android app, when a screen listens to the phone's Back, then the platform's Back
  // event reaches the handler, and the function that comes back stops listening (phase 5).
  it("listens to the phone's Back button", async () => {
    const handler = vi.fn();
    const stop = await onPhoneBackButton(handler);
    const [registered] = platform.onBackButtonPress.mock.calls[0];
    registered();
    expect(handler).toHaveBeenCalledTimes(1);

    stop();
    expect(platform.unregister).toHaveBeenCalledTimes(1);
  });

  // Given the app runs in a plain browser, when it asks whether it is the
  // desktop app, then the answer is no.
  it("reports a browser as not the desktop app", () => {
    platform.isTauri.mockReturnValueOnce(false);

    expect(isDesktopApp()).toBe(false);
  });

  // Given the desktop shell, when the app data directory is requested, then
  // the platform's directory comes back.
  it("resolves the app data directory", async () => {
    await expect(appDataDirectory()).resolves.toBe("/home/u/.local/share/app");
  });

  // Given no app data directory, when it is requested, then the failure
  // reaches the caller, which falls back to generated artwork.
  it("passes a missing app data directory through", async () => {
    platform.appDataDir.mockRejectedValueOnce(new Error("no app data dir"));

    await expect(appDataDirectory()).rejects.toThrow("no app data dir");
  });

  // Given a file on disk, when an image URL is needed, then it goes through
  // the asset protocol.
  it("turns a file path into an asset protocol url", () => {
    expect(localFileUrl("/data/pkg/logo.png")).toBe("asset://localhost//data/pkg/logo.png");
    expect(platform.convertFileSrc).toHaveBeenCalledWith("/data/pkg/logo.png");
  });

  // Given a handler, when the app subscribes to a backend event, then the same
  // event name and handler are registered and the unlisten function comes back.
  it("subscribes to a backend event by name", async () => {
    const unlisten = vi.fn();
    platform.listen.mockResolvedValueOnce(unlisten);
    const handler = vi.fn();

    await expect(onBackendEvent("game-state-changed", handler)).resolves.toBe(unlisten);
    expect(platform.listen).toHaveBeenCalledWith("game-state-changed", handler);
  });

  // Given a title, when it is applied, then the current window's title is set.
  it("sets the window title", async () => {
    await setWindowTitle("Openfoot Manager 1.0");

    expect(platform.appWindow.setTitle).toHaveBeenCalledWith("Openfoot Manager 1.0");
  });

  // Given a handler, when the app watches for close requests, then the current
  // window registers it and the unlisten function comes back.
  it("watches the window's close requests", async () => {
    const unlisten = vi.fn();
    platform.appWindow.onCloseRequested.mockResolvedValueOnce(unlisten);
    const handler = vi.fn();

    await expect(onWindowCloseRequested(handler)).resolves.toBe(unlisten);
    expect(platform.appWindow.onCloseRequested).toHaveBeenCalledWith(handler);
  });

  // Given the player confirmed quitting, when the window is destroyed, then the
  // current window is destroyed.
  it("destroys the window", async () => {
    await destroyWindow();

    expect(platform.appWindow.destroy).toHaveBeenCalledTimes(1);
  });
});
