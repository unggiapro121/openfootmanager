import {
  buildActivePositionMap,
  buildPitchRows,
  buildPitchSlotRows,
  getBestRoleForFormation,
  getCurrentPosition,
  getPlayStyleFit,
  getSquadTacticalFit,
  isPlayerOutOfPosition,
  type SquadStyleFit,
  type SquadTacticalFit,
} from "../../../components/squad/SquadTab.helpers";
import { getKeeperFitBreakdown } from "../../../components/squad/keeperStyleFit";
import type { MyClubView } from "../../api";
import { toRosterPlayer } from "../../convert/tactics";

/** How one player suits the club's formation and play style, as the offline roster rates it. */
export interface PlayerFit {
  /** Whether he is in the first eleven (the formation fit only means something there). */
  starter: boolean;
  /** The slot he stands in; his natural position off the pitch. */
  slot: string;
  tactical: SquadTacticalFit;
  /** The position his formation suits him best at, for a player off the pitch. */
  bestRole: string;
  style: SquadStyleFit;
  /** A keeper's two halves of the style fit, for the tooltip; null outfield. */
  keeper: { save: string; lean: string } | null;
  outOfPosition: boolean;
}

const TACTICAL_RANK: Record<SquadTacticalFit, number> = { natural: 0, adapted: 1, out: 2 };
const STYLE_RANK: Record<SquadStyleFit, number> = { strong: 0, good: 1, risky: 2 };

/**
 * The fit of every player of `club` to its saved formation and play style, by the offline roster's
 * own rules (`SquadTab.helpers`): each starter's slot comes from the formation and the order of
 * the eleven, which is how the server reads it too.
 */
export function squadFits(club: MyClubView): Map<string, PlayerFit> {
  const { formation, playStyle, startingXiIds } = club.setup;
  const lineup = new Map(
    club.players.map((player) => [player.id, toRosterPlayer(player, club.club.id)]),
  );
  const slots = buildActivePositionMap(
    buildPitchSlotRows(buildPitchRows(formation), startingXiIds, lineup),
  );
  const eleven = new Set(startingXiIds);
  const fits = new Map<string, PlayerFit>();
  for (const [id, player] of lineup) {
    const slot = getCurrentPosition(player, slots);
    fits.set(id, {
      starter: eleven.has(id),
      slot,
      tactical: getSquadTacticalFit(player, slot),
      bestRole: getBestRoleForFormation(player, formation),
      style: getPlayStyleFit(player, playStyle, slot),
      keeper: getKeeperFitBreakdown(player, playStyle, slot),
      outOfPosition: eleven.has(id) && isPlayerOutOfPosition(player, slot),
    });
  }
  return fits;
}

/** The order of a column that rates fit: a better fit first, players off the pitch before all. */
export function fitRank(fit: PlayerFit | undefined, column: "fit" | "style"): number {
  if (!fit) return -1;
  if (column === "style") return STYLE_RANK[fit.style];
  return fit.starter ? TACTICAL_RANK[fit.tactical] : -1;
}
