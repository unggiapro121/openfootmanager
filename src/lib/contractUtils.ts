import type { PlayerData } from "../store/types";
import { CONTRACT_RISK_DAYS } from "./domainConstants";

export type ContractRiskLevel = "critical" | "warning" | "stable";

export function getDaysUntil(targetDate: string, currentDate: string): number {
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil(
    (new Date(targetDate).getTime() - new Date(currentDate).getTime()) / millisecondsPerDay,
  );
}

export function getContractRiskLevel(
  contractEnd: string | null,
  currentDate: string,
): ContractRiskLevel {
  if (!contractEnd) {
    return "stable";
  }

  const daysUntilExpiry = getDaysUntil(contractEnd, currentDate);

  if (daysUntilExpiry <= CONTRACT_RISK_DAYS.critical) {
    return "critical";
  }
  if (daysUntilExpiry <= CONTRACT_RISK_DAYS.warning) {
    return "warning";
  }
  return "stable";
}

export function getContractRiskBadgeVariant(
  level: ContractRiskLevel,
): "accent" | "success" | "danger" {
  if (level === "critical") {
    return "danger";
  }
  if (level === "warning") {
    return "accent";
  }
  return "success";
}

export function getContractYearsRemaining(contractEnd: string | null, currentDate: string): string {
  if (!contractEnd) {
    return "—";
  }

  const daysUntilExpiry = Math.max(0, getDaysUntil(contractEnd, currentDate));
  return (daysUntilExpiry / 365).toFixed(1);
}

/**
 * How long a deal the club has just agreed counts as settled. Mirrors
 * `FRESH_CONTRACT_DAYS` in `ofm_core::contracts::expiry`: a renewal runs from the
 * day it is signed, so a one-year deal starts inside the final-year window.
 */
const FRESH_CONTRACT_DAYS = 180;

/** The contract the ledger has in force: the latest one, unless a release or retirement followed it. */
function currentContract(player: PlayerData) {
  const history = player.movement_history ?? [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.kind === "released" || entry.kind === "retired") return null;
    if (entry.contract) return entry.contract;
  }
  return null;
}

/**
 * A player's contract risk, as `contract_needs_renewal` in the backend decides it:
 * a deal the club agreed in the last six months is settled even in its final
 * year. The contract a career opened with was agreed by no one here, so it is
 * never fresh.
 */
export function getPlayerContractRiskLevel(
  player: PlayerData,
  currentDate: string,
): ContractRiskLevel {
  const contract = currentContract(player);
  const freshlyAgreed =
    contract !== null &&
    contract.source !== "initial" &&
    contract.source !== "legacy_migrated" &&
    !!contract.start &&
    getDaysUntil(currentDate, contract.start) < FRESH_CONTRACT_DAYS;

  return freshlyAgreed ? "stable" : getContractRiskLevel(player.contract_end, currentDate);
}
