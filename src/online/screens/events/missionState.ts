import type { EventView, MissionView } from "../../api";
import { isCounted } from "./eventText";

/**
 * Where a mission stands for the page (design su-kien.html), read from its status and its
 * event's state; every rule is the server's (C-7 C7-7), this only says which card it shows.
 */

/** The page's groups of events; a state this build does not know is `closed`. */
export type EventGroup = "running" | "ended" | "scheduled" | "closed";

export function eventGroup(state: string): EventGroup {
  return state === "running" || state === "ended" || state === "scheduled" ? state : "closed";
}

const at = (iso: string): number => Date.parse(iso) || 0;

/** A group's events in the page's order: what ends or starts soonest first; the closed ones, the latest first. */
export function eventsOf(group: EventGroup, events: EventView[]): EventView[] {
  const inGroup = events.filter((event) => eventGroup(event.state) === group);
  if (group === "running") return inGroup.sort((a, b) => at(a.endsAt) - at(b.endsAt));
  if (group === "ended") return inGroup.sort((a, b) => at(a.claimUntil) - at(b.claimUntil));
  if (group === "scheduled") return inGroup.sort((a, b) => at(a.startsAt) - at(b.startsAt));
  return inGroup.sort((a, b) => at(b.claimUntil) - at(a.claimUntil));
}

export type MissionPhase =
  /** Finished, its claim waiting. */
  | "ready"
  /** Under way while the event runs. */
  | "active"
  /** Its event has not started. */
  | "upcoming"
  /** Its event ended before it was finished. */
  | "missed"
  /** Finished after the claims closed: the server claims it for the coach (C-7 C7-53). */
  | "autoClaiming"
  | "claimed"
  | "lapsed";

export function missionPhase(event: EventView, mission: MissionView): MissionPhase {
  if (mission.status === "claimed") return "claimed";
  if (mission.status === "lapsed") return "lapsed";
  const group = eventGroup(event.state);
  if (mission.status === "completed") {
    if (group === "running" || group === "ended") return "ready";
    return group === "closed" ? "autoClaiming" : "upcoming";
  }
  if (group === "scheduled") return "upcoming";
  return group === "running" ? "active" : "missed";
}

/** A mission is met once finished, whether its reward was given or not. */
export function isMet(mission: MissionView): boolean {
  return ["completed", "claimed", "lapsed"].includes(mission.status);
}

const ORDER: Record<MissionPhase, number> = {
  ready: 0,
  active: 1,
  upcoming: 1,
  autoClaiming: 2,
  claimed: 3,
  lapsed: 3,
  missed: 3,
};

/** The event's missions as the page lists them: the claims waiting first, the finished last. */
export function missionsInOrder(event: EventView): MissionView[] {
  // Array sort is stable: within a phase the server's order stays.
  return [...event.missions].sort(
    (a, b) => ORDER[missionPhase(event, a)] - ORDER[missionPhase(event, b)],
  );
}

export interface JourneyCounts {
  met: number;
  claimed: number;
  ready: number;
  total: number;
}

export function journeyCounts(event: EventView): JourneyCounts {
  const phases = event.missions.map((mission) => missionPhase(event, mission));
  return {
    met: event.missions.filter(isMet).length,
    claimed: phases.filter((phase) => phase === "claimed").length,
    ready: phases.filter((phase) => phase === "ready").length,
    total: event.missions.length,
  };
}

/** What is left of a counted mission; none for the others, whose target is not a count. */
export function missionLeft(mission: MissionView): number | undefined {
  if (!isCounted(mission.kind) || mission.target <= 0) return undefined;
  return Math.max(0, mission.target - mission.progress);
}
