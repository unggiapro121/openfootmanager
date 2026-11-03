import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import type { OnlineRequest } from "../../../services/onlineTransport";
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
import type { FixtureView, LeaderView, LeagueView } from "../../api";

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

const KEY = "online.league.phone";
const ME = { id: "club-1", name: "Cầu Vồng Nghệ An" };
const SONG = { id: "club-2", name: "Sóng Biển Đà Nẵng" };
const SAO = { id: "club-3", name: "Sao Mai" };

/** Two rounds played (14 fixtures done): Sóng Biển first, the coach's club second. */
const TABLE: LeagueView = {
  ...LEAGUE,
  fixturesDone: 14,
  promotionPlaces: 2,
  table: [
    { ...LEAGUE.table[0], position: 2 },
    {
      ...LEAGUE.table[0],
      position: 1,
      club: SONG,
      seat: "bot",
      won: 2,
      goalsFor: 6,
      goalsAgainst: 0,
      goalDifference: 6,
      points: 6,
    },
    {
      ...LEAGUE.table[0],
      position: 3,
      club: SAO,
      seat: "human",
      coach: { firstName: "Lan", lastName: "Trần", fullName: "Trần Lan" },
      won: 0,
      drawn: 1,
      lost: 1,
      goalsFor: 1,
      goalsAgainst: 4,
      goalDifference: -3,
      points: 1,
    },
  ],
};

function fixture(
  round: number,
  home: typeof ME,
  away: typeof ME,
  extra: Partial<FixtureView> = {},
) {
  return {
    id: `fx-${round}-${home.id}`,
    leagueId: "league-1",
    round,
    kickoffAt: "2099-01-01T11:00:00Z",
    status: "scheduled",
    home,
    away,
    ...extra,
  } satisfies FixtureView;
}

const settled = (homeGoals: number, awayGoals: number) =>
  ({ status: "settled", homeGoals, awayGoals }) as const;

/** Round 1: the coach's club beat Sao Mai; round 2: it drew with Sóng Biển; round 3 to come. */
const ROUNDS: Record<number, FixtureView[]> = {
  1: [fixture(1, SAO, ME, settled(0, 3))],
  2: [fixture(2, ME, SONG, settled(1, 1))],
  3: [fixture(3, SONG, SAO), fixture(3, ME, { id: "club-4", name: "Bình Minh" })],
};

const leader = (playerId: string, name: string, club: typeof ME, value: number): LeaderView => ({
  playerId,
  name,
  clubId: club.id,
  clubName: club.name,
  value,
});

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve() {
  const roundOf = (request: OnlineRequest) => Number(request.query?.[0]?.[1]);
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub({ nextFixture: ROUNDS[3][1] })),
    "GET v1/leagues/mine": ok(TABLE),
    "GET v1/leagues/league-1/fixtures": (request) =>
      ok({ round: roundOf(request), fixtures: ROUNDS[roundOf(request)] ?? [] }),
    "GET v1/leagues/league-1/leaders": ok({
      goals: [
        leader("p1", "Văn Hùng", SONG, 3),
        leader("p2", "Tuấn Kiệt", ME, 3),
        leader("p3", "Quốc Bảo", ME, 1),
      ],
      assists: [],
      cleanSheets: [],
      yellowCards: [],
      redCards: [],
    }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": fail(404, "be.error.notFound"),
  });
}

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
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
  realtime.restore();
  vi.unstubAllGlobals();
});

const where = () => screen.getByLabelText("location").textContent;
const tab = (name: string) => screen.getByRole("tab", { name });

async function open() {
  renderOnline("/online/league");
  return screen.findByRole("region", { name: "online.league.heading:Hạng 1 · A|1" });
}

describe("the league on a phone", () => {
  // Given a league two rounds in, the coach's club second on 6 points with a goal difference of 4,
  // when the league opens on a phone,
  // then a card sums it up: the rank, the points, how far the season is and the round.
  it("sums the league up for the coach's club", async () => {
    serve();
    const card = await open();

    expect(within(card).getByText("#2")).toBeInTheDocument();
    expect(within(card).getByText(`${KEY}.goalDiff:+4`)).toBeInTheDocument();
    expect(within(card).getByText("online.league.progress:14|182")).toBeInTheDocument();
    expect(within(card).getByText(`${KEY}.roundOf:3|26`)).toBeInTheDocument();
  });

  // Given the table,
  // when it shows,
  // then the clubs are in order with who runs each, the last two results of each, and only the
  // compact columns until the coach asks for the full table.
  it("shows the table compact, then in full", async () => {
    serve();
    await open();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);

    expect(rows.map((row) => within(row).getByRole("link").textContent)).toEqual([
      SONG.name,
      ME.name,
      SAO.name,
    ]);
    expect(within(rows[0]).getByText(`${KEY}.coachLine:online.league.bot`)).toBeInTheDocument();
    expect(within(rows[2]).getByText(`${KEY}.coachLine:Trần Lan`)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(rows[1])
          .getAllByText(/online\.schedule\.outcomeShort\./)
          .map((one) => one.textContent),
      ).toEqual(["online.schedule.outcomeShort.W", "online.schedule.outcomeShort.D"]),
    );
    expect(within(table).queryByRole("columnheader", { name: "common.won" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: `${KEY}.full` }));
    expect(within(table).getByRole("columnheader", { name: "common.won" })).toBeInTheDocument();
  });

  // Given the table,
  // when the coach taps a club,
  // then its page opens.
  it("opens a club from the table", async () => {
    serve();
    await open();
    fireEvent.click(within(screen.getByRole("table")).getByRole("link", { name: SAO.name }));
    await waitFor(() => expect(where()).toBe("/online/clubs/club-3"));
  });

  // Given round 3 still to play,
  // when the coach opens the rounds,
  // then round 3 shows with the coach's own match first; a step back shows round 2's result.
  it("shows a round's fixtures, the coach's own first", async () => {
    serve();
    await open();
    fireEvent.click(tab(`${KEY}.tabRounds`));

    const list = await screen.findByRole("list", { name: "online.fixture.round:3" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent(`${KEY}.yourMatch`);
    expect(cards[0]).toHaveTextContent("Bình Minh");

    fireEvent.click(screen.getByRole("button", { name: "online.league.previousRound" }));
    const second = await screen.findByRole("list", { name: "online.fixture.round:2" });
    expect(within(second).getByText("1–1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "2" })).toHaveAttribute("aria-selected", "true");
  });

  // Given scorers of the league, two level on three,
  // when the coach opens the stats and then keeps only their own players,
  // then the first leads with the tie said, and only the club's own scorers stay.
  it("shows who leads, and the club's own players only", async () => {
    serve();
    await open();
    fireEvent.click(tab(`${KEY}.tabStats`));

    const lead = await screen.findByRole("region", { name: `${KEY}.leader` });
    expect(within(lead).getByText("Văn Hùng")).toBeInTheDocument();
    expect(within(lead).getByText(`${KEY}.tiedWith:1`, { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: `${KEY}.mineOnly:${ME.name}` }));
    expect(within(screen.getByRole("region", { name: `${KEY}.leader` })).getByText("Tuấn Kiệt"));
    expect(screen.queryByText("Văn Hùng")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.catAssists` }));
    expect(screen.getByText(`${KEY}.noData`)).toBeInTheDocument();
  });
});
