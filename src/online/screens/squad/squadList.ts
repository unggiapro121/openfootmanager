import { positionGroupRank } from "../../../lib/positions";
import type { SquadPlayerView } from "../../api";

/**
 * What the squad list can be filtered and sorted by (C-2 §3.4, as the offline roster does): a
 * line, whether he is in the first eleven, hurt, and a name typed.
 */
export type SquadScope = "all" | "xi" | "bench" | "injured";
export type SquadGroup = "All" | "Goalkeeper" | "Defender" | "Midfielder" | "Forward";

export interface SquadFilter {
  search: string;
  group: SquadGroup;
  scope: SquadScope;
}

export const NO_FILTER: SquadFilter = { search: "", group: "All", scope: "all" };

export type SquadSortKey =
  | "jersey"
  | "name"
  | "pos"
  | "fit"
  | "style"
  | "potential"
  | "age"
  | "condition"
  | "morale"
  | "ovr"
  | "apps"
  | "goals";

export interface SquadSort {
  key: SquadSortKey | null;
  dir: "asc" | "desc";
}

/** The squad as the coach reads it by default: by line, then strongest first. */
export function byLine<P extends Pick<SquadPlayerView, "position" | "ovr" | "fullName">>(
  players: P[],
): P[] {
  return [...players].sort(
    (left, right) =>
      positionGroupRank(left.position) - positionGroupRank(right.position) ||
      right.ovr - left.ovr ||
      left.fullName.localeCompare(right.fullName),
  );
}

/** Whether `player` shows under `filter`, `eleven` the ids of the first eleven. */
export function matchesFilter(
  player: SquadPlayerView,
  filter: SquadFilter,
  eleven: ReadonlySet<string>,
): boolean {
  const search = filter.search.trim().toLocaleLowerCase();
  if (
    search !== "" &&
    !`${player.fullName} ${player.matchName}`.toLocaleLowerCase().includes(search)
  ) {
    return false;
  }
  if (filter.group !== "All" && player.position !== filter.group) return false;
  switch (filter.scope) {
    case "xi":
      return eleven.has(player.id);
    case "bench":
      return !eleven.has(player.id);
    case "injured":
      return player.injury !== undefined;
    default:
      return true;
  }
}

/** Ranks of the two fit columns, which only the club's formation and style can give. */
export type FitRanks = Record<"fit" | "style", (player: SquadPlayerView) => number>;

const VALUE_OF: Record<
  Exclude<SquadSortKey, "fit" | "style">,
  (player: SquadPlayerView) => number | string
> = {
  jersey: (player) => player.shirtNumber ?? Number.MAX_SAFE_INTEGER,
  name: (player) => player.matchName.toLocaleLowerCase(),
  pos: (player) => positionGroupRank(player.position),
  potential: (player) => player.potentialStars,
  age: (player) => player.age,
  condition: (player) => player.condition,
  morale: (player) => player.morale,
  ovr: (player) => player.ovr,
  apps: (player) => player.season.appearances,
  goals: (player) => player.season.goals,
};

/** `players` in the order of `sort`; the by-line order when no column is chosen. */
export function sortedBy(
  players: SquadPlayerView[],
  sort: SquadSort,
  fits?: FitRanks,
): SquadPlayerView[] {
  const ordered = byLine(players);
  const { key, dir } = sort;
  if (key === null) return ordered;
  const value = key === "fit" || key === "style" ? (fits?.[key] ?? (() => 0)) : VALUE_OF[key];
  const sign = dir === "asc" ? 1 : -1;
  return ordered.sort((left, right) => {
    const a = value(left);
    const b = value(right);
    const order = typeof a === "string" ? a.localeCompare(String(b)) : a - Number(b);
    return order * sign;
  });
}
