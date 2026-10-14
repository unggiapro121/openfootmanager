import { getPlayerOvr } from "../../lib/playerOvr";
import type { GameStateData, PlayerData } from "../../store/gameStore";
import { canonicalPosition, normalisePosition } from "../squad/SquadTab.helpers";

export type TransferTabView = "my_list" | "players" | "offers";

export type TransferAvailabilityFilter = "all" | "transfer" | "loan" | "free_agent";

export type MarketSortColumn = "ovr" | "value" | "age";

/** Which column orders the market, and which way; `none` keeps the list's own order. */
export interface MarketSort {
  column: MarketSortColumn;
  dir: "none" | "desc" | "asc";
}

/**
 * The sort after a click on `column`'s header: the same column cycles
 * descending → ascending → off; another column takes over, descending first.
 */
export function nextMarketSort(current: MarketSort, column: MarketSortColumn): MarketSort {
  if (current.column !== column || current.dir === "none") return { column, dir: "desc" };
  return { column, dir: current.dir === "desc" ? "asc" : "none" };
}

/** Age compared by birth date: an earlier birth is the older player. */
const SORT_KEYS: Record<MarketSortColumn, (left: PlayerData, right: PlayerData) => number> = {
  ovr: (left, right) => getPlayerOvr(left) - getPlayerOvr(right),
  value: (left, right) => left.market_value - right.market_value,
  age: (left, right) => right.date_of_birth.localeCompare(left.date_of_birth),
};

export function sortMarketPlayers(players: PlayerData[], sort: MarketSort): PlayerData[] {
  if (sort.dir === "none") return players;
  // Direction encoded in the comparator (rather than sort().reverse()) so tied
  // players keep the same relative order in both directions.
  const factor = sort.dir === "desc" ? -1 : 1;
  const compare = SORT_KEYS[sort.column];
  return [...players].sort((left, right) => factor * compare(left, right));
}

export interface TransferCollections {
  myTransferList: PlayerData[];
  myLoanList: PlayerData[];
  marketPlayers: PlayerData[];
  freeAgentPlayers: PlayerData[];
  loanPlayers: PlayerData[];
  availablePlayers: PlayerData[];
  playersWithOffers: PlayerData[];
}

export function uniquePlayersById(players: PlayerData[]): PlayerData[] {
  const seenPlayerIds = new Set<string>();

  return players.filter((player) => {
    if (seenPlayerIds.has(player.id)) {
      return false;
    }

    seenPlayerIds.add(player.id);
    return true;
  });
}

export function getMyListedPlayers(collections: TransferCollections): PlayerData[] {
  return uniquePlayersById([...collections.myTransferList, ...collections.myLoanList]);
}

/**
 * True when a player is committed to a move that is agreed and only awaiting
 * registration (a `PendingRegistration` transfer or loan offer). Such a player
 * is off the market — no club, including the one that agreed the deal, can open
 * a new bid — so they are hidden from the approachable lists and the bid flow
 * refuses further offers.
 */
export function playerHasPendingRegistration(player: PlayerData): boolean {
  return (
    (player.transfer_offers ?? []).some((offer) => offer.status === "PendingRegistration") ||
    (player.loan_offers ?? []).some((offer) => offer.status === "PendingRegistration")
  );
}

export function deriveTransferCollections(
  gameState: GameStateData,
  userTeamId: string | null,
): TransferCollections {
  const myTransferList = gameState.players.filter(
    (player) => player.team_id === userTeamId && player.transfer_listed && !player.active_loan,
  );
  const myLoanList = gameState.players.filter(
    (player) => player.team_id === userTeamId && player.loan_listed && !player.active_loan,
  );
  const marketPlayers = gameState.players.filter(
    (player) =>
      player.transfer_listed &&
      player.team_id !== userTeamId &&
      !player.active_loan &&
      !playerHasPendingRegistration(player),
  );
  const freeAgentPlayers = gameState.players.filter(
    (player) => player.team_id === null && !player.retired,
  );
  const loanPlayers = gameState.players.filter(
    (player) =>
      player.loan_listed &&
      player.team_id !== userTeamId &&
      !player.active_loan &&
      !playerHasPendingRegistration(player),
  );

  return {
    myTransferList,
    myLoanList,
    marketPlayers,
    freeAgentPlayers,
    loanPlayers,
    availablePlayers: uniquePlayersById([...marketPlayers, ...loanPlayers, ...freeAgentPlayers]),
    playersWithOffers: gameState.players.filter(
      (player) =>
        (player.transfer_offers.length > 0 || (player.loan_offers?.length ?? 0) > 0) &&
        (player.team_id === userTeamId ||
          player.transfer_offers.some((offer) => offer.from_team_id === userTeamId) ||
          (player.loan_offers ?? []).some((offer) => offer.from_team_id === userTeamId)),
    ),
  };
}

export function getCurrentTransferList(
  view: TransferTabView,
  collections: TransferCollections,
): PlayerData[] {
  switch (view) {
    case "my_list":
      return getMyListedPlayers(collections);
    case "players":
      return collections.availablePlayers;
    default:
      return collections.playersWithOffers;
  }
}

export interface TransferAffordability {
  transferBudget: number;
  finance: number;
}

// Mirrors ofm_core/src/transfers.rs: a bid `fee` exceeds the buyer's budget
// when it overruns either the transfer budget or the club's cash balance.
export function bidExceedsAffordability(
  fee: number,
  affordability: TransferAffordability,
): boolean {
  return fee > affordability.transferBudget || fee > affordability.finance;
}

export function filterTransferPlayers(
  players: PlayerData[],
  search: string,
  posFilter: string | null,
  availabilityFilter: TransferAvailabilityFilter = "all",
  affordability: TransferAffordability | null = null,
  specificPositions: readonly string[] = [],
): PlayerData[] {
  const specificSet = specificPositions.length > 0 ? new Set(specificPositions) : null;

  return players.filter((player) => {
    if (availabilityFilter === "transfer" && !player.transfer_listed) {
      return false;
    }

    if (availabilityFilter === "loan" && !player.loan_listed) {
      return false;
    }

    if (availabilityFilter === "free_agent" && player.team_id !== null) {
      return false;
    }

    if (
      affordability &&
      player.team_id !== null &&
      player.transfer_listed &&
      bidExceedsAffordability(player.market_value, affordability)
    ) {
      return false;
    }

    const rawPosition = player.natural_position || player.position;

    if (posFilter && normalisePosition(rawPosition) !== posFilter) {
      return false;
    }

    if (specificSet && !specificSet.has(canonicalPosition(rawPosition))) {
      return false;
    }

    if (search.length >= 2) {
      const query = search.toLowerCase();

      if (
        !player.full_name.toLowerCase().includes(query) &&
        !player.nationality.toLowerCase().includes(query)
      ) {
        return false;
      }
    }

    return true;
  });
}
