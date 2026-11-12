import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FixtureView, LeagueView } from "../api";
import type { OnlineRequest } from "../../services/onlineTransport";
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
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

let server: ReturnType<typeof fakeServer>;
beforeEach(() => resetOnline());
afterEach(() => server?.restore());

const TABLE_LEAGUE: LeagueView = {
  ...LEAGUE,
  fixturesDone: 14,
  table: [
    { ...LEAGUE.table[0], position: 2 },
    {
      ...LEAGUE.table[0],
      position: 1,
      club: { id: "club-2", name: "Sóng Biển Đà Nẵng" },
      seat: "bot",
      coach: undefined,
      points: 9,
    },
    {
      ...LEAGUE.table[0],
      position: 3,
      club: { id: "club-3", name: "Sao Mai" },
      seat: "human",
      coach: { firstName: "Lan", lastName: "Trần", fullName: "Trần Lan" },
      points: 3,
    },
  ],
};

function fixture(round: number, extra: Partial<FixtureView> = {}): FixtureView {
  return {
    id: `fixture-${round}`,
    leagueId: "league-1",
    round,
    kickoffAt: "2099-01-01T11:00:00Z",
    status: "scheduled",
    home: { id: "club-1", name: "Cầu Vồng Nghệ An" },
    away: { id: "club-2", name: "Sóng Biển Đà Nẵng" },
    ...extra,
  };
}

const roundOf = (request: OnlineRequest) => Number(request.query?.[0]?.[1]);

function stage(routes: Parameters<typeof fakeServer>[0] = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub({ nextFixture: fixture(3) })),
    "GET v1/leagues/mine": ok(TABLE_LEAGUE),
    "GET v1/leagues/league-1/fixtures": (request) =>
      ok({ round: roundOf(request), fixtures: [fixture(roundOf(request))] }),
    ...routes,
  });
}

