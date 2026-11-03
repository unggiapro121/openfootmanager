import type { SquadPlayerView } from "../../api";
import { matchesFilter, type SquadFilter, type SquadScope, type SquadSort } from "./squadList";

/** The orders a phone offers (design m-doi-hinh): the squad's own columns, best first. */
export const PHONE_SORTS = {
  pos: { key: null, dir: "asc" },
  ovr: { key: "ovr", dir: "desc" },
  condition: { key: "condition", dir: "desc" },
  potential: { key: "potential", dir: "desc" },
  age: { key: "age", dir: "asc" },
  style: { key: "style", dir: "asc" },
} as const satisfies Record<string, SquadSort>;

export type PhoneSortId = keyof typeof PHONE_SORTS;

export const PHONE_SORT_IDS = Object.keys(PHONE_SORTS) as PhoneSortId[];

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
