import { describe, expect, it } from "vitest";

import type { MatchEvent } from "../types";
import type { BeatCaption } from "./radarCaptions";
import { choreographBatch, choreographHighlights } from "./radarChoreography";
import { type RadarBeat, initialRadarScene } from "./radarScene";
import { buildRadarStage } from "./radarStage";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";

const snapshot = radarSnapshot();
const stage = buildRadarStage(snapshot);
const start = initialRadarScene(snapshot);

function linesOf(beat: RadarBeat): BeatCaption[] {
  return beat.captions ?? [];
}

function tokensOf(entry: BeatCaption | undefined) {
  return entry?.caption.kind === "line" ? entry.caption.tokens : null;
}

describe("choreography — commentary on each beat", () => {
  /** Given a pass with no one named by the engine, then the line names the team-mate the radar plays it to. */
  it("names the receiver the radar casts", () => {
    const pass = radarEvent("PassCompleted", "Home", "HomeDefense", "h_cb1");
    const [beat] = choreographBatch([pass], stage, start).beats;
    const kick = beat.steps.find((step) => step.action?.kind === "kick")?.action;
    const receiver = kick?.kind === "kick" ? kick.receiver : undefined;
    expect(receiver).toBeTruthy();
    expect(tokensOf(linesOf(beat)[0])?.receiver).toBe(receiver);
  });

  /** Given a shot, then its outcome is said on the beat's last step, the strike on its first. */
  it("puts a shot's outcome on its last step", () => {
    const shot = {
      ...radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk"),
      shot_kind: "Open" as const,
    };
    const [beat] = choreographBatch([shot], stage, start).beats;
    expect(linesOf(beat).map((entry) => entry.step)).toEqual([0, beat.steps.length - 1]);
  });

  /** Given a goal set up by the man whose pass opened the move, then the goal names him as its assist. */
  it("names an assist seen earlier in the move", () => {
    const pass = radarEvent("PassCompleted", "Home", "Midfield", "h_cm1");
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1", "h_cm1");
    const beats = choreographBatch([pass, goal], stage, start).beats;
    const said = linesOf(beats[1]);
    const outcome = said[said.length - 1]?.caption;
    expect(outcome).toMatchObject({ kind: "event", assist: "h_cm1" });
  });

  /** Given the radar acts out only an interception, then its line still names the passer from the minute's events. */
  it("reads the whole minute for who lost the ball", () => {
    const events: MatchEvent[] = [
      radarEvent("PassIntercepted", "Away", "Midfield", "a_cm2"),
      radarEvent("Interception", "Home", "Midfield", "h_cm1"),
      radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
      radarEvent("ShotOffTarget", "Home", "AwayBox", "h_st1"),
    ];
    const { beats } = choreographHighlights(events, stage, start);
    const won = beats.find((beat) => beat.eventType === "Interception");
    expect(won && tokensOf(linesOf(won)[0])?.other).toBe("a_cm2");
  });

  /** Given a minute with nothing to act out, then its quiet beat carries no line of its own: the director adds the summary. */
  it("leaves a quiet beat without a line", () => {
    const events = [radarEvent("PassCompleted", "Home", "Midfield", "h_cm1")];
    const { beats } = choreographHighlights(events, stage, start, {
      ballZone: "AwayDefense",
      possession: "Home",
    });
    expect(beats).toHaveLength(1);
    expect(linesOf(beats[0])).toEqual([]);
  });
});
