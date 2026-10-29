import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnlineRequest } from "../../services/onlineTransport";
import { fakeRealtime } from "../../test-utils/onlineMatchKit";
import {
  type Answer,
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../test-utils/onlineTestKit";

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

function serve(more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({
      id: "account-1",
      email: "dung@example.test",
      firstName: "Dung",
      lastName: "Ung",
      dateOfBirth: "1990-01-01",
      nationality: "VN",
      region: "AsiaSoutheast",
      status: "active",
      capabilities: [],
      hasAvatarImage: false,
    }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": fail(404, "be.error.notFound"),
    ...more,
  });
}

const where = () => screen.getByLabelText("location").textContent;
const header = () => screen.getByRole("banner");
const sidebar = () => screen.getByRole("navigation", { name: "online.nav.label" });

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

describe("the online sidebar", () => {
  // Given a coach running a club,
  // when the online mode opens,
  // then the sidebar shows the club's card and its pages under Team, Matches and Club, the
  // overview marked current, and none of the pages the header holds.
  it("groups the club's pages as the design does", async () => {
    serve();
    renderOnline("/online");

    await screen.findByText("online.nav.groupTeam");
    expect(screen.getByText("online.nav.groupMatches")).toBeInTheDocument();
    expect(screen.getByText("online.nav.groupClub")).toBeInTheDocument();
    expect(screen.getAllByText("Cầu Vồng Nghệ An").length).toBeGreaterThan(0);
    expect(within(sidebar()).getByRole("button", { name: "online.nav.overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["online.nav.inbox", "online.nav.coins", "online.nav.shop"]) {
      expect(within(sidebar()).queryByRole("button", { name })).toBeNull();
    }
    fireEvent.click(within(sidebar()).getByRole("button", { name: "online.nav.academy" }));
    await waitFor(() => expect(where()).toBe("/online/academy"));
  });
});

describe("the online header", () => {
  // Given the coach on a page of a section,
  // when the header shows,
  // then it names the page and the season's day, and marks the page's entry current.
  it("names the page open", async () => {
    serve();
    renderOnline("/online/shop");

    expect(
      await within(header()).findByRole("heading", { level: 1, name: "online.nav.shop" }),
    ).toBeInTheDocument();
    expect(within(header()).getByText("online.header.seasonDay:3|5|28")).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: "online.nav.shop" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(header()).getByRole("button", { name: "online.nav.events" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  // Given another club's page,
  // when the header shows,
  // then it is named by the coach's own club.
  it("names a page outside the sections by the coach's club", async () => {
    serve({ "GET v1/clubs/c-2": fail(404, "be.error.notFound") });
    renderOnline("/online/clubs/c-2");

    expect(
      await within(header()).findByRole("heading", { level: 1, name: "Cầu Vồng Nghệ An" }),
    ).toBeInTheDocument();
  });

  // Given a match ahead and unread mail,
  // when the header shows,
  // then the next match opens its fixture and the inbox says how much is unread.
  it("opens the next match and the inbox", async () => {
    serve({ "GET v1/clubs/mine": ok(myClub({ unreadMail: 3 })) });
    renderOnline("/online");

    const inbox = await within(header()).findByRole("button", {
      name: "online.header.inboxUnread:3",
    });
    fireEvent.click(within(header()).getByRole("button", { name: /online\.header\.nextMatch/ }));
    await waitFor(() => expect(where()).toBe("/online/fixtures/fixture-9"));
    fireEvent.click(inbox);
    await waitFor(() => expect(where()).toBe("/online/inbox"));
  });

  // Given a coach with no club yet,
  // when the header shows,
  // then it has the person's pages but no next match, no inbox, and the sidebar no club pages.
  it("keeps the person's pages without a club", async () => {
    serve({ "GET v1/clubs/mine": fail(404, "be.error.club.none") });
    renderOnline("/online");
    await waitFor(() => expect(where()).toBe("/online/takeover"));

    expect(
      within(header()).queryByRole("button", { name: /online\.header\.nextMatch/ }),
    ).toBeNull();
    expect(within(header()).queryByRole("button", { name: "online.nav.inbox" })).toBeNull();
    expect(within(sidebar()).queryByRole("button", { name: "online.nav.squad" })).toBeNull();
    fireEvent.click(within(header()).getByRole("button", { name: "online.nav.inventory" }));
    await waitFor(() => expect(where()).toBe("/online/inventory"));
  });

  // Given the account button,
  // when it is opened, closed with Escape, and opened again,
  // then it offers the profile and the main menu, and each choice goes there.
  it("opens the account menu", async () => {
    serve();
    renderOnline("/online");

    const account = await within(header()).findByRole("button", { name: "online.header.account" });
    expect(account).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(account);
    expect(account).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "online.nav.profile" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "online.nav.profile" })).toBeNull();
    expect(account).toHaveFocus();

    fireEvent.click(account);
    fireEvent.click(screen.getByRole("button", { name: "online.nav.profile" }));
    await waitFor(() => expect(where()).toBe("/online/profile"));
    fireEvent.click(account);
    fireEvent.click(screen.getByRole("button", { name: "online.nav.mainMenu" }));
    expect(await screen.findByText("outside-online")).toBeInTheDocument();
  });
});
