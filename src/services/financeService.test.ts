import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  getFacilityUpgradePreview,
  getFinanceSnapshot,
  rebalanceBudgets,
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
});
