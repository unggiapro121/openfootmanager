import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FinanceView,
  FixtureView,
  InventoryLineView,
  InventoryView,
  LicenceView,
  MyClubView,
} from "../../api";
import type { OnlineRequest } from "../../../services/onlineTransport";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
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

const markReady = vi.fn();
vi.mock("../../../lib/readyMarker", () => ({ markReady: (stage: string) => markReady(stage) }));

vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

const MINE = { id: "club-1", name: "Cầu Vồng Nghệ An" };
const RIVAL = { id: "club-2", name: "Sóng Biển Đà Nẵng" };
const THIRD = { id: "club-3", name: "Sao Mai" };

function fixture(round: number, extra: Partial<FixtureView> = {}): FixtureView {
  return {
    id: `fixture-${round}`,
    leagueId: "league-1",
    round,
    kickoffAt: "2099-01-01T11:00:00Z",
    status: "scheduled",
    home: MINE,
    away: RIVAL,
    ...extra,
  };
}

/** The club's season: two rounds played, the next in round 3, four more after it. */
const SEASON_FIXTURES: FixtureView[] = [
  fixture(1, { status: "settled", homeGoals: 2, awayGoals: 0, away: THIRD }),
  fixture(2, { status: "settled", homeGoals: 1, awayGoals: 1, home: RIVAL, away: MINE }),
  fixture(3),
  fixture(4, { home: THIRD, away: MINE }),
  fixture(5, { away: THIRD }),
  fixture(6, { home: RIVAL, away: MINE }),
  fixture(7),
];

function line(itemCode: string, total = 1): InventoryLineView {
  return { itemCode, powerClass: "c", total, stacks: [{ quantity: total }] };
}

function inventory(overrides: Partial<InventoryView> = {}): InventoryView {
  return {
    lines: [line("teamRecoveryPack"), line("xpBoosterX2", 2)],
    locked: false,
    limits: {
      teamRecovery: { usedToday: 0, perDay: 1, nextAt: "2099-01-02T00:00:00Z" },
      notes: [],
      xpX2: { remaining: 0, max: 10 },
    },
    ...overrides,
  };
}

function finance(overrides: Partial<FinanceView> = {}): FinanceView {
  return {
    economy: true,
    cash: 1_900_000,
    held: 0,
    locked: false,
    season: [],
    weeklyWageBill: 40_000,
    ...overrides,
  };
}

const FIRST_LICENCE: LicenceView = { level: 1, tier: 1, nextTierLevel: 2, pending: false };

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(
  club: MyClubView = myClub({ nextFixture: fixture(3) }),
  more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {},
) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(club),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/clubs/mine/fixtures": ok({ fixtures: SEASON_FIXTURES }),
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/clubs/mine/finance": ok(finance()),
    "GET v1/me/items": ok(inventory()),
    ...more,
  });
}

