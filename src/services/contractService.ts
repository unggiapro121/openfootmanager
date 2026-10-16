import { invoke } from "./transport";

import type {
  DelegatedRenewalResponseData,
  RenewalProjectionData,
  RenewalResponseData,
} from "../components/playerProfile/PlayerProfile.renewal";
import type { GameStateData } from "../store/gameStore";

export type SquadSafetyIssue =
  | "too_few_healthy_players"
  | "no_healthy_goalkeeper"
  | "incomplete_formation";

export interface SquadSafetyReportData {
  team_id: string;
  projected_roster_size: number;
  healthy_players: number;
  healthy_goalkeepers: number;
  effective_xi_size: number;
  can_field_matchday_squad: boolean;
  missing_reasons: SquadSafetyIssue[];
}

export interface ContractTerminationPreviewData {
  player_id: string;
  player_name: string;
  severance_cost: number;
  squad_safety: SquadSafetyReportData;
}

export interface ContractExitIntentResponseData {
  game: GameStateData;
}

export interface ContractTerminationPreviewResponseData {
  preview: ContractTerminationPreviewData;
}

export interface ContractTerminationResponseData {
  game: GameStateData;
  severance_cost: number;
  squad_safety: SquadSafetyReportData;
}

export async function setContractExitIntent(
  playerId: string,
  reason?: string,
): Promise<ContractExitIntentResponseData> {
  return invoke<ContractExitIntentResponseData>("set_contract_exit_intent", {
    playerId,
    reason: reason ?? null,
  });
}

export async function clearContractExitIntent(
  playerId: string,
): Promise<ContractExitIntentResponseData> {
  return invoke<ContractExitIntentResponseData>("clear_contract_exit_intent", {
    playerId,
  });
}

export async function previewContractTermination(
  playerId: string,
): Promise<ContractTerminationPreviewResponseData> {
  return invoke<ContractTerminationPreviewResponseData>("preview_contract_termination", {
    playerId,
  });
}

export async function terminateContractNow(
  playerId: string,
): Promise<ContractTerminationResponseData> {
  return invoke<ContractTerminationResponseData>("terminate_contract_now", {
    playerId,
  });
}

/**
 * What the club's wage bill and cash runway would look like if the player
 * signed on at `weeklyWage`, before any offer is made.
 */
export async function previewRenewalFinancialImpact(
  playerId: string,
  weeklyWage: number,
): Promise<RenewalProjectionData> {
  return invoke<RenewalProjectionData>("preview_renewal_financial_impact", {
    playerId,
    weeklyWage,
  });
}

/** Offer the player a new contract; he accepts, rejects or counters. */
export async function proposeRenewal(
  playerId: string,
  weeklyWage: number,
  contractYears: number,
): Promise<RenewalResponseData> {
  return invoke<RenewalResponseData>("propose_renewal", {
    playerId,
    weeklyWage,
    contractYears,
  });
}

/** The ceiling the assistant manager may agree to when renewing on the manager's behalf. */
export interface DelegatedRenewalLimits {
  maxWageIncreasePct: number;
  maxContractYears: number;
}

/**
 * Hand the renewal talks for `playerIds` to the assistant manager, who
 * negotiates within `limits` and reports each player's outcome.
 */
export async function delegateRenewals(
  playerIds: string[],
  limits: DelegatedRenewalLimits,
): Promise<DelegatedRenewalResponseData> {
  return invoke<DelegatedRenewalResponseData>("delegate_renewals", {
    playerIds,
    maxWageIncreasePct: limits.maxWageIncreasePct,
    maxContractYears: limits.maxContractYears,
  });
}