describe("the league page", () => {
  // Given a league table,
  // when the league page opens,
  // then the clubs are in table order, each with who runs it, and a club opens its own page.
  it("shows the table in order with who runs each club", async () => {
    stage({
      "GET v1/clubs/club-3": ok({
        club: { ...myClub().club, id: "club-3", name: "Sao Mai" },
        formation: "4-3-3",
        players: [],
      }),
    });
    renderOnline("/online/league");

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual([
      "Sóng Biển Đà Nẵng",
      "Cầu Vồng Nghệ An",
      "Sao Mai",
    ]);
    expect(within(rows[0]).getByText("online.league.bot")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Trần Lan")).toBeInTheDocument();

    fireEvent.click(within(rows[2]).getByRole("button", { name: "Sao Mai" }));
    expect(await screen.findByText("online.publicClub.formation:4-3-3")).toBeInTheDocument();
  });

  // Given last season's champion second in the table (S-42 Dtr-1),
  // when the league page opens,
  // then its row alone carries the defending champion's star, and its name reads as before.
  it("stars last season's champion", async () => {
    stage({
      "GET v1/leagues/mine": ok({
        ...TABLE_LEAGUE,
        table: TABLE_LEAGUE.table.map((row, index) => ({ ...row, defendingChampion: index === 0 })),
      }),
    });
    renderOnline("/online/league");

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    const starred = rows.map(
      (row) => within(row).queryByRole("img", { name: "online.honours.defending" }) !== null,
    );
    expect(starred).toEqual([false, true, false]);
    expect(within(rows[1]).getAllByRole("cell")[1].textContent).toBe("Cầu Vồng Nghệ An");
  });

  // Given a league that promotes 2 this season (its own number, by tier under S-22),
  // when the league page opens,
  // then the first two clubs are marked as promoted and the third is not (C-9 R-c9-3).
  it("marks the league's own promotion places", async () => {
    stage({ "GET v1/leagues/mine": ok({ ...TABLE_LEAGUE, promotionPlaces: 2 }) });
    renderOnline("/online/league");

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    const marked = rows.map((row) => within(row).queryByTestId(/^tournaments-promotion-/) !== null);
    expect(marked).toEqual([true, true, false]);
  });

  // Given a league whose season has scorers, assists and a red card,
  // when the league page opens,
  // then the boards under the table list them best first with their clubs, and say so when a board
  // is empty.
  it("shows who leads the league", async () => {
    const leader = (playerId: string, name: string, value: number) => ({
      playerId,
      name,
      clubId: "club-2",
      clubName: "Sóng Biển Đà Nẵng",
      value,
    });
    stage({
      "GET v1/leagues/league-1/leaders": ok({
        goals: [leader("p1", "Văn Hùng", 12), leader("p2", "Tuấn Kiệt", 9)],
        assists: [leader("p3", "Minh Đức", 7)],
        cleanSheets: [],
        yellowCards: [leader("p4", "Quốc Bảo", 5)],
        redCards: [],
      }),
    });
    renderOnline("/online/league");

    const scorers = await screen.findByTestId("online-top-scorer-p1");
    expect(scorers).toHaveTextContent("Văn Hùng");
    expect(scorers).toHaveTextContent("12");
    expect(screen.getByTestId("online-top-scorer-p2")).toHaveTextContent("9");
    expect(screen.getByTestId("online-top-assist-p3")).toHaveTextContent("Minh Đức");
    expect(screen.getByTestId("online-yellow-card-p4")).toHaveTextContent("5");
    expect(screen.getByText("tournaments.noCleanSheets")).toBeInTheDocument();
    expect(screen.getByText("tournaments.noCards")).toBeInTheDocument();
  });

  // Given a league two rounds in,
  // when the league page opens and the coach steps to the next round,
  // then it starts on round 3 and reads round 4 on the step.
  it("starts on the current round and steps through rounds", async () => {
    stage();
    renderOnline("/online/league");

    expect(await screen.findByRole("list", { name: "online.fixture.round:3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "online.league.nextRound" }));
    expect(await screen.findByRole("list", { name: "online.fixture.round:4" })).toBeInTheDocument();
  });
});

describe("the club's season", () => {
  // Given a season with a win, a loss and fixtures still to play,
  // when the schedule opens,
  // then every round is listed, played ones with their result.
  it("lists every round with the results so far", async () => {
    const season = Array.from({ length: 26 }, (_, index) => {
      const round = index + 1;
      const settled =
        round === 1
          ? { status: "settled", homeGoals: 2, awayGoals: 0 }
          : round === 2
            ? { status: "settled", homeGoals: 0, awayGoals: 1 }
            : {};
      return fixture(round, settled);
    });
    stage({ "GET v1/clubs/mine/fixtures": ok({ fixtures: season }) });
    renderOnline("/online/schedule");

    const list = await screen.findByRole("list", { name: "online.schedule.title" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .filter((item) => item.parentElement === list),
    ).toHaveLength(26);
    expect(
      within(list).getByRole("img", { name: "online.schedule.outcome.W" }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("img", { name: "online.schedule.outcome.L" }),
    ).toBeInTheDocument();
    expect(
      server.requests.filter((request) => request.segments.join("/") === "v1/clubs/mine/fixtures"),
    ).toHaveLength(1);
    // The first round still to play is the next match, marked once; a settled one shows its score.
    expect(within(list).getAllByText("schedule.nextMatch")).toHaveLength(1);
    expect(within(list).getAllByText("2 - 0")).toHaveLength(1);
  });
});

describe("a match being played", () => {
  // Given a round whose fixture is being played,
  // when the league's round is listed,
  // then the fixture offers its match to watch instead of a kick-off time.
  it("offers a live fixture's match to watch", async () => {
    const live = fixture(3, { status: "prepared", matchId: "match-9", matchStatus: "live" });
    stage({ "GET v1/clubs/mine/fixtures": ok({ fixtures: [live] }) });
    renderOnline("/online/schedule");
    const link = await screen.findByRole("link", { name: /online\.fixture\.watchMatch/ });
    expect(link).toHaveAttribute("href", "/online/match/match-9");
    expect(link).toHaveTextContent("online.fixture.watchLive");
  });
});

describe("a settled fixture", () => {
  // Given a settled fixture with its players' lines,
  // when its page opens,
  // then the score shows and each club lists its own players with their part.
  it("shows the score and each club's players", async () => {
    stage({
      "GET v1/fixtures/fixture-1": ok({
        fixture: fixture(1, { status: "settled", homeGoals: 2, awayGoals: 1 }),
        players: [
          {
            playerId: "a",
            name: "Văn An",
            clubId: "club-1",
            minutes: 90,
            goals: 2,
            assists: 0,
            yellowCards: 1,
            redCards: 0,
            rating: 8.1,
          },
          {
            playerId: "b",
            name: "Bình",
            clubId: "club-2",
            minutes: 90,
            goals: 1,
            assists: 0,
            yellowCards: 0,
            redCards: 1,
            rating: 6.2,
          },
        ],
      }),
    });
    renderOnline("/online/fixtures/fixture-1");

    expect(await screen.findByRole("heading", { level: 2, name: "2 – 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cầu Vồng Nghệ An" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sóng Biển Đà Nẵng" })).toBeInTheDocument();
    // The best-rated player of the match is named, as on the offline post-match screen.
    expect(screen.getByText("match.motm")).toBeInTheDocument();
    expect(screen.getByText(/Văn An · Cầu Vồng Nghệ An/)).toBeInTheDocument();
    const [home, away] = screen.getAllByRole("table");
    expect(within(home).getByText("Văn An")).toBeInTheDocument();
    expect(within(home).getByText("online.fixture.yellowCards:1")).toBeInTheDocument();
    expect(within(away).getByText("online.fixture.redCard")).toBeInTheDocument();
  });

  // Given a coach with no club,
  // when they open another club's page,
  // then it shows: public pages need no club of one's own.
  it("opens a public page without a club", async () => {
    stage({
      "GET v1/clubs/mine": fail(404, "be.error.club.none"),
      "GET v1/clubs/club-2": ok({
        club: { ...myClub().club, id: "club-2", name: "Sóng Biển Đà Nẵng" },
        formation: "4-4-2",
        players: [
          {
            id: "p",
            fullName: "Cường",
            position: "Forward",
            naturalPosition: "Striker",
            age: 21,
            ovr: 66,
          },
        ],
      }),
    });
    renderOnline("/online/clubs/club-2");

    expect(await screen.findByText("Cường")).toBeInTheDocument();
    expect(screen.getByText("online.publicClub.botCoach")).toBeInTheDocument();
    expect(screen.getByLabelText("location")).toHaveTextContent("/online/clubs/club-2");
  });

  // Given a club whose coach drew its crest,
  // when its public page opens,
  // then the page shows that crest by the club's name.
  it("shows the crest the club's coach drew", async () => {
    stage({
      "GET v1/clubs/club-2": ok({
        club: {
          ...myClub().club,
          id: "club-2",
          name: "Sóng Biển Đà Nẵng",
          crest: { primary: "#004d98", secondary: "#a50044", pattern: "split", label: "SB" },
        },
        formation: "4-4-2",
        players: [],
      }),
    });
    renderOnline("/online/clubs/club-2");

    expect(await screen.findByText("SB")).toBeInTheDocument();
  });
});

describe("a fixture not played yet (P5-45)", () => {
  // Given a fixture still to be played, with no players' lines yet,
  // when its page opens (from the schedule, or from a push),
  // then it counts down to kick-off, and claims neither a full time nor missing player details.
  it("counts down to kick-off instead of showing a full time", async () => {
    stage({ "GET v1/fixtures/fixture-1": ok({ fixture: fixture(1), players: [] }) });
    renderOnline("/online/fixtures/fixture-1");

    const timer = await screen.findByRole("timer", { name: "online.overview.kickoffIn" });
    expect(timer.textContent).not.toBe("");
    expect(screen.queryByText("match.fullTime")).not.toBeInTheDocument();
    expect(screen.queryByText("match.ft")).not.toBeInTheDocument();
    expect(screen.queryByText("online.fixture.noLines")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  // Given a fixture whose kick-off has passed but whose result is not in yet,
  // when its page opens,
  // then it names the kick-off time, still with no full time.
  it("names the kick-off once it has passed and the result is not in", async () => {
    stage({
      "GET v1/fixtures/fixture-1": ok({
        fixture: fixture(1, { status: "prepared", kickoffAt: "2000-01-01T11:00:00Z" }),
        players: [],
      }),
    });
    renderOnline("/online/fixtures/fixture-1");

    expect(await screen.findByText(/^online\.opponent\.kickoff:/)).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByText("match.fullTime")).not.toBeInTheDocument();
    expect(screen.queryByText("online.fixture.noLines")).not.toBeInTheDocument();
  });

  // Given a fixture whose result was voided,
  // when its page opens,
  // then it says so, as before, and counts down to nothing.
  it("keeps a voided fixture's own label", async () => {
    stage({
      "GET v1/fixtures/fixture-1": ok({
        fixture: fixture(1, { status: "void", kickoffAt: "2000-01-01T11:00:00Z" }),
        players: [],
      }),
    });
    renderOnline("/online/fixtures/fixture-1");

    expect(await screen.findByText("online.fixture.void")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByText(/^online\.opponent\.kickoff:/)).not.toBeInTheDocument();
  });
});
