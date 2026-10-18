import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18n, { i18nReady } from "../../../i18n";
import type { RadarCaption } from "./radarCaptions";
import { captionText, radarNameOf } from "./radarCommentaryText";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";

const snapshot = radarSnapshot();
const t = i18n.t.bind(i18n);
const nameOf = (id: string | null) => (id ? id.toUpperCase() : "");

let previousLanguage: string;

beforeAll(async () => {
  await i18nReady;
  previousLanguage = i18n.language;
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

type LineCaption = Extract<RadarCaption, { kind: "line" }>;

function lineCaption(keys: string[], tokens: Partial<LineCaption["tokens"]>): LineCaption {
  return { kind: "line", priority: "play", keys, tokens: { side: "Home", ...tokens }, seed: "s" };
}

describe("captionText", () => {
  /** Given a pass line, then it names the passer and the receiver as the radar names them. */
  it("names the players of a line", () => {
    const text = captionText(
      lineCaption(["pass.midfield"], { player: "h_cm1", receiver: "h_st1" }),
      snapshot,
      t,
      nameOf,
    );
    expect(text?.line).toContain("H_CM1");
    expect(text?.line).toContain("H_ST1");
    expect(text?.line).not.toMatch(/\{\{/);
    expect(text?.side).toBe("Home");
  });

  /** Given a line about the away side, then its team is the away team and the opponent the home team. */
  it("tells the teams from the line's side", () => {
    const text = captionText(
      { ...lineCaption(["summary.attacking"], {}), tokens: { side: "Away" }, seed: "0" },
      snapshot,
      t,
      nameOf,
    );
    expect(text?.line).toMatch(/a FC/);
  });

  /** Given a dribble with no lane, then the line reads cleanly without one. */
  it("reads cleanly when a lane is missing", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const text = captionText(
        { ...lineCaption(["dribble"], { player: "h_rm" }), seed },
        snapshot,
        t,
        nameOf,
      );
      expect(text?.line).not.toMatch(/\s[.!]/);
    }
  });

  /** Given a key with no lines, then the next key is tried; none has lines, then nothing is said. */
  it("falls back through its keys, and says nothing when none has lines", () => {
    expect(captionText(lineCaption(["nope", "goalKick"], {}), snapshot, t, nameOf)?.line).toMatch(
      /Goal kick/,
    );
    expect(captionText(lineCaption(["nope"], {}), snapshot, t, nameOf)).toBeNull();
  });

  /** Given a goal with an assist seen, then the goal's line names the assist after it. */
  it("adds the assist to a goal", () => {
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1", "h_rm");
    const told = captionText(
      { kind: "event", priority: "key", event: goal, assist: "h_rm" },
      radarSnapshot({ events: [goal] }),
      t,
      nameOf,
    );
    expect(told?.headline.length).toBeGreaterThan(0);
    expect(told?.line).toContain("H_ST1");
    expect(told?.line).toContain("H_RM");
  });
});

describe("radarNameOf", () => {
  /** Given a player with a match name, then the radar's name is it; without one, the snapshot's name. */
  it("prefers the match name the radar draws", () => {
    const named = radarNameOf(snapshot, new Map([["h_st1", { match_name: "Kai" }]]));
    expect(named("h_st1")).toBe("Kai");
    expect(named("h_rm")).toBe("Player h_rm");
    expect(named(null)).toBe("");
  });
});
