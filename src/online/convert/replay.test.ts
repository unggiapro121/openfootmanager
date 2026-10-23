import { describe, expect, it } from "vitest";
import {
  matchEvent,
  matchFrame,
  matchView,
  projectedPlayer,
} from "../../test-utils/onlineMatchKit";
import type { MatchFrame, MatchView } from "../api";
import {
  isWhole,
  type ReplaySource,
  replayAt,
  replayNext,
  replayStart,
  sidesChangedAt,
  stepOfMinute,
} from "./replay";

const substitution: MatchFrame["gapInputs"][number] = {
  kind: "command",
  side: "Home",
  source: "Manager",
  command: { Substitute: { side: "Home", player_off_id: "h9", player_on_id: "hs1" } },
};

const FRAMES: MatchFrame[] = [
  matchFrame(1, { result: { minute: 1 } }),
  matchFrame(2, {
    result: { minute: 2, home_score: 1, events: [matchEvent("Goal", "Home", "h9")] },
  }),
  matchFrame(3, {
    gapInputs: [substitution],
    gapEvents: [matchEvent("Substitution", "Home", "hs1", { secondary_player_id: "h9" })],
    result: { minute: 3, home_score: 1 },
  }),
  matchFrame(4, {
    gapInputs: [{ kind: "tacticalAdjustment", side: "Away", source: "Ai" }],
    result: { minute: 45, home_score: 1, phase: "HalfTime" },
  }),
];

/** The home side after hs1 came on for h9 in the gap before step 3. */
function afterSubstitution(): MatchView {
  const view = matchView({ lastSeq: 3 });
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

const SOURCE: ReplaySource = {
  start: matchView(),
  frames: FRAMES,
  sidesAt: new Map([[3, afterSubstitution()]]),
};

describe("sidesChangedAt", () => {
  // Given frames whose gaps hold a substitution (step 3) and a hidden adjustment (step 4),
  // when a replay asks which sides to read,
  // then only step 3: a hidden change moves no one on the pitch.
  it("names the steps a change in sight came before", () => {
    expect(sidesChangedAt(FRAMES)).toEqual([3]);
  });
});

describe("isWhole", () => {
  // Given a match of four steps,
  // when all four frames are kept, when one is missing, and when none are,
  // then only the first is a whole replay.
  it("knows a replay with a step missing", () => {
    expect(isWhole(FRAMES, 4)).toBe(true);
    expect(isWhole([FRAMES[0], FRAMES[2], FRAMES[3]], 4)).toBe(false);
    expect(isWhole([], 4)).toBe(false);
  });
});

describe("replaying", () => {
  // Given a finished match,
  // when it is played from kick-off one step at a time,
  // then each step brings its frame, the substitute stands in h9's slot from step 3 (as the
  // server's view at step 3 has it), and nothing follows the last step.
  it("plays step by step with the sides the server read", () => {
    const start = replayStart(SOURCE);
    expect(start.lastSeq).toBe(0);
    expect(start.home.eleven[9].id).toBe("h9");
    const one = replayNext(SOURCE, start);
    const two = one && replayNext(SOURCE, one);
    expect(two?.homeScore).toBe(1);
    expect(two?.home.eleven[9].id).toBe("h9");
    const three = two && replayNext(SOURCE, two);
    expect(three?.home.eleven[9].id).toBe("hs1");
    expect(three?.home.subsMade).toBe(1);
    const four = three && replayNext(SOURCE, three);
    expect(four?.phase).toBe("HalfTime");
    expect(four && replayNext(SOURCE, four)).toBeNull();
  });

  // Given a finished match,
  // when it is jumped to step 3, and then back to step 1,
  // then each jump lands where playing step by step lands.
  it("jumps to a step, forward or back", () => {
    let stepped = replayStart(SOURCE);
    const steps = [stepped];
    for (let index = 0; index < FRAMES.length; index++) {
      const next = replayNext(SOURCE, stepped);
      if (!next) break;
      stepped = next;
      steps.push(stepped);
    }
    expect(replayAt(SOURCE, 3)).toEqual(steps[3]);
    expect(replayAt(SOURCE, 1)).toEqual(steps[1]);
    expect(replayAt(SOURCE, 99)).toEqual(steps[4]);
  });
});

describe("stepOfMinute", () => {
  // Given steps of minutes 1, 2, 3 and 45,
  // when the replay is asked for minute 2, minute 10 and minute 90,
  // then it lands on step 2, on step 4 (the first to reach it), and on the last step.
  it("finds the step that reaches a minute", () => {
    expect(stepOfMinute(FRAMES, 2)).toBe(2);
    expect(stepOfMinute(FRAMES, 10)).toBe(4);
    expect(stepOfMinute(FRAMES, 90)).toBe(4);
    expect(stepOfMinute([], 10)).toBe(0);
  });
});
