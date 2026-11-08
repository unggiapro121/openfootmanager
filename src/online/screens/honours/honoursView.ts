import type { TrophyView } from "../../api";

/** A trophy's metal by its level (Qtr-2): the higher the level, the rarer the metal. */
export type TrophyTone = "bronze" | "silver" | "gold" | "platinum";

export function trophyTone(level: number): TrophyTone {
  if (level >= 15) return "platinum";
  if (level >= 10) return "gold";
  if (level >= 5) return "silver";
  return "bronze";
}

/** One place on the shelf: a kind of trophy at one level, won `count` times. */
export interface ShelfRow {
  kind: string;
  level: number;
  count: number;
  /** The seasons it was won, newest first. */
  seasons: number[];
  /** Who won it each time, in the same order: a coach's name, or none for the AI. */
  coaches: Array<{ name: string; mine: boolean } | undefined>;
}

const KIND_ORDER = ["leagueTitle", "promotion"];

/**
 * The trophy cabinet (C20-2): titles first, then promotions, each by level from the highest, each
 * level once with how many times and when. `mineOnly` keeps those won under the coach reading.
 */
export function cabinet(trophies: TrophyView[], mineOnly: boolean): ShelfRow[] {
  const rows = new Map<string, ShelfRow>();
  const kept = trophies
    .filter((trophy) => !mineOnly || trophy.coach?.mine === true)
    .sort((left, right) => right.place.seasonNumber - left.place.seasonNumber);
  for (const trophy of kept) {
    const key = `${trophy.kind}:${trophy.place.level}`;
    const row = rows.get(key) ?? {
      kind: trophy.kind,
      level: trophy.place.level,
      count: 0,
      seasons: [],
      coaches: [],
    };
    row.count += 1;
    row.seasons.push(trophy.place.seasonNumber);
    row.coaches.push(trophy.coach);
    rows.set(key, row);
  }
  const rank = (kind: string) => {
    const index = KIND_ORDER.indexOf(kind);
    return index < 0 ? KIND_ORDER.length : index;
  };
  return [...rows.values()].sort(
    (left, right) => rank(left.kind) - rank(right.kind) || right.level - left.level,
  );
}

/** The newest league title among `trophies`, for the trophy-lift screen (C20-8). */
export function latestTitle(trophies: TrophyView[]): TrophyView | undefined {
  return trophies
    .filter((trophy) => trophy.kind === "leagueTitle")
    .reduce<TrophyView | undefined>(
      (best, trophy) =>
        best === undefined || trophy.place.seasonNumber > best.place.seasonNumber ? trophy : best,
      undefined,
    );
}
