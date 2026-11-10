import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RadarMatch } from "../../../components/match/radar/radarMatch";
import type { RadarPacing } from "../../../components/match/radar/useRadarDirector";
import type { OnlineRequest } from "../../../services/onlineTransport";
import {
  fakeRealtime,
  matchEvent,
  matchFrame,
  matchView,
  mineView,
  projectedPlayer,
} from "../../../test-utils/onlineMatchKit";
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
import type { FriendlyMineView, MatchFrame, MatchView, MineView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";

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
    `resolved:${typeof error === "string" ? error : (error as Error).message}`,
}));

/** The radar's own hooks, so a test can say how far it has played the match. */
const radarHooks = vi.hoisted(() => ({
  onPlayed: undefined as ((played: number) => void) | undefined,
  onToggle: undefined as (() => void) | undefined,
}));

// The radar draws on a canvas; here it shows what it was handed, and plays out only what a test
// says it has (`radarHooks.onPlayed`).
vi.mock("../../../components/match/radar/MatchRadar2D", () => ({
  MatchRadar2D: ({
    snapshot,
    pacing,
    onPlayed,
    onToggle,
  }: {
    snapshot: RadarMatch;
    pacing?: RadarPacing;
    onPlayed?: (played: number) => void;
    onToggle: () => void;
  }) => {
    radarHooks.onPlayed = onPlayed;
    radarHooks.onToggle = onToggle;
    return (
      <output aria-label="radar">
        {JSON.stringify({
          events: snapshot.events.length,
          score: `${snapshot.home_score}-${snapshot.away_score}`,
          maxLagMs: pacing?.maxLagMs,
          minuteMs: pacing?.minuteMs,
          homeDials: snapshot.home_team.tactics ?? null,
          awayDials: snapshot.away_team.tactics ?? null,
          homeEleven: snapshot.home_team.players.map((player) => player.id),
        })}
      </output>
    );
  },
}));

const MATCH = "match-1";
const ROUTE = `/online/match/${MATCH}`;
/** The length of a step in `matchView()`. */
const STEP_MS = 2000;

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

interface Staged {
  view?: MatchView | (() => MatchView);
  mine?: MineView | null;
  frames?: MatchFrame[];
  command?: Answer;
}

function stage({ view = matchView(), mine = mineView(), frames = [], command }: Staged = {}) {
  let sent = 0;
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    [`GET v1/matches/${MATCH}`]: () => ok(typeof view === "function" ? view() : view),
    [`GET v1/matches/${MATCH}/mine`]: () =>
      mine === null ? fail(404, "be.error.notFound") : ok(mine),
    [`GET v1/matches/${MATCH}/frames`]: (request: OnlineRequest) => {
      const after = Number(request.query?.find(([name]) => name === "afterSeq")?.[1] ?? 0);
      return ok({ frames: frames.filter((frame) => frame.seq > after) });
    },
    [`POST v1/matches/${MATCH}/commands`]: () => command ?? ok({ commandId: `cmd-${++sent}` }),
  });
}

/** The viewer's friendly: in the room of match `matchId`, at `status`. */
function inRoomOf(matchId: string, status: "playing" | "finished"): FriendlyMineView {
  const side = {
    club: myClub().club,
    strengthTop18: 70,
    coach: { firstName: "An", lastName: "Trần", fullName: "Trần An" },
    ready: false,
  };
  return {
    seat: {
      state: "room",
      room: {
        id: "room-1",
        kind: "private",
        code: "K7Q-2MX",
        status,
        leg: 1,
        me: "host",
        host: side,
        guest: side,
        home: "host",
        matchId,
      },
    },
  };
}

const radar = () => JSON.parse(screen.getByRole("status", { name: "radar" }).textContent ?? "{}");

async function opened() {
  renderOnline(ROUTE);
  await waitFor(() => expect(realtime.watches).toHaveLength(1));
}

function push(frame: MatchFrame) {
  act(() => realtime.push(MATCH, frame));
}

const requestsTo = (path: string) =>
  server.requests.filter((request) => request.segments.join("/") === path);

