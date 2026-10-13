import { describe, expect, it } from "vitest";

import type { ContractSource, PlayerData, PlayerMovementEntry } from "../store/types";
import { getPlayerContractRiskLevel } from "./contractUtils";

function signed(source: ContractSource, start: string, end: string): PlayerMovementEntry {
  return {
    date: start,
    kind: source === "initial" ? "initial_contract" : "renewal",
    contract: { start, end, weekly_wage: 248_000, source },
  };
}

function playerWith(movementHistory: PlayerMovementEntry[]): PlayerData {
  const latest = movementHistory[movementHistory.length - 1]?.contract;
  return {
    contract_start: latest?.start ?? null,
    contract_end: latest?.end ?? null,
    movement_history: movementHistory,
  } as PlayerData;
}

describe("getPlayerContractRiskLevel", () => {
  // Given a one-year renewal signed today, then it is not flagged: the deal was
  // just done, though it has under a year left.
  it("treats a contract renewed in the last six months as stable", () => {
    const player = playerWith([signed("renewal", "2026-08-31", "2027-08-31")]);

    expect(getPlayerContractRiskLevel(player, "2026-08-31")).toBe("stable");
  });

  // Given that renewal seven months on, then it is at risk like any other.
  it("flags the renewal again once it is no longer fresh", () => {
    const player = playerWith([signed("renewal", "2026-08-31", "2027-08-31")]);

    expect(getPlayerContractRiskLevel(player, "2027-04-01")).toBe("critical");
  });

  // Given the contract a career opened with, ending within a year, then it is
  // at risk from the start: no one at the club agreed it.
  it("flags an opening contract in its final year at once", () => {
    const player = playerWith([signed("initial", "2026-06-01", "2027-06-30")]);

    expect(getPlayerContractRiskLevel(player, "2026-07-15")).toBe("warning");
  });

  // Given a player released after his last contract, then that contract is
  // not his any more and no exception applies.
  it("ignores a contract a release has ended", () => {
    const player = {
      ...playerWith([signed("renewal", "2026-08-31", "2027-08-31")]),
      movement_history: [
        signed("renewal", "2026-08-31", "2027-08-31"),
        { date: "2026-09-01", kind: "released" } as PlayerMovementEntry,
      ],
    } as PlayerData;

    expect(getPlayerContractRiskLevel(player, "2026-09-02")).toBe("warning");
  });
});
