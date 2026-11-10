import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../../hooks/usePhoneLayout";
import type { OnlineRequest } from "../../../../services/onlineTransport";
import {
  fakeRealtime,
  matchEvent,
  matchFrame,
  matchView,
  mineView,
} from "../../../../test-utils/onlineMatchKit";
import {
  type Answer,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../../test-utils/onlineTestKit";
import type { FixtureDetailView, MatchView, MineView, PlayerLine } from "../../../api";

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

vi.mock("../../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${typeof error === "string" ? error : (error as Error).message}`,
}));

vi.mock("../../../../components/match/radar/MatchRadar2D", () => ({
  MatchRadar2D: () => <output aria-label="radar" />,
}));

const MATCH = "match-1";
const KEY = "online.match.phone";

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

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

/** A player's line of the fixture's summary, 90 minutes at `rating`. */
function line(playerId: string, clubId: string, rating: number): PlayerLine {
  return {
    playerId,
    name: `P. ${playerId}`,
    clubId,
    minutes: 90,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    rating,
  };
}

const FIXTURE: FixtureDetailView = {
  fixture: {
    id: "fx-1",
    leagueId: "l-1",
    round: 28,
    kickoffAt: "2026-11-06T12:00:00Z",
    status: "settled",
    home: { id: "c-home", name: "Hà Nội FC" },
    away: { id: "c-away", name: "Hải Phòng" },
    homeGoals: 2,
    awayGoals: 1,
    matchId: MATCH,
    matchStatus: "finished",
  },
  players: [line("h9", "c-home", 8.4), line("h2", "c-home", 6.1), line("a9", "c-away", 7.2)],
};

function stage({
  mine = mineView(),
  view = matchView(),
  fixture = () => ok(FIXTURE),
}: {
  mine?: MineView | null;
  view?: MatchView;
  fixture?: () => Answer;
} = {}) {
  view.state = { ...view.state, minute: 88, phase: "SecondHalf", homeScore: 2, awayScore: 1 };
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    [`GET v1/matches/${MATCH}`]: () => ok(view),
    [`GET v1/matches/${MATCH}/mine`]: () =>
      mine === null ? { failure: { status: 404, code: "be.error.notFound" } } : ok(mine),
    [`GET v1/matches/${MATCH}/frames`]: () => ok({ frames: [] }),
    "GET v1/fixtures/fx-1": fixture,
  });
}

const requestsTo = (path: string) =>
  server.requests.filter((request: OnlineRequest) => request.segments.join("/") === path);

const EVENTS = [
  matchEvent("Goal", "Home", "h9", { minute: 34 }),
  matchEvent("RedCard", "Away", "a4", { minute: 60 }),
  matchEvent("PenaltyGoal", "Away", "a9", { minute: 71 }),
  matchEvent("Goal", "Home", "h9", { minute: 85 }),
];

/** The match, opened at 88 minutes, then over at 2–1. */
async function openAtFullTime() {
  renderOnline(`/online/match/${MATCH}`);
  await waitFor(() => expect(realtime.watches).toHaveLength(1));
  await screen.findByRole("region", { name: `${KEY}.title` });
  act(() =>
    realtime.push(
      MATCH,
      matchFrame(1, {
        result: {
          is_finished: true,
          phase: "Finished",
          minute: 90,
          home_score: 2,
          away_score: 1,
          events: EVENTS,
        },
      }),
    ),
  );
  return screen.findByRole("region", { name: "match.matchReport" });
}

const actions = () => screen.getByRole("navigation", { name: `${KEY}.afterMatch` });

