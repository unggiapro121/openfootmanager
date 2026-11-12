import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18nReady } from "../../../i18n";
import { usePushAsk } from "../../push/pushDevice";
import { PushWatcher } from "./PushWatcher";

let mobile = true;
vi.mock("../../../lib/platform", () => ({
  isMobileBuild: () => mobile,
  mobilePlatform: () => "android",
}));

const events = vi.hoisted(() => ({ handlers: new Map<string, () => void>() }));
const plugin = vi.hoisted(() => ({
  takeOpenedPush: vi.fn(),
  pushPermissionState: vi.fn(),
  onPushEvent: vi.fn(),
}));
vi.mock("../../../services/onlinePushService", () => plugin);

const device = vi.hoisted(() => ({ registerPushDevice: vi.fn(), enablePush: vi.fn() }));
vi.mock("../../push/pushDevice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push/pushDevice")>()),
  registerPushDevice: device.registerPushDevice,
  enablePush: device.enablePush,
}));

const server = vi.hoisted(() => ({ opened: vi.fn() }));
vi.mock("../../client", () => ({ online: { push: server } }));

const FIXTURE = "01a16f79-3126-72e0-b2d1-325f38ddce11";
const OUTBOX = "01a16f79-3126-72e0-b2d1-325f38ddce88";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderWatcher() {
  return render(
    <MemoryRouter initialEntries={["/online"]}>
      <PushWatcher />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PushWatcher", () => {
  beforeAll(async () => {
    await i18nReady;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mobile = true;
    events.handlers.clear();
    usePushAsk.setState({ open: false });
    plugin.takeOpenedPush.mockResolvedValue(null);
    plugin.pushPermissionState.mockResolvedValue("prompt");
    plugin.onPushEvent.mockImplementation((event: string, handler: () => void) => {
      events.handlers.set(event, handler);
      return Promise.resolve(() => events.handlers.delete(event));
    });
    device.registerPushDevice.mockResolvedValue(true);
    device.enablePush.mockResolvedValue("granted");
    server.opened.mockResolvedValue(null);
  });

  // Given the coach's session back on the phone,
  // when the online mode opens,
  // then the phone registers its installation.
  it("registers the phone when the online mode opens", async () => {
    renderWatcher();
    await waitFor(() => expect(device.registerPushDevice).toHaveBeenCalled());
  });

  // Given the app opened from a match-soon push,
  // when the session is back,
  // then the push is counted opened and the line-up opens (P5-45).
  it("opens the line-up from the match-soon push the app was opened from", async () => {
    plugin.takeOpenedPush.mockResolvedValue({
      kind: "matchSoon",
      outboxId: OUTBOX,
      route: "/online/tactics",
      fixtureId: FIXTURE,
    });
    renderWatcher();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/online/tactics"));
    expect(server.opened).toHaveBeenCalledWith(OUTBOX);
  });

  // Given the app running when the coach taps a daily-gift push,
  // when the plugin says a push was opened,
  // then the inventory opens.
  it("follows a push tapped while the app runs", async () => {
    renderWatcher();
    await waitFor(() => expect(events.handlers.has("opened")).toBe(true));
    plugin.takeOpenedPush.mockResolvedValue({ kind: "dailyGift", outboxId: OUTBOX });
    await act(async () => events.handlers.get("opened")?.());
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/online/inventory"));
  });

  // Given the online mode open on the phone,
  // when the coach moves between screens (here the push's own navigation, then another push),
  // then the phone is registered once, not again on every screen change, and each opening is
  // taken once (P5-45 (4)).
  it("registers once while the coach moves between screens", async () => {
    plugin.takeOpenedPush.mockResolvedValueOnce({ kind: "matchSoon", outboxId: OUTBOX });
    renderWatcher();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/online/tactics"));
    plugin.takeOpenedPush.mockResolvedValueOnce({ kind: "dailyGift", outboxId: OUTBOX });
    await act(async () => events.handlers.get("opened")?.());
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/online/inventory"));

    expect(device.registerPushDevice).toHaveBeenCalledTimes(1);
    expect(plugin.takeOpenedPush).toHaveBeenCalledTimes(2);
    expect(plugin.onPushEvent).toHaveBeenCalledTimes(2);
  });

  // Given a new token from the platform,
  // when the plugin says so,
  // then the phone registers again.
  it("registers again on a new token", async () => {
    renderWatcher();
    await waitFor(() => expect(events.handlers.has("token")).toBe(true));
    device.registerPushDevice.mockClear();
    await act(async () => events.handlers.get("token")?.());
    expect(device.registerPushDevice).toHaveBeenCalled();
  });

  // Given the desktop app,
  // when the online mode opens,
  // then nothing about push runs.
  it("does nothing on the desktop", async () => {
    mobile = false;
    renderWatcher();
    await act(async () => undefined);
    expect(device.registerPushDevice).not.toHaveBeenCalled();
    expect(plugin.takeOpenedPush).not.toHaveBeenCalled();
  });

  describe("the explanation sheet", () => {
    // Given the coach's first successful bid, with the system still able to ask,
    // when he chooses Later,
    // then the sheet closes without the system's question and is not shown again.
    it("closes on Later without asking the system", async () => {
      renderWatcher();
      act(() => usePushAsk.setState({ open: true }));
      fireEvent.click(await screen.findByRole("button", { name: "Later" }));
      await waitFor(() => expect(usePushAsk.getState().open).toBe(false));
      expect(device.enablePush).not.toHaveBeenCalled();
      expect(usePushAsk.getState().open).toBe(false);
      expect(localStorage.getItem("ofm.push.asked")).toBe("1");
    });

    // Given the sheet up,
    // when the coach turns notifications on,
    // then the system is asked and the sheet closes.
    it("asks the system when he turns them on", async () => {
      renderWatcher();
      act(() => usePushAsk.setState({ open: true }));
      fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }));
      expect(device.enablePush).toHaveBeenCalled();
      await waitFor(() => expect(usePushAsk.getState().open).toBe(false));
    });

    // Given a phone that already answered (allowed, or refused for good),
    // when the first bid succeeds,
    // then no sheet shows; the answer is passed on as if he had chosen it.
    it("skips the sheet when the system cannot ask", async () => {
      plugin.pushPermissionState.mockResolvedValue("granted");
      renderWatcher();
      act(() => usePushAsk.setState({ open: true }));
      await waitFor(() => expect(usePushAsk.getState().open).toBe(false));
      expect(device.enablePush).toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
