import { invoke } from "./transport";

import type { NegotiationFeedbackPanelData } from "../components/NegotiationFeedbackPanel";
import type { GameStateData } from "../store/gameStore";

export interface FreeAgentContractProjection {
  current_annual_wage_bill: number;
  projected_annual_wage_bill: number;
  annual_wage_budget: number;
  annual_soft_cap: number;
  current_weekly_wage_spend: number;
  projected_weekly_wage_spend: number;
  current_cash_runway_weeks: number | null;
  projected_cash_runway_weeks: number | null;
  currently_over_budget: boolean;
  policy_allows: boolean;
}

export interface FreeAgentContractResponseData {
  /** `awaiting_reply`: the offer was sent and the player answers by mail on `reply_on`. */
  outcome: "accepted" | "rejected" | "counter_offer" | "awaiting_reply";
  reply_on?: string | null;
  game: GameStateData;
  suggested_wage: number | null;
  suggested_years: number | null;
  session_status: "idle" | "open" | "agreed" | "blocked" | "stalled";
  is_terminal: boolean;
  cooled_off?: boolean;
  feedback?: NegotiationFeedbackPanelData | null;
}

export interface FreeAgentContractProjectionResponseData {
  projection: FreeAgentContractProjection;
}

export async function offerFreeAgentContract(
  playerId: string,
  weeklyWage: number,
  contractYears: number,
): Promise<FreeAgentContractResponseData> {
  return invoke<FreeAgentContractResponseData>("offer_free_agent_contract", {
    playerId,
    weeklyWage,
    contractYears,
  });
}

export async function previewFreeAgentContractImpact(
  playerId: string,
  weeklyWage: number,
): Promise<FreeAgentContractProjectionResponseData> {
  return invoke<FreeAgentContractProjectionResponseData>("preview_free_agent_contract_impact", {
    playerId,
    weeklyWage,
  });
}
