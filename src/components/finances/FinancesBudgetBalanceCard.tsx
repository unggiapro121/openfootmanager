import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardBody, Button } from "../ui";
import { formatExactMoney, formatWeeklyAmount } from "../../lib/helpers";
import { resolveBackendError } from "../../utils/backendI18n";
import { type BudgetRebalanceTermsData, rebalanceBudgets } from "../../services/financeService";
import type { GameStateData } from "../../store/gameStore";

interface FinancesBudgetBalanceCardProps {
  terms: BudgetRebalanceTermsData;
  onGameUpdate?: (state: GameStateData) => void;
}

/**
 * The slider moves in whole steps away from today's wage budget, so every
 * position is a change the backend accepts; the two ends may sit off the step
 * (the wage bill rarely is a round number) and are clamped to exactly.
 */
function wageBudgetAt(terms: BudgetRebalanceTermsData, steps: number): number {
  const wageBudget = terms.wageBudget + steps * terms.step;
  return Math.min(terms.maxWageBudget, Math.max(terms.minWageBudget, wageBudget));
}

export default function FinancesBudgetBalanceCard({
  terms,
  onGameUpdate,
}: FinancesBudgetBalanceCardProps) {
  const { t } = useTranslation();
  const [steps, setSteps] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minSteps = -Math.ceil((terms.wageBudget - terms.minWageBudget) / terms.step);
  const maxSteps = Math.floor((terms.maxWageBudget - terms.wageBudget) / terms.step);
  const wageBudget = wageBudgetAt(terms, steps);
  const transferBudget = Math.max(
    0,
    terms.transferBudget - (wageBudget - terms.wageBudget) * terms.paydaysLeft,
  );
  const weeklySuffix = t("finances.perWeekSuffix");

  async function apply(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const updated = await rebalanceBudgets(wageBudget);
      onGameUpdate?.(updated);
    } catch (cause) {
      setError(resolveBackendError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader>{t("finances.budgetBalance.title")}</CardHeader>
      <CardBody>
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("finances.budgetBalance.hint")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl bg-gray-50 dark:bg-navy-800 p-4 text-center">
              <p className="text-xs font-heading font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
                {t("finances.wageBudget")}
              </p>
              <p
                data-testid="budget-balance-wage"
                className="font-heading font-bold text-xl text-gray-800 dark:text-gray-200"
              >
                {formatWeeklyAmount(formatExactMoney(wageBudget), weeklySuffix)}
              </p>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-navy-800 p-4 text-center">
              <p className="text-xs font-heading font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
                {t("finances.transferBudget")}
              </p>
              <p
                data-testid="budget-balance-transfer"
                className="font-heading font-bold text-xl text-gray-800 dark:text-gray-200"
              >
                {formatExactMoney(transferBudget)}
              </p>
            </div>
          </div>
          <input
            type="range"
            aria-label={t("finances.wageBudget")}
            aria-valuetext={formatWeeklyAmount(formatExactMoney(wageBudget), weeklySuffix)}
            min={minSteps}
            max={maxSteps}
            step={1}
            value={steps}
            disabled={saving || minSteps === maxSteps}
            onChange={(event) => setSteps(Number(event.target.value))}
            className="w-full accent-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
          />
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{formatWeeklyAmount(formatExactMoney(terms.minWageBudget), weeklySuffix)}</span>
            <span>{t("finances.budgetBalance.paydaysLeft", { count: terms.paydaysLeft })}</span>
            <span>{formatWeeklyAmount(formatExactMoney(terms.maxWageBudget), weeklySuffix)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={apply} disabled={saving || steps === 0}>
              {t("finances.budgetBalance.apply")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSteps(0)}
              disabled={saving || steps === 0}
            >
              {t("finances.budgetBalance.reset")}
            </Button>
            {error ? <p className="text-sm text-red-500">{error}</p> : null}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