describe("full time on a phone", () => {
  // Given the home side's coach on a phone, 2–1 up at 88 minutes,
  // when the referee blows for full time,
  // then a full screen shows the score, their win, each side's scorers with the minute (a penalty
  // marked) and the red card, the events tab open, and at the foot the replay and the ratings.
  it("shows the result at a glance", async () => {
    stage();
    const page = await openAtFullTime();

    expect(within(page).getByText("2 – 1")).toBeInTheDocument();
    expect(within(page).getByText("match.victory")).toBeInTheDocument();
    const home = within(page).getByRole("list", { name: `${KEY}.scorers:Hà Nội FC` });
    expect(
      within(home)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["P. h9 34', 85'"]);
    const away = within(page).getByRole("list", { name: `${KEY}.scorers:Hải Phòng` });
    expect(
      within(away)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([`P. a9 71' (${KEY}.penalty)`, "P. a4 60'"]);
    expect(within(away).getByRole("img", { name: "match.eventTypes.RedCard" })).toBeInTheDocument();
    expect(within(page).getByRole("tab", { name: "match.events" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(actions()).getByRole("link", { name: `${KEY}.ratings` })).toHaveAttribute(
      "href",
      "/online/fixtures/fx-1",
    );
    expect(screen.queryByText(`${KEY}.ordersFrom:90`)).toBeNull();
  });

  // Given the result on a phone,
  // when the coach taps the replay,
  // then the match is read again, now over, to open as a replay.
  it("opens the replay from the foot", async () => {
    stage();
    await openAtFullTime();
    const reads = requestsTo(`v1/matches/${MATCH}`).length;
    fireEvent.click(within(actions()).getByRole("button", { name: "online.replay.watch" }));
    await waitFor(() => expect(requestsTo(`v1/matches/${MATCH}`).length).toBeGreaterThan(reads));
  });

  // Given a spectator,
  // when the match ends,
  // then they see the scorers but no verdict of a side they do not hold, and no progress page.
  it("gives a spectator no verdict", async () => {
    stage({ mine: null });
    const page = await openAtFullTime();
    expect(within(page).getByRole("list", { name: `${KEY}.scorers:Hà Nội FC` })).toBeVisible();
    expect(within(page).queryByText("match.victory")).toBeNull();
    expect(within(actions()).queryByRole("link", { name: "online.progress.cta" })).toBeNull();
    expect(within(actions()).getByRole("link", { name: `${KEY}.ratings` })).toBeVisible();
  });

  // Given a coach of one side of a league match,
  // when it ends,
  // then the foot holds three ways on: the replay, the ratings, and his players' progress,
  // the last as the main one (C-22b, D-PG3).
  it("leads the coach to his players' progress", async () => {
    stage();
    await openAtFullTime();
    const foot = within(actions());
    const progress = foot.getByRole("link", { name: "online.progress.cta" });
    expect(progress).toHaveAttribute("href", "/online/fixtures/fx-1/progress");
    expect(progress.className).toContain("bg-primary-700");
    expect(foot.getByRole("link", { name: `${KEY}.ratings` }).className).not.toContain(
      "bg-primary-700",
    );
    expect(foot.getByRole("button", { name: "online.replay.watch" })).toBeVisible();
  });

  // Given a coach of a friendly, which has no fixture,
  // when it ends,
  // then the foot offers the way back to the friendly room, and no ratings.
  it("offers a friendly's way back at the foot", async () => {
    stage({ view: matchView({ kind: "friendly", fixtureId: undefined }) });
    await openAtFullTime();
    expect(
      within(actions()).getByRole("link", { name: "online.friendly.after.back" }),
    ).toHaveAttribute("href", "/online/friendly");
    expect(within(actions()).queryByRole("link", { name: `${KEY}.ratings` })).toBeNull();
    expect(within(actions()).queryByRole("link", { name: "online.progress.cta" })).toBeNull();
    expect(requestsTo("v1/fixtures/fx-1")).toHaveLength(0);
  });

  // Given a league match the server has settled with ratings,
  // when it ends,
  // then the man of the match shows on the result, and each player's rating in the line-ups.
  it("adds the man of the match and the ratings once settled", async () => {
    stage();
    const page = await openAtFullTime();
    expect(await within(page).findByText(/match\.motm/)).toHaveTextContent("P. h9 · 8.4");
    fireEvent.click(within(page).getByRole("tab", { name: "match.lineups" }));
    const home = within(page).getByRole("list", { name: "Hà Nội FC" });
    expect(within(home).getByText("8.4")).toBeInTheDocument();
  });

  // Given a league match not settled yet (the summary has no lines),
  // when it ends,
  // then the result shows without a man of the match, and no error.
  it("shows the result before the ratings come", async () => {
    stage({ fixture: () => ok({ ...FIXTURE, players: [] }) });
    const page = await openAtFullTime();
    await waitFor(() => expect(requestsTo("v1/fixtures/fx-1").length).toBeGreaterThan(0));
    expect(within(page).getByText("match.victory")).toBeInTheDocument();
    expect(within(page).queryByText(/match\.motm/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
