import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18nReady } from "../../../i18n";
import NotificationsCard from "./NotificationsCard";

const plugin = vi.hoisted(() => ({
  pushPermissionState: vi.fn(),
  openPushSettings: vi.fn(),
}));
vi.mock("../../../services/onlinePushService", () => plugin);

const device = vi.hoisted(() => ({ enablePush: vi.fn() }));
vi.mock("../../push/pushDevice", () => device);

const server = vi.hoisted(() => ({ settings: vi.fn(), setSettings: vi.fn() }));
vi.mock("../../client", () => ({ online: { push: server } }));

const ALL_ON = {
  matchSoon: true,
  outbid: true,
  auctionEnding: true,
  auctionResult: true,
  dailyGift: true,
};

describe("NotificationsCard", () => {
  beforeAll(async () => {
    await i18nReady;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    server.settings.mockResolvedValue({ kinds: ALL_ON });
    server.setSettings.mockImplementation((view: unknown) => Promise.resolve(view));
    plugin.pushPermissionState.mockResolvedValue("granted");
    plugin.openPushSettings.mockResolvedValue(undefined);
    device.enablePush.mockResolvedValue("granted");
  });

  // Given a coach whose phone shows the app's pushes,
  // when the card opens,
  // then it shows the five kinds as switches, as the server has them, and nothing about how
  // many come or when.
  it("shows the five switches and nothing else", async () => {
    server.settings.mockResolvedValue({ kinds: { ...ALL_ON, outbid: false } });
    render(<NotificationsCard />);

    const card = await screen.findByRole("region", { name: "Notifications" });
    const switches = await within(card).findAllByRole("switch");
    expect(switches).toHaveLength(5);
    expect(within(card).getByRole("switch", { name: "Outbid in an auction" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(within(card).getByRole("switch", { name: "Daily gift waiting" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(card.textContent ?? "").not.toMatch(/\d/);
  });

  // Given the card open,
  // when the coach turns one kind off,
  // then all five are sent, that one off.
  it("sends all five kinds on every change", async () => {
    render(<NotificationsCard />);

    fireEvent.click(await screen.findByRole("switch", { name: "Match about to start" }));

    await waitFor(() =>
      expect(server.setSettings).toHaveBeenCalledWith({ kinds: { ...ALL_ON, matchSoon: false } }),
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Match about to start" })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
  });

  // Given a server that refuses the change,
  // when the coach turns a kind off,
  // then the switch stays as it was and the reason shows.
  it("keeps the switch and shows why when the change fails", async () => {
    server.setSettings.mockRejectedValue({ status: 0, code: "be.error.online.offline" });
    render(<NotificationsCard />);

    fireEvent.click(await screen.findByRole("switch", { name: "Outbid in an auction" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Outbid in an auction" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  // Given a coach who chose "Later" before,
  // when he opens the card and turns notifications on,
  // then the system is asked and the line goes once allowed.
  it("turns notifications on when the system may still ask", async () => {
    plugin.pushPermissionState.mockResolvedValue("prompt");
    render(<NotificationsCard />);

    expect(await screen.findByText("Notifications are not on yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));

    await waitFor(() => expect(device.enablePush).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Notifications are not on yet.")).toBeNull());
  });

  // Given a phone where the coach refused the app's pushes,
  // when the card opens, he opens the settings, and comes back having allowed them,
  // then the line says so, the settings open, and the line goes on his return.
  it("sends the coach to the phone's settings after a refusal", async () => {
    plugin.pushPermissionState.mockResolvedValue("denied");
    render(<NotificationsCard />);

    expect(await screen.findByText("Turned off in the phone's settings.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(plugin.openPushSettings).toHaveBeenCalled();

    plugin.pushPermissionState.mockResolvedValue("granted");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() =>
      expect(screen.queryByText("Turned off in the phone's settings.")).toBeNull(),
    );
  });
});
