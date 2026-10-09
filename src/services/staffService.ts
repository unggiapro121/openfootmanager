import { invoke } from "@tauri-apps/api/core";

import type { GameStateData } from "../store/gameStore";
import type { ScoutingAssignment, StaffData, YouthScoutingAssignment } from "../store/types";

export interface StaffSlice {
  team_staff: StaffData[];
  available_staff: StaffData[];
  scouting_assignments: ScoutingAssignment[];
  youth_scouting_assignments: YouthScoutingAssignment[];
}

/** Mirrors `ofm_core::staff_contracts::StaffContractPreview`. Money is weekly. */
export interface StaffContractPreviewData {
  staff_id: string;
  asking_wage: number;
  current_wage: number;
  contract_end: string | null;
  severance_cost: number;
  weekly_wage_bill: number;
  projected_wage_bill: number;
  wage_budget: number;
  within_wage_budget: boolean;
}

export async function getStaff(teamId: string): Promise<StaffSlice> {
  return invoke<StaffSlice>("get_staff", { teamId });
}

export async function hireStaff(staffId: string, contractYears: number): Promise<GameStateData> {
  return invoke<GameStateData>("hire_staff", { staffId, contractYears });
}

export async function releaseStaff(staffId: string): Promise<GameStateData> {
  return invoke<GameStateData>("release_staff", { staffId });
}

export async function renewStaffContract(
  staffId: string,
  contractYears: number,
): Promise<GameStateData> {
  return invoke<GameStateData>("renew_staff_contract", { staffId, contractYears });
}

/** Replace the whole staff market; free, three times a calendar month. */
export async function refreshStaffMarket(): Promise<GameStateData> {
  return invoke<GameStateData>("refresh_staff_market");
}

export async function previewStaffContract(staffId: string): Promise<StaffContractPreviewData> {
  return invoke<StaffContractPreviewData>("preview_staff_contract", { staffId });
}
