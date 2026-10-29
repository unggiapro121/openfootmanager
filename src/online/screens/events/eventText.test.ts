import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { lapsedReasonText, levelsText, missionHint, missionText, themeName } from "./eventText";

/** `t` that tells the key and the parameters it was given. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}|${JSON.stringify(options)}` : key) as unknown as TFunction;

describe("the words of an event", () => {
  // Given a season-end mission's league levels from 4 with no top, one level, a range, and none,
  // when they are worded,
  // then each has its own sentence, and none gives no line (the client never guesses).
  it("words the league levels a mission counts in", () => {
    expect(levelsText(t, { from: 4, to: 1000 })).toBe('online.events.levels.from|{"from":4}');
    expect(levelsText(t, { from: 2, to: 2 })).toBe('online.events.levels.one|{"from":2}');
    expect(levelsText(t, { from: 1, to: 3 })).toBe('online.events.levels.range|{"from":1,"to":3}');
    expect(levelsText(t, undefined)).toBeUndefined();
  });

  // Given a top-1 finish, a top-4 one, and a kind this build does not know,
  // when they are worded,
  // then the top-1 reads as winning the league, the top-4 with its target, and the unknown one
  // as a special mission with no line under it.
  it("words missions by their kind and target", () => {
    expect(missionText(t, { kind: "seasonFinishTop", target: 1 })).toBe(
      "online.events.mission.seasonChampion",
    );
    expect(missionText(t, { kind: "seasonFinishTop", target: 4 })).toBe(
      'online.events.mission.seasonFinishTop|{"target":4}',
    );
    expect(missionText(t, { kind: "dance", target: 2 })).toBe("online.events.mission.other");
    expect(missionHint(t, "dance")).toBeUndefined();
    expect(missionHint(t, "leagueWinsDirected")).toBe("online.events.hint.directed");
  });

  // Given the six reasons a reward may lapse for and one this build does not know, and a theme
  // it does not know,
  // when they are worded,
  // then each reason has its sentence, the unknown one reads as "could not give it", and the
  // unknown theme as "Event".
  it("words a lapsed reward's reason and an unknown theme", () => {
    for (const reason of [
      "grantLimitReached",
      "coinLimitReached",
      "stackFull",
      "inventoryLocked",
      "disabled",
      "unavailable",
    ]) {
      expect(lapsedReasonText(t, reason)).toBe(`online.events.reason.${reason}`);
    }
    expect(lapsedReasonText(t, "meteor")).toBe("online.events.reason.unavailable");
    expect(themeName(t, "carnival")).toBe("online.events.theme.other");
  });
});
