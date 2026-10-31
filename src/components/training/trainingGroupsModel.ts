import { positionGroupRank } from "../../lib/positions";
import type { TrainingGroupData } from "../../store/types";

/** What the groups table shows of a player: the offline `PlayerData` and an online squad line both fit. */
export interface TrainingRosterPlayer {
  id: string;
  match_name: string;
  jersey_number?: number | null;
  position: string;
  natural_position?: string | null;
  condition: number;
  /** The session he trains alone, if his coach set one. */
  training_focus?: string | null;
}

/** The most groups a club keeps. */
export const MAX_GROUPS = 5;

/** A new, empty group training the physical focus; `name` is the game's default for its place. */
export function newTrainingGroup(name: string): TrainingGroupData {
  return { id: `grp_${Date.now()}`, name, focus: "Physical", player_ids: [] };
}

export function buildPlayerGroupMap(groups: TrainingGroupData[]) {
  const playerGroupMap = new Map<string, TrainingGroupData>();

  for (const group of groups) {
    for (const playerId of group.player_ids) {
      playerGroupMap.set(playerId, group);
    }
  }

  return playerGroupMap;
}

export function reassignPlayerTrainingGroup(
  groups: TrainingGroupData[],
  playerId: string,
  groupId: string,
): TrainingGroupData[] {
  let nextGroups = groups.map((group) => ({
    ...group,
    player_ids: group.player_ids.filter((id) => id !== playerId),
  }));

  if (groupId) {
    nextGroups = nextGroups.map((group) =>
      group.id === groupId ? { ...group, player_ids: [...group.player_ids, playerId] } : group,
    );
  }

  return nextGroups;
}

export function sortTrainingRoster<T extends TrainingRosterPlayer>(roster: T[]): T[] {
  return [...roster].sort((left, right) => {
    const leftOrder = positionGroupRank(left.natural_position || left.position);
    const rightOrder = positionGroupRank(right.natural_position || right.position);

    return leftOrder - rightOrder || left.match_name.localeCompare(right.match_name);
  });
}
