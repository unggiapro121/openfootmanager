import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rebalanceBudgets } from "../../services/financeService";
import type { GameStateData } from "../../store/gameStore";
import FinancesBudgetBalanceCard from "./FinancesBudgetBalanceCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "finances.budgetBalance.paydaysLeft") return `${params?.count} paydays left`;
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("../../services/financeService", () => ({
  rebalanceBudgets: vi.fn(),
}));

vi.mock("../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) => `resolved:${String(error)}`,
}));

const mockedRebalance = vi.mocked(rebalanceBudgets);

const terms = {
  paydaysLeft: 10,
  wageBudget: 50_000,
  transferBudget: 1_000_000,
  minWageBudget: 20_500,
  maxWageBudget: 150_000,
  step: 1_000,
};

function slider(): HTMLInputElement {
  return screen.getByRole("slider", { name: "finances.wageBudget" });
}

describe("FinancesBudgetBalanceCard", () => {
  beforeEach(() => {
    mockedRebalance.mockReset();
  });

  it("shows both budgets and the paydays left before anything moves", () => {
    render(<FinancesBudgetBalanceCard terms={terms} />);

    expect(screen.getByTestId("budget-balance-wage").textContent).toContain("50,000");
    expect(screen.getByTestId("budget-balance-transfer").textContent).toContain("1,000,000");
    expect(screen.getByText("10 paydays left")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "finances.budgetBalance.apply" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("moves the transfer budget the other way as the wage budget rises", () => {
    render(<FinancesBudgetBalanceCard terms={terms} />);

    fireEvent.change(slider(), { target: { value: "30" } });

    expect(screen.getByTestId("budget-balance-wage").textContent).toContain("80,000");
    expect(screen.getByTestId("budget-balance-transfer").textContent).toContain("700,000");
  });

  it("stops at the wage bill even when it is not a whole step away", () => {
    render(<FinancesBudgetBalanceCard terms={terms} />);

    fireEvent.change(slider(), { target: { value: slider().min } });

    expect(screen.getByTestId("budget-balance-wage").textContent).toContain("20,500");
    expect(screen.getByTestId("budget-balance-transfer").textContent).toContain("1,295,000");
  });

  it("applies the chosen wage budget and hands back the updated game", async () => {
    const updated = { manager: { id: "manager-1" } } as unknown as GameStateData;
    mockedRebalance.mockResolvedValueOnce(updated);
    const onGameUpdate = vi.fn();
    render(<FinancesBudgetBalanceCard terms={terms} onGameUpdate={onGameUpdate} />);

    fireEvent.change(slider(), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "finances.budgetBalance.apply" }));

    await waitFor(() => expect(onGameUpdate).toHaveBeenCalledWith(updated));
    expect(mockedRebalance).toHaveBeenCalledWith(45_000);
  });

  it("puts the slider back where it started on reset", () => {
    render(<FinancesBudgetBalanceCard terms={terms} />);

    fireEvent.change(slider(), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "finances.budgetBalance.reset" }));

    expect(slider().value).toBe("0");
    expect(screen.getByTestId("budget-balance-wage").textContent).toContain("50,000");
  });

  it("shows the backend's refusal", async () => {
    mockedRebalance.mockRejectedValueOnce("be.error.budgetRebalanceOutOfRange");
    render(<FinancesBudgetBalanceCard terms={terms} />);

    fireEvent.change(slider(), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "finances.budgetBalance.apply" }));

    expect(await screen.findByText("resolved:be.error.budgetRebalanceOutOfRange")).toBeTruthy();
  });
});
