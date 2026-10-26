import { describe, expect, it } from "vitest";

import { TRAINING_FOCUS_IDS } from "../../components/training/trainingOptions";
import type { SquadPlayerView } from "../api";
import { toGroupData, toPlanGroups, toTrainingRoster } from "./training";

const PLAYER = {
  id: "p1",
  matchName: "J. Smith",
  position: "Forward",
  naturalPosition: "Striker",
  condition: 71,
  trainingFocus: "Attacking",
  shirtNumber: 9,
} as unknown as SquadPlayerView;

describe("online training conversion", () => {
  // Given a squad line with his own session and a shirt, and one with neither,
  // when they are read for the groups table,
  // then the first keeps both and the second has none of them.
  it("reads a squad line for the groups table", () => {
    const bare = { ...PLAYER, id: "p2", trainingFocus: undefined, shirtNumber: undefined };

    const [first, second] = toTrainingRoster([PLAYER, bare as SquadPlayerView]);

    expect(first).toMatchObject({
      id: "p1",
      match_name: "J. Smith",
      jersey_number: 9,
      natural_position: "Striker",
      condition: 71,
      training_focus: "Attacking",
    });
    expect(second).toMatchObject({ jersey_number: null, training_focus: null });
  });

  // Given the plan's groups,
  // when they go to the card and come back,
  // then they are the same groups.
  it("round-trips the groups", () => {
    const groups = [
      { id: "g1", name: "Youngsters", focus: "Technical" as const, player_ids: ["p1"] },
    ];

    expect(toPlanGroups(toGroupData(groups), TRAINING_FOCUS_IDS)).toEqual(groups);
  });

  // Given a group with a session the game does not know,
  // when it is turned into the plan's group,
  // then it is refused.
  it("refuses a session the game does not know", () => {
    expect(() =>
      toPlanGroups([{ id: "g1", name: "X", focus: "Dancing", player_ids: [] }], TRAINING_FOCUS_IDS),
    ).toThrow();
  });
});
