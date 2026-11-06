import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../hooks/usePhoneLayout";
import { fakeRealtime } from "../../test-utils/onlineMatchKit";
import {
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../test-utils/onlineTestKit";
import type { EventsView } from "../api";
import { useOnlineStore } from "../store/onlineStore";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve() {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": fail(404, "be.error.notFound"),
  });
}

/** A phone-narrow window: the phone query matches, every other one (dark mode…) does not. */
function phoneWindow() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const where = () => screen.getByLabelText("location").textContent;
const tabs = () => screen.getByRole("navigation", { name: "online.nav.tabs" });
const tab = (name: string) => within(tabs()).getByRole("button", { name });

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
  phoneWindow();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.unstubAllGlobals();
});

describe("the online mode on a phone", () => {
  // Given a coach running a club on a phone-narrow window,
  // when the online mode opens,
  // then there is no sidebar: a tab bar at the bottom holds Overview, Team, Matches, Club and
  // More, with Overview current.
  it("swaps the sidebar for a bottom tab bar", async () => {
    serve();
    renderOnline("/online");

    await waitFor(() => expect(tabs()).toBeInTheDocument());
    expect(screen.queryByRole("navigation", { name: "online.nav.label" })).toBeNull();
    const names = within(tabs())
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names).toEqual([
      "online.nav.overview",
      "online.nav.groupTeam",
      "online.nav.groupMatches",
      "online.nav.groupClub",
      "online.nav.groupMore",
    ]);
    expect(tab("online.nav.overview")).toHaveAttribute("aria-current", "page");
  });

  // Given the tab bar,
  // when the coach taps Matches and then Fixtures in the sheet that opens,
  // then the fixtures page opens, the sheet closes, and Matches is the current tab.
  it("opens a group's pages in a sheet", async () => {
    serve();
    renderOnline("/online");

    await waitFor(() => expect(tabs()).toBeInTheDocument());
    fireEvent.click(tab("online.nav.groupMatches"));
    const sheet = screen.getByRole("dialog", { name: "online.nav.groupMatches" });
    expect(tab("online.nav.groupMatches")).toHaveAttribute("aria-expanded", "true");
    expect(
      within(sheet)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(
      expect.arrayContaining(["online.nav.schedule", "online.nav.league", "online.nav.friendly"]),
    );

    fireEvent.click(within(sheet).getByRole("button", { name: "online.nav.schedule" }));
    await waitFor(() => expect(where()).toBe("/online/schedule"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tab("online.nav.groupMatches")).toHaveAttribute("aria-current", "page");
    expect(tab("online.nav.overview")).not.toHaveAttribute("aria-current");
  });

  // Given the More sheet,
  // when it opens,
  // then it lists the coach's own pages (events, shop, inventory, coins, profile) and a way back
  // to the main menu, which the desktop keeps in the header.
  it("keeps the coach's own pages and the main menu under More", async () => {
    serve();
    renderOnline("/online");

    await waitFor(() => expect(tabs()).toBeInTheDocument());
    fireEvent.click(tab("online.nav.groupMore"));
    const sheet = screen.getByRole("dialog", { name: "online.nav.groupMore" });
    for (const name of [
      "online.nav.events",
      "online.nav.shop",
      "online.nav.inventory",
      "online.nav.coins",
      "online.nav.profile",
      "online.nav.mainMenu",
    ]) {
      expect(within(sheet).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  // Given an event with a reward to claim, market news unseen and an academy report unseen,
  // when the coach opens More, Club and Team in turn,
  // then the page each dot on the tab bar is for carries its own count in the sheet: Events,
  // Market and Academy; the other pages carry none.
  it("marks in a sheet the page a tab's dot is for", async () => {
    const events: EventsView = {
      enabled: true,
      events: [
        {
          id: "01a18545-d15e-763c-8b48-934eb05a4757",
          theme: "weekly",
          startsAt: "2000-01-01T00:00:00Z",
          endsAt: "2099-01-01T00:00:00Z",
          claimUntil: "2099-01-01T00:00:00Z",
          state: "running",
          missions: [
            {
              code: "w1",
              kind: "leagueMatchesDirected",
              target: 5,
              progress: 5,
              status: "completed",
              rewards: [{ item: "energyDrinkSmall", quantity: 2 }],
              countsOffline: false,
            },
          ],
        },
      ],
    };
    serve();
    renderOnline("/online");
    await waitFor(() => expect(tabs()).toBeInTheDocument());
    act(() => useOnlineStore.setState({ events, marketUnseen: 2, academyUnseen: true }));

    fireEvent.click(tab("online.nav.groupMore (1)"));
    let sheet = screen.getByRole("dialog", { name: "online.nav.groupMore" });
    expect(
      within(sheet).getByRole("button", { name: "online.nav.events (1)" }),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "online.nav.shop" })).toBeInTheDocument();

    fireEvent.click(tab("online.nav.groupClub (2)"));
    sheet = screen.getByRole("dialog", { name: "online.nav.groupClub" });
    expect(
      within(sheet).getByRole("button", { name: "online.nav.market (2)" }),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "online.nav.finance" })).toBeInTheDocument();

    fireEvent.click(tab("online.nav.groupTeam (1)"));
    sheet = screen.getByRole("dialog", { name: "online.nav.groupTeam" });
    expect(
      within(sheet).getByRole("button", { name: "online.nav.academy (1)" }),
    ).toBeInTheDocument();
  });

  // Given an open sheet,
  // when the coach presses Escape, or taps outside it,
  // then it closes and the page stays where it was.
  it("closes the sheet without moving", async () => {
    serve();
    renderOnline("/online");

    await waitFor(() => expect(tabs()).toBeInTheDocument());
    fireEvent.click(tab("online.nav.groupTeam"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(tab("online.nav.groupTeam"));
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(where()).toBe("/online");
  });

  // Given a page of a section on a phone,
  // when it shows,
  // then the app bar at the top names it with the season's day and holds the inbox.
  it("names the page in a compact app bar", async () => {
    serve();
    renderOnline("/online/schedule");

    const bar = await screen.findByRole("banner");
    expect(
      within(bar).getByRole("heading", { level: 1, name: "online.nav.schedule" }),
    ).toBeInTheDocument();
    expect(within(bar).getByText("online.header.seasonDay:3|5|28")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "online.nav.inbox" })).toBeInTheDocument();
  });
});
