import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RadarMatch } from "../../../components/match/radar/radarMatch";
import type { RadarPacing } from "../../../components/match/radar/useRadarDirector";
import type { OnlineRequest } from "../../../services/onlineTransport";
import {
  fakeRealtime,
  matchEvent,
  matchFrame,
  matchView,
  projectedPlayer,
} from "../../../test-utils/onlineMatchKit";
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
import type { MatchFrame, MatchView } from "../../api";

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
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

let mounts = 0;

// The radar draws on a canvas; here it shows what it was handed (and which mount of it), and says
// when it is done, or that it is still behind.
vi.mock("../../../components/match/radar/MatchRadar2D", () => ({
  MatchRadar2D: ({
    snapshot,
    pacing,
    paused,
    onCaughtUp,
    onToggle,
  }: {
    snapshot: RadarMatch;
    pacing?: RadarPacing;
    paused: boolean;
    onCaughtUp?: (staged: number) => void;
    onToggle: () => void;
  }) => <FakeRadar {...{ snapshot, pacing, paused, onCaughtUp, onToggle }} />,
}));

function FakeRadar({
  snapshot,
  pacing,
  paused,
  onCaughtUp,
  onToggle,
}: {
  snapshot: RadarMatch;
  pacing?: RadarPacing;
  paused: boolean;
  onCaughtUp?: (staged: number) => void;
  onToggle: () => void;
}) {
  const [mount] = useState(() => ++mounts);
  return (
    <div>
      <output aria-label="radar">
        {JSON.stringify({
          mount,
          minute: snapshot.current_minute,
          timeScale: pacing?.timeScale,
          paused,
          slotNine: snapshot.home_team.players[9]?.id,
        })}
      </output>
      <button type="button" onClick={() => onCaughtUp?.(snapshot.events.length)}>
        radar played out
      </button>
      <button type="button" onClick={() => onCaughtUp?.(0)}>
        radar behind
      </button>
      <button type="button" onClick={onToggle}>
        radar toggle
      </button>
    </div>
  );
}

const MATCH = "match-1";
const ROUTE = `/online/match/${MATCH}`;

const FRAMES: MatchFrame[] = [
  matchFrame(1, { result: { minute: 1, events: [matchEvent("KickOff", "Home", null)] } }),
  matchFrame(2, {
    result: { minute: 2, home_score: 1, events: [matchEvent("Goal", "Home", "h9")] },
  }),
  matchFrame(3, {
    gapInputs: [
      {
        kind: "command",
        side: "Home",
        source: "Manager",
        command: { Substitute: { side: "Home", player_off_id: "h9", player_on_id: "hs1" } },
      },
    ],
    gapEvents: [matchEvent("Substitution", "Home", "hs1", { secondary_player_id: "h9" })],
    result: { minute: 3, home_score: 1 },
  }),
  matchFrame(4, { result: { minute: 45, home_score: 1, phase: "HalfTime" } }),
  matchFrame(5, {
    result: { minute: 90, home_score: 1, phase: "Finished", is_finished: true },
  }),
];

function finished(): MatchView {
  const view = matchView({ status: "finished", lastSeq: 5 });
  view.state = { ...view.state, isFinished: true, phase: "Finished", minute: 90, homeScore: 1 };
  return view;
}

function afterSubstitution(): MatchView {
  const view = matchView({ status: "finished", lastSeq: 3 });
  view.home = {
    ...view.home,
    players: view.home.players.map((player) =>
      player.id === "h9"
        ? projectedPlayer("h9", undefined)
        : player.id === "hs1"
          ? projectedPlayer("hs1", 9)
          : player,
    ),
  };
  view.state = { ...view.state, homeSubsMade: 1 };
  return view;
}

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;
let clock = 0;
let tick = 1000;

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
  clock = 0;
  tick = 1000;
  // Each step stays a moment on screen; the test's clock moves `tick` at each look.
  vi.spyOn(Date, "now").mockImplementation(() => {
    clock += tick;
    return clock;
  });
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const atSeqOf = (request: OnlineRequest) => request.query?.find(([name]) => name === "atSeq")?.[1];

function stage(frames: MatchFrame[] = FRAMES) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    [`GET v1/matches/${MATCH}`]: (request) => {
      const at = atSeqOf(request);
      if (at === "0") return ok(matchView({ status: "finished" }));
      if (at === "3") return ok(afterSubstitution());
      return ok(finished());
    },
    [`GET v1/matches/${MATCH}/mine`]: fail(404, "be.error.notFound"),
    [`GET v1/matches/${MATCH}/frames`]: ok({ frames }),
  });
}

const radar = () => JSON.parse(screen.getByRole("status", { name: "radar" }).textContent ?? "{}");
const minuteShown = () =>
  screen.getByRole("heading", { level: 2, name: /online\.match\.scoreLine/ }).textContent;
const playedOut = () => fireEvent.click(screen.getByRole("button", { name: "radar played out" }));

async function opened() {
  renderOnline(ROUTE);
  await screen.findByRole("region", { name: "online.replay.controls" });
}

