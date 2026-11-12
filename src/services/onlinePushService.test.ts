import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { type OnlineRequest, setOnlineTransport } from "./onlineTransport";
import {
  forgetPushDevice,
  onPushEvent,
  openPushSettings,
  pushInstallationId,
  pushPermissionState,
  pushToken,
  requestPushPermission,
  takeOpenedPush,
} from "./onlinePushService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn(),
}));

let mobile = true;
vi.mock("../lib/platform", () => ({ isMobileBuild: () => mobile }));

const mockedInvoke = vi.mocked(invoke);
const mockedListener = vi.mocked(addPluginListener);
const KEY = "ofm.push.installationId";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("onlinePushService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedListener.mockReset();
    localStorage.clear();
    mobile = true;
  });

  // Given the push plugin on the phone (M3c2),
  // when the app reads the permission, asks for it, reads the token, takes the push it was
  // opened from and opens the phone's settings,
  // then each is the plugin's own command and its answer comes back as it is.
  it("calls the plugin's five commands", async () => {
    mockedInvoke
      .mockResolvedValueOnce("prompt")
      .mockResolvedValueOnce("granted")
      .mockResolvedValueOnce("token-1")
      .mockResolvedValueOnce({ kind: "dailyGift" })
      .mockResolvedValueOnce(null);

    expect(await pushPermissionState()).toBe("prompt");
    expect(await requestPushPermission()).toBe("granted");
    expect(await pushToken()).toBe("token-1");
    expect(await takeOpenedPush()).toEqual({ kind: "dailyGift" });
    await openPushSettings();

    expect(mockedInvoke.mock.calls.map(([command]) => command)).toEqual([
      "plugin:ofm-push|permission_state",
      "plugin:ofm-push|request_permission",
      "plugin:ofm-push|token",
      "plugin:ofm-push|take_opened",
      "plugin:ofm-push|open_settings",
    ]);
  });

  // Given the plugin's "opened" event,
  // when the app listens and later stops,
  // then the handler runs on the event and the plugin's listener is removed.
  it("listens to a plugin event and stops", async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    let fire: (() => void) | undefined;
    mockedListener.mockImplementation((_plugin, _event, callback) => {
      fire = () => (callback as (payload: unknown) => void)({});
      return Promise.resolve({ unregister } as never);
    });
    const handler = vi.fn();

    const stop = await onPushEvent("opened", handler);
    fire?.();
    stop();

    expect(mockedListener).toHaveBeenCalledWith("ofm-push", "opened", expect.any(Function));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalled();
  });

  // Given a fresh install,
  // when the installation id is read twice,
  // then it is one UUID, made once and kept.
  it("makes the installation id once and keeps it", () => {
    const first = pushInstallationId();
    expect(first).toMatch(UUID);
    expect(pushInstallationId()).toBe(first);
    expect(localStorage.getItem(KEY)).toBe(first);
  });

  // Given a stored installation id that is not a UUID (storage tampered with or broken),
  // when it is read,
  // then a new UUID replaces it.
  it("replaces a stored id that is not a UUID", () => {
    localStorage.setItem(KEY, "../x");
    expect(pushInstallationId()).toMatch(UUID);
  });

  // Given storage that throws (a private webview),
  // when the installation id is read,
  // then a UUID still comes back.
  it("still gives an id when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(pushInstallationId()).toMatch(UUID);
    spy.mockRestore();
  });

  describe("forgetPushDevice", () => {
    const sent: OnlineRequest[] = [];
    let restore: () => void = () => undefined;
    beforeEach(() => {
      sent.length = 0;
      restore = setOnlineTransport({
        request: <T>(request: OnlineRequest) => {
          sent.push(request);
          return Promise.resolve({ status: 204, body: null as T });
        },
      });
    });
    afterEach(() => restore());

    // Given a phone whose installation registered,
    // when the coach logs out,
    // then the installation is forgotten on the server with a DELETE and no key.
    it("deletes the registered installation", async () => {
      const id = pushInstallationId();
      await forgetPushDevice();
      expect(sent).toEqual([{ method: "DELETE", segments: ["v1", "me", "push-devices", id] }]);
    });

    // Given the desktop app, or a phone that never made an installation id,
    // when the coach logs out,
    // then nothing is sent.
    it("sends nothing on the desktop or without an id", async () => {
      await forgetPushDevice();
      mobile = false;
      pushInstallationId();
      await forgetPushDevice();
      expect(sent).toEqual([]);
    });
  });
});
