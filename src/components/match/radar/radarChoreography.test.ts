import { describe, expect, it } from "vitest";

import type { MatchEvent } from "../types";

import { choreographBatch, choreographHighlights } from "./radarChoreography";
import {
  CENTRE_LANE,
  HALFWAY,
  PITCH_LENGTH,
  distance,
  fromPitch,
  lerp as lerpPoint,
  zoneSpan,
} from "./radarGeometry";
import {
  type RadarBeat,
  type RadarScene,
  applyStep,
  focusOf,
  initialRadarScene,
} from "./radarScene";
import { buildRadarStage } from "./radarStage";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";
import { type QueuedBeat, meetingPoint, timeSteps, trimBacklog } from "./radarTiming";

const snapshot = radarSnapshot();
const stage = buildRadarStage(snapshot);
const start = initialRadarScene(snapshot);

function play(beats: RadarBeat[], from: RadarScene = start): RadarScene {
  return beats.reduce(
    (scene, beat) => beat.steps.reduce((inner, step) => applyStep(inner, step), scene),
    from,
  );
}

function standingAt(scene: RadarScene, playerId: string) {
  return scene.movers[playerId] ?? stage.positionAt(playerId, focusOf(scene));
}

function standingIn(scene: RadarScene, playerId: string) {
  return standingAt(scene, playerId) ?? scene.ball;
}

describe("choreographBatch — passing", () => {
  // Given a completed pass followed by a team-mate's dribble, when the batch is
  // staged, then the ball is played to the man the engine had act next.
  it("plays the pass to the next man on the ball", () => {
    const events = [
      radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
      radarEvent("Dribble", "Home", "AwayDefense", "h_st2"),
    ];
    const { beats } = choreographBatch(events, stage, start);
    const afterPass = play(beats.slice(0, 1));
    const receiver = standingAt(afterPass, "h_st2");
    expect(receiver).not.toBeNull();
    expect(distance(afterPass.ball, receiver ?? afterPass.ball)).toBeLessThan(2.5);
    expect(afterPass.highlight).toContain("h_st2");
  });

  // Given a pass from the back with nothing after it, then a midfielder — the
  // line the ball moves into — receives it.
  it("finds a receiver in the next line when the engine names none", () => {
    const events = [radarEvent("PassCompleted", "Home", "HomeDefense", "h_cb1")];
    const scene = play(choreographBatch(events, stage, start).beats);
    const receiver = scene.highlight.find((id) => id !== "h_cb1");
    expect(["h_lm", "h_cm1", "h_cm2", "h_rm"]).toContain(receiver);
    expect(scene.possession).toBe("Home");
  });

  // Given an intercepted pass, then the pass is drawn cut, the interceptor stands
  // where he cut it, and the ball is his side's.
  it("cuts an intercepted pass where the interceptor meets it", () => {
    const events = [
      radarEvent("PassIntercepted", "Home", "HomeDefense", "h_cb2"),
      radarEvent("Interception", "Away", "HomeDefense", "a_cm1"),
    ];
    const { beats } = choreographBatch(events, stage, start);
    expect(beats).toHaveLength(1);
    const scene = play(beats);
    expect(scene.overlay?.kind).toBe("cut");
    expect(scene.movers.a_cm1).toEqual(scene.ball);
    expect(scene.possession).toBe("Away");
  });
});

describe("choreographBatch — lanes (phase 2, GĐ3)", () => {
  const withLane = (
    event: ReturnType<typeof radarEvent>,
    lane: "Left" | "Centre" | "Right",
    tactical_context: MatchEvent["tactical_context"] = null,
  ): MatchEvent => ({ ...event, lane, tactical_context });

  // Given a home dribble down its left in the attacking third, whoever is on
  // the ball, then it starts in the left band of the pitch.
  it("draws an event in the band of its lane", () => {
    for (const lane of ["Left", "Centre", "Right"] as const) {
      const event = withLane(radarEvent("Dribble", "Home", "AwayDefense", "h_st1"), lane);
      const [beat] = choreographBatch([event], stage, start).beats;
      const carry = beat.steps.find((step) => step.action?.kind === "carry");
      const at = fromPitch("Home", carry?.ball?.at ?? start.ball).lane;
      const band = { Left: [0, 26], Centre: [19, 49], Right: [42, 68] }[lane];
      expect(at).toBeGreaterThanOrEqual(band[0]);
      expect(at).toBeLessThanOrEqual(band[1]);
    }
  });

  // Given an away cross from its left, then it is struck from the away side's
  // left touchline: the mirror of the home side's left on the pitch.
  it("crosses from the touchline of the cross's lane, mirrored for the away side", () => {
    const event = withLane(radarEvent("Cross", "Away", "HomeDefense", "a_cm1", "a_st1"), "Left");
    const [beat] = choreographBatch([event], stage, start).beats;
    const kick = beat.steps.findIndex((step) => step.action?.kind === "kick");
    const struck = play([{ ...beat, steps: beat.steps.slice(0, kick) }]);
    expect(fromPitch("Away", struck.ball).lane).toBeLessThan(10);
    expect(struck.ball.y).toBeGreaterThan(CENTRE_LANE);
  });

  // Given a low cross and an early one, then the low one is driven along the
  // ground and the early one is struck well short of the byline.
  it("drives a low cross along the ground and plays an early one from deep", () => {
    const low = withLane(
      radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
      "Right",
      "LowCross",
    );
    const lowKick = choreographBatch([low], stage, start).beats[0].steps.find(
      (step) => step.action?.kind === "kick",
    )?.action;
    expect(lowKick?.kind === "kick" && lowKick.peak === 0).toBe(true);
    const early = withLane(
      radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
      "Right",
      "EarlyCross",
    );
    const [beat] = choreographBatch([early], stage, start).beats;
    const kick = beat.steps.findIndex((step) => step.action?.kind === "kick");
    const struck = play([{ ...beat, steps: beat.steps.slice(0, kick) }]);
    expect(fromPitch("Home", struck.ball).depth).toBeLessThan(80);
  });

  // Given a wide man cutting inside from the left, then his run ends nearer
  // the middle than it starts.
  it("brings a man who cuts inside towards the middle", () => {
    const event = withLane(
      radarEvent("Dribble", "Home", "AwayDefense", "h_lm"),
      "Left",
      "CutInside",
    );
    const [beat] = choreographBatch([event], stage, start).beats;
    const carries = beat.steps.filter((step) => step.action?.kind === "carry");
    const first = fromPitch("Home", carries[0].ball?.at ?? start.ball).lane;
    const last = fromPitch("Home", carries[carries.length - 1].ball?.at ?? start.ball).lane;
    expect(last).toBeGreaterThan(first);
  });

  // Given a home break down its left into a flank the away side left open,
  // then the away full back on that flank starts caught upfield of the runner
  // and runs back after him without catching him (phase 2, GĐ5 P5.6).
  it("shows the full back caught upfield chasing back on a break into an open flank", () => {
    const event = withLane(
      radarEvent("Dribble", "Home", "AwayDefense", "h_lm"),
      "Left",
      "FlankExposed",
    );
    const [beat] = choreographBatch([event], stage, start).beats;
    const carries = beat.steps.filter((step) => step.action?.kind === "carry");
    const depthOf = (point: { x: number; y: number } | undefined) =>
      point ? fromPitch("Home", point).depth : Number.NaN;
    const caught = depthOf(beat.steps[0].movers?.a_rb);
    const runnerStart = depthOf(carries[0].movers?.h_lm);
    const chasing = depthOf(carries[carries.length - 1].movers?.a_rb);
    const runnerEnd = depthOf(carries[carries.length - 1].movers?.h_lm);
    expect(caught).toBeLessThan(runnerStart);
    expect(chasing).toBeGreaterThan(caught);
    expect(chasing).toBeLessThan(runnerEnd);
  });
});

