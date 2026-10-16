import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  clearContractExitIntent,
  delegateRenewals,
  previewContractTermination,
  previewRenewalFinancialImpact,
  proposeRenewal,
  setContractExitIntent,
  terminateContractNow,
} from "./contractService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("contractService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("marks a contract to expire", async () => {
    const response = { game: { manager: { id: "manager-1" } } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(setContractExitIntent("player-1", "manager_profile_action")).resolves.toBe(
      response,
    );
    expect(mockedInvoke).toHaveBeenCalledWith("set_contract_exit_intent", {
      playerId: "player-1",
      reason: "manager_profile_action",
    });
  });

  it("clears a planned expiry intent", async () => {
    const response = { game: { manager: { id: "manager-1" } } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(clearContractExitIntent("player-1")).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("clear_contract_exit_intent", {
      playerId: "player-1",
    });
  });

  it("previews immediate termination", async () => {
    const response = { preview: { severance_cost: 132000 } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(previewContractTermination("player-1")).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_contract_termination", {
      playerId: "player-1",
    });
  });

  it("terminates a contract immediately", async () => {
    const response = { game: { manager: { id: "manager-1" } } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(terminateContractNow("player-1")).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("terminate_contract_now", {
      playerId: "player-1",
    });
  });

  it("previews a renewal's financial impact at the offered weekly wage", async () => {
    // Given the backend can project the wage bill for an offer
    const response = { projection: { projected_weekly_wage_spend: 120_000 } };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager types a weekly wage of 25,000 for player-1
    const result = await previewRenewalFinancialImpact("player-1", 25_000);

    // Then the projection is requested for that player and wage
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_renewal_financial_impact", {
      playerId: "player-1",
      weeklyWage: 25_000,
    });
  });

  it("proposes a renewal with the offered wage and length", async () => {
    // Given the player answers the offer with a counter
    const response = { outcome: "counter_offer", suggested_wage: 30_000, suggested_years: 2 };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager offers 25,000 a week for three years
    const result = await proposeRenewal("player-1", 25_000, 3);

    // Then the offer reaches the backend as typed and the answer comes back as is
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("propose_renewal", {
      playerId: "player-1",
      weeklyWage: 25_000,
      contractYears: 3,
    });
  });

  it("passes a refused renewal offer's error key through", async () => {
    // Given the backend refuses the offer because talks have broken down
    mockedInvoke.mockRejectedValueOnce("be.error.contracts.renewalBlocked");

    // When the manager proposes a renewal
    // Then the refusal key reaches the caller untouched
    await expect(proposeRenewal("player-1", 25_000, 3)).rejects.toBe(
      "be.error.contracts.renewalBlocked",
    );
  });

  it("delegates renewals to the assistant within the given limits", async () => {
    // Given the assistant manager renews one of two players
    const response = {
      game: { manager: { id: "manager-1" } },
      report: { success_count: 1, failure_count: 0, stalled_count: 1, cases: [] },
    };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager delegates both renewals with a 35% raise cap and three years at most
    const result = await delegateRenewals(["player-1", "player-2"], {
      maxWageIncreasePct: 35,
      maxContractYears: 3,
    });

    // Then the backend gets the players and the limits as flat arguments
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("delegate_renewals", {
      playerIds: ["player-1", "player-2"],
      maxWageIncreasePct: 35,
      maxContractYears: 3,
    });
  });
});
