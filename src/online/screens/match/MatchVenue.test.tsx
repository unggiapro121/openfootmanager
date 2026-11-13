import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import { fakeRealtime, matchFrame, matchView, mineView } from "../../../test-utils/onlineMatchKit";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";
import type { MatchView, VenueView } from "../../api";

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

// The radar draws on a canvas, which jsdom has not: a stand-in names it.
vi.mock("../../../components/match/radar/MatchRadar2D", () => ({
  MatchRadar2D: () => <output aria-label="radar" />,
}));

const MATCH = "match-1";
const VENUE: VenueView = {
  stadiumName: "Sân Vinh",
  attendance: 9_000,
  capacity: 9_000,
  soldOut: true,
  lockedOut: 1_300,
};

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function stage(view: MatchView) {
  view.state = { ...view.state, minute: 88, phase: "SecondHalf", homeScore: 2, awayScore: 1 };
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    [`GET v1/matches/${MATCH}`]: () => ok(view),
    [`GET v1/matches/${MATCH}/mine`]: () => ok(mineView()),
    [`GET v1/matches/${MATCH}/frames`]: () => ok({ frames: [] }),
    "GET v1/fixtures/fx-1": () =>
      ok({
        fixture: {
          id: "fx-1",
          leagueId: "l-1",
          round: 3,
          kickoffAt: "2026-11-06T12:00:00Z",
          status: "settled",
          home: { id: "c-home", name: "Hà Nội FC" },
          away: { id: "c-away", name: "Hải Phòng" },
          homeGoals: 2,
          awayGoals: 1,
          matchId: MATCH,
          matchStatus: "finished",
        },
        players: [],
        venue: VENUE,
        atmosphere: "electric",
      }),
  });
}

async function liveThenOver() {
  renderOnline(`/online/match/${MATCH}`);
  await waitFor(() => expect(realtime.watches).toHaveLength(1));
  const before = screen.queryByText("online.match.attendance.line:Sân Vinh|9,000");
  act(() =>
    realtime.push(
      MATCH,
      matchFrame(1, {
        result: { is_finished: true, phase: "Finished", minute: 90, home_score: 2, away_score: 1 },
      }),
    ),
  );
  return before;
}

function phoneWindow() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.unstubAllGlobals();
});

describe("a league match's crowd (c-27 §7.2, T11)", () => {
  // Given a league match with its crowd, on a desktop,
  // when it is played, then over,
  // then the strip names the ground and crowd while it is played, and the report has the crowd,
  // sold out, the fans left outside and the atmosphere's word.
  it.each([
    ["a desktop", () => undefined],
    ["a phone", phoneWindow],
  ])("shows the crowd live and at full time on %s", async (_case, setUp) => {
    setUp();
    stage(matchView({ venue: VENUE, atmosphere: "lively" }));

    const live = await liveThenOver();
    expect(live).not.toBeNull();
    const report = await screen.findByRole("region", { name: "online.match.attendance.title" });
    expect(
      within(report).getByText("online.match.attendance.count:9,000|9,000|Sân Vinh"),
    ).toBeTruthy();
    expect(within(report).getByText("online.match.attendance.lockedOut:1,300")).toBeTruthy();
    expect(within(report).getByTestId("atmosphere").textContent).toBe(
      "online.match.attendance.atmosphere.lively",
    );
  });

  // Given a friendly, which the server sends no crowd for,
  // when it is played, then over,
  // then no line or block names a crowd.
  it("shows no crowd for a friendly", async () => {
    stage(matchView({ kind: "friendly", fixtureId: undefined, venue: null }));

    const live = await liveThenOver();
    expect(live).toBeNull();
    await screen.findByText("match.fullTime");
    expect(screen.queryByRole("region", { name: "online.match.attendance.title" })).toBeNull();
  });

  // Given a league match played,
  // when its fixture's page opens,
  // then it has the crowd and the atmosphere's word.
  it("shows the crowd on the fixture's page", async () => {
    stage(matchView());
    renderOnline("/online/fixtures/fx-1");

    const block = await screen.findByRole("region", { name: "online.match.attendance.title" });
    expect(within(block).getByTestId("atmosphere").textContent).toBe(
      "online.match.attendance.atmosphere.electric",
    );
  });
});