describe("opening a match", () => {
  // Given a match at step 2 with a goal in its history, opened by the home side's coach,
  // when the screen opens,
  // then it reads the view, the coach's side and the frames, follows the match from step 2,
  // shows the score, and gives the radar the coach's own dials only, paced at two steps.
  it("reads the match, then follows it from the view's step", async () => {
    const view = matchView({ lastSeq: 2 });
    view.state = { ...view.state, minute: 2, phase: "FirstHalf", homeScore: 1 };
    stage({
      view,
      frames: [
        matchFrame(1),
        matchFrame(2, {
          result: { events: [matchEvent("Goal", "Home", "h9")], home_score: 1 },
        }),
      ],
    });
    await opened();
    expect(realtime.watches[0]).toMatchObject({ channel: `match:${MATCH}`, lastSeq: 2 });
    expect(radar()).toMatchObject({
      score: "1-0",
      maxLagMs: 6000,
      minuteMs: 2000,
      homeDials: { defensive_line: "High", width: "Wide" },
      awayDials: null,
    });
    expect(screen.getByText("online.match.youCoach")).toBeInTheDocument();
    expect(screen.queryByText("match.noMajorEvents")).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "online.match.touchline" })).toBeVisible();
  });

  // Given a coach who is not a side's coach (the server answers `/mine` with 404),
  // when they open the match,
  // then they watch it as a spectator: who holds each side, no touchline, no dials.
  it("lets anyone watch, without a touchline", async () => {
    stage({ mine: null });
    await opened();
    expect(
      screen.getByText(/match\.spectatorMode.*online\.match\.byCoach.*online\.match\.byAi/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "online.match.touchline" }),
    ).not.toBeInTheDocument();
    expect(radar()).toMatchObject({ homeDials: null, awayDials: null });
  });

  // Given a coach following their league match, at home,
  // when the referee blows for full time with their side 2-1 up,
  // then the radar gives way to the match report: their verdict, the key events, the stats and
  // the line-ups, the link to the result, and a way to watch the replay, which reads the match
  // again (now over, it opens as a replay).
  it("opens the match report at full time", async () => {
    stage();
    await opened();

    push(
      matchFrame(1, {
        result: { is_finished: true, phase: "Finished", home_score: 2, away_score: 1 },
      }),
    );

    expect(await screen.findByRole("heading", { name: "match.matchReport" })).toBeInTheDocument();
    expect(screen.getByText("match.victory")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "match.keyEvents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "online.match.seeResult" })).toBeInTheDocument();
    // A straight way to what the match did to their players (PO N4).
    expect(screen.getByRole("link", { name: "online.progress.cta" })).toHaveAttribute(
      "href",
      "/online/fixtures/fx-1/progress",
    );
    expect(screen.queryByRole("status", { name: "radar" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "online.match.touchline" }),
    ).not.toBeInTheDocument();
    const reads = requestsTo(`v1/matches/${MATCH}`).length;
    fireEvent.click(screen.getByRole("button", { name: "online.replay.watch" }));
    await waitFor(() => expect(requestsTo(`v1/matches/${MATCH}`).length).toBeGreaterThan(reads));
  });

  // Given a coach following their match,
  // when the referee blows for half time, then for the second half,
  // then the radar (frozen in the break) gives way to the half-time screen — the first half's key
  // events and stats, the line-ups, the countdown and the touchline to make changes with — and
  // the radar comes back when the second half starts.
  it("opens the half-time screen in the break", async () => {
    stage();
    await opened();

    push(matchFrame(1, { result: { phase: "HalfTime", minute: 45 } }));

    expect(await screen.findByRole("heading", { name: "match.halfTime" })).toBeInTheDocument();
    expect(screen.getByText("online.match.halfTimeHint")).toBeInTheDocument();
    expect(await screen.findByText(/online\.match\.halfTime:/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "match.firstHalfEvents" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "online.match.touchline" })).toBeVisible();
    expect(screen.getByRole("button", { name: /match\.subs/ })).toBeEnabled();
    expect(screen.queryByRole("status", { name: "radar" })).not.toBeInTheDocument();

    push(matchFrame(2, { result: { phase: "SecondHalf", minute: 46 } }));

    expect(await screen.findByRole("status", { name: "radar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "match.halfTime" })).not.toBeInTheDocument();
  });

  // Given a spectator of a league match,
  // when it reaches full time,
  // then they get the result but no progress page: the players are not theirs (C-22b, N4).
  it("offers a spectator no progress page at full time", async () => {
    stage({ mine: null });
    await opened();

    push(matchFrame(1, { result: { is_finished: true, phase: "Finished" } }));

    expect(await screen.findByRole("link", { name: "online.match.seeResult" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "online.progress.cta" })).not.toBeInTheDocument();
  });

  // Given a spectator of a match,
  // when it reaches half time,
  // then they see the half-time screen without a touchline.
  it("shows a spectator the break without a touchline", async () => {
    stage({ mine: null });
    await opened();

    push(matchFrame(1, { result: { phase: "HalfTime", minute: 45 } }));

    expect(await screen.findByRole("heading", { name: "match.halfTime" })).toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "online.match.touchline" }),
    ).not.toBeInTheDocument();
  });

  // Given a friendly (no fixture) followed live by one of its coaches,
  // when the referee blows for full time,
  // then the strip says full time and offers a rematch and the way back to the friendly room —
  // not a league result, which a friendly has none of.
  it("offers a way out when a friendly watched live reaches full time", async () => {
    stage({ view: matchView({ kind: "friendly", fixtureId: undefined }) });
    await opened();
    act(() => useOnlineStore.setState({ friendly: inRoomOf(MATCH, "playing") }));

    push(matchFrame(1, { result: { is_finished: true } }));

    expect(await screen.findByText("match.fullTime")).toBeInTheDocument();
    const rematch = screen.getByRole("button", { name: "online.friendly.room.rematch" });
    expect(rematch).toBeDisabled();
    act(() => useOnlineStore.setState({ friendly: inRoomOf(MATCH, "finished") }));
    expect(rematch).toBeEnabled();
    expect(screen.getByRole("link", { name: "online.friendly.after.back" })).toHaveAttribute(
      "href",
      "/online/friendly",
    );
    expect(screen.queryByRole("link", { name: "online.match.seeResult" })).not.toBeInTheDocument();
  });

  // Given a coach of a friendly whose opponent already asked for a rematch (the room is full again,
  // leg 2, no match yet),
  // when their match reaches full time,
  // then they still get the way back to the room and the rematch, which now means getting ready.
  it("keeps the way back when the opponent asked for a rematch first", async () => {
    stage({ view: matchView({ kind: "friendly", fixtureId: undefined }) });
    await opened();
    const asked = inRoomOf(MATCH, "finished");
    if (asked.seat?.state === "room") {
      asked.seat.room = { ...asked.seat.room, status: "full", leg: 2, matchId: undefined };
    }
    act(() => useOnlineStore.setState({ friendly: asked }));

    push(matchFrame(1, { result: { is_finished: true } }));

    expect(await screen.findByRole("link", { name: "online.friendly.after.back" })).toHaveAttribute(
      "href",
      "/online/friendly",
    );
    expect(screen.getByRole("button", { name: "online.friendly.room.rematch" })).toBeEnabled();
  });

  // Given a coach of a friendly whose room has already closed,
  // when their match reaches full time,
  // then they get the way back to the friendlies, and no rematch.
  it("keeps the way back when the room has closed", async () => {
    stage({ view: matchView({ kind: "friendly", fixtureId: undefined }) });
    await opened();
    act(() => useOnlineStore.setState({ friendly: {} }));

    push(matchFrame(1, { result: { is_finished: true } }));

    expect(
      await screen.findByRole("link", { name: "online.friendly.after.back" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "online.friendly.room.rematch" }),
    ).not.toBeInTheDocument();
  });

  // Given a coach of a finished friendly whose room has moved on (the other coach asked for a
  // rematch: leg 2, no match yet),
  // when they watch its replay,
  // then the replay's controls carry the way back to the room.
  it("keeps the way back in a friendly's replay", async () => {
    const view = matchView({
      kind: "friendly",
      fixtureId: undefined,
      status: "finished",
      lastSeq: 1,
    });
    view.state = { ...view.state, isFinished: true, phase: "Finished" };
    stage({ view, frames: [matchFrame(1, { result: { is_finished: true } })] });
    const asked = inRoomOf(MATCH, "finished");
    if (asked.seat?.state === "room") {
      asked.seat.room = { ...asked.seat.room, status: "full", leg: 2, matchId: undefined };
    }
    renderOnline(ROUTE);
    const controls = await screen.findByRole("region", { name: "online.replay.controls" });
    act(() => useOnlineStore.setState({ friendly: asked }));

    expect(
      await within(controls).findByRole("link", { name: "online.friendly.after.back" }),
    ).toHaveAttribute("href", "/online/friendly");
  });

  // Given a friendly someone outside its room watches (anyone with its id may),
  // when it reaches full time,
  // then they are offered neither a rematch nor the room: neither is theirs.
  it("offers a spectator of a friendly no rematch", async () => {
    stage({ view: matchView({ kind: "friendly", fixtureId: undefined }), mine: null });
    await opened();

    push(matchFrame(1, { result: { is_finished: true } }));

    expect(await screen.findByText("match.fullTime")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "online.friendly.room.rematch" }),
    ).not.toBeInTheDocument();
  });

  // Given a finished match,
  // when it is opened,
  // then it is read and not followed, says full time, and links to the result.
  it("reads a finished match without following it", async () => {
    const view = matchView({ status: "finished", lastSeq: 1 });
    view.state = { ...view.state, isFinished: true, phase: "Finished" };
    stage({ view, frames: [matchFrame(1, { result: { is_finished: true } })] });
    renderOnline(ROUTE);
    expect(await screen.findByText("match.fullTime")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "online.match.seeResult" })).toHaveAttribute(
      "href",
      "/online/fixtures/fx-1",
    );
    expect(realtime.watches).toHaveLength(0);
    expect(
      screen.queryByRole("complementary", { name: "online.match.touchline" }),
    ).not.toBeInTheDocument();
  });

  // Given an open match screen,
  // when the coach leaves it,
  // then the watch stops.
  it("stops following when the screen closes", async () => {
    stage();
    const { unmount } = renderOnline(ROUTE);
    await waitFor(() => expect(realtime.watches).toHaveLength(1));
    unmount();
    await waitFor(() => expect(realtime.watches[0].stopped).toBe(true));
  });
});

