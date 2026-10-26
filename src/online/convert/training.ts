import type { TrainingGroupData } from "../../store/types";
import type { TrainingRosterPlayer } from "../../components/training/trainingGroupsModel";
import type { SquadPlayerView } from "../api";
import type { TrainingFocus, TrainingGroup } from "../api/domain";

/** A player of the coach's own club as the groups table reads him. */
export function toTrainingRoster(players: SquadPlayerView[]): TrainingRosterPlayer[] {
  return players.map((player) => ({
    id: player.id,
    match_name: player.matchName,
    jersey_number: player.shirtNumber ?? null,
    position: player.position,
    natural_position: player.naturalPosition,
    condition: player.condition,
    training_focus: player.trainingFocus ?? null,
  }));
}

/** The plan's groups as the groups card reads them. */
export function toGroupData(groups: TrainingGroup[]): TrainingGroupData[] {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    focus: group.focus,
    player_ids: group.player_ids,
  }));
}

/**
 * The card's groups as the plan holds them. A session the game does not know cannot come from the
 * card, which offers only the game's own; it is refused here so `tsc` and a test notice if the two
 * lists ever differ.
 */
export function toPlanGroups(
  groups: TrainingGroupData[],
  focusIds: readonly string[],
): TrainingGroup[] {
  return groups.map((group) => {
    if (!focusIds.includes(group.focus)) throw new Error(`unknown training focus ${group.focus}`);
    return {
      id: group.id,
      name: group.name,
      focus: group.focus as TrainingFocus,
      player_ids: group.player_ids,
    };
  });
}
