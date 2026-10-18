import { describe, expect, it } from "vitest";

import type { MatchEvent } from "../types";
import {
  type MinuteState,
  type RadarCaption,
  captionsDue,
  captionsFor,
  minuteCaptions,
} from "./radarCaptions";
import { radarEvent } from "./radarTestFixtures";

const NOBODY: ReadonlySet<string> = new Set();

function keysOf(caption: RadarCaption | undefined): string[] {
  return caption?.kind === "line" ? caption.keys : [];
}

function cue(
  event: MatchEvent,
  extra: Partial<Parameters<typeof captionsFor>[0]> = {},
): Parameters<typeof captionsFor>[0] {
  return { event, previous: undefined, receiver: null, steps: 2, seen: NOBODY, ...extra };
}

const QUIET: MinuteState = {
  possession: "Home",
  ballZone: "Midfield",
  minute: 30,
  homeScore: 0,
  awayScore: 0,
};

describe("captionsFor — play", () => {
  /** Given a build-up pass the radar plays to a team-mate, then the line names the receiver the viewer sees. */
  it("names the radar's receiver of a pass", () => {
    const pass = radarEvent("PassCompleted", "Home", "HomeDefense", "h_cb1");
    const [said] = captionsFor(cue(pass, { receiver: "h_cm1" }));
    expect(said.step).toBe(0);
    expect(keysOf(said.caption)).toEqual(["pass.buildUp"]);
    expect(said.caption.kind === "line" && said.caption.tokens.receiver).toBe("h_cm1");
  });

  /** Given a pass nobody is cast to receive, then the line names no receiver. */
  it("falls back to a line without a receiver", () => {
    const pass = radarEvent("PassCompleted", "Away", "Midfield", "a_cm1");
    expect(keysOf(captionsFor(cue(pass))[0].caption)).toEqual(["pass.midfield.noReceiver"]);
  });

  /** Given a pass on the break, then it is told as a counter, wherever it is played. */
  it("tells a pass on the break as a counter", () => {
    const pass = {
      ...radarEvent("PassCompleted", "Home", "HomeDefense", "h_cm1"),
      tactical_context: "Counter" as const,
    };
    expect(keysOf(captionsFor(cue(pass, { receiver: "h_st1" }))[0].caption)).toEqual([
      "pass.counter",
    ]);
  });

  /** Given an interception after a misplaced pass, then the line names the passer it was won from. */
  it("names the passer an interception was won from", () => {
    const lost = radarEvent("PassIntercepted", "Away", "Midfield", "a_cm2");
    const won = radarEvent("Interception", "Home", "Midfield", "h_cm1");
    const [said] = captionsFor(cue(won, { previous: lost }));
    expect(keysOf(said.caption)).toEqual(["interception"]);
    expect(said.caption.kind === "line" && said.caption.tokens.other).toBe("a_cm2");
  });

  /** Given a cross with a man to aim at, then each kind of delivery has its own line. */
  it("tells crosses by their delivery", () => {
    const cross = (context?: MatchEvent["tactical_context"], setPiece?: MatchEvent["set_piece"]) =>
      keysOf(
        captionsFor(
          cue(
            {
              ...radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
              tactical_context: context,
              set_piece: setPiece,
            },
            { receiver: "h_st1" },
          ),
        )[0].caption,
      );
    expect(cross()).toEqual(["cross"]);
    expect(cross("EarlyCross")).toEqual(["cross.early"]);
    expect(cross("LowCross")).toEqual(["cross.low"]);
    expect(cross(null, "Corner")).toEqual(["cross.corner"]);
  });

  /** Given a run in behind, then the line names the defender beaten for pace. */
  it("names the defender beaten by a run in behind", () => {
    const run = {
      ...radarEvent("Dribble", "Home", "AwayDefense", "h_st1", "a_cb1"),
      tactical_context: "BallInBehind" as const,
    };
    const [said] = captionsFor(cue(run));
    expect(keysOf(said.caption)).toEqual(["dribble.ballInBehind"]);
    expect(said.caption.kind === "line" && said.caption.tokens.other).toBe("a_cb1");
  });
});