beforeEach(() => {
  markReady.mockClear();
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

const card = (name: RegExp | string) => screen.findByRole("region", { name });

describe("the overview's next match", () => {
  // Given a club at home in round 3, second in the table,
  // when the overview opens,
  // then the next-match card shows both clubs, the club's place, the time left and the stadium.
  it("shows both clubs, the place, the time left and the stadium", async () => {
    serve();
    renderOnline();

    const next = await card(/^online\.fixture\.title/);
    expect(within(next).getByText("online.fixture.round:3")).toBeInTheDocument();
    expect(within(next).getByText("online.fixture.home")).toBeInTheDocument();
    expect(within(next).getByText(MINE.name)).toBeInTheDocument();
    expect(within(next).getByText(RIVAL.name)).toBeInTheDocument();
    expect(within(next).getByText("online.overview.standingLine:2|6")).toBeInTheDocument();
    expect(within(next).getByText("online.overview.awaySide")).toBeInTheDocument();
    expect(
      within(next).getByRole("timer", { name: "online.overview.kickoffIn" }),
    ).toHaveTextContent(/^online\.countdown\.withDays:/);
    expect(within(next).getByText("Sân Vinh")).toBeInTheDocument();
  });

  // Given a club playing away,
  // when the overview opens,
  // then the card says away, puts the home club first and names no stadium of its own.
  it("says an away match and names no stadium of the club's", async () => {
    serve(myClub({ nextFixture: fixture(4, { home: THIRD, away: MINE }) }));
    renderOnline();

    const next = await card(/^online\.fixture\.title/);
    expect(within(next).getByText("online.fixture.away")).toBeInTheDocument();
    expect(within(next).getByText("online.overview.homeSide")).toBeInTheDocument();
    const names = within(next)
      .getAllByText(new RegExp(`^(${MINE.name}|${THIRD.name})$`))
      .map((node) => node.textContent);
    expect(names).toEqual([THIRD.name, MINE.name]);
    expect(within(next).queryByText("Sân Vinh")).toBeNull();
  });

  // Given the next match,
  // when the coach looks at its preparation,
  // then it links to the squad and the tactics, and offers the recovery pack held.
  it("links to the squad and tactics and offers the recovery pack", async () => {
    serve();
    renderOnline();

    const next = await card(/^online\.fixture\.title/);
    expect(within(next).getByRole("link", { name: "online.overview.toLineup" })).toHaveAttribute(
      "href",
      "/online/squad",
    );
    expect(within(next).getByRole("link", { name: "online.nav.tactics" })).toHaveAttribute(
      "href",
      "/online/tactics",
    );
    const recovery = await within(next).findByRole("button", {
      name: /^online\.overview\.recovery/,
    });
    expect(recovery).toHaveTextContent(
      "online.overview.recoveryLine:online.items.teamRecoveryPack.name:teamRecoveryPack|1|1",
    );
    fireEvent.click(recovery);
    expect(
      await screen.findByRole("dialog", { name: /^online\.items\.useTitle:/ }),
    ).toBeInTheDocument();
  });

  // Given a recovery pack already used today,
  // when the overview opens,
  // then the pack's button says so and cannot be pressed.
  it("holds the recovery pack once used today", async () => {
    serve(undefined, {
      "GET v1/me/items": ok(
        inventory({
          limits: {
            teamRecovery: { usedToday: 1, perDay: 1, nextAt: "2099-01-02T00:00:00Z" },
            notes: [],
            xpX2: { remaining: 0, max: 10 },
          },
        }),
      ),
    });
    renderOnline();

    const next = await card(/^online\.fixture\.title/);
    const recovery = await within(next).findByRole("button", {
      name: /^online\.overview\.recovery/,
    });
    expect(recovery).toBeDisabled();
    expect(recovery).toHaveTextContent("online.overview.recoveryUsed");
  });

  // Given a season whose ruleset allows no use of the recovery pack a day,
  // when the overview opens,
  // then the pack's button says it is off this season, not "used up today", and cannot be pressed.
  it("says the recovery pack is off for a season that allows none", async () => {
    serve(undefined, {
      "GET v1/me/items": ok(
        inventory({
          limits: {
            teamRecovery: { usedToday: 0, perDay: 0, nextAt: "2099-01-02T00:00:00Z" },
            notes: [],
            xpX2: { remaining: 0, max: 10 },
          },
        }),
      ),
    });
    renderOnline();

    const next = await card(/^online\.fixture\.title/);
    const recovery = await within(next).findByRole("button", {
      name: /^online\.overview\.recovery/,
    });
    expect(recovery).toBeDisabled();
    expect(recovery).toHaveTextContent("online.inventory.offThisSeason");
  });

  // Given a coach who holds no recovery pack,
  // when the overview opens,
  // then the card offers none.
  it("offers no recovery pack the coach does not hold", async () => {
    serve(undefined, { "GET v1/me/items": ok(inventory({ lines: [] })) });
    renderOnline();

    const next = await card(/^online\.fixture\.title/);
    await waitFor(() => expect(sent("GET", "v1/me/items")).toHaveLength(1));
    expect(within(next).queryByRole("button", { name: /^online\.overview\.recovery/ })).toBeNull();
  });
});

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

describe("the overview's season", () => {
  // Given day 5 of a running season and two league matches played,
  // when the overview opens,
  // then the season card shows the day, how far the season is, and the time to the next day.
  it("shows the day, the progress and the next day", async () => {
    serve();
    renderOnline();

    const season = await card("online.header.season:3");
    expect(within(season).getByText("online.season.status.running")).toBeInTheDocument();
    const progress = within(season).getByRole("progressbar", {
      name: "online.overview.seasonProgress",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "5");
    expect(progress).toHaveAttribute("aria-valuemax", "28");
    expect(within(season).getByText("online.overview.played:2")).toBeInTheDocument();
    expect(within(season).getByText("online.overview.daysLeft:23")).toBeInTheDocument();
    expect(within(season).getByRole("timer", { name: "online.overview.newDayIn" })).toBeVisible();
  });
});

describe("the overview's league", () => {
  // Given a club second with 6 points after two wins,
  // when the overview opens,
  // then the table card shows the place, the points, the record and a link to the table.
  it("shows the place, the points and the record", async () => {
    serve();
    renderOnline();

    const table = await card("online.overview.tableTitle");
    expect(within(table).getByText("online.overview.points:6")).toBeInTheDocument();
    expect(within(table).getByText("online.overview.afterGames:2")).toBeInTheDocument();
    expect(within(table).getByText("online.overview.placeAria")).toBeInTheDocument();
    expect(within(table).getByText("online.schedule.outcome.W").nextSibling).toHaveTextContent("2");
    expect(within(table).getByText("online.schedule.outcome.L").nextSibling).toHaveTextContent("0");
    expect(within(table).getByRole("link", { name: "online.overview.seeTable" })).toHaveAttribute(
      "href",
      "/online/league",
    );
  });

  // Given the club's season with rounds 1 and 2 settled,
  // when the overview opens,
  // then the latest result is round 2's, read with the season's fixtures in one call.
  it("shows the latest result from the season's fixtures", async () => {
    serve();
    renderOnline();

    const last = await card("online.overview.lastResult");
    expect(await within(last).findByText("1 – 1")).toBeInTheDocument();
    expect(within(last).getByText("online.schedule.outcome.D")).toBeInTheDocument();
    expect(
      within(last).getByText("online.overview.resultMeta:2|online.fixture.away"),
    ).toBeInTheDocument();
    expect(within(last).getByRole("link", { name: "online.overview.report" })).toHaveAttribute(
      "href",
      "/online/fixtures/fixture-2",
    );
    expect(sent("GET", "v1/clubs/mine/fixtures")).toHaveLength(1);
  });

  // Given a season with no result yet,
  // when the overview opens,
  // then the result card says so.
  it("says when the season has no result yet", async () => {
    serve(undefined, { "GET v1/clubs/mine/fixtures": ok({ fixtures: [fixture(1)] }) });
    renderOnline();

    const last = await card("online.overview.lastResult");
    expect(await within(last).findByText("online.overview.noResult")).toBeInTheDocument();
  });

  // Given the club's next match in round 3,
  // when the overview opens,
  // then the coming fixtures list rounds 3 to 6, home or away, the next one first.
  it("lists the next four fixtures", async () => {
    serve();
    renderOnline();

    const upcoming = await card("online.overview.upcoming");
    const rows = await within(upcoming).findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(`online.fixture.round:3${RIVAL.name}online.overview.homeMark`),
      expect.stringContaining(`online.fixture.round:4${THIRD.name}online.overview.awayMark`),
      expect.stringContaining(`online.fixture.round:5${THIRD.name}online.overview.homeMark`),
      expect.stringContaining(`online.fixture.round:6${RIVAL.name}online.overview.awayMark`),
    ]);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(within(upcoming).getByRole("link", { name: "online.overview.seeAll" })).toHaveAttribute(
      "href",
      "/online/schedule",
    );
  });
});

describe("the overview's club and licence", () => {
  // Given a club in a season with money,
  // when the overview opens,
  // then the club card lists its name, area, stadium and budget, with a way to the finances.
  it("lists the club's name, area, stadium and budget", async () => {
    serve();
    renderOnline();

    const club = await card("online.club.title");
    expect(within(club).getByText("online.overview.clubName").nextSibling).toHaveTextContent(
      MINE.name,
    );
    expect(within(club).getByText("online.overview.area").nextSibling).toHaveTextContent(
      "Vinh · coach.regions.AsiaSoutheast",
    );
    expect(within(club).getByText("online.overview.stadium").nextSibling).toHaveTextContent(
      "online.overview.stadiumLine:Sân Vinh|18,000",
    );
    const budget = await within(club).findByText("online.overview.budget");
    expect(budget.nextSibling).toHaveTextContent("1.9M");
    expect(within(club).getByRole("link", { name: "online.nav.finance" })).toHaveAttribute(
      "href",
      "/online/finance",
    );
  });

  // Given a first-licence coach holding two XP boosters,
  // when the overview opens,
  // then the licence card shows the licence held and the next, and offers the booster.
  it("shows the licence road and offers the XP booster", async () => {
    serve(myClub({ nextFixture: fixture(3), licence: FIRST_LICENCE }));
    renderOnline();

    const licence = await card("online.licence.title");
    const road = within(licence).getByRole("list", { name: "online.overview.licenceRoad" });
    expect(within(road).getByText("tactics.licence.tier_1")).toBeInTheDocument();
    expect(within(road).getByText("online.overview.licenceNow:1")).toBeInTheDocument();
    expect(within(road).getByText("tactics.licence.tier_2")).toBeInTheDocument();
    expect(within(road).getByText("online.overview.licenceNext:2")).toBeInTheDocument();
    expect(within(licence).getByRole("link", { name: "online.nav.profile" })).toHaveAttribute(
      "href",
      "/online/profile",
    );
    expect(
      await within(licence).findByText(
        "online.overview.boosterHeld:online.items.xpBoosterX2.name:xpBoosterX2|2",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(licence).getByRole("button", { name: "online.overview.activate" }));
    expect(
      await screen.findByRole("dialog", { name: /^online\.items\.useTitle:/ }),
    ).toBeInTheDocument();
  });

  // Given a coach at the highest licence,
  // when the overview opens,
  // then the road shows no next licence and says it is the highest.
  it("says the highest licence has no next", async () => {
    serve(
      myClub({
        nextFixture: fixture(3),
        licence: { level: 9, tier: 4, pending: false },
      }),
    );
    renderOnline();

    const licence = await card("online.licence.title");
    expect(within(licence).getByText("tactics.licence.tier_4")).toBeInTheDocument();
    expect(within(licence).getByText("online.licence.highest")).toBeInTheDocument();
    expect(within(licence).queryByText(/^online\.overview\.licenceNext/)).toBeNull();
  });
});

describe("the club's crest", () => {
  const crestDialog = async () => {
    const club = await card("online.club.title");
    fireEvent.click(within(club).getByRole("button", { name: "online.club.crest.change" }));
    return screen.findByRole("dialog", { name: "online.club.crest.title" });
  };

  // Given a club with no crest of its own,
  // when the coach picks a colour, a pattern and letters and saves,
  // then the crest is sent once with a key, the dialog closes and the club shows the new crest.
  it("draws the club's crest and shows it on the club", async () => {
    serve(undefined, {
      "PATCH v1/clubs/mine/crest": (request) =>
        ok(
          myClub({
            nextFixture: fixture(3),
            club: { ...myClub().club, crest: request.body as MyClubView["club"]["crest"] },
          }),
        ),
    });
    renderOnline();

    const dialog = await crestDialog();
    fireEvent.change(within(dialog).getByLabelText("online.club.crest.primary"), {
      target: { value: "#004d98" },
    });
    fireEvent.click(within(dialog).getByRole("radio", { name: "online.club.crest.pattern.band" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "online.club.crest.label" }), {
      target: { value: "fc" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "online.club.crest.save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [drawn] = sent("PATCH", "v1/clubs/mine/crest");
    expect(drawn.body).toEqual({
      primary: "#004d98",
      secondary: "#ffffff",
      pattern: "band",
      label: "FC",
    });
    expect(drawn.idempotencyKey).toEqual(expect.any(String));
    expect(within(await card("online.club.title")).getByText("FC")).toBeInTheDocument();
  });

  // Given a club with a crest of its own,
  // when the overview opens and the coach opens the crest dialog,
  // then the next match shows that crest, and the dialog starts from it.
  it("starts from the crest the club has", async () => {
    serve(
      myClub({
        nextFixture: fixture(3),
        club: {
          ...myClub().club,
          crest: { primary: "#111111", secondary: "#eeeeee", pattern: "diamond", label: "AB" },
        },
      }),
    );
    renderOnline();

    expect(within(await card(/^online\.fixture\.title/)).getByText("AB")).toBeInTheDocument();
    const dialog = await crestDialog();
    expect(within(dialog).getByLabelText("online.club.crest.primary")).toHaveValue("#111111");
    expect(within(dialog).getByLabelText("online.club.crest.secondary")).toHaveValue("#eeeeee");
    expect(
      within(dialog).getByRole("radio", { name: "online.club.crest.pattern.diamond" }),
    ).toBeChecked();
    expect(within(dialog).getByRole("textbox", { name: "online.club.crest.label" })).toHaveValue(
      "AB",
    );
  });

  // Given letters cleared, then a crest the server refuses,
  // when the coach tries to save,
  // then nothing can be saved without letters, and a refusal shows in the dialog, which stays.
  it("needs letters and shows why a crest was refused", async () => {
    serve(undefined, {
      "PATCH v1/clubs/mine/crest": fail(400, "be.error.validation.invalid"),
    });
    renderOnline();

    const dialog = await crestDialog();
    const letters = within(dialog).getByRole("textbox", { name: "online.club.crest.label" });
    const save = within(dialog).getByRole("button", { name: "online.club.crest.save" });
    fireEvent.change(letters, { target: { value: "  " } });
    expect(save).toBeDisabled();
    fireEvent.change(letters, { target: { value: "ab" } });
    fireEvent.click(save);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "resolved:be.error.validation.invalid",
    );
    expect(screen.getByRole("dialog", { name: "online.club.crest.title" })).toBeInTheDocument();
  });
});

describe("the overview's ready mark", () => {
  // Given the club and its fixtures served,
  // when the overview has drawn them,
  // then it marks the overview ready for the cold-start measurement (phase 5 M2b-11).
  it("marks the overview ready once its fixtures arrive", async () => {
    serve();
    renderOnline();

    await card(/^online\.fixture\.title/);
    await waitFor(() => expect(markReady).toHaveBeenCalledWith("overview"));
  });

  // Given the fixtures cannot be read,
  // when the overview opens,
  // then it is not marked ready: the measurement wants a screen with real data.
  it("does not mark the overview ready without its fixtures", async () => {
    serve(undefined, { "GET v1/clubs/mine/fixtures": fail(500, "be.error.internal") });
    renderOnline();

    await card(/^online\.fixture\.title/);
    expect(markReady).not.toHaveBeenCalledWith("overview");
  });
});

describe("the overview's club card with its stadium (c-27 §5.8)", () => {
  // Given the coach's club with its stands at level 7, then one whose season does not build them,
  // when the overview opens,
  // then the club card shows the stadium's picture in the first only.
  it.each([
    ["shows", 7, 1],
    ["leaves out", undefined, 0],
  ] as const)("%s the stadium's picture", async (_case, standsLevel, count) => {
    const club = myClub({ nextFixture: fixture(3) });
    serve({ ...club, club: { ...club.club, standsLevel } });
    renderOnline();

    const clubCard = await card("online.club.title");
    expect(
      within(clubCard).queryAllByRole("figure", {
        name: "online.club.stadiumPicture:Sân Vinh|18,000",
      }),
    ).toHaveLength(count);
  });
});