describe("choreographBatch — the break and the keeper (phase 2, GĐ5 P5.6)", () => {
  // Given a home dribble on the break from its own half, then both blocks
  // trail behind the ball: the side that lost it is still upfield.
  it("leaves the blocks behind a counter-attack", () => {
    const counter: MatchEvent = {
      ...radarEvent("Dribble", "Home", "Midfield", "h_st1"),
      tactical_context: "Counter",
    };
    const plain = radarEvent("Dribble", "Home", "Midfield", "h_st1");
    const gap = (event: MatchEvent) => {
      const end = play(choreographBatch([event], stage, start).beats);
      return end.ball.x - focusOf(end).x;
    };
    expect(gap(counter)).toBeGreaterThan(gap(plain) + 5);
  });

  // Given a goal past a keeper who came off his line, then he is well out of
  // his goal as the shot is struck.
  it("draws the keeper off his line before a shot past him", () => {
    const shot: MatchEvent = {
      ...radarEvent("Goal", "Home", "AwayBox", "h_st1"),
      tactical_context: "KeeperOffHisLine",
    };
    const [beat] = choreographBatch([shot], stage, start).beats;
    const kick = beat.steps.findIndex((step) => step.action?.kind === "kick");
    const struck = play([{ ...beat, steps: beat.steps.slice(0, kick + 1) }]);
    const keeper = standingIn(struck, "a_gk");
    expect(PITCH_LENGTH - keeper.x).toBeGreaterThan(8);
  });
});

describe("choreographHighlights — offside (after GĐ5)", () => {
  // Given a home forward flagged offside, then the ball is played to him a
  // stride beyond the last away defender, the whistle goes, and the away side
  // has the free kick where he was caught.
  it("plays the ball to a runner beyond the last defender and gives the defence the free kick", () => {
    const flag = radarEvent("Offside", "Home", "AwayDefense", "h_st1");
    const { beats } = choreographHighlights([flag], stage, start);
    const beat = beats.find((b) => b.eventType === "Offside");
    expect(beat).toBeDefined();
    const steps = beat?.steps ?? [];
    expect(steps.some((step) => step.overlay?.kind === "whistle")).toBe(true);
    expect(play(beats).possession).toBe("Away");
    const kick = steps.find((step) => step.action?.kind === "kick")?.action;
    const caught = kick?.kind === "kick" ? fromPitch("Home", kick.to).depth : Number.NaN;
    const lastDefender = Math.max(
      ...["a_lb", "a_cb1", "a_cb2", "a_rb"].map(
        (id) => fromPitch("Home", standingIn(start, id)).depth,
      ),
    );
    expect(caught).toBeGreaterThan(lastDefender);
  });
});

describe("choreographHighlights — a build-up lost in midfield (phase 2, GĐ5 P5.6)", () => {
  const minute = (context: MatchEvent["tactical_context"]): MatchEvent[] => [
    { ...radarEvent("PassIntercepted", "Home", "HomeDefense", "h_cb2"), tactical_context: context },
    { ...radarEvent("Interception", "Away", "HomeDefense", "a_cm1"), tactical_context: context },
    radarEvent("Goal", "Away", "HomeBox", "a_st1"),
  ];
  // The home side is building up: the minute before left the ball in its third.
  const buildingUp = initialRadarScene(radarSnapshot({ ball_zone: "HomeDefense" }));
  const wonAt = (events: MatchEvent[]) => {
    const { beats } = choreographHighlights(events, stage, buildingUp);
    // A high turnover is acted out from the lost pass, the interception with it.
    const upTo = beats.findIndex((beat) =>
      ["Interception", "PassIntercepted"].includes(beat.eventType),
    );
    expect(upTo).toBeGreaterThanOrEqual(0);
    return play(beats.slice(0, upTo + 1), buildingUp).ball.x;
  };

  // Given a home build-up cut out but not a high turnover (the engine keeps
  // the ball in midfield since P5.2), then the ball is won in midfield; a high
  // turnover is acted out from the lost pass, the press on the passer shown,
  // and won well short of that.
  it("wins an unlabelled build-up in midfield and a high turnover high up", () => {
    const [from, to] = zoneSpan("Midfield");
    const plain = wonAt(minute(null));
    expect(plain).toBeGreaterThanOrEqual(from);
    expect(plain).toBeLessThanOrEqual(to);
    expect(wonAt(minute("HighTurnover"))).toBeLessThan(plain - 8);
  });
});

