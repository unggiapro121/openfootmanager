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

// The radar draws on a canvas; here it shows what it was handed.
vi.mock("../../../components/match/radar/MatchRadar2D", () => ({
  MatchRadar2D: ({ snapshot, pacing }: { snapshot: RadarMatch; pacing?: RadarPacing }) => (
    <output aria-label="radar">
      {JSON.stringify({
        score: `${snapshot.home_score}-${snapshot.away_score}`,
        maxLagMs: pacing?.maxLagMs,
        homeDials: snapshot.home_team.tactics ?? null,
        awayDials: snapshot.away_team.tactics ?? null,
        homeEleven: snapshot.home_team.players.map((player) => player.id),
      })}
    </output>
  ),
}));

const MATCH = "match-1";
const ROUTE = `/online/match/${MATCH}`;

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
      maxLagMs: 4000,
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
    expect(screen.getByRole("combobox", { name: "online.match.playerOff" })).toBeEnabled();
    expect(screen.queryByRole("status", { name: "radar" })).not.toBeInTheDocument();

    push(matchFrame(2, { result: { phase: "SecondHalf", minute: 46 } }));

    expect(await screen.findByRole("status", { name: "radar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "match.halfTime" })).not.toBeInTheDocument();
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
  // then the strip counts six seconds and its button chooses him to come off.
  it("counts down the time to replace a hurt player", async () => {
    stage();
    await opened();
    push(matchFrame(1, { result: { events: [matchEvent("Injury", "Home", "h5")] } }));
    expect(await screen.findByText("online.match.hurt:P. h5|6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "online.match.replace" }));
    expect(screen.getByRole("combobox", { name: "online.match.playerOff" })).toHaveTextContent(
      "6. P. h5",
    );
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
  async function substitute() {
    fireEvent.click(screen.getByRole("combobox", { name: "online.match.playerOff" }));
    fireEvent.click(screen.getByRole("option", { name: "10. P. h9" }));
    fireEvent.click(screen.getByRole("combobox", { name: "online.match.playerOn" }));
    fireEvent.click(screen.getByRole("option", { name: "20. P. hs1" }));
    fireEvent.click(screen.getByRole("button", { name: "match.makeSubstitution" }));
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
    fireEvent.click(screen.getByRole("combobox", { name: "match.formation" }));
    fireEvent.click(screen.getByRole("option", { name: "4-3-3" }));
    await waitFor(() => expect(requestsTo(`v1/matches/${MATCH}/commands`)).toHaveLength(1));
    fireEvent.click(screen.getByRole("combobox", { name: "match.playStyle" }));
    fireEvent.click(screen.getByRole("option", { name: "common.playStyles.Counter" }));
    await waitFor(() => expect(requestsTo(`v1/matches/${MATCH}/commands`)).toHaveLength(2));
    expect(requestsTo(`v1/matches/${MATCH}/commands`).map((request) => request.body)).toEqual([
      { command: { ChangeFormation: { side: "Home", formation: "4-3-3" } } },
      { command: { ChangePlayStyle: { side: "Home", play_style: "Counter" } } },
    ]);
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