describe("replaying a finished match", () => {
  // Given a finished match whose home side made a substitution before step 3,
  // when it is opened,
  // then it is replayed, not followed: the match is read as it kicked off, its frames, and its
  // sides at step 3; the replay starts at kick-off with nothing watched.
  it("opens at kick-off and reads what the replay needs", async () => {
    stage();
    await opened();
    expect(radar()).toMatchObject({ minute: 0, slotNine: "h9" });
    expect(minuteShown()).toContain("0'");
    expect(realtime.watches).toHaveLength(0);
    const reads = server.requests
      .filter((request) => request.segments.join("/") === `v1/matches/${MATCH}`)
      .map(atSeqOf);
    expect(reads.sort()).toEqual(["0", "3", undefined]);
  });

  // Given a replay at kick-off,
  // when the radar plays each step out,
  // then it is handed the next step first, the screen follows once it is played, and the
  // substitute stands in h9's slot from step 3.
  it("moves on as the radar plays each step out", async () => {
    stage();
    await opened();
    playedOut();
    expect(radar().minute).toBe(1);
    expect(minuteShown()).toContain("0'");
    playedOut();
    expect(minuteShown()).toContain("1'");
    expect(radar().minute).toBe(2);
    playedOut();
    expect(radar()).toMatchObject({ minute: 3, slotNine: "hs1" });
    expect(minuteShown()).toContain("2'");
  });

  // Given a replay whose radar was handed step 1,
  // when the radar says it is done before it has taken step 1's events in,
  // then the screen waits for it.
  it("waits for the radar to take a step in", async () => {
    stage();
    await opened();
    playedOut();
    fireEvent.click(screen.getByRole("button", { name: "radar behind" }));
    expect(minuteShown()).toContain("0'");
    expect(radar().minute).toBe(1);
  });

  // Given a replay whose steps come quicker than a step may pass,
  // when the radar is done again at once,
  // then the next step waits its moment on screen.
  it("keeps each step on screen a moment", async () => {
    stage();
    await opened();
    playedOut();
    tick = 100;
    playedOut();
    expect(minuteShown()).toContain("1'");
    expect(radar().minute).toBe(1);
  });

  // Given a replay playing,
  // when it is paused,
  // then the radar holds still and a played-out radar brings nothing more.
  it("holds still while paused", async () => {
    stage();
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "online.replay.pause" }));
    expect(radar().paused).toBe(true);
    playedOut();
    expect(radar().minute).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "online.replay.play" }));
    playedOut();
    expect(radar().minute).toBe(1);
  });

  // Given a replay at 1×,
  // when 4× is chosen,
  // then the radar plays four times as fast.
  it("plays faster", async () => {
    stage();
    await opened();
    const normal = radar().timeScale;
    fireEvent.click(screen.getByRole("button", { name: "online.replay.times:4" }));
    expect(radar().timeScale).toBeCloseTo(normal / 4);
    expect(screen.getByRole("button", { name: "online.replay.times:4" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  // Given a replay at kick-off,
  // when the viewer jumps to minute 40, then back to minute 1,
  // then the screen and the radar land on half time (the first step to reach 40) with the
  // substitute on, then on step 1.
  it("jumps to a minute and back", async () => {
    stage();
    await opened();
    fireEvent.change(screen.getByRole("slider", { name: "online.replay.jump" }), {
      target: { value: "40" },
    });
    expect(minuteShown()).toContain("45'");
    const before = radar().mount;
    expect(radar()).toMatchObject({ minute: 45, slotNine: "hs1" });
    expect(screen.getByText(/online\.match\.scoreLine:.*\|1\|0/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "online.replay.jump" }), {
      target: { value: "1" },
    });
    expect(radar()).toMatchObject({ minute: 1, slotNine: "h9" });
    expect(radar().mount).toBeGreaterThan(before);
  });

  // Given a replay one step from the end,
  // when the radar plays the last step out,
  // then the replay stops at full time with the result's link, and playing again starts over.
  it("stops at full time, and plays again from kick-off", async () => {
    stage();
    await opened();
    fireEvent.change(screen.getByRole("slider", { name: "online.replay.jump" }), {
      target: { value: "45" },
    });
    playedOut();
    playedOut();
    playedOut();
    expect(minuteShown()).toContain("90'");
    expect(screen.getByRole("link", { name: "online.match.seeResult" })).toHaveAttribute(
      "href",
      "/online/fixtures/fx-1",
    );
    expect(screen.getByRole("button", { name: "online.replay.play" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "online.replay.play" }));
    expect(radar().minute).toBe(0);
  });

  // Given a replay whose radar was handed step 1,
  // when the radar is closed, and then a second passes at 1×, twice,
  // then step 1 shows at once, and each second brings the next step without a radar.
  it("moves on by itself with the radar closed", async () => {
    stage();
    await opened();
    playedOut();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(screen.getByRole("button", { name: "radar toggle" }));
    expect(minuteShown()).toContain("1'");
    act(() => vi.advanceTimersByTime(1000));
    expect(minuteShown()).toContain("2'");
    act(() => vi.advanceTimersByTime(1000));
    expect(minuteShown()).toContain("3'");
  });

  // Given a finished match whose frames are no longer all kept,
  // when it is opened,
  // then the viewer is told it is too old to replay and pointed to its result.
  it("says when a match is too old to replay", async () => {
    stage([FRAMES[0], FRAMES[1]]);
    renderOnline(ROUTE);
    expect(await screen.findByText("online.replay.gone")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "online.match.seeResult" })).toBeInTheDocument();
  });
});

describe("the way in", () => {
  // Given a match that is over,
  // when its result page is open,
  // then it offers the replay.
  it("offers the replay from the result", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
      "GET v1/fixtures/fx-1": ok({
        fixture: {
          id: "fx-1",
          leagueId: "league-1",
          round: 1,
          kickoffAt: "2026-10-23T12:00:00Z",
          status: "settled",
          home: { id: "club-1", name: "Hà Nội FC" },
          away: { id: "club-2", name: "Hải Phòng" },
          homeGoals: 1,
          awayGoals: 0,
          matchId: MATCH,
          matchStatus: "finished",
        },
        players: [],
      }),
    });
    renderOnline("/online/fixtures/fx-1");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "online.replay.watch" })).toHaveAttribute(
        "href",
        ROUTE,
      ),
    );
  });
});