describe("choreographBatch — build-up and long balls (phase 2, GĐ4)", () => {
  const kickOf = (beat: RadarBeat) =>
    beat.steps.find((step) => step.action?.kind === "kick")?.action;

  // Given a pass out of the home third down its left, then it is played to a
  // spot in the left band.
  it("plays a build-up pass inside the band of its lane", () => {
    const event: MatchEvent = {
      ...radarEvent("PassCompleted", "Home", "HomeDefense", "h_lb"),
      lane: "Left",
    };
    const kick = kickOf(choreographBatch([event], stage, start).beats[0]);
    expect(kick?.kind).toBe("kick");
    const to = kick?.kind === "kick" ? kick.to : start.ball;
    expect(fromPitch("Home", to).lane).toBeLessThanOrEqual(26);
  });

  // Given a long ball that drops in midfield for a loose ball, and one met in
  // the attacking third, then each is lofted, the first coming down in
  // midfield and the second in the final third.
  it("lofts a long ball to where it comes down", () => {
    const long = radarEvent("LongBall", "Home", "HomeDefense", "h_cb1", "h_st1");
    const short = choreographBatch(
      [long, radarEvent("BallRecovery", "Away", "Midfield", "a_cm1", "h_cm1")],
      stage,
      start,
    ).beats[0];
    const shortKick = kickOf(short);
    expect(shortKick?.kind === "kick" && shortKick.peak > 0).toBe(true);
    const shortDepth = fromPitch(
      "Home",
      shortKick?.kind === "kick" ? shortKick.to : start.ball,
    ).depth;
    expect(shortDepth).toBeGreaterThan(38);
    expect(shortDepth).toBeLessThan(67);
    const over = choreographBatch(
      [long, radarEvent("Dribble", "Home", "AwayDefense", "h_st1")],
      stage,
      start,
    ).beats[0];
    const overKick = kickOf(over);
    expect(
      fromPitch("Home", overKick?.kind === "kick" ? overKick.to : start.ball).depth,
    ).toBeGreaterThan(70);
  });

  // Given a loose ball won by an away midfielder over a home one, then both go
  // for it and the winner ends with it, the ball his side's.
  it("sends both men to a loose ball and gives it to the winner", () => {
    const event = radarEvent("BallRecovery", "Away", "Midfield", "a_cm1", "h_cm1");
    const scene = play(choreographBatch([event], stage, start).beats);
    expect(scene.possession).toBe("Away");
    expect(distance(scene.ball, standingIn(scene, "a_cm1"))).toBeLessThan(2.5);
    expect(scene.highlight).toEqual(expect.arrayContaining(["a_cm1", "h_cm1"]));
  });

  // Given a home build-up lost to a high press, then away players close the
  // passer down before the ball is cut out.
  it("closes the passer down before a high turnover", () => {
    const events: MatchEvent[] = [
      {
        ...radarEvent("PassIntercepted", "Home", "HomeDefense", "h_cb2"),
        tactical_context: "HighTurnover",
      },
      {
        ...radarEvent("Interception", "Away", "HomeDefense", "a_st1"),
        tactical_context: "HighTurnover",
      },
    ];
    const [beat] = choreographBatch(events, stage, start).beats;
    const pressers = Object.keys(beat.steps[0].movers ?? {}).filter(
      (id) => id.startsWith("a_") && id !== "a_st1",
    );
    expect(pressers.length).toBeGreaterThan(0);
  });
});

