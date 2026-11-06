import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../../hooks/usePhoneLayout";
import type { OnlineRequest } from "../../../../services/onlineTransport";
import { matchEvent, matchFrame, matchView } from "../../../../test-utils/onlineMatchKit";
import {
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../../test-utils/onlineTestKit";
import type { MatchFrame, MatchView } from "../../../api";
import OnlineApp from "../../OnlineApp";

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

vi.mock("../../../../components/match/radar/MatchRadar2D", () => ({
  MatchRadar2D: () => <output aria-label="radar" />,
}));

const MATCH = "match-1";
const KEY = "online.match.phone";

/** A whole match: kick-off, a home goal at 34', the break, an away red card at 60', the end. */
const FRAMES: MatchFrame[] = [
  matchFrame(1, { result: { minute: 1, events: [matchEvent("KickOff", "Home", null)] } }),
  matchFrame(2, {
    result: {
      minute: 34,
      home_score: 1,
      events: [matchEvent("Goal", "Home", "h9", { minute: 34 })],
    },
  }),
  matchFrame(3, {
    result: {
      minute: 45,
      home_score: 1,
      phase: "HalfTime",
      events: [matchEvent("HalfTime", "Home", null, { minute: 45 })],
    },
  }),
  matchFrame(4, {
    result: {
      minute: 60,
      home_score: 1,
      phase: "SecondHalf",
      events: [matchEvent("RedCard", "Away", "a4", { minute: 60 })],
    },
  }),
  matchFrame(5, {
    result: { minute: 90, home_score: 1, phase: "Finished", is_finished: true },
  }),
];

function finished(): MatchView {
  const view = matchView({ status: "finished", lastSeq: 5 });
  view.state = { ...view.state, isFinished: true, phase: "Finished", minute: 90, homeScore: 1 };
  return view;
}

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  resetOnline();
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
  vi.unstubAllGlobals();
});

const atSeqOf = (request: OnlineRequest) => request.query?.find(([name]) => name === "atSeq")?.[1];

function stage(view: MatchView = finished()) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    [`GET v1/matches/${MATCH}`]: (request) =>
      atSeqOf(request) === "0" ? ok(matchView({ status: "finished" })) : ok(view),
    [`GET v1/matches/${MATCH}/mine`]: fail(404, "be.error.notFound"),
    [`GET v1/matches/${MATCH}/frames`]: ok({ frames: FRAMES }),
    "GET v1/fixtures/fx-1": ok({
      fixture: {
        id: "fx-1",
        leagueId: "l-1",
        round: 1,
        kickoffAt: "2026-11-06T12:00:00Z",
        status: "settled",
        home: { id: "c-home", name: "Hà Nội FC" },
        away: { id: "c-away", name: "Hải Phòng" },
        homeGoals: 1,
        awayGoals: 0,
      },
      players: [],
    }),
  });
}

async function opened() {
  renderOnline(`/online/match/${MATCH}`);
  return screen.findByRole("region", { name: "online.replay.title" });
}

const dock = () => screen.getByRole("region", { name: "online.replay.controls" });
const scrubber = () => within(dock()).getByRole("slider", { name: "online.replay.jump" });

describe("a replay on a phone", () => {
  // Given a finished league match,
  // when its replay opens on a phone,
  // then a full screen shows it from the kick-off, 0–0, marked as a replay, with the events tab
  // open and the controls at the foot: restart, pause (it plays at once) and the three speeds.
  it("opens over the whole screen with the controls at the foot", async () => {
    stage();
    const page = await opened();

    expect(within(page).getByText("0 – 0")).toBeInTheDocument();
    expect(within(page).getByText(`${KEY}.replayChip`)).toBeInTheDocument();
    expect(within(page).getByRole("tab", { name: "match.events" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(dock()).getByRole("button", { name: "online.replay.pause" })).toBeInTheDocument();
    expect(
      within(dock()).getByRole("button", { name: "online.replay.restart" }),
    ).toBeInTheDocument();
    expect(within(dock()).getAllByRole("button", { name: /online\.replay\.times/ })).toHaveLength(
      3,
    );
  });

  // Given the replay on a phone,
  // when it opens,
  // then the scrubber marks the goal (34') and the red card (60'), but nothing else.
  it("marks the goals and red cards on the scrubber", async () => {
    stage();
    await opened();
    const marks = within(dock())
      .getAllByRole("img")
      .map((mark) => mark.getAttribute("aria-label"));
    expect(marks).toEqual(["match.eventTypes.Goal 34'", "match.eventTypes.RedCard 60'"]);
  });

  // Given the replay on a phone,
  // when the coach drags the scrubber to 40' and lets go,
  // then it shows 40' while dragging without moving the match, and moves there on release.
  it("seeks when the scrubber is let go", async () => {
    stage();
    const page = await opened();

    fireEvent.pointerDown(scrubber());
    fireEvent.change(scrubber(), { target: { value: "40" } });
    expect(within(dock()).getByText("40'")).toBeInTheDocument();
    expect(within(page).getByText("0 – 0")).toBeInTheDocument();

    fireEvent.pointerUp(scrubber());
    expect(within(page).getByText("1 – 0")).toBeInTheDocument();
  });

  // Given a league replay seen to the end,
  // when it reaches the final step,
  // then the controls offer to watch again from the start and the ratings, and the first goes
  // back to the kick-off.
  it("offers a restart and the ratings at the end", async () => {
    stage();
    const page = await opened();
    fireEvent.change(scrubber(), { target: { value: "90" } });

    expect(within(dock()).getByRole("link", { name: `${KEY}.ratings` })).toHaveAttribute(
      "href",
      "/online/fixtures/fx-1",
    );
    fireEvent.click(within(dock()).getByRole("button", { name: "online.replay.fromStart" }));
    expect(within(page).getByText("0 – 0")).toBeInTheDocument();
  });

  // Given a replay opened from the fixture's page,
  // when the coach taps the back arrow,
  // then they are back on the fixture's page, not the online home.
  it("goes back to where the replay was opened from", async () => {
    stage();
    function Where() {
      return <output aria-label="where">{useLocation().pathname}</output>;
    }
    render(
      <MemoryRouter
        initialEntries={["/online/fixtures/fx-1", `/online/match/${MATCH}`]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/online/*" element={<OnlineApp />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
    const page = await screen.findByRole("region", { name: "online.replay.title" });
    fireEvent.click(within(page).getByRole("button", { name: `${KEY}.leave` }));
    expect(await screen.findByText("/online/fixtures/fx-1")).toBeInTheDocument();
  });
});