describe("following a match", () => {
  // Given a match followed from kick-off,
  // when frame 1 brings a goal,
  // then the score moves.
  it("moves the score with each frame", async () => {
    stage();
    await opened();
    push(matchFrame(1, { result: { home_score: 1, events: [matchEvent("Goal", "Home", "h9")] } }));
    await waitFor(() => expect(radar().score).toBe("1-0"));
  });

  // Given a match at step 1,
  // when frame 3 arrives before frame 2,
  // then the missed frame is read from step 1 and both are applied.
  it("reads a missed frame again", async () => {
    const frames = [
      matchFrame(1),
      matchFrame(2, { result: { away_score: 1 } }),
      matchFrame(3, { result: { away_score: 1, home_score: 1 } }),
    ];
    stage({ frames });
    await opened();
    push(frames[0]);
    push(frames[2]);
    await waitFor(() => expect(radar().score).toBe("1-1"));
    const reads = requestsTo(`v1/matches/${MATCH}/frames`);
    expect(reads[reads.length - 1]?.query).toContainEqual(["afterSeq", "1"]);
  });

  describe("when the frames stop coming", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    // Given a match followed from kick-off whose realtime brings nothing after step 1,
    // when three steps pass with no frame while the server has played on to step 3,
    // then the frames are read from the server and the score moves on.
    it("reads the frames itself when none come for a while", async () => {
      const frames = [matchFrame(1)];
      stage({ frames });
      await opened();
      push(frames[0]);
      frames.push(
        matchFrame(2, { result: { away_score: 1 } }),
        matchFrame(3, { result: { away_score: 1, home_score: 1 } }),
      );
      await act(() => vi.advanceTimersByTimeAsync(4 * STEP_MS));
      await waitFor(() => expect(radar().score).toBe("1-1"));
    });

    // Given a match whose frames keep coming, one a step,
    // when several steps pass,
    // then the frames are never read from the server.
    it("does not read frames while they keep coming", async () => {
      stage();
      await opened();
      for (let seq = 1; seq <= 5; seq++) {
        push(matchFrame(seq));
        await act(() => vi.advanceTimersByTimeAsync(STEP_MS));
      }
      expect(requestsTo(`v1/matches/${MATCH}/frames`)).toHaveLength(0);
    });

    // Given a match at half time, a one-minute break,
    // when three steps pass with no frame,
    // then the frames are not read: the break is not a frame missed.
    it("waits out the half-time break", async () => {
      stage();
      await opened();
      push(matchFrame(1, { result: { phase: "HalfTime" } }));
      await act(() => vi.advanceTimersByTimeAsync(10 * STEP_MS));
      expect(requestsTo(`v1/matches/${MATCH}/frames`)).toHaveLength(0);
    });
  });

  // Given a match whose away side makes a substitution in the gap before step 1,
  // when frame 1 tells of it,
  // then the sides are read again from the view and the radar draws the new eleven.
  it("reads the sides again after a change everyone sees", async () => {
    let view = matchView();
    stage({ view: () => view });
    await opened();
    const changed = matchView({ lastSeq: 1 });
    changed.home = {
      ...changed.home,
      players: changed.home.players.map((player) =>
        player.id === "h10"
          ? projectedPlayer("h10", undefined)
          : player.id === "hs1"
            ? projectedPlayer("hs1", 10)
            : player,
      ),
    };
    view = changed;
    push(
      matchFrame(1, {
        gapInputs: [
          {
            kind: "command",
            side: "Home",
            source: "Ai",
            command: { Substitute: { side: "Home", player_off_id: "h10", player_on_id: "hs1" } },
          },
        ],
      }),
    );
    await waitFor(() => expect(radar().homeEleven[10]).toBe("hs1"));
  });

  // Given the away side adjusting its dials out of sight,
  // when the frame tells of it,
  // then the events say so in one line, with nothing of what changed.
  it("says when the other side adjusted its tactics", async () => {
    stage();
    await opened();
    push(
      matchFrame(1, {
        gapInputs: [{ kind: "tacticalAdjustment", side: "Away", source: "Manager" }],
      }),
    );
    expect(await screen.findByText(/online\.match\.adjusted:Hải Phòng/)).toBeInTheDocument();
  });
});

