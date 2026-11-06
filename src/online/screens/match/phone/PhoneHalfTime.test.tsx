import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../../hooks/usePhoneLayout";
import type { OnlineRequest } from "../../../../services/onlineTransport";
import {
  fakeRealtime,
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
import type { MatchFrame, MineView } from "../../../api";
import { halfTimeSecondsLeft } from "../MatchStatusStrip";

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

function stage({ mine = mineView(), command }: { mine?: MineView | null; command?: Answer } = {}) {
  let sent = 0;
  const view = matchView();
  view.state = { ...view.state, minute: 20, phase: "FirstHalf", homeScore: 1, awayScore: 1 };
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    [`GET v1/matches/${MATCH}`]: () => ok(view),
    [`GET v1/matches/${MATCH}/mine`]: () =>
      mine === null ? { failure: { status: 404, code: "be.error.notFound" } } : ok(mine),
    [`GET v1/matches/${MATCH}/frames`]: () => ok({ frames: [] }),
    [`POST v1/matches/${MATCH}/commands`]: () => command ?? ok({ commandId: `cmd-${++sent}` }),
  });
}

const orders = () =>
  server.requests
    .filter(
      (request: OnlineRequest) => request.segments.join("/") === `v1/matches/${MATCH}/commands`,
    )
    .map((request) => (request.body as { command: unknown }).command);

function push(frame: MatchFrame) {
  act(() => realtime.push(MATCH, frame));
}

async function open() {
  renderOnline(`/online/match/${MATCH}`);
  await waitFor(() => expect(realtime.watches).toHaveLength(1));
  return screen.findByRole("region", { name: `${KEY}.title` });
}

const dock = () => screen.getByRole("navigation", { name: `${KEY}.dock` });

/** The break, reached once the match has opened at 20 minutes. */
async function openInTheBreak() {
  await open();
  push(matchFrame(1, { result: { phase: "HalfTime", minute: 45, home_score: 1, away_score: 1 } }));
  return screen.findByRole("region", { name: "match.halfTime" });
}

describe("the half-time break on a phone", () => {
  // Given the home side's coach on a phone,
  // when the referee blows for half time,
  // then a full screen shows the score, the countdown to the second half with the stats tab
  // open, and the same dock of four controls as in play, none of the desktop touchline.
  it("keeps the controls a tap away in the break", async () => {
    stage();
    const page = await openInTheBreak();

    expect(within(page).getByText("1 – 1")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(page).getByRole("timer", { name: `${KEY}.secondHalfIn` })).toHaveTextContent(
        "1:00",
      ),
    );
    expect(within(page).getByText("online.match.halfTimeHint")).toBeInTheDocument();
    expect(within(page).getByRole("tab", { name: "match.stats" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(dock()).getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByRole("complementary", { name: "online.match.touchline" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "match.firstHalfEvents" })).toBeNull();
  });

  // Given the break on a phone,
  // when it opens,
  // then the countdown is said once, in its card, not again as a line of the strip.
  it("counts the break down once", async () => {
    stage();
    const page = await openInTheBreak();
    await waitFor(() => expect(within(page).getByRole("timer")).toHaveTextContent("1:00"));
    expect(screen.queryByText(/online\.match\.halfTime:/)).toBeNull();
  });

  // Given the coach in the break,
  // when they tap counter-attack in the style sheet,
  // then the order is sent for their side.
  it("sends an order from the dock in the break", async () => {
    stage();
    await openInTheBreak();
    fireEvent.click(within(dock()).getByRole("button", { name: /online\.match\.phone\.style/ }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "match.playStyle" })).getByRole("radio", {
        name: /common\.playStyles\.Counter/,
      }),
    );
    await waitFor(() =>
      expect(orders()).toEqual([{ ChangePlayStyle: { side: "Home", play_style: "Counter" } }]),
    );
  });

  // Given a spectator,
  // when the match reaches half time,
  // then they see the countdown but no dock.
  it("gives a spectator the countdown without controls", async () => {
    stage({ mine: null });
    const page = await openInTheBreak();
    expect(within(page).getByRole("timer", { name: `${KEY}.secondHalfIn` })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: `${KEY}.dock` })).toBeNull();
  });

  // Given the break on a phone,
  // when the second half kicks off,
  // then the live match comes back with its radar.
  it("goes back to the radar for the second half", async () => {
    stage();
    await openInTheBreak();
    push(matchFrame(2, { result: { phase: "SecondHalf", minute: 46 } }));
    expect(await screen.findByRole("region", { name: `${KEY}.title` })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "match.halfTime" })).toBeNull();
  });
});

describe("halfTimeSecondsLeft", () => {
  // Given a one-minute break that began 45.2 s ago, then one long over,
  // when the seconds left are counted,
  // then they round up to 15, and never go below 0.
  it("rounds the seconds left up and stops at zero", () => {
    expect(halfTimeSecondsLeft(1_000, 60_000, 46_200)).toBe(15);
    expect(halfTimeSecondsLeft(1_000, 60_000, 90_000)).toBe(0);
  });
});
