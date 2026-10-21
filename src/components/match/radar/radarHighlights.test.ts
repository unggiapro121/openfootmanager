import { describe, expect, it } from "vitest";

import { highlightsOf, movesOf, openMove } from "./radarHighlights";
import { radarEvent } from "./radarTestFixtures";

const typesOf = (events: ReturnType<typeof radarEvent>[]) =>
  highlightsOf(events).map((event) => `${event.side[0]}:${event.event_type}`);

describe("highlightsOf", () => {
  // Given a minute with no shot, then there is nothing to act out.
  it("keeps nothing from a minute with no shot", () => {
    expect(
      typesOf([
        radarEvent("PassCompleted", "Home", "HomeDefense", "h_cb1"),
        radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
        radarEvent("Tackle", "Away", "Midfield", "a_cm1"),
      ]),
    ).toEqual([]);
  });

  // Given an attack ending in a shot, then the whole move is kept — from where
  // the side won the ball to the shot — and nothing before it.
  it("keeps the move that led to a shot", () => {
    expect(
      typesOf([
        radarEvent("PassCompleted", "Away", "AwayDefense", "a_cb1"),
        radarEvent("Interception", "Home", "Midfield", "h_cm2"),
        radarEvent("PassCompleted", "Home", "Midfield", "h_cm2"),
        radarEvent("Dribble", "Home", "AwayDefense", "h_rm"),
        radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
        radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk"),
      ]),
    ).toEqual(["H:Interception", "H:PassCompleted", "H:Dribble", "H:Cross", "H:ShotSaved"]);
  });

  // Given a foul that wins a penalty, then the foul, the award and the kick are kept.
  it("keeps a penalty with the foul that won it", () => {
    expect(
      typesOf([
        radarEvent("Dribble", "Home", "AwayDefense", "h_st2"),
        radarEvent("Foul", "Away", "AwayBox", "a_cb1", "h_st2"),
        radarEvent("PenaltyAwarded", "Home", "AwayBox"),
        radarEvent("PenaltyGoal", "Home", "AwayBox", "h_st2"),
      ]),
    ).toEqual(["H:Dribble", "A:Foul", "H:PenaltyAwarded", "H:PenaltyGoal"]);
  });

  // Given a saved shot that wins a corner, then the corner is kept with it.
  it("keeps the corner a shot wins", () => {
    expect(
      typesOf([
        radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk"),
        radarEvent("Corner", "Home", "AwayBox"),
        radarEvent("Clearance", "Away", "AwayBox", "a_cb1"),
      ]),
    ).toEqual(["H:ShotSaved", "H:Corner"]);
  });

  // Given a sending-off in a quiet minute, then it is still marked on the radar.
  it("keeps a sending-off", () => {
    expect(
      typesOf([
        radarEvent("Foul", "Away", "Midfield", "a_cm1", "h_cm1"),
        radarEvent("RedCard", "Away", "Midfield", "a_cm1"),
      ]),
    ).toEqual(["A:RedCard"]);
  });

  // Given a break the sweeper keeper cut out, then the break and the keeper's
  // interception are acted out though no shot follows (phase 2, GĐ5 P5.6).
  it("keeps a sweeper keeper's interception and the break it stopped", () => {
    expect(
      typesOf([
        radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
        { ...radarEvent("Dribble", "Home", "AwayDefense", "h_st1"), tactical_context: "Counter" },
        {
          ...radarEvent("Interception", "Away", "AwayDefense", "a_gk"),
          tactical_context: "SweeperKeeperInterception",
        },
      ]),
    ).toEqual(["H:Dribble", "A:Interception"]);
  });
});

const short = (events: ReturnType<typeof radarEvent>[]) =>
  events.map((event) => `${event.side[0]}:${event.event_type}`);

describe("movesOf (after GĐ5)", () => {
  // Given two attacks in one minute with play between them, then they are two
  // moves: the radar plays each from its start and changes scene between them.
  it("splits a minute's dangerous play into its moves", () => {
    const moves = movesOf([
      radarEvent("Dribble", "Home", "AwayDefense", "h_st1"),
      radarEvent("ShotOffTarget", "Home", "AwayBox", "h_st1"),
      radarEvent("GoalKick", "Away", "AwayBox", "a_gk"),
      radarEvent("PassCompleted", "Away", "AwayDefense", "a_cb1"),
      radarEvent("Tackle", "Home", "Midfield", "h_cm1"),
      radarEvent("ShotSaved", "Home", "AwayBox", "h_cm1", "a_gk"),
    ]);
    expect(moves.map(short)).toEqual([
      ["H:Dribble", "H:ShotOffTarget"],
      ["H:Tackle", "H:ShotSaved"],
    ]);
  });

  // Given a shot and the corner it wins, then they are one move.
  it("keeps a shot and the corner it wins together", () => {
    const moves = movesOf([
      radarEvent("Dribble", "Home", "AwayDefense", "h_st1"),
      radarEvent("ShotBlocked", "Home", "AwayBox", "h_st1"),
      radarEvent("Corner", "Home", "AwayBox", "h_lm"),
    ]);
    expect(moves.map(short)).toEqual([["H:Dribble", "H:ShotBlocked", "H:Corner"]]);
  });
});

describe("openMove (after GĐ5)", () => {
  // Given a minute that ends with a side building an attack, then that
  // build-up is still open: it may end in a shot next minute.
  it("is the build-up a minute ends on", () => {
    const open = openMove([
      radarEvent("PassCompleted", "Away", "AwayDefense", "a_cb1"),
      radarEvent("Interception", "Home", "Midfield", "h_cm2"),
      radarEvent("PassCompleted", "Home", "Midfield", "h_cm2"),
      radarEvent("Dribble", "Home", "AwayDefense", "h_rm"),
    ]);
    expect(short(open)).toEqual(["H:Interception", "H:PassCompleted", "H:Dribble"]);
  });

  // Given a minute that ends with a shot, or with play already acted out (the
  // corner a shot won), then nothing is open.
  it("is nothing after a shot or play already acted out", () => {
    expect(
      openMove([
        radarEvent("Dribble", "Home", "AwayDefense", "h_st1"),
        radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk"),
      ]),
    ).toEqual([]);
    expect(
      openMove([
        radarEvent("ShotBlocked", "Home", "AwayBox", "h_st1"),
        radarEvent("Corner", "Home", "AwayBox", "h_lm"),
      ]),
    ).toEqual([]);
  });

  // Given a minute that ends with no side building (a goal kick, a foul
  // given), then nothing is open.
  it("is nothing when the minute ends on a restart", () => {
    expect(openMove([radarEvent("GoalKick", "Away", "AwayBox", "a_gk")])).toEqual([]);
  });
});
