import { distance } from "./radarGeometry";
import type { RadarScene, RadarStep } from "./radarScene";
import type { RadarSim } from "./radarSim";
import { type RadarStage, scenePositions } from "./radarStage";

/**
 * A change of scene on the radar. The radar acts out only the dangerous play,
 * so between two moves the ball can be put down far away (a minute with
 * nothing in it, or a move started by a man away from the ball). The ball
 * goes and comes back in a moment; the players, run against a top speed, would
 * need ten seconds to cross the pitch after it, and the next pass would reach
 * an empty spot. So when they are still far from their places, they fade, are
 * put there, and stand a moment for the eye to take in the new picture —
 * as a broadcast cuts between highlights. Play within a move stays continuous.
 */

/** How long the players take to fade, in simulation seconds. */
export const CUT_FADE_S = 0.2;
/** How long they stand in their new places, fading back in, before play goes on. */
export const CUT_HOLD_S = 0.3;
/** How faint they get at the bottom of the fade. */
const CUT_DIM = 0.2;
/** The block is far from its places when its players are this far away on average, in metres. */
const CUT_MEAN_LAG_M = 12;
/**
 * The man the ball comes back to (or who goes for it) is far from his place
 * beyond this: the distance a man still fetches a loose ball himself
 * (`FETCH_METRES`).
 */
const CUT_KEY_LAG_M = 15;

/** A cut under way: when it began, and whether the players have been put in place yet. */
export interface SceneCut {
  since: number;
  placed: boolean;
}

/** The man the ball comes back to, or who goes for it, in a step that puts it down. */
function keyManOf(step: RadarStep): string | null {
  const action = step.action;
  if (action?.kind !== "dead") return null;
  return action.holder ?? action.chaser ?? null;
}

/** Whether the players in `sim` are far enough from their places in `scene` for `step` to cut. */
export function isFarFromPlaces(
  sim: RadarSim,
  stage: RadarStage,
  scene: RadarScene,
  step: RadarStep,
): boolean {
  const places = scenePositions(stage, scene);
  let total = 0;
  let count = 0;
  for (const [id, place] of places) {
    const at = sim.players[id]?.at;
    if (!at) continue;
    total += distance(at, place);
    count += 1;
  }
  if (count > 0 && total / count > CUT_MEAN_LAG_M) return true;
  const key = keyManOf(step);
  const keyAt = key ? sim.players[key]?.at : undefined;
  const keyPlace = key ? places.get(key) : undefined;
  return !!keyAt && !!keyPlace && distance(keyAt, keyPlace) > CUT_KEY_LAG_M;
}

/** Whether `cut` is still holding play at `time`. */
export function isCutHolding(cut: SceneCut | null, time: number): boolean {
  return !!cut && time - cut.since < CUT_FADE_S + CUT_HOLD_S;
}

/** Whether `cut` has faded out and the players are to be put in place at `time`. */
export function isCutDueToPlace(cut: SceneCut | null, time: number): boolean {
  return !!cut && !cut.placed && time - cut.since >= CUT_FADE_S;
}

/** How visible the players and the ball are at `time`: 1 with no cut, dimmed and back through one. */
export function cutOpacity(cut: SceneCut | null, time: number): number {
  if (!cut) return 1;
  const gone = time - cut.since;
  if (gone < CUT_FADE_S) return 1 - ((1 - CUT_DIM) * gone) / CUT_FADE_S;
  if (gone < CUT_FADE_S + CUT_HOLD_S) {
    return CUT_DIM + ((1 - CUT_DIM) * (gone - CUT_FADE_S)) / CUT_HOLD_S;
  }
  return 1;
}
