import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LicenceTableView, MyClubView } from "../api";
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

// Keys stand for the text, with their values after a colon.
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : typeof options === "string"
          ? options
          : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

const ALL = ["4-4-2", "4-3-3", "3-5-2", "4-5-1", "4-2-3-1", "3-4-3", "5-3-2", "4-1-4-1", "3-4-2-1"];

const TABLE: LicenceTableView = {
  levels: { national: 2, continental: 4, elite: 7 },
  tiers: [
    {
      tier: 1,
      formations: ["4-4-2", "4-3-3", "3-5-2"],
      playStyles: ["Balanced"],
      dials: [],
      roles: [],
    },
    { tier: 2, formations: ALL, playStyles: ["Balanced"], dials: [], roles: [] },
    { tier: 3, formations: ALL, playStyles: ["Balanced"], dials: [], roles: [] },
    { tier: 4, formations: ALL, playStyles: ["Balanced"], dials: [], roles: [] },
  ],
};

const NOTICE = {
  seasonNumber: 3,
  tier: 1,
  formation: { from: "4-2-3-1", to: "4-3-3" },
  dials: 2,
  roles: 0,
};

let server: ReturnType<typeof fakeServer>;

beforeEach(() => resetOnline());
afterEach(() => server?.restore());

function stage(club: MyClubView, extra: Parameters<typeof fakeServer>[0] = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(club),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/leagues/league-1/fixtures": ok({ round: 1, fixtures: [] }),
    "GET v1/licences": ok(TABLE),
    ...extra,
  });
}

const firstLicence = (notice?: typeof NOTICE): MyClubView =>
  myClub({ licence: { level: 1, tier: 1, nextTierLevel: 2, pending: false, notice } });

describe("the coach's licence online", () => {
  // Given a first-licence coach,
  // when the tactics page opens and he opens the formation list,
  // then the three open shapes can be chosen and 4-2-3-1 is shown closed until level 2.
  it("shows on the tactics board what the licence closes", async () => {
    stage(firstLicence());
    renderOnline("/online/tactics");
    const shape = await screen.findByRole("combobox", { name: "tactics.formation" });
    await waitFor(() => {
      fireEvent.click(shape);
      expect(
        screen.getByRole("option", { name: "tactics.licence.lockedOption:4-2-3-1|2" }),
      ).toBeDisabled();
    });
    expect(screen.getByRole("option", { name: "4-3-3" })).toBeEnabled();
  });

  // Given a season without licences (no licence on the club),
  // when the tactics page opens,
  // then every shape can be chosen.
  it("closes nothing when the season has no licences", async () => {
    stage(myClub());
    renderOnline("/online/tactics");
    const shape = await screen.findByRole("combobox", { name: "tactics.formation" });
    await waitFor(() =>
      expect(server.requests.some((r) => r.segments.join("/") === "v1/licences")).toBe(true),
    );
    fireEvent.click(shape);
    expect(screen.getByRole("option", { name: "4-2-3-1" })).toBeEnabled();
  });

  // Given a first-licence coach whose setup the server fitted,
  // when the overview opens and he dismisses the notice,
  // then the card names his licence and the next, the notice says what moved, and dismissing it
  // asks the server and takes the notice away.
  it("tells the coach his licence and what was fitted, until he dismisses it", async () => {
    stage(firstLicence(NOTICE), {
      "DELETE v1/clubs/mine/licence-notice": ok(firstLicence()),
    });
    renderOnline("/online");
    expect(
      await screen.findByText("online.licence.held:tactics.licence.tier_1|1"),
    ).toBeInTheDocument();
    expect(screen.getByText("online.licence.next:tactics.licence.tier_2|2")).toBeInTheDocument();
    const notice = screen.getByRole("status", { name: "" });
    expect(
      within(notice).getByText("online.licence.notice.formation:4-2-3-1|4-3-3"),
    ).toBeInTheDocument();
    expect(within(notice).getByText("online.licence.notice.dials:2")).toBeInTheDocument();
    expect(within(notice).queryByText(/online\.licence\.notice\.roles/)).toBeNull();

    fireEvent.click(within(notice).getByRole("button", { name: "online.licence.notice.dismiss" }));
    await waitFor(() => expect(screen.queryByText(/^online\.licence\.notice\.title/)).toBeNull());
    const dismissal = server.requests.find((r) => r.method === "DELETE");
    expect(dismissal?.segments).toEqual(["v1", "clubs", "mine", "licence-notice"]);
    expect(dismissal?.idempotencyKey).toBeTruthy();
  });

  // Given a server refusing a setup for an issue this client does not know,
  // when the coach changes his formation,
  // then the refusal is said in plain words, never as a raw key.
  it("words an issue it does not know plainly", async () => {
    stage(myClub(), {
      "PUT v1/clubs/mine/setup": fail(422, "be.error.club.setupInvalid", {
        details: { issues: [{ issue: "somethingNew" }] },
      }),
    });
    renderOnline("/online/tactics");
    const shape = await screen.findByRole("combobox", { name: "tactics.formation" });
    fireEvent.click(shape);
    fireEvent.click(screen.getByRole("option", { name: "4-3-3" }));
    expect(await screen.findByText("online.tactics.issue.unknown")).toBeInTheDocument();
    expect(screen.queryByText(/somethingNew/)).toBeNull();
  });
});
