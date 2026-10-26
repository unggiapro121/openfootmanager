import { describe, expect, it } from "vitest";
import {
  matchEvent,
  matchFrame,
  matchView,
  mineView,
  projectedPlayer,
  projectedSide,
} from "../../test-utils/onlineMatchKit";
import { squadPlayer } from "../../test-utils/onlineTestKit";
import type { MatchFrame } from "../api";
import {
  applyFrame,
  initialMatchState,
  injuryStepsLeft,
  type OnlineMatchState,
  toFeedSource,
  toRadarDials,
  toRadarMatch,
  toRadarRoster,
  substitutedOff,
  toStatsSource,
  withHistory,
  withSides,
} from "./matchState";

function applied(state: OnlineMatchState, frame: MatchFrame) {
  const result = applyFrame(state, frame);
  if (result.kind !== "applied") throw new Error(`frame ${frame.seq} was ${result.kind}`);
  return result;
}

const FRAMES: MatchFrame[] = [
  matchFrame(1, { result: { events: [matchEvent("KickOff", "Home", null)] } }),
  matchFrame(2, {
    result: {
      events: [matchEvent("Goal", "Home", "h9"), matchEvent("YellowCard", "Away", "a4")],
      home_score: 1,
      possession: "Away",
    },
    possessionPct: { home: 55, away: 45 },
  }),
  matchFrame(3, {
    gapEvents: [matchEvent("Substitution", "Away", "as1", { secondary_player_id: "a3" })],
    result: { events: [matchEvent("Injury", "Home", "h5")], ball_zone: "AwayBox" },
    ballLane: "Left",
    possessionPct: { home: 52, away: 48 },
  }),
];

describe("initialMatchState", () => {
  // Given a view whose players come out of slot order,
  // when the match is opened,
  // then each side's eleven stands in slot order and the rest sit on the bench.
  it("puts the eleven in slot order", () => {
    const side = projectedSide("h", "Hà Nội FC");
    const shuffled = { ...side, players: [...side.players].reverse() };
    const state = initialMatchState(matchView({ home: shuffled }));
    expect(state.home.eleven.map((player) => player.slot)).toEqual(
      Array.from({ length: 11 }, (_, slot) => slot),
    );
    expect(state.home.bench.map((player) => player.id).sort()).toEqual(["hs1", "hs2"]);
  });

  // Given a view at step 40 with a player already hurt and a substitution made,
  // when the match is opened,
  // then the hurt player counts down from that step, and the side has used one substitution.
  it("keeps what the view says of injuries and substitutions", () => {
    const view = matchView({ lastSeq: 40 });
    view.state = { ...view.state, injured: ["h3"], homeSubsMade: 1 };
    const state = initialMatchState(view);
    expect(state.injuredSince).toEqual({ h3: 40 });
    expect(state.home.subsMade).toBe(1);
  });
});

describe("withHistory", () => {
  // Given a view at step 3 and its three frames,
  // when the history is read,
  // then the events run in order, each gap's events before its step's, and the ball stands where
  // the last frame left it.
  it("reads the events and the ball from the frames", () => {
    const view = matchView({ lastSeq: 3 });
    const state = withHistory(initialMatchState(view), FRAMES);
    expect(state.events.map((event) => event.event_type)).toEqual([
      "KickOff",
      "Goal",
      "YellowCard",
      "Substitution",
      "Injury",
    ]);
    expect(state).toMatchObject({
      ballZone: "AwayBox",
      ballLane: "Left",
      possessionPct: { home: 52, away: 48 },
    });
  });

  // Given a view at step 3 where a player hurt in step 3 is still on the pitch,
  // when the history is read,
  // then his countdown starts from step 3, not from the view.
  it("dates a hurt player's countdown from the step he was hurt in", () => {
    const view = matchView({ lastSeq: 5 });
    view.state = { ...view.state, injured: ["h5"] };
    const state = withHistory(initialMatchState(view), FRAMES);
    expect(state.injuredSince).toEqual({ h5: 3 });
  });

  // Given frames beyond the view's step,
  // when the history is read,
  // then they are left for the live feed to apply.
  it("stops at the view's step", () => {
    const state = withHistory(initialMatchState(matchView({ lastSeq: 1 })), FRAMES);
    expect(state.events).toHaveLength(1);
  });
});

