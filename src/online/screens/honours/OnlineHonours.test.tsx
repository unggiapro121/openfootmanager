import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AwardView, ClubHonoursView, ClubSeasonView, TrophyView } from "../../api";
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
  squadPlayer,
} from "../../../test-utils/onlineTestKit";
import { SEEN_KEY } from "./TrophyLift";

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

const MINE = { id: "club-1", name: "Cầu Vồng Nghệ An" };
const RIVAL = { id: "club-2", name: "Sóng Biển Đà Nẵng" };
const ME = { name: "Lê Tấn", mine: true };

function trophy(kind: string, season: number, level: number, coach?: typeof ME): TrophyView {
  return {
    id: `${kind}-${season}`,
    kind,
    place: { seasonNumber: season, region: "AsiaSoutheast", level, tier: 0 },
    club: MINE,
    coach,
  };
}

function award(kind: string, playerName: string, value: number): AwardView {
  return {
    id: `${kind}-${playerName}`,
    kind,
    place: { seasonNumber: 2, region: "AsiaSoutheast", level: 1, tier: 0 },
    club: MINE,
    playerId: "gk",
    playerName,
    value,
    matches: 26,
  };
}

function seasonLine(season: number, extra: Partial<ClubSeasonView> = {}): ClubSeasonView {
  return {
    place: { seasonNumber: season, region: "AsiaSoutheast", level: 1, tier: 0 },
    leagueName: "Hạng 1 · A",
    clubName: MINE.name,
    position: 1,
    played: 26,
    won: 20,
    drawn: 4,
    lost: 2,
    goalsFor: 60,
    goalsAgainst: 20,
    points: 64,
    promoted: true,
    champion: true,
    ...extra,
  };
}

function honours(extra: Partial<ClubHonoursView> = {}): ClubHonoursView {
  return {
    club: MINE,
    trophies: [],
    awards: [],
    seasons: [],
    records: {},
    ...extra,
  };
}

const FULL = honours({
  trophies: [
    trophy("leagueTitle", 2, 1, ME),
    trophy("promotion", 2, 1, ME),
    trophy("leagueTitle", 1, 1),
  ],
  awards: [award("topScorer", "Văn Hùng", 21)],
  seasons: [
    seasonLine(2, { coach: ME, topScorer: { playerId: "st", name: "Văn Hùng", goals: 21 } }),
  ],
  records: {
    mostPoints: { seasonNumber: 2, level: 1, value: 64 },
    biggestWin: { seasonNumber: 2, opponentName: RIVAL.name, goalsFor: 5, goalsAgainst: 0 },
  },
  defendingChampion: trophy("leagueTitle", 2, 1, ME),
});

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/clubs/mine/fixtures": ok({ fixtures: [] }),
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    ...more,
  });
}

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
  localStorage.removeItem(SEEN_KEY);
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

const where = () => screen.getByLabelText("location").textContent;

