import type { TFunction } from "i18next";
import type { EventView, MissionView } from "../../../api";
import type { Countdown } from "../../../format";
import { isCounted, isSeasonEnd, rewardText } from "../eventText";
import { eventGroup, isMet, journeyCounts, type MissionPhase, missionPhase } from "../missionState";

/**
 * How a phone folds the coach's events (design m-su-kien.html): which card opens on arrival, the
 * bar of segments that stands for the journey, the missions kept under "Done", and the short
 * countdowns. Every state is still the server's (C-7 C7-7), read through missionState.
 */

/** What a phone folds under "Done" at the foot of an event's card: nothing left to do there. */
const DONE: MissionPhase[] = ["claimed", "lapsed", "missed", "autoClaiming"];

export function isDone(phase: MissionPhase): boolean {
  return DONE.includes(phase);
}

/** A segment of the card's bar: claimed (green), waiting to be claimed (gold), failed, or open. */
export type SegmentTone = "claimed" | "ready" | "open" | "failed";

const SEGMENT_ORDER: Record<SegmentTone, number> = { claimed: 0, ready: 1, open: 2, failed: 3 };

function segmentTone(phase: MissionPhase): SegmentTone {
  if (phase === "claimed") return "claimed";
  if (phase === "ready" || phase === "autoClaiming") return "ready";
  return phase === "missed" || phase === "lapsed" ? "failed" : "open";
}

/** One segment a mission, the claimed first, so the bar fills from the left. */
export function segmentsOf(event: EventView): { code: string; tone: SegmentTone }[] {
  return event.missions
    .map((mission) => ({ code: mission.code, tone: segmentTone(missionPhase(event, mission)) }))
    .sort((a, b) => SEGMENT_ORDER[a.tone] - SEGMENT_ORDER[b.tone]);
}

/**
 * The card open on arrival, among the events still taking claims (in the page's order): the
 * first with a reward waiting, else the running one that ends soonest, else none.
 */
export function firstOpen(events: EventView[]): string | undefined {
  const waiting = events.find((event) => journeyCounts(event).ready > 0);
  return (waiting ?? events.find((event) => eventGroup(event.state) === "running"))?.id;
}

/** A folded card's countdown, to the hour: "4d 09h"; under a day, the clock. */
export function shortCountdown(t: TFunction, left: Countdown): string {
  if (left.days === 0) return left.clock;
  return t("online.events.phone.short", { days: left.days, hours: left.clock.slice(0, 2) });
}

/** An open card's countdown, to the second: "4d 09:35:53". */
export function longCountdown(t: TFunction, left: Countdown): string {
  if (left.days === 0) return left.clock;
  return t("online.events.phone.long", { days: left.days, clock: left.clock });
}

/** A mission's progress in a few words: "1/3", met or not, or how it ended. */
export function progressText(t: TFunction, mission: MissionView, phase: MissionPhase): string {
  if (phase === "claimed") return t("online.events.claimed");
  if (phase === "lapsed") return t("online.events.status.lapsed");
  if (phase === "missed") return t("online.events.status.missed");
  if (phase === "autoClaiming") return t("online.events.autoClaiming");
  if (isSeasonEnd(mission.kind))
    return t(isMet(mission) ? "online.events.met" : "online.events.notMet");
  if (isCounted(mission.kind) && mission.target > 0) {
    return `${Math.min(mission.progress, mission.target)}/${mission.target}`;
  }
  return t(`online.events.status.${phase}`);
}

/** Whether a mission shows a bar of progress: a counted one, still under way or waiting. */
export function showsBar(mission: MissionView, phase: MissionPhase): boolean {
  return isCounted(mission.kind) && mission.target > 0 && !isDone(phase);
}

/** How far a counted mission has come, 0 to 100. */
export function percentOf(mission: MissionView): number {
  if (mission.target <= 0) return 0;
  return (Math.min(mission.progress, mission.target) / mission.target) * 100;
}

/** The first reward in words, and how many more come with it: "Scout ticket +1". */
export function firstRewardText(t: TFunction, language: string, mission: MissionView): string {
  const [first, ...more] = mission.rewards;
  if (!first) return "";
  return `${rewardText(t, language, first)}${more.length > 0 ? ` +${more.length}` : ""}`;
}
