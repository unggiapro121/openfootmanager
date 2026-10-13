import { describe, expect, it } from "vitest";

import { choreographBatch } from "./radarChoreography";
import {
  CENTRE_LANE,
  HALFWAY,
  PITCH_LENGTH,
  distance,
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
    (scene, beat) => beat.steps.reduce((inner, step) => applyStep(inner, step, 0), scene),
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

describe("choreographBatch — attacking", () => {
  // Given a cross aimed at a striker, then the ball rises in flight and comes
  // down where the striker meets it.
  it("arcs a cross onto the man it is aimed at", () => {
    const events = [radarEvent("Cross", "Home", "AwayDefense", "h_rm", "h_st1")];
    const [beat] = choreographBatch(events, stage, start).beats;
    expect(beat.steps.some((step) => (step.ball?.lift ?? 0) > 0)).toBe(true);
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
      applyStep(elsewhere, choreographBatch([event], stage, start).beats[0].steps[0], 0);
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

  // Given a dribble the engine ends in the box, then the dribbler carries the
  // ball in himself: it never rolls on without him.
  it("carries the ball on with the dribbler when the engine moves it on", () => {
    const events = [radarEvent("Dribble", "Home", "AwayDefense", "h_rm")];
    const { beats } = choreographBatch(events, stage, start, {
      ballZone: "AwayBox",
      possession: "Home",
    });
    const settle = beats[beats.length - 1];
    expect(settle.eventType).toBe("Settle");
    const scene = play(beats);
    expect(scene.ball.x).toBeGreaterThanOrEqual(zoneSpan("AwayBox")[0]);
    expect(distance(scene.ball, scene.movers.h_rm)).toBeLessThan(2);
    // Touch by touch, never a long roll with the dribbler chasing after it.
    for (const step of settle.steps) {
      expect(step.pace).toBe("carry");
      const feet = step.movers?.h_rm;
      expect(distance(step.ball?.at ?? scene.ball, feet ?? { x: 0, y: 0 })).toBeLessThan(2);
    }
    expect(settle.steps.length).toBeGreaterThan(1);
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
    beat.steps.slice(0, index).reduce((scene, step) => applyStep(scene, step, 0), start);

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
    scene = applyStep(scene, step, 0);
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
        scene = applyStep(scene, step, 0);
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
    for (const step of beat.steps) scenes.push(applyStep(scenes[scenes.length - 1], step, 0));
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
    const { arrive, ballThere } = arrivals(shot, "h_st2");
    expect(arrive).toBeLessThanOrEqual(ballThere + 1);
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
    const dribbled = play(
      choreographBatch([radarEvent("Dribble", "Home", "AwayDefense", "h_rm")], stage, start).beats,
    );
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
