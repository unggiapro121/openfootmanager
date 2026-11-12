import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { coachName } from "./honours/honoursText";
import { shownCoachName } from "./coachName";

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${Object.values(options).join("|")}` : key) as unknown as TFunction;

describe("a coach's name as others read it", () => {
  // Given a coach who deleted his account, or waits to be deleted (the server sends his name
  // empty, M3a K1), when his name is shown, then it reads "the coach left the game".
  it("names a coach who left the game", () => {
    expect(shownCoachName(t, "")).toBe("online.coachLeft");
    expect(shownCoachName(t, "Jose Mourinho")).toBe("Jose Mourinho");
  });

  // Given an honour won under a coach who left, by the reader himself, or under the AI,
  // when the honours name the coach, then the one who left reads as such, the others as before.
  it("names a coach who left on the honours", () => {
    expect(coachName(t, { name: "", mine: false })).toBe("online.coachLeft");
    expect(coachName(t, { name: "Jose", mine: true })).toBe("online.honours.youCoach:Jose");
    expect(coachName(t, undefined)).toBe("online.honours.aiCoach");
  });
});