describe("applyFrame", () => {
  // Given a match at kick-off,
  // when its frames are applied one by one,
  // then it ends where opening it at step 3 ends: the same score, events, cards, injuries and ball.
  it("agrees with opening the match later", () => {
    let live = initialMatchState(matchView());
    for (const frame of FRAMES) live = applied(live, frame).state;
    const view = matchView({ lastSeq: 3 });
    view.state = {
      ...view.state,
      minute: 3,
      phase: "FirstHalf",
      homeScore: 1,
      booked: ["a4"],
      injured: ["h5"],
    };
    const later = withHistory(initialMatchState(view), FRAMES);
    for (const key of [
      "lastSeq",
      "minute",
      "phase",
      "homeScore",
      "awayScore",
      "possession",
      "ballZone",
      "ballLane",
      "possessionPct",
      "booked",
      "sentOff",
      "injuredSince",
      "events",
    ] as const) {
      expect(live[key], key).toEqual(later[key]);
    }
  });

  // Given a match at step 1,
  // when step 1 comes again, or step 3 comes before step 2,
  // then the first is ignored and the second is a gap to read from step 1.
  it("ignores an old frame and reports a missed one", () => {
    const state = applied(initialMatchState(matchView()), FRAMES[0]).state;
    expect(applyFrame(state, FRAMES[0])).toEqual({ kind: "stale" });
    expect(applyFrame(state, FRAMES[2])).toEqual({ kind: "gap", afterSeq: 1 });
  });

  // Given a frame with a red card and a second yellow,
  // when it is applied,
  // then both players are sent off.
  it("sends off for a red card or a second yellow", () => {
    const frame = matchFrame(1, {
      result: {
        events: [matchEvent("RedCard", "Home", "h2"), matchEvent("SecondYellow", "Away", "a7")],
      },
    });
    expect(applied(initialMatchState(matchView()), frame).state.sentOff).toEqual(["h2", "a7"]);
  });

  // Given a frame whose gap held a substitution the server shows,
  // when it is applied,
  // then the screen is told to read the sides again; a hidden adjustment does not ask for that
  // but is kept, so the screen can say a side changed something out of sight.
  it("says when the sides changed in sight", () => {
    const state = initialMatchState(matchView());
    const substitution = matchFrame(1, {
      gapInputs: [
        {
          kind: "command",
          side: "Away",
          source: "Ai",
          command: { Substitute: { side: "Away", player_off_id: "a3", player_on_id: "as1" } },
        },
      ],
    });
    const hidden = matchFrame(1, {
      gapInputs: [{ kind: "tacticalAdjustment", side: "Away", source: "Manager" }],
    });
    expect(applied(state, substitution).sidesChanged).toBe(true);
    const adjusted = applied(state, hidden);
    expect(adjusted.sidesChanged).toBe(false);
    expect(adjusted.state.adjustments).toEqual([{ side: "Away", seq: 1, minute: 1 }]);
  });

  // Given a frame deciding two of the coach's commands and handing the away side to its coach,
  // when it is applied,
  // then each command's outcome is kept and the away side is the coach's.
  it("keeps command outcomes and who holds each side", () => {
    const frame = matchFrame(1, {
      commands: [
        { commandId: "c1", status: "applied" },
        { commandId: "c2", status: "refused" },
      ],
      controllers: { home: "Ai", away: "Manager" },
    });
    const { state } = applied(initialMatchState(matchView()), frame);
    expect(state.outcomes).toEqual({ c1: "applied", c2: "refused" });
    expect(state.controllers).toEqual({ home: "Ai", away: "Manager" });
  });
});

describe("withSides", () => {
  // Given a match where h5 was hurt in step 3 and the coach replaced him with hs1,
  // when the sides are read again from the view,
  // then hs1 stands in h5's slot, h5 sits on the bench, and nobody counts down any more.
  it("takes the sides from the view and stops a replaced player's countdown", () => {
    let state = initialMatchState(matchView());
    for (const frame of FRAMES) state = applied(state, frame).state;
    const view = matchView({ lastSeq: 4 });
    const players = view.home.players.map((player) =>
      player.id === "h5"
        ? projectedPlayer("h5", undefined)
        : player.id === "hs1"
          ? projectedPlayer("hs1", 5)
          : player,
    );
    view.home = { ...view.home, players };
    view.state = { ...view.state, homeSubsMade: 1, injured: [] };
    const next = withSides(state, view);
    expect(next.home.eleven[5].id).toBe("hs1");
    expect(next.home.bench.map((player) => player.id)).toContain("h5");
    expect(next.home.subsMade).toBe(1);
    expect(next.injuredSince).toEqual({});
  });

  // Given a player still hurt when the sides are read again,
  // when the view says he is still hurt,
  // then his countdown keeps the step he was hurt in.
  it("keeps a still-hurt player's countdown", () => {
    let state = initialMatchState(matchView());
    for (const frame of [...FRAMES, matchFrame(4), matchFrame(5)]) {
      state = applied(state, frame).state;
    }
    const view = matchView({ lastSeq: 6 });
    view.state = { ...view.state, injured: ["h5"] };
    expect(withSides(state, view).injuredSince).toEqual({ h5: 3 });
  });
});

