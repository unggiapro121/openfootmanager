import type { SquadPlayerView } from "../../api";
import {
  matchesFilter,
  type SquadFilter,
  type SquadScope,
  type SquadSort,
  type SquadSortKey,
} from "./squadList";

/** The phone list's own order: by line, the eleven apart from the bench. */
export const PHONE_DEFAULT_SORT: SquadSort = { key: "pos", dir: "asc" };

/** Columns whose best comes first in rising order: the line, the name, the number, a fit rank. */
const BEST_RISING: readonly SquadSortKey[] = ["pos", "name", "jersey", "fit", "style"];

/**
 * The order after a column heading is tapped, as the desktop table does: the same column again
 * turns it round, another column starts best first.
 */
export function nextSort(current: SquadSort, key: SquadSortKey): SquadSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: BEST_RISING.includes(key) ? "asc" : "desc" };
}

/** Whether the list is in its own order, so the eleven and the bench show apart. */
export function inOwnOrder(sort: SquadSort): boolean {
  return sort.key === PHONE_DEFAULT_SORT.key && sort.dir === PHONE_DEFAULT_SORT.dir;
}

const SCOPES: SquadScope[] = ["all", "xi", "bench", "injured"];

/** How many players each status tab holds, under the line and the name chosen. */
export function scopeCounts(
  players: readonly SquadPlayerView[],
  filter: SquadFilter,
  eleven: ReadonlySet<string>,
): Record<SquadScope, number> {
  const count = (scope: SquadScope) =>
    players.filter((player) => matchesFilter(player, { ...filter, scope }, eleven)).length;
  return Object.fromEntries(SCOPES.map((scope) => [scope, count(scope)])) as Record<
    SquadScope,
    number
  >;
}

/** A part of the list under its own heading; `all` has none. */
export interface PhoneSection {
  id: "xi" | "bench" | "all";
  players: SquadPlayerView[];
}

/**
 * The list in parts: the eleven, then the bench, when the whole squad is shown in its own order;
 * one part otherwise, as sorted or filtered. An empty part is left out.
 */
export function phoneSections(
  players: SquadPlayerView[],
  eleven: ReadonlySet<string>,
  grouped: boolean,
): PhoneSection[] {
  if (!grouped) return players.length > 0 ? [{ id: "all", players }] : [];
  const parts: PhoneSection[] = [
    { id: "xi", players: players.filter((player) => eleven.has(player.id)) },
    { id: "bench", players: players.filter((player) => !eleven.has(player.id)) },
  ];
  return parts.filter((part) => part.players.length > 0);
}
