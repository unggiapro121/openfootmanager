import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PHONE_QUERY } from "../../hooks/usePhoneLayout";
import type { MyClubView } from "../api";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../test-utils/onlineTestKit";

/**
 * The licence notice on a phone (m2-tech-spec §3.3, M2a-3): a sheet from the bottom when it is
 * new; closed without dismissing, it stays on the page as the desktop banner until dismissed.
 */
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));
vi.mock("../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  resetOnline();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
});
afterEach(() => {
  server?.restore();
  vi.unstubAllGlobals();
});

/** A fitted setup from season `seasonNumber`: each test its own, as a notice shows once a run. */
function fitted(seasonNumber: number): MyClubView {
  const notice = {
    seasonNumber,
    tier: 1,
    formation: { from: "4-2-3-1", to: "4-3-3" },
    dials: 0,
    roles: 0,
  };
  return myClub({ licence: { level: 1, tier: 1, nextTierLevel: 2, pending: false, notice } });
}

function stage(club: MyClubView) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(club),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/leagues/league-1/fixtures": ok({ round: 1, fixtures: [] }),
    "DELETE v1/clubs/mine/licence-notice": ok(myClub()),
  });
}

describe("the licence notice on a phone (M2a-3)", () => {
  // Given a coach whose setup the server fitted to his licence,
  // when the overview opens on a phone and he dismisses the notice in its sheet,
  // then the sheet says what moved, and dismissing asks the server and takes the notice away.
  it("rises as a sheet and is dismissed there", async () => {
    stage(fitted(4));
    renderOnline("/online");
    const sheet = await screen.findByRole("dialog", {
      name: "online.licence.notice.title:4|tactics.licence.tier_1",
    });
    expect(
      within(sheet).getByText("online.licence.notice.formation:4-2-3-1|4-3-3"),
    ).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: "online.licence.notice.dismiss" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText(/^online\.licence\.notice\.title/)).toBeNull();
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  // Given the notice's sheet on a phone,
  // when the coach closes it without dismissing,
  // then the notice stays on the page with its own dismiss button, and the server is not asked.
  it("stays on the page when the sheet is closed", async () => {
    stage(fitted(5));
    renderOnline("/online");
    const sheet = await screen.findByRole("dialog");
    fireEvent.keyDown(sheet, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const notice = screen.getByRole("status", { name: "" });
    expect(
      within(notice).getByText("online.licence.notice.title:5|tactics.licence.tier_1"),
    ).toBeInTheDocument();
    expect(
      within(notice).getByRole("button", { name: "online.licence.notice.dismiss" }),
    ).toBeInTheDocument();
    expect(server.requests.some((request) => request.method === "DELETE")).toBe(false);
  });
});