describe("the screen keeps to the radar", () => {
  /** The radar says it has played out `count` of the match's events. */
  const played = (count: number) => act(() => radarHooks.onPlayed?.(count));
  /** The score line the scoreboard reads out. */
  const score = (home: number, away: number) =>
    new RegExp(`^online\\.match\\.scoreLine:.*\\|${home}\\|${away}$`);

  // Given a coach following their match with the radar caught up,
  // when frame 1 brings a home goal the radar has not played yet,
  // then the radar is handed the goal but the scoreboard and the minute stay where the radar is,
  // with a line saying where the match itself is; once the radar has played it, the score moves.
  it("moves the score only once the radar has played the goal", async () => {
    stage();
    await opened();
    played(radar().events);
    push(matchFrame(1, { result: { home_score: 1, events: [matchEvent("Goal", "Home", "h9")] } }));

    await waitFor(() => expect(radar().score).toBe("1-0"));
    expect(screen.getByText(score(0, 0))).toBeInTheDocument();
    expect(screen.getByText("online.match.serverMinute:1")).toBeInTheDocument();

    played(radar().events);

    expect(await screen.findByText(score(1, 0))).toBeInTheDocument();
    expect(screen.queryByText(/online\.match\.serverMinute/)).not.toBeInTheDocument();
  });

  // Given a coach following their match with the radar behind,
  // when the server reaches half time,
  // then the radar stays up until it has played the half out, then the half-time screen opens.
  it("opens the half-time screen once the radar has played the half out", async () => {
    stage();
    await opened();
    played(radar().events);
    push(matchFrame(1, { result: { events: [matchEvent("ShotSaved", "Home", "h9")] } }));
    push(matchFrame(2, { result: { phase: "HalfTime", minute: 45 } }));

    await waitFor(() => expect(radar().events).toBeGreaterThan(0));
    expect(screen.queryByRole("heading", { name: "match.halfTime" })).not.toBeInTheDocument();

    played(radar().events);

    expect(await screen.findByRole("heading", { name: "match.halfTime" })).toBeInTheDocument();
  });

  // Given a coach following their match with the radar behind a goal,
  // when they close the radar,
  // then nothing is left to wait for: the score shows the server's match at once.
  it("shows the server's match at once with the radar closed", async () => {
    stage();
    await opened();
    played(radar().events);
    push(matchFrame(1, { result: { home_score: 1, events: [matchEvent("Goal", "Home", "h9")] } }));
    await waitFor(() => expect(radar().score).toBe("1-0"));
    expect(screen.getByText(score(0, 0))).toBeInTheDocument();

    act(() => radarHooks.onToggle?.());

    expect(await screen.findByText(score(1, 0))).toBeInTheDocument();
  });
});

