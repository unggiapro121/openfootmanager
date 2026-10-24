import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CareerView, LicenceTableView } from "../api";
import {
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
        : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

const ACCOUNT = {
  id: "a",
  email: "coach@example.test",
  firstName: "Jose",
  lastName: "Mourinho",
  dateOfBirth: "1963-01-26",
  nationality: "PT",
  region: "AsiaSoutheast",
  status: "active",
  capabilities: [],
};

const ALL = ["4-4-2", "4-3-3", "3-5-2", "4-2-3-1"];
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
    { tier: 2, formations: ALL, playStyles: ["Balanced", "Counter"], dials: ["width"], roles: [] },
    {
      tier: 3,
      formations: ALL,
      playStyles: ["Balanced", "Counter"],
      dials: ["width", "break_speed"],
      roles: ["Mezzala"],
    },
    {
      tier: 4,
      formations: ALL,
      playStyles: ["Balanced", "Counter"],
      dials: ["width", "break_speed", "offside_trap"],
      roles: ["Mezzala", "False9"],
    },
  ],
};

let server: ReturnType<typeof fakeServer>;

beforeEach(() => resetOnline());
afterEach(() => server?.restore());

function stage(career: CareerView, table: LicenceTableView) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok(ACCOUNT),
    "GET v1/me/career": ok(career),
    "GET v1/licences": ok(table),
  });
}

describe("the coach's roadmap on his profile", () => {
  // Given a level-3 coach of five seasons and two promotions, holding the second licence,
  // when his profile opens and he unfolds the third licence,
  // then it shows his level and licence, his record, how a level is earned, the four licences
  // with the second as his and the third one level away, and what the third adds by name.
  it("shows where the coach stands and what lies ahead", async () => {
    stage(
      {
        level: 3,
        seasons: 5,
        promotions: 2,
        promotion: { places: 4, leagueSize: 14, newcomerMinMatches: 13 },
        licence: { tier: 2, nextTierLevel: 4, pending: false },
      },
      TABLE,
    );
    renderOnline("/online/profile");

    expect(
      await screen.findByText("online.roadmap.standing:3|tactics.licence.tier_2"),
    ).toBeInTheDocument();
    expect(screen.getByText("online.roadmap.record:5|2")).toBeInTheDocument();
    expect(screen.getByText("online.roadmap.howTop:4|14")).toBeInTheDocument();
    expect(screen.getByText("online.roadmap.howNewcomer:13")).toBeInTheDocument();

    const road = screen.getByRole("list", { name: "online.roadmap.licences" });
    const steps = within(road)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === road);
    expect(steps).toHaveLength(4);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(within(steps[2]).getByText("online.roadmap.levelsToGo:1")).toBeInTheDocument();
    fireEvent.click(within(steps[2]).getByText("online.roadmap.opensMore"));
    expect(
      within(steps[2]).getByText("online.roadmap.addedDials:tactics.phaseSettings.breakSpeed"),
    ).toBeInTheDocument();
    expect(
      within(steps[2]).getByText("online.roadmap.addedRoles:tactics.playerRoles.Mezzala"),
    ).toBeInTheDocument();
  });

  // Given a coach who never had an online season, and no season with licences,
  // when his profile opens,
  // then it shows level 1, says how a level is earned once a season opens, that every control is
  // open, and no licence road.
  it("tells a new coach what to expect when there is no season yet", async () => {
    stage({ level: 1, seasons: 0, promotions: 0 }, { tiers: TABLE.tiers });
    renderOnline("/online/profile");

    expect(await screen.findByText("online.roadmap.level:1")).toBeInTheDocument();
    expect(screen.getByText("online.roadmap.noSeason")).toBeInTheDocument();
    expect(screen.getByText("online.roadmap.allOpen")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "online.roadmap.licences" })).toBeNull();
  });
});
