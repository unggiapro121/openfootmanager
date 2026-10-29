import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CareerCapsView, CareerView, LicenceTableView } from "../api";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
  squadPlayer,
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

function stage(career: CareerView, table: LicenceTableView, club = myClub()) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(club),
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
        forcedLevels: 0,
        promotion: { places: 4, leagueSize: 14, newcomerMinMatches: 13 },
        licence: { tier: 2, nextTierLevel: 4, pending: false },
        mastery: [],
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

  // Given a coach who earned XP in the attacking style,
  // when his profile opens,
  // then the attacking style shows its level, the XP towards the next point and its matches.
  it("shows the mastery his matches earned", async () => {
    stage(
      {
        level: 1,
        seasons: 0,
        promotions: 0,
        forcedLevels: 0,
        mastery: [
          {
            style: "Attacking",
            level: 55,
            xp: 42,
            xpToNext: 400,
            matches: 6,
            effects: [{ phase: "Attack", percent: 12.5 }],
          },
          { style: "Balanced", level: 50, xp: 0, xpToNext: 300, matches: 0, effects: [] },
        ],
      },
      { tiers: TABLE.tiers },
    );
    renderOnline("/online/profile");

    const tile = await screen.findByTestId("mastery-Attacking");
    expect(tile).toHaveTextContent("55");
    expect(tile).toHaveTextContent("manager.masteryXp:42|400");
    expect(tile).toHaveTextContent("manager.masteryMatches:6");
    expect(screen.getByTestId("mastery-Balanced")).toHaveTextContent("manager.masteryXp:0|300");
  });

  // Given a coach who never had an online season, and no season with licences,
  // when his profile opens,
  // then it shows level 1, says how a level is earned once a season opens, that every control is
  // open, and no licence road.
  it("tells a new coach what to expect when there is no season yet", async () => {
    stage(
      { level: 1, seasons: 0, promotions: 0, forcedLevels: 0, mastery: [] },
      { tiers: TABLE.tiers },
    );
    renderOnline("/online/profile");

    expect(await screen.findByText("online.roadmap.level:1")).toBeInTheDocument();
    expect(screen.getByText("online.roadmap.noSeason")).toBeInTheDocument();
    expect(screen.getByText("online.roadmap.allOpen")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "online.roadmap.licences" })).toBeNull();
  });
});

describe("the level caps on the coach's profile (C-7a2)", () => {
  const CAPS: CareerCapsView = {
    playerCap: 74,
    squadBuyCap: 700,
    forcedThreshold: 720,
    maxForcedJump: 2,
    strengthTop18: 684,
    buyStrength: 668,
    squadSize: 18,
    emptySlotOvr: 50,
  };
  const career = (caps?: CareerCapsView, forcedLevels = 1): CareerView => ({
    level: 4,
    seasons: 5,
    promotions: 2,
    forcedLevels,
    caps,
    mastery: [],
  });

  // Given a level-4 coach with two promotions and one level forced, a full squad of buying
  // strength 66.8 under the team cap 70.0 and squad strength 68.4 under the forced threshold 72.0,
  // when his profile opens,
  // then it shows the forced level, the player cap, the two strengths on two bars of their own
  // with their marks, and that buying within the caps never forces him up.
  it("shows the forced levels and both strengths against their own marks", async () => {
    stage(career(CAPS), { tiers: TABLE.tiers });
    renderOnline("/online/profile");

    expect(await screen.findByText("online.roadmap.forced:1")).toBeInTheDocument();
    const caps = screen.getByRole("region", { name: "online.roadmap.caps.title" });
    expect(within(caps).getByText("online.roadmap.caps.playerCap:74")).toBeInTheDocument();
    expect(within(caps).getByText("online.roadmap.caps.buyLine:66.8|70.0")).toBeInTheDocument();
    expect(within(caps).getByText("online.roadmap.caps.teamLine:68.4|72.0")).toBeInTheDocument();
    expect(within(caps).getAllByRole("progressbar")).toHaveLength(2);
    expect(within(caps).getByText("online.roadmap.caps.fullSquad")).toBeInTheDocument();
    expect(within(caps).queryByText(/online\.roadmap\.caps\.over/)).toBeNull();
    expect(within(caps).queryByText(/online\.roadmap\.shortSquad/)).toBeNull();
  });

  // Given a season without level caps,
  // when his profile opens,
  // then there is no caps card.
  it("has no caps card without level caps", async () => {
    stage(career(undefined, 0), { tiers: TABLE.tiers });
    renderOnline("/online/profile");
    expect(await screen.findByText("online.roadmap.forced:0")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "online.roadmap.caps.title" })).toBeNull();
  });

  // Given a level with no player cap, and a squad strength of 73.5 over the threshold 72.0,
  // when his profile opens,
  // then the player cap reads "no limit" and the squad strength warns of a forced promotion.
  it("says when there is no player cap and when the squad is over the threshold", async () => {
    stage(career({ ...CAPS, playerCap: undefined, strengthTop18: 735 }), { tiers: TABLE.tiers });
    renderOnline("/online/profile");
    const caps = await screen.findByRole("region", { name: "online.roadmap.caps.title" });
    expect(within(caps).getByText("online.roadmap.caps.noPlayerCap")).toBeInTheDocument();
    expect(within(caps).getByText("online.roadmap.caps.over:2")).toBeInTheDocument();
  });

  // Given a squad of 16 players, told by the server (R16-9) or, without `squadSize`, counted
  // from the club's players,
  // when his profile opens,
  // then a band says a short squad can be forced up without buying over the caps.
  it.each([
    ["the server's count", { ...CAPS, squadSize: 16 }, myClub()],
    [
      "the club's players",
      { ...CAPS, squadSize: undefined },
      myClub({ players: Array.from({ length: 16 }, (_, i) => squadPlayer({ id: `p${i}` })) }),
    ],
  ])("warns of a short squad from %s", async (_from, caps, club) => {
    stage(career(caps), { tiers: TABLE.tiers }, club);
    renderOnline("/online/profile");
    const band = await screen.findByText("online.roadmap.shortSquad:16|50");
    expect(band.closest("[role=note]")).not.toBeNull();
    expect(screen.queryByText("online.roadmap.caps.fullSquad")).toBeNull();
  });
});
