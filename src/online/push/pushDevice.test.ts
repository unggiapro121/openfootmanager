import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  askForPushOnce,
  enablePush,
  openedOutboxId,
  registerPushDevice,
  usePushAsk,
} from "./pushDevice";

let mobile = true;
vi.mock("../../lib/platform", () => ({
  isMobileBuild: () => mobile,
  mobilePlatform: () => "android",
}));

const plugin = vi.hoisted(() => ({
  pushPermissionState: vi.fn(),
  requestPushPermission: vi.fn(),
  pushToken: vi.fn(),
  pushInstallationId: () => "01a16f79-3126-72e0-b2d1-325f38ddce77",
}));
vi.mock("../../services/onlinePushService", () => plugin);

const server = vi.hoisted(() => ({
  registerDevice: vi.fn(),
  reportPermission: vi.fn(),
}));
vi.mock("../client", () => ({ online: { push: server } }));

vi.mock("../../i18n", () => ({ default: { resolvedLanguage: "vi", language: "vi" } }));

describe("push on the phone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mobile = true;
    usePushAsk.setState({ open: false });
    server.registerDevice.mockResolvedValue(null);
    server.reportPermission.mockResolvedValue(null);
  });

  describe("registerPushDevice", () => {
    // Given a phone that lets the app notify and a token from the platform,
    // when the app opens or comes back,
    // then the installation registers its token, language and clock offset.
    it("registers the installation when allowed", async () => {
      plugin.pushPermissionState.mockResolvedValue("granted");
      plugin.pushToken.mockResolvedValue("token-1");

      expect(await registerPushDevice()).toBe(true);

      expect(server.registerDevice).toHaveBeenCalledWith(
        "01a16f79-3126-72e0-b2d1-325f38ddce77",
        expect.objectContaining({
          platform: "android",
          token: "token-1",
          locale: "vi",
          utcOffsetMinutes: -new Date().getTimezoneOffset(),
        }),
      );
    });

    // Given a phone that has not allowed the app, or the desktop,
    // when the app opens,
    // then no token is asked for and nothing is registered.
    it("does nothing without the permission or on the desktop", async () => {
      plugin.pushPermissionState.mockResolvedValue("prompt");
      expect(await registerPushDevice()).toBe(false);
      mobile = false;
      expect(await registerPushDevice()).toBe(false);
      expect(plugin.pushToken).not.toHaveBeenCalled();
      expect(server.registerDevice).not.toHaveBeenCalled();
    });
  });

  describe("askForPushOnce", () => {
    // Given a coach on the phone who has never been asked,
    // when his first bid or line-up save succeeds, and then another,
    // then the explanation opens the first time only.
    it("opens the explanation once", () => {
      askForPushOnce();
      expect(usePushAsk.getState().open).toBe(true);
      usePushAsk.getState().settle();
      askForPushOnce();
      expect(usePushAsk.getState().open).toBe(false);
    });

    // Given the desktop app,
    // when a bid succeeds,
    // then nothing is asked.
    it("never asks on the desktop", () => {
      mobile = false;
      askForPushOnce();
      expect(usePushAsk.getState().open).toBe(false);
    });
  });

  describe("enablePush", () => {
    // Given the coach who chose to turn notifications on,
    // when the system dialog is answered yes, and later he turns them on again,
    // then the answer is reported once per install and the phone registers.
    it("asks the system, reports once and registers", async () => {
      plugin.requestPushPermission.mockResolvedValue("granted");
      plugin.pushPermissionState.mockResolvedValue("granted");
      plugin.pushToken.mockResolvedValue("token-1");

      expect(await enablePush()).toBe("granted");
      expect(await enablePush()).toBe("granted");

      expect(server.reportPermission).toHaveBeenCalledTimes(1);
      expect(server.reportPermission).toHaveBeenCalledWith(true);
      expect(server.registerDevice).toHaveBeenCalledTimes(2);
    });

    // Given the coach who refused in the system dialog,
    // when the answer comes back,
    // then the refusal is reported and nothing is registered.
    it("reports a refusal and registers nothing", async () => {
      plugin.requestPushPermission.mockResolvedValue("denied");

      expect(await enablePush()).toBe("denied");

      expect(server.reportPermission).toHaveBeenCalledWith(false);
      expect(server.registerDevice).not.toHaveBeenCalled();
    });

    // Given a report that fails to reach the server,
    // when the coach turns notifications on again later,
    // then the report is sent then.
    it("sends the report again after a failure", async () => {
      plugin.requestPushPermission.mockResolvedValue("denied");
      server.reportPermission.mockRejectedValueOnce(new Error("offline"));

      await enablePush();
      await enablePush();

      expect(server.reportPermission).toHaveBeenCalledTimes(2);
    });
  });

  describe("openedOutboxId", () => {
    // Given an opened push's data,
    // when its outbox id is read,
    // then only a UUID comes back.
    it("takes only a UUID", () => {
      expect(openedOutboxId({ outboxId: "01a16f79-3126-72e0-b2d1-325f38ddce88" })).toBe(
        "01a16f79-3126-72e0-b2d1-325f38ddce88",
      );
      expect(openedOutboxId({ outboxId: "../x" })).toBeUndefined();
      expect(openedOutboxId({})).toBeUndefined();
    });
  });
});
