import { describe, expect, it } from "vitest";

import { highlightsOf } from "./radarHighlights";
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
});
