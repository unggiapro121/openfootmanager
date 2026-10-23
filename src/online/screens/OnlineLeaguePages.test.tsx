import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
      coach: { firstName: "Lan", lastName: "Trần" },
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
    expect(within(rows[2]).getByText("Lan Trần")).toBeInTheDocument();

    fireEvent.click(within(rows[2]).getByRole("button", { name: "Sao Mai" }));
    expect(await screen.findByText("online.publicClub.formation:4-3-3")).toBeInTheDocument();
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
    stage({
      "GET v1/leagues/league-1/fixtures": (request) => {
        const round = roundOf(request);
        const settled =
          round === 1
            ? { status: "settled", homeGoals: 2, awayGoals: 0 }
            : round === 2
              ? { status: "settled", homeGoals: 0, awayGoals: 1 }
              : {};
        return ok({ round, fixtures: [fixture(round, settled)] });
      },
    });
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

    expect(await screen.findByRole("heading", { level: 2, name: /2 – 1/ })).toHaveTextContent(
      "Cầu Vồng Nghệ An 2 – 1 Sóng Biển Đà Nẵng",
    );
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
        players: [{ id: "p", fullName: "Cường", position: "Striker", age: 21, ovr: 66 }],
      }),
    });
    renderOnline("/online/clubs/club-2");

    expect(await screen.findByText("Cường")).toBeInTheDocument();
    expect(screen.getByText("online.publicClub.botCoach")).toBeInTheDocument();
    expect(screen.getByLabelText("location")).toHaveTextContent("/online/clubs/club-2");
  });
});

describe("the overview's latest result", () => {
  // Given a club whose next match is in round 3,
  // when the overview opens,
  // then it reads round 2 only and shows the club's result there.
  it("reads the round before the next match", async () => {
    stage({
      "GET v1/leagues/league-1/fixtures": (request) =>
        ok({
          round: roundOf(request),
          fixtures: [fixture(roundOf(request), { status: "settled", homeGoals: 3, awayGoals: 1 })],
        }),
    });
    renderOnline("/online");

    expect(
      await screen.findByRole("link", { name: /online\.fixture\.openResult/ }),
    ).toHaveTextContent("3 – 1");
    await waitFor(() =>
      expect(
        server.requests
          .filter((request) => request.segments.join("/") === "v1/leagues/league-1/fixtures")
          .map(roundOf),
      ).toEqual([2]),
    );
  });
});