describe("the trophy room", () => {
  // Given the coach's club with two level-1 titles (one under the AI), a promotion, an award, a
  // season and records,
  // when its trophy room opens,
  // then it shows the defending champion's line, the titles once ×2 with who won each, the
  // promotion, the award, the season and the records.
  it("shows the cabinet, the awards, the seasons and the records", async () => {
    serve({ "GET v1/clubs/club-1/honours": ok(FULL) });
    renderOnline("/online/honours");

    expect(await screen.findByText("online.honours.defendingLine:1|2")).toBeInTheDocument();
    const titles = screen.getByRole("listitem", { name: "online.honours.kinds.leagueTitle:1" });
    expect(within(titles).getByText("×2")).toBeInTheDocument();
    expect(
      within(titles).getByText("online.honours.wonIn:2|online.honours.youCoach:Lê Tấn"),
    ).toBeInTheDocument();
    expect(
      within(titles).getByText("online.honours.wonIn:1|online.honours.aiCoach"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "online.honours.kinds.promotion:1" }),
    ).toBeInTheDocument();
    expect(screen.getByText("online.honours.awards.topScorer")).toBeInTheDocument();
    expect(screen.getByText("Văn Hùng (21)")).toBeInTheDocument();
    expect(screen.getByText("online.honours.recordValue.mostPoints:64|2")).toBeInTheDocument();
    expect(
      screen.getByText(`online.honours.recordValue.match:5|0|${RIVAL.name}|2`),
    ).toBeInTheDocument();
  });

  // Given the coach's club with a title under him and one under the AI,
  // when he keeps the cabinet to his own,
  // then only his title is left.
  it("keeps the cabinet to the coach's own", async () => {
    serve({ "GET v1/clubs/club-1/honours": ok(FULL) });
    renderOnline("/online/honours");

    const titles = await screen.findByRole("listitem", {
      name: "online.honours.kinds.leagueTitle:1",
    });
    fireEvent.click(screen.getByRole("button", { name: "online.honours.filterMine" }));
    await waitFor(() => expect(within(titles).queryByText("×2")).toBeNull());
    expect(
      screen.queryByRole("listitem", { name: "online.honours.kinds.promotion:1" }),
    ).not.toBeNull();
  });

  // Given a club that has won nothing yet,
  // when its trophy room opens,
  // then the cabinet says what to win for the first trophy, at the league's level.
  it("tells a club with no trophy what to win", async () => {
    serve({ "GET v1/clubs/club-1/honours": ok(honours()) });
    renderOnline("/online/honours");

    expect(await screen.findByText("online.honours.emptyCabinet:1")).toBeInTheDocument();
    expect(screen.getByText("online.honours.noAwards")).toBeInTheDocument();
    expect(screen.getByText("online.honours.noSeasons")).toBeInTheDocument();
    expect(screen.getByText("online.honours.noRecords")).toBeInTheDocument();
  });

  // Given another club's trophy room,
  // when it opens from that club's page,
  // then it reads that club's honours, offers no "under me" filter and leads back to the club.
  it("opens another club's room from its page, read only", async () => {
    serve({
      "GET v1/clubs/club-2": ok({
        club: { ...myClub().club, ...RIVAL },
        formation: "4-4-2",
        players: [],
      }),
      "GET v1/clubs/club-2/honours": ok(
        honours({ club: RIVAL, trophies: [trophy("leagueTitle", 1, 1)] }),
      ),
    });
    renderOnline("/online/clubs/club-2");

    fireEvent.click(await screen.findByRole("link", { name: "online.honours.title" }));
    expect(
      await screen.findByRole("listitem", { name: "online.honours.kinds.leagueTitle:1" }),
    ).toBeInTheDocument();
    expect(where()).toBe("/online/clubs/club-2/honours");
    expect(screen.queryByRole("button", { name: "online.honours.filterMine" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "online.honours.toClub" }));
    await waitFor(() => expect(where()).toBe("/online/clubs/club-2"));
  });

  // Given a club the server does not know,
  // when its trophy room opens,
  // then the page says it could not be read, and nothing breaks.
  it("says so when the club is unknown", async () => {
    serve({ "GET v1/clubs/ghost/honours": fail(404, "be.error.notFound") });
    renderOnline("/online/clubs/ghost/honours");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("the trophy-lift screen", () => {
  // Given a title won under the coach that he has not seen lifted,
  // when the overview opens, he closes the screen and the overview opens again,
  // then the screen shows the first time only.
  it("shows a new title once", async () => {
    const mine = { trophies: [trophy("leagueTitle", 2, 1, ME)], titles: 1, promotions: 0 };
    serve({ "GET v1/me/honours": ok(mine) });
    const first = renderOnline("/online");

    const dialog = await screen.findByRole("dialog", { name: "online.honours.lift.title" });
    expect(
      within(dialog).getByText(`online.honours.lift.body:${MINE.name}|1|2`),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "online.honours.lift.close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    first.unmount();

    renderOnline("/online");
    await waitFor(() =>
      expect(server.requests.filter((r) => r.segments.join("/") === "v1/me/honours")).toHaveLength(
        2,
      ),
    );
    expect(screen.queryByRole("dialog", { name: "online.honours.lift.title" })).toBeNull();
  });

  // Given a new title,
  // when the coach takes the screen's way to the trophy room,
  // then the trophy room opens.
  it("leads to the trophy room", async () => {
    serve({
      "GET v1/me/honours": ok({
        trophies: [trophy("leagueTitle", 2, 1, ME)],
        titles: 1,
        promotions: 0,
      }),
      "GET v1/clubs/club-1/honours": ok(FULL),
    });
    renderOnline("/online");

    const dialog = await screen.findByRole("dialog", { name: "online.honours.lift.title" });
    fireEvent.click(within(dialog).getByRole("button", { name: "online.honours.open" }));
    await waitFor(() => expect(where()).toBe("/online/honours"));
  });
});

describe("a player's honours", () => {
  // Given one player with an award and another with none,
  // when each one's page opens,
  // then the first shows the honours card and the second has none.
  it("shows a player's awards, and no card without any", async () => {
    serve({
      "GET v1/clubs/mine": ok(
        myClub({ players: [squadPlayer({ id: "gk" }), squadPlayer({ id: "cb", fullName: "B" })] }),
      ),
      "GET v1/players/gk/honours": ok({ honours: [award("goldenGlove", "Thủ Môn", 12)] }),
      "GET v1/players/cb/honours": ok({ honours: [] }),
    });
    const first = renderOnline("/online/squad/gk");

    expect(await screen.findByText("online.honours.playerTitle")).toBeInTheDocument();
    expect(screen.getByText("online.honours.awards.goldenGlove")).toBeInTheDocument();
    first.unmount();

    renderOnline("/online/squad/cb");
    await waitFor(() =>
      expect(server.requests.some((r) => r.segments.join("/") === "v1/players/cb/honours")).toBe(
        true,
      ),
    );
    expect(screen.queryByText("online.honours.playerTitle")).toBeNull();
  });
});

describe("the league's champions", () => {
  // Given two closed seasons at the league's level,
  // when the league page opens,
  // then the champions card lists them newest first, the AI's marked so.
  it("lists the level's champions", async () => {
    serve({
      "GET v1/leagues/league-1/champions": ok({
        level: 1,
        champions: [
          trophy("leagueTitle", 2, 1, ME),
          { ...trophy("leagueTitle", 1, 1), club: RIVAL },
        ],
      }),
      "GET v1/leagues/league-1/fixtures": ok({ round: 1, fixtures: [] }),
    });
    renderOnline("/online/league");

    const list = await screen.findByRole("list", { name: "online.honours.championsTitle:1" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => within(item).getByRole("link").textContent)).toEqual([
      MINE.name,
      RIVAL.name,
    ]);
    expect(within(items[1]).getByText("online.honours.aiCoach")).toBeInTheDocument();
  });
});