describe("choreographBatch — attacking", () => {
  // Given a cross aimed at a striker, then the ball rises in flight and comes
  // down where the striker meets it.
  it("arcs a cross onto the man it is aimed at", () => {
    const events = [radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1")];
    const [beat] = choreographBatch(events, stage, start).beats;
    const kick = beat.steps.find((step) => step.action?.kind === "kick")?.action;
    expect(kick?.kind === "kick" && kick.peak > 0 && kick.receiver === "h_st1").toBe(true);
    const scene = play([beat]);
    expect(scene.lift).toBe(0);
    expect(distance(scene.ball, scene.movers.h_st1)).toBeLessThan(2);
    expect(scene.ball.x).toBeGreaterThan(PITCH_LENGTH - 16.5);
  });

  // Given a home goal, then the ball finishes in the away net, the goal is
  // flagged for the celebration, and the beat is one that must be seen.
  it("puts a goal in the net and flags it", () => {
    const events = [radarEvent("Goal", "Home", "AwayBox", "h_st1", "h_lm")];
    const [beat] = choreographBatch(events, stage, start).beats;
    expect(beat.important).toBe(true);
    const scene = play([beat]);
    expect(scene.ball.x).toBeGreaterThan(PITCH_LENGTH);
    expect(Math.abs(scene.ball.y - CENTRE_LANE)).toBeLessThan(3.66);
    expect(scene.goal?.side).toBe("Home");
  });

  // Given an away goal, then the ball finishes in the home net.
  it("puts an away goal in the home net", () => {
    const events = [radarEvent("Goal", "Away", "HomeBox", "a_st2")];
    const scene = play(choreographBatch(events, stage, start).beats);
    expect(scene.ball.x).toBeLessThan(0);
    expect(scene.goal?.side).toBe("Away");
  });

  // Given a save that names the keeper, then the ball ends in his hands.
  it("ends a save with the keeper who made it", () => {
    const events = [radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk")];
    const scene = play(choreographBatch(events, stage, start).beats);
    expect(scene.movers.a_gk).toEqual(scene.ball);
    expect(scene.ball.x).toBeGreaterThan(PITCH_LENGTH - 5.5);
  });
});

describe("choreographBatch — the match around the ball", () => {
  // Given a kick-off after play elsewhere, then the ball is back on the centre
  // spot and every player is back in his shape.
  it("resets to the centre spot at kick-off", () => {
    const moved = play(
      choreographBatch([radarEvent("Dribble", "Home", "AwayDefense", "h_st1")], stage, start).beats,
    );
    const scene = play(
      choreographBatch([radarEvent("KickOff", "Away", "Midfield")], stage, moved).beats,
      moved,
    );
    expect(scene.ball).toEqual({ x: HALFWAY, y: CENTRE_LANE });
    expect(scene.movers).toEqual({});
  });

  // Given a booking, then the card is shown over the player who was booked.
  it("shows a card over the booked player", () => {
    const events = [radarEvent("YellowCard", "Away", "Midfield", "a_cm2")];
    const scene = play(choreographBatch(events, stage, start).beats);
    expect(scene.overlay).toEqual({ kind: "card", playerId: "a_cm2", colour: "yellow" });
  });

  // Given a sending-off, then the radar never skips it to catch up — the man
  // leaves the pitch, and the card is why — while a booking may be skipped.
  it("never skips a sending-off", () => {
    const beatFor = (eventType: string) =>
      choreographBatch([radarEvent(eventType, "Away", "Midfield", "a_cm2")], stage, start).beats[0];
    expect(beatFor("RedCard").important).toBe(true);
    expect(beatFor("SecondYellow").important).toBe(true);
    expect(beatFor("YellowCard").important).toBe(false);
  });

  // Given a beat staged where the ball was meant to be, when the radar shows it
  // from somewhere else (a beat before it was skipped to catch up), then its
  // first step brings the ball along: the man winning it or the whistle is
  // where the ball is drawn.
  it("brings the ball along when a skipped beat left it elsewhere", () => {
    const elsewhere: RadarScene = { ...start, ball: { x: 20, y: 10 } };
    const firstStep = (event: ReturnType<typeof radarEvent>) =>
      applyStep(elsewhere, choreographBatch([event], stage, start).beats[0].steps[0]);
    for (const [eventType, playerId] of [
      ["Tackle", "a_cm1"],
      ["Interception", "a_cm1"],
      ["Clearance", "a_cb1"],
    ] as const) {
      const scene = firstStep(radarEvent(eventType, "Away", "Midfield", playerId));
      expect(scene.ball, eventType).toEqual(scene.movers[playerId]);
    }
    for (const eventType of ["Foul", "FreeKick"]) {
      const scene = firstStep(radarEvent(eventType, "Away", "Midfield", "a_cm1"));
      expect(scene.overlay?.kind, eventType).toBe("whistle");
      expect(scene.ball, eventType).toEqual(
        scene.overlay?.kind === "whistle" ? scene.overlay.at : null,
      );
    }
  });

  // Given events with nothing to show on the pitch, then they stage nothing.
  it("stages nothing for a substitution", () => {
    const events = [radarEvent("Substitution", "Home", "Midfield", "h_x", "h_cm1")];
    expect(choreographBatch(events, stage, start).beats).toHaveLength(0);
  });

  // Given a minute that ends with the engine moving the ball without an event (a
  // won possession contest), when the batch is staged with where the engine left
  // the ball, then the radar finishes there too.
  it("settles where the engine left the ball", () => {
    const events = [radarEvent("PassCompleted", "Home", "HomeDefense", "h_cb1")];
    const { beats } = choreographBatch(events, stage, start, {
      ballZone: "AwayDefense",
      possession: "Away",
    });
    const scene = play(beats);
    const [from, to] = zoneSpan("AwayDefense");
    expect(scene.ball.x).toBeGreaterThanOrEqual(from);
    expect(scene.ball.x).toBeLessThanOrEqual(to);
    expect(scene.possession).toBe("Away");
  });

  // Given an intercepted pass in midfield that the engine leaves in midfield,
  // then the ball stays where it was cut out: midfield is a wide band, and the
  // ball is already in it.
  it("leaves the ball where it is when it is already in the engine's zone", () => {
    const events = [
      radarEvent("PassIntercepted", "Away", "Midfield", "a_cm1"),
      radarEvent("Interception", "Home", "Midfield", "h_cm1"),
    ];
    const { beats } = choreographBatch(events, stage, start, {
      ballZone: "Midfield",
      possession: "Home",
    });
    const scene = play(beats);
    expect(scene.movers.h_cm1).toEqual(scene.ball);
  });

  // Given a pass in midfield that the engine follows up in the attacking third,
  // then the man on the ball carries it on himself: it never rolls on without him.
  it("carries the ball on with the man on it when the engine moves it on", () => {
    const events = [radarEvent("PassCompleted", "Home", "Midfield", "h_cm1")];
    const { beats } = choreographBatch(events, stage, start, {
      ballZone: "AwayBox",
      possession: "Home",
    });
    const settle = beats[beats.length - 1];
    expect(settle.eventType).toBe("Settle");
    const [take, ...touches] = settle.steps;
    const carrier = take.action?.kind === "take" ? take.action.by : "";
    const scene = play(beats);
    expect(scene.ball.x).toBeGreaterThanOrEqual(zoneSpan("AwayBox")[0]);
    expect(distance(scene.ball, scene.movers[carrier])).toBeLessThan(2);
    // He has it already; then touch by touch, never a long roll with him chasing after it.
    expect(carrier.startsWith("h_")).toBe(true);
    for (const step of touches) {
      expect(step.pace).toBe("carry");
      const feet = step.movers?.[carrier];
      expect(distance(step.ball?.at ?? scene.ball, feet ?? { x: 0, y: 0 })).toBeLessThan(2);
    }
    expect(touches.length).toBeGreaterThan(1);
  });

  // Given the side keeping the ball beyond the zone the engine names, then the
  // radar leaves it there: no one carries it back towards his own goal.
  it("never carries the ball back towards the side's own goal", () => {
    const events = [radarEvent("Dribble", "Home", "AwayDefense", "h_st2")];
    const { beats } = choreographBatch(events, stage, start, {
      ballZone: "AwayDefense",
      possession: "Home",
    });
    const afterDribble = play(beats.slice(0, 1));
    expect(afterDribble.ball.x).toBeGreaterThan(zoneSpan("AwayDefense")[1]);
    let scene = afterDribble;
    for (const beat of beats.slice(1)) {
      for (const step of beat.steps) {
        const next = applyStep(scene, step);
        expect(next.ball.x).toBeGreaterThanOrEqual(scene.ball.x - 1e-6);
        scene = next;
      }
    }
  });

  // After a goal, the engine restarts from the centre spot, and so does the radar.
  it("brings the ball back to the centre spot after a goal", () => {
    const events = [radarEvent("Goal", "Home", "AwayBox", "h_st1")];
    const { beats } = choreographBatch(events, stage, start, {
      ballZone: "Midfield",
      possession: "Away",
    });
    expect(play(beats).ball).toEqual({ x: HALFWAY, y: CENTRE_LANE });
  });
});

describe("choreographBatch — dribbling", () => {
  const dribble = [radarEvent("Dribble", "Home", "AwayDefense", "h_rm")];
  const [beat] = choreographBatch(dribble, stage, start).beats;
  const touches = beat.steps
    .map((step, index) => ({ step, ms: beat.stepMs[index], index }))
    .filter(({ step }) => step.pace === "carry");

  /** The scene just before step `index` of the beat. */
  const before = (index: number) =>
    beat.steps.slice(0, index).reduce((scene, step) => applyStep(scene, step), start);

  // Given a dribble, then it is acted out touch by touch, not as one slide.
  it("takes the ball forward in several touches", () => {
    expect(touches.length).toBeGreaterThanOrEqual(3);
  });

  // Given a dribble, then the dribbler runs at a footballer's pace with the ball
  // — no faster than 7 m/s — on every touch.
  it("runs with the ball at a real pace", () => {
    for (const { step, ms, index } of touches) {
      const from = standingIn(before(index), "h_rm");
      const to = step.movers?.h_rm;
      expect(to).toBeDefined();
      const metresPerSecond = (distance(from, to ?? from) / ms) * 1000;
      expect(metresPerSecond).toBeLessThanOrEqual(7);
    }
  });

  // Given a dribble, then each touch leaves the ball a stride in front of the
  // dribbler, never metres away from him.
  it("keeps the ball at the dribbler's feet", () => {
    for (const { step } of touches) {
      const feet = step.movers?.h_rm;
      expect(distance(step.ball?.at ?? { x: 0, y: 0 }, feet ?? { x: 99, y: 99 })).toBeLessThan(2);
    }
  });

  // Given a defender jockeying, then he never stands on top of the dribbler:
  // the two dots stay apart on every touch.
  it("keeps the defender a dot's width off the dribbler", () => {
    for (const { step } of touches) {
      const ids = Object.keys(step.movers ?? {});
      const defender = ids.find((id) => id !== "h_rm");
      if (!defender) continue;
      const gap = distance(step.movers?.[defender] ?? start.ball, step.movers?.h_rm ?? start.ball);
      expect(gap).toBeGreaterThan(3.4);
    }
  });

  // Given the dribbler and the defender both moving, then their dots never pass
  // through each other at any moment of a touch — not just where each ends.
  it("never runs the dribbler through the defender", () => {
    const dotWidth = 3.4;
    for (const { step, index } of touches) {
      const scene = before(index);
      const ids = Object.keys(step.movers ?? {});
      const defender = ids.find((id) => id !== "h_rm");
      if (!defender) continue;
      const runnerFrom = standingIn(scene, "h_rm");
      const defenderFrom = standingIn(scene, defender);
      for (let t = 0; t <= 1; t += 0.1) {
        const runner = lerpPoint(runnerFrom, step.movers?.h_rm ?? runnerFrom, t);
        const marker = lerpPoint(defenderFrom, step.movers?.[defender] ?? defenderFrom, t);
        expect(distance(runner, marker)).toBeGreaterThan(dotWidth);
      }
    }
  });

  // Given a dribble, then it is a defender or midfielder who steps up to him,
  // not a forward who happens to be nearby.
  it("is met by a defender or a midfielder", () => {
    const defender = Object.keys(touches[0].step.movers ?? {}).find((id) => id !== "h_rm");
    expect(["a_lb", "a_cb1", "a_cb2", "a_rb", "a_lm", "a_cm1", "a_cm2", "a_rm"]).toContain(
      defender,
    );
  });

  // Given a defender in the way, then he stays goal-side while the dribbler
  // runs at him, and the last touch takes the dribbler past him.
  it("jockeys the defender and then beats him", () => {
    const [firstTouch] = touches;
    const lastTouch = touches[touches.length - 1];
    const defender = Object.keys(lastTouch.step.movers ?? {}).find((id) => id !== "h_rm");
    expect(defender?.startsWith("a_")).toBe(true);
    const depthOf = (point: { x: number; y: number } | undefined) => (point ? point.x : Number.NaN);
    expect(depthOf(firstTouch.step.movers?.[defender ?? ""])).toBeGreaterThan(
      depthOf(firstTouch.step.movers?.h_rm),
    );
    expect(depthOf(lastTouch.step.movers?.[defender ?? ""])).toBeLessThan(
      depthOf(lastTouch.step.movers?.h_rm),
    );
  });

  // Given a dribble that comes off, then the engine has the ball in the box
  // after it, so the run ends there — inside the box, well short of the keeper.
  it("ends the run in the box, short of the keeper", () => {
    const feet = touches[touches.length - 1].step.movers?.h_rm ?? start.ball;
    expect(feet.x).toBeGreaterThanOrEqual(zoneSpan("AwayBox")[0]);
    expect(feet.x).toBeLessThanOrEqual(93);
    const keeper = standingIn(play([beat]), "a_gk");
    expect(keeper.x - feet.x).toBeGreaterThan(5);
  });

  // Given a dribble that starts deep in the box, then the dribbler neither runs
  // on past the keeper nor back towards halfway: he beats his man across.
  it("holds its depth when it starts deep in the box", () => {
    const deep: RadarScene = {
      ...start,
      ball: { x: 96, y: 40 },
      movers: { h_st2: { x: 96, y: 40 } },
      possession: "Home",
    };
    const events = [radarEvent("Dribble", "Home", "AwayDefense", "h_st2")];
    const [deepBeat] = choreographBatch(events, stage, deep).beats;
    for (const step of deepBeat.steps.filter((each) => each.pace === "carry")) {
      expect(step.movers?.h_st2?.x).toBeCloseTo(96, 6);
    }
  });
});

describe("choreographBatch — shooting from the box", () => {
  /** Where the ball lies each time a step strikes a shot. */
  function shotOrigins(events: ReturnType<typeof radarEvent>[], from: RadarScene) {
    const origins: { x: number; y: number }[] = [];
    let scene = from;
    for (const beat of choreographBatch(events, stage, from).beats) {
      for (const step of beat.steps) {
        if (step.action?.kind === "kick" && step.action.pace === "shot") origins.push(scene.ball);
        scene = applyStep(scene, step);
      }
    }
    return origins;
  }
  const inTheBox = (point: { x: number; y: number }) =>
    point.x >= zoneSpan("AwayBox")[0] && Math.abs(point.y - CENTRE_LANE) <= 20.16;
  /** A counter-attack: the striker has the ball 27 m out, in the middle of the attacking third. */
  const counter: RadarScene = {
    ...start,
    ball: { x: 78, y: 30 },
    movers: { h_st2: { x: 78, y: 30 } },
    possession: "Home",
  };

  for (const shot of ["Goal", "ShotSaved", "ShotOffTarget", "ShotBlocked", "ShotOnTarget"]) {
    // Given a shot from a man on the ball outside the box, then he takes it into
    // the box first: the engine only ever shoots from inside it.
    it(`strikes a ${shot} from inside the box after a counter`, () => {
      const origins = shotOrigins([radarEvent(shot, "Home", "AwayBox", "h_st2", "a_gk")], counter);
      expect(origins.length).toBeGreaterThan(0);
      for (const origin of origins) expect(inTheBox(origin), JSON.stringify(origin)).toBe(true);
    });

    // Given a winger's dribble down the line and then his shot, then he cuts
    // inside into the box before he strikes it.
    it(`strikes a ${shot} from inside the box after a dribble down the wing`, () => {
      const events = [
        radarEvent("Dribble", "Home", "AwayDefense", "h_rm"),
        radarEvent(shot, "Home", "AwayBox", "h_rm", "a_gk"),
      ];
      const origins = shotOrigins(events, start);
      expect(origins.length).toBeGreaterThan(0);
      for (const origin of origins) expect(inTheBox(origin), JSON.stringify(origin)).toBe(true);
    });
  }
});

describe("choreographBatch — shooting from distance", () => {
  /** Where the ball lies each time a step strikes a shot. */
  function shotOrigins(events: ReturnType<typeof radarEvent>[], from: RadarScene) {
    const origins: { x: number; y: number }[] = [];
    let scene = from;
    for (const beat of choreographBatch(events, stage, from).beats) {
      for (const step of beat.steps) {
        if (step.action?.kind === "kick" && step.action.pace === "shot") origins.push(scene.ball);
        scene = applyStep(scene, step);
      }
    }
    return origins;
  }
  const outsideTheBox = (point: { x: number; y: number }) =>
    point.x < zoneSpan("AwayBox")[0] && point.x > zoneSpan("AwayDefense")[0];

  for (const shot of ["Goal", "ShotSaved", "ShotOffTarget", "ShotBlocked"]) {
    // Given a shot from distance (phase 2, P2.5), from a man on the ball in
    // the box and from one in midfield, then it is struck outside the box in
    // his stride: never carried in, never pulled back from the box either.
    it(`strikes a shot from distance ${shot} from outside the box`, () => {
      const longShot = {
        ...radarEvent(shot, "Home", "AwayDefense", "h_cm1", "a_gk"),
        shot_kind: "LongRange" as const,
      };
      for (const from of [
        start,
        { ...start, ball: { x: 95, y: 34 }, possession: "Home" as const },
      ]) {
        const origins = shotOrigins([longShot], from);
        expect(origins.length).toBeGreaterThan(0);
        for (const origin of origins)
          expect(outsideTheBox(origin), JSON.stringify(origin)).toBe(true);
      }
    });

    // Given a direct free kick (event protocol 2), then it is struck from where
    // the foul gave it, outside the box: it is not carried in like a shot from
    // open play.
    it(`strikes a direct free kick ${shot} from outside the box`, () => {
      const kick = {
        ...radarEvent(shot, "Home", "AwayDefense", "h_st2", "a_gk"),
        shot_kind: "DirectFreeKick" as const,
      };
      const origins = shotOrigins([kick], start);
      expect(origins.length).toBeGreaterThan(0);
      for (const origin of origins)
        expect(outsideTheBox(origin), JSON.stringify(origin)).toBe(true);
    });
  }
});

describe("choreographBatch — timing", () => {
  // Given a long pass and a short one, then the long one takes longer: steps
  // are timed by how far the ball travels, not squeezed into a fixed slot.
  it("times a pass by the distance the ball travels", () => {
    const short = choreographBatch(
      [radarEvent("PassCompleted", "Home", "Midfield", "h_cm1", null)],
      stage,
      start,
    ).beats[0];
    const long = choreographBatch(
      [radarEvent("PassCompleted", "Home", "HomeDefense", "h_cb1", null)],
      stage,
      start,
    ).beats[0];
    const travelMs = (beat: RadarBeat) => beat.stepMs[beat.stepMs.length - 1];
    expect(travelMs(long)).not.toBe(travelMs(short));
    expect(Math.max(travelMs(long), travelMs(short))).toBeGreaterThan(400);
  });
});

/** When the beat gets `playerId` to where it last sends him, and when the ball first gets there. */
function arrivals(beat: RadarBeat, playerId: string) {
  let elapsed = 0;
  let arrive = Number.NaN;
  let target: { x: number; y: number } | undefined;
  beat.steps.forEach((step, index) => {
    const to = step.movers?.[playerId];
    if (to) {
      target = to;
      arrive = elapsed + (beat.runMs[index][playerId] ?? beat.stepMs[index]);
    }
    elapsed += beat.stepMs[index];
  });
  elapsed = 0;
  let ballThere = Number.POSITIVE_INFINITY;
  for (const [index, step] of beat.steps.entries()) {
    elapsed += beat.stepMs[index];
    if (target && step.ball && distance(step.ball.at, target) < 2) {
      ballThere = elapsed;
      break;
    }
  }
  return { arrive, ballThere, target };
}

/** Every step of the beat that sends the ball through the air or along the ground. */
function flights(beat: RadarBeat, from: RadarScene = start) {
  const legs: { metres: number; ms: number }[] = [];
  let scene = from;
  for (const [index, step] of beat.steps.entries()) {
    if (step.ball && step.pace !== "carry" && step.pace !== "place") {
      legs.push({ metres: distance(scene.ball, step.ball.at), ms: beat.stepMs[index] });
    }
    scene = applyStep(scene, step);
  }
  return legs;
}

describe("choreographBatch — the shapes follow the ball", () => {
  // Given any step that moves the ball, then both shapes form around where the
  // ball goes — not around a fixed point of the zone.
  it("centres the shapes on the ball whenever it moves", () => {
    const events = [
      radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
      radarEvent("Dribble", "Home", "AwayDefense", "h_st2"),
      radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
      radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk"),
    ];
    let scene = start;
    for (const beat of choreographBatch(events, stage, start).beats) {
      for (const step of beat.steps) {
        scene = applyStep(scene, step);
        if (step.ball && step.focusX === undefined) expect(scene.focusX).toBe(scene.ball.x);
      }
    }
  });

  // Given a dribble, then the rest of the side moves up with the ball touch by
  // touch, instead of standing still until the dribble is over.
  it("moves the rest of the side up during a dribble", () => {
    const [beat] = choreographBatch(
      [radarEvent("Dribble", "Home", "AwayDefense", "h_rm")],
      stage,
      start,
    ).beats;
    const scenes = [start];
    for (const step of beat.steps) scenes.push(applyStep(scenes[scenes.length - 1], step));
    const firstTouch = scenes[2];
    const lastTouch = scenes[scenes.length - 1];
    expect(standingIn(lastTouch, "h_cb1").x).toBeGreaterThan(standingIn(firstTouch, "h_cb1").x);
  });
});

describe("choreographBatch — the ball keeps its own pace", () => {
  // Given a pass, a cross and a shot, then the ball always travels at a ball's
  // speed — it is never slowed to wait for a runner.
  it("never slows the ball for a runner", () => {
    const events = [
      radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
      radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
      radarEvent("ShotSaved", "Home", "AwayBox", "h_st1", "a_gk"),
    ];
    for (const beat of choreographBatch(events, stage, start).beats) {
      for (const { metres, ms } of flights(beat)) {
        if (metres < 4) continue;
        expect((metres / ms) * 1000, beat.eventType).toBeGreaterThanOrEqual(12);
      }
    }
  });

  // Given a pass, then the receiver sets off early and is there when the ball
  // arrives, never after it.
  it("has the receiver there when the pass arrives", () => {
    const [pass] = choreographBatch(
      [
        radarEvent("PassCompleted", "Home", "Midfield", "h_cm1"),
        radarEvent("Dribble", "Home", "AwayDefense", "h_st2"),
      ],
      stage,
      start,
    ).beats;
    const { arrive, ballThere } = arrivals(pass, "h_st2");
    expect(arrive).toBeLessThanOrEqual(ballThere + 1);
  });

  // Given a cross, then the man it is aimed at is in the box when it comes down.
  it("has the header taker there when the cross comes down", () => {
    const [cross] = choreographBatch(
      [radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1")],
      stage,
      start,
    ).beats;
    const { arrive, ballThere } = arrivals(cross, "h_st1");
    expect(arrive).toBeLessThanOrEqual(ballThere + 1);
  });

  // Given a shot by a man away from the ball, then the ball is laid into his
  // path and he meets it.
  it("has the shooter meet the ball he shoots", () => {
    const [shot] = choreographBatch(
      [radarEvent("ShotOffTarget", "Home", "AwayBox", "h_st2")],
      stage,
      start,
    ).beats;
    const [take] = shot.steps;
    expect(take.action).toEqual({ kind: "take", by: "h_st2" });
    expect(take.ball?.at).toEqual(take.movers?.h_st2);
    expect(shot.runMs[0].h_st2).toBeLessThanOrEqual(shot.stepMs[0] + 1);
  });
});

describe("choreographBatch — no setting the scene", () => {
  // Given the ball near the man the engine has play it, then he goes to the
  // ball: it does not jump to him, and no one is put in place first.
  it("sends the man to the ball when it is near", () => {
    const [pass] = choreographBatch(
      [radarEvent("PassCompleted", "Home", "Midfield", "h_cm1")],
      stage,
      start,
    ).beats;
    const [first] = pass.steps;
    expect(distance(first.ball?.at ?? { x: 0, y: 0 }, start.ball)).toBeLessThan(0.5);
    expect(first.movers?.h_cm1).toEqual(start.ball);
    expect(first.focusX).toBeUndefined();
  });

  // Given the ball far from the man the engine has play it (a skipped beat, a
  // stand-in), then it is played towards him at a ball's pace and he comes to
  // meet it.
  it("plays a far ball towards the man and has him meet it", () => {
    const far: RadarScene = { ...start, ball: { x: 20, y: 8 }, focusX: 20 };
    const [pass] = choreographBatch(
      [radarEvent("PassCompleted", "Home", "Midfield", "h_cm2")],
      stage,
      far,
    ).beats;
    const [first] = pass.steps;
    const travelled = distance(far.ball, first.ball?.at ?? far.ball);
    expect((travelled / pass.stepMs[0]) * 1000).toBeGreaterThanOrEqual(12);
    const { arrive, ballThere } = arrivals({ ...pass, steps: [first] }, "h_cm2");
    expect(arrive).toBeLessThanOrEqual(ballThere + 1);
  });

  // Given a cross after which the next beat moves on, then the men who acted in
  // the cross jog back into shape, each in his own time, not all at once.
  it("jogs the last beat's actors back, each in his own time", () => {
    const events = [
      radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1"),
      radarEvent("Clearance", "Away", "AwayBox", "a_cb2"),
      radarEvent("PassCompleted", "Away", "AwayDefense", "a_cm1"),
    ];
    const beats = choreographBatch(events, stage, start).beats;
    const pass = beats[beats.length - 1];
    const returning = Object.keys(pass.runMs[0]).filter(
      (id) => !(id in (pass.steps[0].movers ?? {})),
    );
    expect(returning.length).toBeGreaterThan(1);
    const times = new Set(returning.map((id) => Math.round(pass.runMs[0][id])));
    expect(times.size).toBeGreaterThan(1);
  });
});

describe("choreographBatch — closing the ball down", () => {
  // Given a tackle, then team-mates of the tackler close the ball down with him,
  // instead of standing to watch.
  it("has team-mates close the ball down with the tackler", () => {
    const [tackle] = choreographBatch(
      [radarEvent("Tackle", "Away", "Midfield", "a_cm1")],
      stage,
      start,
    ).beats;
    const [first] = tackle.steps;
    const helpers = Object.keys(first.movers ?? {}).filter(
      (id) => id.startsWith("a_") && id !== "a_cm1",
    );
    expect(helpers.length).toBeGreaterThanOrEqual(1);
    for (const id of helpers) {
      const before = distance(standingIn(start, id), start.ball);
      expect(distance(first.movers?.[id] ?? start.ball, start.ball)).toBeLessThan(before);
    }
  });

  // Given a tackler far from the ball, then the man on it runs at him and the
  // two meet in between, so the tackler is not left a 30-metre sprint.
  it("meets a far tackler halfway", () => {
    const dribbled: RadarScene = {
      ...start,
      ball: { x: 50, y: 58 },
      movers: { h_rm: { x: 50, y: 58 } },
      possession: "Home",
    };
    const [tackle] = choreographBatch(
      [radarEvent("Tackle", "Away", "AwayDefense", "a_lb")],
      stage,
      dribbled,
    ).beats;
    const [first] = tackle.steps;
    const run = distance(standingIn(dribbled, "a_lb"), first.movers?.a_lb ?? dribbled.ball);
    expect(run).toBeLessThan(distance(standingIn(dribbled, "a_lb"), dribbled.ball));
    expect(first.ball?.at).toEqual(first.movers?.a_lb);
  });
});

describe("choreographBatch — what to keep when catching up", () => {
  // Given play in the final third, then the radar prefers to keep it over
  // routine play elsewhere.
  it("marks final-third play to keep", () => {
    const beatFor = (eventType: string, side: "Home" | "Away", zone: string) =>
      choreographBatch(
        [radarEvent(eventType, side, zone, `${side === "Home" ? "h" : "a"}_cm1`)],
        stage,
        start,
      ).beats[0];
    expect(beatFor("Cross", "Home", "AwayDefense").prefer).toBe(true);
    expect(beatFor("ShotOffTarget", "Home", "AwayBox").prefer).toBe(true);
    expect(beatFor("Foul", "Away", "AwayBox").prefer).toBe(true);
    expect(beatFor("Dribble", "Home", "AwayDefense").prefer).toBe(true);
    expect(beatFor("PassCompleted", "Home", "Midfield").prefer).toBe(false);
    expect(beatFor("Foul", "Away", "Midfield").prefer).toBe(false);
  });
});

describe("timing — the ball never waits", () => {
  // Given a pass played while a team-mate is still on a long run, then the pass
  // takes as long as the ball needs, and the runner keeps his own pace.
  it("times a ball in flight by the ball alone", () => {
    const passTo = { x: start.ball.x + 20, y: start.ball.y };
    const runnerTo = { x: 5, y: 5 };
    const { stepMs, runMs } = timeSteps(stage, start, [
      { ball: { at: passTo }, movers: { h_st1: runnerTo } },
    ]);
    expect(stepMs[0]).toBeCloseTo(1000, -1);
    const runner = standingIn(start, "h_st1");
    expect(runMs[0].h_st1).toBeCloseTo((distance(runner, runnerTo) / 7) * 1000, -1);
  });

  // Given a runner too far to reach the spot he is wanted at in time, then the
  // ball is played to the furthest point he does reach in time, never beyond.
  it("meets a runner only where he gets to in time", () => {
    const from = { x: 0, y: 0 };
    const want = { x: 30, y: 0 };
    const met = meetingPoint(from, want, () => 1, 0.5);
    expect(met.x).toBeLessThanOrEqual(7 * 1.5 + 1e-9);
    expect(met.x).toBeGreaterThan(7 * 1.5 - 1.5);
    expect(meetingPoint(from, { x: 5, y: 0 }, () => 1, 0)).toEqual({ x: 5, y: 0 });
  });
});

describe("trimBacklog", () => {
  const queued = (key: string, ms: number, important = false, prefer = false): QueuedBeat => ({
    beat: {
      key,
      eventType: "PassCompleted",
      steps: [{}],
      stepMs: [ms],
      runMs: [{}],
      important,
      prefer,
    },
    stepMs: [ms],
    scale: 1,
  });
  const keys = (queue: QueuedBeat[]) => queue.map((entry) => entry.beat.key);
  const totalMs = (queue: QueuedBeat[]) =>
    queue.reduce((sum, entry) => sum + entry.stepMs.reduce((a, b) => a + b, 0), 0);

  // Given a queue the radar can play within its allowed lag, then nothing changes.
  it("keeps every beat when the radar is keeping up", () => {
    const queue = [queued("a", 500), queued("b", 500)];
    expect(trimBacklog(queue, 1500)).toEqual(queue);
  });

  // Given more queued than the radar may lag, then the oldest routine beats are
  // skipped and the latest — where the match is now — is kept, at full length.
  it("skips the oldest routine play to catch up", () => {
    const kept = trimBacklog([queued("a", 900), queued("b", 900), queued("c", 900)], 1500);
    expect(keys(kept)).toEqual(["c"]);
    expect(totalMs(kept)).toBe(900);
  });

  // Given a dribble followed by the tidy-up that settles the ball, when the
  // radar is behind, then the tidy-up goes and the dribble stays.
  it("keeps the latest action even when a tidy-up follows it", () => {
    const settle = (key: string, ms: number): QueuedBeat => ({
      ...queued(key, ms),
      beat: { ...queued(key, ms).beat, eventType: "Settle" },
    });
    const kept = trimBacklog(
      [queued("pass", 900), settle("s1", 400), queued("dribble", 1400), settle("s2", 400)],
      1500,
    );
    expect(keys(kept)).toContain("dribble");
    expect(keys(kept)).not.toContain("s1");
  });

  // Given final-third play and routine play both queued, when the radar must
  // skip one to catch up, then the routine play goes first.
  it("skips routine play before final-third play", () => {
    const kept = trimBacklog(
      [queued("cross", 900, false, true), queued("pass", 900), queued("latest", 900)],
      1900,
    );
    expect(keys(kept)).toEqual(["cross", "latest"]);
  });

  // Given a goal among the backlog, then it is never skipped; what is left is
  // sped up, but never by more than a third.
  it("never skips a goal, and never hurries more than a third", () => {
    const kept = trimBacklog(
      [queued("goal", 2000, true), queued("a", 900), queued("b", 1500)],
      1500,
    );
    expect(keys(kept)).toEqual(["goal", "b"]);
    expect(totalMs(kept)).toBeCloseTo(3500 / 1.3, 0);
  });
});
