import type { MatchEvent } from "../types";

/**
 * What the 2D radar acts out of a minute: only the dangerous play — an attack
 * that ends in an attempt on goal, from where the side won the ball to the
 * attempt and the corner it may win — plus a sending-off, marked without being
 * acted out. Everything else in the minute is passed over.
 */

/** Attempts on goal: each makes the move that led to it worth showing. */
const ATTEMPTS = new Set([
  "Goal",
  "ShotSaved",
  "ShotOffTarget",
  "ShotBlocked",
  "ShotOnTarget",
  "PenaltyGoal",
  "PenaltyMiss",
]);
/** Play that builds an attack, by the attacking side. */
const BUILD_UP = new Set([
  "PassCompleted",
  "Dribble",
  "Cross",
  "Corner",
  "FreeKick",
  "PenaltyAwarded",
]);
/** Where an attack starts: the side winning the ball. */
const BALL_WON = new Set(["Tackle", "Interception"]);
/** A foul by the defending side, which gives the attack its free kick or penalty. */
const FOUL = "Foul";
const SENDING_OFF = new Set(["RedCard", "SecondYellow"]);

/** Whether `event` is the attacking side playing the ball: a move can open with it. */
export function isAttackingPlay(event: MatchEvent): boolean {
  return (
    ATTEMPTS.has(event.event_type) ||
    BUILD_UP.has(event.event_type) ||
    BALL_WON.has(event.event_type)
  );
}

/** The indexes of the move that led to the attempt at `shot`, the attempt included. */
function moveTo(events: MatchEvent[], shot: number): number[] {
  const side = events[shot].side;
  const move = [shot];
  for (let index = shot - 1; index >= 0; index--) {
    const event = events[index];
    if (event.side === side && BUILD_UP.has(event.event_type)) {
      move.push(index);
      continue;
    }
    if (event.side !== side && event.event_type === FOUL) {
      move.push(index);
      continue;
    }
    if (event.side === side && BALL_WON.has(event.event_type)) move.push(index);
    break;
  }
  return move;
}

/** The events of a minute worth acting out on the radar, in order. */
export function highlightsOf(events: MatchEvent[]): MatchEvent[] {
  const kept = new Set<number>();
  events.forEach((event, index) => {
    if (SENDING_OFF.has(event.event_type)) kept.add(index);
    if (!ATTEMPTS.has(event.event_type)) return;
    for (const part of moveTo(events, index)) kept.add(part);
    // The corner a shot wins plays on from it.
    const next = events[index + 1];
    if (next?.event_type === "Corner" && next.side === event.side) kept.add(index + 1);
  });
  return events.filter((_, index) => kept.has(index));
}
