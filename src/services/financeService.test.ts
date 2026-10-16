import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  getFacilityUpgradePreview,
  getFinanceSnapshot,
  launchMarketingCampaign,
  rebalanceBudgets,
  requestBoardSupport,
  requestSponsorPitch,
  upgradeFacility,
} from "./financeService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("financeService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("calls the rebalance backend command with the new weekly wage budget", async () => {
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(rebalanceBudgets(80_000)).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("rebalance_budgets", { wageBudget: 80_000 });
  });

  it("maps the rebalance terms from the finance snapshot previews", async () => {
    mockedInvoke.mockResolvedValueOnce({
      snapshot: {},
      previews: {
        budget_rebalance: {
          paydays_left: 10,
          wage_budget: 50_000,
          transfer_budget: 1_000_000,
          min_wage_budget: 20_000,
          max_wage_budget: 150_000,
          step: 1_000,
        },
      },
    });

    const data = await getFinanceSnapshot();

    expect(data.previews.budgetRebalance).toEqual({
      paydaysLeft: 10,
      wageBudget: 50_000,
      transferBudget: 1_000_000,
      minWageBudget: 20_000,
      maxWageBudget: 150_000,
      step: 1_000,
    });
  });

  it("has no rebalance terms when the backend sends none", async () => {
    mockedInvoke.mockResolvedValueOnce({ snapshot: {}, previews: {} });

    const data = await getFinanceSnapshot();

    expect(data.previews.budgetRebalance).toBeNull();
  });

  it("asks the backend for a facility's upgrade preview", async () => {
    const preview = { facility: "Medical", level: 4, maxLevel: 10, cost: 10_000_000, effects: [] };
    mockedInvoke.mockResolvedValueOnce(preview);

    await expect(getFacilityUpgradePreview("Medical")).resolves.toBe(preview);
    expect(mockedInvoke).toHaveBeenCalledWith("get_facility_upgrade_preview", {
      facility: "Medical",
    });
  });

  it("passes a refused upgrade's error key through", async () => {
    mockedInvoke.mockRejectedValueOnce("be.error.finance.facilityUpgradeMaxLevel");

    await expect(upgradeFacility("Scouting")).rejects.toBe(
      "be.error.finance.facilityUpgradeMaxLevel",
    );
    expect(mockedInvoke).toHaveBeenCalledWith("upgrade_facility", { facility: "Scouting" });
  });

  it("asks the board for support without sending any arguments", async () => {
    // Given the board agrees to an emergency cash injection
    const response = {
      game: { manager: { id: "manager-1" } },
      result: {
        support_amount: 5_000_000,
        transfer_budget_reduction: 2_000_000,
        satisfaction_penalty: 5,
      },
    };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager asks for board support
    const result = await requestBoardSupport();

    // Then the backend command is called with no argument object and its answer comes back as is
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("request_board_support");
    expect(mockedInvoke.mock.calls[0]).toHaveLength(1);
  });

  it("passes the board's refusal through unchanged", async () => {
    // Given the board refuses because support was already granted this season
    mockedInvoke.mockRejectedValueOnce("be.error.finance.boardSupportUnavailable");

    // When the manager asks for board support
    // Then the refusal key reaches the caller untouched
    await expect(requestBoardSupport()).rejects.toBe("be.error.finance.boardSupportUnavailable");
  });

  it("pitches the club to sponsors without sending any arguments", async () => {
    // Given a sponsor answers the pitch with an offer
    const response = {
      game: { manager: { id: "manager-1" } },
      result: {
        message_id: "msg-1",
        sponsor_name: "Acme",
        weekly_amount: 40_000,
        duration_weeks: 52,
      },
    };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager pitches to sponsors
    const result = await requestSponsorPitch();

    // Then the backend command is called with no argument object and its answer comes back as is
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("request_sponsor_pitch");
    expect(mockedInvoke.mock.calls[0]).toHaveLength(1);
  });

  it("launches a marketing campaign through the request command", async () => {
    // Given the campaign runs and earns more than it costs
    const response = {
      game: { manager: { id: "manager-1" } },
      result: {
        message_id: "msg-2",
        gross_revenue: 300_000,
        campaign_cost: 100_000,
        net_income: 200_000,
        cooldown_days: 30,
      },
    };
    mockedInvoke.mockResolvedValueOnce(response);

    // When the manager launches a marketing campaign
    const result = await launchMarketingCampaign();

    // Then the request command is called with no argument object and its answer comes back as is
    expect(result).toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("request_marketing_campaign");
    expect(mockedInvoke.mock.calls[0]).toHaveLength(1);
  });
});