describe("who holds the side", () => {
  // Given a coach who opens the match while the AI holds their side,
  // when the next frame hands it to them, then a later one hands it back to the AI,
  // then the strip says it is being taken, then that they hold it, then that the AI does.
  it("follows the controllers of the coach's side", async () => {
    const view = matchView();
    view.state = { ...view.state, controllers: { home: "Ai", away: "Ai" } };
    stage({ view });
    await opened();
    expect(screen.getByText(/online\.match\.takingCharge/)).toBeInTheDocument();
    push(matchFrame(1, { controllers: { home: "Manager", away: "Ai" } }));
    expect(await screen.findByText("online.match.youCoach")).toBeInTheDocument();
    push(matchFrame(2, { controllers: { home: "Ai", away: "Ai" } }));
    expect(await screen.findByText(/online\.match\.aiCoaches/)).toBeInTheDocument();
  });
});

describe("the injury window and the break", () => {
  // Given a match with a window of three steps of two seconds,
  // when the coach's player h5 is hurt in step 1,
  // then the strip counts six seconds and its button opens the substitutions panel with him
  // chosen to come off.
  it("counts down the time to replace a hurt player", async () => {
    stage();
    await opened();
    push(matchFrame(1, { result: { events: [matchEvent("Injury", "Home", "h5")] } }));
    expect(await screen.findByText("online.match.hurt:P. h5|6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "online.match.replace" }));
    expect(await screen.findByText("match.takingOff:P. h5")).toBeInTheDocument();
  });

  // Given a match of a one-minute break,
  // when it reaches half time,
  // then the strip counts down the break.
  it("counts down the half-time break", async () => {
    stage();
    await opened();
    push(matchFrame(1, { result: { phase: "HalfTime" } }));
    expect(await screen.findByText("online.match.halfTime:60")).toBeInTheDocument();
  });
});

describe("orders", () => {
  /** Through the game's own substitutions panel: open it, choose h9 to come off and hs1 to go on. */
  async function substitute() {
    fireEvent.click(screen.getByRole("button", { name: /match\.subs/ }));
    fireEvent.click(await screen.findByTestId("sub-panel-off-h9"));
    fireEvent.click(screen.getByTestId("sub-panel-bench-hs1"));
    fireEvent.click(screen.getByRole("button", { name: /match\.confirmSubstitution/ }));
  }

  // Given the coach of the home side,
  // when they take h9 off for hs1,
  // then the order is sent for their side and listed as waiting for the next minute.
  it("sends a substitution and shows it waiting", async () => {
    stage();
    await opened();
    await substitute();
    await waitFor(() => expect(requestsTo(`v1/matches/${MATCH}/commands`)).toHaveLength(1));
    expect(requestsTo(`v1/matches/${MATCH}/commands`)[0].body).toEqual({
      command: { Substitute: { side: "Home", player_off_id: "h9", player_on_id: "hs1" } },
    });
    const sent = await screen.findByRole("region", { name: "online.match.sent.title" });
    expect(within(sent).getByText("online.match.sent.pending")).toBeInTheDocument();
  });

  // Given the coach of the home side playing 4-4-2,
  // when they switch to 4-3-3 and then to a counter-attacking style,
  // then each change is sent as an order for their side.
  it("sends a change of shape and of style", async () => {
    stage();
    await opened();
    expect(screen.getByRole("button", { name: "4-4-2" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "4-3-3" }));
    await waitFor(() => expect(requestsTo(`v1/matches/${MATCH}/commands`)).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "common.playStyles.Counter" }));
    await waitFor(() => expect(requestsTo(`v1/matches/${MATCH}/commands`)).toHaveLength(2));
    expect(requestsTo(`v1/matches/${MATCH}/commands`).map((request) => request.body)).toEqual([
      { command: { ChangeFormation: { side: "Home", formation: "4-3-3" } } },
      { command: { ChangePlayStyle: { side: "Home", play_style: "Counter" } } },
    ]);
  });

  // Given the substitutions panel opened from the touchline,
  // when the coach switches the shape from inside it and closes it,
  // then the shape is sent as an order for their side, and the panel is gone.
  it("changes the shape from inside the substitutions panel and closes it", async () => {
    stage();
    await opened();
    fireEvent.click(screen.getByRole("button", { name: /match\.subs/ }));
    expect(await screen.findByText("match.substitutionsTitle")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "tactics.formation" }));
    fireEvent.click(screen.getByRole("option", { name: "3-5-2" }));

    await waitFor(() => expect(requestsTo(`v1/matches/${MATCH}/commands`)).toHaveLength(1));
    expect(requestsTo(`v1/matches/${MATCH}/commands`)[0].body).toEqual({
      command: { ChangeFormation: { side: "Home", formation: "3-5-2" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByText("match.substitutionsTitle")).toBeNull();
  });

  // Given the match refusing an order sent from inside the panel,
  // when the coach sends it,
  // then the reason is shown over the panel, which stays open for another try.
  it("shows a refusal over the substitutions panel and keeps it open", async () => {
    stage({ command: fail(429, "be.error.match.tooManyCommands") });
    await opened();
    fireEvent.click(screen.getByRole("button", { name: /match\.subs/ }));
    fireEvent.click(await screen.findByRole("combobox", { name: "tactics.formation" }));
    fireEvent.click(screen.getByRole("option", { name: "3-5-2" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("online.match.orderRefused");
    expect(screen.getByText("match.substitutionsTitle")).toBeInTheDocument();
  });

  // Given the coach's side read at kick-off with h9 fresh, and the match then saying he is at 47,
  // when four steps pass, then the fifth,
  // then the coach's side is read again only at the fifth, and the substitutions panel shows h9's
  // condition as the match now has it.
  it("reads the coach's side every fifth step and shows each player's condition now", async () => {
    let mine = mineView({ roles: [{ playerId: "h9", role: "Standard", condition: 100 }] });
    stage({ mine });
    server.routes[`GET v1/matches/${MATCH}/mine`] = () => ok(mine);
    await opened();
    const reads = () => requestsTo(`v1/matches/${MATCH}/mine`).length;
    const first = reads();
    mine = mineView({ roles: [{ playerId: "h9", role: "Standard", condition: 47 }] });

    for (const seq of [1, 2, 3, 4]) push(matchFrame(seq));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads()).toBe(first);
    push(matchFrame(5));
    await waitFor(() => expect(reads()).toBe(first + 1));

    fireEvent.click(screen.getByRole("button", { name: /match\.subs/ }));
    const row = await screen.findByTestId("sub-panel-off-h9");
    await waitFor(() => expect(row).toHaveTextContent("47"));
  });

  // Given a substitution the match refuses,
  // when the frame deciding it comes,
  // then the coach's side is read again and the order shows why it was refused.
  it("shows why an order was refused", async () => {
    let mine = mineView();
    stage({ mine });
    server.routes[`GET v1/matches/${MATCH}/mine`] = () => ok(mine);
    await opened();
    await substitute();
    await screen.findByText("online.match.sent.pending");
    mine = mineView({
      commands: [
        {
          commandId: "cmd-1",
          command: { Substitute: { side: "Home", player_off_id: "h9", player_on_id: "hs1" } },
          status: "refused",
          refusal: "be.error.liveMatch.playerNotOnBench",
          sentAt: "2026-10-23T12:00:30Z",
        },
      ],
    });
    push(matchFrame(1, { commands: [{ commandId: "cmd-1", status: "refused" }] }));
    expect(
      await screen.findByText(
        "online.match.sent.refusedWhy:resolved:be.error.liveMatch.playerNotOnBench",
      ),
    ).toBeInTheDocument();
  });

  // Given more orders than the match takes at once,
  // when the coach sends another,
  // then the server's refusal is shown and nothing is listed as sent.
  it("shows the server's refusal to take an order", async () => {
    stage({ command: fail(429, "be.error.match.tooManyCommands") });
    await opened();
    await substitute();
    expect(await screen.findByRole("alert")).toHaveTextContent("resolved:");
    expect(screen.queryByRole("region", { name: "online.match.sent.title" })).toBeNull();
  });
});

describe("the side's own orders", () => {
  const commands = () => requestsTo(`v1/matches/${MATCH}/commands`).map((request) => request.body);

  // Given the coach of the home side holding the first licence in this match (S-9),
  // when they open the shapes, the styles and h9's roles,
  // then only the shapes and styles the licence opens are offered, and of a midfielder's roles
  // only Standard.
  it("offers only the orders the side's licence opens", async () => {
    stage({
      mine: mineView({
        roles: [{ playerId: "h9", role: "Standard", condition: 90 }],
        licence: {
          tier: 1,
          formations: ["4-4-2", "4-3-3", "3-5-2"],
          playStyles: ["Balanced", "Attacking", "Defensive"],
          dials: [],
          roles: [],
        },
      }),
    });
    await opened();
    expect(screen.getByRole("button", { name: "4-3-3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "4-2-3-1" })).toBeNull();
    expect(screen.getByRole("button", { name: "common.playStyles.Attacking" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.playStyles.Counter" })).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "online.match.rolePlayer" }));
    fireEvent.click(screen.getByRole("option", { name: "10. P. h9" }));
    fireEvent.click(screen.getByRole("combobox", { name: "online.match.roleChoice" }));
    expect(screen.queryByRole("option", { name: "tactics.playerRoles.BoxToBox" })).toBeNull();
    expect(
      screen.getByRole("option", { name: "tactics.playerRoles.Standard" }),
    ).toBeInTheDocument();
  });

  // Given the coach of the home side, h9 a midfielder playing as Standard and h0 the keeper,
  // when they pick h9 and look at the roles, then pick Box-to-Box and change his role,
  // then only midfield roles are offered (none of a keeper's or a striker's), his own role is
  // the one shown, and the change is sent as an order for their side.
  it("changes a player's role among those of his position", async () => {
    stage({
      mine: mineView({
        roles: [
          { playerId: "h9", role: "Standard", condition: 90 },
          { playerId: "h0", role: "SweeperKeeper", condition: 90 },
        ],
      }),
    });
    await opened();
    fireEvent.click(screen.getByRole("combobox", { name: "online.match.rolePlayer" }));
    fireEvent.click(screen.getByRole("option", { name: "10. P. h9" }));
    const role = screen.getByRole("combobox", { name: "online.match.roleChoice" });
    expect(role).toHaveTextContent("tactics.playerRoles.Standard");
    fireEvent.click(role);
    expect(screen.queryByRole("option", { name: "tactics.playerRoles.SweeperKeeper" })).toBeNull();
    expect(screen.queryByRole("option", { name: "tactics.playerRoles.Poacher" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "tactics.playerRoles.BoxToBox" }));
    fireEvent.click(screen.getByRole("button", { name: "online.match.changeRole" }));

    await waitFor(() => expect(commands()).toHaveLength(1));
    expect(commands()[0]).toEqual({
      command: { ChangePlayerRole: { side: "Home", player_id: "h9", role: "BoxToBox" } },
    });
  });

  // Given the coach of the home side, h5 the captain, h3 sent off,
  // when they look at the captain's choices, name h9 captain and h8 the penalty taker,
  // then the current captain is shown, only players on the pitch are offered (not h3, not the
  // bench), and each change is sent at once as an order for their side, listed in words.
  it("names the captain and the set-piece takers from the players on the pitch", async () => {
    stage({
      view: matchView({ state: { ...matchView().state, sentOff: ["h3"] } }),
      mine: mineView({
        setPieces: {
          captain: "h5",
          free_kick_taker: null,
          corner_taker: null,
          penalty_taker: null,
        },
      }),
    });
    await opened();
    const captain = screen.getByRole("combobox", { name: "match.captain" });
    expect(captain).toHaveTextContent("6. P. h5");
    fireEvent.click(captain);
    expect(screen.queryByRole("option", { name: "4. P. h3" })).toBeNull();
    expect(screen.queryByRole("option", { name: "20. P. hs1" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "10. P. h9" }));
    await waitFor(() => expect(commands()).toHaveLength(1));
    fireEvent.click(screen.getByRole("combobox", { name: "match.penaltyTaker" }));
    fireEvent.click(screen.getByRole("option", { name: "9. P. h8" }));
    await waitFor(() => expect(commands()).toHaveLength(2));

    expect(commands()).toEqual([
      { command: { SetCaptain: { side: "Home", player_id: "h9" } } },
      { command: { SetPenaltyTaker: { side: "Home", player_id: "h8" } } },
    ]);
    const sent = await screen.findByRole("region", { name: "online.match.sent.title" });
    expect(within(sent).getByText("online.match.order.captain:P. h9")).toBeInTheDocument();
    expect(within(sent).getByText("online.match.order.penaltyTaker:P. h8")).toBeInTheDocument();
  });

  // Given a captain's order sent,
  // when the frame applying it comes and the coach's side is read again,
  // then the captain shown is the new one.
  it("shows the new captain once the order is applied", async () => {
    let mine = mineView({
      setPieces: { captain: "h5", free_kick_taker: null, corner_taker: null, penalty_taker: null },
    });
    stage({ mine });
    server.routes[`GET v1/matches/${MATCH}/mine`] = () => ok(mine);
    await opened();
    fireEvent.click(screen.getByRole("combobox", { name: "match.captain" }));
    fireEvent.click(screen.getByRole("option", { name: "10. P. h9" }));
    await screen.findByText("online.match.sent.pending");
    mine = mineView({
      setPieces: { captain: "h9", free_kick_taker: null, corner_taker: null, penalty_taker: null },
    });
    push(matchFrame(1, { commands: [{ commandId: "cmd-1", status: "applied" }] }));

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "match.captain" })).toHaveTextContent(
        "10. P. h9",
      ),
    );
  });
});

describe("leaving a match", () => {
  // Given the coach of a side in a live match,
  // when they click another page of the sidebar, stay, then click it again and leave,
  // then they are asked first; staying keeps the match, leaving opens the page.
  it("asks a coach before they leave their live match", async () => {
    stage();
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "online.nav.league" }));
    const asked = await screen.findByRole("alertdialog", { name: "online.leave.title" });
    fireEvent.click(within(asked).getByRole("button", { name: "online.leave.stay" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      screen.getByRole("complementary", { name: "online.match.touchline" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "online.nav.league" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "online.leave.go",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "online.match.touchline" })).toBeNull(),
    );
    expect(realtime.watches[0].stopped).toBe(true);
  });

  // Given a spectator of a live match,
  // when they click another page of the sidebar,
  // then they leave without being asked.
  it("lets a spectator leave without asking", async () => {
    stage({ mine: null });
    await opened();
    fireEvent.click(screen.getByRole("button", { name: "online.nav.league" }));
    await waitFor(() => expect(realtime.watches[0].stopped).toBe(true));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
