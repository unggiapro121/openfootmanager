import type { TrainingGroupData } from "../../store/types";
import type { TrainingRosterPlayer } from "../../components/training/trainingGroupsModel";
import type { FocusFitView, SquadPlayerView } from "../api";
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

/** How each player's focus suits him (S-31b), by id: only the players the server gives one. */
export function focusFitsOf(players: SquadPlayerView[]): Record<string, FocusFitView> {
  return Object.fromEntries(
    players.flatMap((player) => (player.focusFit ? [[player.id, player.focusFit]] : [])),
  );
}

/**
 * The plan's groups with only the squad's players in them. A player sold or released stays in the
 * saved plan, and the server refuses a plan naming a player not in the squad (`notInSquad`), so
 * every plan the client shows or sends is first kept to the squad.
 */
export function inSquad(groups: TrainingGroup[], squad: SquadPlayerView[]): TrainingGroup[] {
  const ids = new Set(squad.map((player) => player.id));
  return groups.map((group) => ({
    ...group,
    player_ids: group.player_ids.filter((id) => ids.has(id)),
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
