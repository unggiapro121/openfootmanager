import { useState } from "react";
import { useTranslation } from "react-i18next";

import DashboardModalFrame from "../dashboard/DashboardModalFrame";
import { Button } from "../ui";
import { formatDate, formatExactMoney, formatVal, formatWeeklyAmount } from "../../lib/helpers";
import type { StaffContractPreviewData } from "../../services/staffService";

export type StaffContractAction = "hire" | "renew" | "release";

/** Staff sign for one to three years; two unless the manager picks otherwise. */
export const STAFF_CONTRACT_YEAR_OPTIONS = [1, 2, 3] as const;
export const DEFAULT_STAFF_CONTRACT_YEARS = 2;

interface StaffContractModalProps {
  action: StaffContractAction;
  staffName: string;
  /** Null while the backend preview is still in flight. */
  preview: StaffContractPreviewData | null;
  errorMessage: string | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (contractYears: number) => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-semibold text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}

/**
 * Confirms a staff contract decision with what it costs: the asking wage and
 * the wage bill against the budget for a hire or renewal, the payoff for a
 * release. The numbers and the budget verdict come from the backend preview.
 */
export default function StaffContractModal({
  action,
  staffName,
  preview,
  errorMessage,
  submitting,
  onCancel,
  onConfirm,
}: StaffContractModalProps) {
  const { t, i18n } = useTranslation();
  const [contractYears, setContractYears] = useState<number>(DEFAULT_STAFF_CONTRACT_YEARS);
  const weeklySuffix = t("finances.perWeekSuffix", "/wk");
  const weekly = (amount: number) => formatWeeklyAmount(formatVal(amount), weeklySuffix);
  const signing = action !== "release";
  const blockedByBudget = signing && preview !== null && !preview.within_wage_budget;

  return (
    <DashboardModalFrame maxWidthClassName="max-w-lg">
      <div
        className="space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-contract-title"
      >
        <div>
          <h2
            id="staff-contract-title"
            className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
          >
            {t(`staff.contract.${action}Title`, { name: staffName })}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t(`staff.contract.${action}Body`, { name: staffName })}
          </p>
        </div>

        {preview ? (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-navy-600 dark:bg-navy-700/60">
            {signing ? (
              <>
                {action === "renew" ? (
                  <Row
                    label={t("staff.contract.currentWage")}
                    value={weekly(preview.current_wage)}
                  />
                ) : null}
                <Row label={t("staff.contract.askingWage")} value={weekly(preview.asking_wage)} />
                <Row
                  label={t("staff.contract.wageBillAfter")}
                  value={weekly(preview.projected_wage_bill)}
                />
                <Row label={t("staff.contract.wageBudget")} value={weekly(preview.wage_budget)} />
              </>
            ) : (
              <>
                <Row
                  label={t("staff.contract.contractEnds")}
                  value={
                    preview.contract_end
                      ? formatDate(preview.contract_end, i18n.language)
                      : t("staff.contract.noContract")
                  }
                />
                <Row
                  label={t("staff.contract.severance")}
                  value={formatExactMoney(preview.severance_cost)}
                />
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("common.loading")}</p>
        )}

        {signing ? (
          <fieldset>
            <legend className="mb-2 text-sm text-gray-500 dark:text-gray-400">
              {t("staff.contract.length")}
            </legend>
            <div className="flex gap-2">
              {STAFF_CONTRACT_YEAR_OPTIONS.map((years) => (
                <label
                  key={years}
                  className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-heading font-bold uppercase tracking-wider transition-colors focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-2 dark:focus-within:ring-offset-navy-800 ${
                    contractYears === years
                      ? "border-primary-500 bg-primary-500 text-white"
                      : "border-gray-200 bg-white text-gray-600 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="staff-contract-years"
                    value={years}
                    checked={contractYears === years}
                    onChange={() => setContractYears(years)}
                    className="sr-only"
                  />
                  {t(`staff.contract.years${years}`)}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {blockedByBudget ? (
          <p className="text-sm text-red-600 dark:text-red-300">{t("staff.contract.overBudget")}</p>
        ) : null}

        {errorMessage ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={signing ? "primary" : "outline"}
            className={
              signing
                ? undefined
                : "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            }
            disabled={submitting || preview === null || blockedByBudget}
            onClick={() => onConfirm(contractYears)}
          >
            {t(`staff.contract.${action}Confirm`)}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