describe("captionsFor — attempts", () => {
  /** Given a saved shot, then the strike is said as the beat starts and the save only on its last step. */
  it("never tells the outcome before the ball gets there", () => {
    const shot = {
      ...radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk"),
      shot_kind: "Open" as const,
    };
    const said = captionsFor(cue(shot, { steps: 4 }));
    expect(said.map((entry) => entry.step)).toEqual([0, 3]);
    expect(keysOf(said[0].caption)).toEqual(["shot.open"]);
    expect(said[1].caption).toMatchObject({ kind: "event", event: shot, priority: "play" });
  });

  /** Given a header, then the strike line is the header's. */
  it("tells a header as a header", () => {
    const header = {
      ...radarEvent("ShotOffTarget", "Home", "AwayBox", "h_st1"),
      shot_kind: "Header" as const,
    };
    expect(keysOf(captionsFor(cue(header))[0].caption)).toEqual(["shot.header"]);
  });

  /** Given a goal whose assist was on the ball earlier in the move, then the goal names him. */
  it("names an assist the viewer saw", () => {
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1", "h_rm");
    const [, outcome] = captionsFor(cue(goal, { seen: new Set(["h_rm"]) }));
    expect(outcome.caption).toMatchObject({ kind: "event", priority: "key", assist: "h_rm" });
  });

  /** Given a goal whose credited assist never appeared in the move, then no assist is named. */
  it("names no assist the viewer did not see", () => {
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1", "h_cm2");
    const [, outcome] = captionsFor(cue(goal, { seen: new Set(["h_rm"]) }));
    expect(outcome.caption).toMatchObject({ kind: "event", assist: null });
  });
});

describe("minuteCaptions", () => {
  /** Given a booking the radar does not act out, then it is told as a key moment. */
  it("tells a booking the radar did not show", () => {
    const booking = radarEvent("YellowCard", "Away", "Midfield", "a_cm1");
    const said = minuteCaptions([booking], new Set(), QUIET);
    expect(said).toEqual([{ kind: "event", priority: "key", event: booking, assist: null }]);
  });

  /** Given a minute the radar acted out, then nothing more is said about it. */
  it("adds nothing to a minute with play on the radar", () => {
    const shot = radarEvent("ShotOffTarget", "Home", "AwayBox", "h_st1");
    expect(minuteCaptions([shot], new Set([shot]), QUIET)).toEqual([]);
  });

  /** Given a quiet minute with a tackle on a dribble in it, then that tackle is its line. */
  it("tells a quiet minute by its most telling play", () => {
    const pass = radarEvent("PassCompleted", "Home", "Midfield", "h_cm1");
    const stopped = radarEvent("DribbleTackled", "Home", "AwayDefense", "h_lm", "a_rb");
    const [said] = minuteCaptions([pass, stopped], new Set(), QUIET);
    expect(keysOf(said)).toEqual(["dribbleTackled"]);
    expect(said.priority).toBe("filler");
  });

  /** Given a quiet minute with nothing telling in it, then it is told by where the ball is. */
  it("tells an empty minute by where the ball is", () => {
    const pass = radarEvent("PassCompleted", "Away", "AwayDefense", "a_cb1");
    expect(
      keysOf(
        minuteCaptions([pass], new Set(), {
          ...QUIET,
          possession: "Away",
          ballZone: "AwayDefense",
        })[0],
      ),
    ).toEqual(["summary.ownHalf"]);
    expect(keysOf(minuteCaptions([], new Set(), { ...QUIET, ballZone: "AwayDefense" })[0])).toEqual(
      ["summary.attacking"],
    );
  });

  /** Given a quiet minute late on, then it is told by the score, about the side behind. */
  it("tells a late quiet minute by the score", () => {
    const [said] = minuteCaptions([], new Set(), {
      ...QUIET,
      minute: 85,
      homeScore: 0,
      awayScore: 1,
    });
    expect(keysOf(said)).toEqual(["summary.lateTrailing"]);
    expect(said.kind === "line" && said.tokens).toMatchObject({
      side: "Home",
      minute: 85,
      score: "0-1",
    });
  });
});

describe("captionsDue", () => {
  const first: RadarCaption = {
    kind: "line",
    priority: "play",
    keys: ["shot.open"],
    tokens: { side: "Home" },
    seed: "a",
  };
  const last: RadarCaption = {
    kind: "line",
    priority: "key",
    keys: ["x"],
    tokens: { side: "Home" },
    seed: "b",
  };
  const beat = {
    beat: {
      captions: [
        { step: 0, caption: first },
        { step: 2, caption: last },
      ],
    },
  };
  const START = { beat: null, upTo: -1 };

  /** Given a beat starting, then the captions of its first step are due. */
  it("says a beat's first captions as it starts", () => {
    const { due } = captionsDue({ beat, index: 0 }, START);
    expect(due).toEqual([first]);
  });

  /** Given the same step on screen again, then nothing is said twice. */
  it("never says a caption twice", () => {
    const once = captionsDue({ beat, index: 0 }, START);
    expect(captionsDue({ beat, index: 0 }, once.mark).due).toEqual([]);
  });

  /** Given steps passed within one frame, then the captions of every step passed are said, in order. */
  it("catches up on steps passed in one frame", () => {
    const once = captionsDue({ beat, index: 0 }, START);
    expect(captionsDue({ beat, index: 2 }, once.mark).due).toEqual([last]);
    expect(captionsDue({ beat, index: 2 }, START).due).toEqual([first, last]);
  });

  /** Given nothing playing, then nothing is due. */
  it("says nothing while the radar rests", () => {
    expect(captionsDue(null, START).due).toEqual([]);
  });
});