describe("substitutedOff", () => {
  // Given a match where the away side took a3 off for as1,
  // when the away side's substituted players are asked for,
  // then a3 is one, and the home side has none.
  it("knows who may not come back", () => {
    const state = withHistory(initialMatchState(matchView({ lastSeq: 3 })), FRAMES);
    expect([...substitutedOff(state, "Away")]).toEqual(["a3"]);
    expect(substitutedOff(state, "Home").size).toBe(0);
  });
});

describe("injuryStepsLeft", () => {
  // Given h5 hurt in step 3 and a window of 3 steps,
  // when the match is at step 4, then at step 7,
  // then 2 steps are left, then none.
  it("counts the steps left before the AI replaces him", () => {
    let state = initialMatchState(matchView());
    for (const frame of FRAMES) state = applied(state, frame).state;
    expect(injuryStepsLeft({ ...state, lastSeq: 4 }, "h5", 3)).toBe(2);
    expect(injuryStepsLeft({ ...state, lastSeq: 7 }, "h5", 3)).toBe(0);
    expect(injuryStepsLeft(state, "h4", 3)).toBeNull();
    expect(injuryStepsLeft(state, "h5", undefined)).toBeNull();
  });
});

describe("radar and panels", () => {
  // Given the coach's own dials for the home side,
  // when the radar reads the match,
  // then the home side plays them, the away side has none, and players carry their short names.
  it("gives the radar the coach's own dials only", () => {
    const state = initialMatchState(matchView());
    const radar = toRadarMatch(state, { home: toRadarDials(mineView().tactics) });
    expect(radar.home_team.tactics).toEqual({ defensive_line: "High", width: "Wide" });
    expect(radar.away_team.tactics).toBeUndefined();
    expect(radar.home_team.players[0]).toEqual({ id: "h0", name: "P. h0", position: "Goalkeeper" });
    expect(radar.away_team.players).toHaveLength(11);
  });

  // Given both sides,
  // when the roster is built,
  // then every player on either side, bench included, has his name and shirt number.
  it("names and numbers everyone in the roster", () => {
    const roster = toRadarRoster(initialMatchState(matchView()));
    expect(roster.size).toBe(26);
    expect(roster.get("as2")).toEqual({
      id: "as2",
      nationality: null,
      portrait_seed: null,
      full_name: "P. as2",
      match_name: "P. as2",
      jersey_number: 20,
    });
  });

  // Given the coach's squad, which knows one player of the match by his full name and nationality,
  // when the roster is built with it,
  // then that player carries the identity his squad page draws his portrait from, and the others
  // only their id.
  it("gives the coach's own players the identity of their portrait", () => {
    const roster = toRadarRoster(initialMatchState(matchView()), [
      squadPlayer({ id: "as2", fullName: "Phạm Văn Hai", matchName: "P. as2", nationality: "VN" }),
    ]);
    expect(roster.get("as2")).toMatchObject({
      id: "as2",
      full_name: "Phạm Văn Hai",
      nationality: "VN",
    });
    const other = [...roster.values()].find((entry) => entry.id !== "as2");
    expect(other).toMatchObject({ nationality: null });
    expect(other?.id).toBeTruthy();
  });

  // Given a match with a yellow card for each side and a share of the ball,
  // when the panels read it,
  // then each side's bookings are its own and the feed knows the benches.
  it("splits bookings by side and names the benches", () => {
    let state = initialMatchState(matchView());
    for (const frame of FRAMES) state = applied(state, frame).state;
    state = { ...state, booked: [...state.booked, "h1"] };
    const stats = toStatsSource(state);
    expect(stats.home_yellows).toEqual({ h1: 1 });
    expect(stats.away_yellows).toEqual({ a4: 1 });
    expect(stats.home_possession_pct).toBe(52);
    const feed = toFeedSource(state);
    expect(feed.away_bench).toContainEqual({ id: "as1", name: "P. as1" });
    expect(feed.events).toHaveLength(5);
  });
});
