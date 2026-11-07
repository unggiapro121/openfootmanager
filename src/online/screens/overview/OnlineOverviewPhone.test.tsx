import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import {
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";

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

vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Parameters<typeof fakeServer>[0] = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/clubs/mine/fixtures": ok({ fixtures: [] }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": fail(404, "be.error.notFound"),
    ...more,
  });
}

function windowIs(phone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: phone && query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const where = () => screen.getByLabelText("location").textContent;
const shortcuts = () => screen.queryByRole("navigation", { name: "online.overview.shortcuts" });

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.unstubAllGlobals();
});

describe("the overview on a phone", () => {
  // Given a coach on a phone-narrow window,
  // when the overview opens,
  // then a row of shortcuts holds Events, Shop, Inventory and Training (design m-tong-quan.html),
  // and tapping one opens its page.
  it("offers shortcuts to the pages a coach opens daily", async () => {
    windowIs(true);
    serve();
    renderOnline("/online");

    await waitFor(() => expect(shortcuts()).not.toBeNull());
    const row = shortcuts() as HTMLElement;
    expect(
      within(row)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "online.nav.events",
      "online.nav.shop",
      "online.nav.inventory",
      "online.nav.training",
    ]);
    fireEvent.click(within(row).getByRole("link", { name: "online.nav.shop" }));
    await waitFor(() => expect(where()).toBe("/online/shop"));
  });

  // Given a coach on a phone whose daily gift has a step ready (C-19 C19-3),
  // when the overview opens,
  // then the inventory shortcut carries a count of 1.
  it("marks the inventory shortcut while a gift waits", async () => {
    windowIs(true);
    serve({
      "GET v1/me": ok({ id: "account-1" }),
      "GET v1/me/items": ok({
        lines: [],
        locked: false,
        dailyGift: {
          steps: [{ reward: { kind: "coin", amount: 10 }, state: "ready" }],
          next: 0,
          available: true,
          gapSeconds: 7_200,
        },
      }),
    });
    renderOnline("/online");

    await waitFor(() => expect(shortcuts()).not.toBeNull());
    const row = shortcuts() as HTMLElement;
    expect(
      await within(row).findByRole("link", { name: "online.nav.inventory (1)" }),
    ).toBeInTheDocument();
  });

  // Given the desktop window,
  // when the overview opens,
  // then it has no shortcut row: the header and the sidebar already hold those pages.
  it("keeps the desktop overview as it was", async () => {
    windowIs(false);
    serve();
    renderOnline("/online");

    await screen.findByRole("region", { name: /online.fixture.title/ });
    expect(shortcuts()).toBeNull();
  });
});
